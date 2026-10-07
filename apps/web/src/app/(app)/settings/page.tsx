"use client";

import { Ellipsis } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AddDialog, EditDialog, LeaveDialog, RemoveDialog } from "@/components/StaffDialogs";
import { Avatar, btnCls, cardCls, ErrorNote, PillSelect, timeAgo } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AnalyticsAccess, HandoffSummary, StaffChange, StaffOptions, StaffPerson } from "@/lib/types";

const STATUS = {
  active: { label: "Active", cls: "bg-emerald-50 text-emerald-600" },
  invited: { label: "Invited", cls: "bg-brand-soft text-brand" },
  on_leave: { label: "On leave", cls: "bg-amber-50 text-amber-600" },
} as const;

/** The ⋯ menu on each person. */
function RowMenu({ person, onEdit, onLeave, onBack, onResend, onRemove }: { person: StaffPerson; onEdit: () => void; onLeave: () => void; onBack: () => void; onResend: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const item = "w-full rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-surface";
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${person.name}`} className="rounded-full p-2 text-muted transition hover:bg-surface hover:text-ink">
        <Ellipsis className="h-5 w-5" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-line bg-white p-1.5 shadow-lg">
          <button role="menuitem" className={`${item} text-ink`} onClick={run(onEdit)}>Edit</button>
          {person.onLeave ? (
            <button role="menuitem" className={`${item} text-ink`} onClick={run(onBack)}>Back from leave</button>
          ) : (
            <button role="menuitem" className={`${item} text-ink`} onClick={run(onLeave)}>Put on leave</button>
          )}
          {person.status === "invited" && (
            <button role="menuitem" className={`${item} text-ink`} onClick={run(onResend)}>Resend invite</button>
          )}
          <button role="menuitem" className={`${item} text-red-600`} onClick={run(onRemove)}>Remove</button>
        </div>
      )}
    </div>
  );
}

type Dialog = { kind: "add" } | { kind: "edit" | "leave" | "remove"; person: StaffPerson } | null;

export default function SettingsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [categoryId, setCategoryId] = useState("");
  const [version, setVersion] = useState(0);
  const [people, setPeople] = useState<StaffPerson[] | null>(null);
  const [options, setOptions] = useState<StaffOptions | null>(null);
  const [changes, setChanges] = useState<StaffChange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  // Only L2, L3 and the admin have Settings; anyone else goes back to their home.
  useEffect(() => {
    if (!user) return;
    if (user.role === "STUDENT") return void router.replace("/new");
    api<AnalyticsAccess>("/analytics/access")
      .then((a) => !a.manage && router.replace(user.role === "POC" ? "/poc" : "/"))
      .catch(() => {});
  }, [user, router]);

  useEffect(() => {
    let cancelled = false;
    const q = categoryId ? `?categoryId=${categoryId}` : "";
    Promise.all([api<{ people: StaffPerson[] }>(`/staff/team${q}`), api<StaffOptions>("/staff/options"), api<{ changes: StaffChange[] }>("/staff/audit")])
      .then(([t, o, a]) => {
        if (cancelled) return;
        setPeople(t.people);
        setOptions(o);
        setChanges(a.changes);
        setError(null);
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not load your team."));
    return () => {
      cancelled = true;
    };
  }, [categoryId, version]);

  const refresh = () => setVersion((v) => v + 1);
  const say = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 5000);
  };
  const moved = (m: HandoffSummary) => (m.reassigned + m.escalated ? ` ${m.reassigned} ticket${m.reassigned === 1 ? "" : "s"} reassigned, ${m.escalated} escalated.` : "");
  const finish = (message: string) => {
    setDialog(null);
    say(message);
    refresh();
  };

  async function backFromLeave(p: StaffPerson) {
    try {
      await api(`/staff/${p.id}/leave`, { method: "POST", body: { onLeave: false } });
      say(`${p.name} is back from leave.`);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update leave.");
    }
  }
  async function resend(p: StaffPerson) {
    try {
      await api(`/staff/${p.id}/resend-invite`, { method: "POST", body: {} });
      say(`Invite re-sent to ${p.email}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the invite.");
    }
  }

  const levels = [3, 2, 1].filter((l) => people?.some((p) => p.level === l));
  const multipleCategories = (options?.categories.length ?? 0) > 1;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-muted">Add, change and remove the POCs below you.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">Your team</h2>
        <div className="flex flex-wrap items-center gap-2.5">
          {multipleCategories && (
            <PillSelect label="Category" value={categoryId} onChange={setCategoryId}>
              <option value="">All categories</option>
              {options?.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </PillSelect>
          )}
          <button onClick={() => setDialog({ kind: "add" })} disabled={!options?.categories.some((c) => c.levels.length)} className={`${btnCls} !py-2 !text-sm`}>
            Add POC
          </button>
        </div>
      </div>

      {toast && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{toast}</p>}
      <ErrorNote message={error} />
      {!people && !error && <p className="text-sm text-muted">Loading…</p>}
      {people?.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-10 text-center text-sm text-muted">No POCs below you yet. Add one to get started.</div>
      )}

      {levels.map((level) => (
        <section key={level} className="space-y-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Level {level}</h3>
          <ul className="space-y-2.5">
            {people!.filter((p) => p.level === level).map((p) => (
              <li key={p.id} className={`${cardCls} flex items-center gap-3.5 p-3.5 sm:p-4`}>
                <Avatar name={p.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <p className="truncate font-semibold text-ink">{p.name}</p>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS[p.status].cls}`}>
                      {STATUS[p.status].label}
                      {p.status === "on_leave" && p.onLeaveUntil ? ` · back ${new Date(p.onLeaveUntil).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
                    </span>
                  </div>
                  <p className="truncate text-sm text-muted">{p.email}</p>
                  <p className="text-xs text-muted">
                    {multipleCategories ? `${p.category.name} · ` : ""}
                    {p.managerName ? `Reports to ${p.managerName} · ` : ""}
                    {p.openTickets} open
                  </p>
                </div>
                <RowMenu
                  person={p}
                  onEdit={() => setDialog({ kind: "edit", person: p })}
                  onLeave={() => setDialog({ kind: "leave", person: p })}
                  onBack={() => backFromLeave(p)}
                  onResend={() => resend(p)}
                  onRemove={() => setDialog({ kind: "remove", person: p })}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {changes.length > 0 && (
        <section className={`${cardCls} p-4 sm:p-5`}>
          <h2 className="text-[15px] font-semibold text-ink">Recent changes</h2>
          <ul className="mt-3 divide-y divide-line/60">
            {changes.map((c) => (
              <li key={c.id} className="py-2.5 text-sm">
                <p className="text-ink">{c.summary}</p>
                <p className="text-xs text-muted">{c.by} · {timeAgo(c.createdAt)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dialog?.kind === "add" && options && (
        <AddDialog options={options} defaultCategoryId={categoryId} onClose={() => setDialog(null)} onDone={(name) => finish(`${name} was added and invited.`)} />
      )}
      {dialog?.kind === "edit" && options && <EditDialog person={dialog.person} options={options} onClose={() => setDialog(null)} onDone={() => finish("Saved.")} />}
      {dialog?.kind === "remove" && <RemoveDialog person={dialog.person} onClose={() => setDialog(null)} onDone={(m) => finish(`${dialog.person.name} was removed.${moved(m)}`)} />}
      {dialog?.kind === "leave" && (
        <LeaveDialog
          who={dialog.person.name}
          onClose={() => setDialog(null)}
          onConfirm={async (until) => {
            const res = await api<{ moved: HandoffSummary }>(`/staff/${dialog.person.id}/leave`, { method: "POST", body: { onLeave: true, until } });
            finish(`${dialog.person.name} is on leave.${moved(res.moved)}`);
          }}
        />
      )}
    </div>
  );
}
