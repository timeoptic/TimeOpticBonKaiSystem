'use client';
/**
 * เปลี่ยนลูกค้าของเคส — แอดมิน/เจ้าของร้านเท่านั้น (ร้านขอ 15 ก.ย. 2026)
 *
 * ใช้ตอนเปิดเคสแล้วเลือกลูกค้าผิดคน · API ย้ายเคสพร้อมออเดอร์ ค่าสายตา และคิวจองของเคสนี้
 * ในทรานแซกชันเดียว (POST /api/cases/:id/customer) แล้วลงไทม์ไลน์ · เงินที่รับกับไทม์ไลน์เดิม
 * ผูกกับเคสอยู่แล้วจึงตามไปเอง · ใบเสร็จที่ออกไปแล้วไม่แก้ชื่อบนใบ ป๊อปอัปจึงเตือนก่อนยืนยัน
 */
import { useState } from 'react';
import { api } from '../../../../../lib/apiClient.js';
import { useAsync } from '../../../../../lib/hooks.js';
import { useToast } from '../../../../../components/Toast.jsx';
import { useConfirm } from '../../../../../components/Confirm.jsx';
import { Badge, Field, Row } from '../../../../../components/ui.jsx';
import { Picker } from '../../../../../components/Picker.jsx';
import { Icon } from '../../../../../components/Icon.jsx';
import { custName } from '../../../../../lib/format.js';

const TH = { textAlign: 'left', padding: '5px 12px 5px 0', whiteSpace: 'nowrap', fontWeight: 600 };
const TD = { textAlign: 'right', padding: '5px 0' };

/* เบอร์ · รหัสลูกค้า — แถวเคสมี id เป็นรหัสเคส รหัสลูกค้าจึงต้องส่งมาเอง */
const customerLine = (phone, customerId) => [phone, '#' + customerId].filter(Boolean).join(' · ');

export function ChangeCustomerDialog({ c, onClose, onSaved }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const [picked, setPicked] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: counts, error } = useAsync(() => api.get(`/api/cases/${c.id}/customer`), [c.id]);

  const same = !!picked && Number(picked.id) === Number(c.customer_id);
  const blocked = !picked
    ? 'เลือกลูกค้าคนที่ถูกต้อง'
    : same
      ? 'เคสนี้เป็นของลูกค้าคนนี้อยู่แล้ว'
      : !reason.trim() ? 'ใส่เหตุผลที่เปลี่ยน' : null;
  const canSave = !busy && !blocked && !!counts;

  const moves = counts
    ? [['ออเดอร์', counts.orders], ['ค่าสายตา', counts.prescriptions], ['คิวจอง', counts.bookings]]
      .filter(([, n]) => n > 0)
      .map(([label, n]) => `${label} ${n} รายการ`)
      .join(' · ')
    : '';
  const receipts = counts?.receipts || 0;
  const receiptWarning = receipts > 0
    ? `ใบเสร็จที่ออกไปแล้ว ${receipts} ใบยังเป็นชื่อลูกค้าคนเดิม — ต้องแก้ชื่อบนใบเสร็จแยกเอง`
    : null;

  const save = async () => {
    if (!canSave) return;
    const sure = await confirm('ยืนยันเปลี่ยนลูกค้าของเคส', (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <tr>
            <th style={TH}>ลูกค้า</th>
            <td style={TD}><span className="muted">{custName(c)}</span> → <b>{custName(picked)}</b></td>
          </tr>
          <tr>
            <th style={TH}>ย้ายตามไปด้วย</th>
            <td style={TD}>{moves || 'ไม่มี'}</td>
          </tr>
          <tr>
            <th style={TH}>เหตุผล</th>
            <td style={TD}>{reason.trim()}</td>
          </tr>
          {receiptWarning ? (
            <tr><td colSpan={2} style={{ paddingTop: 8 }}><Badge kind="warn">{receiptWarning}</Badge></td></tr>
          ) : null}
        </tbody>
      </table>
    ), { confirmText: 'ยืนยันเปลี่ยนลูกค้า' });
    if (!sure) return;

    setBusy(true);
    try {
      await api.post(`/api/cases/${c.id}/customer`, { customer_id: picked.id, reason: reason.trim() });
      ok(`เปลี่ยนลูกค้าของเคสเป็น ${custName(picked)} แล้ว`);
      onSaved();
    } catch (ex) {
      err(ex);
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="เปลี่ยนลูกค้าของเคส">
        <h3>{`เปลี่ยนลูกค้าของเคส ${c.case_code}`}</h3>
        <div className="m-body">
          <Row style={{ marginBottom: 10 }}>
            <span className="muted">ลูกค้าตอนนี้</span>
            <b>{custName(c)}</b>
            <span className="muted">{customerLine(c.phone, c.customer_id)}</span>
          </Row>

          {error ? <p className="muted">{error.message}</p> : null}
          {counts ? (
            <p className="muted" style={{ margin: '0 0 10px' }}>
              {moves ? `ย้ายตามไปด้วย: ${moves} · เงินที่รับและไทม์ไลน์ผูกกับเคสอยู่แล้ว` : 'เงินที่รับและไทม์ไลน์ผูกกับเคสอยู่แล้ว ย้ายตามไปเอง'}
            </p>
          ) : null}
          {receiptWarning ? <p style={{ margin: '0 0 10px' }}><Badge kind="warn">{receiptWarning}</Badge></p> : null}

          {picked ? (
            <Row style={{ marginBottom: 10 }}>
              <span className="muted">เปลี่ยนเป็น</span>
              <b>{custName(picked)}</b>
              <span className="muted">{customerLine(picked.phone, picked.id)}</span>
              <button type="button" className="btn btn-sm btn-light" onClick={() => setPicked(null)} disabled={busy}>
                เลือกใหม่
              </button>
            </Row>
          ) : (
            <Field label="ลูกค้าที่ถูกต้อง *">
              <Picker
                placeholder="ค้นหาลูกค้า (ชื่อ / นามสกุล / เบอร์โทร / รหัสลูกค้า)"
                fetcher={(q) => api.get('/api/customers', { q, limit: 40 })}
                label={custName}
                sub={(r) => [r.phone, r.line_id, '#' + r.id].filter(Boolean).join(' · ')}
                onPick={setPicked}
              />
            </Field>
          )}

          <Field label="เหตุผลที่เปลี่ยน *">
            <input
              id="cc-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น เลือกลูกค้าผิดคนตอนเปิดเคส"
              autoComplete="off"
            />
          </Field>
        </div>
        <div className="m-foot">
          {blocked ? <span className="process-blockers" style={{ marginRight: 'auto' }}>{blocked}</span> : null}
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button type="button" className="btn" onClick={save} disabled={!canSave}>
            <Icon name="check" />
            {busy ? ' กำลังบันทึก…' : ' เปลี่ยนลูกค้า'}
          </button>
        </div>
      </div>
    </div>
  );
}
