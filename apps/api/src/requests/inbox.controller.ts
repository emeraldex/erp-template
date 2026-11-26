import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.service';
import { InModule, Requires } from '../auth/roles.decorator';
import { RequestsInboxService } from './inbox.service';
import { RequestsService } from './requests.service';

type Req = { user: AuthUser };
const who = (r: Req) => ({ name: r.user.name, role: r.user.role });

/** Triage of portal requests. Needs requests.manage. */
@Controller('requests')
@UseGuards(AuthGuard)
@InModule('requests')
@Requires('requests.manage')
export class RequestsInboxController {
  constructor(private readonly inbox: RequestsInboxService, private readonly requests: RequestsService) {}

  @Get()
  list(@Query('status') status?: string, @Query('q') q?: string) {
    return this.inbox.list({ status, q });
  }

  /** Staff log a request for a caller: the same fields as the public form. */
  @Post()
  log(@Body() body: Record<string, unknown>, @Req() req: Req) {
    return this.inbox.logForCaller(body ?? {}, who(req));
  }

  /** Remind the help desk about requests waiting too long (also runs on a timer). */
  @Post('remind')
  @HttpCode(200)
  @Requires('org.admin')
  async remind() {
    return { reminded: await this.requests.remindStale() };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.inbox.get(id);
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(@Param('id') id: string, @Body() body: { assetId?: string; category?: string; site?: string; jobType?: string; component?: string }, @Req() req: Req) {
    return this.inbox.accept(id, body ?? {}, who(req));
  }

  @Post(':id/merge')
  @HttpCode(200)
  merge(@Param('id') id: string, @Body() body: { jobId?: string }, @Req() req: Req) {
    return this.inbox.merge(id, body ?? {}, who(req));
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(@Param('id') id: string, @Body() body: { reason?: string; spam?: boolean }, @Req() req: Req) {
    return this.inbox.decline(id, body ?? {}, who(req));
  }

  @Post(':id/messages')
  @HttpCode(200)
  message(@Param('id') id: string, @Body() body: { body?: string }, @Req() req: Req) {
    return this.inbox.message(id, body?.body, who(req));
  }

  /** Blank the requester's name, email and phone (a personal-data request). */
  @Post(':id/erase')
  @HttpCode(200)
  erase(@Param('id') id: string, @Req() req: Req) {
    return this.inbox.erase(id, who(req));
  }
}
