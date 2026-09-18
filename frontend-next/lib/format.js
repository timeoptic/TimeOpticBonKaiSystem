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
 * รุ่นเลนส์โดยไม่มีค่าสายตาท้ายชื่อ — "G Blue Single Vision (1.60) -6.00/-1.25" → "G Blue Single Vision (1.60)"
 *
 * ชื่อสินค้าเลนส์ในร้านต่อท้ายด้วย "SPH/CYL" เสมอ ใบวัดสายตามีค่าพวกนั้นในตารางอยู่แล้ว
 * จึงพิมพ์แค่รุ่น (ร้านขอ 12 ก.ย. 2026) · ชื่อที่ไม่มีคู่ตัวเลขท้ายชื่อคืนตามเดิม
 */
export const lensModelName = (name) =>
  String(name ?? '').replace(/\s+[+-]?\d{1,2}(?:\.\d+)?\s*\/\s*[+-]?\d{1,2}(?:\.\d+)?\s*$/, '').trim();

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
 * ค่ากำลังสายตา (SPH / CYL / ADD) ในรูปแบบเดียวของทั้งระบบ: เครื่องหมาย ตัวเลข
 * จุด สองตำแหน่ง เช่น -1.25 · +2.00
 *
 * ไม่เติมศูนย์หน้า — พิมพ์ 4 ได้ '+4.00' ไม่ใช่ '+04.00' เขียนอย่างที่คนอ่านใบสายตา
 * เขียนกันจริง และตรงกับ diopter() ฝั่งสต๊อกที่ไม่เติมศูนย์อยู่แล้ว
 * ทศนิยมยังบังคับสองตำแหน่งเสมอ ค่าเดียวกันจึงมีหน้าตาเดียวไม่ว่าจะพิมพ์มาแบบไหน
 *
 * ศูนย์ไม่มีเครื่องหมาย — '0.00' ไม่ใช่ '+0.00' หรือ '-0.00' เพราะมันไม่ได้บวกหรือลบจริง
 *
 * @param {string} s  ค่าที่พิมพ์มา ผ่านการ trim แล้ว ไม่ใช่ค่าว่าง
 * @returns {{num: number, fixed: string, error: string}} `fixed` คือตัวเลขล้วนไม่มีเครื่องหมาย
 */
function rxPowerParts(s, label, eg) {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) {
    return { num: 0, fixed: '', error: `${label} ต้องเป็นตัวเลข เช่น ${eg}` };
  }
  const num = Number(s);
  /* ปัดเศษก่อนค่อยวัดขนาด — 99.999 ปัดแล้วเป็น 100.00 ซึ่งเกินเพดาน ทั้งที่ตัวเลข
     ดิบยังไม่ถึง 100 เช็คจากค่าดิบอย่างเดียวจะปล่อยให้หลุดออกมาเป็น 100.00 */
  const fixed = Math.abs(num).toFixed(2);
  if (fixed.length > 5) return { num, fixed: '', error: `${label} ต้องน้อยกว่า 100.00` };
  return { num, fixed, error: '' };
}

/** ติดเครื่องหมายตามค่า — ศูนย์ไม่ติดอะไรเลย */
const rxSigned = (num, fixed) => (Number(fixed) === 0 ? fixed : (num < 0 ? '-' : '+') + fixed);

/**
 * SPH — กำลังสายตาสั้น/ยาว เป็นบวกก็ได้ ลบก็ได้ ตามที่วัดมา
 *
 *   '-1.25' -> '-1.25'   ·   '2' -> '+2.00'   ·   '0' -> '0.00'   ·   '' -> ''
 */
export function normSphere(v) {
  const s = String(v ?? '').trim();
  if (s === '') return { value: '', error: '' };
  const { num, fixed, error } = rxPowerParts(s, 'SPH', '-1.25');
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
 *   '-0.75' -> '-0.75'   ·   '0.75' -> '-0.75'   ·   '0' -> '0.00'   ·   '' -> ''
 */
export function normCyl(v) {
  const s = String(v ?? '').trim();
  if (s === '') return { value: '', error: '' };
  const { num, fixed, error } = rxPowerParts(s, 'CYL', '-0.75');
  if (error) return { value: s, error };
  return { value: rxSigned(-Math.abs(num), fixed), error: '' };
}

/**
 * ADD — กำลังบวกสำหรับมองใกล้ เป็นบวกเสมอ
 *
 * เครื่องหมายลบที่พิมพ์มาถือว่าพิมพ์พลาด ไม่ใช่ค่าคนละอย่าง — ADD ติดลบไม่มีในทางปฏิบัติ
 * จึงพลิกเป็นบวกให้เลย ต่างจาก CYL ที่ค่าบวกอาจแปลว่าใบนั้นเขียนคนละระบบ
 *
 *   '2' -> '+2.00'   ·   '.75' -> '+0.75'   ·   '-1.75' -> '+1.75'   ·   '' -> ''
 */
export function normAdd(v) {
  const s = String(v ?? '').trim();
  if (s === '') return { value: '', error: '' };
  const { num, fixed, error } = rxPowerParts(s, 'ADD', '+2.00');
  if (error) return { value: s, error };
  return { value: rxSigned(Math.abs(num), fixed), error: '' };
}

/**
 * VA — ระดับการมองเห็น ไม่ใช่กำลังเลนส์ จึงไม่มีเครื่องหมายและไม่มีหน่วยเป็น diopter
 *
 * ร้านนี้บันทึกเป็นทศนิยม 0.0–1.0 โดย 1.0 คือเห็นเต็ม ค่านอกช่วงนี้ไม่ได้แปลว่าอะไรเลย
 * — ใบเก่าที่มี '12' หรือ '1212' ค้างอยู่คือค่าที่หลุดเข้ามาก่อนมีกติกานี้
 *
 * ละเอียดได้ถึงทศนิยมหนึ่งตำแหน่ง และค่าที่ละเอียดกว่านั้นถือว่าผิด **ไม่ปัดให้**
 * ด้วยเหตุผลเดียวกับ AXIS: 0.75 ที่ถูกปัดเป็น 0.8 ให้เอง คือค่าที่ไม่มีใครวัดได้จริง
 * โผล่ในใบตรวจโดยไม่มีใครรู้ว่ามันไม่ใช่ของที่วัดมา
 *
 *   '1' -> '1.0'   ·   '.8' -> '0.8'   ·   '0.60' -> '0.6'   ·   '' -> ''
 *   '12' / '1.2' / '0.75' / '-0.5' -> ผิด
 */
export function normVa(v) {
  const s = String(v ?? '').trim();
  if (s === '') return { value: '', error: '' };
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) {
    return { value: s, error: 'VA ต้องเป็นตัวเลข 0.0–1.0 เช่น 0.8' };
  }
  const x = Number(s);
  if (x > 1) return { value: s, error: 'VA ต้องอยู่ระหว่าง 0.0–1.0' };
  /* เทียบกับค่าที่ปัดแล้ว แทนที่จะนับตัวอักษรหลังจุด — '0.60' คือ 0.6 ที่พิมพ์ยาว
     ไม่ใช่ค่าที่ละเอียดเกิน ส่วน '0.75' ปัดแล้วได้คนละค่า จึงเป็นค่าที่กรอกไม่ได้จริง */
  if (Math.round(x * 10) / 10 !== x) {
    return { value: s, error: 'VA ละเอียดได้ถึงทศนิยม 1 ตำแหน่ง เช่น 0.8' };
  }
  return { value: x.toFixed(1), error: '' };
}

/**
 * CYL กับ AXIS ของตาข้างหนึ่ง — ไม่บังคับกรอก แต่ถ้ากรอกต้องมาด้วยกัน
 *
 * ค่าเอียงที่ไม่มีองศาสั่งตัดไม่ได้ ส่วนองศาที่ไม่มีค่าเอียงก็ไม่ได้บอกอะไร ทั้งคู่เป็นใบ
 * ที่ห้องผลิตต้องโทรกลับมาถาม ต่างจากการเว้นว่างทั้งคู่ ซึ่งแปลว่า "ไม่ได้บันทึกค่าเอียงไว้"
 * และเป็นคำตอบที่ใช้ได้
 *
 * ศูนย์เป็นค่าที่กรอกแล้ว ไม่ใช่ช่องว่าง — AXIS 0 องศา และ CYL 0.00 มีจริงทั้งคู่
 *
 * @returns {{field: string, error: string} | null} ช่องที่ยังขาด หรือ null เมื่อผ่าน
 */
export function rxPairMissing(eye) {
  const cyl = String(eye?.cylinder ?? '').trim();
  const axis = String(eye?.axis ?? '').trim();
  if (cyl !== '' && axis === '') return { field: 'axis', error: 'กรอก CYL แล้วต้องกรอก AXIS ด้วย' };
  if (axis !== '' && cyl === '') return { field: 'cylinder', error: 'กรอก AXIS แล้วต้องกรอก CYL ด้วย' };
  return null;
}

/**
 * ค่ากำลังสายตาสำหรับ "แสดงผล" — ใบพิมพ์ หน้าออเดอร์ ตารางสรุป ต้องอ่านได้รูปแบบ
 * เดียวกับที่กรอกในหน้าวัดสายตา ไม่งั้นค่าเดียวกันจะมีสองหน้าตาแล้วแต่ว่าดูจากที่ไหน
 * และใบเก่าที่เก็บเป็น '2.00' หรือ '+02.00' ก็จะอ่านออกมาเท่ากับใบใหม่ที่เก็บเป็น '+2.00'
 * — ค่าที่เคยบันทึกไว้สมัยเติมศูนย์หน้าจึงไม่ต้องแก้ในฐาน อ่านตอนแสดงผลก็ตรงกันเอง
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

/**
 * แว่นคู่นี้เป็นแบบไหน (Distance / Reading / Progressive …) ของใบสายตาหนึ่งใบ
 *
 * รายการเดียวกันแต่อยู่คนละคอลัมน์ตามชนิดใบ — ใบแว่นเดิม (kind='old') ถามว่า "คู่ที่ใส่มา
 * เป็นแบบไหน" เก็บใน old_glasses_type ส่วนใบที่วัด/ใช้จริงถามว่า "คู่ใหม่สั่งไว้ใช้ทำอะไร"
 * เก็บใน test_for · ไม่ได้ระบุคืนค่าว่าง ให้คนเรียกตัดสินเองว่าจะแสดงอะไรแทน
 */
export function glassesUseOf(row) {
  if (!row) return '';
  const v = row.kind === 'old' ? row.old_glasses_type : row.test_for;
  return String(v ?? '').trim();
}

/**
 * แบบของแว่นที่ได้จากรอบตรวจหนึ่งรอบ — คู่ที่สั่งตัดในรอบนั้น
 *
 * รอบเก่าที่ถูกดึงมาเป็น "แว่นเดิม" ของวันนี้ ก็คือคู่ที่รอบนั้นสั่งตัดไว้ จึงอ่านจากใบ final
 * (หรือ measured ถ้ายังไม่ได้ยืนยัน) ห้ามอ่านแว่นเดิมของรอบนั้น ซึ่งเป็นคู่ที่เก่ากว่าอีกคู่
 */
export const roundGlassesUse = (session) => glassesUseOf(session?.final || session?.measured);

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
