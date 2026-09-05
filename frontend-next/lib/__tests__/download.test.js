import test from 'node:test';
import assert from 'node:assert/strict';
import { fileNameFromDisposition, safeName } from '../download.js';

test('safeName เปลี่ยนอักขระที่ Windows ห้ามใช้ในชื่อไฟล์', () => {
  assert.equal(safeName('รายงาน 2026/09/01'), 'รายงาน 2026-09-01');
  assert.equal(safeName('a:b*c?d"e<f>g|h'), 'a-b-c-d-e-f-g-h');
});

test('อ่านชื่อไทยจาก filename* ไม่ใช่ชื่อสำรอง ASCII ที่มาก่อนหน้า', () => {
  const h = 'attachment; filename="sales-report-2026-01-01_2026-12-31.xlsx"; '
    + "filename*=UTF-8''%E0%B8%A3%E0%B8%B2%E0%B8%A2%E0%B8%87%E0%B8%B2%E0%B8%99%20"
    + '%E0%B8%A2%E0%B8%AD%E0%B8%94%E0%B8%82%E0%B8%B2%E0%B8%A2%202026.xlsx';
  assert.equal(fileNameFromDisposition(h), 'รายงาน ยอดขาย 2026.xlsx');
});

test('ไม่มี filename* ก็ใช้ filename= ธรรมดา', () => {
  assert.equal(
    fileNameFromDisposition('attachment; filename="report.xlsx"'),
    'report.xlsx'
  );
  assert.equal(fileNameFromDisposition('attachment; filename=report.xlsx'), 'report.xlsx');
});

test('ไม่มีหัวนี้เลยคืนค่าว่าง ให้ผู้เรียกใช้ชื่อสำรองของตัวเอง', () => {
  /* เกิดขึ้นจริงเวลาเรียกข้ามพอร์ตแล้วเซิร์ฟเวอร์ไม่ได้ประกาศ
     Access-Control-Expose-Headers — เบราว์เซอร์ซ่อนหัวนี้ไปเฉย ๆ */
  assert.equal(fileNameFromDisposition(null), '');
  assert.equal(fileNameFromDisposition(''), '');
  assert.equal(fileNameFromDisposition('attachment'), '');
});

test('ชื่อที่เข้ารหัสมาไม่ครบ ตกไปใช้ชื่อสำรองแทนที่จะพัง', () => {
  const h = "attachment; filename=\"report.xlsx\"; filename*=UTF-8''%E0%B8";
  assert.equal(fileNameFromDisposition(h), 'report.xlsx');
});
