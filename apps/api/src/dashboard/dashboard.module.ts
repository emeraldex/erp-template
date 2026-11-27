import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AuthModule } from '../auth/auth.module';
import { AssetsModule } from '../assets/assets.module';

@Module({ imports: [AuthModule, AssetsModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
