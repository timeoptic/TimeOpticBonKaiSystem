// frontend-next/lib/__tests__/posRxRef.test.js
/**
 * ค่าสายตาอ้างอิงของ POS — ตอนขายคอนแทคเลนส์
 *
 * สเปก: docs/superpowers/specs/2026-09-16-pos-contact-lens-eye-exam-design.md
 *
 * สองเรื่องที่ไฟล์นี้เฝ้าไว้:
 *
 *   1. **เลือกใบที่ถูก** — หน้า POS ขอ "ผลวัดล่าสุด" ของลูกค้า แต่รอบล่าสุดอาจยัง
 *      ไม่มีใบ final (วัดค้างไว้) ต้องข้ามไปหารอบที่มี ไม่ใช่คืนรอบแรกแล้วจบ
 *   2. **ค่าว่างต้องเป็นขีด ไม่ใช่ 0.00** — กฎเดิมของทั้งแอป: 0.00 เป็นค่าสายตาจริง
 *      จึงแทน "ไม่มีข้อมูล" ไม่ได้ · ค่าอ้างอิงที่โชว์ผิดแปลว่าพนักงานหยิบกล่องผิด
 *
 * รูปแบบข้อความยึดตาม `ExamHistory.jsx` เพื่อให้ค่าเดียวกันหน้าตาเหมือนกันทุกที่
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { latestFinalSession, eyeRefText } from '../pos/rxRef.js';

/* โครงเดียวกับที่ examSessions() คืนมา — เรียงรอบใหม่ไปเก่า (test_date DESC) */
const withFinal = {
  key: 'case-7',
  case_id: 7,
  case_code: 'CASE-2026-00007',
  exam_date: '2026-09-10 10:00:00',
  final: { id: 91, kind: 'final', r_sphere: '-2.50', l_sphere: '-2.00' },
  measured: { id: 90, kind: 'measured' },
  old: null,
};

/* รอบที่ใหม่กว่า แต่ยังวัดค้าง ไม่มีใบ final */
const unfinished = {
  key: 'rx-120',
  case_id: null,
  case_code: null,
  exam_date: '2026-09-15 09:00:00',
  final: null,
  measured: { id: 120, kind: 'measured' },
  old: null,
};

const row = {
  r_sphere: '-2.50', r_cylinder: '-0.75', r_axis: '180',
  l_sphere: '-2.00', l_cylinder: '', l_axis: '',
};

test('latestFinalSession: ข้ามรอบที่ยังไม่มีใบ final ไปเอารอบที่มี', () => {
  const s = latestFinalSession([unfinished, withFinal]);
  assert.equal(s.key, 'case-7');
  assert.equal(s.final.id, 91);
});

/* คืนทั้งรอบ ไม่ใช่แค่ใบ final — หน้า POS ต้องโชว์วันที่วัดและเลขเคสที่มาด้วย */
test('latestFinalSession: คืนทั้งรอบ เพื่อให้อ่านวันที่วัดและเลขเคสได้', () => {
  const s = latestFinalSession([withFinal]);
  assert.equal(s.exam_date, '2026-09-10 10:00:00');
  assert.equal(s.case_code, 'CASE-2026-00007');
});

test('latestFinalSession: ไม่มีรอบไหนมีใบ final -> null', () => {
  assert.equal(latestFinalSession([unfinished]), null);
});

test('latestFinalSession: ไม่มีข้อมูล -> null ไม่ใช่ throw', () => {
  assert.equal(latestFinalSession([]), null);
  assert.equal(latestFinalSession(null), null);
  assert.equal(latestFinalSession(undefined), null);
});

test('eyeRefText: ข้างขวาอ่านคอลัมน์ r_*', () => {
  assert.equal(eyeRefText(row, 'R'), 'R -2.50 / -0.75 × 180');
});

test('eyeRefText: ข้างซ้ายอ่านคอลัมน์ l_*', () => {
  assert.equal(eyeRefText(row, 'L'), 'L -2.00 / — × —');
});

test('eyeRefText: ทั้งสองข้างแสดงทั้ง R และ L', () => {
  assert.equal(eyeRefText(row, 'RL'), 'R -2.50 / -0.75 × 180 · L -2.00 / — × —');
});

/* 0.00 คือค่าสายตาจริง ห้ามเอามาแทนช่องที่ไม่ได้กรอก */
test('eyeRefText: ค่าว่างเป็นขีด ส่วน 0 เป็นศูนย์จริง', () => {
  const zero = { r_sphere: '0', r_cylinder: '', r_axis: '' };
  assert.equal(eyeRefText(zero, 'R'), 'R 0.00 / — × —');
});

test('eyeRefText: ยังไม่ได้แนบใบวัด -> ข้อความว่าง', () => {
  assert.equal(eyeRefText(null, 'R'), '');
  assert.equal(eyeRefText(undefined, 'RL'), '');
});

/* ข้างที่ไม่รู้จักต้องไม่พังและไม่เดา — ช่อง choice อาจได้ค่าแปลกจากบิลเก่า */
test('eyeRefText: ข้างที่ไม่รู้จัก -> ข้อความว่าง', () => {
  assert.equal(eyeRefText(row, ''), '');
  assert.equal(eyeRefText(row, 'X'), '');
});
