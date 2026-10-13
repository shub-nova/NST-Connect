import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';
import { parseOrThrow } from '../common/zod';
import { Role } from '../generated/prisma/client';
import { CatalogService } from './catalog.service';

const nameSchema = z.string().trim().min(3, 'Use at least 3 characters').max(80, 'Keep it under 80 characters');
const topicSchema = z.string().trim().min(3, 'A topic needs at least 3 characters').max(120, 'Keep a topic under 120 characters');

const createCategorySchema = z.object({
  name: nameSchema,
  shortName: z.string().trim().min(2, 'The short name needs at least 2 characters').max(30, 'Keep the short name under 30 characters').optional(),
  // Blank lines are ignored later; any topic that is written must be as long as one added on its own.
  topics: z
    .array(z.string().trim().max(120, 'Keep a topic under 120 characters'))
    .max(40, 'Add at most 40 topics at once')
    .refine((items) => items.every((t) => t === '' || t.length >= 3), 'A topic needs at least 3 characters'),
});
const updateCategorySchema = z
  .object({ name: nameSchema.optional(), shortName: z.string().trim().min(2).max(30).optional() })
  .refine((v) => v.name !== undefined || v.shortName !== undefined, { message: 'Nothing to change' });
const topicBodySchema = z.object({ name: topicSchema });

/** Managing what students can pick. Super Admin only. */
@Controller('catalog')
@Roles(Role.SUPER_ADMIN)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list() {
    return this.catalog.list();
  }

  @Post('categories')
  createCategory(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.catalog.createCategory(user.id, parseOrThrow(createCategorySchema, body));
  }

  @Patch('categories/:id')
  updateCategory(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.catalog.updateCategory(user.id, id, parseOrThrow(updateCategorySchema, body));
  }

  @Post('categories/:id/remove')
  @HttpCode(200)
  removeCategory(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.removeCategory(user.id, id);
  }

  @Post('categories/:id/restore')
  @HttpCode(200)
  restoreCategory(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.restoreCategory(user.id, id);
  }

  @Post('categories/:id/topics')
  addTopic(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.catalog.addTopic(user.id, id, parseOrThrow(topicBodySchema, body).name);
  }

  @Patch('topics/:id')
  renameTopic(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.catalog.renameTopic(user.id, id, parseOrThrow(topicBodySchema, body).name);
  }

  @Post('topics/:id/remove')
  @HttpCode(200)
  removeTopic(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.removeTopic(user.id, id);
  }

  @Post('topics/:id/restore')
  @HttpCode(200)
  restoreTopic(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.restoreTopic(user.id, id);
  }
}
