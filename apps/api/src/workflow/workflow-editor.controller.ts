import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { WorkflowEditorService } from './workflow-editor.service';

type Req = { user: AuthUser };

/** Workflow editor — ADMIN and QUALITY (the quality department owns the procedures). */
@Controller('workflow')
@UseGuards(AuthGuard)
@Roles('ADMIN', 'QUALITY')
export class WorkflowEditorController {
  constructor(private readonly svc: WorkflowEditorService) {}

  @Get()
  snapshot() {
    return this.svc.snapshot();
  }

  @Get('history')
  history(@Query('limit') limit?: string) {
    return this.svc.history(Number(limit) || 50);
  }

  @Post('transitions/:kind/preview')
  @HttpCode(200)
  preview(@Param('kind') kind: string, @Body() body: { transitions?: unknown }) {
    return this.svc.preview(kind, body?.transitions);
  }

  @Put('transitions/:kind')
  transitions(@Param('kind') kind: string, @Body() body: { version?: string; transitions?: unknown }, @Req() req: Req) {
    return this.svc.saveTransitions(kind, body ?? {}, { name: req.user.name, role: req.user.role });
  }

  @Put('sla')
  sla(@Body() body: { version?: string; rules?: unknown }, @Req() req: Req) {
    return this.svc.saveSla(body ?? {}, { name: req.user.name, role: req.user.role });
  }

  @Put('streams/:id')
  stream(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: Req) {
    return this.svc.saveStream(id, body ?? {}, { name: req.user.name, role: req.user.role });
  }
}
