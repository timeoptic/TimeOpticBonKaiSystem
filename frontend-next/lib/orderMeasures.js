/**
 * ตารางค่าวัดบนใบสั่ง (/print/order) — PD / FH / A / B / ED / DBL
 *
 * เดิมเป็นช่องว่างให้ช่างเขียนมือทั้งหมด · ร้านขอ 15 ก.ย. 2026 ให้พิมพ์ค่าที่บันทึกในขั้นวัด Center
 * ลงไปด้วย ช่องที่ยังไม่มีค่ายังว่างไว้ให้เขียนมือเหมือนเดิม
 *   PD, FH       centerings (r_pd/l_pd, r_height/l_height) พิมพ์ "ขวา / ซ้าย" ไม่มี PD รวม
 *   A, B, ED, DBL frame_fittings (frame_box_a, frame_box_b, ed, dbl)
 *
 * แยกไฟล์ไว้เพื่อให้เทสต์ได้โดยไม่ต้อง mount หน้าใบพิมพ์ และไม่อยู่ใน lib/format.js ซึ่งอยู่ใน
 * chunk ที่หลายหน้าโหลด — แก้ตรงนี้ขึ้นใหม่แค่หน้าใบสั่ง
 */

const DASH = '—';

const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';
const text = (v) => (has(v) ? String(v).trim() : '');

/** "ขวา / ซ้าย" — ข้างที่ไม่มีเป็นขีด ไม่มีทั้งคู่คือช่องว่าง */
const pair = (r, l) => (has(r) || has(l) ? `${has(r) ? text(r) : DASH} / ${has(l) ? text(l) : DASH}` : '');

/**
 * @param {Record<string, any> | null | undefined} ctr  แถว centerings ของเคส
 * @param {Record<string, any> | null | undefined} fit  แถว frame_fittings ของเคส
 * @returns {{PD: string, FH: string, A: string, B: string, ED: string, DBL: string}}
 */
export function measureCells(ctr, fit) {
  const c = ctr || {};
  const f = fit || {};
  return {
    PD: pair(c.r_pd, c.l_pd),
    FH: pair(c.r_height, c.l_height),
    A: text(f.frame_box_a),
    B: text(f.frame_box_b),
    ED: text(f.ed),
    DBL: text(f.dbl),
  };
}
