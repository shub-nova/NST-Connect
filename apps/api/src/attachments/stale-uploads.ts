import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';

/** An upload link works for 5 minutes, so a file still PENDING well after that was abandoned (closed tab, lost connection). */
export const PENDING_UPLOAD_TTL_MS = 15 * 60 * 1000;

/** The cut-off: PENDING files created before this are abandoned. */
export const staleBefore = (now = Date.now()) => new Date(now - PENDING_UPLOAD_TTL_MS);

/**
 * Removes uploads that were requested but never confirmed (and whatever reached storage), so abandoned attempts cannot
 * use up a ticket's attachment slots or leave files behind. Pass a ticket id to tidy one ticket, or nothing for all.
 * Returns how many were removed. Safe to run at any time and from several places.
 */
export async function purgeStaleUploads(prisma: PrismaService, storage: StorageService, ticketId?: string, now = Date.now()): Promise<number> {
  const stale = await prisma.attachment.findMany({
    where: { scanStatus: 'PENDING', createdAt: { lt: staleBefore(now) }, ...(ticketId ? { ticketId } : {}) },
    select: { id: true, storageKey: true },
    take: 500,
  });
  if (!stale.length) return 0;
  for (const a of stale) await storage.remove(a.storageKey); // best effort: a missing object is fine
  const gone = await prisma.attachment.deleteMany({ where: { id: { in: stale.map((a) => a.id) }, scanStatus: 'PENDING' } });
  return gone.count;
}
