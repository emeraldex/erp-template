import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { InModule, Requires } from '../auth/roles.decorator';
import { RegistersService } from './registers.service';
import { Rating } from '../common/types';

@Controller('registers/partners')
@InModule('registers')
@UseGuards(AuthGuard)
export class RegistersController {
  constructor(private readonly svc: RegistersService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  @Requires('registers.propose')
  apply(@Body() dto: { name: string; type: 'SUPPLIER' | 'SUBCONTRACTOR'; country: string; certifications: string[]; currency?: string }, @Req() req: any) {
    return this.svc.apply(dto, { name: req.user.name, role: req.user.role });
  }

  /** `{ currency }` — the currency they usually quote in (empty to clear). */
  @Patch(':id/currency')
  @Requires('registers.propose', 'procurement.quote')
  setCurrency(@Param('id') id: string, @Body() body: { currency?: string }, @Req() req: any) {
    return this.svc.setCurrency(id, body?.currency, { name: req.user.name, role: req.user.role });
  }

  @Post(':id/evaluate')
  @Requires('registers.evaluate')
  evaluate(@Param('id') id: string, @Body() b: { evaluationRef: string; siteAuditRef?: string }, @Req() req: any) {
    return this.svc.evaluate(id, b, { name: req.user.name, role: req.user.role });
  }

  @Post(':id/jtp-approve')
  @Requires('registers.approve')
  jtp(@Param('id') id: string, @Body() b: { minuteRef: string }, @Req() req: any) {
    return this.svc.jtpApprove(id, b, { name: req.user.name, role: req.user.role });
  }

  @Post(':id/register')
  @Requires('registers.propose')
  register(@Param('id') id: string, @Body() b: { lists: string[] }, @Req() req: any) {
    return this.svc.register(id, b, { name: req.user.name, role: req.user.role });
  }

  @Post(':id/reassess')
  @Requires('registers.evaluate')
  reassess(@Param('id') id: string, @Body() b: { rating: Rating; nonConformances: number; factorsEvaluated: number; monitoringRef: string }, @Req() req: any) {
    return this.svc.reassess(id, b, { name: req.user.name, role: req.user.role });
  }

  @Post(':id/car')
  @Requires('registers.approve')
  car(@Param('id') id: string, @Body() b: { ref: string; reason: string }, @Req() req: any) {
    return this.svc.issueCar(id, b, { name: req.user.name, role: req.user.role });
  }
}
