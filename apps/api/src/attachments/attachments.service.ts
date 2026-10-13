import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { StudentAttachment } from '../tickets/student-view';
import {
  HEAD_BYTES_TO_CHECK,
  MAX_ATTACHMENTS_PER_TICKET,
  checkDeclaration,
  canPreview,
  contentMatchesType,
  sanitizeFileName,
} from './file-rules';
import { purgeStaleUploads, staleBefore } from './stale-uploads';

export interface UploadRequest {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Step 1: validate what the client says it will upload, then hand out a short-lived upload URL. */
  async requestUpload(studentId: string, ticketId: string, input: UploadRequest) {
    const ticket = await this.prisma.ticket.findFirst({ where: { id: ticketId, studentId }, select: { id: true } });
    if (!ticket) throw new NotFoundException('Ticket not found.');

    const declared = checkDeclaration(input.fileName, input.mimeType, input.sizeBytes);
    if (!declared.ok) throw new BadRequestException(declared.reason);

    // Abandoned attempts (requested, never confirmed) must not use up the ticket's slots: clear the stale ones, and count
    // only finished files and attempts that could still be in progress.
    await purgeStaleUploads(this.prisma, this.storage, ticketId);
    const existing = await this.prisma.attachment.count({
      where: { ticketId, OR: [{ scanStatus: 'CLEAN' }, { scanStatus: 'PENDING', createdAt: { gte: staleBefore() } }] },
    });
    if (existing >= MAX_ATTACHMENTS_PER_TICKET) {
      throw new BadRequestException(`A ticket can have at most ${MAX_ATTACHMENTS_PER_TICKET} attachments.`);
    }

    // Random key: the file name never appears in the storage path.
    const storageKey = `tickets/${ticketId}/${randomUUID()}`;
    const attachment = await this.prisma.attachment.create({
      data: {
        ticketId,
        uploaderId: studentId,
        storageKey,
        fileName: sanitizeFileName(input.fileName),
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        scanStatus: 'PENDING',
      },
    });

    const expiresInSeconds = 300;
    return {
      attachmentId: attachment.id,
      uploadUrl: await this.storage.presignUpload(storageKey, input.mimeType, input.sizeBytes, expiresInSeconds),
      headers: { 'Content-Type': input.mimeType },
      expiresInSeconds,
    };
  }

  /**
   * Step 2: after the browser uploaded, verify what actually arrived (size, type, and the
   * file's first bytes). Only then does the file become visible on the ticket.
   */
  async confirm(studentId: string, attachmentId: string): Promise<StudentAttachment> {
    const a = await this.findOwned(studentId, attachmentId);
    if (a.scanStatus === 'CLEAN') return this.toView(a);

    const stored = await this.storage.head(a.storageKey);
    if (!stored) throw new ConflictException('The file has not finished uploading.');

    const problem = await this.inspect(a.storageKey, a.mimeType, Number(a.sizeBytes), stored);
    if (problem) {
      await this.storage.remove(a.storageKey);
      await this.prisma.attachment.delete({ where: { id: a.id } });
      throw new UnprocessableEntityException(problem);
    }

    // Antivirus scanning (ClamAV) is added in the hardening sprint; until then a file that
    // passes size, type and content checks is marked CLEAN.
    const updated = await this.prisma.attachment.update({ where: { id: a.id }, data: { scanStatus: 'CLEAN' } });
    return this.toView(updated);
  }

  /** `inline` asks to view the file in the page; it is only honoured for types that are safe to show. */
  async downloadUrl(studentId: string, attachmentId: string, inline = false) {
    const a = await this.findOwned(studentId, attachmentId);
    if (a.scanStatus !== 'CLEAN') throw new NotFoundException('Attachment not found.');
    return viewLink(this.storage, a, inline);
  }

  private async inspect(
    key: string,
    mimeType: string,
    declaredSize: number,
    stored: { sizeBytes: number; contentType: string | undefined },
  ): Promise<string | null> {
    if (stored.sizeBytes !== declaredSize) return 'The uploaded file size does not match what was declared.';
    if (stored.contentType !== mimeType) return 'The uploaded file type does not match what was declared.';
    const head = await this.storage.readHead(key, HEAD_BYTES_TO_CHECK);
    if (!contentMatchesType(mimeType, head)) return 'The file contents do not match its declared type.';
    return null;
  }

  private async findOwned(studentId: string, attachmentId: string) {
    const a = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, ticket: { studentId } },
    });
    if (!a) throw new NotFoundException('Attachment not found.');
    return a;
  }

  private toView(a: { id: string; fileName: string; mimeType: string; sizeBytes: bigint }): StudentAttachment {
    return { id: a.id, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: Number(a.sizeBytes) };
  }
}

/** The signed link for a stored file: viewable for safe types when asked, otherwise a download. */
export async function viewLink(
  storage: StorageService,
  a: { storageKey: string; fileName: string; mimeType: string },
  inline: boolean,
): Promise<{ url: string; expiresInSeconds: number; inline: boolean }> {
  const show = inline && canPreview(a.mimeType);
  // A viewed video makes more requests as it plays, so a viewing link lasts longer than a download link.
  const expiresInSeconds = show ? 600 : 60;
  const url = await storage.presignDownload(a.storageKey, a.fileName, expiresInSeconds, show ? { contentType: a.mimeType } : undefined);
  return { url, expiresInSeconds, inline: show };
}
