import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionStore } from './session.store';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, SessionStore],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
