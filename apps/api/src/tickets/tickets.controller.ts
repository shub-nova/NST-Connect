import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';
import { parseOrThrow } from '../common/zod';
import { Role } from '../generated/prisma/client';
import { TicketsService } from './tickets.service';

const createSchema = z.object({
  title: z.string().trim().min(3, 'Add a title (at least 3 characters)').max(200),
  description: z.string().trim().min(10, 'Please describe the issue in at least 10 characters').max(5000),
  subCategoryId: z.string().uuid(),
});

const reopenSchema = z.object({
  comment: z.string().trim().min(5, 'Tell us what is still wrong (at least 5 characters)').max(2000),
});

const feedbackSchema = z.object({
  rating: z.enum(['SATISFIED', 'OKAY', 'NOT_SATISFIED'], { message: 'Choose how it went' }),
  comment: z.string().trim().max(500, 'Keep your comment under 500 characters').optional(),
});

const listSchema = z.object({
  status: z.enum(['CREATED', 'ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REOPENED']).optional(),
  categoryId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

@Controller()
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get('categories')
  categories() {
    return this.tickets.listCategories();
  }

  @Post('tickets')
  @Roles(Role.STUDENT)
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.tickets.create(user.id, parseOrThrow(createSchema, body));
  }

  @Get('tickets')
  @Roles(Role.STUDENT)
  list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.tickets.listOwn(user.id, parseOrThrow(listSchema, query));
  }

  /** The student closes their own open ticket; it leaves the POC's queue. */
  @Post('tickets/:id/close')
  @HttpCode(200)
  @Roles(Role.STUDENT)
  close(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.closeOwn(user.id, id);
  }

  /** Share how a finished ticket went (Satisfied, Okay, Not satisfied, with an optional comment). */
  @Post('tickets/:id/feedback')
  @HttpCode(200)
  @Roles(Role.STUDENT)
  feedback(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tickets.giveFeedback(user.id, id, parseOrThrow(feedbackSchema, body));
  }

  @Post('tickets/:id/reopen')
  @HttpCode(200)
  @Roles(Role.STUDENT)
  reopen(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tickets.reopen(user.id, id, parseOrThrow(reopenSchema, body).comment);
  }

  @Get('tickets/:id')
  @Roles(Role.STUDENT)
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.getOwnDetail(user.id, id);
  }
}
