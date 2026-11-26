import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { AuthModule } from '../auth/auth.module';
import { AssetsModule } from '../assets/assets.module';
import { StockModule } from '../stock/stock.module';

@Module({ imports: [AuthModule, AssetsModule, StockModule], controllers: [JobsController], providers: [JobsService] })
export class JobsModule {}
