'use client';
/**
 * Process 5 — ชำระเงิน.
 *
 * The question this screen answers first is "how much is still owed", so that
 * is what it opens with: the order total, what has come in, and what is left,
 * with a bar showing how far along the payment is.
 *
 * Every payment can carry its slip — the transfer screenshot or the receipt —
 * attached to the payment row it proves (case_photos.payment_id), never loose
 * on the case, so a row and its evidence cannot drift apart.
 */
import { useRef, useState } from 'react';
import { api } from '../../../../lib/apiClient.js';
import { useAsync, readForm } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import { useConfirm } from '../../../../components/Confirm.jsx';
import { Badge, Card, Field, FormGrid, Row } from '../../../../components/ui.jsx';
import { EmployeeSelect } from '../../../../components/Selects.jsx';
import { Icon } from '../../../../components/Icon.jsx';
import { useMeta } from '../../../../contexts/MetaContext.jsx';
import { fmtDateTime, money, nowLocal, toStamp } from '../../../../lib/format.js';

const KINDS = [
  ['deposit', 'มัดจำ'], ['partial', 'จ่ายบางส่วน'],
  ['final', 'ชำระส่วนที่เหลือ'], ['full', 'ชำระเต็ม'],
];
const KIND_LABEL = Object.fromEntries(KINDS);
const KIND_BADGE = { deposit: 'blue', partial: 'warn', final: 'ok', full: 'ok' };

const METHOD_ICON = {
  Cash: 'banknote', Transfer: 'coins', QR: 'chart', Credit: 'card', Other: 'tag',
};

const SLIP_KIND = 'payment_slip';
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export function PaymentPanel({ c, reload }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const { meta } = useMeta();
  const slipRef = useRef(null);
  const rowSlipRef = useRef(null);

  const [slips, setSlips] = useState([]);          // files chosen for the payment being written
  const [attachTo, setAttachTo] = useState(null);  // payment a slip is being added to
  const [method, setMethod] = useState('Cash');
  const [kind, setKind] = useState(Number(c.paid) > 0 ? 'final' : 'deposit');
  const [amount, setAmount] = useState(Number(c.balance) > 0 ? String(c.balance) : '');

  const { data: files, reload: reloadFiles } = useAsync(
    () => api.get('/api/uploads', { case_id: c.id }),
    [c.id],
  );
  const slipsOf = (paymentId) =>
    (files || []).filter((f) => Number(f.payment_id) === Number(paymentId));

  const payments = c.payments || [];
  const net = c.order ? Number(c.order.total_price) - Number(c.order.discount) : 0;
  const paid = Number(c.paid) || 0;
  const left = c.balance === null || c.balance === undefined ? 0 : Number(c.balance);
  const pct = net > 0 ? Math.min(100, Math.round((paid / net) * 100)) : 0;
  const methods = meta.lists?.pay_type || ['Cash'];
  const methodLabel = meta.lists?.pay_type_labels || {};

  const sendSlip = async (file, paymentId) => {
    const form = new FormData();
    form.append('file', file);
    form.append('case_id', c.id);
    form.append('payment_id', paymentId);
    form.append('kind', SLIP_KIND);
    await api.upload('/api/uploads', form);
  };

  const add = async (e) => {
    e.preventDefault();
    const body = readForm(e.currentTarget);
    try {
      const saved = await api.post('/api/payments', {
        ...body,
        kind,
        method,
        amount,
        paid_at: toStamp(body.paid_at),
        case_id: c.id,
        order_id: c.order?.id,
      });
      for (const file of slips) await sendSlip(file, saved.id);
      setSlips([]);
      if (slipRef.current) slipRef.current.value = '';
      ok(slips.length ? `บันทึกการรับเงินและแนบสลิป ${slips.length} ไฟล์แล้ว` : 'บันทึกการรับเงินแล้ว');
      reload();
      reloadFiles();
    } catch (ex) { err(ex); }
  };

  const attachToRow = (p) => { setAttachTo(p.id); rowSlipRef.current?.click(); };
  const onRowSlip = async (e) => {
    const chosen = Array.from(e.target.files || []);
    e.target.value = '';
    if (!chosen.length || !attachTo) return;
    try {
      for (const file of chosen) await sendSlip(file, attachTo);
      ok('แนบสลิปแล้ว');
      reloadFiles();
    } catch (ex) { err(ex); } finally { setAttachTo(null); }
  };

  const removeSlip = async (f) => {
    if (!await confirm('ลบสลิป', f.original_name || '', { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del('/api/uploads/' + f.id);
      ok('ลบสลิปแล้ว');
      reloadFiles();
    } catch (ex) { err(ex); }
  };

  const remove = async (p) => {
    if (!await confirm('ลบรายการรับเงิน', `ลบ ${money(p.amount)} (${KIND_LABEL[p.kind] || p.kind})?`,
      { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del('/api/payments/' + p.id);
      ok('ลบแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <div className="stack">
      <input ref={rowSlipRef} type="file" accept={ACCEPT} multiple style={{ display: 'none' }} onChange={onRowSlip} />

      <Card>
        <div className="pay-summary">
          <div className="pay-figure">
            <span>ยอดสุทธิ</span>
            <b>{money(net)}</b>
          </div>
          <div className="pay-figure ok">
            <span>รับแล้ว</span>
            <b>{money(paid)}</b>
          </div>
          <div className={`pay-figure ${left > 0 ? 'due' : 'ok'}`}>
            <span>คงเหลือ</span>
            <b>{money(left)}</b>
          </div>
          <div className="pay-bar-wrap">
            <div className="pay-bar"><span style={{ width: `${pct}%` }} /></div>
            <small>{net > 0 ? `ชำระแล้ว ${pct}%` : 'ยังไม่มียอดจากออเดอร์'}</small>
          </div>
        </div>
      </Card>

      <Card title="รับเงินเข้ามาใหม่">
        <form onSubmit={add}>
          <div className="pay-form">
            <div className="pay-amount">
              <label>จำนวนเงินที่รับ</label>
              <div className="pay-amount-input">
                <span>฿</span>
                <input
                  type="number"
                  step="1"
                  min="1"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                />
              </div>
              {left > 0 && (
                <Row style={{ gap: 6, marginTop: 6 }}>
                  <button type="button" className="chip-btn" onClick={() => setAmount(String(left))}>
                    ทั้งหมด {money(left)}
                  </button>
                  <button type="button" className="chip-btn" onClick={() => setAmount(String(Math.round(left / 2)))}>
                    ครึ่งหนึ่ง
                  </button>
                </Row>
              )}
            </div>

            <div className="pay-choices">
              <div>
                <label>ประเภท</label>
                <Row style={{ gap: 6 }}>
                  {KINDS.map(([v, label]) => (
                    <button
                      type="button"
                      key={v}
                      className={`chip-btn ${kind === v ? 'active' : ''}`}
                      onClick={() => setKind(v)}
                    >
                      {label}
                    </button>
                  ))}
                </Row>
              </div>
              <div>
                <label>วิธีชำระ</label>
                <Row style={{ gap: 6 }}>
                  {methods.map((v) => (
                    <button
                      type="button"
                      key={v}
                      className={`chip-btn ${method === v ? 'active' : ''}`}
                      onClick={() => setMethod(v)}
                    >
                      <Icon name={METHOD_ICON[v] || 'coins'} /> {methodLabel[v] || v}
                    </button>
                  ))}
                </Row>
              </div>
            </div>
          </div>

          <FormGrid>
            <Field label="อ้างอิง (เลขที่โอน / เลขอนุมัติ)"><input name="reference" /></Field>
            <Field label="ผู้รับเงิน"><EmployeeSelect name="received_by" defaultValue="" /></Field>
            <Field label="รับเมื่อ">
              <input name="paid_at" type="datetime-local" defaultValue={nowLocal()} />
            </Field>
          </FormGrid>

          <div className="slip-drop">
            <div className="slip-drop-head">
              <b><Icon name="receipt" /> สลิป / หลักฐานการโอน</b>
              <span className="muted">รูปหรือ PDF แนบได้หลายไฟล์ · ผูกกับรายการนี้</span>
              <button type="button" className="btn btn-sm btn-light" onClick={() => slipRef.current?.click()}>
                <Icon name="camera" /> เลือกไฟล์
              </button>
            </div>
            <input
              ref={slipRef}
              type="file"
              accept={ACCEPT}
              multiple
              style={{ display: 'none' }}
              onChange={(e) => setSlips(Array.from(e.target.files || []))}
            />
            {slips.length > 0 ? (
              <Row style={{ gap: 8, marginTop: 10 }}>
                {slips.map((f) => (
                  <span className="slip-chip lg" key={f.name + f.size}>
                    {f.type === 'application/pdf'
                      ? <span className="slip-file"><Icon name="file" /></span>
                      : <img src={URL.createObjectURL(f)} alt={f.name} />}
                  </span>
                ))}
                <button
                  type="button"
                  className="btn btn-sm btn-light"
                  onClick={() => { setSlips([]); if (slipRef.current) slipRef.current.value = ''; }}
                >
                  ล้างไฟล์
                </button>
              </Row>
            ) : <p className="muted" style={{ margin: '8px 0 0' }}>ยังไม่ได้แนบไฟล์ — บันทึกได้โดยไม่มีสลิป</p>}
          </div>

          <div className="pay-actions">
            <button className="btn btn-lg" type="submit">
              <Icon name="check" /> บันทึกการรับเงิน {amount ? money(amount) : ''}
            </button>
          </div>
        </form>
      </Card>

      <Card
        title="ประวัติการรับเงิน"
        right={<span className="muted">{`${payments.length} รายการ`}</span>}
      >
        {payments.length === 0 ? (
          <p className="muted">ยังไม่มีการรับเงินในเคสนี้</p>
        ) : (
          <div className="pay-list">
            {payments.map((p) => (
              <div className={`pay-row ${p.cancelled_at ? 'cancelled' : ''}`} key={p.id}>
                <div className="pay-row-main">
                  <b>{money(p.amount)}</b>
                  <Badge kind={KIND_BADGE[p.kind] || 'gray'}>{KIND_LABEL[p.kind] || p.kind}</Badge>
                  <span className="muted">
                    <Icon name={METHOD_ICON[p.method] || 'coins'} /> {methodLabel[p.method] || p.method}
                  </span>
                  {p.reference ? <span className="muted">{`อ้างอิง ${p.reference}`}</span> : null}
                  {p.cancelled_at ? <Badge kind="danger">ยกเลิกแล้ว</Badge> : null}
                </div>
                <div className="pay-row-sub muted">
                  {fmtDateTime(p.paid_at)}
                  {p.received_by_name ? ` · รับโดย ${p.received_by_name}` : ''}
                  {p.notes ? ` · ${p.notes}` : ''}
                </div>
                <div className="pay-row-slips">
                  {slipsOf(p.id).map((f) => (
                    <span className="slip-chip lg" key={f.id}>
                      <a href={api.url('/api/uploads/' + f.id)} target="_blank" rel="noreferrer">
                        {f.mime_type === 'application/pdf'
                          ? <span className="slip-file"><Icon name="file" /></span>
                          : <img src={api.url('/api/uploads/' + f.id)} alt={f.original_name || 'สลิป'} />}
                      </a>
                      <button type="button" onClick={() => removeSlip(f)} title="ลบสลิป"><Icon name="x" /></button>
                    </span>
                  ))}
                  <button type="button" className="btn btn-sm btn-light" onClick={() => attachToRow(p)}>
                    <Icon name="camera" /> แนบสลิป
                  </button>
                  <button type="button" className="btn btn-sm btn-light" onClick={() => remove(p)}>
                    <Icon name="trash" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
