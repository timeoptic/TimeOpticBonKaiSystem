import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHRINK_MAX_SIDE, isShrinkable, shrinkSize, canSkipShrink, jpegName, shrinkImage,
} from '../shrinkImage.js';

test('shrinkSize: รูปแนวนอนจาก iPad ย่อด้านยาวเหลือ 1600 คงสัดส่วน', () => {
  assert.deepEqual(shrinkSize(4032, 3024), { width: 1600, height: 1200 });
});

test('shrinkSize: รูปแนวตั้ง / สลิปยาว ย่อตามด้านสูง', () => {
  assert.deepEqual(shrinkSize(1080, 2400), { width: 720, height: 1600 });
});

test('shrinkSize: รูปไม่เกินเพดาน คืนขนาดเดิม ไม่ขยาย', () => {
  assert.deepEqual(shrinkSize(1200, 800), { width: 1200, height: 800 });
  assert.deepEqual(shrinkSize(SHRINK_MAX_SIDE, 10), { width: SHRINK_MAX_SIDE, height: 10 });
});

test('canSkipShrink: ภาพเล็กและไฟล์เล็ก ปล่อยผ่าน', () => {
  assert.equal(canSkipShrink(1200, 900, 200 * 1024), true);
});

test('canSkipShrink: ภาพเล็กแต่ไฟล์ใหญ่ (PNG) ยังต้องบีบ', () => {
  assert.equal(canSkipShrink(1200, 900, 3 * 1024 * 1024), false);
});

test('canSkipShrink: ภาพใหญ่ต้องย่อเสมอแม้ไฟล์เล็ก', () => {
  assert.equal(canSkipShrink(4032, 3024, 300 * 1024), false);
});

test('isShrinkable: รูปสามชนิดเท่านั้น PDF ไม่แตะ', () => {
  assert.equal(isShrinkable('image/jpeg'), true);
  assert.equal(isShrinkable('image/png'), true);
  assert.equal(isShrinkable('image/webp'), true);
  assert.equal(isShrinkable('application/pdf'), false);
  assert.equal(isShrinkable(''), false);
});

test('jpegName: เปลี่ยนนามสกุลเป็น .jpg', () => {
  assert.equal(jpegName('IMG_0012.PNG'), 'IMG_0012.jpg');
  assert.equal(jpegName('slip.2026.webp'), 'slip.2026.jpg');
  assert.equal(jpegName('noext'), 'noext.jpg');
  assert.equal(jpegName(''), 'photo.jpg');
});

test('shrinkImage: PDF คืนไฟล์เดิมตัวเดียวกัน', async () => {
  const pdf = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });
  assert.equal(await shrinkImage(pdf), pdf);
});

test('shrinkImage: นอกเบราว์เซอร์ (ไม่มี document) คืนไฟล์เดิม ไม่ throw', async () => {
  const jpg = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
  assert.equal(await shrinkImage(jpg), jpg);
});
