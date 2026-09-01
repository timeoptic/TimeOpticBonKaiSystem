'use client';
/**
 * ป้ายสถานะของใบขาย POS
 *
 * สองสถานะแยกกันคนละป้ายเสมอ ไม่มีป้ายรวม — เพราะ "จ่ายครบแล้วแต่ของยังไม่ไป"
 * กับ "ของไปแล้วแต่ยังค้างเงิน" เป็นคนละเรื่อง และหน้าร้านต้องอ่านออกทั้งสองอย่าง
 * ในบรรทัดเดียว
 */
import { PAYMENT_STATUS, FULFILLMENT_STATUS } from '../../lib/pos/posApi.js';

export function PaymentBadge({ sale }) {
  if (sale?.status === 'void') return <span className="pos-badge void">ยกเลิกแล้ว</span>;
  const [label, kind] = PAYMENT_STATUS[sale?.payment_status] || ['—', ''];
  return <span className={`pos-badge ${kind}`}>{label}</span>;
}

export function FulfillmentBadge({ sale }) {
  const [label, kind] = FULFILLMENT_STATUS[sale?.fulfillment_status] || ['—', ''];
  return <span className={`pos-badge ${kind}`}>{label}</span>;
}
