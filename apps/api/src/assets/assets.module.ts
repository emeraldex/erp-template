import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AssetsController, PmController } from './assets.controller';
import { AssetsService } from './assets.service';
import { PmService } from './pm.service';
import { DowntimeService } from './downtime.service';
import { ReliabilityService } from './reliability.service';
import { AssetImportService } from './import.service';

@Module({
  imports: [AuthModule],
  controllers: [AssetsController, PmController],
  providers: [AssetsService, PmService, DowntimeService, ReliabilityService, AssetImportService],
  exports: [AssetsService, PmService, DowntimeService, ReliabilityService],
})
export class AssetsModule {}
