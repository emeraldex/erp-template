import { Controller, Get, Param, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { InModule, Requires } from '../auth/roles.decorator';
import { DocumentsService, InvoiceDocument } from './documents.service';


@Controller('invoicing')
@InModule('invoicing')
@UseGuards(AuthGuard)
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  /**
   * GET /invoicing/:id/documents/{tax-invoice|covering-letter|delivery-note|pack}[?ctc=1]
   * `ctc=1` stamps every page "Certified True Copy" with the recorded CTC reference.
   */
  @Get(':id/documents/:kind')
  @Requires('invoices.documents')
  async document(
    @Param('id') id: string,
    @Param('kind') kind: InvoiceDocument,
    @Query('ctc') ctc: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { filename, pdf } = await this.docs.invoiceDocument(id, kind, { ctc: ctc === '1' || ctc === 'true' });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(pdf);
  }
}
