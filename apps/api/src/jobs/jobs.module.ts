import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { AuthModule } from '../auth/auth.module';
import { AssetsModule } from '../assets/assets.module';
import { StockModule } from '../stock/stock.module';
import { RequestsModule } from '../requests/requests.module';

@Module({ imports: [AuthModule, AssetsModule, StockModule, RequestsModule], controllers: [JobsController], providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
