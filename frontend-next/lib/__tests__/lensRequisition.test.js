import test from 'node:test';
import assert from 'node:assert/strict';
import { nextActions } from '../lens/requisition.js';

test('รอเบิก: ปุ่มไปทุกขั้นข้างหน้า + ยกเลิก', () => {
  assert.deepEqual(
    nextActions('pending', true).map((a) => a.to),
    ['issued', 'ordered', 'received', 'assembled', 'cancelled'],
  );
});

test('ขั้นกลาง: ไม่มีปุ่มย้อนกลับ', () => {
  assert.deepEqual(nextActions('ordered', true).map((a) => a.to), ['received', 'assembled', 'cancelled']);
});

test('ไม่มีค่าสายตาสุดท้าย: เหลือแค่ยกเลิก', () => {
  assert.deepEqual(nextActions('pending', false).map((a) => a.to), ['cancelled']);
});

test('ประกอบแล้ว / ยกเลิก: ไม่มีปุ่ม', () => {
  assert.deepEqual(nextActions('assembled', true), []);
  assert.deepEqual(nextActions('cancelled', true), []);
});
