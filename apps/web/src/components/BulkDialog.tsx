"use client";

import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { btnCls, btnGhostCls, ErrorNote, inputCls, Modal } from "./ui";

export type BulkAction = "SOLVED" | "CLOSED" | "ESCALATED" | "REPLY";

/** The server takes at most this many tickets per request; bigger selections are sent in groups. */
const CHUNK = 50;

interface Result {
  done: number;
  failed: { id: string; reason: string }[];
  /** Tickets never attempted because a request failed part-way. */
  notRun: number;
}

const COPY: Record<BulkAction, { verb: string; doing: string; done: string; label: string; hint: string; placeholder: string }> = {
  SOLVED: {
    verb: "Solve",
    doing: "Solving",
    done: "solved",
    label: "Note for the students",
    hint: "Each student sees this note on their own ticket.",
    placeholder: "What was done to fix it?",
  },
  CLOSED: {
    verb: "Close",
    doing: "Closing",
    done: "closed",
    label: "Note for the students",
    hint: "Each student sees this note on their own ticket.",
    placeholder: "Why are these being closed (duplicate, not possible…)?",
  },
  ESCALATED: {
    verb: "Escalate",
    doing: "Escalating",
    done: "escalated",
    label: "Reason for the next level",
    hint: "Only staff see this. Students just see that the ticket moved to the next team.",
    placeholder: "What does the next level need to know?",
  },
  REPLY: {
    verb: "Reply to",
    doing: "Replying to",
    done: "replied to",
    label: "Reply",
    hint: "Sent to each student as a reply on their ticket.",
    placeholder: "Write your reply…",
  },
};

export default function BulkDialog({
  action,
  ids,
  titleOf,
  onClose,
  onDone,
}: {
  action: BulkAction;
  ids: string[];
  /** Titles for the "not changed" list; tickets that were never loaded on screen have none. */
  titleOf: (id: string) => string | undefined;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const copy = COPY[action];
  const count = ids.length;
  const noun = `${count} ticket${count === 1 ? "" : "s"}`;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const summary = (r: Result) => `${r.done} ticket${r.done === 1 ? "" : "s"} ${copy.done}.`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (note.trim().length < (action === "REPLY" ? 1 : 5)) return setError(action === "REPLY" ? "Write a reply first." : "Add a note (at least 5 characters).");
    setBusy(true);
    setProgress(0);

    // Send in groups so a big selection never becomes one long request, and report as we go.
    const total: Result = { done: 0, failed: [], notRun: 0 };
    for (let i = 0; i < ids.length; i += CHUNK) {
      try {
        const res = await api<{ done: number; failed: { id: string; reason: string }[] }>("/poc/tickets/bulk", {
          body: { ticketIds: ids.slice(i, i + CHUNK), action, note: note.trim() },
        });
        total.done += res.done;
        total.failed.push(...res.failed);
        setProgress(Math.min(i + CHUNK, ids.length));
      } catch (err) {
        total.notRun = ids.length - i;
        setError(err instanceof ApiError ? err.message : "Something went wrong.");
        break;
      }
    }
    setBusy(false);
    if (total.failed.length === 0 && total.notRun === 0) onDone(summary(total));
    else setResult(total);
  }

  // Some tickets were not changed (already finished, moved by someone else, a request failed...): say so.
  if (result) {
    return (
      <Modal title={`${result.done} done, ${result.failed.length + result.notRun} not changed`} onClose={() => onDone(summary(result))}>
        {result.notRun > 0 && (
          <p className="mb-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
            Stopped part-way{error ? `: ${error}` : ""}. {result.notRun} ticket{result.notRun === 1 ? " was" : "s were"} not attempted. Nothing was changed on them, so you can run it again.
          </p>
        )}
        {result.failed.length > 0 && (
          <>
            <p className="text-sm text-muted">These tickets were left as they were:</p>
            <ul className="mt-3 max-h-64 divide-y divide-line/60 overflow-y-auto">
              {result.failed.map((f) => (
                <li key={f.id} className="py-2.5 text-sm">
                  <p className="text-ink">{titleOf(f.id) ?? "Another ticket in your selection"}</p>
                  <p className="text-xs text-muted">{f.reason}</p>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="mt-5 flex justify-end">
          <button onClick={() => onDone(summary(result))} className={btnCls}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`${copy.verb} ${noun}`} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink">{copy.label}</span>
          <textarea autoFocus disabled={busy} rows={4} maxLength={2000} className={`${inputCls} resize-y`} placeholder={copy.placeholder} value={note} onChange={(e) => setNote(e.target.value)} />
          <span className="block text-xs text-muted">{copy.hint}</span>
        </label>
        <ErrorNote message={error} />
        {busy && ids.length > CHUNK && (
          <div role="status">
            <div className="h-2 overflow-hidden rounded-full bg-surface">
              <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${(progress / ids.length) * 100}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {copy.doing}… {progress} of {ids.length}
            </p>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2.5">
          <button type="button" onClick={onClose} disabled={busy} className={btnGhostCls}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={btnCls}>
            {busy ? "Working…" : `${copy.verb} ${noun}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
