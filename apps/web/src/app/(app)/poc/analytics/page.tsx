"use client";

import AnalyticsView from "@/components/AnalyticsView";

export default function Page() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">My analytics</h1>
        <p className="mt-1 text-sm text-muted">Tickets you handled and how they went.</p>
      </div>
      <AnalyticsView endpoint="/analytics/me" />
    </div>
  );
}
