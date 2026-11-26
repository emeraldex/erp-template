import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { InModule, Requires } from '../auth/roles.decorator';
import { DemandsService } from './demands.service';
import { DemandStatus, Quotation } from '../common/types';

@Controller('demands')
@InModule('procurement')
@UseGuards(AuthGuard)
export class DemandsController {
  constructor(private readonly svc: DemandsService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post(':id/quotations')
  @Requires('procurement.quote')
  addQuotation(@Param('id') id: string, @Body() q: Quotation, @Req() req: any) {
    return this.svc.addQuotation(id, q, { name: req.user.name, role: req.user.role });
  }

  @Patch(':id/transition')
  transition(
    @Param('id') id: string,
    @Body() body: { to: DemandStatus; fields?: Record<string, string> },
    @Req() req: any,
  ) {
    return this.svc.transition(id, body.to, body.fields ?? {}, { name: req.user.name, role: req.user.role });
  }
}
