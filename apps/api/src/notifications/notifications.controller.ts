import { Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.service';
import { Requires } from '../auth/roles.decorator';
import { NotificationsService } from './notifications.service';

@Controller()
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get('notifications')
  mine(@Req() req: { user: AuthUser }) {
    return this.svc.mine(req.user.sub);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  readAll(@Req() req: { user: AuthUser }) {
    return this.svc.markAllRead(req.user.sub);
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  read(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.svc.markRead(req.user.sub, id);
  }

  /** Run the alert check now instead of waiting for the schedule. */
  @Post('alerts/run')
  @HttpCode(200)
  @Requires('org.admin')
  run() {
    return this.svc.runAlerts();
  }
}
