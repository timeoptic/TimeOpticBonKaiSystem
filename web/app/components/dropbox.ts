"use client";

import { useEffect, useState, type CSSProperties, type RefObject } from "react";

/**
 * Where a popup hanging off a field goes.
 *
 * `fixed` rather than portalled: most of these fields live inside a `<dialog>`,
 * and the dialog is in the top layer — a portal into `<body>` would render
 * *underneath* it. A fixed child of the dialog escapes the drawer's own scroll
 * clipping, which is the only thing a portal was ever wanted for here.
 *
 * The position is re-read every frame while the popup is open, and written only
 * when it actually changed. That is one mechanism instead of three: scrolling a
 * drawer, resizing the window and the form growing a line of validation text
 * all move the field, and listening for each separately still misses the next
 * one. Closing on movement was the other option, and a picker that vanishes
 * because the page under it shifted is a picker you have to open twice.
 */
export default function useDropBox(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  /** Smallest the popup may be, when the field itself is narrower. */
  min = 0,
  /** Tallest it wants to be, if there is room. */
  tall = 280,
): CSSProperties {
  const [box, setBox] = useState<CSSProperties>({});

  useEffect(() => {
    if (!open) return;

    let frame = 0;
    let last = "";

    const tick = () => {
      frame = requestAnimationFrame(tick);

      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;

      const key = `${r.top}|${r.left}|${r.width}|${window.innerWidth}|${window.innerHeight}`;
      if (key === last) return;
      last = key;

      const gap = 8;
      const w = Math.min(Math.max(r.width, min), window.innerWidth - gap * 2);
      const left = Math.min(Math.max(gap, r.left), window.innerWidth - w - gap);

      const below = window.innerHeight - r.bottom;
      const above = r.top;
      // Flip up only when down genuinely will not do — a popup that changes
      // sides as the page scrolls is harder to follow than a slightly short one.
      const up = below < Math.min(tall, 220) && above > below;

      setBox({
        position: "fixed",
        insetInlineStart: left,
        inlineSize: w,
        ...(up
          ? { insetBlockEnd: window.innerHeight - r.top + 4, maxBlockSize: Math.min(above - 12, tall) }
          : { insetBlockStart: r.bottom + 4, maxBlockSize: Math.min(below - 12, tall) }),
      });
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open, anchor, min, tall]);

  return box;
}
