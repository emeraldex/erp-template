import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({ imports: [AssetsModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
