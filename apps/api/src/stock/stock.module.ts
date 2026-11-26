import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CountsService } from './counts.service';
import { StockImportService } from './import.service';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';

@Module({
  imports: [AuthModule],
  controllers: [StockController],
  providers: [StockService, CountsService, StockImportService],
  exports: [StockService],
})
export class StockModule {}
