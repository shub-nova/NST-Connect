"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { ACCEPT, MAX_FILES, checkFile, formatSize } from "@/lib/files";
import type { CheckedFile } from "@/lib/files";
import type { Category, TicketDetail, UploadTicket } from "@/lib/types";
import { ErrorNote, btnCls } from "./ui";

const MIN_TITLE = 3;
const MIN_DESCRIPTION = 10;

type FileState = { state: "uploading" | "done" | "failed"; message?: string };

function FieldError({ show, message }: { show: boolean; message: string | null }) {
  if (!show || !message) return null;
  return (
    <p role="alert" className="mt-1.5 text-sm text-red-600">
      {message}
    </p>
  );
}

const fieldCls =
  "w-full rounded-lg border border-line bg-white px-3.5 py-3 text-base text-ink placeholder:text-muted/70 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand-soft";

/**
 * The whole "raise a ticket" flow on one card: pick a topic, pick what it is about, say
 * what's wrong, send. Title and attachments are optional. No separate page.
 */
export default function TicketComposer({
  categories,
  onCreated,
}: {
  categories: Category[];
  onCreated?: (ticket: TicketDetail) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  // Nothing is preselected: the student must choose a topic.
  const [categoryId, setCategoryId] = useState("");
  const category = categories.find((c) => c.id === categoryId);

  const [pickedSub, setPickedSub] = useState("");
  // A category with a single sub-category (like "Other") has nothing to choose between, so
  // it is selected for the student and the dropdown is not shown.
  const onlySub = category?.subCategories.length === 1 ? category.subCategories[0].id : "";
  const subCategoryId = onlySub || pickedSub;
  const askForIssue = !!category && !onlySub;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<CheckedFile[]>([]);
  const [fileStates, setFileStates] = useState<Record<number, FileState>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ id: string; team: string; failedFiles: number } | null>(null);

  const [showErrors, setShowErrors] = useState(false);

  const subIsValid = !!category?.subCategories.some((s) => s.id === subCategoryId);
  // What is missing, in as few words as possible. Shown only after the first Send attempt,
  // then updated live as the student fixes each field.
  const problems = {
    topic: category ? null : "Pick a topic",
    issue: category && !subIsValid ? "Select an issue" : null,
    title: title.trim().length < MIN_TITLE ? "Add a title" : null,
    description: description.trim().length < MIN_DESCRIPTION ? `Add more detail (at least ${MIN_DESCRIPTION} characters)` : null,
    files: files.some((f) => f.error) ? "Remove the files marked in red" : null,
  };
  const hasProblems = Object.values(problems).some(Boolean);
  const bad = (message: string | null) => (showErrors && message ? "border-red-400! focus:ring-red-100!" : "");

  function pickCategory(id: string) {
    if (id !== categoryId) setPickedSub("");
    setCategoryId(id);
    setSent(null);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []).map(checkFile);
    setFiles((prev) => [...prev, ...chosen].slice(0, MAX_FILES));
    e.target.value = "";
  }

  const setFileState = (i: number, s: FileState) => setFileStates((prev) => ({ ...prev, [i]: s }));

  // Ask for a signed URL, send the file straight to storage, then have the server verify it.
  async function uploadOne(ticketId: string, item: CheckedFile, i: number) {
    setFileState(i, { state: "uploading" });
    try {
      const slot = await api<UploadTicket>(`/tickets/${ticketId}/attachments`, {
        body: { fileName: item.file.name, mimeType: item.mimeType, sizeBytes: item.file.size },
      });
      const put = await fetch(slot.uploadUrl, { method: "PUT", headers: slot.headers, body: item.file });
      if (!put.ok) throw new Error("Upload failed.");
      await api(`/attachments/${slot.attachmentId}/confirm`, { method: "POST" });
      setFileState(i, { state: "done" });
      return true;
    } catch (err) {
      setFileState(i, { state: "failed", message: err instanceof ApiError ? err.message : (err as Error).message });
      return false;
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setSent(null);
    if (hasProblems) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ticket = await api<TicketDetail>("/tickets", {
        body: { subCategoryId, title: title.trim(), description },
      });
      const results = await Promise.all(files.map((f, i) => uploadOne(ticket.id, f, i)));
      const failedFiles = results.filter((ok) => !ok).length;

      onCreated?.(ticket);
      setSent({ id: ticket.id, team: ticket.assignedTo ?? `${ticket.category.shortName} team`, failedFiles });
      // Start fresh: no topic carried over to the next ticket.
      setCategoryId("");
      setPickedSub("");
      setTitle("");
      setDescription("");
      setShowErrors(false);
      setFiles([]);
      setFileStates({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Topic">
          {categories.map((c) => {
            const active = c.id === categoryId;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={active}
                title={c.name}
                onClick={() => pickCategory(c.id)}
                className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                  active ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:border-brand hover:text-brand"
                }`}
              >
                {c.shortName || c.name}
              </button>
            );
          })}
        </div>
        <FieldError show={showErrors} message={problems.topic} />
      </div>

      {askForIssue && category && (
        <div>
        <div className="relative">
          <select
            aria-label="Issue"
            className={`${fieldCls} cursor-pointer appearance-none truncate pr-11 ${subCategoryId ? "text-ink" : "text-muted/70"} ${bad(problems.issue)}`}
            value={subCategoryId}
            onChange={(e) => {
              setPickedSub(e.target.value);
              setSent(null);
            }}
          >
            <option value="" disabled>
              Select issue
            </option>
            {category.subCategories.map((s) => (
              <option key={s.id} value={s.id} className="text-ink">
                {s.name}
              </option>
            ))}
          </select>
          <svg
            viewBox="0 0 20 20"
            className="pointer-events-none absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 7.5l5 5 5-5" />
          </svg>
        </div>
        <FieldError show={showErrors} message={problems.issue} />
        </div>
      )}

      <div>
        <input
          aria-label="Title"
          className={`${fieldCls} ${bad(problems.title)}`}
          placeholder={category?.subCategories.length === 1 ? "What is this about?" : "Title"}
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <FieldError show={showErrors} message={problems.title} />
      </div>

      <div>
        <textarea
          aria-label="Describe your issue"
          className={`${fieldCls} min-h-28 resize-y ${bad(problems.description)}`}
          placeholder="Describe your issue"
          maxLength={5000}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            if (sent) setSent(null);
          }}
        />
        <FieldError show={showErrors} message={problems.description} />
      </div>

      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f, i) => {
            const s = fileStates[i];
            const bad = f.error || s?.state === "failed";
            return (
              <li
                key={`${f.file.name}-${i}`}
                className={`flex max-w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                  bad ? "border-red-200 bg-red-50 text-red-700" : "border-line bg-surface text-ink"
                }`}
              >
                <span className="truncate">
                  {f.file.name} <span className="text-muted">({formatSize(f.file.size)})</span>
                </span>
                {f.error && <span>· {f.error}</span>}
                {s?.state === "uploading" && <span className="text-muted">· uploading…</span>}
                {s?.state === "done" && <span className="text-green-600">· attached</span>}
                {s?.state === "failed" && <span>· {s.message ?? "failed"}</span>}
                {!busy && (
                  <button
                    type="button"
                    className="p-1 text-muted hover:text-red-600"
                    aria-label={`Remove ${f.file.name}`}
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <FieldError show={showErrors} message={problems.files} />

      <ErrorNote message={error} />

      {sent && (
        <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-3.5 py-2.5 text-sm text-green-800">
          Sent to <strong>{sent.team}</strong>.{" "}
          {sent.failedFiles > 0 && `${sent.failedFiles} file${sent.failedFiles === 1 ? "" : "s"} not attached. `}
          <Link href={`/tickets/${sent.id}`} className="font-semibold text-brand hover:underline">
            View
          </Link>
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          <input ref={fileInput} type="file" multiple accept={ACCEPT} onChange={onPick} className="hidden" aria-label="Choose files" />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy || files.length >= MAX_FILES}
            className="inline-flex items-center gap-2 rounded-lg py-2.5 pr-2 text-sm font-medium text-muted transition hover:text-brand disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l8.6-8.6a3.7 3.7 0 015.2 5.2l-8.6 8.6a1.8 1.8 0 01-2.6-2.6l7.9-7.9" />
            </svg>
            Attach
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button className={`${btnCls} min-w-24`} disabled={busy}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </form>
  );
}
