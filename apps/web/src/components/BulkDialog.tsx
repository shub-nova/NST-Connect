"use client";

import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { PocQueueTicket } from "@/lib/types";
import { btnCls, btnGhostCls, ErrorNote, inputCls, Modal } from "./ui";

export type BulkAction = "SOLVED" | "CLOSED" | "ESCALATED" | "REPLY";

interface Result {
  done: number;
  failed: { id: string; reason: string }[];
}

const COPY: Record<BulkAction, { verb: string; done: string; label: string; hint: string; placeholder: string }> = {
  SOLVED: {
    verb: "Solve",
    done: "solved",
    label: "Note for the students",
    hint: "Each student sees this note on their own ticket.",
    placeholder: "What was done to fix it?",
  },
  CLOSED: {
    verb: "Close",
    done: "closed",
    label: "Note for the students",
    hint: "Each student sees this note on their own ticket.",
    placeholder: "Why are these being closed (duplicate, not possible…)?",
  },
  ESCALATED: {
    verb: "Escalate",
    done: "escalated",
    label: "Reason for the next level",
    hint: "Only staff see this. Students just see that the ticket moved to the next team.",
    placeholder: "What does the next level need to know?",
  },
  REPLY: {
    verb: "Reply to",
    done: "replied to",
    label: "Reply",
    hint: "Sent to each student as a reply on their ticket.",
    placeholder: "Write your reply…",
  },
};

export default function BulkDialog({ action, tickets, onClose, onDone }: { action: BulkAction; tickets: PocQueueTicket[]; onClose: () => void; onDone: (message: string) => void }) {
  const copy = COPY[action];
  const count = tickets.length;
  const noun = `${count} ticket${count === 1 ? "" : "s"}`;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (note.trim().length < (action === "REPLY" ? 1 : 5)) return setError(action === "REPLY" ? "Write a reply first." : "Add a note (at least 5 characters).");
    setBusy(true);
    try {
      const res = await api<Result>("/poc/tickets/bulk", { body: { ticketIds: tickets.map((t) => t.id), action, note: note.trim() } });
      if (res.failed.length === 0) onDone(`${res.done} ticket${res.done === 1 ? "" : "s"} ${copy.done}.`);
      else setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  // Some tickets could not be changed (already finished, moved by someone else...): say which and why.
  if (result) {
    const titles = new Map(tickets.map((t) => [t.id, t.title]));
    return (
      <Modal title={`${result.done} done, ${result.failed.length} not changed`} onClose={() => onDone(`${result.done} ticket${result.done === 1 ? "" : "s"} ${copy.done}.`)}>
        <p className="text-sm text-muted">These tickets were left as they were:</p>
        <ul className="mt-3 divide-y divide-line/60">
          {result.failed.map((f) => (
            <li key={f.id} className="py-2.5 text-sm">
              <p className="text-ink">{titles.get(f.id) ?? "Ticket"}</p>
              <p className="text-xs text-muted">{f.reason}</p>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end">
          <button onClick={() => onDone(`${result.done} ticket${result.done === 1 ? "" : "s"} ${copy.done}.`)} className={btnCls}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`${copy.verb} ${noun}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink">{copy.label}</span>
          <textarea autoFocus rows={4} maxLength={2000} className={`${inputCls} resize-y`} placeholder={copy.placeholder} value={note} onChange={(e) => setNote(e.target.value)} />
          <span className="block text-xs text-muted">{copy.hint}</span>
        </label>
        <ErrorNote message={error} />
        <div className="flex flex-wrap justify-end gap-2.5">
          <button type="button" onClick={onClose} className={btnGhostCls}>
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
