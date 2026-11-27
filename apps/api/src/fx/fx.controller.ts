import { Body, Controller, Delete, Get, Param, ParseIntPipe, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.service';
import { Requires } from '../auth/roles.decorator';
import { FxService } from './fx.service';

type Req = { user: AuthUser };

/** Exchange rates kept by finance. Everyone signed in can read them (forms show the conversion). */
@Controller('fx')
@UseGuards(AuthGuard)
export class FxController {
  constructor(private readonly fx: FxService) {}

  @Get('rates')
  list() {
    return this.fx.list();
  }

  /** `{ currency, effectiveFrom?, rate, confirm? }` — organisation-currency units for one unit of `currency`. */
  @Put('rates')
  @Requires('fx.manage')
  set(@Body() body: Record<string, unknown>, @Req() req: Req) {
    return this.fx.set(body ?? {}, { name: req.user.name, role: req.user.role });
  }

  @Delete('rates/:id')
  @Requires('fx.manage')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.fx.remove(id);
  }
}
