import { Body, Controller, Get, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { currentTenant } from '../tenancy/tenant';
import { TenantRegistry } from '../tenancy/tenant-registry';
import { authConfig } from './auth.config';
import { AuthGuard } from './auth.guard';
import { AuthService, AuthUser } from './auth.service';
import { Roles } from './roles.decorator';
import { SsoConfig, SsoConfigService } from './sso-config.service';
import { SsoError, SsoService } from './sso.service';
import { configuredOrigins, isAllowedWebOrigin } from './web-origin';

const STATE_COOKIE = 'erp_sso';
const PATH = '/api/v1/auth/sso';

/** Single sign-on with any OpenID Connect provider (Microsoft Entra ID, Google, Okta, Keycloak…). */
@Controller('auth/sso')
export class SsoController {
  constructor(
    private readonly sso: SsoService,
    private readonly config: SsoConfigService,
    private readonly auth: AuthService,
    private readonly registry: TenantRegistry,
  ) {}

  /** The address the identity provider sends people back to — register exactly this there. */
  private callbackUrl(req: Request): string {
    return `${req.protocol}://${req.get('x-forwarded-host') && req.app.get('trust proxy') ? req.get('x-forwarded-host') : req.get('host')}${PATH}/callback`;
  }

  private webOrigin(req: Request): string {
    const ref = req.get('referer');
    const origin = ref ? new URL(ref).origin : undefined;
    if (origin && isAllowedWebOrigin(origin, this.registry, currentTenant())) return origin;
    return configuredOrigins()[0] ?? `${req.protocol}://${req.get('host')}`;
  }

  /** Public: what the sign-in page should offer. */
  @Get()
  info() {
    return this.config.getPublic().then((c) => ({ enabled: c.enabled, label: c.label, passwordLogin: !c.enabled || c.allowPasswordLogin }));
  }

  @Get('settings')
  @UseGuards(AuthGuard)
  @Roles('ADMIN')
  async settings(@Req() req: Request) {
    return { ...(await this.config.getPublic()), callbackUrl: this.callbackUrl(req) };
  }

  @Put('settings')
  @UseGuards(AuthGuard)
  @Roles('ADMIN')
  async save(@Body() body: Partial<SsoConfig> & { clientSecret?: string | null }, @Req() req: Request & { user: AuthUser }) {
    const saved = await this.config.save(body ?? {}, req.user.name, async (issuer) => { await this.sso.discover(issuer); });
    return { ...saved, callbackUrl: this.callbackUrl(req) };
  }

  @Get('start')
  @Throttle({ default: { limit: authConfig.loginRateLimit, ttl: 60_000 } })
  async start(@Req() req: Request, @Res() res: Response) {
    const web = this.webOrigin(req);
    try {
      const { url, state } = await this.sso.start(this.callbackUrl(req), currentTenant().id, web);
      const opts: CookieOptions = { httpOnly: true, secure: authConfig.cookieSecure, sameSite: 'lax', path: PATH, maxAge: 10 * 60_000 };
      res.cookie(STATE_COOKIE, this.sso.sealState(state), opts);
      res.redirect(302, url);
    } catch (err) {
      res.redirect(302, `${web}/login?sso_error=${err instanceof SsoError ? err.code : 'start_failed'}`);
    }
  }

  @Get('callback')
  async callback(@Query() q: { code?: string; state?: string; error?: string }, @Req() req: Request & { cookies?: Record<string, string> }, @Res() res: Response) {
    let web = configuredOrigins()[0] ?? '';
    res.clearCookie(STATE_COOKIE, { path: PATH });
    try {
      const state = this.sso.openState(req.cookies?.[STATE_COOKIE]);
      web = state.web;
      if (state.tid !== currentTenant().id) throw new SsoError('wrong_organisation', 'Sign-in started at another organisation');
      const { email } = await this.sso.finish(q, state, this.callbackUrl(req));
      const result = await this.auth.loginSso(email, { ip: req.ip, userAgent: req.headers['user-agent'] });
      if (!result) throw new SsoError('not_registered', `${email} has no account here — ask an administrator to add you`);
      res.cookie(authConfig.cookieName, result.token, {
        httpOnly: true, secure: authConfig.cookieSecure, sameSite: 'strict', path: '/', expires: result.expiresAt,
      });
      res.redirect(302, `${web}/login?sso=ok`);
    } catch (err) {
      const code = err instanceof SsoError ? err.code : 'failed';
      res.redirect(302, `${web}/login?sso_error=${code}`);
    }
  }
}
