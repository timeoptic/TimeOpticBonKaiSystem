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
