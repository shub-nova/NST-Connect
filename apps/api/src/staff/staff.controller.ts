import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';
import { parseOrThrow } from '../common/zod';
import { Role } from '../generated/prisma/client';
import { StaffService } from './staff.service';

const addSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(80),
  email: z.string().trim().email('Enter a valid email address'),
  categoryId: z.string().uuid(),
  level: z.number().int().min(1).max(3),
  managerAssignmentId: z.string().uuid().optional(),
});
const updateSchema = z.object({ name: z.string().trim().min(2).max(80).optional(), managerAssignmentId: z.string().uuid().optional() });
const leaveSchema = z
  .object({ onLeave: z.boolean(), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must look like 2026-10-31').optional() })
  // Going on leave always needs a return date, so nobody is left out of rotation by accident.
  .refine((v) => !v.onLeave || !!v.until, { message: 'Choose when you will be back', path: ['until'] });
const teamSchema = z.object({ categoryId: z.string().uuid().optional() });

/**
 * Team management. The role check here only keeps students out; WHO a POC may manage is decided in
 * StaffService from the reporting chain (L1 gets 403, anything outside the caller's reach is a 404).
 */
@Controller('staff')
@Roles(Role.POC, Role.SUPER_ADMIN)
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('team')
  team(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    return this.staff.team(user, parseOrThrow(teamSchema, q).categoryId);
  }

  @Get('options')
  options(@CurrentUser() user: AuthUser) {
    return this.staff.options(user);
  }

  @Get('audit')
  audit(@CurrentUser() user: AuthUser) {
    return this.staff.audit(user);
  }

  /** Any POC (including L1) can put themselves on leave. */
  @Put('me/leave')
  @Roles(Role.POC)
  myLeave(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.staff.setMyLeave(user.id, parseOrThrow(leaveSchema, body));
  }

  @Post()
  add(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.staff.add(user, parseOrThrow(addSchema, body));
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.staff.update(user, id, parseOrThrow(updateSchema, body));
  }

  @Post(':id/leave')
  @HttpCode(200)
  leave(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.staff.setLeave(user, id, parseOrThrow(leaveSchema, body));
  }

  @Post(':id/remove')
  @HttpCode(200)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.remove(user, id);
  }

  @Post(':id/resend-invite')
  @HttpCode(200)
  resend(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.resendInvite(user, id);
  }
}
