import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RegistersService } from './registers.service';
import { Rating } from '../common/types';

@Controller('registers/partners')
@UseGuards(AuthGuard)
export class RegistersController {
  constructor(private readonly svc: RegistersService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  @Roles('PURCHASING', 'PCE')
  apply(@Body() dto: { name: string; type: 'SUPPLIER' | 'SUBCONTRACTOR'; country: string; certifications: string[] }, @Req() req: any) {
    return this.svc.apply(dto, { name: req.user.name, role: req.user.role });
  }

  @Post(':id/evaluate')
  @Roles('PURCHASING', 'PCE', 'QUALITY')
  evaluate(@Param('id') id: string, @Body() b: { evaluationRef: string; siteAuditRef?: string }, @Req() req: any) {
    return this.svc.evaluate(id, b, { name: req.user.name, role: req.user.role });
  }

  @Post(':id/jtp-approve')
  @Roles('QUALITY')
  jtp(@Param('id') id: string, @Body() b: { minuteRef: string }, @Req() req: any) {
    return this.svc.jtpApprove(id, b, { name: req.user.name, role: req.user.role });
  }

  @Post(':id/register')
  @Roles('PURCHASING', 'PCE')
  register(@Param('id') id: string, @Body() b: { lists: string[] }, @Req() req: any) {
    return this.svc.register(id, b, { name: req.user.name, role: req.user.role });
  }

  @Post(':id/reassess')
  @Roles('PURCHASING', 'PCE', 'QUALITY')
  reassess(@Param('id') id: string, @Body() b: { rating: Rating; nonConformances: number; factorsEvaluated: number; monitoringRef: string }, @Req() req: any) {
    return this.svc.reassess(id, b, { name: req.user.name, role: req.user.role });
  }

  @Post(':id/car')
  @Roles('QUALITY')
  car(@Param('id') id: string, @Body() b: { ref: string; reason: string }, @Req() req: any) {
    return this.svc.issueCar(id, b, { name: req.user.name, role: req.user.role });
  }
}
