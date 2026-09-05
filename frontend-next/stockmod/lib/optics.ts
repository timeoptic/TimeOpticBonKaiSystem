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
 * The four powers — SPH, CYL, AXIS, ADD — are closed lists: a lens is ground in
 * quarter steps over a run this shop fits, so a figure between two steps or off
 * the ends is a slip of the finger and never a lens. Typing still works, and is
 * the fast way in on a keyboard; what it does is find the step, not invent one.
 *
 * Everything else here stays a suggestion. A coating or an index is a name the
 * trade gives a material, and the first one nobody has heard of has to be
 * enterable on the day a rep brings it in. `stock/api/src/Optics.php` holds the
 * same four runs, because the API is reachable without either form.
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
 * ตอนนี้เป็นรายการปิดแล้ว ตามที่ร้านขอ — ค่าบวกจึงใส่ไม่ได้อีก ถ้าวันหนึ่งมีใบ
 * สั่งเขียนมาเป็นบวกจริง ๆ ต้องมาแก้ช่วงตรงนี้ ไม่ใช่พิมพ์ผ่านหน้าจอ
 *
 * ลงไปถึง -12.00 เท่ากับ SPH ตามที่ร้านขอ — สายตาเอียงหนัก ๆ มีจริง และก่อน
 * หน้านี้หยุดที่ -6.00 ซึ่งเป็นเพดานที่ไม่มีใครตั้งใจตั้ง
 */
export const CYL_LADDER = ladder(-12, 0);

/**
 * The near-vision addition, which only a Progressive or a Bifocal carries.
 *
 * เริ่มที่ +0.25 ตามที่ร้านขอ — เดิมเริ่มที่ +0.75 ด้วยเหตุผลว่าค่าต่ำกว่านั้น
 * ไม่มีใครสั่ง ซึ่งไม่จริงสำหรับที่นี่
 */
export const ADD_LADDER = ladder(0.25, 3.5);

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
 * A closed ladder, plus whatever the record being edited already holds.
 *
 * The powers are a closed list from today, but the catalogue has rows from
 * before today, and some of them were typed by hand into a box that took
 * anything. Opening one of those in a picker that does not list its value would
 * show an empty box — and saving the form would quietly write the blank over a
 * power the drawer is actually labelled with.
 *
 * So the old value is carried in as its own line, at the top where it reads as
 * what this record says rather than as one of the steps. It can be kept or
 * replaced; what it cannot do is disappear without anyone choosing that.
 */
export const withCurrent = (ladder: readonly string[], current: string) => {
  const c = current.trim();
  return asOptions(c === "" || ladder.includes(c) ? ladder : [c, ...ladder]);
};

/**
 * The coatings this shop sells, before the catalogue can name any itself.
 *
 * Shared because two screens now ask for one — the catalogue form and the RX
 * order — and a coating spelled "MultiCoat" on one screen and "Multi Coat" on
 * the other is two products where the shop has one.
 */
export const COATING_SEED = ["Hard", "MultiCoat", "Blue", "Transition", "Transition-Blue"];

/**
 * ชนิดของเลนส์ตามการออกแบบกำลัง — คนละเรื่องกับ coating และคนละเรื่องกับ index
 *
 * เป็นคำถามแรกที่ผู้ขายถามลูกค้า และเป็นสิ่งที่ทำให้เลนส์สองตัวราคาต่างกัน
 * หลายเท่าทั้งที่ index กับ coating เท่ากัน · เดิมใบสั่งไม่มีช่องนี้ ชนิดเลนส์
 * จึงไปแอบอยู่ในชื่อรุ่นที่พนักงานพิมพ์เอง แล้วนับแยกไม่ได้ในรายงาน
 *
 * เป็นข้อเสนอ ไม่ใช่รั้ว เหมือน COATING_SEED และ INDEX_SEED — พิมพ์ชื่อที่
 * ยังไม่มีในลิสต์ได้ วันที่ผู้ผลิตออกแบบใหม่มาขายจะได้ไม่ต้องรอแก้โค้ด
 */
export const LENS_DESIGN_SEED = [
  "Single",
  "Bifocal",
  "Progressive",
  "Degressive/Digital/Office",
  "Myopia",
  "Sport",
];

/**
 * The indexes stocked today.
 *
 * 1.59 came off the list on the shop's word: it is not an index they are sold,
 * and leaving it there was offering a lens nobody can order. 1.70 and 1.76 went
 * on for the opposite reason — they are indexes the shop is offered.
 *
 * Still a suggestion rather than a fence, unlike the powers below it. An index
 * is a material the trade names, and the first 1.71 has to be enterable on the
 * day a rep brings it in.
 */
export const INDEX_SEED = ["1.50", "1.56", "1.60", "1.67", "1.70", "1.74", "1.76"];

/**
 * Two trades, two lists.
 *
 * What sits in the drawers is bought from the houses the shop stocks; what is
 * cut to order is ordered from the lens makers. Offering all ten everywhere
 * would put Rodenstock on the frame shelf and Hitop on a job sheet.
 */
export const RX_BRANDS = ["Hoya", "Zeiss", "Essilor", "TOG", "Rodenstock", "Shamir", "Tokai"];
export const STOCK_BRANDS = ["Lens G", "Hitop", "Hoya"];
