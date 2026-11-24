import { Module } from '@nestjs/common';
import { OvController } from './ov.controller';
import { OvService } from './ov.service';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [OvController], providers: [OvService] })
export class OvModule {}
