"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import TicketAttachments from "@/components/AttachmentViewer";
import { BackLink, SubCategoryIcon, ErrorNote, StatusBadge, btnCls, btnGhostCls, formatDate, isPast, timeAgo } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import type { CloseOutcome, PocTicketDetail } from "@/lib/types";
import { isFinished } from "@/lib/types";

const OUTCOMES: { id: CloseOutcome; label: string; action: string; help: string; placeholder: string }[] = [
  { id: "SOLVED", label: "Solved", action: "Mark solved", help: "The issue is fixed. The student sees your note.", placeholder: "What fixed it? The student will see this." },
  { id: "CLOSED", label: "Closed", action: "Close ticket", help: "Finished without a fix. The student sees your note.", placeholder: "Why is it closed? The student will see this." },
  { id: "ESCALATED", label: "Escalate", action: "Escalate", help: "Moves to the next level. Only staff see the note.", placeholder: "Why escalate? Only staff will see this." },
];

const areaCls =
  "w-full rounded-lg border border-line bg-white px-3.5 py-3 text-base text-ink placeholder:text-muted/70 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand-soft";

export default function PocTicketPage({ params }: PageProps<"/poc/tickets/[id]">) {
  // In this Next.js version, route params arrive as a Promise; `use` unwraps it.
  const { id } = use(params);
  const [ticket, setTicket] = useState<PocTicketDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [reply, setReply] = useState("");
  const [closing, setClosing] = useState(false);
  const [outcome, setOutcome] = useState<CloseOutcome | "">("");
  const [note, setNote] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [escalated, setEscalated] = useState(false);
  const [busy, setBusy] = useState<null | "reply" | "progress" | "close">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<PocTicketDetail>(`/poc/tickets/${id}`)
      .then((t) => !cancelled && setTicket(t))
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError && err.status === 404 ? "Ticket not found." : "Could not load this ticket.");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function run(kind: "reply" | "progress", path: string, body: unknown, onDone?: () => void) {
    setBusy(kind);
    setError(null);
    try {
      setTicket(await api<PocTicketDetail>(`/poc/tickets/${id}/${path}`, { body }));
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const outcomeProblem = outcome === "" ? "Choose how this ends" : null;
  const noteProblem = note.trim().length < 5 ? "Add a note (at least 5 characters)" : null;

  async function finish() {
    if (busy) return;
    if (outcomeProblem || noteProblem) {
      setShowErrors(true);
      return;
    }
    setBusy("close");
    setError(null);
    try {
      const res = await api<PocTicketDetail | { escalated: true }>(`/poc/tickets/${id}/close`, { body: { outcome, note } });
      // Escalating hands the ticket to the next level, so this POC no longer has access to it.
      if ("escalated" in res) setEscalated(true);
      else setTicket(res);
      setClosing(false);
      setNote("");
      setOutcome("");
      setShowErrors(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <ErrorNote message={loadError} />
        <Link href="/poc" className={btnGhostCls}>
          Back to queue
        </Link>
      </div>
    );
  }
  if (escalated) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <p role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-green-800">
          Escalated to the next level. It&apos;s no longer in your queue.
        </p>
        <Link href="/poc" className={btnCls}>
          Back to queue
        </Link>
      </div>
    );
  }
  if (!ticket) return <p className="text-sm text-muted">Loading ticket…</p>;

  const resolved = isFinished(ticket.status);
  const overdue = ticket.tatDeadline ? isPast(ticket.tatDeadline) : false;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <BackLink href="/poc">Back to queue</BackLink>

      {ticket.critical && !resolved && (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[15px] text-red-800 sm:px-5">
          <strong>Critical.</strong> This ticket was not solved within the time limit at any level. Please solve or close it now.
        </p>
      )}

      <section className="space-y-6 rounded-2xl border border-line bg-white p-4 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <SubCategoryIcon category={ticket.category.shortName || ticket.category.name} subCategory={ticket.subCategory?.name} size="lg" />
            <div className="min-w-0">
              <h1 className="wrap-anywhere text-xl font-bold leading-snug text-ink sm:text-2xl">{ticket.title}</h1>
              <p className="mt-0.5 text-sm text-muted">
                {ticket.category.shortName || ticket.category.name}
                {ticket.subCategory ? ` · ${ticket.subCategory.name}` : ""}
              </p>
            </div>
          </div>
          <div className="shrink-0 pt-1">
            <StatusBadge status={ticket.status} label={ticket.statusLabel} />
          </div>
        </div>

        {/* The facts, as labelled columns */}
        <dl className={`grid grid-cols-2 gap-x-6 gap-y-4 pt-3 ${!resolved && ticket.tatDeadline ? "sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]" : "sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"}`}>
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Student</dt>
            <dd className="mt-1 text-sm font-medium text-ink">{ticket.student.name}</dd>
            <dd className="truncate text-xs text-muted">{ticket.student.email}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Raised</dt>
            <dd className="mt-1 text-sm text-ink">{timeAgo(ticket.createdAt)}</dd>
          </div>
          {!resolved && ticket.tatDeadline && (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">Due</dt>
              <dd className={`mt-1 text-sm ${overdue ? "font-semibold text-red-600" : "text-ink"}`}>{formatDate(ticket.tatDeadline)}</dd>
            </div>
          )}
        </dl>

        <p className="wrap-anywhere whitespace-pre-wrap border-t border-line pt-5 text-[15px] leading-relaxed text-ink">{ticket.description}</p>

        {ticket.attachments.length > 0 && (
          <div className="space-y-3 border-t border-line pt-5">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Attachments · {ticket.attachments.length}</h2>
            <TicketAttachments items={ticket.attachments} base="/poc/attachments" />
          </div>
        )}
      </section>

      <section aria-label="Conversation" className="space-y-4">
        <h2 className="text-xl font-bold text-ink">Activity</h2>
        <ol className="relative space-y-5 border-l-2 border-line pl-7">
          {ticket.thread.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="relative">
              <span
                className={`absolute -left-[37px] top-1 h-3.5 w-3.5 rounded-full ring-4 ring-white ${item.kind === "comment" ? "bg-brand" : "bg-line"}`}
              />
              {item.kind === "comment" ? (
                <>
                  <p className="text-sm font-semibold text-ink">
                    {item.author.name}{" "}
                    <span className="font-normal text-muted">
                      · {item.author.role === "STUDENT" ? "student · " : ""}
                      {formatDate(item.at)}
                    </span>
                  </p>
                  <p className="wrap-anywhere mt-1.5 whitespace-pre-wrap rounded-lg bg-surface px-3.5 py-2.5 text-[15px] leading-relaxed text-ink">{item.body}</p>
                </>
              ) : (
                <>
                  <p className="text-[15px] font-medium text-ink">{item.label}</p>
                  {item.note && (
                    <p className="wrap-anywhere mt-1.5 whitespace-pre-wrap rounded-lg bg-green-50 px-3.5 py-2.5 text-[15px] leading-relaxed text-green-900">{item.note}</p>
                  )}
                  <p className="mt-0.5 text-sm text-muted">{formatDate(item.at)}</p>
                </>
              )}
            </li>
          ))}
        </ol>
      </section>

      {!resolved && (
        <section className="space-y-3">
          <ErrorNote message={error} />
          {!closing ? (
            <>
              <textarea
                aria-label="Reply"
                className={`${areaCls} min-h-28 resize-y`}
                placeholder="Write a reply"
                maxLength={5000}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className={btnCls}
                  disabled={busy !== null || reply.trim() === ""}
                  onClick={() => run("reply", "comments", { body: reply }, () => setReply(""))}
                >
                  {busy === "reply" ? "Sending…" : "Reply"}
                </button>
                {ticket.status !== "IN_PROGRESS" && (
                  <button
                    className={btnGhostCls}
                    disabled={busy !== null}
                    onClick={() => run("progress", "status", { status: "IN_PROGRESS" })}
                  >
                    {busy === "progress" ? "Saving…" : "Mark in progress"}
                  </button>
                )}
                <button className={`${btnGhostCls} sm:ml-auto`} disabled={busy !== null} onClick={() => setClosing(true)}>
                  Close ticket…
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How does this end?">
                  {OUTCOMES.map((o) => {
                    const active = outcome === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setOutcome(o.id)}
                        className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                          active ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:border-brand hover:text-brand"
                        }`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
                {outcome ? (
                  <p className="mt-2 text-sm text-muted">{OUTCOMES.find((o) => o.id === outcome)?.help}</p>
                ) : (
                  showErrors && outcomeProblem && <p role="alert" className="mt-1.5 text-sm text-red-600">{outcomeProblem}</p>
                )}
              </div>
              <div>
                <textarea
                  aria-label="Note"
                  className={`${areaCls} min-h-28 resize-y ${showErrors && noteProblem ? "border-red-400! focus:ring-red-100!" : ""}`}
                  placeholder={outcome ? OUTCOMES.find((o) => o.id === outcome)?.placeholder : "Note"}
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                {showErrors && noteProblem && <p role="alert" className="mt-1.5 text-sm text-red-600">{noteProblem}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button className={btnCls} disabled={busy !== null} onClick={finish}>
                  {busy === "close" ? "Saving…" : outcome ? OUTCOMES.find((o) => o.id === outcome)?.action : "Confirm"}
                </button>
                <button
                  className={btnGhostCls}
                  disabled={busy !== null}
                  onClick={() => {
                    setClosing(false);
                    setShowErrors(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
