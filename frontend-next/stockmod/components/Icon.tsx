/**
 * The handful of icons that carry meaning rather than decorate.
 *
 * Every button in this app used to look the same, which made "ปิด" and
 * "ลบสินค้านี้" indistinguishable at a glance — the one that closes a panel and
 * the one that destroys a record read as the same control. A shape and a colour
 * are what tell them apart before the word is read, and on a shop tablet held at
 * arm's length the word often is not read.
 *
 * Drawn rather than pulled from a pack: five paths cost less than a dependency,
 * and they inherit `currentColor` so the button decides the colour.
 *
 * The side rail keeps its own set — those are navigation marks at a different
 * weight and size, and merging them would make one of the two wrong.
 */

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Shared by every icon here: sized in `em` so it scales with the button's text. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...stroke}>
      {children}
    </svg>
  );
}

/** Close — a cross, never used for anything that destroys. */
export const IconClose = () => (
  <Frame>
    <path d="M6 6 18 18" />
    <path d="M18 6 6 18" />
  </Frame>
);

/** Delete — a bin, and the only icon this app draws in red. */
export const IconTrash = () => (
  <Frame>
    <path d="M4 7h16" />
    <path d="M10 4h4a1 1 0 0 1 1 1v2H9V5a1 1 0 0 1 1-1Z" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </Frame>
);

/** It worked. */
export const IconCheck = () => (
  <Frame>
    <path d="M4 12.5 9 17.5 20 6.5" />
  </Frame>
);

/** It did not. A triangle, not a circle — the two must not be told apart by
 *  colour alone, or they are the same icon to anyone who cannot see the red. */
export const IconAlert = () => (
  <Frame>
    <path d="M12 4 2.5 20.5h19L12 4Z" />
    <path d="M12 10v4.5" />
    <path d="M12 17.5h.01" />
  </Frame>
);

/**
 * มีอะไรให้รู้ไว้ แต่ไม่มีอะไรต้องทำ
 *
 * วงกลม ไม่ใช่สามเหลี่ยม — ต้องดูออกจาก IconAlert ได้ตั้งแต่ยังไม่ทันเห็นสี
 * ข้อความน้ำเงินกับข้อความเหลืองเป็นข้อความเดียวกันสำหรับคนที่แยกสองสีนี้ไม่ออก
 */
export const IconInfo = () => (
  <Frame>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5" />
    <path d="M12 7.5h.01" />
  </Frame>
);

/**
 * The basket — goods waiting to leave together.
 *
 * A trolley rather than a bag: this is a shop's back room, and the thing being
 * filled is a job's worth of stock, not a shopping bag.
 */
export const IconCart = () => (
  <Frame>
    <path d="M3 4h2l2.4 10.4a2 2 0 0 0 2 1.6h7.2a2 2 0 0 0 2-1.55L20.5 8H6" />
    <circle cx="10" cy="20" r="1.4" />
    <circle cx="17" cy="20" r="1.4" />
  </Frame>
);

/** Put it in the basket — a plus, sized to sit inside a row button. */
export const IconPlus = () => (
  <Frame>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Frame>
);

/** ปฏิทิน — ช่องวันที่และป้ายบอกช่วงที่กำลังดูอยู่ */
export const IconCalendar = () => (
  <Frame>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18" />
    <path d="M8 3v4" />
    <path d="M16 3v4" />
  </Frame>
);

/** แท่งกราฟ — ปุ่มที่ให้ไฟล์ตัวเลขออกมา */
export const IconChart = () => (
  <Frame>
    <path d="M5 20V11" />
    <path d="M12 20V4" />
    <path d="M19 20v-6" />
  </Frame>
);
