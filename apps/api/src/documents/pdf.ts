import { Currency, DEFAULT_CURRENCY, formatMoney } from '../settings/currency';
import PDFDocument = require('pdfkit');
import type { CompanyProfile } from '../settings/settings.service';

export type Doc = PDFKit.PDFDocument;

export const MARGIN = 50;
const INK = '#111111';
const MUTED = '#666666';
const RULE = '#bbbbbb';

/**
 * The built-in PDF fonts only cover Windows-1252. Swap the few characters the
 * data uses that fall outside it, so nothing prints as garbage.
 */
export function pdfText(s: unknown): string {
  return String(s ?? '')
    .replace(/→/g, '->')
    .replace(/[≤]/g, '<=')
    .replace(/[≥]/g, '>=')
    .replace(/[^\x09\x0a\x0d\x20-\x7e -ÿ–—‘’“”•…€]/g, '?');
}

/** An amount in the organisation's currency, e.g. "RM 1,080.50" (Ringgit unless one is given). */
export const myr = (n: number, cur: Currency = DEFAULT_CURRENCY) => formatMoney(n, cur);

export interface Marks {
  /** Diagonal watermark, e.g. DRAFT. */
  watermark?: string;
  /** Certified True Copy stamp text, printed on every page. */
  ctc?: string;
}

/** Create a document; resolve its bytes once ended. Compression is off under test so text can be asserted. */
export function newDoc(title: string, page: { size?: string; margin?: number } = {}): { doc: Doc; done: Promise<Buffer> } {
  const doc = new PDFDocument({
    size: page.size ?? 'A4', margin: page.margin ?? MARGIN, bufferPages: true,
    compress: process.env.NODE_ENV !== 'test',
    info: { Title: pdfText(title), Creator: 'Maintenance ERP' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.fillColor(INK).font('Helvetica').fontSize(10);
  return { doc, done };
}

export function letterhead(doc: Doc, c: CompanyProfile): void {
  const top = doc.y;
  doc.font('Helvetica-Bold').fontSize(14).text(pdfText(c.name), MARGIN, top);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  const reg = [c.registrationNo && `Reg. No. ${c.registrationNo}`, c.taxRegistrationNo && `Tax Reg. No. ${c.taxRegistrationNo}`].filter(Boolean).join('   ');
  for (const line of [...c.address, [c.phone && `Tel ${c.phone}`, c.email].filter(Boolean).join('   '), reg]) {
    if (line) doc.text(pdfText(line));
  }
  doc.fillColor(INK).moveDown(0.6);
  rule(doc);
  doc.moveDown(0.8);
}

export function rule(doc: Doc): void {
  doc.moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).lineWidth(0.6).strokeColor(RULE).stroke();
}

export function heading(doc: Doc, text: string): void {
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(pdfText(text), MARGIN, doc.y);
  doc.font('Helvetica').fontSize(10).moveDown(0.5);
}

/** Two-column label/value block. */
export function fields(doc: Doc, rows: [string, string | undefined][], x = MARGIN, labelWidth = 110): void {
  for (const [label, value] of rows) {
    const y = doc.y;
    doc.font('Helvetica').fillColor(MUTED).fontSize(9).text(pdfText(label), x, y, { width: labelWidth });
    const valueWidth = doc.page.width - MARGIN - (x + labelWidth);
    doc.font('Helvetica').fillColor(INK).fontSize(10).text(pdfText(value || '-'), x + labelWidth, y, { width: valueWidth });
    doc.moveDown(0.2);
  }
  doc.x = MARGIN;
}

export interface Column { header: string; width: number; align?: 'left' | 'right' | 'center' }

export function table(doc: Doc, cols: Column[], rows: string[][]): void {
  const startX = MARGIN;
  const drawRow = (cells: string[], bold: boolean) => {
    const y = doc.y;
    let x = startX;
    let h = 0;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5);
    cells.forEach((cell, i) => {
      const opts = { width: cols[i].width - 8, align: cols[i].align ?? 'left' };
      h = Math.max(h, doc.heightOfString(pdfText(cell), opts));
      doc.text(pdfText(cell), x + 4, y + 4, opts);
      x += cols[i].width;
    });
    doc.y = y + h + 8;
    rule(doc);
  };
  rule(doc);
  drawRow(cols.map((c) => c.header), true);
  rows.forEach((r) => drawRow(r, false));
  doc.x = MARGIN;
  doc.moveDown(0.5);
}

export function signature(doc: Doc, label: string, name?: string, title?: string, x = MARGIN): void {
  const y = doc.y + 30;
  doc.moveTo(x, y).lineTo(x + 200, y).lineWidth(0.6).strokeColor(INK).stroke();
  doc.font('Helvetica').fontSize(9).fillColor(INK).text(pdfText(label), x, y + 4, { width: 200 });
  if (name) doc.text(pdfText(name), x, doc.y, { width: 200 });
  if (title) doc.fillColor(MUTED).text(pdfText(title), x, doc.y, { width: 200 }).fillColor(INK);
}

/** Watermark, CTC stamp and page footer on every page; call once, just before doc.end(). */
export function finish(doc: Doc, ref: string, marks: Marks = {}): void {
  const range = doc.bufferedPageRange();
  const generated = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const { width, height } = doc.page;
    // Footer and stamps sit in the margins; lift them for this pass or PDFKit
    // treats the text as overflow and starts a new page.
    const margins = { ...doc.page.margins };
    doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
    if (marks.watermark) {
      doc.save().rotate(-35, { origin: [width / 2, height / 2] })
        .font('Helvetica-Bold').fontSize(90).fillColor('#cc0000').opacity(0.12)
        .text(pdfText(marks.watermark), 0, height / 2 - 50, { width, align: 'center', lineBreak: false })
        .restore();
    }
    if (marks.ctc) {
      const w = 230;
      const x = width - MARGIN - w;
      doc.save().lineWidth(1.4).strokeColor('#1a3d8f').rect(x, 28, w, 38).stroke()
        .font('Helvetica-Bold').fontSize(10).fillColor('#1a3d8f').opacity(1)
        .text('CERTIFIED TRUE COPY', x, 34, { width: w, align: 'center' })
        .font('Helvetica').fontSize(8).text(pdfText(marks.ctc), x, 49, { width: w, align: 'center' })
        .restore();
    }
    doc.save().font('Helvetica').fontSize(7.5).fillColor(MUTED).opacity(1)
      .text(`${pdfText(ref)}   ·   Page ${i - range.start + 1} of ${range.count}   ·   Generated ${generated}`,
        MARGIN, height - 35, { width: width - 2 * MARGIN, align: 'center', lineBreak: false })
      .restore();
    doc.page.margins = margins;
  }
}
