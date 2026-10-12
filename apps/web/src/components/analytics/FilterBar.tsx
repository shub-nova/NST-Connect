import { SendNote } from "../AdminNotes";
import { PillSelect, inputCls } from "../ui";
import { PRESETS } from "./format";

type PresetId = (typeof PRESETS)[number]["id"];

/** The period buttons, and for the admin the category and level filters and the "send a note" button. */
export function FilterBar({
  preset,
  setPreset,
  custom,
  setCustom,
  filters,
  categoryId,
  setCategoryId,
  level,
  setLevel,
  audience,
  periodLabel,
  notePocs,
}: {
  preset: PresetId;
  setPreset: (p: PresetId) => void;
  custom: { from: string; to: string };
  setCustom: (c: { from: string; to: string }) => void;
  filters?: { categories: { id: string; shortName: string }[] };
  categoryId: string;
  setCategoryId: (id: string) => void;
  level: string;
  setLevel: (level: string) => void;
  audience: string;
  periodLabel: string;
  notePocs: { id: string; name: string; level?: number }[];
}) {
  return (
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="inline-flex rounded-full bg-surface p-1" role="group" aria-label="Period">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              aria-pressed={preset === p.id}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${preset === p.id ? "bg-white text-brand shadow-sm" : "text-muted hover:text-ink"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <input type="date" aria-label="From" className={`${inputCls} !w-auto`} value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <span className="text-muted">–</span>
            <input type="date" aria-label="To" className={`${inputCls} !w-auto`} value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </div>
        )}
        {filters && (
          <>
            <PillSelect label="Category" value={categoryId} onChange={setCategoryId}>
              <option value="">All categories</option>
              {filters.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.shortName}</option>
              ))}
            </PillSelect>
            <PillSelect label="Level" value={level} onChange={setLevel}>
              <option value="">All levels</option>
              <option value="1">L1</option>
              <option value="2">L2</option>
              <option value="3">L3</option>
            </PillSelect>
            <SendNote audience={audience} categoryId={categoryId} level={level} pocs={notePocs} context={`${audience}, ${periodLabel}`} />
          </>
        )}
      </div>
  );
}
