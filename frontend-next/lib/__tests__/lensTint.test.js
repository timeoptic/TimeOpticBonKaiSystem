import test from 'node:test';
import assert from 'node:assert/strict';
import { TINT_COLORS, dyeColorOf, dyeLevelOf, dyeValue, lensTintForSave } from '../lensTint.js';

test('อ่านสีและระดับจากค่าที่บันทึกไว้', () => {
  const saved = dyeValue('เทาเขียว', 2);
  assert.equal(saved, 'ย้อมสี เทาเขียว ระดับ 2');
  assert.equal(dyeColorOf(saved), 'เทาเขียว');
  assert.equal(dyeLevelOf(saved), 2);
});

test('ออเดอร์เก่าที่ยังไม่มีระดับ อ่านได้และบันทึกซ้ำแล้วค่าเดิม', () => {
  assert.equal(dyeColorOf('ย้อมสี ม่วง'), 'ม่วง');
  assert.equal(dyeLevelOf('ย้อมสี ม่วง'), 0);
  assert.equal(lensTintForSave('ม่วง', 0, 'ย้อมสี ม่วง'), 'ย้อมสี ม่วง');
});

test('ค่าจากเลนส์ในสต็อกไม่ถือเป็นงานย้อม', () => {
  assert.equal(dyeColorOf('Photochromic'), '');
  assert.equal(dyeLevelOf('Photochromic'), 0);
  assert.equal(dyeColorOf(null), '');
});

test('เลือกย้อมสีแล้วทับค่าจากสต็อก', () => {
  assert.equal(lensTintForSave('เทา', 4, 'Photochromic'), 'ย้อมสี เทา ระดับ 4');
});

test('เปลี่ยนเป็นไม่ย้อม ล้างค่าย้อมเดิมแต่เก็บค่าจากสต็อก', () => {
  assert.equal(lensTintForSave('', 0, 'ย้อมสี เทา ระดับ 1'), '');
  assert.equal(lensTintForSave('', 0, 'Photochromic'), 'Photochromic');
  assert.equal(lensTintForSave('', 0, undefined), undefined);
});

test('มี 8 สี สีละ 4 ระดับ', () => {
  assert.equal(TINT_COLORS.length, 8);
  for (const c of TINT_COLORS) assert.equal(c.shades.length, 4);
});
