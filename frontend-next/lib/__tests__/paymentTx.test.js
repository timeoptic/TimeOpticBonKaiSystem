import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, openHref } from '../paymentTx.js';
import { CHANNELS } from '../reportRange.js';

/* ตัวกรอง "แหล่งที่มา" ของหน้าการรับเงินคือช่อง channel ตัวเดิมที่เปลี่ยนแค่ป้าย —
   คีย์ต้องตรงกับ CHANNELS ทุกตัว ไม่งั้น readFilter() ตีค่าที่เลือกกลับเป็น 'all' */
test('แหล่งที่มาใช้คีย์ชุดเดียวกับตัวกรองช่องทาง ป้ายเป็นภาษาของหน้าร้าน', () => {
  assert.deepEqual(SOURCES.map(([k]) => k), CHANNELS.map(([k]) => k));
  assert.deepEqual(SOURCES.map(([, l]) => l), ['ทั้งหมด', 'งานตัดแว่น', 'POS หน้าร้าน']);
});

test('เลขอ้างอิงเปิดรายการต้นทาง: เคส · ใบสั่ง · บิล POS', () => {
  assert.equal(openHref({ kind: 'case', id: 12 }), '/cases/detail?id=12');
  assert.equal(openHref({ kind: 'order', id: 7 }), '/orders/detail?id=7');
  assert.equal(openHref({ kind: 'pos', id: 305 }), '/pos/detail?id=305');
});

test('ขายสินค้าระบบเดิมไม่มีหน้าให้เปิด — ไม่มีลิงก์ ไม่ใช่ลิงก์ที่พาไปหน้าพัง', () => {
  assert.equal(openHref(null), null);
  assert.equal(openHref(undefined), null);
  assert.equal(openHref({ kind: 'unknown', id: 1 }), null);
});
