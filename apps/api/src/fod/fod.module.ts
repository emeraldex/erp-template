import { Module } from '@nestjs/common';
import { FodController } from './fod.controller';
import { FodService } from './fod.service';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [FodController], providers: [FodService] })
export class FodModule {}
