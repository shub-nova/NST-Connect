"use client";

import { Ellipsis } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AddCategoryDialog, ConfirmDialog, EditCategoryDialog, RenameTopicDialog } from "@/components/CatalogDialogs";
import { BackLink, btnCls, btnGhostCls, cardCls, ErrorNote, inputCls } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import type { CatalogCategory, CatalogTopic, RenameResult } from "@/lib/types";

type Dialog =
  | { kind: "add" }
  | { kind: "edit"; category: CatalogCategory }
  | { kind: "removeCategory"; category: CatalogCategory }
  | { kind: "renameTopic"; topic: CatalogTopic }
  | { kind: "removeTopic"; topic: CatalogTopic; category: CatalogCategory }
  | null;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** The toast after a rename: how many open tickets got a note on their timeline. */
const renamed = (verb: string, r: RenameResult) =>
  r.updated === 0 ? `${verb}.` : `${verb}. ${plural(r.updated, "open ticket")} now ${r.updated === 1 ? "shows" : "show"} a “Name updated” note.`;
const linkBtn = "text-sm font-medium text-brand hover:underline disabled:opacity-60";

/** The ⋯ menu on a category or a topic. */
function ActionMenu({ label, items, variant = "row" }: { label: string; items: { label: string; onClick: () => void; danger?: boolean }[]; variant?: "category" | "row" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="relative shrink-0" ref={ref}>
      {/* The category's menu is a bordered button in the card header; a topic's is a small plain one in its row. */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className={
          variant === "category"
            ? "inline-flex items-center rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-surface"
            : "rounded-full p-1.5 text-muted/60 transition hover:bg-surface hover:text-ink"
        }
      >
        {variant === "category" ? "Manage" : <Ellipsis className="h-4 w-4" aria-hidden="true" />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-line bg-white p-1.5 shadow-lg">
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-surface ${item.danger ? "text-red-600" : "text-ink"}`}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One line to add a topic to a category. */
function AddTopic({ categoryId, onAdded, onError }: { categoryId: string; onAdded: (name: string) => void; onError: (message: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api(`/catalog/categories/${categoryId}/topics`, { body: { name } });
      onAdded(name.trim());
      setName("");
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not add the topic.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex gap-2 pt-1">
      <input className={`${inputCls} !py-2 !text-sm`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a topic" maxLength={120} aria-label="New topic" />
      <button type="submit" disabled={busy || !name.trim()} className={`${btnGhostCls} !py-2 !text-sm`}>
        Add
      </button>
    </form>
  );
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<CatalogCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [showRemoved, setShowRemoved] = useState(false);

  // Bumping `version` loads the list again (after every change).
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let cancelled = false;
    api<{ categories: CatalogCategory[] }>("/catalog")
      .then((res) => {
        if (cancelled) return;
        setCategories(res.categories);
        setError(null);
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not load the categories."));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const say = (message: string) => {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? null : t)), 4000);
  };
  const done = (message: string) => {
    setDialog(null);
    say(message);
    load();
  };
  async function restore(path: string, message: string) {
    setError(null);
    try {
      await api(path, { method: "POST", body: {} });
      say(message);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not restore it.");
    }
  }

  const live = categories?.filter((c) => c.active) ?? [];
  const removed = categories?.filter((c) => !c.active) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <BackLink href="/admin">All teams</BackLink>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Categories</h1>
          </div>
          <button onClick={() => setDialog({ kind: "add" })} className={`${btnCls} !py-2 !text-sm`}>
            Add category
          </button>
        </div>
      </div>

      {toast && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{toast}</p>}
      <ErrorNote message={error} />
      {!categories && !error && <p className="text-sm text-muted">Loading…</p>}

      <ul className="space-y-4">
        {live.map((c) => {
          const activeTopics = c.topics.filter((t) => t.active);
          const removedTopics = c.topics.filter((t) => !t.active);
          return (
            <li key={c.id} className={`${cardCls} p-4 sm:p-5`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <h2 className="font-semibold text-ink">{c.name}</h2>
                    {c.shortName && c.shortName !== c.name && <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-muted">{c.shortName}</span>}
                    {c.missingLevels.length > 0 ? (
                      <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-600">
                        Hidden from students · needs {c.missingLevels.map((l) => `L${l}`).join(", ")}
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-600">{plural(c.staff, "person").replace("persons", "people")} assigned</span>
                    )}
                  </div>
                </div>
                <ActionMenu
                  variant="category"
                  label={`Manage ${c.name}`}
                  items={[
                    { label: "Edit", onClick: () => setDialog({ kind: "edit", category: c }) },
                    { label: "Remove", danger: true, onClick: () => setDialog({ kind: "removeCategory", category: c }) },
                  ]}
                />
              </div>

              <ul className="mt-3 divide-y divide-line/70 border-t border-line/70">
                {activeTopics.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-1">
                    <p className="min-w-0 py-1.5 pl-1 text-sm text-ink">{t.name}</p>
                    <ActionMenu
                      label={`Actions for ${t.name}`}
                      items={[
                        { label: "Rename", onClick: () => setDialog({ kind: "renameTopic", topic: t }) },
                        { label: "Remove", danger: true, onClick: () => setDialog({ kind: "removeTopic", topic: t, category: c }) },
                      ]}
                    />
                  </li>
                ))}
              </ul>
              <AddTopic categoryId={c.id} onAdded={(n) => { say(`Added “${n}”.`); load(); }} onError={setError} />

              {removedTopics.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-muted">{plural(removedTopics.length, "removed topic")}</summary>
                  <ul className="mt-2 space-y-1.5">
                    {removedTopics.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-3 text-muted">
                        <span className="min-w-0 line-through">{t.name}</span>
                        <button className={linkBtn} onClick={() => void restore(`/catalog/topics/${t.id}/restore`, `Restored “${t.name}”.`)}>Restore</button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>

      {categories && live.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-10 text-center text-sm text-muted">No categories yet. Add one so students can raise tickets.</div>
      )}

      {removed.length > 0 && (
        <section>
          <button className="text-sm font-medium text-muted hover:text-ink" onClick={() => setShowRemoved((s) => !s)} aria-expanded={showRemoved}>
            {showRemoved ? "Hide" : "Show"} {plural(removed.length, "removed category").replace("categorys", "categories")}
          </button>
          {showRemoved && (
            <ul className="mt-3 space-y-2.5">
              {removed.map((c) => (
                <li key={c.id} className={`${cardCls} flex items-center justify-between gap-3 p-3.5`}>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-muted line-through">{c.name}</p>
                    <p className="text-xs text-muted">{plural(c.tickets, "ticket")} in total</p>
                  </div>
                  <button className={linkBtn} onClick={() => void restore(`/catalog/categories/${c.id}/restore`, `Restored “${c.name}”.`)}>Restore</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {dialog?.kind === "add" && <AddCategoryDialog onClose={() => setDialog(null)} onDone={(n) => done(`Added “${n}”. Add its staff from Settings.`)} />}
      {dialog?.kind === "edit" && <EditCategoryDialog category={dialog.category} onClose={() => setDialog(null)} onDone={(r) => done(renamed("Saved", r))} />}
      {dialog?.kind === "renameTopic" && <RenameTopicDialog topic={dialog.topic} onClose={() => setDialog(null)} onDone={(r) => done(renamed("Renamed", r))} />}
      {dialog?.kind === "removeCategory" && (
        <ConfirmDialog
          title={`Remove “${dialog.category.name}”?`}
          label="Remove category"
          path={`/catalog/categories/${dialog.category.id}/remove`}
          onClose={() => setDialog(null)}
          onDone={() => done(`Removed “${dialog.category.name}”.`)}
        >
          <p>Students will no longer see it when they raise a ticket. {dialog.category.tickets > 0 ? `Its ${plural(dialog.category.tickets, "ticket")} and its` : "Its"} staff assignments are kept, and you can restore it later.</p>
          {dialog.category.openTickets > 0 && <p className="font-medium text-amber-600">It has {plural(dialog.category.openTickets, "open ticket")}. It can only be removed once they are solved or closed.</p>}
        </ConfirmDialog>
      )}
      {dialog?.kind === "removeTopic" && (
        <ConfirmDialog
          title={`Remove “${dialog.topic.name}”?`}
          label="Remove topic"
          path={`/catalog/topics/${dialog.topic.id}/remove`}
          onClose={() => setDialog(null)}
          onDone={() => done(`Removed “${dialog.topic.name}”.`)}
        >
          <p>Students will no longer be able to choose it, and you can restore it later.</p>
          <p className="font-medium text-amber-600">A topic can only be removed once its open tickets are solved or closed.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
