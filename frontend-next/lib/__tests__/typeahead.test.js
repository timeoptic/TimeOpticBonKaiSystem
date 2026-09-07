import test from 'node:test';
import assert from 'node:assert/strict';
import { typeaheadIndex } from '../typeahead.js';

const EMP = ['— เลือกพนักงาน —', 'สมชาย ใจดี', 'สมหญิง รักงาน', 'สุดา พากเพียร', 'อนันต์ มั่นคง'];

/* `<select>` ของเบราว์เซอร์ให้พิมพ์ตัวอักษรแล้วกระโดดไปตัวเลือกที่ขึ้นต้นด้วยตัวนั้น
   คนคีย์ข้อมูลใช้จริงกับรายการพนักงานที่ยาว ตัวที่วาดเองจึงต้องมีเหมือนกัน */
test('พิมพ์ตัวเดียว กระโดดไปตัวแรกที่ขึ้นต้นด้วยตัวนั้น', () => {
  assert.equal(typeaheadIndex(EMP, 'ส', -1), 1);
  assert.equal(typeaheadIndex(EMP, 'อ', -1), 4);
});

/* กดตัวเดิมซ้ำ = "ตัวถัดไปที่ขึ้นต้นเหมือนกัน" ไม่ใช่ค้างอยู่ตัวเดิม
   ชื่อไทยขึ้นต้นด้วย ส. กันหลายคน ถ้าไม่วนก็เลือกคนที่สองไม่ได้เลย */
test('กดตัวเดิมซ้ำ เดินไปตัวถัดไปที่ขึ้นต้นเหมือนกัน', () => {
  assert.equal(typeaheadIndex(EMP, 'สส', 1), 2);
  assert.equal(typeaheadIndex(EMP, 'สสส', 2), 3);
});

test('กดตัวเดิมซ้ำจนหมดรายการ วนกลับมาตัวแรก', () => {
  assert.equal(typeaheadIndex(EMP, 'สส', 3), 1);
});

/* พิมพ์ต่อเป็นคำ = กรองให้แคบลง ต้องไม่เดินหนีจากตัวที่ตรงอยู่แล้ว
   ไม่งั้นพิมพ์ 'สม' จะข้ามสมชายไปสมหญิงทั้งที่สมชายก็ตรง */
test('พิมพ์ต่อเป็นคำ อยู่กับตัวที่ยังตรง ไม่เดินหนี', () => {
  assert.equal(typeaheadIndex(EMP, 'สม', 1), 1);
  assert.equal(typeaheadIndex(EMP, 'สมห', 1), 2);
});

test('ไม่มีตัวไหนตรงเลยคืน -1 ไม่ใช่ 0', () => {
  assert.equal(typeaheadIndex(EMP, 'ฮ', -1), -1);
  assert.equal(typeaheadIndex(EMP, 'สมxyz', 1), -1);
});

test('ค่าว่างหรือรายการว่างคืน -1', () => {
  assert.equal(typeaheadIndex(EMP, '', 2), -1);
  assert.equal(typeaheadIndex(EMP, '   ', 2), -1);
  assert.equal(typeaheadIndex([], 'ส', -1), -1);
  assert.equal(typeaheadIndex(EMP, null, -1), -1);
});

/* ตัวเลือกภาษาอังกฤษพิมพ์เล็ก-ใหญ่ต้องเจอเท่ากัน — คนพิมพ์ไม่ได้ดูว่า label เขียนไว้ยังไง */
test('พิมพ์เล็กใหญ่ไม่ต่างกัน', () => {
  const opts = ['Cash', 'Credit card', 'transfer'];
  assert.equal(typeaheadIndex(opts, 'c', -1), 0);
  assert.equal(typeaheadIndex(opts, 'CR', -1), 1);
  assert.equal(typeaheadIndex(opts, 'T', -1), 2);
});

/* ยังไม่ได้ชี้อะไรเลย (current = -1) ต้องเริ่มค้นจากตัวแรก ไม่ใช่ตัวที่สอง */
test('ยังไม่ได้ชี้อะไร เริ่มค้นจากตัวแรก', () => {
  assert.equal(typeaheadIndex(['ก', 'ข'], 'ก', -1), 0);
});

/* label ที่หายไปหรือเป็นตัวเลข (เช่นจำนวนรายการต่อหน้า) ต้องไม่ทำให้ระเบิด */
test('label ที่ไม่ใช่ตัวหนังสือไม่ทำให้พัง', () => {
  assert.equal(typeaheadIndex([null, undefined, 25, '50'], '2', -1), 2);
  assert.equal(typeaheadIndex([null, undefined], 'ก', -1), -1);
});
