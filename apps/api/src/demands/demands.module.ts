import { Module } from '@nestjs/common';
import { DemandsController } from './demands.controller';
import { DemandsService } from './demands.service';
import { AuthModule } from '../auth/auth.module';
import { StockModule } from '../stock/stock.module';

@Module({ imports: [AuthModule, StockModule], controllers: [DemandsController], providers: [DemandsService] })
export class DemandsModule {}
