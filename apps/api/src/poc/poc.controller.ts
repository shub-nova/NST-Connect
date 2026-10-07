import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';
import { parseOrThrow } from '../common/zod';
import { Role } from '../generated/prisma/client';
import { MAX_BULK, PocService } from './poc.service';
import { MAX_PAGE_SIZE } from './queue-query';

const querySchema = z.object({
  view: z.enum(['open', 'done']).default('open'),
  sort: z.enum(['time-left', 'oldest', 'newest']).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: z.string().max(400).optional(),
});
const commentSchema = z.object({ body: z.string().trim().min(1, 'Write a reply').max(5000) });
const statusSchema = z.object({ status: z.literal('IN_PROGRESS') });
const closeSchema = z.object({
  outcome: z.enum(['SOLVED', 'CLOSED', 'ESCALATED'], { message: 'Choose how this ends' }),
  note: z.string().trim().min(5, 'Add a note (at least 5 characters)').max(2000),
});

const bulkSchema = z
  .object({
    ticketIds: z.array(z.string().uuid()).min(1, 'Select at least one ticket').max(MAX_BULK, `You can update at most ${MAX_BULK} tickets at once`),
    action: z.enum(['SOLVED', 'CLOSED', 'ESCALATED', 'REPLY'], { message: 'Choose an action' }),
    note: z.string().trim().max(5000),
  })
  // Finishing or escalating needs a proper note; a reply just needs some text.
  .superRefine((v, ctx) => {
    const min = v.action === 'REPLY' ? 1 : 5;
    if (v.note.length < min) ctx.addIssue({ code: 'custom', path: ['note'], message: v.action === 'REPLY' ? 'Write a reply' : 'Add a note (at least 5 characters)' });
  });

/**
 * POC-only area. Students get 403 from the global RolesGuard before this code runs, and
 * every query is scoped to the category and level the POC is assigned to.
 */
@Controller('poc')
@Roles(Role.POC)
export class PocController {
  constructor(private readonly poc: PocService) {}

  @Get('queue')
  queue(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.poc.queue(user.id, parseOrThrow(querySchema, query));
  }

  /** Solve, close, escalate or reply to many tickets at once. Declared before the :id routes. */
  @Post('tickets/bulk')
  @HttpCode(200)
  bulk(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.poc.bulk(user.id, parseOrThrow(bulkSchema, body));
  }

  @Get('tickets/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.poc.detail(user.id, id);
  }

  @Post('tickets/:id/comments')
  comment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.poc.comment(user.id, id, parseOrThrow(commentSchema, body).body);
  }

  @Post('tickets/:id/status')
  @HttpCode(200)
  status(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    parseOrThrow(statusSchema, body);
    return this.poc.setInProgress(user.id, id);
  }

  @Post('tickets/:id/close')
  @HttpCode(200)
  close(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const dto = parseOrThrow(closeSchema, body);
    return this.poc.close(user.id, id, dto.outcome, dto.note);
  }

  @Get('attachments/:id/download')
  download(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.poc.attachmentUrl(user.id, id);
  }
}
