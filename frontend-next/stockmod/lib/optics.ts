/**
 * The runs of numbers an optician chooses from, in one place.
 *
 * Two forms ask for a prescription — the one that adds a stocked lens and the
 * one that opens an RX order — and they were asking for it differently: a
 * picker of quarter steps on one, a bare text box on the other. Same figures,
 * same person, same job sheet in their hand. Two lists would have been two
 * chances to drift; one list is what makes "-2.25" mean the same thing on both
 * screens and sort together afterwards.
 *
 * Nothing here is a closed list. These are what the trade writes, and every
 * field that offers them still takes whatever is typed instead.
 */

/**
 * A run of dioptres, written the way a job sheet writes them.
 *
 * Powers do not come in arbitrary numbers — they come in quarter steps, and a
 * shop's drawers are labelled with exactly these. Generated rather than typed
 * out because ninety-seven hand-written strings is ninety-seven chances for one
 * of them to say "-2.5" where every other says "-2.50", and the whole point of
 * offering a list is that everyone picks the same spelling.
 *
 * Always signed and always two places: "+1.50" and "-1.50" are different
 * lenses, and a bare "1.50" says which only to someone who already knows.
 */
export function ladder(from: number, to: number, step = 0.25): string[] {
  const out: string[] = [];
  // Counted in steps rather than added up, or floating point turns -0.75 into
  // -0.7499999999999998 halfway down the list.
  for (let i = 0; i <= Math.round((to - from) / step); i++) {
    const n = from + i * step;
    out.push((n > 0 ? "+" : n < 0 ? "-" : "") + Math.abs(n).toFixed(2));
  }
  return out;
}

/** What a lens is ground to. Twelve dioptres either way covers the shop. */
export const SPH_LADDER = ladder(-12, 12);

/**
 * ค่าสายตาเอียง — ติดลบเท่านั้น
 *
 * เคยให้เลือกทั้งสองเครื่องหมาย ด้วยเหตุผลว่าบางที่เขียน plus-cyl · ร้านนี้ไม่
 * เขียนแบบนั้น ค่าบวกจึงเป็นตัวเลือกที่ไม่มีวันถูกเลือก และดันค่าที่ใช้จริงให้
 * ลงไปอยู่ครึ่งล่างของรายการ
 *
 * 0.00 ยังอยู่ เพราะ "ไม่มีสายตาเอียง" เป็นค่าจริงค่าหนึ่ง ไม่ใช่การเว้นว่าง
 *
 * ช่องนี้ยังพิมพ์เองได้เหมือนทุกช่องในไฟล์นี้ — ถ้าวันหนึ่งมีใบสั่งเขียนมาเป็น
 * บวกจริง ๆ ก็พิมพ์ลงไปได้ รายการเป็นข้อเสนอ ไม่ใช่รั้ว
 */
export const CYL_LADDER = ladder(-6, 0);

/** The near-vision addition, which only a Progressive or a Bifocal carries. */
export const ADD_LADDER = ladder(0.75, 3.5);

/**
 * One power, written the way the ladders write them.
 *
 * The same rule as `ladder`, applied to a number that came from somewhere else
 * — a product being copied onto an order, say. It has to agree with the ladder
 * exactly, or a value pulled in from a lens sits in the picker as text that
 * matches none of the options under it.
 */
export function power(n: number): string {
  return (n > 0 ? "+" : n < 0 ? "-" : "") + Math.abs(n).toFixed(2);
}

/** Whole degrees, 0–180. An axis is read as a number, so it is written as one. */
export const AXIS_LADDER = Array.from({ length: 181 }, (_, i) => String(i));

/** Which eye, said the way the job sheet says it rather than in code. */
export const EYE_OPTIONS = [
  { value: "", label: "— ไม่ระบุ —" },
  { value: "left", label: "L — ตาซ้าย" },
  { value: "right", label: "R — ตาขวา" },
] as const;

/** A ladder as the picker wants it, with an "unset" line at the top. */
export const asOptions = (xs: readonly string[]) =>
  xs.map((x) => ({ value: x, label: x }));

/**
 * The coatings this shop sells, before the catalogue can name any itself.
 *
 * Shared because two screens now ask for one — the catalogue form and the RX
 * order — and a coating spelled "MultiCoat" on one screen and "Multi Coat" on
 * the other is two products where the shop has one.
 */
export const COATING_SEED = ["Hard", "MultiCoat", "Blue", "Transition", "Transition-Blue"];

/** The indexes stocked today. Not what physics allows — 1.71 is still typeable. */
export const INDEX_SEED = ["1.50", "1.56", "1.59", "1.60", "1.67", "1.74"];

/**
 * Two trades, two lists.
 *
 * What sits in the drawers is bought from the houses the shop stocks; what is
 * cut to order is ordered from the lens makers. Offering all ten everywhere
 * would put Rodenstock on the frame shelf and Hitop on a job sheet.
 */
export const RX_BRANDS = ["Hoya", "Zeiss", "Essilor", "TOG", "Rodenstock", "Shamir", "Tokai"];
export const STOCK_BRANDS = ["Lens G", "Hitop", "Hoya"];
