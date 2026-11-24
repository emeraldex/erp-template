import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { FodService } from './fod.service';

@Controller('fod')
@UseGuards(AuthGuard)
export class FodController {
  constructor(private readonly svc: FodService) {}

  @Get('incidents')
  incidents() {
    return this.svc.incidents();
  }

  @Get('tools')
  tools() {
    return this.svc.tools();
  }

  @Get('training')
  training() {
    return this.svc.training();
  }

  @Post('incidents')
  report(@Body() dto: any, @Req() req: any) {
    return this.svc.report(dto, { name: req.user.name, role: req.user.role });
  }

  @Patch('incidents/:id')
  @Roles('QUALITY')
  update(@Param('id') id: string, @Body() b: { status: 'UNDER_REVIEW' | 'CLOSED'; rootCause?: string; correctiveAction?: string }, @Req() req: any) {
    return this.svc.updateIncident(id, b, { name: req.user.name, role: req.user.role });
  }

  @Patch('tools/:tag')
  @Roles('WORKSHOP', 'STORES', 'MIS', 'QUALITY')
  tool(@Param('tag') tag: string, @Body() b: { action: 'OUT' | 'IN' | 'MISSING'; holder?: string }, @Req() req: any) {
    return this.svc.toolAction(tag, b.action, b.holder, { name: req.user.name, role: req.user.role });
  }
}
