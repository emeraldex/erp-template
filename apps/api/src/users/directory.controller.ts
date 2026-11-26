import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { UsersService } from './users.service';

/** Who works here — for picking a person (e.g. to assign work). Any signed-in user; no e-mail addresses. */
@Controller('users/directory')
@UseGuards(AuthGuard)
export class DirectoryController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.directory();
  }
}
