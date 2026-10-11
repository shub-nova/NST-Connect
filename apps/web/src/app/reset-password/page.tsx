"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import AuthCard from "@/components/AuthCard";
import { PasswordInput } from "@/components/AuthScreen";
import { btnCls, ErrorNote, Field } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

function ResetInner() {
  const token = useSearchParams().get("token");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [badLink, setBadLink] = useState(!token);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== again) return setError("The two passwords do not match.");
    setBusy(true);
    try {
      await api("/auth/reset-password", { body: { token, password } });
      router.replace("/login?reset=1");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not reach the server. Try again.";
      setError(message);
      // A link that is wrong, used or old cannot be fixed by retyping; a weak or mistyped password can.
      if (err instanceof ApiError && /invalid or has expired/i.test(err.message)) setBadLink(true);
      setBusy(false);
    }
  }

  if (badLink) {
    return (
      <AuthCard title="This link does not work">
        <p className="text-center text-sm text-muted">{error ?? "The reset link is missing, was already used, or has expired. Links work once, for 1 hour."}</p>
        <Link href="/forgot-password" className={`${btnCls} w-full`}>
          Send a new link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" subtitle="Use at least 10 characters. You will be logged out everywhere else.">
      <form onSubmit={onSubmit} className="space-y-5">
        <ErrorNote message={error} />
        <Field label="New password">
          <PasswordInput value={password} onChange={setPassword} placeholder="At least 10 characters" autoComplete="new-password" minLength={10} />
        </Field>
        <Field label="Repeat the password">
          <PasswordInput value={again} onChange={setAgain} placeholder="Type it again" autoComplete="new-password" minLength={10} />
        </Field>
        <button disabled={busy || password === "" || again === ""} className={`${btnCls} w-full`}>
          {busy ? "Saving…" : "Change password"}
        </button>
      </form>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense>
      <ResetInner />
    </Suspense>
  );
}
