import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { CookieOptions, Request, Response } from 'express';
import { authConfig } from './auth.config';
import { AllowPendingPassword } from './auth.decorators';
import { AuthGuard } from './auth.guard';
import { AuthService, AuthUser, profile } from './auth.service';
import { StoreService } from '../common/store.service';

class LoginDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(1) @MaxLength(256) password: string;
  /** Scripts and integrations: also return the token in the body. Browsers use the cookie. */
  @IsOptional() @IsBoolean() tokenInBody?: boolean;
}

class ChangePasswordDto {
  @IsString() @MaxLength(256) currentPassword: string;
  @IsString() @MaxLength(256) newPassword: string;
}

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: authConfig.cookieSecure,
  sameSite: 'strict',
  path: '/',
});

type AuthedRequest = Request & { user: AuthUser };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly store: StoreService) {}

  /** The profile plus what this person may do, so the screen shows only their actions. */
  private withCapabilities(user: AuthUser) {
    return { ...profile(user), capabilities: this.store.capabilitiesOf(user.role) };
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: authConfig.loginRateLimit, ttl: 60_000 } })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token, user, expiresAt } = await this.auth.login(dto.email, dto.password, {
      ip: req.ip, userAgent: req.headers['user-agent'],
    });
    res.cookie(authConfig.cookieName, token, { ...cookieOptions(), expires: expiresAt });
    return { user: this.withCapabilities(user), expiresAt, ...(dto.tokenInBody ? { token } : {}) };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @AllowPendingPassword()
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.user.sid);
    res.clearCookie(authConfig.cookieName, cookieOptions());
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @AllowPendingPassword()
  me(@Req() req: AuthedRequest) {
    return { user: this.withCapabilities(req.user) };
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @AllowPendingPassword()
  @Throttle({ default: { limit: authConfig.loginRateLimit, ttl: 60_000 } })
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: AuthedRequest) {
    const user = await this.auth.changePassword(req.user, dto.currentPassword, dto.newPassword);
    return { user: this.withCapabilities(user) };
  }
}
