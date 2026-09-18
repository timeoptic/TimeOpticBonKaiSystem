/**
 * รับเงินประเภท "ยังไม่ชำระ" — รายการ 0 บาทที่บอกว่าลูกค้าจะมาจ่ายตอนรับของ
 *
 * ร้านขอ 14 ก.ย. 2026 · ด่านจริงอยู่ที่ POST /api/payments (api/tests/98-payment-unpaid.test.php)
 * ที่นี่ใช้กติกาชุดเดียวกันเพื่อบอกพนักงานก่อนกด ไม่ใช่ให้กดแล้วค่อยเด้ง error
 */

export const UNPAID = 'unpaid';

export const isUnpaidRow = (p) => !!p && p.kind === UNPAID;

/** รายการ "ยังไม่ชำระ" ที่ยังมีผลอยู่ (ไม่ถูกยกเลิก) — มีได้รายการเดียวต่อออเดอร์ */
export function activeUnpaid(payments) {
  return (payments || []).find((p) => isUnpaidRow(p) && !p.cancelled_at) || null;
}

/** เหตุผลที่บันทึก "ยังไม่ชำระ" ไม่ได้ตอนนี้ — null = บันทึกได้ */
export function unpaidBlockedReason({ hasOrder, left, payments }) {
  if (!hasOrder) return 'ต้องมีออเดอร์ก่อนจึงบันทึก "ยังไม่ชำระ" ได้';
  if (!(Number(left) > 0)) return 'ออเดอร์นี้ไม่มียอดค้าง บันทึก "ยังไม่ชำระ" ไม่ได้';
  if (activeUnpaid(payments)) return 'บันทึกว่ายังไม่ชำระไว้แล้ว — ถ้าจะบันทึกใหม่ให้ลบรายการเดิมก่อน';
  return null;
}
