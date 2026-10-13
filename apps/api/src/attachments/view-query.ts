import { z } from 'zod';

/** `?inline=1` on a file link asks to view the file in the page instead of downloading it. */
export const viewQuerySchema = z.object({ inline: z.enum(['1']).optional() });
