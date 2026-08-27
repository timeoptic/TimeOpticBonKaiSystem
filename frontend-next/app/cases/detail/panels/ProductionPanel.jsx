'use client';
/**
 * Process 7 — ผลิต.
 *
 * The bench needs two things in front of it: the numbers measured at Center
 * Point, and the three physical pieces — already held for this case by the
 * เลนส์ step, so nobody has to go looking for them here. A job the floor has
 * not handed over cannot be started, and the button says so rather than simply
 * refusing.
 *
 * เริ่มผลิต is where stock is actually cut: each hold becomes a withdrawal
 * (production_withdrawals) and the units leave the shelf. Every replacement
 * after that leaves its own row, so a case can always be asked how much
 * material it really consumed.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../lib/apiClient.js';
import { readForm, useAsync } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import { useConfirm } from '../../../../components/Confirm.jsx';
import {
  Badge, Card, CardFold, Check, Field, FormActions, FormGrid, Kv, Row, Stack,
} from '../../../../components/ui.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { EmployeeSelect, Select } from '../../../../components/Selects.jsx';
import { StockPicker } from '../../../../components/StockPicker.jsx';
import { Icon } from '../../../../components/Icon.jsx';
import { useProcessActions } from '../../../../components/ProcessShell.jsx';
import { ACTION_LABEL } from '../../../../lib/constants.js';
import { dtLocal, fmtDateTime, power } from '../../../../lib/format.js';

const STATUS = {
  WAITING_FOR_ITEMS: { label: 'รอสินค้า', kind: 'gray' },
  READY_TO_PRODUCE: { label: 'พร้อมผลิต', kind: 'warn' },
  IN_PRODUCTION: { label: 'กำลังผลิต', kind: 'blue' },
  WAITING_FOR_ITEM: { label: 'หยุด — รอสินค้า', kind: 'danger' },
  COMPLETED: { label: 'ผลิตเสร็จ', kind: 'ok' },
};

const ITEM_STATUS = {
  reserved: { label: 'จองไว้แล้ว', kind: 'ok', icon: 'lock' },
  not_required: { label: 'ไม่ใช้ชิ้นนี้', kind: 'gray', icon: 'x' },
  ready: { label: 'มีของ — ยังไม่ได้จอง', kind: 'warn', icon: 'circleHalf' },
  withdrawn: { label: 'เบิกแล้ว', kind: 'blue', icon: 'box' },
  ordered: { label: 'สั่งแล้ว รอของเข้า', kind: 'warn', icon: 'clock' },
  out_of_stock: { label: 'หมดสต็อก', kind: 'danger', icon: 'xCircle' },
  not_chosen: { label: 'ยังไม่เลือกสินค้า', kind: 'gray', icon: 'warning' },
};

const ITEM_LABEL = { frame: 'กรอบ', lens_od: 'เลนส์ขวา (OD)', lens_os: 'เลนส์ซ้าย (OS)' };

const PAUSE_REASONS = [
  ['lens_od_broken', 'เลนส์ขวา (OD) เสีย'],
  ['lens_os_broken', 'เลนส์ซ้าย (OS) เสีย'],
  ['frame_broken', 'กรอบเสีย'],
  ['order_lens', 'รอสั่งเลนส์'],
  ['order_frame', 'รอสั่งกรอบ'],
  ['other', 'อื่น ๆ'],
];

const PACK_ITEMS = [
  ['pack_glasses', 'แว่น'], ['pack_case', 'กล่อง'], ['pack_cloth', 'ผ้าเช็ด'],
  ['pack_warranty', 'ใบรับประกัน'], ['pack_prescription', 'ใบค่าสายตา'],
  ['pack_accessories', 'อุปกรณ์เสริม'],
];

const PRODUCTION_ACTIONS = ['production_started', 'production_withdraw_extra', 'production_paused',
  'production_resumed', 'production_completed', 'production_saved', 'frame_fitting_saved'];

/** "เบิกเพิ่ม" — which pieces broke, and why. Several at once if it was a bad day. */
function WithdrawPopup({ job, items, onClose, onDone }) {
  const { ok, err } = useToast();
  const [chosen, setChosen] = useState({});     // item_type -> replacement lot
  const [picking, setPicking] = useState(null); // item_type currently being picked
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const withdrawable = items.filter((i) => i.item_type !== 'none');

  const submit = async () => {
    const rows = Object.entries(chosen).filter(([, lot]) => lot);
    if (!rows.length) { err('เลือกอย่างน้อยหนึ่งรายการที่ต้องเบิกเพิ่ม'); return; }
    if (!reason.trim()) { err('กรุณาระบุเหตุผลที่ต้องเบิกเพิ่ม'); return; }
    setBusy(true);
    try {
      for (const [itemType, lot] of rows) {
        await api.post(`/api/production-jobs/${job.id}/withdraw`, {
          item_type: itemType, stock_lot_id: lot.id, reason,
        });
      }
      ok(`เบิกเพิ่ม ${rows.length} รายการแล้ว`);
      onDone();
      onClose();
    } catch (ex) { err(ex); } finally { setBusy(false); }
  };

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide">
        <h3><Icon name="receipt" /> เบิกเพิ่ม</h3>
        <div className="m-body">
          <p className="hint">เลือกชิ้นที่ต้องใช้ใหม่ แล้วเลือกของจากสต็อกมาแทน — ระบบจะตัดสต็อกและบันทึกไว้ในประวัติของเคส</p>
          <Stack>
            {withdrawable.map((i) => (
              <div className="withdraw-item" key={i.item_type}>
                <div className="withdraw-item-head">
                  <b>{i.label}</b>
                  <span className="muted">{i.product_name || 'ยังไม่ได้เลือกสินค้า'}</span>
                  {chosen[i.item_type]
                    ? <Badge kind="ok">เลือกของแทนแล้ว</Badge>
                    : (
                      <button
                        type="button"
                        className="btn btn-sm btn-light"
                        onClick={() => setPicking(picking === i.item_type ? null : i.item_type)}
                      >
                        {picking === i.item_type ? 'ปิด' : 'เลือกของแทน'}
                      </button>
                    )}
                </div>
                {chosen[i.item_type] && (
                  <Row>
                    <span className="muted">{`${chosen[i.item_type].product_name} · #${chosen[i.item_type].id}`}</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-light"
                      onClick={() => setChosen((c) => ({ ...c, [i.item_type]: null }))}
                    >
                      ล้าง
                    </button>
                  </Row>
                )}
                {picking === i.item_type && (
                  <StockPicker
                    type={i.item_type === 'frame' ? 'Frame' : 'Lens'}
                    onPick={(r) => { setChosen((c) => ({ ...c, [i.item_type]: r })); setPicking(null); }}
                    selectedId={chosen[i.item_type]?.id ?? null}
                  />
                )}
              </div>
            ))}
          </Stack>

          <Field label="เหตุผล / หมายเหตุ" className="full" hint="บังคับกรอก — จะถูกเก็บไว้กับรายการเบิก">
            <textarea
              rows={2}
              value={reason}
              placeholder="เช่น เจียร์เลนส์ขวาผิด · กรอบหักระหว่างประกอบ"
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </div>
        <div className="m-foot">
          <button type="button" className="btn btn-light" onClick={onClose}>ยกเลิก</button>
          <button type="button" className="btn" onClick={submit} disabled={busy}>ยืนยันเบิกเพิ่ม</button>
        </div>
      </div>
    </div>
  );
}

/** "หยุดการผลิต / รอสินค้า" — what the job is waiting for, and why */
function PausePopup({ job, onClose, onDone }) {
  const { ok, err } = useToast();
  const [reason, setReason] = useState(PAUSE_REASONS[0][0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const waitingItem = {
    lens_od_broken: 'lens_od', lens_os_broken: 'lens_os', frame_broken: 'frame',
    order_lens: 'lens_od', order_frame: 'frame',
  }[reason] || null;

  const submit = async () => {
    setBusy(true);
    try {
      const label = (PAUSE_REASONS.find(([v]) => v === reason) || [])[1] || reason;
      await api.post(`/api/production-jobs/${job.id}/pause`, {
        reason: note.trim() ? `${label} — ${note.trim()}` : label,
        waiting_item: waitingItem,
      });
      ok('หยุดการผลิตแล้ว — เคสยังอยู่ในกระดานผลิต');
      onDone();
      onClose();
    } catch (ex) { err(ex); } finally { setBusy(false); }
  };

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3><Icon name="clock" /> หยุดการผลิต / รอสินค้า</h3>
        <div className="m-body">
          <Field label="หยุดเพราะอะไร">
            <Select
              name="reason"
              options={PAUSE_REASONS}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Field label="รายละเอียดเพิ่มเติม" className="full">
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="m-foot">
          <button type="button" className="btn btn-light" onClick={onClose}>ยกเลิก</button>
          <button type="button" className="btn" onClick={submit} disabled={busy}>ยืนยันหยุดงาน</button>
        </div>
      </div>
    </div>
  );
}

export function ProductionPanel({ c, reload }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const actions = useProcessActions();
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const p = c.production || {};
  const ce = c.centering || {};
  const ff = c.frame_fitting || {};

  /* stock readiness, answered by the same code the board and the start endpoint use */
  const { data: floor, reload: reloadFloor } = useAsync(() => api.get('/api/production/' + c.id), [c.id]);
  const items = floor?.items || [];
  const ready = !!floor?.ready;
  const blocking = floor?.blocking || [];

  const refresh = () => { reload(); reloadFloor(); };

  const status = p.status || (ready ? 'READY_TO_PRODUCE' : 'WAITING_FOR_ITEMS');
  const meta = STATUS[status] || STATUS.WAITING_FOR_ITEMS;
  const running = status === 'IN_PRODUCTION';
  const paused = status === 'WAITING_FOR_ITEM';
  const done = status === 'COMPLETED';

  const ensureJobId = async () => {
    if (p.id) return p.id;
    const created = await api.post('/api/production-jobs', { case_id: c.id, order_id: c.order?.id });
    return created.id;
  };

  const call = async (verb, body, message) => {
    setBusy(true);
    try {
      const jobId = await ensureJobId();
      await api.post(`/api/production-jobs/${jobId}/${verb}`, body || {});
      ok(message);
      refresh();
      return true;
    } catch (ex) { err(ex); return false; } finally { setBusy(false); }
  };

  const start = () => call('start', {}, 'เริ่มผลิตแล้ว — ตัดสต็อกเรียบร้อย');
  const resume = () => call('resume', {}, 'กลับมาผลิตต่อแล้ว');

  const completeProduction = async () => {
    if (!p.id) { err('ยังไม่ได้เริ่มผลิต'); return false; }
    if (!await confirm('ปิดงานผลิต', 'ยืนยันว่าการผลิตเสร็จเรียบร้อยแล้ว — เคสจะถูกส่งต่อไปขั้น QC',
      { confirmText: 'ผลิตเสร็จแล้ว' })) return false;
    setBusy(true);
    try {
      await api.post(`/api/production-jobs/${p.id}/complete`, {});
      ok('ปิดงานผลิตแล้ว — ส่งต่อ QC');
      refresh();
      return true;
    } catch (ex) { err(ex); return false; } finally { setBusy(false); }
  };

  /* the shell's ✓ ผลิตเสร็จแล้ว is the close-the-job action */
  const fns = useRef({});
  fns.current = { completeProduction };
  const register = actions?.register;
  useEffect(() => {
    if (!register) return undefined;
    register({ beforeComplete: () => fns.current.completeProduction() });
    return () => register({});
  }, [register]);

  const save = (endpoint) => async (e) => {
    e.preventDefault();
    try {
      await api.post(endpoint, { ...readForm(e.currentTarget), case_id: c.id, order_id: c.order?.id });
      ok('บันทึกแล้ว');
      refresh();
    } catch (ex) { err(ex); }
  };

  const log = (c.events || []).filter((ev) => PRODUCTION_ACTIONS.includes(ev.action));
  const eye = (side) => {
    const k = side === 'od' ? 'r' : 'l';
    const rx = (c.prescriptions || []).find((r) => r.kind === 'final' && Number(r.case_id) === Number(c.id));
    if (!rx) return '—';
    return `${power(rx[`${k}_sphere`])} / ${power(rx[`${k}_cylinder`])} × ${rx[`${k}_axis`] || '—'}`;
  };

  return (
    <Stack>
      {/* what the bench can do right now */}
      <Card>
        <div className="prod-head">
          <div>
            <Badge kind={meta.kind}>{meta.label}</Badge>
            {p.started_at ? <span className="muted">{`เริ่ม ${fmtDateTime(p.started_at)}`}</span> : null}
            {p.completed_at ? <span className="muted">{`เสร็จ ${fmtDateTime(p.completed_at)}`}</span> : null}
            {paused && p.waiting_reason ? <span className="pay-after over">{`หยุดเพราะ: ${p.waiting_reason}`}</span> : null}
          </div>
          <Row style={{ gap: 8 }}>
            {!running && !done && !paused && (
              <button
                type="button"
                className="btn btn-lg"
                onClick={start}
                disabled={busy || !ready}
                title={ready ? undefined : `ยังเริ่มไม่ได้ — ${blocking.join(', ')}`}
              >
                <Icon name="check" /> เริ่มผลิต
              </button>
            )}
            {paused && (
              <button type="button" className="btn" onClick={resume} disabled={busy}>
                <Icon name="refresh" /> ดำเนินการผลิตต่อ
              </button>
            )}
            {running && (
              <>
                <button type="button" className="btn btn-light" onClick={() => setWithdrawOpen(true)}>
                  <Icon name="receipt" /> เบิกเพิ่ม
                </button>
                <button type="button" className="btn btn-light" onClick={() => setPauseOpen(true)}>
                  <Icon name="clock" /> หยุดการผลิต / รอสินค้า
                </button>
                <button type="button" className="btn" onClick={completeProduction} disabled={busy}>
                  <Icon name="checkCircle" /> ปิดงานผลิต
                </button>
              </>
            )}
          </Row>
        </div>
        {!ready && !running && !done && (
          <div className="prod-block">
            <Icon name="warning" />
            <div>
              <b>ไม่สามารถเริ่มผลิตได้</b>
              <span>{`เนื่องจาก ${blocking.join(' · ')}`}</span>
            </div>
          </div>
        )}
      </Card>

      {/* the three things the job consumes */}
      <Card title="สินค้าที่ใช้ในงานนี้" right={<span className="muted">จองไว้ที่ขั้นเลนส์</span>}>
        <div className="prod-items">
          {items.map((i) => {
            const s = ITEM_STATUS[i.status] || ITEM_STATUS.not_chosen;
            return (
              <div className={`prod-item ${i.status}`} key={i.item_type}>
                <div className="prod-item-head">
                  <b>{i.label}</b>
                  <Badge kind={s.kind}><Icon name={s.icon} /> {s.label}</Badge>
                </div>
                <div className="prod-item-name">{i.product_name || '— ยังไม่ได้เลือกสินค้า —'}</div>
                <Kv
                  rows={[
                    ['ยี่ห้อ', i.brand || '—'],
                    i.item_type === 'frame'
                      ? ['ไซส์', c.order?.frame_size || '—']
                      : ['ค่าสายตา', eye(i.item_type === 'lens_od' ? 'od' : 'os')],
                    i.item_type !== 'frame' ? ['Index / Coating', [i.lens_index, i.coating].filter(Boolean).join(' · ') || '—'] : null,
                    ['SKU', i.sku || '—'],
                    ['คงเหลือในคลัง', i.remaining_qty === null ? '—' : `${i.remaining_qty} ชิ้น`],
                    i.withdrawn ? ['เบิกไปแล้ว', `${i.withdrawn} ชิ้น`] : null,
                    i.note ? ['สถานะสั่งของ', i.note] : null,
                  ].filter(Boolean)}
                />
              </div>
            );
          })}
        </div>
      </Card>

      {/* the numbers the bench cuts to */}
      <Card title="ค่าจากขั้นวัด Center" right={<span className="muted">อ่านอย่างเดียว</span>}>
        <div className="measure-grid cols-4">
          {[
            ['PD ขวา', ce.r_pd], ['PD ซ้าย', ce.l_pd], ['PD รวม', ce.pd_total],
            ['FH ขวา', ce.r_height], ['FH ซ้าย', ce.l_height],
            ['A', ff.frame_box_a], ['B', ff.frame_box_b], ['DBL', ff.dbl], ['ED', ff.ed],
            ['CVD', ce.vertex_distance], ['Panto', ce.pantoscopic_tilt],
          ].map(([label, v]) => (
            <div className="measure readonly" key={label}>
              <label>{label}</label>
              <div className="measure-input">
                <input value={v ?? ''} placeholder="—" readOnly tabIndex={-1} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* what has actually left the shelf for this job */}
      <CardFold
        title="ประวัติการเบิกสินค้า"
        count={`${(c.production_withdrawals || []).length} รายการ`}
        defaultOpen={(c.production_withdrawals || []).length > 0 && (c.production_withdrawals || []).length <= 6}
        tight
      >
        <DataTable
          columns={[
            {
              label: 'รายการ',
              render: (w) => ITEM_LABEL[w.item_type] || w.item_type,
            },
            { label: 'ครั้งที่เบิก', render: (w) => (Number(w.is_extra) ? <Badge kind="warn">เบิกเพิ่ม</Badge> : <Badge kind="gray">เริ่มผลิต</Badge>) },
            { label: 'เหตุผล', key: 'reason' },
            { label: 'โดย', key: 'withdrawn_by_name' },
            { label: 'เมื่อ', render: (w) => fmtDateTime(w.withdrawn_at), cls: 'nowrap' },
          ]}
          rows={c.production_withdrawals || []}
          empty="ยังไม่มีการเบิกสินค้า"
        />
      </CardFold>

      {/* the bench's own record */}
      <Card title="บันทึกงานผลิต">
        <form onSubmit={save('/api/production-jobs')}>
          <FormGrid>
            <Field label="ช่างที่รับงาน">
              <EmployeeSelect name="assigned_technician" defaultValue={p.assigned_technician || ''} />
            </Field>
            <Field label="เริ่มฝน">
              <input name="edging_started_at" type="datetime-local" defaultValue={dtLocal(p.edging_started_at)} />
            </Field>
            <Field label="ฝนเสร็จ">
              <input name="edging_finished_at" type="datetime-local" defaultValue={dtLocal(p.edging_finished_at)} />
            </Field>
            <Field label="ผู้ฝน"><EmployeeSelect name="edged_by" defaultValue={p.edged_by || ''} /></Field>
            <Field label="ตรวจจับคู่">
              <Row>
                <Check name="match_customer_ok" defaultChecked={!!Number(p.match_customer_ok)}>ตรงลูกค้า</Check>
                <Check name="match_rx_ok" defaultChecked={!!Number(p.match_rx_ok)}>ตรงค่าสายตา</Check>
              </Row>
            </Field>
            <Field label="Checklist การแพ็ค" className="full">
              <Row>
                {PACK_ITEMS.map(([k, label]) => (
                  <Check key={k} name={k} defaultChecked={!!Number(p[k])}>{label}</Check>
                ))}
              </Row>
            </Field>
            <Field label="ผู้แพ็ค"><EmployeeSelect name="packed_by" defaultValue={p.packed_by || ''} /></Field>
            <Field label="ผู้ตรวจการแพ็ค">
              <EmployeeSelect name="pack_checked_by" defaultValue={p.pack_checked_by || ''} />
            </Field>
          </FormGrid>
          <Field label="บันทึกการผลิต" className="full">
            <textarea name="edging_remark" defaultValue={p.edging_remark || ''} />
          </Field>
          <FormActions>
            <button className="btn btn-light" type="submit"><Icon name="save" /> บันทึกงานผลิต</button>
          </FormActions>
        </form>
      </Card>

      <CardFold title="ไทม์ไลน์การผลิต" count={`${log.length} เหตุการณ์`}>
        {log.length === 0 ? <p className="muted">ยังไม่มีความเคลื่อนไหวของงานผลิต</p> : (
          <div className="prod-log">
            {log.map((ev) => (
              <div className="prod-log-row" key={ev.id}>
                <span className="muted">{fmtDateTime(ev.created_at)}</span>
                <b>{ACTION_LABEL[ev.action] || ev.action}</b>
                {ev.note ? <span>{ev.note}</span> : null}
                {ev.employee_name ? <span className="muted">{`· ${ev.employee_name}`}</span> : null}
              </div>
            ))}
          </div>
        )}
      </CardFold>

      {withdrawOpen && (
        <WithdrawPopup job={p} items={items} onClose={() => setWithdrawOpen(false)} onDone={refresh} />
      )}
      {pauseOpen && (
        <PausePopup job={p} onClose={() => setPauseOpen(false)} onDone={refresh} />
      )}
    </Stack>
  );
}
