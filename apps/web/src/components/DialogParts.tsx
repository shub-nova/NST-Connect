import { ApiError } from "@/lib/api";
import { btnCls, btnGhostCls } from "./ui";

/** The message to show when a request fails: the server's own words for a known error, otherwise `fallback`. */
export const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** The Cancel and confirm buttons at the bottom of a dialog form. `danger` makes the confirm button red. */
export function DialogActions({ onClose, busy, label, danger }: { onClose: () => void; busy: boolean; label: string; danger?: boolean }) {
  return (
    <div className="mt-5 flex flex-wrap justify-end gap-2.5">
      <button type="button" onClick={onClose} className={btnGhostCls}>
        Cancel
      </button>
      <button
        type="submit"
        disabled={busy}
        className={danger ? "inline-flex items-center justify-center rounded-lg bg-red-600 px-5 py-2.5 text-[15px] font-semibold text-white transition hover:bg-red-700 disabled:opacity-60" : btnCls}
      >
        {busy ? "Please wait…" : label}
      </button>
    </div>
  );
}
