import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bahtText, bahtTextEn, thaiInteger, englishInteger,
} from '../bahttext.js';

test('thaiInteger: หลักสิบและหลักหน่วยที่อ่านไม่เหมือนตัวเลข', () => {
  assert.equal(thaiInteger(0), 'ศูนย์');
  assert.equal(thaiInteger(1), 'หนึ่ง');
  assert.equal(thaiInteger(10), 'สิบ');          // ไม่ใช่ "หนึ่งสิบ"
  assert.equal(thaiInteger(11), 'สิบเอ็ด');       // ไม่ใช่ "สิบหนึ่ง"
  assert.equal(thaiInteger(20), 'ยี่สิบ');         // ไม่ใช่ "สองสิบ"
  assert.equal(thaiInteger(21), 'ยี่สิบเอ็ด');
  assert.equal(thaiInteger(101), 'หนึ่งร้อยเอ็ด');
});

test('thaiInteger: หลักพันขึ้นไป และการซ้อนคำว่าล้าน', () => {
  assert.equal(thaiInteger(3800), 'สามพันแปดร้อย');
  assert.equal(thaiInteger(15250), 'หนึ่งหมื่นห้าพันสองร้อยห้าสิบ');
  assert.equal(thaiInteger(1000000), 'หนึ่งล้าน');
  assert.equal(thaiInteger(2500000), 'สองล้านห้าแสน');
  /* ยอดที่ทำสูตร BAHTTEXT ของ Excel พัง — ที่นี่ต้องอ่านออกปกติ */
  assert.equal(thaiInteger(1000000000), 'หนึ่งพันล้าน');
});

test('bahtText: ลงท้าย "ถ้วน" เมื่อไม่มีเศษสตางค์', () => {
  assert.equal(bahtText(0), 'ศูนย์บาทถ้วน');
  assert.equal(bahtText(3800), 'สามพันแปดร้อยบาทถ้วน');
  assert.equal(bahtText('15250.00'), 'หนึ่งหมื่นห้าพันสองร้อยห้าสิบบาทถ้วน');
});

test('bahtText: มีเศษสตางค์ และการปัดสองตำแหน่ง', () => {
  assert.equal(bahtText(1234.5), 'หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์');
  assert.equal(bahtText(0.25), 'ศูนย์บาทยี่สิบห้าสตางค์');
  /* 3550.005 ปัดขึ้นเป็น 3550.01 ไม่ใช่ปัดทิ้งจนเหลือ "ถ้วน" */
  assert.equal(bahtText(3550.005), 'สามพันห้าร้อยห้าสิบบาทหนึ่งสตางค์');
});

test('bahtText: ยอดติดลบ (ใบที่มีแต่ส่วนลด) อ่านออก ไม่ใช่ NaN', () => {
  assert.equal(bahtText(-500), 'ลบห้าร้อยบาทถ้วน');
});

test('englishInteger: หลักสิบ ยี่สิบ และการเว้นวรรคหลักใหญ่', () => {
  assert.equal(englishInteger(0), 'zero');
  assert.equal(englishInteger(15), 'fifteen');
  assert.equal(englishInteger(21), 'twenty-one');
  assert.equal(englishInteger(3800), 'three thousand eight hundred');
  assert.equal(englishInteger(1000000), 'one million');
});

test('bahtTextEn: ขึ้นต้นตัวใหญ่ และปิดท้าย "only" เมื่อไม่มีสตางค์', () => {
  assert.equal(bahtTextEn(3800), 'Three thousand eight hundred baht only');
  assert.equal(bahtTextEn(1234.5), 'One thousand two hundred thirty-four baht fifty satang');
});
