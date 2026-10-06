"use client";

import { useEffect, useState } from "react";
import TicketComposer from "@/components/TicketComposer";
import { ErrorNote } from "@/components/ui";
import { api } from "@/lib/api";
import type { Category } from "@/lib/types";

// Home for students: just the form. Their ticket list lives on its own page ("My tickets").
export default function RaiseTicketPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Category[]>("/categories")
      .then(setCategories)
      .catch(() => setError("Could not load topics. Please refresh."));
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
        How can we <span className="text-accent">help</span>?
      </h1>
      <ErrorNote message={error} />
      <TicketComposer categories={categories} />
    </div>
  );
}
