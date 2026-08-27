'use client';
import { useState } from 'react';
import { api } from '../../../../lib/apiClient.js';
import { useToast } from '../../../../components/Toast.jsx';
import { useConfirm } from '../../../../components/Confirm.jsx';
import {
  Badge, Field, FormActions, Kv, Row, Stack,
} from '../../../../components/ui.jsx';
import { useMeta } from '../../../../contexts/MetaContext.jsx';
import { fmtDateTime, money } from '../../../../lib/format.js';

/** The terminal status a finished case lands on (case_statuses.is_terminal=1). */
const CLOSED_STATUS = 'completed';

/** A checklist row — a warning, never a hard block: the workflow is non-linear
 * on purpose, so a case can be closed with items still open. */
function CheckRow({ ok: passed, children }) {
  return (
    <Row style={{ gap: 8, alignItems: 'center' }}>
      <Badge kind={passed ? 'ok' : 'warn'}>{passed ? '✔' : '!'}</Badge>
      <span className={passed ? '' : 'muted'}>{children}</span>
    </Row>
  );
}

export function ClosePanel({ c, reload, actorId }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const { meta } = useMeta();
  const [note, setNote] = useState(c.notes || '');
  const [busy, setBusy] = useState(false);
  const empName = (id) => (meta.employees.find((e) => Number(e.id) === Number(id)) || {}).employee_name || '—';

  /* c.closed_at survives a re-open (Sql.php only ever stamps it), so whether
   * the case is closed *now* comes from the status's own terminal flag. */
  const closed = !!Number(c.is_terminal);

  const checks = [
    ['การขายเรียบร้อย', !!c.order],
    ['Production เสร็จ', c.production?.status === 'COMPLETED'],
    ['QC ผ่าน', c.qc_checks?.[0]?.result === 'pass'],
    ['ส่งมอบแล้ว', !!c.production?.pickup_at],
    [Number(c.balance) > 0 ? `ชำระเงินตามเงื่อนไข — ค้าง ${money(c.balance)}` : 'ชำระเงินตามเงื่อนไข',
      c.balance === null || Number(c.balance) <= 0],
  ];
  const pending = checks.filter(([, done]) => !done).map(([label]) => label);

  const saveNote = async () => {
    setBusy(true);
    try {
      await api.put('/api/cases/' + c.id, { ...c, notes: note });
      ok('บันทึกหมายเหตุแล้ว');
      reload();
    } catch (ex) { err(ex); } finally { setBusy(false); }
  };

  const closeCase = async () => {
    const message = pending.length
      ? `ยังไม่ครบ: ${pending.join(', ')} — ยืนยันจะจบงานเลยหรือไม่?`
      : 'ทุกขั้นตอนครบแล้ว — จบงานเคสนี้';
    if (!await confirm('จบงาน', message, { confirmText: 'จบงาน' })) return;
    setBusy(true);
    try {
      if (note !== (c.notes || '')) await api.put('/api/cases/' + c.id, { ...c, notes: note });
      await api.post(`/api/cases/${c.id}/status`, { status: CLOSED_STATUS, employee_id: actorId() });
      ok('จบงานแล้ว');
      reload();
    } catch (ex) { err(ex); } finally { setBusy(false); }
  };

  return (
    <Stack>
      <div className="card">
        <div className="card-head">
          <h2>ตรวจสอบก่อนจบงาน</h2>
          <Badge kind={closed ? 'ok' : pending.length ? 'warn' : 'ok'}>
            {closed ? 'จบงานแล้ว' : pending.length ? `ยังไม่ครบ ${pending.length} ข้อ` : 'พร้อมจบงาน'}
          </Badge>
        </div>
        <div className="card-body">
          <Stack>
            {checks.map(([label, done]) => (
              <CheckRow key={label} ok={done}>{label}</CheckRow>
            ))}
          </Stack>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>จบงาน — Close Case</h2></div>
        <div className="card-body">
          {closed ? (
            <Kv
              rows={[
                ['จบงานเมื่อ', fmtDateTime(c.closed_at)],
                ['ผู้จบงาน', empName(c.closed_by)],
                ['หมายเหตุ', c.notes || '—'],
              ]}
            />
          ) : (
            <>
              <Field label="หมายเหตุปิดงาน" className="full">
                <textarea value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <FormActions>
                <button type="button" className="btn btn-light" onClick={saveNote} disabled={busy}>
                  💾 บันทึกหมายเหตุ
                </button>
                <button type="button" className="btn" onClick={closeCase} disabled={busy}>
                  ✅ จบงาน
                </button>
              </FormActions>
              {pending.length > 0 && (
                <p className="hint" style={{ marginTop: 6 }}>
                  ยังไม่ครบ: {pending.join(', ')} — จบงานได้ แต่ระบบจะถามยืนยันก่อน
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </Stack>
  );
}
