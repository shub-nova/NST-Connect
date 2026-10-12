"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { CatalogCategory, RenameResult } from "@/lib/types";
import { DialogActions, errorText } from "./DialogParts";
import { ErrorNote, Field, inputCls, Modal } from "./ui";


/** Runs a request from a form: shows the server's message when it fails, and closes through `onDone` when it works. */
function useSubmit<T>(run: () => Promise<T>, onDone: (result: T) => void, fallback: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await run());
    } catch (err) {
      setError(errorText(err, fallback));
      setBusy(false);
    }
  }
  return { busy, error, submit };
}

export function AddCategoryDialog({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const [name, setName] = useState("");
  const [topics, setTopics] = useState("");
  const { busy, error, submit } = useSubmit(
    () => api("/catalog/categories", { body: { name, topics: topics.split("\n") } }),
    () => onDone(name.trim()),
    "Could not add the category.",
  );
  return (
    <Modal title="Add a category" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Category name" hint="What students see, for example “Library & Study Spaces”.">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus required />
        </Field>
        <Field label="Topics" hint="One per line. Students pick one when they raise a ticket, so add at least one.">
          <textarea className={`${inputCls} min-h-28`} value={topics} onChange={(e) => setTopics(e.target.value)} placeholder={"Book borrowing and returns\nStudy room booking"} required />
        </Field>
        <p className="text-xs font-medium text-red-600">Students will not see this category until it has staff at every level: add its L3, L2 and L1 from Settings.</p>
        <ErrorNote message={error} />
        <DialogActions onClose={onClose} busy={busy} label="Add category" />
      </form>
    </Modal>
  );
}

export function EditCategoryDialog({ category, onClose, onDone }: { category: CatalogCategory; onClose: () => void; onDone: (result: RenameResult) => void }) {
  const [name, setName] = useState(category.name);
  const [shortName, setShortName] = useState(category.shortName);
  const { busy, error, submit } = useSubmit(
    () => api<RenameResult>(`/catalog/categories/${category.id}`, { method: "PATCH", body: { name, shortName } }),
    onDone,
    "Could not save the changes.",
  );
  return (
    <Modal title="Edit category" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Category name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus required />
        </Field>
        <Field label="Short name" hint="Used on chips and team names.">
          <input className={inputCls} value={shortName} onChange={(e) => setShortName(e.target.value)} maxLength={30} required />
        </Field>
        <p className="text-xs text-muted">Renaming changes the name everywhere, including on old tickets. Open tickets get a “Name updated” note on their timeline.</p>
        <ErrorNote message={error} />
        <DialogActions onClose={onClose} busy={busy} label="Save" />
      </form>
    </Modal>
  );
}

export function RenameTopicDialog({ topic, onClose, onDone }: { topic: { id: string; name: string }; onClose: () => void; onDone: (result: RenameResult) => void }) {
  const [name, setName] = useState(topic.name);
  const { busy, error, submit } = useSubmit(
    () => api<RenameResult>(`/catalog/topics/${topic.id}`, { method: "PATCH", body: { name } }),
    onDone,
    "Could not rename the topic.",
  );
  return (
    <Modal title="Rename topic" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Topic" hint="Open tickets on this topic get a “Name updated” note on their timeline.">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus required />
        </Field>
        <ErrorNote message={error} />
        <DialogActions onClose={onClose} busy={busy} label="Save" />
      </form>
    </Modal>
  );
}

/** Asks before something is hidden from students. */
export function ConfirmDialog({
  title,
  children,
  label,
  path,
  onClose,
  onDone,
}: {
  title: string;
  children: React.ReactNode;
  label: string;
  /** The POST address that does it, for example `/catalog/topics/<id>/remove`. */
  path: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { busy, error, submit } = useSubmit(() => api(path, { method: "POST", body: {} }), onDone, "That did not work.");
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="space-y-2 text-sm text-muted">{children}</div>
        <ErrorNote message={error} />
        <DialogActions onClose={onClose} busy={busy} label={label} danger />
      </form>
    </Modal>
  );
}
