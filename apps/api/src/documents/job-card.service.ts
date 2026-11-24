import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import QRCode = require('qrcode');
import { StoreService } from '../common/store.service';
import type { Job } from '../common/types';
import { JOB_STATUS_META, REPAIR_ROUTE_META } from '../common/workflow-config';
import { SettingsService } from '../settings/settings.service';
import { Doc, newDoc, pdfText } from './pdf';

const MAX_BATCH = 100;

/** Printable job cards: one tag per component, with a QR code that opens the job in the ERP. */
@Injectable()
export class JobCardService {
  constructor(private readonly store: StoreService, private readonly settings: SettingsService) {}

  async cards(ids: string[], webBase: string): Promise<{ filename: string; pdf: Buffer }> {
    const unique = [...new Set(ids.map((i) => i.trim()).filter(Boolean))];
    if (!unique.length) throw new BadRequestException('Give at least one job (PS number)');
    if (unique.length > MAX_BATCH) throw new BadRequestException(`At most ${MAX_BATCH} cards per print run`);
    const jobs: Job[] = [];
    for (const id of unique) {
      const job = await this.store.job(id);
      if (!job) throw new NotFoundException(`Job ${id} not found`);
      jobs.push(job);
    }

    // A6 is the usual size for a tag that travels with the item; it prints 4-up on A4 too.
    const { doc, done } = newDoc(`Job cards (${jobs.length})`, { size: 'A6', margin: 18 });
    for (const [i, job] of jobs.entries()) {
      if (i > 0) doc.addPage({ size: 'A6', margin: 18 });
      await this.card(doc, job, `${webBase.replace(/\/+$/, '')}/jobs/${encodeURIComponent(job.id)}`);
    }
    doc.end();
    const name = jobs.length === 1 ? `${jobs[0].id}-job-card.pdf` : `job-cards-${jobs.length}.pdf`;
    return { filename: name.replace(/[^A-Za-z0-9._-]/g, '_'), pdf: await done };
  }

  private async card(doc: Doc, job: Job, url: string): Promise<void> {
    const { width } = doc.page;
    const m = 18;
    const company = this.settings.company.name;
    const qr = await QRCode.toBuffer(url, { type: 'png', margin: 0, width: 300, errorCorrectionLevel: 'M' });

    doc.font('Helvetica').fontSize(7).fillColor('#666666').text(pdfText(company), m, m, { width: width - 2 * m });
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#111111').text('JOB CARD · QP.44', m, doc.y + 1);

    const qrSize = 96;
    doc.image(qr, width - m - qrSize, m, { width: qrSize, height: qrSize });
    doc.font('Helvetica-Bold').fontSize(20).text(pdfText(job.id), m, m + 30, { width: width - 2 * m - qrSize - 6 });
    doc.font('Helvetica').fontSize(9).text(pdfText(job.component), m, doc.y + 2, { width: width - 2 * m - qrSize - 6 });

    let y = m + qrSize + 10;
    if (job.priority?.state === 'OPEN') {
      doc.rect(m, y, width - 2 * m, 18).fill('#c8102e');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10)
        .text(pdfText(`${job.priority.type} · ${REPAIR_ROUTE_META[job.priority.route]?.en ?? job.priority.route}${job.priority.edd ? ` · EDD ${job.priority.edd}` : ''}`),
          m + 6, y + 4.5, { width: width - 2 * m - 12 });
      doc.fillColor('#111111');
      y += 24;
    }

    const rows: [string, string | undefined][] = [
      ['Part no.', job.partNo], ['Serial no.', job.serialNo], ['Category', job.category === 'NAS' ? 'Non-airborne system' : 'Military'],
      ['From', job.originUnit], ['Repair unit', job.repairUnit], ['Received', job.psDate], ['Indent', job.indentRef],
      ['Status now', JOB_STATUS_META[job.status]?.en ?? job.status], ['Location now', job.location],
    ];
    for (const [label, value] of rows) {
      doc.font('Helvetica').fontSize(7.5).fillColor('#666666').text(pdfText(label), m, y, { width: 62 });
      doc.font('Helvetica').fontSize(9).fillColor('#111111').text(pdfText(value || '—'), m + 64, y - 1, { width: width - 2 * m - 64 });
      y = Math.max(doc.y, y + 12) + 2;
    }

    // Hand-written trail: each stage signs the card as the item moves.
    y += 4;
    doc.font('Helvetica-Bold').fontSize(7.5).text('STAGE SIGN-OFF', m, y);
    y = doc.y + 3;
    const cols = [m, m + 92, m + 148, width - m];
    doc.lineWidth(0.5).strokeColor('#999999');
    for (const [i, stage] of ['Received (Stores)', 'TDI (Workshop)', 'Repair / WIP', 'Final inspection', 'Released'].entries()) {
      const rowY = y + i * 15;
      doc.moveTo(m, rowY + 13).lineTo(width - m, rowY + 13).stroke();
      doc.font('Helvetica').fontSize(7).fillColor('#444444').text(stage, cols[0], rowY + 4, { width: 90 });
    }
    doc.fontSize(6).fillColor('#999999').text('date', cols[1], y - 7).text('initials', cols[2], y - 7);

    doc.font('Helvetica').fontSize(6).fillColor('#999999')
      .text('Scan the code to open this job in the ERP.', m, doc.page.height - m - 8, { width: width - 2 * m, align: 'center', lineBreak: false });
    doc.fillColor('#111111');
  }
}
