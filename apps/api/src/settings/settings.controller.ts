import { Body, Controller, Get, Put } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';
import { parseOrThrow } from '../common/zod';
import { Role } from '../generated/prisma/client';
import { SettingsService } from './settings.service';

const escalationSchema = z.object({ days: z.number({ message: 'Choose a number of days' }).int('Use a whole number of days') });

/** Settings only the Super Admin changes. */
@Controller('settings')
@Roles(Role.SUPER_ADMIN)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('escalation')
  escalation() {
    return this.settings.escalation();
  }

  @Put('escalation')
  setEscalation(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.settings.setEscalationDays(user.id, parseOrThrow(escalationSchema, body).days);
  }
}
