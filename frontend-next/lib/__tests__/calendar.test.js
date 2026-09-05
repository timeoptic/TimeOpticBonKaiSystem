import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysInMonth, leadOffset, shiftMonth, toDisplayDate, parseTypedDate,
} from '../calendar.js';

test('daysInMonth: ordinary months', () => {
  assert.equal(daysInMonth(2026, 1), 31);
  assert.equal(daysInMonth(2026, 4), 30);
});

test('daysInMonth: February, leap vs non-leap year', () => {
  assert.equal(daysInMonth(2024, 2), 29); // leap
  assert.equal(daysInMonth(2026, 2), 28); // not leap
});

test('leadOffset: day-of-week the 1st of the month falls on (0=Sun..6=Sat)', () => {
  // 2026-08-01 is a Saturday
  assert.equal(leadOffset(2026, 8), 6);
  // 2026-11-01 is a Sunday
  assert.equal(leadOffset(2026, 11), 0);
});

test('shiftMonth: steps forward and backward within a year', () => {
  assert.equal(shiftMonth('2026-08', 1), '2026-09');
  assert.equal(shiftMonth('2026-08', -1), '2026-07');
});

test('shiftMonth: crosses a year boundary in both directions', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('toDisplayDate: วันแบบที่คนอ่าน ไม่ใช่แบบที่ฐานข้อมูลเก็บ', () => {
  assert.equal(toDisplayDate('2026-09-04'), '04/09/2026');
  assert.equal(toDisplayDate('2026-09-04 13:45:00'), '04/09/2026');
});

/* ช่องว่างต้องออกมาว่าง ไม่ใช่ 'NaN/NaN/NaN' — ตัวกรองช่วงวันที่เริ่มต้นเป็นค่าว่างเสมอ */
test('toDisplayDate: ค่าว่างหรืออ่านไม่ออกคืนค่าว่าง', () => {
  assert.equal(toDisplayDate(''), '');
  assert.equal(toDisplayDate(null), '');
  assert.equal(toDisplayDate('อะไรสักอย่าง'), '');
});

test('parseTypedDate: ตัวคั่นแบบไหนก็อ่านออก และไม่มีตัวคั่นก็ได้', () => {
  assert.equal(parseTypedDate('4/9/2026'), '2026-09-04');
  assert.equal(parseTypedDate('04-09-2026'), '2026-09-04');
  assert.equal(parseTypedDate('04.09.2026'), '2026-09-04');
  assert.equal(parseTypedDate('04092026'), '2026-09-04');
  assert.equal(parseTypedDate('  4/9/2026  '), '2026-09-04');
});

/* ใบเสร็จที่ร้านเขียนเป็น พ.ศ. แต่ฐานข้อมูลเก็บ ค.ศ. — ถ้าไม่แปลงให้ คนพิมพ์ 2569
   จะได้วันที่ในอีกห้าร้อยปีข้างหน้าโดยไม่มีอะไรเตือน */
test('parseTypedDate: รับ พ.ศ. ทั้งสี่หลักและสองหลัก', () => {
  assert.equal(parseTypedDate('1/1/2569'), '2026-01-01');
  assert.equal(parseTypedDate('4/9/69'), '2026-09-04');
  assert.equal(parseTypedDate('2569-01-01'), '2026-01-01');
});

test('parseTypedDate: ก้อนสี่หลักนำหน้าคือปี ไม่ใช่วันที่', () => {
  assert.equal(parseTypedDate('2026-09-04'), '2026-09-04');
});

/* 31/02 ผ่านการเช็คว่า "อยู่ในช่วง 1-31" ได้ แต่ไม่มีในปฏิทิน ปล่อยไปแล้ว Date จะปัด
   ให้เป็น 03/03 เงียบ ๆ ซึ่งคือวันที่ผิดที่ไม่มีใครรู้ว่าผิด */
test('parseTypedDate: วันที่ไม่มีอยู่จริงต้องไม่ผ่าน', () => {
  assert.equal(parseTypedDate('31/02/2026'), null);
  assert.equal(parseTypedDate('29/2/2025'), null);
  assert.equal(parseTypedDate('29/2/2024'), '2024-02-29');
  assert.equal(parseTypedDate('1/13/2026'), null);
  assert.equal(parseTypedDate('0/1/2026'), null);
});

test('parseTypedDate: อ่านไม่ออกคืน null ไม่ใช่วันที่มั่ว', () => {
  assert.equal(parseTypedDate(''), null);
  assert.equal(parseTypedDate(null), null);
  assert.equal(parseTypedDate('abc'), null);
  assert.equal(parseTypedDate('4/9'), null);
});
