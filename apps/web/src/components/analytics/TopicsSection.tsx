import type { AnalyticsData } from "@/lib/types";
import { BarList } from "./Bars";
import { ColumnChart } from "./Charts";
import { PhraseCloud } from "./PhraseCloud";
import { Icon, Row, Section } from "./Primitives";
import { ACCENT, cardShell } from "./theme";

/** What is being raised: the most repeated categories, sub-categories and phrases (Overall and the admin view). */
export function TopicsSection({
  data,
  manyCategories,
  categoryColor,
  phrases,
  phrasesTitle,
}: {
  data: AnalyticsData;
  manyCategories: boolean;
  categoryColor: (name: string) => string;
  phrases: { term: string; count: number }[];
  phrasesTitle: string;
}) {
  return (
            <>
              {!manyCategories && data.categories[0] && (
                <div className={`${cardShell} flex flex-wrap items-center gap-4 p-4 sm:p-5`}>
                  <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${ACCENT.blue}`}>
                    <Icon name="tickets" className="h-6 w-6" />
                  </span>
                  <div>
                    <p className="text-[13px] font-medium text-muted">Tickets raised in {data.categories[0].name}</p>
                    <p className="text-3xl font-bold leading-9 tracking-tight text-ink">{data.categories[0].count}</p>
                  </div>
                </div>
              )}

              <Row>
                {manyCategories && (
                  <Section title="Most repeated categories" hint="vs the previous period of the same length" basis={380}>
                    <ColumnChart items={data.categories.slice(0, 8).map((c) => ({ id: c.id, name: c.name, value: c.count, previous: c.previous, color: categoryColor(c.name) }))} />
                  </Section>
                )}
                <Section title="Most repeated sub-categories" hint="vs the previous period of the same length" basis={380}>
                  <BarList
                    rows={data.subCategories.slice(0, 8).map((s) => ({
                      key: s.id,
                      label: s.name,
                      value: s.count,
                      trend: s.count - s.previous,
                      sub: manyCategories ? s.category : undefined,
                    }))}
                  />
                </Section>
                <Section title={phrasesTitle} hint="from titles and descriptions" basis={380}>
                  <PhraseCloud items={phrases.slice(0, 14)} />
                </Section>
              </Row>
            </>
  );
}
