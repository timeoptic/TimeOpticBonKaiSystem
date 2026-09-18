/**
 * ตัวกรองเลนส์ในหน้าขาย — ชิป Index / ชนิดเลนส์ / Coating (เลือกได้หลายตัว) กับช่วง SPH / CYL
 *
 * ชิปในช่องเดียวกันเป็น "ตัวไหนก็ได้" (1.56 หรือ 1.60) ช่องต่างกันเป็น AND · ช่วงค่าสายตา
 * รวมหัวท้าย · ตัวเทียบจริงอยู่ฝั่ง API (`stockLensFilter()` ใน api/core/StockSearch.php)
 * ตัวเลือกกับจำนวนมาจาก GET /api/stock/lens-options ที่นี่แค่แปลงสถานะหน้าจอเป็น query
 *
 * ทดสอบที่ `lib/__tests__/lensFilter.test.js`
 */

/** ยังไม่ได้เลือกอะไร */
export const EMPTY_LENS = {
  index: [], design: [], coating: [], sphFrom: '', sphTo: '', cylFrom: '', cylTo: '',
};

/* สองหลักพอสำหรับค่าสายตา (±12.00) · "1." ระหว่างพิมพ์ยังนับว่าเป็น 1 */
const POWER = /^[+-]?(\d{1,2}(\.\d{0,2})?|\.\d{1,2})$/;

/**
 * ช่องค่าสายตาหนึ่งช่อง → ค่าที่ส่งให้ API ("-2" → "-2.00" · "+0.25" → "0.25")
 * ว่าง = ไม่ใช้เป็นเงื่อนไข · พิมพ์ไม่ใช่ตัวเลข = error — ห้ามมองข้ามเงียบ ๆ เพราะผลที่ได้
 * จะเป็นเลนส์ทุกค่าสายตาที่อ่านเหมือนกรองแล้ว
 * ลบแบบ iPad (U+2212) กับจุลภาคทศนิยมอ่านได้
 */
export function parsePower(text) {
  const s = String(text ?? '').trim().replace(/−/g, '-').replace(',', '.');
  if (!s) return { value: null, error: false };
  if (!POWER.test(s)) return { value: null, error: true };
  const n = Number(s);
  return { value: (Math.abs(n) < 0.005 ? 0 : n).toFixed(2), error: false };
}

/** ค่าสายตาแบบที่เขียนบนใบสั่ง — มีเครื่องหมายเสมอ ศูนย์ไม่มีเครื่องหมาย (เหมือน Optics::write) */
export function formatPower(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  if (Math.abs(n) < 0.005) return '0.00';
  return (n > 0 ? '+' : '-') + Math.abs(n).toFixed(2);
}

/**
 * ตัวกรองทั้งชุด → query ของ GET /api/stock และ /api/stock/lens-options
 * หลายค่าในช่องเดียวส่งเป็น `1.56|1.60` · ช่องว่างไม่ส่ง
 */
export function lensParams(f = EMPTY_LENS) {
  const params = {};
  for (const k of ['index', 'design', 'coating']) {
    if (f[k]?.length) params[k] = f[k].join('|');
  }
  for (const [k, v] of [['sph_from', f.sphFrom], ['sph_to', f.sphTo], ['cyl_from', f.cylFrom], ['cyl_to', f.cylTo]]) {
    if (v !== '' && v != null) params[k] = v;
  }
  return params;
}

/** เลือกชิปตัวนี้ถ้ายังไม่ได้เลือก เอาออกถ้าเลือกอยู่ */
export function toggleLens(f, key, value) {
  const on = f[key] || [];
  return { ...f, [key]: on.includes(value) ? on.filter((v) => v !== value) : [...on, value] };
}

/**
 * ชื่อเลนส์ที่แสดงบนจอ — ตัดคำว่า "Single Vision" (ร้านขอ 18 ก.ย. 2026) · ตัดตอนแสดงเท่านั้น
 * ชื่อที่เก็บยังเต็ม เพราะใบสั่งตัด RX จับคู่รุ่นด้วยชื่อ · คู่กับ `shortName` ใน stockmod/lib/format.ts
 */
export const shortName = (name) =>
  String(name ?? '').replace(/\s*Single Vision/gi, '').replace(/\s{2,}/g, ' ').trim();
