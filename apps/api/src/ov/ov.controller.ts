import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { InModule } from '../auth/roles.decorator';
import { OvService } from './ov.service';
import { OvStatus } from '../common/types';

@Controller('ov')
@InModule('vendorRepair')
@UseGuards(AuthGuard)
export class OvController {
  constructor(private readonly svc: OvService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Patch(':id/transition')
  transition(
    @Param('id') id: string,
    @Body() body: { to: OvStatus; fields?: Record<string, string> },
    @Req() req: any,
  ) {
    return this.svc.transition(id, body.to, body.fields ?? {}, { name: req.user.name, role: req.user.role });
  }
}
