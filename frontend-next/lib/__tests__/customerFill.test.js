import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FILL_FIELDS, emptyFields, fillBody, fillProblems, missingRequired, missingText, phoneMatches,
} from '../customerFill.js';

const FULL = { birth_date: '1981-03-12', phone: '0812345678', line_id: 'x', email: 'a@b.co', sex: 'Female' };

test('FILL_FIELDS: หกช่องที่เติมได้ บังคับแค่วันเกิดกับเบอร์โทร', () => {
  assert.deepEqual(FILL_FIELDS.map((f) => f.key), ['birth_date', 'age_years', 'phone', 'line_id', 'email', 'sex']);
  assert.deepEqual(FILL_FIELDS.filter((f) => f.required).map((f) => f.key), ['birth_date', 'phone']);
});

test('missingRequired: ขาดวันเกิดกับเบอร์โทร · LINE อีเมล เพศ ไม่นับ', () => {
  assert.deepEqual(missingRequired({ ...FULL, birth_date: null, phone: '  ', line_id: '', email: null }), ['วันเกิด', 'เบอร์โทร']);
  assert.deepEqual(missingRequired(FULL), []);
});

test('missingText: ข้อความป้าย · ครบแล้วได้ null', () => {
  assert.equal(missingText({ ...FULL, birth_date: null }), 'ข้อมูลลูกค้ายังไม่ครบ: วันเกิด');
  assert.equal(missingText(FULL), null);
});

test('emptyFields: ทุกช่องที่ยังว่าง (รวมช่องไม่บังคับ) เรียงตาม FILL_FIELDS', () => {
  assert.deepEqual(emptyFields({ ...FULL, email: '', sex: null }).map((f) => f.key), ['email', 'sex']);
  assert.deepEqual(emptyFields(FULL), []);
});

test('อายุแทนวันเกิดได้: มีอายุแล้วป้ายไม่ทวงวันเกิด', () => {
  assert.deepEqual(missingRequired({ ...FULL, birth_date: null, age_years: 45 }), []);
  assert.equal(missingText({ ...FULL, birth_date: null, age_years: 45 }), null);
  /* อายุ 0 (เด็กไม่ถึงขวบ) ต้องนับว่าตอบแล้วเหมือนกัน ไม่ใช่ตกเป็นค่าว่าง */
  assert.deepEqual(missingRequired({ ...FULL, birth_date: null, age_years: 0 }), []);
  /* ยังไม่มีทั้งคู่ = ยังขาดวันเกิดอยู่ */
  assert.deepEqual(missingRequired({ ...FULL, birth_date: null, age_years: null }), ['วันเกิด']);
});

test('emptyFields: มีวันเกิดแล้วไม่เสนอช่องอายุ · ไม่มีวันเกิดจึงเสนอ', () => {
  assert.deepEqual(emptyFields({ ...FULL, age_years: null }).map((f) => f.key), []);
  assert.deepEqual(
    emptyFields({ ...FULL, birth_date: null, age_years: null }).map((f) => f.key),
    ['birth_date', 'age_years'],
  );
});

test('fillProblems: อายุนอกช่วง / ไม่ใช่ตัวเลข / กรอกคู่กับวันเกิด', () => {
  const today = '2026-09-16';
  assert.deepEqual(fillProblems({ age_years: '121' }, today), ['อายุต้องเป็นตัวเลข 0–120 ปี']);
  assert.deepEqual(fillProblems({ age_years: 'สี่สิบ' }, today), ['อายุต้องเป็นตัวเลข 0–120 ปี']);
  assert.deepEqual(fillProblems({ age_years: '45' }, today), []);
  assert.deepEqual(fillProblems({ age_years: '0' }, today), []);
  assert.deepEqual(
    fillProblems({ birth_date: '1981-03-12', age_years: '45' }, today),
    ['กรอกได้อย่างเดียว — มีวันเกิดแล้วระบบคิดอายุให้เอง'],
  );
});

test('fillBody: ส่งเฉพาะช่องที่ว่างในลูกค้าและกรอกมา ตัดช่องว่าง พร้อม case_id', () => {
  const c = { ...FULL, birth_date: null, phone: '', email: null };
  assert.deepEqual(
    fillBody({ birth_date: '1981-03-12', phone: ' 081-234-5678 ', email: '   ', line_id: 'แอบแก้' }, c, 7120),
    { case_id: 7120, birth_date: '1981-03-12', phone: '081-234-5678' },
  );
});

test('fillProblems: วันเกิดผิด / ไม่มีวันนั้น / อนาคต เบอร์สั้น อีเมลผิด', () => {
  const today = '2026-09-15';
  assert.deepEqual(fillProblems({ birth_date: '2524-03-12' }, today), ['วันเกิดไม่ถูกต้อง']);
  assert.deepEqual(fillProblems({ birth_date: '2024-02-30' }, today), ['วันเกิดไม่ถูกต้อง']);
  assert.deepEqual(fillProblems({ phone: '12-34' }, today), ['เบอร์โทรต้องมีตัวเลขอย่างน้อย 9 หลัก']);
  assert.deepEqual(fillProblems({ email: 'abc' }, today), ['อีเมลไม่ถูกต้อง']);
  assert.deepEqual(fillProblems({ birth_date: '1981-03-12', phone: '081-234-5678', email: 'a@b.co' }, today), []);
  assert.deepEqual(fillProblems({ birth_date: '', phone: '', email: '' }, today), []);
});

test('phoneMatches: เฉพาะลูกค้าที่เบอร์ตรงกัน ไม่เอาที่ชื่อซ้ำอย่างเดียว', () => {
  const res = {
    matches: [
      { id: 1, why: ['เบอร์โทรตรงกัน'] },
      { id: 2, why: ['ชื่อ-นามสกุลตรงกัน'] },
      { id: 3, why: ['ชื่อ-นามสกุลตรงกัน', 'เบอร์โทรตรงกัน'] },
    ],
  };
  assert.deepEqual(phoneMatches(res).map((m) => m.id), [1, 3]);
  assert.deepEqual(phoneMatches(null), []);
});
