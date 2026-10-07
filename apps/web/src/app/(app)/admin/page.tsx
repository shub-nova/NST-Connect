"use client";

import { useEffect, useState } from "react";
import AnalyticsView from "@/components/AnalyticsView";
import { api } from "@/lib/api";

export default function AdminAnalyticsPage() {
  const [categories, setCategories] = useState<{ id: string; shortName: string }[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<{ id: string; shortName: string }[]>("/analytics/admin/categories")
      .then((c) => !cancelled && setCategories(c))
      .catch(() => !cancelled && setCategories([]));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">All teams</h1>
        <p className="mt-1 text-sm text-muted">Compare categories, then filter down to a category or level.</p>
      </div>
      {categories && <AnalyticsView endpoint="/analytics/admin" filters={{ categories }} />}
    </div>
  );
}
