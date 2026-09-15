import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FILL_FIELDS, emptyFields, fillBody, fillProblems, missingRequired, missingText, phoneMatches,
} from '../customerFill.js';

const FULL = { birth_date: '1981-03-12', phone: '0812345678', line_id: 'x', email: 'a@b.co', sex: 'Female' };

test('FILL_FIELDS: ห้าช่องที่เติมได้ บังคับแค่วันเกิดกับเบอร์โทร', () => {
  assert.deepEqual(FILL_FIELDS.map((f) => f.key), ['birth_date', 'phone', 'line_id', 'email', 'sex']);
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
