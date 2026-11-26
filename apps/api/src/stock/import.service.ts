import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import { nextId } from '../assets/ids';
import { csvSeparator, parseCsv } from './csv';
import { StockService } from './stock.service';

type Actor = { name: string; role: string };

export const IMPORT_COLUMNS = ['partNo', 'name', 'unit', 'group', 'manufacturer', 'mfrPartNo', 'store', 'bin', 'qty', 'unitCost', 'reorderPoint', 'reorderQty'] as const;
export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_BYTES = 1024 * 1024;

const PART_NO = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/;
const LIMITS: Record<string, number> = { partNo: 40, name: 120, manufacturer: 80, mfrPartNo: 60, bin: 40 };

type Col = (typeof IMPORT_COLUMNS)[number];
interface Line {
  row: number;
  partNo: string;
  part: { name?: string; unit?: string; group?: string; manufacturer?: string; mfrPartNo?: string };
  store?: string;
  bin?: string;
  qty?: number;
  unitCost?: number;
  reorderPoint?: number | null;
  reorderQty?: number | null;
}

export interface ImportResult {
  dryRun: boolean;
  rows: number;
  created: string[];
  updated: string[];
  levels: number;
  openings: number;
  errors: { row: number; message: string }[];
}

/**
 * Load a parts catalogue (and opening stock) from a spreadsheet saved as CSV.
 * Every row is checked first; if any row has a problem nothing is changed.
 * Parts are matched by part number — new ones created, existing ones updated.
 * Opening quantities go in only where that part has no history in that store;
 * after that, stock changes through receipts, issues, adjustments and counts.
 */
@Injectable()
export class StockImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: StoreService,
    private readonly stock: StockService,
  ) {}

  /** A dictionary value given as its key or its label, any case. */
  private dictKey(kind: string, v: string): string | undefined {
    const t = v.trim().toLowerCase();
    return this.store.dict(kind, true).find((d) => d.key.toLowerCase() === t || d.label.toLowerCase() === t)?.key;
  }

  async run(file: Buffer | undefined, dryRun: boolean, actor: Actor): Promise<ImportResult> {
    if (!file?.length) throw new BadRequestException('Attach the CSV file (field "file")');
    if (file.length > IMPORT_MAX_BYTES) throw new BadRequestException('The file is larger than 1 MB — split it into smaller files');
    let table: string[][];
    const content = file.toString('utf8');
    // A semicolon-separated file comes from a spreadsheet that writes 2,5 for 2.5.
    const decimalComma = csvSeparator(content) === ';';
    try {
      table = parseCsv(content);
    } catch (e) {
      throw new BadRequestException(`The file could not be read as CSV: ${(e as Error).message}`);
    }
    if (table.length < 2) throw new BadRequestException('The file has no rows under the header');
    if (table.length - 1 > IMPORT_MAX_ROWS) throw new BadRequestException(`At most ${IMPORT_MAX_ROWS} rows per file — split it into smaller files`);

    const header = table[0].map((h) => h.trim().replace(/[\s_]/g, '').toLowerCase());
    const index = new Map<Col, number>();
    for (const col of IMPORT_COLUMNS) {
      const at = header.indexOf(col.toLowerCase());
      if (at >= 0) index.set(col, at);
    }
    if (!index.has('partNo')) throw new BadRequestException(`The header row must include partNo. Columns: ${IMPORT_COLUMNS.join(', ')}`);

    const errors: ImportResult['errors'] = [];
    const lines: Line[] = [];
    for (const [i, cells] of table.slice(1).entries()) {
      const row = i + 2; // spreadsheet row number, header is row 1
      const get = (c: Col) => (index.has(c) ? (cells[index.get(c)!] ?? '').trim() : '');
      const bad = (message: string) => errors.push({ row, message });
      const before = errors.length;
      for (const [c, max] of Object.entries(LIMITS)) if (get(c as Col).length > max) bad(`${c}: at most ${max} characters`);
      const partNo = get('partNo');
      if (!partNo) bad('partNo is empty');
      else if (!PART_NO.test(partNo)) bad('partNo: letters, digits, spaces or . _ / - only');
      const line: Line = { row, partNo, part: {} };
      if (get('name')) line.part.name = get('name');
      if (get('manufacturer')) line.part.manufacturer = get('manufacturer');
      if (get('mfrPartNo')) line.part.mfrPartNo = get('mfrPartNo');
      if (get('unit')) {
        const k = this.dictKey('unit', get('unit'));
        if (k) line.part.unit = k; else bad(`Unknown unit "${get('unit')}"`);
      }
      if (get('group')) {
        const k = this.dictKey('partGroup', get('group'));
        if (k) line.part.group = k; else bad(`Unknown part group "${get('group')}"`);
      }
      const number = (c: Col, opts: { allowZero: boolean }) => {
        const raw = get(c);
        if (!raw) return undefined;
        const n = Number(decimalComma ? raw.replace(/\s|\./g, '').replace(',', '.') : raw.replace(/,/g, ''));
        if (!Number.isFinite(n) || n < 0 || (!opts.allowZero && n === 0)) { bad(`${c} must be a number${opts.allowZero ? ' of 0 or more' : ' above 0'}`); return undefined; }
        if (Math.round(n * 1000) / 1000 !== n && c !== 'unitCost') { bad(`${c}: at most 3 decimal places`); return undefined; }
        if (n > 1e9) { bad(`${c} is too large`); return undefined; }
        return n;
      };
      const qty = number('qty', { allowZero: true });
      const unitCost = number('unitCost', { allowZero: true });
      const reorderPoint = number('reorderPoint', { allowZero: true });
      const reorderQty = number('reorderQty', { allowZero: false });
      const needsStore = [get('bin'), get('qty'), get('reorderPoint'), get('reorderQty')].some(Boolean);
      if (get('store')) {
        const k = this.dictKey('store', get('store'));
        if (k) line.store = k; else bad(`Unknown store "${get('store')}"`);
      } else if (needsStore) bad('store is needed with a bin, quantity or reorder level');
      if (get('bin')) line.bin = get('bin');
      if (qty !== undefined && qty > 0) {
        line.qty = qty;
        if (unitCost === undefined) bad('unitCost is needed with an opening quantity');
      }
      if (unitCost !== undefined) line.unitCost = Math.round(unitCost * 10_000) / 10_000;
      if (reorderPoint !== undefined) line.reorderPoint = reorderPoint;
      if (reorderQty !== undefined) line.reorderQty = reorderQty;
      if (errors.length === before) lines.push(line);
    }

    // Across rows: one opening per part and store; new parts need a name.
    const existing = new Map((await this.prisma.part.findMany({ where: { partNo: { in: [...new Set(lines.map((l) => l.partNo))] } }, select: { id: true, partNo: true } })).map((p) => [p.partNo, p.id]));
    const named = new Set(lines.filter((l) => l.part.name).map((l) => l.partNo));
    const seenStore = new Map<string, number>();
    const openingKeys: { partId: string; store: string; row: number; partNo: string }[] = [];
    for (const l of lines) {
      if (!existing.has(l.partNo) && !named.has(l.partNo)) errors.push({ row: l.row, message: `${l.partNo} is not in the catalogue yet — give it a name` });
      if (l.store) {
        const key = `${l.partNo}\u0000${l.store}`;
        if (seenStore.has(key)) errors.push({ row: l.row, message: `${l.partNo} in ${this.stock.storeLabel(l.store)} is already on row ${seenStore.get(key)}` });
        else seenStore.set(key, l.row);
        if (l.qty && existing.has(l.partNo)) openingKeys.push({ partId: existing.get(l.partNo)!, store: l.store, row: l.row, partNo: l.partNo });
      }
    }
    if (openingKeys.length) {
      const history = await this.prisma.stockMovement.groupBy({
        by: ['partId', 'store'],
        where: { OR: openingKeys.map((k) => ({ partId: k.partId, store: k.store })) },
      });
      const has = new Set(history.map((h) => `${h.partId}\u0000${h.store}`));
      for (const k of openingKeys) {
        if (has.has(`${k.partId}\u0000${k.store}`)) errors.push({ row: k.row, message: `${k.partNo} already has stock history in ${this.stock.storeLabel(k.store)} — use a count or an adjustment` });
      }
    }
    errors.sort((a, b) => a.row - b.row);

    const partNos = [...new Set(lines.map((l) => l.partNo))];
    const result: ImportResult = {
      dryRun, rows: table.length - 1,
      created: partNos.filter((p) => !existing.has(p)),
      updated: partNos.filter((p) => existing.has(p)),
      levels: lines.filter((l) => l.store).length,
      openings: lines.filter((l) => l.qty).length,
      errors,
    };
    if (dryRun) return result;
    if (errors.length) {
      throw new BadRequestException({ statusCode: 400, message: `${errors.length} row${errors.length === 1 ? ' has a problem' : 's have problems'} — nothing was imported`, errors });
    }

    const touched: { partId: string; store: string }[] = [];
    await this.prisma.$transaction(async (tx) => {
      const ids = (await tx.part.findMany({ select: { id: true } })).map((r) => r.id);
      const idOf = new Map(existing);
      const defaultUnit = this.store.dict('unit', true)[0]?.key ?? 'EA';
      for (const l of lines) {
        let id = idOf.get(l.partNo);
        if (!id) {
          id = nextId('PRT', ids);
          ids.push(id);
          idOf.set(l.partNo, id);
          await tx.part.create({
            data: {
              id, partNo: l.partNo, name: l.part.name ?? lines.find((x) => x.partNo === l.partNo && x.part.name)!.part.name!,
              unit: l.part.unit ?? defaultUnit, group: l.part.group ?? '', manufacturer: l.part.manufacturer ?? '', mfrPartNo: l.part.mfrPartNo ?? '',
              createdBy: actor.name,
            },
          });
        } else if (Object.keys(l.part).length) {
          await tx.part.update({ where: { id }, data: { ...l.part, version: { increment: 1 } } });
        }
        if (!l.store) continue;
        const level = {
          ...(l.bin !== undefined ? { bin: l.bin } : {}),
          ...(l.reorderPoint !== undefined ? { reorderPoint: l.reorderPoint } : {}),
          ...(l.reorderQty !== undefined ? { reorderQty: l.reorderQty } : {}),
        };
        await tx.stockLevel.upsert({ where: { partId_store: { partId: id, store: l.store } }, create: { partId: id, store: l.store, ...level }, update: level });
        if (l.qty) {
          if (await tx.stockMovement.count({ where: { partId: id, store: l.store } })) {
            throw new BadRequestException({ statusCode: 400, message: 'Stock changed while importing — nothing was imported', errors: [{ row: l.row, message: `${l.partNo} already has stock history in ${this.stock.storeLabel(l.store)} — use a count or an adjustment` }] });
          }
          await this.stock.receiveTx(tx, { partId: id, store: l.store, qty: l.qty, unitCost: l.unitCost ?? 0, by: actor.name, type: 'OPENING', reason: 'Imported opening stock' });
        }
        touched.push({ partId: id, store: l.store });
      }
    }, { timeout: 120_000, maxWait: 10_000 });
    if (touched.length) await this.stock.checkLow(touched);
    return result;
  }
}
