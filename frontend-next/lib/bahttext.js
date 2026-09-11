/**
 * จำนวนเงิน → คำอ่าน สำหรับบรรทัด "Total / รวม" ท้ายใบเสร็จ
 *
 * ฟอร์ม Excel เดิมของร้านใช้สูตร BAHTTEXT() ซึ่งพังเมื่อยอดเกินช่วงที่มันรับได้
 * (ใบที่ส่งมาให้ดูขึ้นว่า "number too large baht") ที่นี่จึงคำนวณเองทั้งสองภาษา
 * ไม่พึ่ง locale หรือ Intl — คำอ่านต้องออกมาเหมือนกันทุกเครื่องที่สั่งพิมพ์
 *
 * กฎการอ่านภาษาไทยที่โค้ดนี้ต้องทำให้ถูก (ตรงตามที่กรมสรรพากรใช้):
 *   - หลักสิบ 1 → "สิบ" ไม่ใช่ "หนึ่งสิบ"        (10 = สิบบาทถ้วน)
 *   - หลักสิบ 2 → "ยี่สิบ" ไม่ใช่ "สองสิบ"        (20 = ยี่สิบบาทถ้วน)
 *   - หลักหน่วย 1 ที่มีหลักอื่นนำหน้า → "เอ็ด"   (21 = ยี่สิบเอ็ดบาทถ้วน)
 *   - เกินเจ็ดหลัก อ่านเป็น "ล้าน" ซ้อนกัน       (1,000,000 = หนึ่งล้านบาทถ้วน)
 *   - ไม่มีสตางค์ → ปิดท้าย "ถ้วน" มีสตางค์ → "...บาท...สตางค์"
 */

const TH_DIGIT = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const TH_PLACE = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

/** อ่านจำนวนเต็มไม่เกิน 7 หลัก (0–9,999,999) — ตัวช่วยของ thaiInteger */
function readGroup(digits) {
  let out = '';
  const len = digits.length;
  for (let i = 0; i < len; i += 1) {
    const d = Number(digits[i]);
    const place = len - i - 1;     // 0 = หน่วย, 1 = สิบ, ...
    if (d === 0) continue;
    if (place === 1 && d === 1) { out += 'สิบ'; continue; }
    if (place === 1 && d === 2) { out += 'ยี่สิบ'; continue; }
    /* "เอ็ด" ใช้เฉพาะหลักหน่วยที่มีตัวอื่นนำหน้ามาแล้ว — ลำพัง 1 คือ "หนึ่ง" */
    if (place === 0 && d === 1 && len > 1) { out += 'เอ็ด'; continue; }
    out += TH_DIGIT[d] + TH_PLACE[place];
  }
  return out;
}

/** จำนวนเต็ม → คำอ่านไทย ไม่มีหน่วยเงินต่อท้าย */
export function thaiInteger(int) {
  const s = String(int);
  if (s === '0') return 'ศูนย์';
  /* เกินเจ็ดหลักต้องซอยเป็นก้อนละหกหลักจากขวา แล้วต่อด้วย "ล้าน" ทีละชั้น
     เช่น 1,000,000,000 = หนึ่งพัน|ล้าน = "หนึ่งพันล้าน" */
  const groups = [];
  let rest = s;
  while (rest.length > 6) {
    groups.unshift(rest.slice(-6));
    rest = rest.slice(0, -6);
  }
  groups.unshift(rest);
  return groups.map(readGroup).join('ล้าน');
}

/**
 * ยอดเงิน → "…บาทถ้วน" / "…บาท…สตางค์"
 * ปัดเป็นสองตำแหน่งก่อนอ่านเสมอ ค่าที่ส่งมาอาจเป็นสตริงจาก PDO
 */
export function bahtText(v) {
  const amount = Math.round((Number(v) || 0) * 100) / 100;
  const neg = amount < 0;
  const abs = Math.abs(amount);
  const int = Math.floor(abs);
  const satang = Math.round((abs - int) * 100);
  const head = satang === 0
    ? `${thaiInteger(int)}บาทถ้วน`
    : `${thaiInteger(int)}บาท${thaiInteger(satang)}สตางค์`;
  return neg ? `ลบ${head}` : head;
}

const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALE = [['million', 1e6], ['thousand', 1e3], ['hundred', 1e2]];

/** จำนวนเต็ม → คำอ่านอังกฤษ ไม่มีหน่วยเงินต่อท้าย */
export function englishInteger(int) {
  if (int < 20) return EN_ONES[int];
  if (int < 100) {
    const rest = int % 10;
    return EN_TENS[Math.floor(int / 10)] + (rest ? `-${EN_ONES[rest]}` : '');
  }
  for (const [word, size] of EN_SCALE) {
    if (int >= size) {
      const rest = int % size;
      return `${englishInteger(Math.floor(int / size))} ${word}${rest ? ` ${englishInteger(rest)}` : ''}`;
    }
  }
  return EN_ONES[int];
}

/**
 * ยอดเงิน → "… baht" / "… baht … satang"
 * บรรทัด Total ของฟอร์มเดิมเป็นภาษาอังกฤษ จึงต้องมีคู่กับ bahtText
 *
 * ไม่มี "only" ปิดท้ายจำนวนเต็ม (ร้านขอตัดออก) — ต่างจากฝั่งไทยที่ยังลงท้ายว่า "ถ้วน"
 * เพราะ "ถ้วน" เป็นคำที่ใบเสร็จไทยต้องมีจริง ๆ ไว้กันคนเติมเลขต่อท้าย ส่วน only เป็น
 * แค่ธรรมเนียมการเขียนเช็ค ไม่ได้ทำหน้าที่นั้นบนใบที่พิมพ์ด้วยเครื่อง
 */
export function bahtTextEn(v) {
  const amount = Math.round((Number(v) || 0) * 100) / 100;
  const neg = amount < 0;
  const abs = Math.abs(amount);
  const int = Math.floor(abs);
  const satang = Math.round((abs - int) * 100);
  const head = satang === 0
    ? `${englishInteger(int)} baht`
    : `${englishInteger(int)} baht ${englishInteger(satang)} satang`;
  const cased = head.charAt(0).toUpperCase() + head.slice(1);
  return neg ? `Minus ${head}` : cased;
}
