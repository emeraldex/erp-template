import ExcelJS = require('exceljs');

export type CellType = 'text' | 'money' | 'pct' | 'int' | 'date';
export interface Column { key: string; header: string; type?: CellType; width?: number }
export type Row = Record<string, string | number | null | undefined>;
export interface Sheet { name: string; columns: Column[]; rows: Row[]; totals?: Row }
export interface Report { title: string; subtitle?: string; sheets: Sheet[] }

/**
 * A spreadsheet app treats a cell starting with = + - @ (or tab/CR) as a
 * formula. Prefix those with an apostrophe so exported data can never execute.
 */
export function safeCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
}

/** RFC 4180 CSV of one sheet, with a UTF-8 BOM so Excel opens accented names correctly. */
export function toCsv(sheet: Sheet): Buffer {
  const esc = (v: unknown) => {
    const s = safeCell(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [sheet.columns.map((c) => esc(c.header)).join(',')];
  for (const r of [...sheet.rows, ...(sheet.totals ? [sheet.totals] : [])]) {
    lines.push(sheet.columns.map((c) => esc(c.type === 'money' && typeof r[c.key] === 'number' ? (r[c.key] as number).toFixed(2) : r[c.key])).join(','));
  }
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}

const FORMATS: Record<CellType, string | undefined> = {
  text: undefined, money: '#,##0.00', pct: '0.00"%"', int: '0', date: 'yyyy-mm-dd',
};

export async function toXlsx(report: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Maintenance ERP';
  wb.created = new Date();
  for (const sheet of report.sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 3 }] });
    ws.getCell('A1').value = report.title;
    ws.getCell('A1').font = { bold: true, size: 13 };
    ws.getCell('A2').value = report.subtitle ?? '';
    ws.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };
    const header = ws.getRow(3);
    sheet.columns.forEach((c, i) => {
      header.getCell(i + 1).value = c.header;
      ws.getColumn(i + 1).width = c.width ?? Math.max(10, Math.min(40, c.header.length + 4));
      const fmt = FORMATS[c.type ?? 'text'];
      if (fmt) ws.getColumn(i + 1).numFmt = fmt;
    });
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF5' } };
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: sheet.columns.length } };
    const write = (r: Row, bold = false) => {
      const row = ws.addRow(sheet.columns.map((c) => {
        const v = r[c.key];
        if (v === null || v === undefined || v === '') return null;
        if (c.type === 'date' && typeof v === 'string') return new Date(`${v.slice(0, 10)}T00:00:00Z`);
        return typeof v === 'number' ? v : String(v);
      }));
      if (bold) row.font = { bold: true };
    };
    sheet.rows.forEach((r) => write(r));
    if (sheet.totals) write(sheet.totals, true);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
