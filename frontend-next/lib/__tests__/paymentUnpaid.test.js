import test from 'node:test';
import assert from 'node:assert/strict';
import { UNPAID, activeUnpaid, isUnpaidRow, unpaidBlockedReason } from '../paymentUnpaid.js';

/* กติกาเดียวกับ POST /api/payments (api/tests/98-payment-unpaid.test.php) — หน้าเว็บแค่บอก
   ก่อนกด ด่านจริงอยู่ที่ API */

const row = (over = {}) => ({ id: 1, kind: 'deposit', amount: '500.00', cancelled_at: null, ...over });

test('รู้จักแถว "ยังไม่ชำระ" จากประเภท', () => {
  assert.equal(UNPAID, 'unpaid');
  assert.equal(isUnpaidRow(row({ kind: 'unpaid' })), true);
  assert.equal(isUnpaidRow(row()), false);
  assert.equal(isUnpaidRow(null), false);
});

test('"ยังไม่ชำระ" ที่ยังมีผล = ตัวที่ไม่ถูกยกเลิก', () => {
  const live = row({ id: 3, kind: 'unpaid', amount: '0.00' });
  assert.equal(activeUnpaid([row(), row({ id: 2, kind: 'unpaid', cancelled_at: '2026-09-14 10:00:00' }), live]), live);
  assert.equal(activeUnpaid([row(), row({ id: 2, kind: 'unpaid', cancelled_at: '2026-09-14 10:00:00' })]), null);
  assert.equal(activeUnpaid(undefined), null);
});

test('บันทึก "ยังไม่ชำระ" ได้เมื่อมีออเดอร์ที่ยังค้าง และยังไม่เคยบันทึกไว้', () => {
  assert.equal(unpaidBlockedReason({ hasOrder: true, left: 800, payments: [row()] }), null);
});

test('บันทึก "ยังไม่ชำระ" ไม่ได้ — บอกเหตุผลเป็นคำที่พนักงานอ่านรู้เรื่อง', () => {
  assert.match(unpaidBlockedReason({ hasOrder: false, left: 0, payments: [] }), /ออเดอร์/);
  assert.match(unpaidBlockedReason({ hasOrder: true, left: 0, payments: [] }), /ไม่มียอดค้าง/);
  assert.match(
    unpaidBlockedReason({ hasOrder: true, left: 800, payments: [row({ kind: 'unpaid', amount: '0.00' })] }),
    /บันทึกว่ายังไม่ชำระไว้แล้ว/,
  );
});
