"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import AuthCard from "@/components/AuthCard";
import { btnCls } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

function VerifyInner() {
  const token = useSearchParams().get("token");
  const router = useRouter();
  const [state, setState] = useState<"working" | "ok" | "error">(token ? "working" : "error");
  const [message, setMessage] = useState(token ? "" : "This verification link is missing its token.");

  useEffect(() => {
    if (!token) return;
    api<{ message: string }>("/auth/verify", { body: { token } })
      .then(() => {
        setState("ok");
        // Straight to login: one less click for the student.
        router.replace("/login?verified=1");
      })
      .catch((err) => {
        setMessage(err instanceof ApiError ? err.message : "Could not reach the server.");
        setState("error");
      });
  }, [token, router]);

  return (
    <AuthCard title={state === "error" ? "Verification problem" : "Verifying your email…"}>
      {state === "error" && (
        <>
          <p className="text-center text-sm text-muted">{message}</p>
          <Link href="/register" className={`${btnCls} w-full`}>
            Back to sign up
          </Link>
        </>
      )}
    </AuthCard>
  );
}

export default function VerifyPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  );
}
