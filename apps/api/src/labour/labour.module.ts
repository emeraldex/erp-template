import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StockModule } from '../stock/stock.module';
import { LabourController } from './labour.controller';
import { LabourService } from './labour.service';

@Module({ imports: [AuthModule, StockModule], controllers: [LabourController], providers: [LabourService], exports: [LabourService] })
export class LabourModule {}
