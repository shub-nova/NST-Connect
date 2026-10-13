import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';
import { parseOrThrow } from '../common/zod';
import { Role } from '../generated/prisma/client';
import { AttachmentsService } from './attachments.service';
import { viewQuerySchema } from './view-query';

const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(3).max(100),
  sizeBytes: z.number().int().positive(),
});

@Controller()
@Roles(Role.STUDENT)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post('tickets/:ticketId/attachments')
  requestUpload(
    @CurrentUser() user: AuthUser,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() body: unknown,
  ) {
    return this.attachments.requestUpload(user.id, ticketId, parseOrThrow(uploadSchema, body));
  }

  @Post('attachments/:id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.attachments.confirm(user.id, id);
  }

  @Get('attachments/:id/download')
  download(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: unknown) {
    return this.attachments.downloadUrl(user.id, id, parseOrThrow(viewQuerySchema, query).inline === '1');
  }
}
