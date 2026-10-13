// Mirrors the server's rules (apps/api/src/attachments/file-rules.ts) so students get
// instant feedback. The server enforces them again: this is a convenience, not security.
const MB = 1024 * 1024;

const RULES: Record<string, { ext: string[]; maxBytes: number }> = {
  "image/png": { ext: ["png"], maxBytes: 10 * MB },
  "image/jpeg": { ext: ["jpg", "jpeg"], maxBytes: 10 * MB },
  "image/gif": { ext: ["gif"], maxBytes: 10 * MB },
  "image/webp": { ext: ["webp"], maxBytes: 10 * MB },
  "application/pdf": { ext: ["pdf"], maxBytes: 10 * MB },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: ["docx"], maxBytes: 10 * MB },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: ["xlsx"], maxBytes: 10 * MB },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { ext: ["pptx"], maxBytes: 10 * MB },
  "text/csv": { ext: ["csv"], maxBytes: 10 * MB },
  "text/plain": { ext: ["txt", "log", "md"], maxBytes: 10 * MB },
  "video/mp4": { ext: ["mp4"], maxBytes: 100 * MB },
  "video/quicktime": { ext: ["mov"], maxBytes: 100 * MB },
  "video/webm": { ext: ["webm"], maxBytes: 100 * MB },
};

export const MAX_FILES = 10;
export const ACCEPT = Object.values(RULES)
  .flatMap((r) => r.ext.map((e) => `.${e}`))
  .join(",");

export function formatSize(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export interface CheckedFile {
  file: File;
  mimeType: string;
  error: string | null;
}

export function checkFile(file: File): CheckedFile {
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  const mimeType =
    Object.entries(RULES).find(([, r]) => r.ext.includes(ext))?.[0] ?? file.type ?? "";
  const rule = RULES[mimeType];
  let error: string | null = null;
  if (!rule) error = "This file type is not allowed.";
  else if (file.size === 0) error = "The file is empty.";
  else if (file.size > rule.maxBytes) error = `Too large (limit ${rule.maxBytes / MB} MB).`;
  return { file, mimeType, error };
}

/** How an attachment can be shown inside the page, or null when a browser cannot show it (Word, Excel, PowerPoint). */
export type PreviewKind = "image" | "pdf" | "video" | "text";

export function previewKind(mimeType: string): PreviewKind | null {
  if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mimeType)) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (["video/mp4", "video/webm", "video/quicktime"].includes(mimeType)) return "video";
  if (mimeType === "text/plain" || mimeType === "text/csv") return "text";
  return null;
}
