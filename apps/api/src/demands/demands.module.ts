import { Module } from '@nestjs/common';
import { DemandsController } from './demands.controller';
import { DemandsService } from './demands.service';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [DemandsController], providers: [DemandsService] })
export class DemandsModule {}
