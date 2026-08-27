'use client';
/**
 * Process 6 — เลนส์.
 *
 * The step that stands between the sale and the bench, and it belongs to the
 * floor, not the workshop. Its whole job is to turn "the customer chose these
 * three things" into "these three things are ours", because those are not the
 * same sentence: stock on the shelf belongs to whoever asks for it first.
 *
 * So each item shows three numbers, not one — คงเหลือ (what the shelf holds),
 * จองแล้ว (what other cases have promised away) and พร้อมให้เคสนี้ (what is
 * actually left for us). Pressing จองของ holds a unit: nothing is cut, no
 * inventory row is written, the piece simply stops being available to anyone
 * else. The cut still happens once, later, at เริ่มผลิต.
 *
 * A piece that is not here gets ordered from here too, with a supplier and an
 * ETA, so a case waiting on a lens says what it is waiting for instead of
 * silently sitting still.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../lib/apiClient.js';
import { useAsync } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import { useConfirm } from '../../../../components/Confirm.jsx';
import {
  Badge, Card, CardFold, Field, FormGrid, Row, Stack,
} from '../../../../components/ui.jsx';
import { SupplierSelect } from '../../../../components/Selects.jsx';
import { Icon } from '../../../../components/Icon.jsx';
import { useProcessActions } from '../../../../components/ProcessShell.jsx';
import { fmtDate, power, todayISO } from '../../../../lib/format.js';
import { LensJobPanel } from './LensJobPanel.jsx';

const ITEM_STATUS = {
  reserved: { label: 'จองไว้แล้ว', kind: 'ok', icon: 'checkCircle' },
  withdrawn: { label: 'เบิกไปผลิตแล้ว', kind: 'blue', icon: 'box' },
  ready: { label: 'มีของ — ยังไม่ได้จอง', kind: 'warn', icon: 'circleHalf' },
  ordered: { label: 'สั่งแล้ว รอของเข้า', kind: 'warn', icon: 'clock' },
  out_of_stock: { label: 'ของไม่พอ', kind: 'danger', icon: 'xCircle' },
  not_chosen: { label: 'ยังไม่เลือกสินค้า', kind: 'gray', icon: 'warning' },
  not_required: { label: 'ไม่ใช้ชิ้นนี้', kind: 'gray', icon: 'x' },
};

const STOCK_STATE = {
  reserved: { label: 'จองครบแล้ว', kind: 'ok' },
  ready: { label: 'มีของ — ยังไม่ได้จอง', kind: 'warn' },
  ordered: { label: 'รอสินค้าเข้า', kind: 'warn' },
  out_of_stock: { label: 'ของไม่พอ', kind: 'danger' },
  not_chosen: { label: 'ยังไม่เลือกสินค้า', kind: 'gray' },
};

/** "สั่งสินค้า" — which pieces are being ordered, from whom, and when they land */
function OrderPopup({ items, onClose, onSubmit }) {
  const { err } = useToast();
  const [picked, setPicked] = useState(() => items.map((i) => i.item_type));
  const [supplier, setSupplier] = useState('');
  const [orderNo, setOrderNo] = useState('');
  const [eta, setEta] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (t) =>
    setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  const submit = async () => {
    if (!picked.length) { err('เลือกรายการที่ต้องสั่งอย่างน้อยหนึ่งรายการ'); return; }
    setBusy(true);
    try {
      await onSubmit({
        item_types: picked,
        supplier_id: supplier || null,
        order_no: orderNo.trim() || null,
        expected_arrival: eta || null,
        note: note.trim() || null,
      });
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3><Icon name="factory" /> สั่งสินค้าเข้า</h3>
        <div className="m-body">
          <Field label="สั่งรายการไหนบ้าง">
            <Stack>
              {items.map((i) => (
                <label className="pick-row" key={i.item_type}>
                  <input
                    type="checkbox"
                    checked={picked.includes(i.item_type)}
                    onChange={() => toggle(i.item_type)}
                  />
                  <b>{i.label}</b>
                  <span className="muted">{i.product_name || 'ยังไม่ได้เลือกสินค้า'}</span>
                </label>
              ))}
            </Stack>
          </Field>
          <FormGrid>
            <Field label="ซัพพลายเออร์">
              <SupplierSelect
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                blank="— เลือก —"
              />
            </Field>
            <Field label="เลขที่ใบสั่ง">
              <input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />
            </Field>
            <Field label="คาดว่าจะถึง (ETA)">
              <input type="date" value={eta} min={todayISO()} onChange={(e) => setEta(e.target.value)} />
            </Field>
          </FormGrid>
          <Field label="หมายเหตุ" className="full">
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="m-foot">
          <button type="button" className="btn btn-light" onClick={onClose}>ยกเลิก</button>
          <button type="button" className="btn" onClick={submit} disabled={busy}>บันทึกการสั่งของ</button>
        </div>
      </div>
    </div>
  );
}

export function LensPanel({ c, reload, actorId }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const actions = useProcessActions();
  const [busy, setBusy] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);

  const { data: floor, reload: reloadFloor } = useAsync(() => api.get(`/api/cases/${c.id}/lens`), [c.id]);
  const items = floor?.items || [];
  const ready = !!floor?.ready;
  const blocking = floor?.blocking || [];
  const sent = c.processes?.lens?.status === 'completed';

  const refresh = () => { reload(); reloadFloor(); };

  const call = async (path, body, message) => {
    setBusy(true);
    try {
      await api.post(`/api/cases/${c.id}/lens/${path}`, { ...(body || {}), employee_id: actorId?.() });
      if (message) ok(message);
      refresh();
      return true;
    } catch (ex) { err(ex); return false; } finally { setBusy(false); }
  };

  const reserveAll = () => call('reserve', {}, 'จองของให้เคสนี้แล้ว');
  const reserveOne = (t) => call('reserve', { item_type: t }, 'จองของแล้ว');
  const releaseOne = async (i) => {
    if (!await confirm('ยกเลิกการจอง', `คืน ${i.label} ให้สต็อกส่วนกลาง เคสอื่นจะหยิบไปได้`,
      { confirmText: 'ยกเลิกการจอง', danger: true })) return;
    call('release', { item_type: i.item_type }, 'ยกเลิกการจองแล้ว');
  };
  const setRequired = (i, value) =>
    call(`items/${i.item_type}`, { is_required: value ? 1 : 0 },
      value ? 'กลับมาใช้ชิ้นนี้แล้ว' : 'ตั้งเป็นงานที่ไม่ใช้ชิ้นนี้แล้ว');
  const receive = (t) => call('receive', { item_types: [t] }, 'บันทึกรับของแล้ว');
  const placeOrder = (body) => call('order', body, 'บันทึกการสั่งของแล้ว');

  /* the shell's ✓ ส่งเข้าห้องผลิต reserves everything and hands the case over */
  const sendToProduction = async () => {
    if (sent) return true;
    if (!await confirm(
      'ส่งเข้าห้องผลิต',
      'ระบบจะจองสินค้าทุกชิ้นให้เคสนี้ (ยังไม่ตัดสต็อก) แล้วส่งงานเข้ากระดานผลิต',
      { confirmText: 'ส่งเข้าห้องผลิต' },
    )) return false;
    return call('send-to-production', {}, 'ส่งเข้าห้องผลิตแล้ว');
  };

  const fns = useRef({});
  fns.current = { sendToProduction };
  const register = actions?.register;
  useEffect(() => {
    if (!register) return undefined;
    register({ beforeComplete: () => fns.current.sendToProduction() });
    return () => register({});
  }, [register]);

  const eye = (side) => {
    const k = side === 'od' ? 'r' : 'l';
    const rx = (c.prescriptions || []).find(
      (r) => r.kind === 'final' && Number(r.case_id) === Number(c.id),
    );
    if (!rx) return '—';
    return `${power(rx[`${k}_sphere`])} / ${power(rx[`${k}_cylinder`])} × ${rx[`${k}_axis`] || '—'}`;
  };

  const state = STOCK_STATE[floor?.stock_state] || STOCK_STATE.not_chosen;
  const needOrder = items.filter((i) => i.is_required
    && ['out_of_stock', 'ordered', 'not_chosen'].includes(i.status));
  const canReserveAny = items.some((i) => i.is_required && i.status === 'ready');

  return (
    <Stack>
      <Card>
        <div className="prod-head">
          <div>
            <Badge kind={state.kind}>{state.label}</Badge>
            {sent ? <span className="muted">ส่งเข้าห้องผลิตแล้ว</span> : null}
          </div>
          <Row style={{ gap: 8 }}>
            {needOrder.length > 0 && (
              <button type="button" className="btn btn-light" onClick={() => setOrderOpen(true)}>
                <Icon name="factory" /> สั่งสินค้า
              </button>
            )}
            {canReserveAny && (
              <button type="button" className="btn btn-light" onClick={reserveAll} disabled={busy}>
                <Icon name="lock" /> จองของทั้งหมด
              </button>
            )}
            {!sent && (
              <button
                type="button"
                className="btn btn-lg"
                onClick={sendToProduction}
                disabled={busy || !ready}
                title={ready ? undefined : `ยังส่งไม่ได้ — ${blocking.join(', ')}`}
              >
                <Icon name="check" /> ส่งเข้าห้องผลิต
              </button>
            )}
          </Row>
        </div>
        {!ready && !sent && (
          <div className="prod-block">
            <Icon name="warning" />
            <div>
              <b>ยังส่งเข้าห้องผลิตไม่ได้</b>
              <span>{`เนื่องจาก ${blocking.join(' · ')}`}</span>
            </div>
          </div>
        )}
      </Card>

      <Card
        title="สินค้าที่ต้องใช้"
        right={<span className="muted">เลือกไว้ที่ขั้นการขาย · จองที่นี่</span>}
      >
        <div className="lens-items">
          {items.map((i) => {
            const s = ITEM_STATUS[i.status] || ITEM_STATUS.not_chosen;
            const off = !i.is_required;
            return (
              <div className={`lens-item ${i.status}`} key={i.item_type}>
                <div className="lens-item-head">
                  <b>{i.label}</b>
                  <Badge kind={s.kind}><Icon name={s.icon} /> {s.label}</Badge>
                </div>

                <div className="lens-item-name">{i.product_name || '— ยังไม่ได้เลือกสินค้า —'}</div>
                <div className="lens-item-sub">
                  {[i.brand, i.sku, i.item_type === 'frame' ? c.order?.frame_size : null,
                    i.item_type === 'frame' ? null : [i.lens_index, i.coating].filter(Boolean).join(' · '),
                  ].filter(Boolean).join(' · ') || '—'}
                </div>
                {i.item_type !== 'frame' && (
                  <div className="lens-item-sub">
                    {`ค่าสายตา ${eye(i.item_type === 'lens_od' ? 'od' : 'os')}`}
                  </div>
                )}

                <div className="lens-stock">
                  <div><label>คงเหลือในคลัง</label><b>{i.remaining_qty ?? '—'}</b></div>
                  <div><label>จองไว้แล้ว</label><b>{i.reserved_qty ?? 0}</b></div>
                  <div className={i.available_qty === 0 ? 'bad' : ''}>
                    <label>พร้อมให้เคสนี้</label><b>{i.available_qty ?? '—'}</b>
                  </div>
                </div>

                {i.note ? <div className="lens-item-note">{i.note}</div> : null}
                {i.expected_arrival
                  ? <div className="lens-item-note">{`ETA ${fmtDate(i.expected_arrival)}`}</div>
                  : null}

                <div className="lens-item-actions">
                  {!off && i.status === 'ready' && (
                    <button type="button" className="btn btn-sm" onClick={() => reserveOne(i.item_type)} disabled={busy}>
                      <Icon name="lock" /> จองของ
                    </button>
                  )}
                  {!off && i.status === 'reserved' && (
                    <button type="button" className="btn btn-sm btn-light" onClick={() => releaseOne(i)} disabled={busy}>
                      <Icon name="undo" /> ยกเลิกการจอง
                    </button>
                  )}
                  {!off && i.status === 'ordered' && (
                    <button type="button" className="btn btn-sm btn-light" onClick={() => receive(i.item_type)} disabled={busy}>
                      <Icon name="box" /> ของมาถึงแล้ว
                    </button>
                  )}
                  {i.status !== 'withdrawn' && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => setRequired(i, off)}
                      disabled={busy}
                    >
                      {off ? 'กลับมาใช้ชิ้นนี้' : 'งานนี้ไม่ใช้ชิ้นนี้'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <CardFold
        title="งานเลนส์ / ติดตามซัพพลายเออร์"
        count={`ติดตาม ${c.lens_job?.follow_up_count || 0} ครั้ง`}
        defaultOpen={!!c.lens_job && c.lens_job.status !== 'ready'}
      >
        <LensJobPanel c={c} reload={refresh} actorId={actorId} />
      </CardFold>

      {orderOpen && (
        <OrderPopup
          items={needOrder}
          onClose={() => setOrderOpen(false)}
          onSubmit={placeOrder}
        />
      )}
    </Stack>
  );
}
