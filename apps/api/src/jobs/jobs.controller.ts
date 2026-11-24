import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { JobsService } from './jobs.service';
import { Branch, JobStatus, PriorityType, RepairRoute } from '../common/types';

@Controller('jobs')
@UseGuards(AuthGuard)
export class JobsController {
  constructor(private readonly svc: JobsService) {}

  /** ?archived=include to add archived jobs, ?archived=only for just those. */
  @Get()
  list(@Query('archived') archived?: string) {
    if (archived && !['exclude', 'include', 'only'].includes(archived)) {
      throw new BadRequestException('archived must be exclude, include or only');
    }
    return this.svc.list((archived ?? 'exclude') as 'exclude' | 'include' | 'only');
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post()
  @Roles('STORES')
  register(
    @Body() dto: { component: string; partNo: string; serialNo: string; category: 'MILITARY' | 'NAS'; originUnit: string; repairUnit: Branch },
    @Req() req: any,
  ) {
    return this.svc.register(dto, { name: req.user.name, role: req.user.role });
  }

  @Patch(':id/transition')
  transition(
    @Param('id') id: string,
    @Body() body: { to: JobStatus; fields?: Record<string, string> },
    @Req() req: any,
  ) {
    return this.svc.transition(id, body.to, body.fields ?? {}, { name: req.user.name, role: req.user.role });
  }

  // QP.56 AOG / ROA / Critical priority overlay (5.9) — Mgr PC / CsE (PCE) own the COL column
  @Post(':id/priority')
  @Roles('PCE', 'MM', 'STORES')
  raisePriority(
    @Param('id') id: string,
    @Body() dto: { type: PriorityType; quantity?: number; route: RepairRoute; suffixK?: boolean; colRef: string; edd?: string; remark?: string },
    @Req() req: any,
  ) {
    return this.svc.raisePriority(id, dto, { name: req.user.name, role: req.user.role });
  }

  @Patch(':id/priority')
  @Roles('PCE', 'MM', 'STORES')
  updatePriority(
    @Param('id') id: string,
    @Body() dto: { route?: RepairRoute; edd?: string; remark?: string },
    @Req() req: any,
  ) {
    return this.svc.updatePriority(id, dto, { name: req.user.name, role: req.user.role });
  }

  @Post(':id/priority/close')
  @Roles('PCE', 'MM')
  closePriority(
    @Param('id') id: string,
    @Body() dto: { reason: 'DELIVERED' | 'DOWNGRADED'; note?: string },
    @Req() req: any,
  ) {
    return this.svc.closePriority(id, dto, { name: req.user.name, role: req.user.role });
  }
}
