import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';
import { parseOrThrow } from '../common/zod';
import { Role } from '../generated/prisma/client';
import { NotesService } from './notes.service';

const sendSchema = z.object({
  body: z.string().trim().min(3, 'Write a note (at least 3 characters)').max(2000),
  categoryId: z.string().uuid().optional(),
  level: z.number().int().min(1).max(3).optional(),
  pocId: z.string().uuid().optional(),
  context: z.string().trim().max(200).optional(),
});

@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN)
  send(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.notes.send(user.id, parseOrThrow(sendSchema, body));
  }

  @Get('sent')
  @Roles(Role.SUPER_ADMIN)
  sent() {
    return this.notes.sent();
  }

  @Get('mine')
  @Roles(Role.POC)
  mine(@CurrentUser() user: AuthUser) {
    return this.notes.mine(user.id);
  }

  @Post(':id/seen')
  @Roles(Role.POC)
  @HttpCode(200)
  seen(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notes.markSeen(user.id, id);
  }
}
