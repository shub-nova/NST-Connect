"use client";

import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { ReceivedNote, SentNote } from "@/lib/types";
import { btnCls, btnGhostCls, cardCls, ErrorNote, inputCls, PillSelect, timeAgo } from "./ui";

/** Tells the menu to refresh its unread count. */
export const NOTES_CHANGED = "notes-changed";

function Megaphone({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1zM15 9a4 4 0 010 6M18 6.5a8 8 0 010 11" />
    </svg>
  );
}

// ---- Super Admin: write a note about what the dashboard is showing ----------------------------

interface SendProps {
  /** Words for who the current filters select, e.g. "Hostel · L2". */
  audience: string;
  categoryId: string;
  level: string;
  /** POCs shown in the current view (only when one category is chosen). */
  pocs: { id: string; name: string; level?: number }[];
  /** What the admin is looking at, e.g. "Hostel · L2, last 30 days". */
  context: string;
}

export function SendNote({ audience, categoryId, level, pocs, context }: SendProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pocId, setPocId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [sent, setSent] = useState<SentNote[]>([]);

  const loadSent = () =>
    api<{ notes: SentNote[] }>("/notes/sent")
      .then((r) => setSent(r.notes.slice(0, 5)))
      .catch(() => {});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api<{ notes: SentNote[] }>("/notes/sent")
      .then((r) => !cancelled && setSent(r.notes.slice(0, 5)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  const chosen = pocs.find((p) => p.id === pocId);

  async function send() {
    setError(null);
    setDone(null);
    if (text.trim().length < 3) return setError("Write a note first.");
    setBusy(true);
    try {
      const res = await api<{ recipients: number }>("/notes", {
        body: {
          body: text.trim(),
          context,
          ...(categoryId ? { categoryId } : {}),
          ...(level ? { level: Number(level) } : {}),
          ...(chosen ? { pocId: chosen.id } : {}),
        },
      });
      setText("");
      setDone(`Sent to ${res.recipients} POC${res.recipients === 1 ? "" : "s"} and emailed.`);
      loadSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the note.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`${btnGhostCls} !py-2 !text-sm sm:ml-auto`}>
        <Megaphone />
        Send a note
      </button>

      {open && (
        <div className={`${cardCls} basis-full space-y-4 p-4 shadow-sm sm:p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[15px] font-semibold text-ink">Note to {chosen ? chosen.name : audience}</p>
              <p className="text-xs text-muted">About: {context}. They see it on their dashboard and get an email. Students never see it.</p>
            </div>
            {pocs.length > 1 && (
              <PillSelect label="Send to" value={pocId} onChange={setPocId}>
                <option value="">Everyone selected</option>
                {pocs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.level ? ` (L${p.level})` : ""}
                  </option>
                ))}
              </PillSelect>
            )}
          </div>

          <textarea
            aria-label="Note"
            rows={3}
            maxLength={2000}
            className={`${inputCls} resize-y`}
            placeholder="What should they look at or change?"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDone(null);
            }}
          />
          <ErrorNote message={error} />
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={send} disabled={busy} className={btnCls}>
              {busy ? "Sending…" : "Send note"}
            </button>
            {done && <p className="text-sm font-medium text-emerald-600">{done}</p>}
          </div>

          {sent.length > 0 && (
            <div className="border-t border-line/70 pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Recent notes</p>
              <ul className="mt-2 divide-y divide-line/60">
                {sent.map((n) => (
                  <li key={n.id} className="flex items-start justify-between gap-4 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-ink">{n.body}</span>
                      <span className="text-xs text-muted">
                        {n.audience} · {timeAgo(n.createdAt)}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${n.seen === n.recipients ? "bg-emerald-50 text-emerald-600" : "bg-surface text-muted"}`}>
                      Seen {n.seen}/{n.recipients}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ---- POC: notes from the admin on the dashboard ------------------------------------------------

export function ReceivedNotes() {
  const [notes, setNotes] = useState<ReceivedNote[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ notes: ReceivedNote[] }>("/notes/mine")
      .then((r) => !cancelled && setNotes(r.notes))
      .catch(() => !cancelled && setNotes([]));
    return () => {
      cancelled = true;
    };
  }, []);

  async function markSeen(id: string) {
    setNotes((all) => all?.map((n) => (n.id === id ? { ...n, seen: true } : n)) ?? null);
    try {
      await api(`/notes/${id}/seen`, { method: "POST", body: {} });
    } catch {
      /* the next load shows the true state */
    }
    window.dispatchEvent(new Event(NOTES_CHANGED));
  }

  if (!notes?.length) return null;
  const unseen = notes.filter((n) => !n.seen);
  const earlier = notes.filter((n) => n.seen);

  return (
    <div className="space-y-3">
      {unseen.map((n) => (
        <div key={n.id} className="flex items-start gap-3.5 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
            <Megaphone />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">
              Note from the admin <span className="font-normal text-muted">· {timeAgo(n.createdAt)}</span>
            </p>
            {n.context && <p className="text-xs text-muted">About: {n.context}</p>}
            <p className="mt-1.5 whitespace-pre-wrap text-[15px] text-ink">{n.body}</p>
          </div>
          <button onClick={() => markSeen(n.id)} className="shrink-0 rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-ink shadow-sm ring-1 ring-amber-200 transition hover:bg-amber-100">
            Got it
          </button>
        </div>
      ))}

      {earlier.length > 0 && (
        <details className={`${cardCls} p-4 text-sm`}>
          <summary className="cursor-pointer font-medium text-ink">Earlier notes ({earlier.length})</summary>
          <ul className="mt-3 divide-y divide-line/60">
            {earlier.map((n) => (
              <li key={n.id} className="py-2.5">
                <p className="whitespace-pre-wrap text-ink">{n.body}</p>
                <p className="text-xs text-muted">
                  {n.context ? `${n.context} · ` : ""}
                  {timeAgo(n.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
