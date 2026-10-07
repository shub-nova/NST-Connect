"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

// The home page only decides where to send you.
export default function Home() {
  const { user, status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "anon") router.replace("/login");
    if (status === "authed" && user?.role === "STUDENT") router.replace("/new");
    if (status === "authed" && user?.role === "POC") router.replace("/poc");
    if (status === "authed" && user?.role === "SUPER_ADMIN") router.replace("/admin");
  }, [status, user, router]);

  return <p className="p-8 text-sm text-muted">Loading…</p>;
}
