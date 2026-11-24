import { BadRequestException } from '@nestjs/common';
import { ageingBucket, daysOutstanding, parsePeriod } from '../../src/reports/reports.service';
import { safeCell, toCsv, toXlsx } from '../../src/reports/tabular';
import ExcelJS = require('exceljs');
import type { Invoice } from '../../src/common/types';

describe('CSV export', () => {
  it('neutralises cells that a spreadsheet would run as formulas', () => {
    expect(safeCell('=HYPERLINK("http://evil")')).toBe(`'=HYPERLINK("http://evil")`);
    expect(safeCell('+cmd')).toBe(`'+cmd`);
    expect(safeCell('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(safeCell('-12.50')).toBe('-12.50'); // a plain negative number stays a number
    expect(safeCell('Normal text')).toBe('Normal text');
  });

  it('quotes commas, quotes and newlines, formats money and adds a BOM', () => {
    const csv = toCsv({
      name: 's', columns: [{ key: 'a', header: 'Name' }, { key: 'b', header: 'Amount', type: 'money' }],
      rows: [{ a: 'Smith, "Jo"\nLine 2', b: 1234.5 }], totals: { a: 'TOTAL', b: 1234.5 },
    }).toString('utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')).toEqual(['Name,Amount', '"Smith, ""Jo""\nLine 2",1234.50', 'TOTAL,1234.50', '']);
  });
});

describe('XLSX export', () => {
  it('writes typed cells, a header row and totals', async () => {
    const buf = await toXlsx({
      title: 'T', subtitle: 'S',
      sheets: [{ name: 'Data', columns: [{ key: 'd', header: 'Date', type: 'date' }, { key: 'm', header: 'Money', type: 'money' }],
        rows: [{ d: '2026-07-13', m: 10.5 }], totals: { m: 10.5 } }],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const ws = wb.getWorksheet('Data')!;
    expect(ws.getCell('A1').value).toBe('T');
    expect(ws.getRow(3).values).toEqual([undefined, 'Date', 'Money']);
    expect((ws.getCell('A4').value as Date).toISOString().slice(0, 10)).toBe('2026-07-13');
    expect(ws.getCell('B4').value).toBe(10.5);
    expect(ws.getCell('B4').numFmt).toBe('#,##0.00');
    expect(ws.getRow(5).font?.bold).toBe(true);
  });
});

describe('report periods and ageing', () => {
  it('defaults to the current calendar month', () => {
    expect(parsePeriod(undefined, undefined, new Date('2026-02-14T10:00:00Z'))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('rejects bad or reversed dates and over-long periods', () => {
    expect(() => parsePeriod('2026-13-01', '2026-12-31')).toThrow(BadRequestException);
    expect(() => parsePeriod('07/01/2026', '2026-07-31')).toThrow(BadRequestException);
    expect(() => parsePeriod('2026-02-30', '2026-03-31')).toThrow(BadRequestException);
    expect(parsePeriod('2028-02-29', '2028-03-01')).toEqual({ from: '2028-02-29', to: '2028-03-01' }); // leap day is real
    expect(() => parsePeriod('2026-08-01', '2026-07-01')).toThrow('from must not be after to');
    expect(() => parsePeriod('2020-01-01', '2026-01-01')).toThrow('three years');
  });

  it('buckets ages at the 30/60/90-day boundaries', () => {
    expect([0, 30, 31, 60, 61, 90, 91].map(ageingBucket)).toEqual(['0–30', '0–30', '31–60', '31–60', '61–90', '61–90', '90+']);
  });

  it('counts outstanding days from the tax invoice date, or drafting if not raised', () => {
    const now = Date.parse('2026-08-12T00:00:00Z');
    const base = { outstanding: true, statusSince: '2026-07-01T00:00:00Z', audit: [{ at: '2026-07-01T09:00:00Z' }], records: [] } as unknown as Invoice;
    expect(daysOutstanding(base, now)).toBe(42);
    expect(daysOutstanding({ ...base, records: [{ formNo: 'F311', refNo: 'x', date: '2026-08-02', by: 'b' }] } as Invoice, now)).toBe(10);
    expect(daysOutstanding({ ...base, outstanding: false } as Invoice, now)).toBeNull();
  });
});
