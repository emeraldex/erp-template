import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.service';
import { InModule, Requires } from '../auth/roles.decorator';
import { AssetInput, AssetsService } from './assets.service';
import { PmService, ScheduleInput } from './pm.service';

type Req = { user: AuthUser };
const who = (req: Req) => ({ name: req.user.name, role: req.user.role });

/** The asset register and meters. Anyone signed in may look; changing it needs assets.manage. */
@Controller('assets')
@UseGuards(AuthGuard)
@InModule('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  list(@Query('site') site?: string, @Query('type') type?: string, @Query('status') status?: string, @Query('parentId') parentId?: string, @Query('q') search?: string) {
    return this.assets.list({ site, type, status, parentId, search });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.assets.get(id);
  }

  @Post()
  @Requires('assets.manage')
  create(@Body() body: AssetInput, @Req() req: Req) {
    return this.assets.create(body ?? {}, who(req));
  }

  @Patch(':id')
  @Requires('assets.manage')
  update(@Param('id') id: string, @Body() body: AssetInput, @Req() req: Req) {
    return this.assets.update(id, body ?? {}, who(req));
  }

  @Post(':id/meters')
  @Requires('assets.manage')
  addMeter(@Param('id') id: string, @Body() body: { key: string; label: string; unit: string; value?: number }) {
    return this.assets.addMeter(id, body ?? ({} as never));
  }

  @Get(':id/meters/:key/readings')
  readings(@Param('id') id: string, @Param('key') key: string, @Query('limit') limit?: string) {
    return this.assets.readings(id, key, Number(limit) || 100);
  }

  @Post(':id/meters/:key/readings')
  @Requires('meters.record')
  record(@Param('id') id: string, @Param('key') key: string, @Body() body: { value?: number; reset?: boolean }, @Req() req: Req) {
    return this.assets.recordReading(id, key, body ?? {}, who(req));
  }
}

/** Preventive-maintenance schedules. */
@Controller('pm')
@UseGuards(AuthGuard)
@InModule('pm')
export class PmController {
  constructor(private readonly pm: PmService) {}

  /** ?due=1 for what is due or overdue now; ?assetId= for one asset. */
  @Get('schedules')
  list(@Query('assetId') assetId?: string, @Query('due') due?: string) {
    return this.pm.list({ assetId, due: due === '1' || due === 'true' });
  }

  @Get('forecast')
  forecast(@Query('days') days?: string) {
    return this.pm.forecast(Number(days) || 30);
  }

  @Get('schedules/:id')
  get(@Param('id') id: string) {
    return this.pm.get(id);
  }

  @Post('schedules')
  @Requires('assets.manage')
  create(@Body() body: ScheduleInput, @Req() req: Req) {
    return this.pm.create(body ?? {}, who(req));
  }

  @Patch('schedules/:id')
  @Requires('assets.manage')
  update(@Param('id') id: string, @Body() body: ScheduleInput) {
    return this.pm.update(id, body ?? {});
  }

  @Post('schedules/:id/skip')
  @HttpCode(200)
  @Requires('assets.manage')
  skip(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: Req) {
    return this.pm.skip(id, who(req), body?.reason);
  }

  /** Raise whatever has fallen due now, instead of waiting for the timer. */
  @Post('run')
  @HttpCode(200)
  @Requires('assets.manage')
  async run() {
    return { raised: await this.pm.generateDue() };
  }
}
