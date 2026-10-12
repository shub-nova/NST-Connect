import { Empty } from "./Primitives";

/** Words sized by how often they repeat. Hovering (or tabbing to) one shows its count and rank. */
export function PhraseCloud({ items }: { items: { term: string; count: number }[] }) {
  if (!items.length) return <Empty text="Not enough tickets yet." />;
  const max = Math.max(...items.map((i) => i.count));
  const min = Math.min(...items.map((i) => i.count));
  const tints = ["text-brand bg-brand-soft", "text-violet-600 bg-violet-50", "text-amber-600 bg-amber-50", "text-emerald-600 bg-emerald-50", "text-pink-600 bg-pink-50", "text-cyan-600 bg-cyan-50"];
  return (
    <div className="flex flex-wrap items-center gap-2.5 py-1">
      {items.map((i, idx) => {
        const t = max === min ? 0.5 : (i.count - min) / (max - min);
        return (
          <span
            key={i.term}
            tabIndex={0}
            className={`group relative cursor-default rounded-full px-3.5 py-1.5 font-semibold outline-none transition hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand ${tints[idx % tints.length]}`}
            style={{ fontSize: `${13 + t * 9}px` }}
          >
            {i.term}
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2.5 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-xl bg-ink px-3.5 py-2 text-left opacity-0 shadow-lg transition duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
            >
              <span className="block text-sm font-semibold leading-5 text-white">
                {i.count} ticket{i.count === 1 ? "" : "s"}
              </span>
              <span className="block text-xs font-normal leading-4 text-white/70">
                #{idx + 1} most repeated
              </span>
              <span className="absolute left-1/2 top-full -mt-1 h-2 w-2 -translate-x-1/2 rotate-45 bg-ink" />
            </span>
          </span>
        );
      })}
    </div>
  );
}
