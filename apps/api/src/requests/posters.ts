import QRCode = require('qrcode');
import { newDoc, pdfText } from '../documents/pdf';
import { labelSheet } from '../assets/labels';

export interface PosterPoint { code: string; label: string; siteLabel: string }

const urlFor = (webBase: string, code: string) => `${webBase.replace(/\/+$/, '')}/r?p=${encodeURIComponent(code)}`;

/**
 * A4 "Report a problem" posters, one per page: a large QR code that opens the
 * request form with the place filled in, in English and Bahasa Melayu.
 */
export async function posterPdf(points: PosterPoint[], org: string, webBase: string): Promise<Buffer> {
  const { doc, done } = newDoc(`Report a problem posters (${points.length})`, { size: 'A4', margin: 48 });
  const w = doc.page.width;
  for (const [i, p] of points.entries()) {
    if (i > 0) doc.addPage({ size: 'A4', margin: 48 });
    doc.rect(0, 0, w, 120).fill('#0b1b2b');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(34).text('Report a problem', 48, 32, { width: w - 96, align: 'center' });
    doc.font('Helvetica').fontSize(20).fillColor('#cfe3f5').text('Laporkan masalah', 48, 74, { width: w - 96, align: 'center' });
    const qr = 300;
    const png = await QRCode.toBuffer(urlFor(webBase, p.code), { type: 'png', margin: 1, width: 900, errorCorrectionLevel: 'M' });
    doc.image(png, (w - qr) / 2, 160, { width: qr, height: qr });
    doc.fillColor('#111111').font('Helvetica').fontSize(15)
      .text('Scan with your phone camera to tell the maintenance team.', 60, 480, { width: w - 120, align: 'center' })
      .fillColor('#444444').fontSize(13).text('Imbas dengan kamera telefon anda untuk memaklumkan pasukan penyelenggaraan.', 60, doc.y + 4, { width: w - 120, align: 'center' });
    doc.moveTo(120, 560).lineTo(w - 120, 560).lineWidth(0.6).strokeColor('#bbbbbb').stroke();
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(24).text(pdfText(p.label), 60, 580, { width: w - 120, align: 'center' });
    if (p.siteLabel) doc.font('Helvetica').fontSize(15).fillColor('#444444').text(pdfText(p.siteLabel), 60, doc.y + 6, { width: w - 120, align: 'center' });
    doc.fontSize(11).fillColor('#666666').text('No account needed · Tiada akaun diperlukan', 60, 700, { width: w - 120, align: 'center' });
    doc.fontSize(10).text(pdfText(org), 60, 760, { width: w - 120, align: 'center' });
    doc.fontSize(8).fillColor('#999999').text(`Point ${p.code}`, 60, 776, { width: w - 120, align: 'center' });
  }
  doc.end();
  return done;
}

/** Small stickers for assets, 2 × 5 on A4, on the same layout as asset labels. */
export function stickerPdf(points: PosterPoint[], webBase: string): Promise<Buffer> {
  return labelSheet(points.map((p) => ({
    url: urlFor(webBase, p.code), title: 'Report a problem', line1: p.label, line2: `Laporkan masalah${p.siteLabel ? ` · ${p.siteLabel}` : ''}`,
  })), `Report a problem stickers (${points.length})`);
}
