import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AssetsController, PmController } from './assets.controller';
import { AssetsService } from './assets.service';
import { PmService } from './pm.service';

@Module({
  imports: [AuthModule],
  controllers: [AssetsController, PmController],
  providers: [AssetsService, PmService],
  exports: [AssetsService, PmService],
})
export class AssetsModule {}
