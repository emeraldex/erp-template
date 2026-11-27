import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { StoreService } from '../common/store.service';
import type { Invoice, Job } from '../common/types';
import type { InvoiceStreamDef } from '../common/workflow-config';
import { SettingsService } from '../settings/settings.service';
import { Doc, fields, finish, heading, letterhead, MARGIN, Marks, myr, newDoc, pdfText, rule, signature, table } from './pdf';
import { amountInWords } from './words';

export const INVOICE_DOCUMENTS = ['tax-invoice', 'covering-letter', 'delivery-note', 'pack'] as const;
export type InvoiceDocument = (typeof INVOICE_DOCUMENTS)[number];

interface Ctx {
  inv: Invoice;
  job: Job | null;
  stream: InvoiceStreamDef | undefined;
}

const today = () => new Date().toISOString().slice(0, 10);

/** FR-13 — billing documents generated from the invoice, its job and the stream's document set. */
@Injectable()
export class DocumentsService {
  constructor(private readonly store: StoreService, private readonly settings: SettingsService) {}

  async invoiceDocument(id: string, kind: InvoiceDocument, opts: { ctc?: boolean } = {}): Promise<{ filename: string; pdf: Buffer }> {
    if (!INVOICE_DOCUMENTS.includes(kind)) throw new BadRequestException(`Unknown document "${kind}"`);
    const inv = await this.store.invoice(id);
    if (!inv) throw new NotFoundException(`Invoice ${id} not found`);
    const job = inv.jobId ? await this.store.job(inv.jobId) : null;
    if (kind === 'delivery-note' && !job) throw new BadRequestException('A delivery note needs an invoice linked to a job');
    if (opts.ctc && !inv.ctcRef) throw new BadRequestException('No Certified True Copy reference recorded on this invoice yet');

    const ctx: Ctx = { inv, job, stream: this.store.invoiceStreams.find((s) => s.id === inv.stream) };
    const marks: Marks = {
      watermark: this.store.status('INVOICE', inv.status)?.draftDocuments && kind !== 'delivery-note' ? 'DRAFT' : undefined,
      ctc: opts.ctc ? `Ref ${inv.ctcRef}${inv.customerSignRef ? `  ·  Signed ${inv.customerSignRef}` : ''}` : undefined,
    };
    const ref = inv.f311Ref ?? inv.id;
    const { doc, done } = newDoc(`${kind} ${ref}`);

    const pages: ((d: Doc) => void)[] =
      kind === 'tax-invoice' ? [(d) => this.taxInvoice(d, ctx)] :
      kind === 'covering-letter' ? [(d) => this.coveringLetter(d, ctx)] :
      kind === 'delivery-note' ? [(d) => this.deliveryNote(d, ctx)] :
      [
        (d) => this.coveringLetter(d, ctx),
        (d) => this.taxInvoice(d, ctx),
        ...(job ? [(d: Doc) => this.deliveryNote(d, ctx)] : []),
        (d) => this.checklist(d, ctx),
      ];
    pages.forEach((draw, i) => {
      if (i > 0) doc.addPage();
      draw(doc);
    });
    finish(doc, `${pdfText(ctx.stream?.label ?? inv.stream)} · ${ref}`, marks);
    doc.end();
    const suffix = opts.ctc ? '-ctc' : '';
    return { filename: `${ref}-${kind}${suffix}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_'), pdf: await done };
  }

  /** Aviation organisations print their procedure's form numbers; everyone else gets plain words. */
  private get aviation(): boolean {
    return this.store.packId() === 'aviation';
  }

  /** "Job (PS no.)" for aviation; the organisation's own word ("Work order", "Job card") otherwise. */
  private get jobLabel(): string {
    return this.aviation ? 'Job (PS no.)' : this.settings.terms.job;
  }

  /** When the tax invoice was raised: the record carrying its number. */
  private taxInvoiceDate(inv: Ctx['inv']): string {
    if (!inv.f311Ref) return today();
    const rec = inv.records.find((r) => r.refNo === inv.f311Ref) ?? inv.records.find((r) => r.formNo === 'F311');
    return rec?.date ?? today();
  }

  private invoiceTitle(inv: Ctx['inv']): string {
    if (this.aviation) return 'TAX INVOICE';
    return inv.gstRate > 0 ? 'TAX INVOICE' : 'INVOICE';
  }

  private taxInvoice(doc: Doc, { inv, job, stream }: Ctx): void {
    const c = this.settings.company;
    letterhead(doc, c, this.settings.logo);
    heading(doc, this.invoiceTitle(inv));
    const top = doc.y;
    fields(doc, [
      ['Invoice no.', inv.f311Ref ?? `${inv.id} (not yet raised)`],
      ['Date', this.taxInvoiceDate(inv)],
      ['Billing stream', stream?.label ?? inv.stream],
      [this.aviation ? 'Branch' : this.settings.terms.site, inv.branch],
    ]);
    const leftEnd = doc.y;
    doc.y = top;
    fields(doc, [['Bill to', inv.customer], ['Period', inv.period], [this.jobLabel, inv.jobId]], 310, 75);
    doc.y = Math.max(leftEnd, doc.y) + 10;

    const description = job
      ? `Repair / service of ${job.component}\nPart no. ${job.partNo} · Serial no. ${job.serialNo}\nOrigin unit ${job.originUnit}${job.indentRef ? ` · Indent ${job.indentRef}` : ''}`
      : `${stream?.label ?? inv.stream}${inv.period ? ` — billing period ${inv.period}` : ''}`;
    const label = inv.taxLabel ?? 'GST';
    table(doc, [
      { header: 'Description', width: 300 },
      { header: 'Qty', width: 45, align: 'right' },
      { header: `Amount (${this.settings.currency.code})`, width: 150, align: 'right' },
    ], [[description, '1', myr(inv.amountMYR, this.settings.currency)]]);

    const totals: [string, string][] = [
      ['Subtotal', myr(inv.amountMYR, this.settings.currency)],
      [`${label} @ ${inv.gstRate}%`, myr(inv.gstMYR, this.settings.currency)],
      ['Total payable', myr(inv.totalMYR, this.settings.currency)],
    ];
    totals.forEach(([k, v], i) => {
      const y = doc.y;
      doc.font(i === 2 ? 'Helvetica-Bold' : 'Helvetica').fontSize(i === 2 ? 11 : 10)
        .text(pdfText(k), 300, y, { width: 140, align: 'right' })
        .text(pdfText(v), 445, y, { width: doc.page.width - MARGIN - 445, align: 'right' });
      doc.moveDown(0.3);
    });
    doc.x = MARGIN;
    doc.moveDown(0.6).font('Helvetica-Oblique').fontSize(9.5).text(pdfText(amountInWords(inv.totalMYR, this.settings.currency)), MARGIN);
    doc.font('Helvetica').moveDown(1.2);
    if (inv.ctcRef || inv.customerSignRef) {
      fields(doc, [['Customer signature', inv.customerSignRef], ['CTC reference', inv.ctcRef]]);
    }
    doc.moveDown(1);
    signature(doc, 'Authorised signature', c.signatoryName, c.signatoryTitle);
  }

  private coveringLetter(doc: Doc, { inv, job, stream }: Ctx): void {
    const c = this.settings.company;
    letterhead(doc, c, this.settings.logo);
    doc.fontSize(10).text(`Our ref: ${pdfText(inv.f311Ref ?? inv.id)}`).text(`Date: ${today()}`).moveDown();
    doc.text(pdfText(inv.customer)).moveDown();
    doc.font('Helvetica-Bold').text(pdfText(
      `SUBMISSION OF ${this.invoiceTitle(inv)} ${inv.f311Ref ?? inv.id} — ${(stream?.label ?? inv.stream).toUpperCase()}`,
    )).font('Helvetica').moveDown();
    doc.text('Dear Sir/Madam,').moveDown(0.6);
    const subject = job ? `the repair of ${job.component} (part no. ${job.partNo}, serial no. ${job.serialNo}, ${this.aviation ? 'PS no.' : this.settings.terms.jobNo} ${job.id})` : `the ${stream?.label ?? inv.stream}${inv.period ? ` for ${inv.period}` : ''}`;
    doc.text(pdfText(
      `We enclose our tax invoice for ${subject}, amounting to ${myr(inv.totalMYR, this.settings.currency)} inclusive of ` +
      `${inv.taxLabel ?? 'GST'} at ${inv.gstRate}%, together with the supporting documents listed below for your verification and further action.`,
    ), { align: 'justify' }).moveDown(0.8);
    doc.font('Helvetica-Bold').text('Enclosures').font('Helvetica').moveDown(0.3);
    [this.aviation ? 'Tax Invoice (F311)' : this.invoiceTitle(inv) === 'INVOICE' ? 'Invoice' : 'Tax invoice', ...(stream?.docSet ?? []).filter((d) => !/tax invoice/i.test(d))]
      .forEach((d, i) => doc.text(`${i + 1}.  ${pdfText(d)}`, MARGIN + 10));
    doc.moveDown(0.8).text('Kindly contact us should you require any clarification.', MARGIN)
      .moveDown(0.6).text('Thank you.', MARGIN).moveDown(0.5).text('Yours faithfully,', MARGIN);
    doc.moveDown(0.5);
    signature(doc, pdfText(c.name), c.signatoryName, c.signatoryTitle);
  }

  private deliveryNote(doc: Doc, { inv, job }: Ctx): void {
    const j = job!;
    letterhead(doc, this.settings.company, this.settings.logo);
    heading(doc, 'DELIVERY NOTE');
    const dn = j.records.find((r) => r.formNo === 'F218');
    fields(doc, [
      [this.aviation ? 'DN no. (F218)' : 'Delivery note no.', dn?.refNo ?? '(to be assigned)'],
      ['Date', dn?.date ?? today()],
      ['Deliver to', j.originUnit],
      [this.jobLabel, j.id],
      ['Invoice', inv.f311Ref ?? inv.id],
      ['Indent', j.indentRef],
    ]);
    doc.moveDown(0.6);
    table(doc, [
      { header: 'Item', width: 180 },
      { header: 'Part no.', width: 90 },
      { header: 'Serial no.', width: 90 },
      { header: 'Qty', width: 40, align: 'right' },
      { header: 'Condition', width: 95 },
    ], [[j.component, j.partNo, j.serialNo, '1', this.store.status('JOB', j.status)?.label ?? j.status]]);
    doc.moveDown(2);
    const y = doc.y;
    signature(doc, 'Released by (Stores)', undefined, undefined, MARGIN);
    doc.y = y;
    signature(doc, 'Received by (name, date, stamp)', undefined, undefined, 320);
  }

  private checklist(doc: Doc, { inv, job, stream }: Ctx): void {
    letterhead(doc, this.settings.company, this.settings.logo);
    heading(doc, 'DOCUMENT SET CHECKLIST');
    doc.fontSize(9.5).fillColor('#666666')
      .text(pdfText(`${stream?.label ?? inv.stream} — tick each item before the set leaves for ${inv.customer}.`))
      .fillColor('#111111').moveDown(0.6);
    const generated = (d: string) => /tax invoice|covering letter/i.test(d) || (!!job && /delivery note/i.test(d));
    table(doc, [
      { header: 'Document', width: 330 },
      { header: 'In this pack', width: 90, align: 'center' },
      { header: 'Checked', width: 75, align: 'center' },
    ], (stream?.docSet ?? []).map((d) => [d, generated(d) ? 'Yes' : 'Attach', '[   ]']));
    doc.moveDown(1);
    rule(doc);
    doc.moveDown(0.5);
    fields(doc, [['Correctness checked by', inv.correctnessBy], ['Status', inv.status]]);
  }
}
