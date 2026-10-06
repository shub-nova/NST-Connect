import { BadRequestException } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Validate untrusted input against a zod schema; throws a 400 with readable issues. */
export function parseOrThrow<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({
      message: 'Validation failed',
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}
