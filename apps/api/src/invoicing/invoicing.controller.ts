import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { InModule, Requires } from '../auth/roles.decorator';
import { InvoicingService } from './invoicing.service';
import { Branch, InvoiceStatus, InvoiceStream } from '../common/types';

@Controller('invoicing')
@InModule('invoicing')
@UseGuards(AuthGuard)
export class InvoicingController {
  constructor(private readonly svc: InvoicingService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get('streams')
  streams() {
    return this.svc.streams();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post()
  @Requires('invoices.create')
  create(
    @Body() dto: { stream: InvoiceStream; jobId?: string; customer?: string; period?: string; branch?: Branch; amountMYR?: number },
    @Req() req: any,
  ) {
    return this.svc.create(dto, { name: req.user.name, role: req.user.role });
  }

  @Patch(':id/transition')
  transition(
    @Param('id') id: string,
    @Body() body: { to: InvoiceStatus; fields?: Record<string, string> },
    @Req() req: any,
  ) {
    return this.svc.transition(id, body.to, body.fields ?? {}, { name: req.user.name, role: req.user.role });
  }
}
