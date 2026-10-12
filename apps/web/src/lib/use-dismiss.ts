"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Closes a popup (menu, dropdown, bell) when the person presses outside it. Optionally also on Escape, or when the
 * page scrolls. The listeners exist only while the popup is open.
 *
 * A press INSIDE the popup must not close it first, or a click on one of its buttons would never land: that is why
 * this checks `ref` rather than closing on every press.
 */
export function useDismiss(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  close: () => void,
  options: { escape?: boolean; scroll?: boolean } = {},
) {
  // Always call the latest `close`, without re-attaching the listeners on every render.
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });

  const { escape, scroll } = options;
  useEffect(() => {
    if (!open) return;
    const dismiss = () => latest.current();
    const outside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) dismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("mousedown", outside);
    if (escape) document.addEventListener("keydown", onKey);
    if (scroll) window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open, ref, escape, scroll]);
}
