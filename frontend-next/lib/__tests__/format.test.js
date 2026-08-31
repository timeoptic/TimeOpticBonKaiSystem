import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money, power, fmtDate, fmtDateTime, custName, hhmm, todayISO } from '../format.js';

test('money: baht sign, Thai grouping, 2dp', () => {
  assert.equal(money(1234.5), '฿1,234.50');
  assert.equal(money(null), '฿0.00');
});

test('power: signed 2dp for numbers, dash for blank, passthrough for non-numeric', () => {
  assert.equal(power(''), '—');
  assert.equal(power(null), '—');
  assert.equal(power(-1.25), '-1.25');
  assert.equal(power(2), '+2.00');
  assert.equal(power('plano'), 'plano');
});

test('fmtDate: DD/MM/YYYY from a MySQL datetime string', () => {
  assert.equal(fmtDate('2026-08-25 14:30:00'), '25/08/2026');
});

test('fmtDateTime: adds HH:MM', () => {
  assert.equal(fmtDateTime('2026-08-25 14:05:00'), '25/08/2026 14:05');
});

test('custName: joins first+mid+last, falls back when all blank', () => {
  assert.equal(custName({ first_name: 'สม', last_name: 'ชาย' }), 'สม ชาย');
  assert.equal(custName({ first_name: 'สม', mid_name: 'ศรี', last_name: 'ชาย' }), 'สม ศรี ชาย');
  /* แถวที่ไม่มีคอลัมน์ mid_name เลย ต้องได้ชื่อเหมือนเดิม ไม่ใช่มีช่องว่างเกิน */
  assert.equal(custName({ first_name: 'สม', mid_name: null, last_name: 'ชาย' }), 'สม ชาย');
  assert.equal(custName({ first_name: 'สม', mid_name: '', last_name: 'ชาย' }), 'สม ชาย');
  assert.equal(custName({ mid_name: 'ศรี' }), 'ศรี');
  assert.equal(custName({}), '(ไม่มีชื่อ)');
});

test('hhmm: truncates a HH:MM:SS time column', () => {
  assert.equal(hhmm('09:30:00'), '09:30');
  assert.equal(hhmm(null), '');
});

test('todayISO: offsets by days', () => {
  const iso = todayISO(0);
  assert.match(iso, /^\d{4}-\d{2}-\d{2}$/);
});
