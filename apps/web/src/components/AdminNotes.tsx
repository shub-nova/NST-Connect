"use client";

import { Bell, Megaphone as MegaphoneIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useDismiss } from "@/lib/use-dismiss";
import type { ReceivedNote, SentNote } from "@/lib/types";
import { btnCls, btnGhostCls, cardCls, ErrorNote, inputCls, PillSelect, timeAgo } from "./ui";

/** Tells the menu to refresh its unread count. */
export const NOTES_CHANGED = "notes-changed";

function Megaphone({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return <MegaphoneIcon className={className} strokeWidth={2} aria-hidden="true" />;
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
            <p className="text-[15px] font-semibold text-ink">Note to {chosen ? chosen.name : audience}</p>
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
            placeholder="Write your note…"
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

        </div>
      )}
    </>
  );
}

// ---- POC: notes from the admin, in a popup from the bell in the top bar -------------------------

export function NotesBell({ unread }: { unread: number }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<ReceivedNote[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Load the notes each time the popup opens, so it is always current.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api<{ notes: ReceivedNote[] }>("/notes/mine")
      .then((r) => !cancelled && setNotes(r.notes))
      .catch(() => !cancelled && setNotes([]));
    return () => {
      cancelled = true;
    };
  }, [open]);

  useDismiss(open, ref, () => setOpen(false), { escape: true });

  async function markSeen(id: string) {
    setNotes((all) => all?.map((n) => (n.id === id ? { ...n, seen: true } : n)) ?? null);
    try {
      await api(`/notes/${id}/seen`, { method: "POST", body: {} });
    } catch {
      /* the next open shows the true state */
    }
    window.dispatchEvent(new Event(NOTES_CHANGED));
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? `Notes from the admin, ${unread} unread` : "Notes from the admin"}
        className="relative rounded-full p-2 text-ink transition hover:bg-surface"
      >
        <Bell className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">{unread}</span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notes from the admin" className="absolute right-0 z-30 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-white shadow-lg">
          <div className="border-b border-line/70 px-4 py-3">
            <p className="text-sm font-semibold text-ink">Notes from the admin</p>
          </div>
          <div className="max-h-[26rem] overflow-y-auto">
            {notes === null && <p className="px-4 py-6 text-center text-sm text-muted">Loading…</p>}
            {notes?.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">No notes yet.</p>}
            <ul className="divide-y divide-line/60">
              {notes?.map((n) => (
                <li key={n.id} className={`px-4 py-3.5 ${n.seen ? "" : "bg-brand-soft/40"}`}>
                  <div className="flex items-start gap-3">
                    {!n.seen && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap text-sm text-ink">{n.body}</p>
                      <p className="mt-1 text-xs text-muted">
                        {n.context ? `${n.context} · ` : ""}
                        {timeAgo(n.createdAt)}
                      </p>
                      {!n.seen && (
                        <button onClick={() => markSeen(n.id)} className="mt-2 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-surface">
                          Got it
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Super Admin: the notes they have sent, in a popup from the bell ---------------------------

export function SentNotesBell() {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<SentNote[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Load the list each time the popup opens, so "Seen 2/3" is always current.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api<{ notes: SentNote[] }>("/notes/sent")
      .then((r) => !cancelled && setSent(r.notes))
      .catch(() => !cancelled && setSent([]));
    return () => {
      cancelled = true;
    };
  }, [open]);

  useDismiss(open, ref, () => setOpen(false), { escape: true });

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} aria-label="Sent notes" className="rounded-full p-2 text-ink transition hover:bg-surface">
        <Bell className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
      </button>

      {open && (
        <div role="dialog" aria-label="Sent notes" className="absolute right-0 z-30 mt-2 w-[24rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-white shadow-lg">
          <div className="border-b border-line/70 px-4 py-3">
            <p className="text-sm font-semibold text-ink">Sent notes</p>
          </div>
          <div className="max-h-[26rem] overflow-y-auto">
            {sent === null && <p className="px-4 py-6 text-center text-sm text-muted">Loading…</p>}
            {sent?.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">You haven’t sent any notes yet.</p>}
            <ul className="divide-y divide-line/60">
              {sent?.map((n) => (
                <li key={n.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm text-ink">{n.body}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {n.audience} · {timeAgo(n.createdAt)}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${n.seen === n.recipients ? "bg-emerald-50 text-emerald-600" : "bg-surface text-muted"}`}>
                    Seen {n.seen}/{n.recipients}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
