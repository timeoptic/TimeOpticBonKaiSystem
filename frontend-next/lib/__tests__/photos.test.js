import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CENTERING_PHOTO_MAX, photoUploadPlan } from '../photos.js';

test('CENTERING_PHOTO_MAX: กล่องรูปการวัดรับได้ 10 ใบต่อเคส', () => {
  assert.equal(CENTERING_PHOTO_MAX, 10);
});

test('photoUploadPlan: ยังไม่มีรูป เลือกมา 3 ใบ รับหมด', () => {
  assert.deepEqual(photoUploadPlan(3, 0, 10), { accept: 3, skipped: 0, full: false });
});

/* พนักงานเลือกรูปทีเดียวจากกล้อง เลือกเกินโควตาแล้วล้มทั้งชุดคือเสียเวลาเปล่า
   จึงรับเท่าที่โควตาเหลือ แล้วบอกจำนวนที่ข้ามไป */
test('photoUploadPlan: เหลือโควตา 3 แต่เลือกมา 8 รับ 3 ข้าม 5', () => {
  assert.deepEqual(photoUploadPlan(8, 7, 10), { accept: 3, skipped: 5, full: false });
});

test('photoUploadPlan: เหลือโควตาพอดี รับหมดและกล่องเต็มพอดี', () => {
  assert.deepEqual(photoUploadPlan(3, 7, 10), { accept: 3, skipped: 0, full: false });
});

test('photoUploadPlan: ครบ 10 แล้ว ไม่รับเลย', () => {
  assert.deepEqual(photoUploadPlan(4, 10, 10), { accept: 0, skipped: 4, full: true });
});

/* เคสเก่าที่มีรูปเกิน 10 ใบมาก่อนวันบังคับลิมิต — accept ต้องเป็น 0 ไม่ใช่เลขติดลบ
   ถ้าติดลบ files.slice(0, -2) จะคืนไฟล์เกือบทั้งชุดแทนที่จะคืนชุดว่าง */
test('photoUploadPlan: เคสเก่าที่มีรูปเกินลิมิต ไม่รับเพิ่มและไม่ติดลบ', () => {
  assert.deepEqual(photoUploadPlan(2, 13, 10), { accept: 0, skipped: 2, full: true });
});

/* กล่องสลิปกับกล่องไฟล์ส่งมอบใช้คอมโพเนนต์เดียวกันแต่ไม่มีลิมิต */
test('photoUploadPlan: ไม่ส่ง max มา = ไม่จำกัด รับทุกใบ', () => {
  assert.deepEqual(photoUploadPlan(40, 99, null), { accept: 40, skipped: 0, full: false });
});
