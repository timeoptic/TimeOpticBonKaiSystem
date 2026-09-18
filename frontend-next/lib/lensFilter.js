/**
 * ตัวกรองเลนส์ในหน้าขาย — Coating / SPH / CYL
 *
 * พนักงานถือค่าสายตาที่วัดได้แล้วมาหาเลนส์ในลิ้นชัก เลนส์ที่ต่างกัน 0.25 คือของคนละชิ้น
 * ทุกเงื่อนไขจึงต้องตรงครบ (AND) และเทียบตรงค่า — ตัวเทียบจริงอยู่ฝั่ง API
 * (`stockLensFilter()` ใน api/core/StockSearch.php) ที่นี่แค่อ่านช่องที่พิมพ์ให้เป็นค่าเดียว
 *
 * ทดสอบที่ `lib/__tests__/lensFilter.test.js`
 */

/** ค่า coating ที่มีในคลังจริงบนโฮสต์ครบทั้งห้าค่า (2026-09-15) */
export const LENS_COATINGS = ['Hard', 'MC', 'Auto', 'Blue', 'Auto-Blue'];

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
 * ตัวกรองทั้งชุด → query ของ GET /api/stock
 * `invalid` = ช่องที่พิมพ์ผิด หน้าจอต้องไม่ค้นด้วยเงื่อนไขที่เหลือครึ่งเดียว
 * `active` = มีเงื่อนไขอย่างน้อยหนึ่งข้อ
 */
export function lensQuery({ coating = '', sph = '', cyl = '' } = {}) {
  const params = {};
  const invalid = [];
  if (coating) params.coating = coating;
  for (const [key, text] of [['sph', sph], ['cyl', cyl]]) {
    const { value, error } = parsePower(text);
    if (error) invalid.push(key);
    else if (value !== null) params[key] = value;
  }
  return { params, invalid, active: Object.keys(params).length > 0 };
}

/** ชิปของตัวกรองที่ใช้อยู่ — ช่องที่ว่างหรือพิมพ์ผิดไม่มีชิป */
export function lensChips(filters) {
  const { params } = lensQuery(filters);
  const chips = [];
  if (params.coating) chips.push({ key: 'coating', label: `Coating: ${params.coating}` });
  if (params.sph) chips.push({ key: 'sph', label: `SPH: ${formatPower(params.sph)}` });
  if (params.cyl) chips.push({ key: 'cyl', label: `CYL: ${formatPower(params.cyl)}` });
  return chips;
}
