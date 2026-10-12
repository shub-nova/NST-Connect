"use client";

import { Eye, EyeOff, GitBranch, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LogoMark } from "./AppShell";
import AuthIllustration from "./AuthIllustration";
import { ErrorNote } from "./ui";

type Mode = "login" | "signup";

export const fieldCls =
  "w-full rounded-lg border border-line bg-white px-4 py-3 text-base text-ink placeholder:text-muted/60 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand-soft";

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="mb-1.5 block text-sm font-medium text-ink">
      {children}
      {required && <span className="ml-0.5 text-red-500">*</span>}
    </span>
  );
}

function TopBar({ mode }: { mode: Mode }) {
  return (
    <header className="flex h-[68px] items-center justify-between border-b border-line bg-white px-5 sm:px-8">
      <Link href="/login" className="flex items-center gap-2.5">
        <LogoMark className="h-8 w-8" />
        <span className="text-xl text-ink">
          <strong className="font-semibold">NST</strong> Connect
        </span>
      </Link>
      <Link
        href={mode === "login" ? "/register" : "/login"}
        className="rounded-xl bg-brand px-6 py-2.5 text-[15px] font-semibold text-white transition hover:bg-brand-dark"
      >
        {mode === "login" ? "Sign up" : "Log in"}
      </Link>
    </header>
  );
}

export function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
  minLength,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete: string;
  minLength?: number;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        className={`${fieldCls} pr-12`}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        required
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-ink hover:text-brand"
      >
        {shown ? <Eye className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" /> : <EyeOff className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />}
      </button>
    </div>
  );
}

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const verified = params.get("verified") === "1";
  const passwordChanged = params.get("reset") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(email, password);
      router.replace(user.role === "POC" ? "/poc" : user.role === "STUDENT" ? "/new" : "/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
      setBusy(false);
    }
  }

  const filled = email.trim() !== "" && password !== "";
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {verified && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3.5 py-2.5 text-sm text-green-700">
          Email verified. Log in to continue.
        </p>
      )}
      {passwordChanged && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3.5 py-2.5 text-sm text-green-700">
          Password changed. Log in with your new password.
        </p>
      )}
      <ErrorNote message={error} />
      <label className="block">
        <Label>Email</Label>
        <input className={fieldCls} type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" />
      </label>
      <label className="block">
        <Label>Password</Label>
        <PasswordInput value={password} onChange={setPassword} placeholder="Enter your password" autoComplete="current-password" />
        <Link href="/forgot-password" className="mt-2 block text-right text-sm font-medium text-brand hover:underline">
          Forgot password?
        </Link>
      </label>
      <div className="flex justify-center pt-1">
        <button
          disabled={busy || !filled}
          className="min-w-44 rounded-lg bg-brand px-8 py-3 text-base font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Logging in…" : "Login"}
        </button>
      </div>
    </form>
  );
}

function SignupForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/register", { body: { name, email, password } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-5 py-4 text-center">
        <h2 className="text-2xl font-bold text-ink">Check your email</h2>
        <p className="text-muted">
          We sent a verification link to <strong className="text-ink">{email}</strong>. Open it to finish, then log in.
        </p>
        {process.env.NODE_ENV !== "production" && (
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            Development: emails are caught by Mailpit at{" "}
            <a className="underline" href="http://localhost:8025" target="_blank" rel="noreferrer">
              localhost:8025
            </a>
            .
          </p>
        )}
        <Link href="/login" className="block w-full rounded-lg bg-brand py-3.5 text-center text-base font-semibold text-white hover:bg-brand-dark">
          Go to log in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <ErrorNote message={error} />
      <label className="block">
        <Label required>Full Name</Label>
        <input className={fieldCls} autoComplete="name" autoFocus required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="What should we call you?" />
      </label>
      <label className="block">
        <Label required>College Email</Label>
        <input className={fieldCls} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@adypu.edu.in" />
      </label>
      <label className="block">
        <Label required>Password</Label>
        <PasswordInput value={password} onChange={setPassword} placeholder="At least 10 characters" autoComplete="new-password" minLength={10} />
      </label>
      <button disabled={busy} className="w-full rounded-lg bg-brand py-3.5 text-base font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60">
        {busy ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}

function FeatureTile({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    // Plain text with an icon, no box or fill: a bordered tile looks like a button, and these do nothing when clicked.
    <div className="flex flex-1 items-center gap-2.5">
      <span className="text-brand">{icon}</span>
      <span className="text-sm font-medium leading-snug text-muted">{children}</span>
    </div>
  );
}


export default function AuthScreen({ mode }: { mode: Mode }) {
  if (mode === "login") {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <TopBar mode="login" />
        <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-8 px-5 py-10 lg:grid-cols-2">
          <div className="hidden justify-center lg:flex">
            <AuthIllustration />
          </div>
          <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-5 shadow-[0_8px_40px_rgba(30,41,90,0.08)] sm:p-8">
            <h1 className="mb-6 text-center text-2xl font-bold tracking-tight text-ink sm:mb-8 sm:text-3xl">Login to your account</h1>
            {/* useSearchParams needs a Suspense boundary in the App Router. */}
            <Suspense>
              <LoginForm />
            </Suspense>
            <p className="mt-8 text-center text-muted">
              Don&apos;t have an account?{" "}
              <Link href="/register" className="font-medium text-brand hover:underline">
                Sign up
              </Link>
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <TopBar mode="signup" />
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
        <div className="w-full max-w-md space-y-6 rounded-2xl border border-line bg-white p-5 sm:p-7">
          <div className="flex gap-4 border-b border-line pb-5">
            <FeatureTile
              icon={
                <Pencil className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
              }
            >
              Raise a ticket in seconds
            </FeatureTile>
            <FeatureTile
              icon={
                <GitBranch className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
              }
            >
              Track every update
            </FeatureTile>
          </div>
          <SignupForm />
          <p className="text-center text-sm text-ink">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-brand hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
