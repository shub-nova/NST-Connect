import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';
import { parseOrThrow } from '../common/zod';
import { Role } from '../generated/prisma/client';
import { AnalyticsService } from './analytics.service';
import { resolveRange } from './range';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must look like 2026-10-31').optional();
const rangeSchema = z.object({ from: day, to: day });
const adminSchema = rangeSchema.extend({
  categoryId: z.string().uuid().optional(),
  pocId: z.string().uuid().optional(),
  level: z.coerce.number().int().min(1).max(3).optional(),
});

/** Staff-only. Students are rejected by RolesGuard before any of this runs. */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('access')
  @Roles(Role.POC, Role.SUPER_ADMIN)
  access(@CurrentUser() user: AuthUser) {
    return this.analytics.access(user.id, user.role);
  }

  @Get('me')
  @Roles(Role.POC)
  me(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    const r = parseOrThrow(rangeSchema, q);
    return this.analytics.me(user.id, resolveRange(r.from, r.to));
  }

  @Get('team')
  @Roles(Role.POC)
  team(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    const r = parseOrThrow(rangeSchema, q);
    return this.analytics.team(user.id, resolveRange(r.from, r.to));
  }

  @Get('overall')
  @Roles(Role.POC)
  overall(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    const r = parseOrThrow(rangeSchema, q);
    return this.analytics.overall(user.id, resolveRange(r.from, r.to));
  }

  @Get('admin')
  @Roles(Role.SUPER_ADMIN)
  admin(@Query() q: unknown) {
    const r = parseOrThrow(adminSchema, q);
    return this.analytics.admin(resolveRange(r.from, r.to), r);
  }

  @Get('admin/categories')
  @Roles(Role.SUPER_ADMIN)
  categories() {
    return this.analytics.categories();
  }
}
