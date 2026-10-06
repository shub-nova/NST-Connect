"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Avatar, ErrorNote, StatusBadge, btnCls, btnGhostCls, formatDate, timeAgo } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { formatSize } from "@/lib/files";
import { isFinished } from "@/lib/types";
import type { TicketDetail } from "@/lib/types";

interface Loaded {
  id: string;
  ticket: TicketDetail | null;
  error: string | null;
}

export default function TicketDetailPage({ params }: PageProps<"/tickets/[id]">) {
  // In this Next.js version, route params arrive as a Promise; `use` unwraps it.
  const { id } = use(params);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [comment, setComment] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [reopenBusy, setReopenBusy] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<TicketDetail>(`/tickets/${id}`)
      .then((ticket) => !cancelled && setLoaded({ id, ticket, error: null }))
      .catch((err) => {
        if (!cancelled)
          setLoaded({
            id,
            ticket: null,
            error: err instanceof ApiError && err.status === 404 ? "Ticket not found." : "Could not load this ticket.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const commentProblem = comment.trim().length < 5 ? "Tell us what is still wrong (at least 5 characters)" : null;

  // A finished ticket can be reopened with a comment; it goes back to the team that handled it.
  async function reopen() {
    if (reopenBusy) return;
    if (commentProblem) {
      setShowErrors(true);
      return;
    }
    setReopenBusy(true);
    setReopenError(null);
    try {
      const ticket = await api<TicketDetail>(`/tickets/${id}/reopen`, { body: { comment } });
      setLoaded({ id, ticket, error: null });
      setReopening(false);
      setComment("");
      setShowErrors(false);
    } catch (err) {
      setReopenError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setReopenBusy(false);
    }
  }

  async function download(attachmentId: string) {
    setDownloadError(null);
    try {
      const { url } = await api<{ url: string }>(`/attachments/${attachmentId}/download`);
      window.open(url, "_blank", "noopener");
    } catch {
      setDownloadError("Could not download that file.");
    }
  }

  if (!loaded || loaded.id !== id) return <p className="text-sm text-muted">Loading ticket…</p>;
  if (!loaded.ticket) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <ErrorNote message={loaded.error} />
        <Link href="/tickets" className={btnGhostCls}>
          Back to my tickets
        </Link>
      </div>
    );
  }

  const t = loaded.ticket;
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Link href="/tickets" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
        ← Back to my tickets
      </Link>

      <section className="space-y-5 rounded-2xl border border-line bg-white p-4 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-4">
            <Avatar name={t.category.shortName || t.category.name} size="lg" />
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-ink sm:text-2xl">{t.title}</h1>
              <p className="mt-1 text-sm text-muted">
                {t.category.shortName}
                {t.subCategory ? ` › ${t.subCategory.name}` : ""}
              </p>
              <p className="text-sm text-muted">
                {t.assignedTo ?? "Waiting to be assigned"} · Raised {timeAgo(t.createdAt)}
              </p>
            </div>
          </div>
          <StatusBadge status={t.status} label={t.statusLabel} />
        </div>

        <p className="whitespace-pre-wrap border-t border-line pt-5 text-[15px] leading-relaxed text-ink">{t.description}</p>

        {t.attachments.length > 0 && (
          <div className="space-y-2 border-t border-line pt-5">
            <h2 className="text-sm font-semibold text-ink">Attachments</h2>
            <ErrorNote message={downloadError} />
            <ul className="flex flex-wrap gap-2">
              {t.attachments.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => download(a.id)}
                    className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink transition hover:border-brand hover:text-brand"
                  >
                    <span className="max-w-56 truncate">{a.fileName}</span>
                    <span className="text-xs text-muted">{formatSize(a.sizeBytes)}</span>
                    <span className="text-xs font-semibold text-brand">Download</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {isFinished(t.status) && !t.canReopen && (
        <p className="rounded-2xl border border-line bg-surface px-4 py-3 text-[15px] text-muted sm:px-5">
          This outcome is final.
        </p>
      )}

      {t.canReopen && (
        <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
          {!reopening ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[15px] text-ink">Not satisfied with the outcome?</p>
              <button className={btnGhostCls} onClick={() => setReopening(true)}>
                Reopen ticket
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <ErrorNote message={reopenError} />
              <div>
                <textarea
                  aria-label="What is still wrong"
                  autoFocus
                  maxLength={2000}
                  placeholder="What's still not working?"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className={`min-h-24 w-full resize-y rounded-lg border bg-white px-3.5 py-3 text-base text-ink placeholder:text-muted/70 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand-soft ${
                    showErrors && commentProblem ? "border-red-400 focus:ring-red-100" : "border-line"
                  }`}
                />
                {showErrors && commentProblem && (
                  <p role="alert" className="mt-1.5 text-sm text-red-600">
                    {commentProblem}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button className={btnCls} disabled={reopenBusy} onClick={reopen}>
                  {reopenBusy ? "Reopening…" : "Reopen"}
                </button>
                <button
                  className={btnGhostCls}
                  disabled={reopenBusy}
                  onClick={() => {
                    setReopening(false);
                    setShowErrors(false);
                    setReopenError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <section aria-label="Status timeline" className="space-y-4">
        <h2 className="text-xl font-bold text-ink">Timeline</h2>
        <ol className="relative space-y-6 border-l-2 border-line pl-7">
          {t.timeline.map((e, i) => (
            <li key={`${e.type}-${i}`} className="relative">
              <span className="absolute -left-[37px] top-1 h-3.5 w-3.5 rounded-full bg-brand ring-4 ring-white" />
              <p className="text-[15px] font-semibold text-ink">{e.label}</p>
              {e.message && (
                <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-surface px-3.5 py-2.5 text-[15px] leading-relaxed text-ink">
                  {e.message}
                </p>
              )}
              <p className="mt-1 text-sm text-muted">{formatDate(e.at)}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
