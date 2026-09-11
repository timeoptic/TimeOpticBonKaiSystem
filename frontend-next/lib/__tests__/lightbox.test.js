import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  wrapIndex,
  clampZoom,
  stepZoom,
  wheelZoom,
  pinchZoom,
  swipeStep,
  clampPan,
  counterLabel,
  isPreviewable,
} from '../lightbox.js';

/* ── ลำดับรูป ─────────────────────────────────────────────────────────── */

test('wrapIndex: ถัดจากรูปสุดท้ายวนกลับรูปแรก', () => {
  assert.equal(wrapIndex(10, 10), 0);
});

test('wrapIndex: ก่อนหน้ารูปแรกวนไปรูปสุดท้าย', () => {
  assert.equal(wrapIndex(-1, 10), 9);
});

test('wrapIndex: อยู่ในช่วงอยู่แล้วคืนค่าเดิม', () => {
  assert.equal(wrapIndex(3, 10), 3);
});

/* กล่องที่เพิ่งลบรูปใบสุดท้ายทิ้งระหว่างที่ lightbox เปิดอยู่ ต้องไม่ได้ NaN
   ไปเป็น index ของอาร์เรย์ */
test('wrapIndex: ไม่มีรูปเลยคืน 0 ไม่ใช่ NaN', () => {
  assert.equal(wrapIndex(2, 0), 0);
});

test('counterLabel: บอกลำดับแบบ 3 / 10 นับจากหนึ่ง', () => {
  assert.equal(counterLabel(2, 10), '3 / 10');
});

/* ── ซูม ──────────────────────────────────────────────────────────────── */

test('clampZoom: ไม่เล็กกว่าขนาดพอดีจอ และไม่เกินเพดาน', () => {
  assert.equal(clampZoom(0.2), ZOOM_MIN);
  assert.equal(clampZoom(99), ZOOM_MAX);
  assert.equal(clampZoom(2), 2);
});

/* ย่อกลับด้วยการคูณหารทศนิยมจะค้างที่ 0.9999… แล้วรูปขยับได้นิดหนึ่งทั้งที่ควร
   อยู่นิ่งตรงกลาง จึงต้องดีดกลับเป็น 1 พอดี */
test('stepZoom: + ขยาย - ย่อ และย่อกลับถึงขนาดพอดีจอพอดี ไม่ค้าง 0.99', () => {
  const up = stepZoom(1, +1);
  assert.ok(up > 1);
  assert.equal(stepZoom(up, -1), 1);
  assert.equal(stepZoom(1, -1), 1);
  assert.equal(stepZoom(ZOOM_MAX, +1), ZOOM_MAX);
});

test('wheelZoom: เลื่อนล้อขึ้น (deltaY ติดลบ) ขยาย เลื่อนลงย่อ', () => {
  assert.ok(wheelZoom(1, -100) > 1);
  assert.equal(wheelZoom(1, 100), 1);
  assert.ok(wheelZoom(3, 100) < 3);
});

/* trackpad ส่ง deltaY ละเอียดเป็นสิบ ๆ ครั้งต่อการปัดหนึ่งที ถ้าแต่ละครั้งกระโดด
   เท่าล้อเมาส์หนึ่งคลิก รูปจะพุ่งไปเพดานในเสี้ยววินาที */
test('wheelZoom: deltaY เล็ก ๆ จาก trackpad ขยับทีละนิด ไม่กระโดด', () => {
  const z = wheelZoom(1, -4);
  assert.ok(z > 1 && z < 1.1);
});

test('pinchZoom: นิ้วห่างขึ้นสองเท่า ขยายสองเท่าจากตอนเริ่มบีบ', () => {
  assert.equal(pinchZoom(1.5, 100, 200), 3);
});

test('pinchZoom: ระยะเริ่มเป็นศูนย์ไม่หารศูนย์', () => {
  assert.equal(pinchZoom(2, 0, 150), 2);
});

test('pinchZoom: ถ่างเกินเพดานถูกตัด', () => {
  assert.equal(pinchZoom(4, 100, 400), ZOOM_MAX);
});

/* ── ปัดเปลี่ยนรูปบนมือถือ ─────────────────────────────────────────────── */

test('swipeStep: ปัดไปทางซ้ายไกลพอ = รูปถัดไป', () => {
  assert.equal(swipeStep(-80, 5), 1);
});

test('swipeStep: ปัดไปทางขวาไกลพอ = รูปก่อนหน้า', () => {
  assert.equal(swipeStep(80, -5), -1);
});

test('swipeStep: นิ้วขยับนิดเดียวตอนแตะ ไม่นับเป็นการปัด', () => {
  assert.equal(swipeStep(-20, 0), 0);
});

/* คนที่ลากลงเพื่อจะปิด หรือไถแนวตั้งโดยไม่ตั้งใจ ต้องไม่ถูกพาไปรูปอื่น */
test('swipeStep: ลากแนวตั้งมากกว่าแนวนอน ไม่นับ', () => {
  assert.equal(swipeStep(-70, 120), 0);
});

/* ── เลื่อนรูปตอนขยาย ──────────────────────────────────────────────────── */

test('clampPan: ขนาดพอดีจอ เลื่อนไม่ได้เลย', () => {
  assert.deepEqual(clampPan(50, 50, 1, 400, 300), { x: 0, y: 0 });
});

/* รูปที่แสดงอยู่ 400×300 ขยายสองเท่าเป็น 800×600 ล้นกรอบเดิมไปข้างละ 200×150
   เลื่อนเกินนั้นคือลากขอบรูปเข้ามากลางจอจนเห็นพื้นหลังดำ */
test('clampPan: ขยาย 2 เท่า เลื่อนได้ไม่เกินส่วนที่ล้นข้างละครึ่ง', () => {
  assert.deepEqual(clampPan(999, -999, 2, 400, 300), { x: 200, y: -150 });
  assert.deepEqual(clampPan(10, 20, 2, 400, 300), { x: 10, y: 20 });
});

/* ── อะไรเปิดใน lightbox ได้ ─────────────────────────────────────────────── */

test('isPreviewable: รูปเปิดดูได้ PDF กับค่าว่างไม่ได้', () => {
  assert.equal(isPreviewable('image/png'), true);
  assert.equal(isPreviewable('image/webp'), true);
  assert.equal(isPreviewable('image/jpeg'), true);
  assert.equal(isPreviewable('application/pdf'), false);
  assert.equal(isPreviewable(null), false);
  assert.equal(isPreviewable(''), false);
});
