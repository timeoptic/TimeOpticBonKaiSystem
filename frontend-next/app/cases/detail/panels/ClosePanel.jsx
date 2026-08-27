'use client';
/**
 * Process 9 — จบงาน. A read-out of everything the case needs before it can be
 * closed, plus the closing note.
 *
 * The close itself is the process's own complete action (ProcessShell →
 * POST /api/cases/:id/processes/done/complete), which re-checks the same
 * requirements server-side and moves the case to its terminal status. This
 * panel never closes a case by itself.
 */
import { useState } from 'react';
import { api } from '../../../../lib/apiClient.js';
import { useToast } from '../../../../components/Toast.jsx';
import {
  Badge, Field, FormActions, Kv, Row, Stack,
} from '../../../../components/ui.jsx';
import { fmtDateTime, money } from '../../../../lib/format.js';
import { Icon } from '../../../../components/Icon.jsx';

/** A checklist row — informative, not a hard block: the workflow is
 * deliberately non-linear, so the shop may close a case with items open. */
function CheckRow({ ok: passed, children }) {
  return (
    <Row style={{ gap: 8, alignItems: 'center' }}>
      <Badge kind={passed ? 'ok' : 'warn'}><Icon name={passed ? 'check' : 'warning'} /></Badge>
      <span className={passed ? '' : 'muted'}>{children}</span>
    </Row>
  );
}

export function ClosePanel({ c, reload }) {
  const { ok, err } = useToast();
  const [note, setNote] = useState(c.notes || '');
  const [busy, setBusy] = useState(false);

  /* c.closed_at survives a re-open (Sql.php only ever stamps it), so whether
   * the case is closed *now* comes from the status's own terminal flag. */
  const closed = !!Number(c.is_terminal);

  const checks = [
    ['การขายเรียบร้อย', !!c.order],
    ['Production เสร็จ', c.production?.status === 'COMPLETED' || !!c.production?.edging_finished_at],
    ['QC ผ่าน', c.qc_checks?.[0]?.result === 'pass'],
    ['ส่งมอบแล้ว', !!c.production?.pickup_at],
    [Number(c.balance) > 0 ? `ชำระเงินตามเงื่อนไข — ค้าง ${money(c.balance)}` : 'ชำระเงินตามเงื่อนไข',
      c.balance === null || Number(c.balance) <= 0],
  ];

  const saveNote = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put('/api/cases/' + c.id, { ...c, notes: note });
      ok('บันทึกหมายเหตุแล้ว');
      reload();
    } catch (ex) { err(ex); } finally { setBusy(false); }
  };

  return (
    <Stack>
      <Stack>
        {checks.map(([label, done]) => <CheckRow key={label} ok={done}>{label}</CheckRow>)}
      </Stack>

      {closed ? (
        <Kv
          rows={[
            ['จบงานเมื่อ', fmtDateTime(c.closed_at)],
            ['หมายเหตุ', c.notes || '—'],
          ]}
        />
      ) : (
        <form onSubmit={saveNote}>
          <Field label="หมายเหตุปิดงาน" className="full">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <FormActions>
            <button type="submit" className="btn btn-light" disabled={busy}><Icon name="save" /> บันทึกหมายเหตุ</button>
          </FormActions>
        </form>
      )}
    </Stack>
  );
}
