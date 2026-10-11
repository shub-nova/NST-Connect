"use client";

import Link from "next/link";
import { useState } from "react";
import AuthCard from "@/components/AuthCard";
import { fieldCls } from "@/components/AuthScreen";
import { btnCls, ErrorNote, Field } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/forgot-password", { body: { email: email.trim() } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthCard title="Check your email">
        <p className="text-center text-sm text-muted">
          If an account exists for <strong className="text-ink">{email.trim()}</strong>, we have sent a link to choose a new password. It works for 1 hour.
        </p>
        <p className="text-center text-sm text-muted">Nothing arrived? Look in your spam folder, or try again in a couple of minutes.</p>
        {process.env.NODE_ENV !== "production" && (
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            Development: emails are caught by Mailpit at{" "}
            <a className="underline" href="http://localhost:8025" target="_blank" rel="noreferrer">
              localhost:8025
            </a>
            .
          </p>
        )}
        <Link href="/login" className={`${btnCls} w-full`}>
          Back to log in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Forgot your password?" subtitle="Enter your email and we will send you a link to choose a new one.">
      <form onSubmit={onSubmit} className="space-y-5">
        <ErrorNote message={error} />
        <Field label="Email">
          <input className={fieldCls} type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" />
        </Field>
        <button disabled={busy || email.trim() === ""} className={`${btnCls} w-full`}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
        <p className="text-center text-sm text-muted">
          <Link href="/login" className="font-medium text-brand hover:underline">
            Back to log in
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
