import { BadRequestException } from '@nestjs/common';
import QRCode = require('qrcode');
import { newDoc, pdfText } from '../documents/pdf';

export const MAX_LABELS = 100;

/**
 * A4 sheets of asset labels, 2 across and 5 down: a QR code that opens the
 * asset in the ERP, with its tag, name and site. Point a phone's camera at it.
 */
export async function assetLabels(
  assets: { id: string; tag: string; name: string; site: string }[],
  webBase: string,
): Promise<{ filename: string; pdf: Buffer }> {
  if (!assets.length) throw new BadRequestException('Choose at least one asset');
  if (assets.length > MAX_LABELS) throw new BadRequestException(`At most ${MAX_LABELS} labels per print run`);
  const { doc, done } = newDoc(`Asset labels (${assets.length})`, { size: 'A4', margin: 28 });
  const cols = 2;
  const rows = 5;
  const m = 28;
  const w = (doc.page.width - 2 * m) / cols;
  const h = (doc.page.height - 2 * m) / rows;
  const qr = 92;
  for (const [i, a] of assets.entries()) {
    if (i > 0 && i % (cols * rows) === 0) doc.addPage({ size: 'A4', margin: m });
    const n = i % (cols * rows);
    const x = m + (n % cols) * w;
    const y = m + Math.floor(n / cols) * h;
    doc.save().lineWidth(0.5).dash(3, { space: 3 }).strokeColor('#999999').rect(x + 4, y + 4, w - 8, h - 8).stroke().restore();
    const url = `${webBase.replace(/\/+$/, '')}/assets?id=${encodeURIComponent(a.id)}`;
    const png = await QRCode.toBuffer(url, { type: 'png', margin: 0, width: 300, errorCorrectionLevel: 'M' });
    doc.image(png, x + 14, y + (h - qr) / 2, { width: qr, height: qr });
    const tx = x + 14 + qr + 12;
    const tw = w - (tx - x) - 14;
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(16).text(pdfText(a.tag), tx, y + h / 2 - 30, { width: tw, lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(9.5).text(pdfText(a.name), tx, doc.y + 4, { width: tw, height: 26, ellipsis: true });
    doc.fontSize(8).fillColor('#555555').text(pdfText(a.site), tx, doc.y + 2, { width: tw, lineBreak: false, ellipsis: true });
  }
  doc.end();
  return { filename: assets.length === 1 ? `${a0(assets)}-label.pdf` : `asset-labels-${assets.length}.pdf`, pdf: await done };
}

const a0 = (list: { tag: string }[]) => list[0].tag.replace(/[^A-Za-z0-9._-]/g, '_');
