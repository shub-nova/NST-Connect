import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
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
});
const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});
const verifySchema = z.object({ token: z.string().min(10).max(2000) });

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
    await this.auth.register(dto.email, dto.name, dto.password);
    return { message: 'If this address is eligible, a verification email is on its way.' };
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
      path: '/auth',
    };
  }

  private setRefreshCookie(res: Response, token: string) {
    const days = this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_DAYS');
    res.cookie(REFRESH_COOKIE, token, { ...this.cookieOptions(), maxAge: days * 24 * 60 * 60 * 1000 });
  }
}
