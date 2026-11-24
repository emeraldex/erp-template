import { Module } from '@nestjs/common';
import { RegistersController } from './registers.controller';
import { RegistersService } from './registers.service';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [RegistersController], providers: [RegistersService] })
export class RegistersModule {}
