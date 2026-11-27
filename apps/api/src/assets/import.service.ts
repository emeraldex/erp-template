import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import { nextId } from './ids';
import { parseCsv } from '../stock/csv';
import { ASSET_STATUSES, CRITICALITY } from './assets.service';

type Actor = { name: string; role: string };

export const ASSET_IMPORT_COLUMNS = ['tag', 'name', 'type', 'site', 'location', 'make', 'model', 'serialNo', 'criticality', 'status', 'parentTag', 'commissionedOn', 'meterKey', 'meterLabel', 'meterUnit', 'meterValue'] as const;
type Col = (typeof ASSET_IMPORT_COLUMNS)[number];
const MAX_ROWS = 2000;
const MAX_BYTES = 1024 * 1024;
const TAG = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/;
const METER_KEY = /^[A-Z][A-Z0-9_]{0,23}$/;
const LIMITS: Partial<Record<Col, number>> = { tag: 40, name: 120, location: 120, make: 60, model: 60, serialNo: 60, parentTag: 40, meterLabel: 60, meterUnit: 12 };

interface Line {
  row: number; tag: string;
  data: { name?: string; type?: string; site?: string; location?: string; make?: string; model?: string; serialNo?: string; criticality?: string; status?: string; commissionedOn?: string };
  parentTag?: string;
  meter?: { key: string; label: string; unit: string; value: number };
}

export interface AssetImportResult { dryRun: boolean; rows: number; created: string[]; updated: string[]; meters: number; errors: { row: number; message: string }[] }

/**
 * Load the asset register from a spreadsheet saved as CSV. Matched by tag:
 * new ones created, existing ones updated. A parent can be in the same file;
 * loops are refused. Every row is checked first; nothing changes unless all
 * rows are good.
 */
@Injectable()
export class AssetImportService {
  constructor(private readonly prisma: PrismaService, private readonly store: StoreService) {}

  private dictKey(kind: string, v: string): string | undefined {
    const t = v.trim().toLowerCase();
    return this.store.dict(kind, true).find((d) => d.key.toLowerCase() === t || d.label.toLowerCase() === t)?.key;
  }

  async run(file: Buffer | undefined, dryRun: boolean, actor: Actor): Promise<AssetImportResult> {
    if (!file?.length) throw new BadRequestException('Attach the CSV file (field "file")');
    if (file.length > MAX_BYTES) throw new BadRequestException('The file is larger than 1 MB — split it into smaller files');
    let table: string[][];
    try { table = parseCsv(file.toString('utf8')); } catch (e) { throw new BadRequestException(`The file could not be read as CSV: ${(e as Error).message}`); }
    if (table.length < 2) throw new BadRequestException('The file has no rows under the header');
    if (table.length - 1 > MAX_ROWS) throw new BadRequestException(`At most ${MAX_ROWS} rows per file`);
    const header = table[0].map((h) => h.trim().replace(/[\s_]/g, '').toLowerCase());
    const index = new Map<Col, number>();
    for (const c of ASSET_IMPORT_COLUMNS) { const at = header.indexOf(c.toLowerCase()); if (at >= 0) index.set(c, at); }
    if (!index.has('tag')) throw new BadRequestException(`The header row must include tag. Columns: ${ASSET_IMPORT_COLUMNS.join(', ')}`);

    const errors: AssetImportResult['errors'] = [];
    const lines: Line[] = [];
    const seen = new Map<string, number>();
    for (const [i, cells] of table.slice(1).entries()) {
      const row = i + 2;
      const get = (c: Col) => (index.has(c) ? (cells[index.get(c)!] ?? '').trim() : '');
      const bad = (m: string) => errors.push({ row, message: m });
      const before = errors.length;
      for (const [c, max] of Object.entries(LIMITS)) if (get(c as Col).length > max!) bad(`${c}: at most ${max} characters`);
      const tag = get('tag');
      if (!tag) bad('tag is empty'); else if (!TAG.test(tag)) bad('tag: letters, digits, spaces or . _ / - only');
      if (tag && seen.has(tag.toLowerCase())) bad(`${tag} is already on row ${seen.get(tag.toLowerCase())}`); else if (tag) seen.set(tag.toLowerCase(), row);
      const line: Line = { row, tag, data: {} };
      for (const k of ['name', 'location', 'make', 'model', 'serialNo'] as const) if (get(k)) line.data[k] = get(k);
      if (get('type')) { const k = this.dictKey('assetType', get('type')); if (k) line.data.type = k; else bad(`Unknown type "${get('type')}"`); }
      if (get('site')) { const k = this.dictKey('site', get('site')); if (k) line.data.site = k; else bad(`Unknown site "${get('site')}"`); }
      if (get('criticality')) { const v = get('criticality').toUpperCase(); if ((CRITICALITY as readonly string[]).includes(v)) line.data.criticality = v; else bad(`criticality: ${CRITICALITY.join(', ')}`); }
      if (get('status')) { const v = get('status').toUpperCase().replace(/[\s-]+/g, '_'); if ((ASSET_STATUSES as readonly string[]).includes(v)) line.data.status = v; else bad(`status: ${ASSET_STATUSES.join(', ')}`); }
      if (get('commissionedOn')) {
        const v = get('commissionedOn');
        const d = new Date(`${v}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(d.getTime()) || !d.toISOString().startsWith(v)) bad('commissionedOn: YYYY-MM-DD'); else line.data.commissionedOn = v;
      }
      if (get('parentTag')) line.parentTag = get('parentTag');
      if (get('meterKey')) {
        const key = get('meterKey').toUpperCase();
        const value = get('meterValue') ? Number(get('meterValue').replace(/,/g, '')) : 0;
        if (!METER_KEY.test(key)) bad('meterKey: capital letters, digits or _ (e.g. ODOMETER)');
        if (!get('meterLabel')) bad('meterLabel is needed with a meter');
        if (!get('meterUnit')) bad('meterUnit is needed with a meter (e.g. km, h)');
        if (!Number.isFinite(value) || value < 0) bad('meterValue must be a number of 0 or more');
        line.meter = { key, label: get('meterLabel'), unit: get('meterUnit'), value };
      }
      if (errors.length === before) lines.push(line);
    }

    const existing = new Map((await this.prisma.asset.findMany({ select: { id: true, tag: true, parentId: true } })).map((a) => [a.tag.toLowerCase(), a]));
    for (const l of lines) {
      const isNew = !existing.has(l.tag.toLowerCase());
      if (isNew) for (const [k, label] of [['name', 'name'], ['type', 'type'], ['site', 'site']] as const) if (!l.data[k]) errors.push({ row: l.row, message: `${l.tag} is new — give its ${label}` });
      if (l.parentTag && l.parentTag.toLowerCase() === l.tag.toLowerCase()) errors.push({ row: l.row, message: `${l.tag} cannot be its own parent` });
      else if (l.parentTag && !existing.has(l.parentTag.toLowerCase()) && !seen.has(l.parentTag.toLowerCase())) errors.push({ row: l.row, message: `Parent ${l.parentTag} is not in the register or the file` });
    }
    // Loops: follow parents (file first, then the register) and refuse any cycle.
    const parentOf = new Map<string, string | null>();
    const idToTag = new Map([...existing.values()].map((a) => [a.id, a.tag.toLowerCase()]));
    for (const [tag, a] of existing) parentOf.set(tag, a.parentId ? idToTag.get(a.parentId) ?? null : null);
    for (const l of lines) if (l.parentTag !== undefined) parentOf.set(l.tag.toLowerCase(), l.parentTag.toLowerCase());
    for (const l of lines) {
      const visited = new Set<string>();
      let at: string | null | undefined = l.tag.toLowerCase();
      while (at) {
        if (visited.has(at)) { errors.push({ row: l.row, message: `${l.tag}: its parents loop back to it` }); break; }
        visited.add(at);
        at = parentOf.get(at);
      }
    }
    errors.sort((a, b) => a.row - b.row);
    const result: AssetImportResult = {
      dryRun, rows: table.length - 1,
      created: lines.filter((l) => !existing.has(l.tag.toLowerCase())).map((l) => l.tag),
      updated: lines.filter((l) => existing.has(l.tag.toLowerCase())).map((l) => l.tag),
      meters: lines.filter((l) => l.meter).length, errors,
    };
    if (dryRun) return result;
    if (errors.length) throw new BadRequestException({ statusCode: 400, message: `${errors.length} row${errors.length === 1 ? ' has a problem' : 's have problems'} — nothing was imported`, errors });

    await this.prisma.$transaction(async (tx) => {
      const ids = (await tx.asset.findMany({ select: { id: true } })).map((r) => r.id);
      const idOf = new Map([...existing.entries()].map(([t, a]) => [t, a.id]));
      // First every asset, then the parents (so a parent later in the file is there).
      for (const l of lines) {
        const key = l.tag.toLowerCase();
        if (idOf.has(key)) {
          if (Object.keys(l.data).length) await tx.asset.update({ where: { id: idOf.get(key)! }, data: { ...l.data, version: { increment: 1 } } });
        } else {
          const id = nextId('AST', ids);
          ids.push(id);
          idOf.set(key, id);
          await tx.asset.create({
            data: {
              id, tag: l.tag, name: l.data.name!, type: l.data.type!, site: l.data.site!, location: l.data.location ?? '', make: l.data.make ?? '', model: l.data.model ?? '',
              serialNo: l.data.serialNo ?? '', status: l.data.status ?? 'IN_SERVICE', criticality: l.data.criticality ?? 'MEDIUM', commissionedOn: l.data.commissionedOn ?? null,
              attributes: {} as never, createdBy: actor.name, ordinal: ids.length,
            },
          });
        }
        if (l.meter) {
          const assetId = idOf.get(key)!;
          await tx.meter.upsert({
            where: { assetId_key: { assetId, key: l.meter.key } },
            create: { assetId, key: l.meter.key, label: l.meter.label, unit: l.meter.unit, value: l.meter.value, readAt: new Date() },
            update: { label: l.meter.label, unit: l.meter.unit },
          });
        }
      }
      for (const l of lines) {
        if (l.parentTag === undefined) continue;
        await tx.asset.update({ where: { id: idOf.get(l.tag.toLowerCase())! }, data: { parentId: l.parentTag ? idOf.get(l.parentTag.toLowerCase())! : null } });
      }
    }, { timeout: 120_000, maxWait: 10_000 });
    return result;
  }
}
