'use client';
/**
 * แก้วันเปิดบิล — แอดมิน/เจ้าของร้านเท่านั้น (ร้านขอ 2 ต.ค. 2026)
 *
 * เปิดจากปุ่มดินสอในคอลัมน์ "วันเปิดบิล" ของรายงานงานตัดแว่น · ใช้ตอนคีย์บิลย้อนหลัง
 * แล้ววันบนบิลเป็นวันที่คีย์ · API แก้แค่วัน เวลาเดิมคงไว้ แล้วลงไทม์ไลน์เคสพร้อมเหตุผล
 * (PUT /api/orders/:id/order-date) · เลขใบเสร็จที่ออกแล้วไม่เปลี่ยนตาม
 */
import { useState } from 'react';
import { api } from '../../lib/apiClient.js';
import { useToast } from '../Toast.jsx';
import { Field } from '../ui.jsx';
import { DateField } from '../DateField.jsx';
import { Icon } from '../Icon.jsx';
import { fmtDate, todayISO } from '../../lib/format.js';

export function EditBillDateDialog({ row, onClose, onSaved }) {
  const { ok, err } = useToast();
  const current = String(row.date || '').slice(0, 10);
  const [date, setDate] = useState(current);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const blocked = !date
    ? 'เลือกวันเปิดบิล'
    : date === current
      ? 'ยังเป็นวันเดิม'
      : !reason.trim() ? 'ใส่เหตุผลที่แก้' : null;

  const save = async () => {
    if (busy || blocked) return;
    setBusy(true);
    try {
      await api.put(`/api/orders/${row.id}/order-date`, { order_date: date, reason: reason.trim() });
      ok(`แก้วันเปิดบิล ${row.code} เป็น ${fmtDate(date)} แล้ว`);
      onSaved();
    } catch (ex) {
      err(ex);
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="แก้วันเปิดบิล">
        <h3>{`แก้วันเปิดบิล ${row.code}`}</h3>
        <div className="m-body">
          <p className="muted" style={{ margin: '0 0 10px' }}>
            {`${row.customer} · ตอนนี้ ${fmtDate(current)} · เลขใบเสร็จที่ออกแล้วไม่เปลี่ยนตาม`}
          </p>
          <Field label="วันเปิดบิลที่ถูกต้อง *">
            <DateField value={date} onChange={setDate} max={todayISO()} required />
          </Field>
          <Field label="เหตุผลที่แก้ *">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น คีย์บิลย้อนหลัง"
              autoComplete="off"
            />
          </Field>
        </div>
        <div className="m-foot">
          {blocked ? <span className="process-blockers" style={{ marginRight: 'auto' }}>{blocked}</span> : null}
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button type="button" className="btn" onClick={save} disabled={busy || !!blocked}>
            <Icon name="check" />
            {busy ? ' กำลังบันทึก…' : ' บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}
