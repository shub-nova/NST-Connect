import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthUser, IS_PUBLIC_KEY } from '../common/decorators';
import { Role } from '../generated/prisma/client';

interface AccessClaims {
  sub: string;
  role: Role;
  purpose: 'access';
}

/** Global guard: every endpoint needs a valid access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();

    try {
      const claims = await this.jwt.verifyAsync<AccessClaims>(header.slice(7));
      if (claims.purpose !== 'access') throw new Error('wrong token type');
      req.user = { id: claims.sub, role: claims.role };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
