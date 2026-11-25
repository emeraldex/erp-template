import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.service';
import { Requires } from '../auth/roles.decorator';
import { WorkflowEditorService } from './workflow-editor.service';
import { DictionaryService } from './dictionary.service';

type Req = { user: AuthUser };

/** Workflow editor — whoever holds workflow.edit (by default ADMIN and QUALITY in the aviation pack). */
@Controller('workflow')
@UseGuards(AuthGuard)
@Requires('workflow.edit')
export class WorkflowEditorController {
  constructor(private readonly svc: WorkflowEditorService, private readonly dictionaries: DictionaryService) {}

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

  /** Statuses, sites, locations, categories, priorities… Roles have their own endpoint below. */
  @Put('dictionary/:kind')
  dictionary(@Param('kind') kind: string, @Body() body: { version?: string; entries?: unknown }, @Req() req: Req) {
    if (kind === 'role') throw new ForbiddenException('Roles are changed through PUT /workflow/roles');
    return this.dictionaries.save(kind, body ?? {}, { name: req.user.name, role: req.user.role });
  }

  /** Roles and what each may do — administrators only, since it grants access. */
  @Put('roles')
  @Requires('org.admin')
  roles(@Body() body: { version?: string; entries?: unknown }, @Req() req: Req) {
    return this.dictionaries.save('role', body ?? {}, { name: req.user.name, role: req.user.role });
  }
}
