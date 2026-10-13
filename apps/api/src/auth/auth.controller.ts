import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Public } from '../common/decorators';
import type { AuthUser } from '../common/decorators';
import { parseOrThrow } from '../common/zod';
import { AuthService } from './auth.service';

const REFRESH_COOKIE = 'refresh_token';

const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(2).max(100),
  password: z.string().min(10, 'Use at least 10 characters').max(128),
  /** The token from a staff invitation link: it ties the sign-up to the address that was invited. */
  invite: z.string().min(10).max(2000).optional(),
});
const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});
const verifySchema = z.object({ token: z.string().min(10).max(2000) });
const inviteQuerySchema = z.object({ token: z.string().min(10).max(2000) });
const forgotSchema = z.object({ email: z.string().trim().email().max(254) });
const resetSchema = z.object({
  token: z.string().min(10).max(2000),
  password: z.string().min(10, 'Use at least 10 characters').max(128),
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  @HttpCode(202)
  async register(@Body() body: unknown) {
    const dto = parseOrThrow(registerSchema, body);
    const { verified } = await this.auth.register(dto.email, dto.name, dto.password, dto.invite);
    // `verified` is only ever true for a valid invitation (a secret link): the address is already proven, so no email follows.
    return { message: verified ? 'Your account is ready. You can log in now.' : 'If this address is eligible, a verification email is on its way.', verified };
  }

  /** Used by the sign-up page to show (and lock) the address a staff invitation was sent to. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('invite')
  invite(@Query() query: unknown) {
    return this.auth.inviteDetails(parseOrThrow(inviteQuerySchema, query).token);
  }

  @Public()
  @Post('verify')
  @HttpCode(200)
  async verify(@Body() body: unknown) {
    const dto = parseOrThrow(verifySchema, body);
    await this.auth.verifyEmail(dto.token);
    return { message: 'Email verified. You can now log in.' };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(202)
  async forgotPassword(@Body() body: unknown) {
    const dto = parseOrThrow(forgotSchema, body);
    await this.auth.forgotPassword(dto.email);
    return { message: 'If an account exists for that address, a reset link is on its way.' };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() body: unknown) {
    const dto = parseOrThrow(resetSchema, body);
    await this.auth.resetPassword(dto.token, dto.password);
    return { message: 'Your password has been changed. Please log in.' };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const dto = parseOrThrow(loginSchema, body);
    const result = await this.auth.login(dto.email, dto.password);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('NODE_ENV') === 'production',
      path: this.config.get<string>('COOKIE_PATH') ?? '/auth',
    };
  }

  private setRefreshCookie(res: Response, token: string) {
    const days = this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_DAYS');
    res.cookie(REFRESH_COOKIE, token, { ...this.cookieOptions(), maxAge: days * 24 * 60 * 60 * 1000 });
  }
}
