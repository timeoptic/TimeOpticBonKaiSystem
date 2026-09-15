import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageYears, ageText, birthWithAge } from '../customerAge.js';

test('ageYears: ถึงวันเกิดปีนี้แล้ว นับปีเต็ม', () => {
  assert.equal(ageYears('1981-03-12', '2026-09-15'), 45);
});

test('ageYears: ยังไม่ถึงวันเกิดปีนี้ ยังไม่นับเพิ่ม', () => {
  assert.equal(ageYears('1981-12-01', '2026-09-15'), 44);
});

test('ageYears: วันนี้คือวันเกิดพอดี นับเพิ่มแล้ว', () => {
  assert.equal(ageYears('2000-09-15', '2026-09-15'), 26);
});

test('ageYears: เกิด 29 ก.พ. ปีที่ไม่มี 29 ก.พ. นับเพิ่มวันที่ 1 มี.ค.', () => {
  assert.equal(ageYears('2004-02-29', '2025-02-28'), 20);
  assert.equal(ageYears('2004-02-29', '2025-03-01'), 21);
});

test('ageYears: ค่าจาก API ที่มีเวลาต่อท้ายก็อ่านได้', () => {
  assert.equal(ageYears('1981-03-12 00:00:00', '2026-09-15'), 45);
});

test('ageYears: ไม่มีวันเกิด / อ่านไม่ได้ ได้ null', () => {
  assert.equal(ageYears(null, '2026-09-15'), null);
  assert.equal(ageYears('', '2026-09-15'), null);
  assert.equal(ageYears('0000-00-00', '2026-09-15'), null);
  assert.equal(ageYears('12/03/1981', '2026-09-15'), null);
});

/* กรอกปี พ.ศ. ลงช่อง ค.ศ. = วันเกิดในอนาคต · ปีตกหล่นเป็น 1900 = อายุเกินร้อย */
test('ageYears: วันเกิดในอนาคตหรืออายุเกิน 120 ปี ถือว่าข้อมูลผิด ได้ null', () => {
  assert.equal(ageYears('2524-03-12', '2026-09-15'), null);
  assert.equal(ageYears('1900-01-01', '2026-09-15'), null);
});

test('ageText: "45 ปี" · ยังไม่ครบขวบ "ไม่ถึง 1 ปี" · ไม่มีข้อมูล null', () => {
  assert.equal(ageText('1981-03-12', '2026-09-15'), '45 ปี');
  assert.equal(ageText('2026-05-01', '2026-09-15'), 'ไม่ถึง 1 ปี');
  assert.equal(ageText(null, '2026-09-15'), null);
});

test('ageText: ไม่ส่งวันนี้มา ใช้วันที่ของเครื่องตามเวลาท้องถิ่น', () => {
  const now = new Date();
  /* 1 ม.ค. ผ่านมาแล้วเสมอไม่ว่าวันนี้คือวันไหน */
  const born = `${now.getFullYear() - 30}-01-01`;
  assert.equal(ageText(born), '30 ปี');
});

test('birthWithAge: วันเกิดตามด้วยอายุในวงเล็บ ไม่มีอายุก็เหลือแค่วันเกิด', () => {
  const fmt = (d) => `[${d}]`;
  assert.equal(birthWithAge('1981-03-12', fmt, '2026-09-15'), '[1981-03-12] (45 ปี)');
  assert.equal(birthWithAge('2524-03-12', fmt, '2026-09-15'), '[2524-03-12]');
  assert.equal(birthWithAge(null, () => '', '2026-09-15'), '');
});
