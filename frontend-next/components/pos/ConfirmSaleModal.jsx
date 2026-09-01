'use client';
/**
 * กล่องยืนยันก่อนบันทึก
 *
 * ไม่ save ทันทีที่กด "ชำระเงิน" โดยตั้งใจ — ใบขายที่บันทึกผิดแก้ไม่ได้ (ยกเลิก
 * ได้อย่างเดียว และการยกเลิกทิ้งร่องรอยไว้ในรายงาน) ต้นทุนของการอ่านซ้ำหนึ่งครั้ง
 * ถูกกว่าใบที่ต้องยกเลิกมาก
 *
 * ปุ่มยืนยันปิดตัวเองทันทีที่กด และคำขอพก client_ref เดิมไปด้วยเสมอ — สองชั้น
 * เพราะชั้นแรกกันการกดซ้ำในหน้า ส่วนชั้นที่สองกันเน็ตหลุดแล้วกดใหม่
 */
import { money } from '../../lib/format.js';
import { lineTotal } from '../../lib/pos/cart.js';
import { payMethodLabel } from '../../lib/pos/posApi.js';

export function ConfirmSaleModal({ items, sums, form, change, busy, error, onBack, onConfirm }) {
  const payNow = Number(form.amount) || 0;
  const balance = Math.max(0, Math.round((sums.total - payNow) * 100) / 100);

  return (
    <div className="pos-modal-scrim" role="dialog" aria-modal="true">
      <div className="pos-modal">
        <div className="pos-modal-head">
          <h2>ตรวจสอบก่อนบันทึก</h2>
        </div>

        <div className="pos-modal-body">
          <div className="pos-confirm-line">
            <span>ลูกค้า</span>
            <b>
              {[form.customerName, form.customerPhone].filter(Boolean).join(' · ') || 'ลูกค้าทั่วไป'}
            </b>
          </div>

          <hr style={{ border: 0, borderTop: '1px solid #ececec', margin: '10px 0' }} />

          {items.map((it) => (
            <div className="pos-confirm-line" key={it.key}>
              <span>
                {it.pos_custom ? it.custom_name : it.name}
                <small style={{ display: 'block' }}>
                  {it.quantity} × {money(it.unit_price)}
                  {Object.entries(it.item_meta || {})
                    .filter(([k, v]) => k !== 'custom_name' && String(v).trim())
                    .map(([k, v]) => ` · ${v}`)
                    .join('')}
                </small>
              </span>
              <b>{money(lineTotal(it))}</b>
            </div>
          ))}

          <hr style={{ border: 0, borderTop: '1px solid #ececec', margin: '10px 0' }} />

          <div className="pos-confirm-line total"><span>ยอดสุทธิ</span><span>{money(sums.total)}</span></div>
          <div className="pos-confirm-line">
            <span>ชำระวันนี้ ({payMethodLabel(form.method)})</span><b>{money(payNow)}</b>
          </div>
          {form.method === 'cash' && payNow > 0 && (
            <div className="pos-confirm-line"><span>เงินทอน</span><b>{money(change)}</b></div>
          )}
          <div className="pos-confirm-line">
            <span>ยอดค้าง</span>
            <b style={{ color: balance > 0 ? '#c0392b' : 'inherit' }}>{money(balance)}</b>
          </div>
          <div className="pos-confirm-line">
            <span>สถานะรับสินค้า</span>
            <b>{form.delivered ? 'ส่งมอบสินค้าแล้ว' : 'ยังไม่ส่งมอบ / รอลูกค้ามารับ'}</b>
          </div>

          {error && <p className="pos-err">{error}</p>}
        </div>

        <div className="pos-modal-foot">
          <button type="button" className="pos-back" onClick={onBack} disabled={busy}>
            กลับไปแก้ไข
          </button>
          <button type="button" className="pos-go" onClick={onConfirm} disabled={busy}>
            {busy ? 'กำลังบันทึก…' : 'ยืนยันและบันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}
