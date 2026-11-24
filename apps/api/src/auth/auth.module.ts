import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionStore } from './session.store';
import { SsoConfigService } from './sso-config.service';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';

@Global()
@Module({
  controllers: [AuthController, SsoController],
  providers: [AuthService, AuthGuard, SessionStore, SsoConfigService, SsoService],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
