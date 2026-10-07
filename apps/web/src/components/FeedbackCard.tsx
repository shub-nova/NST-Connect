"use client";

import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { TicketFeedback } from "@/lib/types";
import { btnCls, ErrorNote, inputCls } from "./ui";

type Rating = TicketFeedback["rating"];

const CHOICES: { value: Rating; emoji: string; label: string }[] = [
  { value: "SATISFIED", emoji: "😊", label: "Satisfied" },
  { value: "OKAY", emoji: "😐", label: "Okay" },
  { value: "NOT_SATISFIED", emoji: "😞", label: "Not satisfied" },
];

const cardCls =
  "rounded-2xl border border-line/70 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_16px_-8px_rgba(16,24,40,0.06)] sm:p-5";

/** "Share your feedback / How did we do?" on a finished ticket. Anonymous to staff. */
export default function FeedbackCard({ ticketId, feedback, canReopen, onSaved }: { ticketId: string; feedback: TicketFeedback | null; canReopen: boolean; onSaved: (f: TicketFeedback) => void }) {
  const [editing, setEditing] = useState(feedback === null);
  const [rating, setRating] = useState<Rating | null>(feedback?.rating ?? null);
  const [comment, setComment] = useState(feedback?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!rating) return setError("Choose how it went.");
    setBusy(true);
    setError(null);
    try {
      const saved = await api<TicketFeedback>(`/tickets/${ticketId}/feedback`, { body: { rating, ...(comment.trim() ? { comment: comment.trim() } : {}) } });
      onSaved(saved);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send your feedback. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Already answered: show the answer, and let them change it while that is still allowed.
  if (feedback && !editing) {
    const choice = CHOICES.find((c) => c.value === feedback.rating)!;
    return (
      <section className={cardCls}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <span className="text-[34px] leading-none" aria-hidden="true">{choice.emoji}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-ink">Thanks for your feedback</p>
            <p className="text-sm text-muted">
              You chose “{choice.label}”.
              {feedback.rating === "NOT_SATISFIED" && canReopen ? " You can reopen this ticket below." : ""}
            </p>
            {feedback.comment && <p className="mt-1 whitespace-pre-wrap text-sm text-ink">“{feedback.comment}”</p>}
          </div>
          {feedback.canChange && (
            <button onClick={() => setEditing(true)} className="text-sm font-semibold text-brand hover:underline">
              Change
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className={cardCls}>
      <p className="text-[15px] font-semibold text-ink">Share your feedback</p>
      <p className="text-sm text-muted">How did we do?</p>

      <div className="mt-4 grid grid-cols-3 gap-2.5" role="group" aria-label="How did we do?">
        {CHOICES.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setRating(c.value)}
            aria-pressed={rating === c.value}
            className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-sm font-medium transition ${
              rating === c.value ? "border-brand bg-brand-soft text-brand" : "border-line text-ink hover:border-brand/60 hover:bg-surface"
            }`}
          >
            <span className="text-[30px] leading-none">{c.emoji}</span>
            {c.label}
          </button>
        ))}
      </div>

      {rating && (
        <div className="mt-4 space-y-3">
          <textarea
            aria-label="Add a comment (optional)"
            rows={3}
            maxLength={500}
            placeholder="Add a comment (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className={`${inputCls} resize-y`}
          />
          <ErrorNote message={error} />
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={submit} disabled={busy} className={btnCls}>
              {busy ? "Sending…" : "Submit feedback"}
            </button>
            {feedback && (
              <button type="button" onClick={() => { setEditing(false); setRating(feedback.rating); setComment(feedback.comment ?? ""); setError(null); }} className="text-sm font-medium text-muted hover:text-ink">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
      {!rating && <ErrorNote message={error} />}
    </section>
  );
}
