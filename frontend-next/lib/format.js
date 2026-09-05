/**
 * Display formatting.
 *
 * Values arriving from the PHP API may be numbers or numeric strings (PDO
 * returns DECIMAL as a string), so everything here coerces with Number()
 * before formatting.
 */

const n = (v) => Number(v || 0);

export const money = (v) =>
  '฿' + n(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const moneyShort = (v) =>
  '฿' + n(v).toLocaleString('th-TH', { maximumFractionDigits: 0 });

export const numFmt = (v, d = 2) => n(v).toFixed(d);

export const count = (v) => n(v).toLocaleString('th-TH');

/**
 * Prescription values are VARCHAR in the schema — they may hold '-1.25',
 * '+2.00', 'plano', '' or null. Numbers are formatted as signed 2dp; anything
 * else passes through unchanged.
 */
export function power(v) {
  if (v === null || v === undefined || v === '') return '—';
  const x = Number(v);
  if (!Number.isFinite(x)) return String(v);
  return (x > 0 ? '+' : '') + x.toFixed(2);
}

/** integer-ish prescription value (axis, pd) */
export const rxNum = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));

/**
 * AXIS — องศาของแกนสายตาเอียง เป็นจำนวนเต็ม 0–180 เท่านั้น
 *
 * คืน { value, error } เสมอ: `value` คือค่าที่ควรอยู่ในช่อง `error` ว่างแปลว่าผ่าน
 * ค่าที่ผิดจะถูกคืนกลับไปเหมือนที่พิมพ์มา **ไม่ถูกแก้ให้อัตโนมัติ** — 200 ไม่ได้แปลว่า
 * ตั้งใจพิมพ์ 180 หรือ 20 การเดาแทนคนวัดคือวิธีที่ทำให้เลนส์ออกมาผิดโดยไม่มีใครรู้
 *
 *   '090' -> '90'   ·   '' -> ''   ·   '200' / '90.5' / 'abc' -> ผิด
 */
export function normAxis(v) {
  const s = String(v ?? '').trim();
  if (s === '') return { value: '', error: '' };
  if (!/^\d{1,3}$/.test(s)) return { value: s, error: 'AXIS ต้องเป็นจำนวนเต็ม 0–180' };
  const x = Number(s);
  if (x > 180) return { value: s, error: 'AXIS ต้องอยู่ระหว่าง 0–180' };
  return { value: String(x), error: '' };
}

/**
 * ค่ากำลังสายตา (SPH / CYL / ADD) ในรูปแบบเดียวของทั้งระบบ: เครื่องหมาย สองหลัก
 * จุด สองตำแหน่ง เช่น -01.25 · +02.00
 *
 * เติมศูนย์หน้าให้ครบสองหลักเสมอ เพราะทุกค่าจะยาวเท่ากันทุกตัวอักษร จุดทศนิยมของ
 * R กับ L จึงตรงกันเป๊ะทั้งตาราง กวาดตาเทียบสองข้างได้โดยไม่ต้องอ่านทีละตัว
 *
 * ศูนย์ไม่มีเครื่องหมาย — '00.00' ไม่ใช่ '+00.00' หรือ '-00.00' เพราะมันไม่ได้บวกหรือลบจริง
 *
 * @param {string} s  ค่าที่พิมพ์มา ผ่านการ trim แล้ว ไม่ใช่ค่าว่าง
 * @returns {{num: number, fixed: string, error: string}} `fixed` คือตัวเลขล้วนที่เติมศูนย์แล้ว
 */
function rxPowerParts(s, label, eg) {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) {
    return { num: 0, fixed: '', error: `${label} ต้องเป็นตัวเลข เช่น ${eg}` };
  }
  const num = Number(s);
  /* ปัดเศษก่อนค่อยวัดความยาว — 99.999 ปัดแล้วเป็น 100.00 ซึ่งล้นรูปแบบ ทั้งที่ตัวเลข
     ดิบยังไม่ถึง 100 เช็คจากค่าดิบอย่างเดียวจะปล่อยให้หลุดออกมาเป็น 100.00 */
  const fixed = Math.abs(num).toFixed(2);
  if (fixed.length > 5) return { num, fixed: '', error: `${label} ต้องน้อยกว่า 100.00` };
  return { num, fixed: fixed.padStart(5, '0'), error: '' };
}

/** ติดเครื่องหมายตามค่า — ศูนย์ไม่ติดอะไรเลย */
const rxSigned = (num, fixed) => (Number(fixed) === 0 ? fixed : (num < 0 ? '-' : '+') + fixed);

/**
 * SPH — กำลังสายตาสั้น/ยาว เป็นบวกก็ได้ ลบก็ได้ ตามที่วัดมา
 *
 *   '-1.25' -> '-01.25'   ·   '2' -> '+02.00'   ·   '0' -> '00.00'   ·   '' -> ''
 */
export function normSphere(v) {
  const s = String(v ?? '').trim();
  if (s === '') return { value: '', error: '' };
  const { num, fixed, error } = rxPowerParts(s, 'SPH', '-01.25');
  if (error) return { value: s, error };
  return { value: rxSigned(num, fixed), error: '' };
}

/**
 * CYL — กำลังสายตาเอียง ร้านนี้เขียนเป็นค่าลบเท่านั้น
 *
 * ค่าบวกที่พิมพ์มาถือเป็นพิมพ์พลาดเครื่องหมาย พลิกให้เป็นลบเลย เหมือนที่ ADD พลิก
 * ค่าลบเป็นบวก — ตัวเลขที่พิมพ์คือกำลังที่วัดได้ ส่วนเครื่องหมายเป็นแบบแผนของร้าน
 * ที่ช่องกรอกรับผิดชอบเอง คนกรอกจะได้ไม่ต้องกดลบทุกครั้ง
 *
 *   '-0.75' -> '-00.75'   ·   '0.75' -> '-00.75'   ·   '0' -> '00.00'   ·   '' -> ''
 */
export function normCyl(v) {
  const s = String(v ?? '').trim();
  if (s === '') return { value: '', error: '' };
  const { num, fixed, error } = rxPowerParts(s, 'CYL', '-00.75');
  if (error) return { value: s, error };
  return { value: rxSigned(-Math.abs(num), fixed), error: '' };
}

/**
 * ADD — กำลังบวกสำหรับมองใกล้ เป็นบวกเสมอ
 *
 * เครื่องหมายลบที่พิมพ์มาถือว่าพิมพ์พลาด ไม่ใช่ค่าคนละอย่าง — ADD ติดลบไม่มีในทางปฏิบัติ
 * จึงพลิกเป็นบวกให้เลย ต่างจาก CYL ที่ค่าบวกอาจแปลว่าใบนั้นเขียนคนละระบบ
 *
 *   '2' -> '+02.00'   ·   '.75' -> '+00.75'   ·   '-1.75' -> '+01.75'   ·   '' -> ''
 */
export function normAdd(v) {
  const s = String(v ?? '').trim();
  if (s === '') return { value: '', error: '' };
  const { num, fixed, error } = rxPowerParts(s, 'ADD', '+02.00');
  if (error) return { value: s, error };
  return { value: rxSigned(Math.abs(num), fixed), error: '' };
}

/**
 * ค่ากำลังสายตาสำหรับ "แสดงผล" — ใบพิมพ์ หน้าออเดอร์ ตารางสรุป ต้องอ่านได้รูปแบบ
 * เดียวกับที่กรอกในหน้าวัดสายตา ไม่งั้นค่าเดียวกันจะมีสองหน้าตาแล้วแต่ว่าดูจากที่ไหน
 * และใบเก่าที่เก็บเป็น '2.00' ก็จะอ่านออกมาเท่ากับใบใหม่ที่เก็บเป็น '+02.00'
 *
 * ตกกลับไปใช้ power() เมื่อจัดรูปแบบไม่ได้ ใบเก่าที่กรอก 'plano' ไว้จะได้ยังอ่านออก
 * ไม่ใช่หายไปเป็นขีด
 */
const rxShown = (norm) => (v) => {
  const { value, error } = norm(v);
  if (value === '') return '—';
  return error ? power(v) : value;
};
export const sphPower = rxShown(normSphere);
export const cylPower = rxShown(normCyl);
export const addPower = rxShown(normAdd);

/**
 * ป้าย "ตาหลัก" / "ตารอง" ของตาข้างหนึ่ง เมื่อรู้ว่าใบสายตาระบุข้างเด่นไว้ว่าอะไร
 *
 *   dominant   'r' | 'l' | 'both' | ว่าง/ไม่รู้จัก
 *   eye        'r' | 'l'  — ข้างที่กำลังจะติดป้าย
 *
 * 'both' คือเด่นเท่ากันทั้งคู่ ทั้งสองข้างจึงเป็นตาหลัก ไม่มีข้างไหนเป็นตารอง
 * ไม่ได้ระบุไว้คืนค่าว่าง — ใบพิมพ์เว้นไว้ ดีกว่าเดาให้ช่างว่าข้างไหนนำ
 */
export function dominantEyeLabel(dominant, eye) {
  const d = String(dominant ?? '').trim().toLowerCase();
  if (!['r', 'l', 'both'].includes(d)) return '';
  return (d === 'both' || d === eye) ? 'ตาหลัก' : 'ตารอง';
}

const p2 = (x) => String(x).padStart(2, '0');

export function fmtDate(v) {
  if (!v) return '';
  const d = new Date(String(v).replace(' ', 'T'));
  if (isNaN(d)) return String(v);
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function fmtDateTime(v) {
  if (!v) return '';
  const d = new Date(String(v).replace(' ', 'T'));
  if (isNaN(d)) return String(v);
  return `${fmtDate(v)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export const dateOnly = (v) => (v ? String(v).slice(0, 10) : '');

/** value for <input type="datetime-local"> */
export const dtLocal = (v) => (v ? String(v).replace(' ', 'T').slice(0, 16) : '');

/** 'HH:MM' from a 'HH:MM:SS' time column */
export const hhmm = (t) => String(t || '').slice(0, 5);

/** datetime-local value -> the 'YYYY-MM-DD HH:mm' the API expects */
export const toStamp = (v) => (v || '').replace('T', ' ');

/**
 * ชื่อลูกค้าที่ใช้แสดงทั้งระบบ — ชื่อกลางอยู่ตรงกลางถ้ามี
 *
 * แถวที่ไม่มีคอลัมน์ mid_name (เช่นแถวจาก view เก่า) จะได้ชื่อ-สกุลเหมือนเดิม
 * เพราะ undefined ถูก filter ทิ้ง ไม่ต้องแยกทางเรียก
 */
export const custName = (r) =>
  [r?.first_name, r?.mid_name, r?.last_name].filter(Boolean).join(' ') || '(ไม่มีชื่อ)';

export const bookingName = (b) =>
  [b?.first_name, b?.last_name].filter(Boolean).join(' ') || '(ไม่ระบุชื่อ)';

/** current local time, formatted for <input type="datetime-local"> */
export function nowLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` +
    `T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** sum a column across rows, tolerating numeric strings */
export const sumBy = (rows, pick) => (rows || []).reduce((a, r) => a + n(pick(r)), 0);
