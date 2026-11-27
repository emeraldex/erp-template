import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.service';
import { InModule, Requires } from '../auth/roles.decorator';
import { ClientOpInterceptor } from '../common/client-ops';
import { LabourService } from './labour.service';

type Req = { user: AuthUser };
const who = (r: Req) => ({ sub: r.user.sub, name: r.user.name, role: r.user.role });

/** Time on work orders, hourly rates and what work costs. */
@Controller()
@UseGuards(AuthGuard)
export class LabourController {
  constructor(private readonly labour: LabourService) {}

  @Get('jobs/:id/time')
  @InModule('labour')
  list(@Param('id') id: string, @Req() req: Req) {
    return this.labour.list(id, who(req));
  }

  /** `{ minutes, workDate?, note?, userId? }`. Safe to resend with the same X-Client-Op (phones offline). */
  @Post('jobs/:id/time')
  @InModule('labour')
  @Requires('labour.log', 'labour.manage')
  @UseInterceptors(ClientOpInterceptor)
  log(@Param('id') id: string, @Body() body: { minutes?: number; workDate?: string; note?: string; userId?: string }, @Req() req: Req) {
    return this.labour.log(id, body ?? {}, who(req));
  }

  @Patch('time/:id')
  @InModule('labour')
  @Requires('labour.log', 'labour.manage')
  update(@Param('id') id: string, @Body() body: { minutes?: number; workDate?: string; note?: string }, @Req() req: Req) {
    return this.labour.update(id, body ?? {}, who(req));
  }

  @Delete('time/:id')
  @HttpCode(204)
  @InModule('labour')
  @Requires('labour.log', 'labour.manage')
  async remove(@Param('id') id: string, @Req() req: Req) {
    await this.labour.remove(id, who(req));
  }

  /** Parts, purchases, vendor repairs and labour; labour cost only for people who manage labour. */
  @Get('jobs/:id/cost')
  cost(@Param('id') id: string, @Req() req: Req) {
    return this.labour.jobCost(id, who(req));
  }

  @Get('labour/rates')
  @InModule('labour')
  @Requires('labour.manage')
  rates() {
    return this.labour.rates();
  }

  /** `{ defaultRate, roleRates: { ROLE: rate } }` — cost per hour. */
  @Put('labour/rates')
  @InModule('labour')
  @Requires('labour.manage')
  setRates(@Body() body: { defaultRate?: number | null; roleRates?: Record<string, number> }, @Req() req: Req) {
    return this.labour.setRates(body ?? {}, who(req));
  }

  /** A person's own rate (`null` = use their role's). */
  @Put('labour/people/:id/rate')
  @InModule('labour')
  @Requires('labour.manage')
  setPersonRate(@Param('id') id: string, @Body() body: { hourlyRate?: number | null }) {
    return this.labour.setPersonRate(id, body?.hourlyRate);
  }
}
