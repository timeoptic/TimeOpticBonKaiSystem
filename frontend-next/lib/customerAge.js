/**
 * อายุลูกค้าจากวันเกิด — แสดงที่หัวเคส (ต่อท้ายชื่อ) และต่อท้ายแถว "วันเกิด"
 *
 * แยกไฟล์ ไม่ได้ใส่ใน lib/format.js เพราะไฟล์นั้นอยู่ใน chunk ที่แทบทุกหน้าโหลด
 * เพิ่มฟังก์ชันที่นั่น = ต้องขึ้นหน้าเว็บใหม่ทุกหน้า (ดู deploy/README.md)
 *
 * นับเป็นปีเต็ม — ถึงวันเกิดของปีนี้แล้วค่อยนับเพิ่ม · เกิด 29 ก.พ. ในปีที่ไม่มีวันนั้น
 * นับเพิ่มวันที่ 1 มี.ค. · วันเกิดที่อ่านไม่ได้ อยู่ในอนาคต (มักเป็นปี พ.ศ. ที่กรอกลงช่อง
 * ค.ศ.) หรืออายุเกิน 120 ปี ถือว่าข้อมูลผิด ไม่แสดงอายุเลย ดีกว่าแสดงเลขที่ผิด
 */

const MAX_AGE = 120;

/** "1981-03-12" หรือ "1981-03-12 00:00:00" → { y, m, d } · อย่างอื่น null */
function parts(value) {
  const hit = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!hit) return null;
  const [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/** วันนี้ตามนาฬิกาของเครื่อง (เวลาท้องถิ่น ไม่ใช่ UTC — หลังเที่ยงคืนไทยต้องเป็นวันใหม่แล้ว) */
function localToday() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * @param {string|null|undefined} birthDate  YYYY-MM-DD จาก API
 * @param {string} [today]                    YYYY-MM-DD · ไม่ส่งมา = วันนี้ของเครื่อง
 * @returns {number|null}
 */
export function ageYears(birthDate, today = localToday()) {
  const b = parts(birthDate);
  const t = parts(today);
  if (!b || !t) return null;
  let age = t.y - b.y;
  if (t.m < b.m || (t.m === b.m && t.d < b.d)) age -= 1;
  return age < 0 || age > MAX_AGE ? null : age;
}

/**
 * "45 ปี" · ยังไม่ครบขวบ "ไม่ถึง 1 ปี" · ไม่มีหรือข้อมูลผิด null
 * @param {string|null|undefined} birthDate
 * @param {string} [today]
 */
export function ageText(birthDate, today) {
  const age = ageYears(birthDate, today);
  if (age === null) return null;
  return age === 0 ? 'ไม่ถึง 1 ปี' : `${age} ปี`;
}

/**
 * ค่าของแถว "วันเกิด" — "12/03/1981 (45 ปี)" · ไม่มีอายุ เหลือแค่วันเกิดตามที่ fmt จัดรูป
 * @param {string|null|undefined} birthDate
 * @param {(d: string|null|undefined) => string} fmt  ปกติคือ fmtDate
 * @param {string} [today]
 */
export function birthWithAge(birthDate, fmt, today) {
  const date = fmt(birthDate) || '';
  const age = ageText(birthDate, today);
  return date && age ? `${date} (${age})` : date;
}

/**
 * อายุของลูกค้ารายนี้ ไม่ว่าจะรู้มาทางไหน
 *
 * วันเกิดชนะเสมอเมื่อมี เพราะคำนวณได้แม่นถึงวัน · ไม่มีวันเกิดก็ใช้อายุที่ลูกค้า
 * บอกไว้ บวกจำนวนปีที่ผ่านไปตั้งแต่วันที่ถาม — ค่าที่เก็บไว้เมื่อสามปีก่อนจึงไม่ค้าง
 * อยู่ที่เลขเดิม (ดู customers.age_years / age_recorded_on)
 *
 * @param {Record<string, unknown>|null|undefined} c  แถวลูกค้า หรือแถวเคสที่มีคอลัมน์ลูกค้าพ่วงมา
 * @param {string} [today]
 * @returns {{ years: number, from: 'birth'|'asked', recordedOn: string|null } | null}
 */
export function ageOf(c, today = localToday()) {
  const byBirth = ageYears(c?.birth_date, today);
  if (byBirth !== null) return { years: byBirth, from: 'birth', recordedOn: null };

  const said = Number(c?.age_years);
  if (!Number.isInteger(said) || said < 0 || said > MAX_AGE) return null;

  const asked = parts(c?.age_recorded_on);
  const now = parts(today);
  if (!asked || !now) return null;
  let gone = now.y - asked.y;
  if (now.m < asked.m || (now.m === asked.m && now.d < asked.d)) gone -= 1;
  /* วันที่ถามอยู่ในอนาคต (นาฬิกาเครื่องเพี้ยน) ไม่ใช่เหตุให้อายุลดลง */
  if (gone < 0) gone = 0;

  const years = said + gone;
  if (years > MAX_AGE) return null;
  return { years, from: 'asked', recordedOn: `${asked.y}-${String(asked.m).padStart(2, '0')}-${String(asked.d).padStart(2, '0')}` };
}

/** "45 ปี" จากวันเกิดหรือจากอายุที่ถามไว้ · ไม่รู้เลย null */
export function ageTextOf(c, today) {
  const a = ageOf(c, today);
  if (!a) return null;
  return a.years === 0 ? 'ไม่ถึง 1 ปี' : `${a.years} ปี`;
}

/**
 * ค่าของแถว "วันเกิด" บนหน้าจอ — รับได้ทั้งลูกค้าที่บอกวันเกิดและที่บอกมาแค่อายุ
 *
 * ลูกค้าที่บอกแค่อายุขึ้นว่า "ไม่ทราบ — อายุ 45 ปี (ถามเมื่อ 16/09/2026)" · วันที่กำกับ
 * สำคัญ เพราะเลขนี้ไม่ได้วัดจากอะไร มันคือสิ่งที่ลูกค้าพูดในวันนั้น
 *
 * @param {Record<string, unknown>|null|undefined} c
 * @param {(d: string|null|undefined) => string} fmt  ปกติคือ fmtDate
 * @param {string} [today]
 */
export function birthOrAge(c, fmt, today) {
  const birth = fmt(c?.birth_date) || '';
  if (birth) return birthWithAge(c?.birth_date, fmt, today);

  const a = ageOf(c, today);
  if (!a) return '';
  const asked = fmt(a.recordedOn);
  return `ไม่ทราบ — อายุ ${a.years} ปี${asked ? ` (ถามเมื่อ ${asked})` : ''}`;
}
