"use client";

import AnalyticsView from "@/components/AnalyticsView";

export default function Page() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Team analytics</h1>
        <p className="mt-1 text-sm text-muted">The POCs below you in this category.</p>
      </div>
      <AnalyticsView endpoint="/analytics/team" />
    </div>
  );
}
