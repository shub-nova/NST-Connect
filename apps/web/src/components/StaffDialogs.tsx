"use client";

import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { HandoffSummary, StaffOptions, StaffPerson } from "@/lib/types";
import { btnCls, btnGhostCls, ErrorNote, Field, inputCls, Modal, PillSelect, Segmented } from "./ui";

const fieldCls = inputCls;
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function Actions({ onClose, busy, label, danger }: { onClose: () => void; busy: boolean; label: string; danger?: boolean }) {
  return (
    <div className="mt-5 flex flex-wrap justify-end gap-2.5">
      <button type="button" onClick={onClose} className={btnGhostCls}>
        Cancel
      </button>
      <button
        type="submit"
        disabled={busy}
        className={danger ? "inline-flex items-center justify-center rounded-lg bg-red-600 px-5 py-2.5 text-[15px] font-semibold text-white transition hover:bg-red-700 disabled:opacity-60" : btnCls}
      >
        {busy ? "Please wait…" : label}
      </button>
    </div>
  );
}

// ---- leave: for yourself (account menu) or for someone you manage -----------------------------

export function LeaveDialog({
  who,
  onConfirm,
  onClose,
}: {
  /** The person's name when a manager does it for them; omit for "me". */
  who?: string;
  onConfirm: (until: string) => Promise<HandoffSummary | void>;
  onClose: () => void;
}) {
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tomorrow] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConfirm(until);
    } catch (err) {
      setError(errorText(err, "Could not update leave."));
      setBusy(false);
    }
  }

  return (
    <Modal title={who ? `Put ${who} on leave` : "Go on leave"} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="text-sm text-muted">
          {who ? "Their" : "Your"} open tickets are handed to a colleague at the same level, or escalated if nobody else is available. New tickets skip {who ? "them" : "you"} until {who ? "they are" : "you are"} back.
        </p>
        <div className="mt-4">
          <Field label="Back on" hint="Leave ends by itself on this date, and you are back in rotation.">
            <input id="leave-until" type="date" required min={tomorrow} value={until} onChange={(e) => setUntil(e.target.value)} className={fieldCls} />
          </Field>
        </div>
        <ErrorNote message={error} />
        <Actions onClose={onClose} busy={busy} label="Go on leave" />
      </form>
    </Modal>
  );
}

// ---- add --------------------------------------------------------------------------------------

export function AddDialog({ options, defaultCategoryId, onClose, onDone }: { options: StaffOptions; defaultCategoryId: string; onClose: () => void; onDone: (name: string) => void }) {
  const first = options.categories.find((c) => c.id === defaultCategoryId) ?? options.categories[0];
  const [categoryId, setCategoryId] = useState(first?.id ?? "");
  const category = options.categories.find((c) => c.id === categoryId);
  const [level, setLevel] = useState<number>(category?.levels[category.levels.length - 1]?.level ?? 1);
  const [managerId, setManagerId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const levelOption = category?.levels.find((l) => l.level === level) ?? category?.levels[0];
  const managers = levelOption?.managers ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/staff", { body: { name, email, categoryId, level: levelOption?.level ?? level, ...(managers.length > 1 && managerId ? { managerAssignmentId: managerId } : {}) } });
      onDone(name);
    } catch (err) {
      setError(errorText(err, "Could not add this POC."));
      setBusy(false);
    }
  }

  if (!category) return null;
  return (
    <Modal title="Add a POC" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <input id="add-name" required minLength={2} className={fieldCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" hint="They get an invite to create their account with this address.">
          <input id="add-email" type="email" required placeholder="name@newtonschool.co" className={fieldCls} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {options.categories.length > 1 && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Category</p>
            <PillSelect block label="Category" value={categoryId} onChange={(v) => { setCategoryId(v); setManagerId(""); setLevel(options.categories.find((c) => c.id === v)?.levels.at(-1)?.level ?? 1); }}>
              {options.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </PillSelect>
          </div>
        )}
        {/* Only ask for a level when there is a real choice */}
        {category.levels.length > 1 ? (
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Level</p>
            <Segmented
              label="Level"
              value={levelOption?.level ?? level}
              options={category.levels.map((l) => ({ value: l.level, label: `L${l.level}` }))}
              onChange={(v) => { setLevel(v); setManagerId(""); }}
            />
          </div>
        ) : (
          <p className="rounded-xl bg-surface px-3.5 py-2.5 text-sm text-muted">
            They will be added as <b className="font-semibold text-ink">L{levelOption?.level ?? level}</b>
            {managers.length === 1 ? <> and report to <b className="font-semibold text-ink">{managers[0].name}</b></> : null}.
          </p>
        )}
        {managers.length > 1 && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Reports to</p>
            <PillSelect block label="Reports to" value={managerId} onChange={setManagerId}>
              <option value="">Choose…</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>{m.name} (L{m.level})</option>
              ))}
            </PillSelect>
          </div>
        )}
        <ErrorNote message={error} />
        <Actions onClose={onClose} busy={busy} label="Add and invite" />
      </form>
    </Modal>
  );
}

// ---- edit -------------------------------------------------------------------------------------

export function EditDialog({ person, options, onClose, onDone }: { person: StaffPerson; options: StaffOptions; onClose: () => void; onDone: () => void }) {
  const managers = options.categories.find((c) => c.id === person.category.id)?.levels.find((l) => l.level === person.level)?.managers ?? [];
  const [name, setName] = useState(person.name);
  const [managerId, setManagerId] = useState(person.managerId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/staff/${person.id}`, {
        method: "PATCH",
        body: { name, ...(managerId && managerId !== person.managerId ? { managerAssignmentId: managerId } : {}) },
      });
      onDone();
    } catch (err) {
      setError(errorText(err, "Could not save."));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Edit ${person.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <input id="edit-name" required minLength={2} className={fieldCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <p className="text-sm text-muted">
          {person.email} · L{person.level} · {person.category.name}. Email and level can’t be changed; remove and re-add to change them.
        </p>
        {managers.length > 1 && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Reports to</p>
            <PillSelect block label="Reports to" value={managerId} onChange={setManagerId}>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>{m.name} (L{m.level})</option>
              ))}
            </PillSelect>
          </div>
        )}
        <ErrorNote message={error} />
        <Actions onClose={onClose} busy={busy} label="Save" />
      </form>
    </Modal>
  );
}

// ---- remove -----------------------------------------------------------------------------------

export function RemoveDialog({ person, onClose, onDone }: { person: StaffPerson; onClose: () => void; onDone: (result: HandoffSummary) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ moved: HandoffSummary }>(`/staff/${person.id}/remove`, { method: "POST", body: {} });
      onDone(res.moved);
    } catch (err) {
      setError(errorText(err, "Could not remove this POC."));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Remove ${person.name}?`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="text-sm text-muted">
          {person.openTickets > 0
            ? `Their ${person.openTickets} open ticket${person.openTickets === 1 ? "" : "s"} will be handed to colleagues at the same level, or escalated if nobody else is available. `
            : "They have no open tickets. "}
          They will no longer be able to log in, and their past work stays in the numbers.
        </p>
        <ErrorNote message={error} />
        <Actions onClose={onClose} busy={busy} label="Remove" danger />
      </form>
    </Modal>
  );
}
