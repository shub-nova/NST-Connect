"use client";

import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { AnalyticsData } from "@/lib/types";
import { Breakdown } from "./analytics/Breakdown";
import { EscalationsSection, FinishTimesSection } from "./analytics/Charts";
import { ShareDonuts } from "./analytics/Donut";
import { FeedbackSection } from "./analytics/FeedbackSection";
import { FilterBar } from "./analytics/FilterBar";
import { DEFAULT_LIMIT, LimitContext, PRESETS, describeLimit, isoDay } from "./analytics/format";
import { Methodology } from "./analytics/Methodology";
import { Row } from "./analytics/Primitives";
import { SummaryCards } from "./analytics/SummaryCards";
import { SHARE_PALETTE } from "./analytics/theme";
import { TimeLeftSection } from "./analytics/TimeLeftSection";
import { TopicsSection } from "./analytics/TopicsSection";
import { ErrorNote } from "./ui";

// ---- the dashboard ---------------------------------------------------------------------------

interface Props {
  /** API path, e.g. "/analytics/me". */
  endpoint: string;
  /** Admin gets category and level filters. */
  filters?: { categories: { id: string; shortName: string }[] };
}

export default function AnalyticsView({ endpoint, filters }: Props) {
  const [preset, setPreset] = useState<(typeof PRESETS)[number]["id"]>("30");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [categoryId, setCategoryId] = useState("");
  const [level, setLevel] = useState("");
  const [state, setState] = useState<{ key: string; data: AnalyticsData | null; error: string | null } | null>(null);

  // The query string is derived, so changing any control refetches without extra effects.
  const range = preset === "custom" ? custom : { from: isoDay(Number(preset) - 1), to: isoDay(0) };
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  if (categoryId) params.set("categoryId", categoryId);
  if (level) params.set("level", level);
  const key = `${endpoint}?${params}`;
  const customIncomplete = preset === "custom" && (!custom.from || !custom.to);

  useEffect(() => {
    if (customIncomplete) return;
    let cancelled = false;
    api<AnalyticsData>(key)
      .then((data) => !cancelled && setState({ key, data, error: null }))
      .catch((err) => !cancelled && setState({ key, data: null, error: err instanceof ApiError ? err.message : "Could not load analytics." }));
    return () => {
      cancelled = true;
    };
  }, [key, customIncomplete]);

  const ready = state && state.key === key ? state : null;
  const data = ready?.data ?? null;
  const h = data?.headline ?? null;

  // What makes sense depends on the view and level: L1 is first (nothing arrives from below),
  // L3 is final (nothing to escalate to, nothing to reopen), and Overall is about what is being raised.
  const isMe = data?.view === "me";
  const onlyTopics = data?.view === "overall";
  const isEveryone = onlyTopics || data?.view === "admin";
  const top = data?.levels ? Math.max(...data.levels) : 0;
  const isAdmin = data?.view === "admin";
  const adminLevel = isAdmin && level ? Number(level) : 0;
  // L1 is the first level (tickets leave their queue), L3 is final (nothing to escalate to or reopen).
  // The same rules apply on a person's own page and when the admin filters by a level.
  const firstLevel = (isMe && top === 1) || adminLevel === 1;
  const finalLevel = (isMe && top === 3) || adminLevel === 3;
  const showWithinLimit = isMe ? top === 1 : !adminLevel || adminLevel === 1;
  // The admin donuts break the cards' totals down by category, so the per-category list is not repeated.
  const showShares = isAdmin && (data?.breakdown?.length ?? 0) > 1;
  // What is being raised describes a whole category, so it is hidden once the admin narrows to a level.
  const showTopics = isEveryone && !adminLevel;
  const manyCategories = (data?.categories.length ?? 0) > 1;

  // A category keeps one colour across the donuts, the columns and the sub-category bars.
  const categoryColor = (name: string) => {
    // Same order the donuts use (the comparison rows), so colours match across charts.
    const order = data?.breakdown?.length ? data.breakdown.map((r) => r.name) : (data?.categories.map((c) => c.name) ?? []);
    const i = order.indexOf(name);
    return SHARE_PALETTE[(i < 0 ? 0 : i) % SHARE_PALETTE.length];
  };

  // What a note would be about and who it would go to, taken from the current filters.
  const categoryName = filters?.categories.find((c) => c.id === categoryId)?.shortName ?? "All categories";
  const audience = `${categoryName} · ${level ? `L${level}` : "all levels"}`;
  const periodLabel = preset === "custom" ? `${custom.from} to ${custom.to}` : `last ${preset} days`;
  const notePocs = categoryId && data?.breakdown ? data.breakdown.map((r) => ({ id: r.id, name: r.name, level: r.level })) : [];

  const phrases = data ? (data.phrases.length >= 3 ? data.phrases : data.words) : [];
  const phrasesTitle = data && data.phrases.length >= 3 ? "Most repeated phrases" : "Most repeated words";
  const limit = data ? describeLimit(data.tatHours) : DEFAULT_LIMIT;

  return (
    <LimitContext.Provider value={limit}>
      <div className="space-y-5 sm:space-y-6">
        <FilterBar
          preset={preset}
          setPreset={setPreset}
          custom={custom}
          setCustom={setCustom}
          filters={filters}
          categoryId={categoryId}
          setCategoryId={setCategoryId}
          level={level}
          setLevel={setLevel}
          audience={audience}
          periodLabel={periodLabel}
          notePocs={notePocs}
        />

        {customIncomplete && <p className="text-sm text-muted">Pick a start and end date.</p>}
        <ErrorNote message={ready?.error ?? null} />
        {!ready && !customIncomplete && <p className="text-sm text-muted">Loading…</p>}

        {data && h && (
          <div className="space-y-5 sm:space-y-6">
            {/* Stat cards: personal and operational numbers (not on Overall) */}
            {!onlyTopics && (
              <>
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold text-ink">Summary</h2>
                  <SummaryCards h={h} isMe={isMe} firstLevel={firstLevel} finalLevel={finalLevel} showWithinLimit={showWithinLimit} limit={limit} />
                </div>

                <div className="space-y-4">
                  <h2 className="text-lg font-semibold text-ink">Analytics</h2>
                  <Row>
                    {!finalLevel && <EscalationsSection data={data} limit={limit} />}
                    {!firstLevel && <FinishTimesSection data={data} />}
                  </Row>
                </div>

                {data.view !== "admin" && <TimeLeftSection data={data} limit={limit} />}

                {showShares && data.breakdown && <ShareDonuts rows={data.breakdown} final={finalLevel} />}

                <FeedbackSection h={h} data={data} />

                {data.breakdown && data.breakdown.length > 1 && !showShares && (
                  <Breakdown title={data.view === "admin" && !categoryId ? "By category" : "By POC"} rows={data.breakdown} />
                )}
                {data.members && <Breakdown title="Your team" rows={data.members.map((m) => ({ id: m.userId, name: m.name, level: m.level, headline: m.headline }))} />}
              </>
            )}

            {/* What is being raised: Overall and the admin view */}
            {showTopics && <TopicsSection data={data} manyCategories={manyCategories} categoryColor={categoryColor} phrases={phrases} phrasesTitle={phrasesTitle} />}

            {!onlyTopics && <Methodology limit={limit} />}
          </div>
        )}
      </div>
    </LimitContext.Provider>
  );
}
