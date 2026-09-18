/**
 * "เติมข้อมูลลูกค้า" ในขั้นรับลูกค้า — ช่องไหนนับว่าขาด ช่องไหนเติมได้ และส่งอะไรไป API
 * แยกออกมาจาก CustomerFillDialog.jsx เพื่อให้เทสต์ได้โดยไม่ต้อง mount React
 *
 * เติมได้เฉพาะช่องที่ยังว่าง — แก้ค่าที่มีอยู่แล้วต้องไปที่หน้าแก้ไขข้อมูลลูกค้า
 * ฝั่ง API (POST /api/customers/:id/fill) บังคับซ้ำ: ช่องที่มีค่าอยู่แล้วเขียนทับไม่ได้
 *
 * แยกไฟล์ ไม่ได้ใส่ใน lib/format.js ด้วยเหตุผลเดียวกับ lib/customerAge.js
 */
import { ageYears } from './customerAge.js';

/**
 * @typedef {{ key: 'birth_date'|'phone'|'line_id'|'email'|'sex', label: string, required?: boolean }} FillField
 */

/* บังคับแค่วันเกิด (ใช้คิดอายุ ค่า ADD) กับเบอร์โทร (ใช้ตามลูกค้า) — LINE อีเมล เพศ
   ลูกค้าหลายคนไม่มี ถ้านับว่าขาดด้วย ป้ายจะขึ้นแทบทุกเคสจนไม่มีใครอ่าน */
/** @type {FillField[]} */
export const FILL_FIELDS = [
  { key: 'birth_date', label: 'วันเกิด', required: true },
  /* ลูกค้าที่บอกมาแค่อายุ — ไม่ใช่ช่องบังคับของตัวเอง แต่กรอกแล้วถือว่าตอบ "วันเกิด" แทนได้
     (ดู missingRequired) เพราะทั้งสองช่องมีไว้ตอบคำถามเดียวกันคือ ลูกค้าอายุเท่าไหร่ */
  { key: 'age_years', label: 'อายุ' },
  { key: 'phone', label: 'เบอร์โทร', required: true },
  { key: 'line_id', label: 'LINE / WhatsApp' },
  { key: 'email', label: 'อีเมล' },
  { key: 'sex', label: 'เพศ' },
];

const blank = (v) => v === null || v === undefined || String(v).trim() === '';

/** ป้ายของช่องบังคับที่ยังว่าง เช่น ['วันเกิด', 'เบอร์โทร'] */
export const missingRequired = (c) => FILL_FIELDS
  .filter((f) => f.required && blank(c?.[f.key]))
  /* มีอายุแล้วไม่ต้องทวงวันเกิด — ป้ายที่ทวงของที่ร้านตอบไปแล้ว คือป้ายที่คนจะเลิกอ่าน */
  .filter((f) => !(f.key === 'birth_date' && !blank(c?.age_years)))
  .map((f) => f.label);

/** "ข้อมูลลูกค้ายังไม่ครบ: วันเกิด, เบอร์โทร" · ครบแล้ว null */
export function missingText(c) {
  const miss = missingRequired(c);
  return miss.length ? `ข้อมูลลูกค้ายังไม่ครบ: ${miss.join(', ')}` : null;
}

/** ทุกช่องที่ยังว่าง ทั้งบังคับและไม่บังคับ — ช่องที่ popup จะให้กรอก */
export const emptyFields = (c) => FILL_FIELDS
  .filter((f) => blank(c?.[f.key]))
  /* มีวันเกิดแล้วอายุคิดเองได้ ไม่ต้องเสนอให้กรอก — และ API ก็ปฏิเสธด้วย 409 อยู่ดี */
  .filter((f) => !(f.key === 'age_years' && !blank(c?.birth_date)));

/**
 * body ของ POST /api/customers/:id/fill — เฉพาะช่องที่ว่างในลูกค้าและกรอกมาจริง
 * @param {Record<string, string>} values
 * @param {Record<string, unknown>} c       แถวเคส (มีคอลัมน์ลูกค้าพ่วงมา)
 * @param {number} caseId
 */
export function fillBody(values, c, caseId) {
  const body = { case_id: caseId };
  for (const f of emptyFields(c)) {
    const v = String(values?.[f.key] ?? '').trim();
    if (v !== '') body[f.key] = v;
  }
  return body;
}

/** วันที่มีอยู่จริงในปฏิทิน (2024-02-30 ไม่ผ่าน) */
function realDate(ymd) {
  const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!hit) return false;
  const d = new Date(Date.UTC(Number(hit[1]), Number(hit[2]) - 1, Number(hit[3])));
  return d.getUTCFullYear() === Number(hit[1]) && d.getUTCMonth() === Number(hit[2]) - 1 && d.getUTCDate() === Number(hit[3]);
}

/**
 * ข้อความปัญหาของค่าที่กรอก — ว่างทั้งหมดได้ [] (ช่องว่างแปลว่ายังไม่เติม ไม่ใช่ผิด)
 * กฎเดียวกับฝั่ง API ตรวจก่อนส่งจะได้ไม่ต้องรอ 400
 * @param {Record<string, string>} values
 * @param {string} [today]  YYYY-MM-DD
 */
export function fillProblems(values, today) {
  const out = [];
  const birth = String(values?.birth_date ?? '').trim();
  if (birth && (!realDate(birth) || ageYears(birth, today) === null)) out.push('วันเกิดไม่ถูกต้อง');
  const age = String(values?.age_years ?? '').trim();
  if (age && (!/^\d{1,3}$/.test(age) || Number(age) > 120)) out.push('อายุต้องเป็นตัวเลข 0–120 ปี');
  /* กรอกทั้งคู่มา API จะทิ้งอายุแล้วใช้วันเกิด — บอกตรงนี้ดีกว่าให้ค่าหายเงียบ ๆ ตอนบันทึก */
  if (birth && age) out.push('กรอกได้อย่างเดียว — มีวันเกิดแล้วระบบคิดอายุให้เอง');
  const phone = String(values?.phone ?? '').trim();
  if (phone && phone.replace(/\D+/g, '').length < 9) out.push('เบอร์โทรต้องมีตัวเลขอย่างน้อย 9 หลัก');
  const email = String(values?.email ?? '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) out.push('อีเมลไม่ถูกต้อง');
  return out;
}

/** ลูกค้าคนอื่นที่ใช้เบอร์เดียวกัน จากคำตอบของ POST /api/customers/duplicates */
export const phoneMatches = (res) => (res?.matches || [])
  .filter((m) => (m.why || []).includes('เบอร์โทรตรงกัน'));
