const MB = 1024 * 1024;

export interface FileRule {
  /** Largest allowed upload in bytes. */
  maxBytes: number;
  /** Extensions that are acceptable for this MIME type (lowercase, no dot). */
  extensions: string[];
  /** Check the first bytes of the file really look like this type. */
  matches: (head: Uint8Array) => boolean;
}

const startsWith = (head: Uint8Array, bytes: number[], offset = 0) =>
  bytes.every((b, i) => head[offset + i] === b);

const ascii = (head: Uint8Array, text: string, offset = 0) =>
  startsWith(head, Array.from({ length: text.length }, (_, i) => text.charCodeAt(i)), offset);

const isPlainText = (head: Uint8Array) => {
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head);
    return true;
  } catch {
    // A multi-byte character can be cut at the end of our sample; tolerate that only.
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(head.slice(0, -3));
      return true;
    } catch {
      return false;
    }
  }
};

// SVG is deliberately NOT allowed: it can carry scripts. Executables and archives are not allowed either.
const FILE_RULES: Record<string, FileRule> = {
  'image/png': { maxBytes: 10 * MB, extensions: ['png'], matches: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47]) },
  'image/jpeg': { maxBytes: 10 * MB, extensions: ['jpg', 'jpeg'], matches: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  'image/gif': { maxBytes: 10 * MB, extensions: ['gif'], matches: (h) => ascii(h, 'GIF87a') || ascii(h, 'GIF89a') },
  'image/webp': { maxBytes: 10 * MB, extensions: ['webp'], matches: (h) => ascii(h, 'RIFF') && ascii(h, 'WEBP', 8) },
  'application/pdf': { maxBytes: 10 * MB, extensions: ['pdf'], matches: (h) => ascii(h, '%PDF-') },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    maxBytes: 10 * MB,
    extensions: ['docx'],
    matches: (h) => startsWith(h, [0x50, 0x4b, 0x03, 0x04]),
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    maxBytes: 10 * MB,
    extensions: ['xlsx'],
    matches: (h) => startsWith(h, [0x50, 0x4b, 0x03, 0x04]), // an .xlsx is a zip file
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    maxBytes: 10 * MB,
    extensions: ['pptx'],
    matches: (h) => startsWith(h, [0x50, 0x4b, 0x03, 0x04]), // a .pptx is a zip file
  },
  'text/csv': { maxBytes: 10 * MB, extensions: ['csv'], matches: isPlainText },
  'text/plain': { maxBytes: 10 * MB, extensions: ['txt', 'log', 'md'], matches: isPlainText },
  'video/mp4': { maxBytes: 100 * MB, extensions: ['mp4'], matches: (h) => ascii(h, 'ftyp', 4) },
  'video/quicktime': { maxBytes: 100 * MB, extensions: ['mov'], matches: (h) => ascii(h, 'ftyp', 4) || ascii(h, 'moov', 4) },
  'video/webm': { maxBytes: 100 * MB, extensions: ['webm'], matches: (h) => startsWith(h, [0x1a, 0x45, 0xdf, 0xa3]) },
};

/**
 * Types a browser can show on its own, so the app may open them inside the page instead of downloading. Everything
 * here is also in FILE_RULES (no SVG, no HTML, nothing that can run scripts). Word, Excel and PowerPoint files are not
 * shown by browsers, so they are still downloaded.
 */
const PREVIEWABLE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'text/plain',
  'text/csv',
]);

export const canPreview = (mimeType: string): boolean => PREVIEWABLE_TYPES.has(mimeType);

export const MAX_ATTACHMENTS_PER_TICKET = 10;
export const HEAD_BYTES_TO_CHECK = 32;

export type DeclarationResult = { ok: true } | { ok: false; reason: string };

/** Validate what the client DECLARES before we hand out an upload URL. */
export function checkDeclaration(fileName: string, mimeType: string, sizeBytes: number): DeclarationResult {
  const rule = FILE_RULES[mimeType];
  if (!rule) return { ok: false, reason: `Files of type "${mimeType}" are not allowed.` };
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) return { ok: false, reason: 'File is empty.' };
  if (sizeBytes > rule.maxBytes) {
    return { ok: false, reason: `File is too large. The limit for this type is ${rule.maxBytes / MB} MB.` };
  }
  const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
  if (!rule.extensions.includes(ext)) {
    return { ok: false, reason: `The file name must end in .${rule.extensions.join(' or .')} for this type.` };
  }
  return { ok: true };
}

/** Validate what we actually RECEIVED: the first bytes must match the declared type. */
export function contentMatchesType(mimeType: string, head: Uint8Array): boolean {
  const rule = FILE_RULES[mimeType];
  return !!rule && head.length > 0 && rule.matches(head);
}

/** Make a client-supplied file name safe to store and show: no paths, no control characters. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim();
  return cleaned.slice(0, 150) || 'file';
}
