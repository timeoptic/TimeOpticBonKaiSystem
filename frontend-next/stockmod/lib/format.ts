const baht = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const whole = new Intl.NumberFormat("th-TH");

const day = new Intl.DateTimeFormat("th-TH", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC", // DATE columns carry no time; UTC keeps the day from drifting.
});

/** Money without a symbol — the column header carries the ฿. */
export const money = (n: number) => baht.format(n);

export const count = (n: number) => whole.format(n);

/**
 * The API sends dates as the database wrote them: "2026-07-06" for a DATE and
 * "2026-07-06 09:12:00" for a DATETIME. Neither carries a zone, so they are read
 * as UTC and formatted as UTC — anything else shifts the day by one.
 */
export function date(value: string | null): string {
  if (!value) return "—";
  const iso = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return Number.isNaN(d.getTime()) ? value : day.format(d);
}

const clock = new Intl.DateTimeFormat("th-TH", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC", // same reading as `date` — the database already wrote Thai time.
});

/**
 * `date` plus the hour and minute, for rows that are moments rather than days —
 * two movements of one product on one day are otherwise in no visible order.
 * A value with no time part (a DATE column) stays a bare date.
 */
export function dateTime(value: string | null): string {
  if (!value || !/[ T]\d{2}:\d{2}/.test(value)) return date(value);
  const d = new Date((value.includes("T") ? value : value.replace(" ", "T")).replace(/Z?$/, "Z"));
  return Number.isNaN(d.getTime()) ? value : `${day.format(d)} ${clock.format(d)}`;
}

/**
 * Optical values read better with a true minus sign than a hyphen, and they
 * line up in tabular figures. Always signed — "+1.50" and "−1.50" both matter.
 */
export function diopter(n: number): string {
  const fixed = Math.abs(n).toFixed(2);
  if (n > 0) return `+${fixed}`;
  if (n < 0) return `−${fixed}`;
  return "0.00";
}

/**
 * The lens spec, as one line: "1.60 · Single Vision".
 *
 * Null when the row is not a lens or has no spec at all, so a caller can draw a
 * dash once rather than assembling a line of dashes.
 */
export function lensSpec(r: {
  lensIndex: string | null;
  lensDesign: string | null;
}): string | null {
  const parts = [r.lensIndex, r.lensDesign].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The two powers a lens is chosen by, each said by name: "SPH −2.25 · CYL −0.75".
 *
 * The labels are not decoration. A bare "−2.25 −0.75" is only readable by
 * someone who already knows SPH comes first, and the person at the drawer with
 * a job sheet in one hand is exactly the person who should not have to know
 * that. Both are always signed — "+1.50" and "−1.50" are different lenses and
 * an unsigned 1.50 is ambiguous. A key that was never filled in is left out
 * rather than shown as zero: a lens with no recorded CYL is not a lens with no
 * cylinder.
 */
export function lensRx(r: {
  sph: number | null;
  cyl: number | null;
}): string | null {
  const parts: string[] = [];
  // `typeof`, not `!== null`: a key the API leaves out entirely has to read as
  // missing, or a lens with no recorded SPH gets drawn as a plano lens.
  if (typeof r.sph === "number") parts.push(`SPH ${diopter(r.sph)}`);
  if (typeof r.cyl === "number") parts.push(`CYL ${diopter(r.cyl)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The rest of the prescription, for the line underneath: "AXIS 90 · ADD +2.00".
 *
 * Split from the two powers above so a cell can put the figures that pick the
 * lens on the first line and the ones that qualify it on the second, rather
 * than running all four together into a string nobody reads to the end.
 *
 * AXIS needs no × once it is named, and ADD is kept exactly as it was written —
 * "+2.00" reads as an ADD, "2" does not.
 */
export function lensRxMore(r: {
  axis: number | null;
  add: string | null;
}): string | null {
  const parts: string[] = [];
  if (typeof r.axis === "number") parts.push(`AXIS ${r.axis}`);
  if (r.add) parts.push(`ADD ${r.add}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * ชื่อสินค้าที่แสดงบนจอ — ตัดคำว่า "Single Vision" ออก (ร้านขอ 18 ก.ย. 2026)
 *
 * เลนส์ส่วนใหญ่ของร้านเป็นชั้นเดียว คำนี้จึงยาวโดยไม่ได้บอกอะไร · ตัดตอนแสดงเท่านั้น ชื่อที่เก็บ
 * ยังเต็ม เพราะใบสั่งตัด RX จับคู่รุ่นด้วยชื่อ (`Rx::modelByName`) และ Progressive / Bifocal
 * ยังขึ้นชื่อชนิดตามปกติ — ตัวที่ไม่มีคำบอกชนิดคือชั้นเดียว
 */
export const shortName = (name: string | null | undefined): string =>
  (name ?? "").replace(/\s*Single Vision/gi, "").replace(/\s{2,}/g, " ").trim();
