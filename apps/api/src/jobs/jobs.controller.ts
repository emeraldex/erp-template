import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ClientOpInterceptor } from '../common/client-ops';
import { AuthGuard } from '../auth/auth.guard';
import { InModule, Requires } from '../auth/roles.decorator';
import { JobsService } from './jobs.service';
import { RequestsService } from '../requests/requests.service';
import { Branch, JobStatus, PriorityType, RepairRoute } from '../common/types';

@Controller('jobs')
@UseGuards(AuthGuard)
export class JobsController {
  constructor(private readonly svc: JobsService, private readonly requests: RequestsService) {}

  /** ?archived=include to add archived jobs, ?archived=only for just those. */
  @Get()
  list(@Query('archived') archived?: string) {
    if (archived && !['exclude', 'include', 'only'].includes(archived)) {
      throw new BadRequestException('archived must be exclude, include or only');
    }
    return this.svc.list((archived ?? 'exclude') as 'exclude' | 'include' | 'only');
  }

  /** My work: assigned to me, and unassigned work at my site that my role can take. */
  @Get('mine')
  mine(@Req() req: any) {
    return this.svc.mine({ name: req.user.name, role: req.user.role, sub: req.user.sub, branch: req.user.branch });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post()
  @Requires('jobs.register')
  register(
    @Body() dto: { component?: string; partNo?: string; serialNo?: string; category: string; originUnit: string; repairUnit?: Branch; assetId?: string; jobType?: string },
    @Req() req: any,
  ) {
    return this.svc.register(dto, { name: req.user.name, role: req.user.role });
  }

  /** Who reported this through the request portal: contact, messages, rating. */
  @Get(':id/requests')
  requesters(@Param('id') id: string) {
    return this.requests.forJob(id);
  }

  /** Parts used on the job, with their cost. */
  @Get(':id/parts')
  parts(@Param('id') id: string) {
    return this.svc.parts(id);
  }

  /** Everything the phone needs for one job (and keeps for offline use). */
  @Get(':id/pack')
  pack(@Param('id') id: string, @Req() req: any) {
    return this.svc.pack(id, { name: req.user.name, role: req.user.role, sub: req.user.sub });
  }

  /** A note on the job's timeline. Safe to resend with the same X-Client-Op. */
  @Post(':id/notes')
  @UseInterceptors(ClientOpInterceptor)
  note(@Param('id') id: string, @Body() body: { text?: string }, @Req() req: any) {
    return this.svc.addNote(id, body?.text, { name: req.user.name, role: req.user.role, sub: req.user.sub });
  }

  /** Assign to a person, or `{ "userId": null }` to unassign. */
  @Patch(':id/assignee')
  @Requires('jobs.assign')
  assignee(@Param('id') id: string, @Body() body: { userId?: string | null }, @Req() req: any) {
    return this.svc.assign(id, body?.userId || null, { name: req.user.name, role: req.user.role, sub: req.user.sub });
  }

  /** Take an unassigned job whose next step your role owns. */
  @Post(':id/claim')
  @HttpCode(200)
  claim(@Param('id') id: string, @Req() req: any) {
    return this.svc.claim(id, { name: req.user.name, role: req.user.role, sub: req.user.sub });
  }

  @Patch(':id/checklist')
  checklist(
    @Param('id') id: string,
    @Body() body: { items?: { key: string; done?: boolean; note?: string }[]; add?: { label: string; required?: boolean }[]; at?: string },
    @Req() req: any,
  ) {
    return this.svc.updateChecklist(id, body ?? {}, { name: req.user.name, role: req.user.role });
  }

  @Patch(':id/transition')
  transition(
    @Param('id') id: string,
    @Body() body: { to: JobStatus; fields?: Record<string, string> },
    @Req() req: any,
  ) {
    return this.svc.transition(id, body.to, body.fields ?? {}, { name: req.user.name, role: req.user.role, sub: req.user.sub });
  }

  // QP.56 AOG / ROA / Critical priority overlay (5.9) — Mgr PC / CsE (PCE) own the COL column
  @Post(':id/priority')
  @InModule('priority')
  @Requires('priority.raise')
  raisePriority(
    @Param('id') id: string,
    @Body() dto: { type: PriorityType; quantity?: number; route: RepairRoute; suffixK?: boolean; colRef: string; edd?: string; remark?: string },
    @Req() req: any,
  ) {
    return this.svc.raisePriority(id, dto, { name: req.user.name, role: req.user.role });
  }

  @Patch(':id/priority')
  @InModule('priority')
  @Requires('priority.raise')
  updatePriority(
    @Param('id') id: string,
    @Body() dto: { route?: RepairRoute; edd?: string; remark?: string },
    @Req() req: any,
  ) {
    return this.svc.updatePriority(id, dto, { name: req.user.name, role: req.user.role });
  }

  @Post(':id/priority/close')
  @InModule('priority')
  @Requires('priority.close')
  closePriority(
    @Param('id') id: string,
    @Body() dto: { reason: 'DELIVERED' | 'DOWNGRADED'; note?: string },
    @Req() req: any,
  ) {
    return this.svc.closePriority(id, dto, { name: req.user.name, role: req.user.role });
  }
}
