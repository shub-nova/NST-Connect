import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser, ROLES_KEY } from '../common/decorators';
import { Role } from '../generated/prisma/client';

/** Global guard: if an endpoint declares @Roles(...), the caller's role must be listed. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || !required.includes(user.role)) throw new ForbiddenException();
    return true;
  }
}
