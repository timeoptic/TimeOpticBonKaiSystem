'use client';
/**
 * แก้วันเปิดเคส — แอดมิน/เจ้าของร้านเท่านั้น (ร้านขอ 13 พ.ย. 2026)
 *
 * เปิดจากปุ่ม "แก้วันเปิดเคส" บนหัวหน้าเคส · บิลทุกใบในเคสขยับวันตามจำนวนวันเท่ากัน
 * เวลาเดิมคงไว้ เพื่อให้รายงานยอดขายย้ายตาม (PUT /api/cases/:id/opened-date)
 * · วันปิดบิล เงินที่รับ และเลขใบเสร็จที่ออกแล้วไม่เปลี่ยน
 */
import { useState } from 'react';
import { api } from '../../../../../lib/apiClient.js';
import { useToast } from '../../../../../components/Toast.jsx';
import { Field } from '../../../../../components/ui.jsx';
import { DateField } from '../../../../../components/DateField.jsx';
import { Icon } from '../../../../../components/Icon.jsx';
import { fmtDate, todayISO } from '../../../../../lib/format.js';

export function EditCaseOpenedDateDialog({ c, onClose, onSaved }) {
  const { ok, err } = useToast();
  const current = String(c.opened_at || '').slice(0, 10);
  const [date, setDate] = useState(current);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const blocked = !date
    ? 'เลือกวันเปิดเคส'
    : date === current
      ? 'ยังเป็นวันเดิม'
      : !reason.trim() ? 'ใส่เหตุผลที่แก้' : null;

  const save = async () => {
    if (busy || blocked) return;
    setBusy(true);
    try {
      const r = await api.put(`/api/cases/${c.id}/opened-date`, { opened_date: date, reason: reason.trim() });
      const n = (r && r.orders && r.orders.length) || 0;
      ok(`แก้วันเปิดเคสเป็น ${fmtDate(date)} แล้ว` + (n ? ` · วันเปิดบิลขยับตาม ${n} ใบ` : ''));
      onSaved();
    } catch (ex) {
      err(ex);
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="แก้วันเปิดเคส">
        <h3>{`แก้วันเปิดเคส ${c.case_code}`}</h3>
        <div className="m-body">
          <p className="muted" style={{ margin: '0 0 10px' }}>
            {`ตอนนี้ ${fmtDate(current)} · วันเปิดบิลทุกใบในเคสนี้จะขยับตามจำนวนวันเท่ากัน (รายงานยอดขายย้ายตาม) · วันปิดบิลและเลขใบเสร็จที่ออกแล้วไม่เปลี่ยน`}
          </p>
          <Field label="วันเปิดเคสที่ถูกต้อง *">
            <DateField value={date} onChange={setDate} max={todayISO()} required />
          </Field>
          <Field label="เหตุผลที่แก้ *">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น คีย์เคสย้อนหลัง"
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
