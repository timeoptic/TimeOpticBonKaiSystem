import test from 'node:test';
import assert from 'node:assert/strict';
import { dyeColorOf, dyeValue, lensTintForSave } from '../lensTint.js';

test('อ่านชื่อสีจากค่าที่บันทึกไว้', () => {
  assert.equal(dyeColorOf(dyeValue('น้ำตาล')), 'น้ำตาล');
});

test('ค่าจากเลนส์ในสต็อกไม่ถือเป็นงานย้อม', () => {
  assert.equal(dyeColorOf('Photochromic'), '');
  assert.equal(dyeColorOf(null), '');
});

test('เลือกย้อมสีแล้วทับค่าจากสต็อก', () => {
  assert.equal(lensTintForSave('เทา', 'Photochromic'), 'ย้อมสี เทา');
});

test('เปลี่ยนเป็นไม่ย้อม ล้างค่าย้อมเดิมแต่เก็บค่าจากสต็อก', () => {
  assert.equal(lensTintForSave('', 'ย้อมสี เทา'), '');
  assert.equal(lensTintForSave('', 'Photochromic'), 'Photochromic');
  assert.equal(lensTintForSave('', undefined), undefined);
});
