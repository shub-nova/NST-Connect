"use client";

import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { formatSize, previewKind } from "@/lib/files";
import { AttachmentList, ErrorNote, btnGhostCls } from "./ui";

type Item = { id: string; fileName: string; mimeType: string; sizeBytes: number };

/** How much of a text file is shown (the rest is a download away). */
const TEXT_PREVIEW_BYTES = 200 * 1024;

/** A large window that shows one attachment (picture, PDF, video or text) without leaving the ticket. */
function Viewer({ item, base, onClose, onDownload }: { item: Item; base: string; onClose: () => void; onDownload: (id: string) => void }) {
  const kind = previewKind(item.mimeType);
  const [state, setState] = useState<{ url: string; text?: string; truncated?: boolean } | { error: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { url } = await api<{ url: string }>(`${base}/${item.id}/download?inline=1`);
        if (kind !== "text") return !cancelled && setState({ url });
        // Text is read and shown as plain text (never as a page), so it can never run anything.
        const res = await fetch(url, { headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` } });
        if (!res.ok) throw new Error("Could not read the file.");
        const text = await res.text();
        if (!cancelled) setState({ url, text: text.slice(0, TEXT_PREVIEW_BYTES), truncated: item.sizeBytes > TEXT_PREVIEW_BYTES });
      } catch (err) {
        if (!cancelled) setState({ error: err instanceof ApiError ? err.message : "Could not open this file here. Try downloading it." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, item.id, item.sizeBytes, kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const broken = (message: string) => setState({ error: message });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-0 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={item.fileName} className="flex h-full w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl sm:h-[90vh] sm:rounded-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-ink">{item.fileName}</p>
            <p className="text-xs text-muted">{formatSize(item.sizeBytes)}</p>
          </div>
          <button onClick={() => onDownload(item.id)} className={`${btnGhostCls} !gap-2 !px-3.5 !py-2 !text-sm`}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Download
          </button>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-2 text-muted transition hover:bg-surface hover:text-ink">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-surface">
          {state === null && <p className="text-sm text-muted">Opening…</p>}
          {state && "error" in state && (
            <div className="max-w-sm space-y-3 p-6 text-center">
              <ErrorNote message={state.error} />
              <button onClick={() => onDownload(item.id)} className={btnGhostCls}>
                Download instead
              </button>
            </div>
          )}
          {state && "url" in state && kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to a user's file: not something next/image can optimise
            <img src={state.url} alt={item.fileName} onError={() => broken("This picture could not be shown here.")} className="max-h-full max-w-full object-contain" />
          )}
          {state && "url" in state && kind === "video" && (
            <video src={state.url} controls autoPlay={false} onError={() => broken("This video cannot be played in your browser. Download it instead.")} className="max-h-full max-w-full" />
          )}
          {state && "url" in state && kind === "pdf" && <iframe src={state.url} title={item.fileName} className="h-full w-full border-0 bg-white" />}
          {state && "url" in state && kind === "text" && (
            <div className="h-full w-full overflow-auto bg-white p-4">
              <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-ink">{state.text}</pre>
              {state.truncated && <p className="mt-3 text-xs text-muted">Showing the first 200 KB. Download the file to read the rest.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The attachments of a ticket, for the student page (`base="/attachments"`) and the POC page (`base="/poc/attachments"`):
 * click a file to view it in the page, or use its download button.
 */
export default function TicketAttachments({ items, base }: { items: Item[]; base: string }) {
  const [viewing, setViewing] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(id: string) {
    setError(null);
    try {
      const { url } = await api<{ url: string }>(`${base}/${id}/download`);
      window.open(url, "_blank", "noopener");
    } catch {
      setError("Could not download that file.");
    }
  }

  return (
    <>
      <ErrorNote message={error} />
      <AttachmentList items={items} onDownload={download} onView={setViewing} size={formatSize} />
      {viewing && <Viewer item={viewing} base={base} onClose={() => setViewing(null)} onDownload={download} />}
    </>
  );
}
