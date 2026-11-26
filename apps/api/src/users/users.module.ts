import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { DirectoryController } from './directory.controller';

@Module({ controllers: [DirectoryController, UsersController], providers: [UsersService] })
export class UsersModule {}
