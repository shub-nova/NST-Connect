"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import AuthCard from "@/components/AuthCard";
import { btnGhostCls } from "@/components/ui";
import { useAuth } from "@/lib/auth";

// The home page only decides where to send you.
export default function Home() {
  const { user, status, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "anon") router.replace("/login");
    if (status === "authed" && user?.role === "STUDENT") router.replace("/new");
    if (status === "authed" && user?.role === "POC") router.replace("/poc");
  }, [status, user, router]);

  // Admins have no screens yet; show a plain holding page instead of redirecting in circles.
  if (status === "authed" && user?.role === "SUPER_ADMIN") {
    return (
      <AuthCard title="Admin workspace" subtitle="Analytics and configuration are coming in a later increment.">
        <button
          className={`${btnGhostCls} w-full`}
          onClick={async () => {
            await logout();
            router.replace("/login");
          }}
        >
          Log out
        </button>
      </AuthCard>
    );
  }

  return <p className="p-8 text-sm text-muted">Loading…</p>;
}
