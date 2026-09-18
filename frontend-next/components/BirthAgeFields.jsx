'use client';
/**
 * วันเกิด + อายุ — สองช่องที่ตอบคำถามเดียวกัน จึงต้องอยู่ด้วยกันและรู้จักกัน
 *
 * ลูกค้าบางรายบอกมาแค่อายุ ไม่ทราบหรือไม่บอกวันเกิด · ขั้นวัดสายตาต้องใช้อายุคิดค่า ADD
 * ระบบจึงต้องจดได้ทั้งสองแบบ โดยไม่แอบเดาวันเกิดให้ใครจากอายุ (ดู customers.age_years)
 *
 * กติกาบนจอ สะท้อนกติกาใน api/routes/customers.php ตรง ๆ:
 *
 *   กรอกวันเกิด  → ช่องอายุกลายเป็นเลขที่คำนวณให้ แก้ไม่ได้ และไม่ถูกส่งไปกับฟอร์ม
 *                  (readForm ข้าม element ที่ disabled) ฝั่ง API ก็ล้าง age_years ทิ้ง
 *   ไม่มีวันเกิด → ช่องอายุพิมพ์ได้ ค่าที่กรอกถูกเก็บพร้อมวันที่ถาม
 *
 * ที่ต้องเป็นช่องเดียวสลับโหมด ไม่ใช่สองช่องที่กรอกได้พร้อมกัน: ฐานเก็บได้คำตอบเดียว
 * ช่องที่กรอกได้แต่ค่าหายตอนบันทึก คือช่องที่คนกรอกจะไม่มีวันรู้ว่ามันหาย
 */
import { useState } from 'react';
import { Field } from './ui.jsx';
import { DateField } from './DateField.jsx';
import { ageText } from '../lib/customerAge.js';
import { fmtDate } from '../lib/format.js';

/**
 * @param {object} p
 * @param {string} [p.birthDate]      ค่าเริ่มต้นของวันเกิด (YYYY-MM-DD)
 * @param {number|string|null} [p.ageYears]  อายุที่เคยบันทึกไว้
 * @param {string|null} [p.ageRecordedOn]    วันที่เคยถามอายุ
 */
export function BirthAgeFields({ birthDate = '', ageYears = null, ageRecordedOn = null }) {
  const [birth, setBirth] = useState(birthDate || '');
  const derived = ageText(birth);
  const saved = ageYears === null || ageYears === undefined || ageYears === '' ? '' : String(ageYears);
  const asked = ageRecordedOn ? fmtDate(ageRecordedOn) : '';

  return (
    <>
      <Field label="วันเกิด / Birth date">
        <DateField name="birth_date" value={birth} onChange={setBirth} />
      </Field>
      <Field
        label="อายุ / Age"
        hint={birth
          ? 'คิดจากวันเกิดให้อัตโนมัติ'
          : `กรอกเมื่อลูกค้าไม่ทราบวันเกิด${asked ? ` · ถามไว้เมื่อ ${asked}` : ''}`}
      >
        {birth ? (
          <input key="derived" value={derived || '—'} disabled readOnly />
        ) : (
          <input
            key="entry"
            name="age_years"
            type="number"
            inputMode="numeric"
            min="0"
            max="120"
            step="1"
            placeholder="เช่น 45"
            defaultValue={saved}
          />
        )}
      </Field>
    </>
  );
}
