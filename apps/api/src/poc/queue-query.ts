import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client';

export type QueueView = 'open' | 'done';
export type QueueSort = 'time-left' | 'oldest' | 'newest';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 50;

/** The sort a view gets when the caller does not choose one (the order this queue always had). */
export const defaultSort = (view: QueueView): QueueSort => (view === 'open' ? 'oldest' : 'newest');

/**
 * Keyset ("cursor") paging: every ticket gets a sort key made of two numbers and its id, and a page
 * is "the next N after this key". Unlike page numbers, this stays correct while tickets are being
 * solved and raised, and it stays fast however long the queue is.
 *
 *   time-left (open only): critical first, then the soonest deadline, tickets with no deadline last
 *   oldest / newest:        by when the ticket was created (open) or finished (done)
 */
export function sortSpec(view: QueueView, sort: QueueSort) {
  if (view === 'open' && sort === 'time-left') {
    return {
      k1: Prisma.sql`(CASE WHEN t.critical THEN 0 ELSE 1 END)::float8`,
      k2: Prisma.sql`COALESCE(EXTRACT(EPOCH FROM t.tat_deadline), 1e15)::float8`,
      dir: Prisma.raw('ASC'),
      op: Prisma.raw('>'),
    };
  }
  const moment = view === 'open' ? Prisma.sql`t.created_at` : Prisma.sql`COALESCE(t.resolved_at, t.updated_at)`;
  const oldestFirst = sort === 'oldest';
  return {
    k1: Prisma.sql`EXTRACT(EPOCH FROM ${moment})::float8`,
    k2: Prisma.sql`0::float8`,
    dir: Prisma.raw(oldestFirst ? 'ASC' : 'DESC'),
    op: Prisma.raw(oldestFirst ? '>' : '<'),
  };
}

/** "In one of my category and level pairs", as SQL. */
export function scopeSql(pairs: { categoryId: string; level: number }[]): Prisma.Sql {
  return Prisma.sql`(${Prisma.join(
    pairs.map((p) => Prisma.sql`(t.category_id = ${p.categoryId}::uuid AND t.current_level = ${p.level})`),
    ' OR ',
  )})`;
}

export const statusSql = (view: QueueView): Prisma.Sql =>
  view === 'open' ? Prisma.sql`t.status NOT IN ('RESOLVED', 'CLOSED')` : Prisma.sql`t.status IN ('RESOLVED', 'CLOSED')`;

// ---- the cursor handed to the browser ---------------------------------------------------------

const cursorSchema = z.object({ k1: z.number().finite(), k2: z.number().finite(), id: z.string().uuid() });
export type QueueCursor = z.infer<typeof cursorSchema>;

export const encodeCursor = (c: QueueCursor): string => Buffer.from(JSON.stringify(c)).toString('base64url');

export function decodeCursor(raw: string): QueueCursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
  } catch {
    throw new BadRequestException('Invalid page cursor.');
  }
}
