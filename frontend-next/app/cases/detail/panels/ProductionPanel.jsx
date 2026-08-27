'use client';
import { useState } from 'react';
import { api } from '../../../../lib/apiClient.js';
import { readForm } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import {
  Badge, Check, Field, FormActions, FormGrid, Row, Stack,
} from '../../../../components/ui.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { EmployeeSelect, Select } from '../../../../components/Selects.jsx';
import { StockPicker } from '../../../../components/StockPicker.jsx';
import { dtLocal, fmtDateTime } from '../../../../lib/format.js';
import { Icon } from '../../../../components/Icon.jsx';

const PACK_ITEMS = [
  ['pack_glasses', 'แว่น'], ['pack_case', 'กล่อง'], ['pack_cloth', 'ผ้าเช็ด'],
  ['pack_warranty', 'ใบรับประกัน'], ['pack_prescription', 'ใบค่าสายตา'],
  ['pack_accessories', 'อุปกรณ์เสริม'],
];

const STATUS_LABEL = {
  WAITING_FOR_ITEMS: 'รอเริ่มงาน', READY_TO_PRODUCE: 'พร้อมผลิต', IN_PRODUCTION: 'กำลังผลิต',
  WAITING_FOR_ITEM: 'รอสินค้า', COMPLETED: 'เสร็จแล้ว',
};
const STATUS_BADGE = {
  WAITING_FOR_ITEMS: 'gray', READY_TO_PRODUCE: 'blue', IN_PRODUCTION: 'warn',
  WAITING_FOR_ITEM: 'danger', COMPLETED: 'ok',
};

/** production_withdrawals.item_type <-> the order field that supplies that item. */
const ITEM_LABEL = { frame: 'กรอบ', lens_od: 'เลนส์ขวา (OD)', lens_os: 'เลนส์ซ้าย (OS)' };
const ITEM_ORDER_FIELD = { frame: 'frame_product_id', lens_od: 'lens_product_id', lens_os: 'right_lens_product_id' };

/** "เบิกเพิ่ม" popup — pick a real replacement stock item and record why. */
function WithdrawPopup({ jobId, onClose, onDone, actorId }) {
  const { ok, err } = useToast();
  const [itemType, setItemType] = useState('frame');
  const [picked, setPicked] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!picked) { err('กรุณาเลือกสินค้าจากสต็อก'); return; }
    setBusy(true);
    try {
      await api.post(`/api/production-jobs/${jobId}/withdraw`, {
        item_type: itemType,
        stock_lot_id: picked.id,
        reason,
        employee_id: actorId(),
      });
      ok('เบิกเพิ่มแล้ว');
      onDone();
      onClose();
    } catch (ex) { err(ex); } finally { setBusy(false); }
  };

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3><Icon name="receipt" /> เบิกเพิ่ม</h3>
        <div className="m-body">
          <Stack>
            <Field label="ประเภทสินค้า">
              <Select
                options={[['frame', ITEM_LABEL.frame], ['lens_od', ITEM_LABEL.lens_od], ['lens_os', ITEM_LABEL.lens_os]]}
                value={itemType}
                onChange={(e) => { setItemType(e.target.value); setPicked(null); }}
              />
            </Field>
            <Field label="เลือกสินค้าจากสต็อก">
              <StockPicker type={itemType === 'frame' ? 'Frame' : 'Lens'} onPick={setPicked} selectedId={picked?.id ?? null} />
            </Field>
            {picked && (
              <div className="hint">
                เลือกแล้ว: {picked.brand ? picked.brand + ' ' : ''}{picked.product_name}
                {picked.sku ? ` (SKU ${picked.sku})` : ''}
              </div>
            )}
            <Field label="เหตุผล">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="เช่น กรอบแตก / เลนส์เป็นรอย"
              />
            </Field>
          </Stack>
        </div>
        <div className="m-foot">
          <button type="button" className="btn btn-light" onClick={onClose}>ยกเลิก</button>
          <button type="button" className="btn btn-accent" onClick={submit} disabled={busy || !picked}>
            {busy ? 'กำลังบันทึก…' : 'เบิกเพิ่ม'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProductionPanel({ c, reload, actorId }) {
  const { ok, err } = useToast();
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const p = c.production || {};
  const ff = c.frame_fitting || {};

  const post = (endpoint, extra) => async (e) => {
    e.preventDefault();
    try {
      await api.post(endpoint, { ...readForm(e.currentTarget), case_id: c.id, order_id: c.order?.id, ...extra });
      ok('บันทึกแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const text = (name, label, source) => (
    <Field label={label}><input name={name} defaultValue={source[name] || ''} /></Field>
  );

  const missingItems = Object.entries(ITEM_ORDER_FIELD)
    .filter(([, field]) => !c.order?.[field])
    .map(([type]) => ITEM_LABEL[type]);
  const canStart = !!c.order && missingItems.length === 0;

  /** creates the job row on first use — the "Production" form below only
   * upserts one when it is itself submitted, which may not have happened yet. */
  const ensureJobId = async () => {
    if (p.id) return p.id;
    const created = await api.post('/api/production-jobs', { case_id: c.id, order_id: c.order?.id, employee_id: actorId() });
    return created.id;
  };

  const start = async () => {
    try {
      const jobId = await ensureJobId();
      await api.post(`/api/production-jobs/${jobId}/start`, { employee_id: actorId() });
      ok('เริ่มผลิตแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const pause = async () => {
    try {
      await api.post(`/api/production-jobs/${p.id}/pause`, { employee_id: actorId() });
      ok('บันทึกแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const resume = async () => {
    try {
      await api.post(`/api/production-jobs/${p.id}/resume`, { employee_id: actorId() });
      ok('บันทึกแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <Stack>
      <div className="card">
        <div className="card-head">
          <h2>สถานะการผลิต</h2>
          <Badge kind={STATUS_BADGE[p.status] || 'gray'}>{STATUS_LABEL[p.status] || 'ยังไม่เริ่ม'}</Badge>
        </div>
        <div className="card-body">
          <Stack>
            {p.status === 'IN_PRODUCTION' || p.status === 'COMPLETED' ? (
              <Row style={{ gap: 8 }}>
                <button type="button" className="btn btn-light" onClick={() => setWithdrawOpen(true)}>
                  <Icon name="receipt" /> เบิกเพิ่ม
                </button>
                {p.status === 'IN_PRODUCTION' && (
                  <button type="button" className="btn btn-light" onClick={pause}>⏸ หยุดการผลิต / รอสินค้า</button>
                )}
              </Row>
            ) : p.status === 'WAITING_FOR_ITEM' ? (
              <button type="button" className="btn" onClick={resume}>▶ กลับมาผลิตต่อ</button>
            ) : (
              <div>
                <button
                  type="button"
                  className="btn"
                  onClick={start}
                  disabled={!canStart}
                  title={canStart ? undefined : `ยังขาดสินค้า: ${missingItems.join(', ')} — เข้าสู่ Flow สั่งสินค้าก่อน`}
                >
                  ▶ เริ่มผลิต
                </button>
                {!canStart && (
                  <p className="hint" style={{ marginTop: 6 }}>
                    ยังขาดสินค้า: {missingItems.join(', ')} — เข้าสู่ Flow สั่งสินค้าก่อนจึงจะเริ่มผลิตได้
                  </p>
                )}
              </div>
            )}
            {(c.production_withdrawals || []).length > 0 && (
              <DataTable
                columns={[
                  { label: 'รายการ', render: (w) => ITEM_LABEL[w.item_type] || w.item_type },
                  { label: 'ประเภท', render: (w) => (w.is_extra ? <Badge kind="warn">เบิกเพิ่ม</Badge> : 'เริ่มผลิต') },
                  { label: 'เหตุผล', key: 'reason' },
                  { label: 'โดย', key: 'withdrawn_by_name' },
                  { label: 'เมื่อ', render: (w) => fmtDateTime(w.withdrawn_at), cls: 'nowrap' },
                ]}
                rows={c.production_withdrawals || []}
                empty="ยังไม่มีการเบิก"
              />
            )}
          </Stack>
        </div>
        {withdrawOpen && (
          <WithdrawPopup jobId={p.id} onClose={() => setWithdrawOpen(false)} onDone={reload} actorId={actorId} />
        )}
      </div>

      <div className="card">
        <div className="card-head"><h2>วัดกรอบ — Frame Fitting</h2></div>
        <form
          className="card-body"
          onSubmit={post('/api/frame-fittings', { recorded_by: actorId() })}
        >
          <FormGrid>
            {text('frame_size', 'Frame size', ff)}
            {text('lens_width', 'Lens width', ff)}
            {text('bridge_width', 'Bridge', ff)}
            {text('temple_length', 'Temple', ff)}
            {text('ed', 'ED', ff)}
            {text('dbl', 'DBL', ff)}
            {text('frame_box_a', 'Frame box A', ff)}
            {text('frame_box_b', 'Frame box B', ff)}
            <Field label="ผู้วัด">
              <EmployeeSelect name="performed_by" defaultValue={ff.performed_by || ''} />
            </Field>
          </FormGrid>
          <FormActions>
            <button className="btn btn-light" type="submit"><Icon name="save" /> บันทึกการวัดกรอบ</button>
          </FormActions>
        </form>
      </div>

      <div className="card">
        <div className="card-head"><h2>งานผลิต — Production</h2></div>
        <form
          className="card-body"
          onSubmit={post('/api/production-jobs', { employee_id: actorId() })}
        >
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
      </div>
    </Stack>
  );
}
