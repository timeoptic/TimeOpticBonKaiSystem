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
