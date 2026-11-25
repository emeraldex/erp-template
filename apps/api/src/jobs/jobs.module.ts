import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { AuthModule } from '../auth/auth.module';
import { AssetsModule } from '../assets/assets.module';

@Module({ imports: [AuthModule, AssetsModule], controllers: [JobsController], providers: [JobsService] })
export class JobsModule {}
