import { BadRequestException } from '@nestjs/common';
import QRCode = require('qrcode');
import { newDoc, pdfText } from '../documents/pdf';

export const MAX_LABELS = 100;

/** One label: a QR code that opens `url`, a large title and two smaller lines. */
export interface Label { url: string; title: string; line1: string; line2: string }

/**
 * A4 sheets of labels, 2 across and 5 down: a QR code that opens the record
 * in the ERP, with a title and two lines of detail. Point a phone's camera at it.
 */
export async function labelSheet(labels: Label[], docTitle: string): Promise<Buffer> {
  if (!labels.length) throw new BadRequestException('Choose at least one label');
  if (labels.length > MAX_LABELS) throw new BadRequestException(`At most ${MAX_LABELS} labels per print run`);
  const { doc, done } = newDoc(docTitle, { size: 'A4', margin: 28 });
  const cols = 2;
  const rows = 5;
  const m = 28;
  const w = (doc.page.width - 2 * m) / cols;
  const h = (doc.page.height - 2 * m) / rows;
  const qr = 92;
  for (const [i, a] of labels.entries()) {
    if (i > 0 && i % (cols * rows) === 0) doc.addPage({ size: 'A4', margin: m });
    const n = i % (cols * rows);
    const x = m + (n % cols) * w;
    const y = m + Math.floor(n / cols) * h;
    doc.save().lineWidth(0.5).dash(3, { space: 3 }).strokeColor('#999999').rect(x + 4, y + 4, w - 8, h - 8).stroke().restore();
    const png = await QRCode.toBuffer(a.url, { type: 'png', margin: 0, width: 300, errorCorrectionLevel: 'M' });
    doc.image(png, x + 14, y + (h - qr) / 2, { width: qr, height: qr });
    const tx = x + 14 + qr + 12;
    const tw = w - (tx - x) - 14;
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(16).text(pdfText(a.title), tx, y + h / 2 - 30, { width: tw, lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(9.5).text(pdfText(a.line1), tx, doc.y + 4, { width: tw, height: 26, ellipsis: true });
    doc.fontSize(8).fillColor('#555555').text(pdfText(a.line2), tx, doc.y + 2, { width: tw, lineBreak: false, ellipsis: true });
  }
  doc.end();
  return done;
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_');
const base = (webBase: string) => webBase.replace(/\/+$/, '');

/** Asset labels: the QR opens the asset; tag, name and site. */
export async function assetLabels(
  assets: { id: string; tag: string; name: string; site: string }[],
  webBase: string,
): Promise<{ filename: string; pdf: Buffer }> {
  if (!assets.length) throw new BadRequestException('Choose at least one asset');
  const pdf = await labelSheet(
    assets.map((a) => ({ url: `${base(webBase)}/assets?id=${encodeURIComponent(a.id)}`, title: a.tag, line1: a.name, line2: a.site })),
    `Asset labels (${assets.length})`,
  );
  return { filename: assets.length === 1 ? `${safeName(assets[0].tag)}-label.pdf` : `asset-labels-${assets.length}.pdf`, pdf };
}

/**
 * Part labels, for the shelf or the bin: the QR opens the part's stock.
 * With a store, the label shows the bin and store; without, unit and group.
 */
export async function partLabels(
  parts: { id: string; partNo: string; name: string; detail: string }[],
  webBase: string,
): Promise<{ filename: string; pdf: Buffer }> {
  if (!parts.length) throw new BadRequestException('Choose at least one part');
  const pdf = await labelSheet(
    parts.map((p) => ({ url: `${base(webBase)}/stock?part=${encodeURIComponent(p.id)}`, title: p.partNo, line1: p.name, line2: p.detail })),
    `Part labels (${parts.length})`,
  );
  return { filename: parts.length === 1 ? `${safeName(parts[0].partNo)}-label.pdf` : `part-labels-${parts.length}.pdf`, pdf };
}
