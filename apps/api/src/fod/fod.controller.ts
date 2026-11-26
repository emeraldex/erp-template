import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { InModule, Requires } from '../auth/roles.decorator';
import { FodService } from './fod.service';

@Controller('fod')
@UseGuards(AuthGuard)
export class FodController {
  constructor(private readonly svc: FodService) {}

  @Get('incidents')
  @InModule('incidents')
  incidents() {
    return this.svc.incidents();
  }

  @Get('tools')
  @InModule('tools')
  tools() {
    return this.svc.tools();
  }

  @Get('training')
  @InModule('training')
  training() {
    return this.svc.training();
  }

  @Post('incidents')
  @InModule('incidents')
  report(@Body() dto: any, @Req() req: any) {
    return this.svc.report(dto, { name: req.user.name, role: req.user.role });
  }

  @Patch('incidents/:id')
  @InModule('incidents')
  @Requires('incidents.manage')
  update(@Param('id') id: string, @Body() b: { status: 'UNDER_REVIEW' | 'CLOSED'; rootCause?: string; correctiveAction?: string }, @Req() req: any) {
    return this.svc.updateIncident(id, b, { name: req.user.name, role: req.user.role });
  }

  @Patch('tools/:tag')
  @InModule('tools')
  @Requires('tools.handle')
  tool(@Param('tag') tag: string, @Body() b: { action: 'OUT' | 'IN' | 'MISSING'; holder?: string }, @Req() req: any) {
    return this.svc.toolAction(tag, b.action, b.holder, { name: req.user.name, role: req.user.role });
  }
}
