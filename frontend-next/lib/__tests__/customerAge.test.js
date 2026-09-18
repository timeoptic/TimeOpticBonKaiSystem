import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageYears, ageText, birthWithAge, ageOf, ageTextOf, birthOrAge } from '../customerAge.js';

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

/* ── อายุที่ลูกค้าบอกมา (ไม่มีวันเกิด) ────────────────────────────────────── */

test('ageOf: มีวันเกิด วันเกิดชนะเสมอ แม้จะมีอายุที่เคยกรอกไว้ด้วย', () => {
  const a = ageOf({ birth_date: '1981-03-12', age_years: 12, age_recorded_on: '2026-01-01' }, '2026-09-16');
  assert.deepEqual(a, { years: 45, from: 'birth', recordedOn: null });
});

test('ageOf: ไม่มีวันเกิด ใช้อายุที่ถามไว้ บวกปีที่ผ่านไปตั้งแต่วันที่ถาม', () => {
  const c = { birth_date: null, age_years: 45, age_recorded_on: '2023-09-16' };
  assert.equal(ageOf(c, '2026-09-16').years, 48);
  assert.equal(ageOf(c, '2026-09-15').years, 47, 'ยังไม่ครบสามปี');
  assert.equal(ageOf(c, '2023-09-16').years, 45, 'วันที่ถามคือวันนี้');
  assert.equal(ageOf(c, '2026-09-16').from, 'asked');
});

test('ageOf: นาฬิกาเครื่องเพี้ยนจนวันที่ถามอยู่ในอนาคต อายุต้องไม่ลดลง', () => {
  assert.equal(ageOf({ age_years: 45, age_recorded_on: '2030-01-01' }, '2026-09-16').years, 45);
});

test('ageOf: ไม่มีอะไรให้คิด หรือค่าที่เก็บไว้ใช้ไม่ได้ ได้ null', () => {
  assert.equal(ageOf(null, '2026-09-16'), null);
  assert.equal(ageOf({}, '2026-09-16'), null);
  assert.equal(ageOf({ age_years: 45, age_recorded_on: null }, '2026-09-16'), null, 'ไม่รู้ว่าถามเมื่อไหร่');
  assert.equal(ageOf({ age_years: 'สี่สิบห้า', age_recorded_on: '2026-01-01' }, '2026-09-16'), null);
  assert.equal(ageOf({ age_years: 119, age_recorded_on: '2020-01-01' }, '2026-09-16'), null, 'บวกแล้วเกิน 120');
});

test('ageOf: อายุ 0 ใช้ได้ ไม่ใช่ค่าว่าง', () => {
  assert.equal(ageOf({ age_years: 0, age_recorded_on: '2026-09-16' }, '2026-09-16').years, 0);
  assert.equal(ageTextOf({ age_years: 0, age_recorded_on: '2026-09-16' }, '2026-09-16'), 'ไม่ถึง 1 ปี');
});

test('birthOrAge: มีวันเกิดได้รูปเดิม · มีแต่อายุบอกว่าถามเมื่อไหร่ · ไม่มีเลยได้ค่าว่าง', () => {
  const fmt = (d) => (d ? `[${d}]` : '');
  assert.equal(birthOrAge({ birth_date: '1981-03-12' }, fmt, '2026-09-16'), '[1981-03-12] (45 ปี)');
  assert.equal(
    birthOrAge({ birth_date: null, age_years: 45, age_recorded_on: '2026-09-16' }, fmt, '2026-09-16'),
    'ไม่ทราบ — อายุ 45 ปี (ถามเมื่อ [2026-09-16])',
  );
  assert.equal(birthOrAge({}, fmt, '2026-09-16'), '');
});
