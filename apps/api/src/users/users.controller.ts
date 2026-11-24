import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { UsersService } from './users.service';

type Req = { user: AuthUser };
const actor = (r: Req) => ({ sub: r.user.sub, name: r.user.name, role: r.user.role });

@Controller('users')
@UseGuards(AuthGuard)
@Roles('ADMIN')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(@Body() body: Record<string, string>, @Req() req: Req) {
    return this.users.create(body ?? {}, actor(req));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Record<string, string>, @Req() req: Req) {
    return this.users.update(id, body ?? {}, actor(req));
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  reset(@Param('id') id: string, @Req() req: Req) {
    return this.users.resetPassword(id, actor(req));
  }

  @Post(':id/unlock')
  @HttpCode(200)
  unlock(@Param('id') id: string, @Req() req: Req) {
    return this.users.unlock(id, actor(req));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(@Param('id') id: string, @Req() req: Req) {
    return this.users.setActive(id, false, actor(req));
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@Param('id') id: string, @Req() req: Req) {
    return this.users.setActive(id, true, actor(req));
  }
}
