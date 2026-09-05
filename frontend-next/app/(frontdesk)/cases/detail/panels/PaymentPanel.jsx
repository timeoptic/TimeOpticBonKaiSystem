'use client';
/**
 * Process 5 — ชำระเงิน.
 *
 * สองคอลัมน์: ซ้ายคือสิ่งที่ทำ (รับเงินเข้ามา แล้วประวัติว่ารับอะไรไปบ้าง)
 * ขวาคือสิ่งที่อ่าน (ยอดคงเหลือ กับใครเป็นใคร) — คนที่เปิดหน้านี้มาทำอย่างเดียว
 * คือรับเงิน ตัวเลขที่ต้องเห็นตลอดจึงอยู่ข้างขวาแบบไม่เลื่อนหาย ไม่ใช่แถบบนสุด
 * ที่เลื่อนพ้นจอไปตอนกรอกฟอร์ม
 *
 * Every payment can carry its slip — the transfer screenshot or the receipt —
 * attached to the payment row it proves (case_photos.payment_id), never loose
 * on the case, so a row and its evidence cannot drift apart.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../../../lib/apiClient.js';
import { useAsync, readForm } from '../../../../../lib/hooks.js';
import { useToast } from '../../../../../components/Toast.jsx';
import { useConfirm } from '../../../../../components/Confirm.jsx';
import { Badge, Card, Field, FormGrid, Row, Split } from '../../../../../components/ui.jsx';
import { EmployeeSelect } from '../../../../../components/Selects.jsx';
import { Icon } from '../../../../../components/Icon.jsx';
import { useMeta } from '../../../../../contexts/MetaContext.jsx';
import {
  custName, dateOnly, fmtDate, fmtDateTime, money, nowLocal, todayISO, toStamp,
} from '../../../../../lib/format.js';
import { DateField } from '../../../../../components/DateField.jsx';

/* "จ่ายบางส่วน" ออกแล้ว — มันกับ "มัดจำ" ตอบคำถามเดียวกัน (จ่ายมาไม่ครบ) ต่างกันแค่
   ว่าเป็นก้อนแรกหรือไม่ ซึ่งระบบดูจากประวัติเองได้ ตัวเลือกที่ต้องหยุดคิดว่าจะเลือก
   อันไหนดีคือตัวเลือกที่กรอกผิดได้ — ป้ายยังอยู่ในตารางแปลเพื่อให้แถวเก่าอ่านออก */
const KINDS = [
  ['deposit', 'มัดจำ'], ['final', 'ชำระส่วนที่เหลือ'], ['full', 'ชำระเต็ม'],
];
const KIND_LABEL = { ...Object.fromEntries(KINDS), partial: 'จ่ายบางส่วน' };
const KIND_BADGE = { deposit: 'blue', partial: 'warn', final: 'ok', full: 'ok' };

const METHOD_ICON = {
  Cash: 'banknote', Transfer: 'coins', QR: 'chart', Credit: 'card',
  ThungNgern: 'moneyBag', Other: 'tag',
};

const SLIP_KIND = 'payment_slip';
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

/**
 * วันนัดรับ — ของออเดอร์ ไม่ใช่ของเงินก้อนใดก้อนหนึ่ง
 *
 * ลูกค้าจ่ายกี่รอบก็ได้ แต่วันที่มารับแว่นมีวันเดียว ค่าจึงเขียนลง
 * custom_orders.appointment_date ไม่ใช่แถวใน payments — เปิดหน้าใหม่วันหลังจึง
 * เห็นวันเดิม และกดแก้ทับได้ตลอด (PUT /api/orders/:id/appointment แตะคอลัมน์เดียว
 * PUT /api/orders/:id เขียนทับทั้งใบ ห้ามใช้ที่นี่)
 *
 * บังคับกรอกก่อนยืนยันขั้นชำระเงิน — คนที่จ่ายเงินคือคนที่ถามว่า "มารับได้วันไหน"
 * ถ้าปล่อยให้ข้าม เคสจะไปถึงขั้นส่งมอบโดยไม่มีวันนัดให้ใครตามงาน (เงื่อนไขตัวจริง
 * อยู่ที่ processMissing() ฝั่ง API — ที่นี่แค่บอกให้คนกรอกเห็นก่อนไปกดยืนยัน)
 * ไม่ผูกกับยอดค้าง: นัดวันรับได้ตั้งแต่ยังจ่ายไม่ครบ
 * ปุ่มลัดมีเพราะร้านนัดเป็น "อีกกี่วัน" ไม่ใช่ "วันที่เท่าไหร่"
 */
const QUICK_DAYS = [['วันนี้', 0], ['+3 วัน', 3], ['+7 วัน', 7], ['+14 วัน', 14]];

function PickupDateCard({ c, reload }) {
  const { ok, err } = useToast();
  const saved = dateOnly(c.order?.appointment_date);
  const [date, setDate] = useState(saved);
  const [saving, setSaving] = useState(false);

  /* ค่าอาจเปลี่ยนมาจากที่อื่น (หน้าออเดอร์ หรืออีกแท็บ) — reload แล้วช่องต้องตาม */
  useEffect(() => { setDate(saved); }, [saved]);

  if (!c.order) {
    return (
      <Card title="วันนัดรับ">
        <p className="muted">วันนัดรับผูกกับออเดอร์ — เปิดออเดอร์ที่ขั้น “ขาย” ก่อน</p>
      </Card>
    );
  }

  const dirty = date !== saved;

  const save = async (value) => {
    setSaving(true);
    try {
      await api.put(`/api/orders/${c.order.id}/appointment`, {
        appointment_date: value || null,
      });
      ok(value ? `นัดรับ ${fmtDate(value)}` : 'ล้างวันนัดรับแล้ว');
      reload();
    } catch (ex) { err(ex); } finally { setSaving(false); }
  };

  return (
    <Card
      title="วันนัดรับ"
      right={saved
        ? <span className="muted">บังคับ — กรอกแล้ว</span>
        : <Badge kind="warn">บังคับ — ต้องกรอกก่อนยืนยัน</Badge>}
    >
      <div className="pickup">
        <label htmlFor="pickup-date"><Icon name="calendar" /> วันนัดรับ</label>
        <DateField
          id="pickup-date"
          className="pickup-input"
          value={date}
          disabled={saving}
          onChange={setDate}
        />
        <button type="button" className="btn" disabled={!dirty || saving} onClick={() => save(date)}>
          <Icon name="check" /> บันทึก
        </button>
        {saved ? (
          <button type="button" className="btn btn-light" disabled={saving} onClick={() => save('')}>
            <Icon name="x" /> ล้าง
          </button>
        ) : null}
      </div>

      <Row style={{ gap: 6, marginTop: 10 }}>
        {QUICK_DAYS.map(([label, days]) => (
          <button
            type="button"
            key={label}
            className={`chip-btn ${date && date === todayISO(days) ? 'active' : ''}`}
            onClick={() => setDate(todayISO(days))}
          >
            {label}
          </button>
        ))}
      </Row>

      <p className={`pickup-now ${dirty ? 'dirty' : ''}`}>
        {dirty
          ? <>ยังไม่ได้บันทึก — กด “บันทึก” เพื่อเก็บ {date ? <b>{fmtDate(date)}</b> : 'การล้างวันนัด'}</>
          : saved
            ? <>บันทึกไว้แล้ว <b>{fmtDate(saved)}</b> · แก้ไขภายหลังได้</>
            : <>ยังไม่ได้กำหนด <b>—</b> · ต้องกรอกก่อนจึงจะยืนยันขั้นชำระเงินได้</>}
      </p>
    </Card>
  );
}

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
  const [receivedBy, setReceivedBy] = useState('');

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

  /* "จ่ายบางส่วน" is only a useful word if the shop can see how much is left
     after it — so the amount and what it leaves behind are shown together, and
     the types that mean "all of it" fill the amount in themselves. */
  const enteredAmount = Number(amount) || 0;
  const afterThis = Math.max(0, left - enteredAmount);
  const overpay = enteredAmount > left && left > 0;

  /* สองอย่างที่ต้องมีก่อนเงินจะลงระบบ — วันนัดรับ (อยู่การ์ดบนสุด บันทึกแยก) และ
     ผู้รับเงิน ปุ่มบันทึกจึงปิดไว้พร้อมบอกว่าขาดอะไร ดีกว่าให้กดแล้วค่อยเด้ง error */
  const missingBeforeSave = [
    c.order?.appointment_date ? null : 'วันนัดรับ',
    receivedBy ? null : 'ผู้รับเงิน',
  ].filter(Boolean);

  const chooseKind = (v) => {
    setKind(v);
    if ((v === 'full' || v === 'final') && left > 0) setAmount(String(left));
    if (v === 'deposit' && (!enteredAmount || enteredAmount === left)) setAmount('');
  };

  const add = async (e) => {
    e.preventDefault();
    if (missingBeforeSave.length) {
      return err(new Error(`กรอกให้ครบก่อนบันทึก — ขาด: ${missingBeforeSave.join(', ')}`));
    }
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
    <>
      <input ref={rowSlipRef} type="file" accept={ACCEPT} multiple style={{ display: 'none' }} onChange={onRowSlip} />

      <Split className="aside">
      <div className="stack">

      <PickupDateCard c={c} reload={reload} />

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
              <div className={`pay-after ${overpay ? 'over' : afterThis === 0 && enteredAmount > 0 ? 'clear' : ''}`}>
                {enteredAmount > 0 ? (
                  overpay
                    ? <>รับ {money(enteredAmount)} — <b>เกินยอดคงเหลือ {money(enteredAmount - left)}</b></>
                    : afterThis === 0
                      ? <>รับ {money(enteredAmount)} — <b>ครบยอดพอดี</b></>
                      : <>รับ {money(enteredAmount)} — เหลืออีก <b>{money(afterThis)}</b></>
                ) : <>ยังไม่ได้ใส่จำนวน — คงเหลือ <b>{money(left)}</b></>}
              </div>
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
                      onClick={() => chooseKind(v)}
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
            <Field label="ผู้รับเงิน *">
              <EmployeeSelect
                name="received_by"
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
                required
              />
            </Field>
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
            {missingBeforeSave.length ? (
              <span className="process-blockers">{`ยังบันทึกไม่ได้ — ขาด: ${missingBeforeSave.join(', ')}`}</span>
            ) : null}
            <button
              className="btn btn-lg"
              type="submit"
              disabled={missingBeforeSave.length > 0}
              title={missingBeforeSave.length ? `ยังบันทึกไม่ได้ — ขาด: ${missingBeforeSave.join(', ')}` : undefined}
            >
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
          /* ไทม์ไลน์แทนตาราง — เงินเข้ามาเป็นเหตุการณ์ตามเวลา ไม่ใช่แถวข้อมูลที่จะเอาไป
             เรียงใหม่หรือกรอง วงกลมไอคอนบอกวิธีจ่ายได้ตั้งแต่ยังไม่อ่านตัวหนังสือ */
          <ol className="pay-feed">
            {payments.map((p) => (
              <li className={`pay-ev ${p.cancelled_at ? 'cancelled' : ''}`} key={p.id}>
                <span className={`pay-ev-dot ${p.cancelled_at ? 'off' : ''}`}>
                  <Icon name={METHOD_ICON[p.method] || 'coins'} />
                </span>
                <div className="pay-ev-body">
                  <div className="pay-ev-head">
                    <b>{money(p.amount)}</b>
                    <Badge kind={KIND_BADGE[p.kind] || 'gray'}>{KIND_LABEL[p.kind] || p.kind}</Badge>
                    <span className="muted">{methodLabel[p.method] || p.method}</span>
                    {p.cancelled_at ? <Badge kind="danger">ยกเลิกแล้ว</Badge> : null}
                  </div>
                  <div className="pay-ev-when muted">
                    {fmtDateTime(p.paid_at)}
                    {p.received_by_name ? ` · รับโดย ${p.received_by_name}` : ''}
                    {p.reference ? ` · อ้างอิง ${p.reference}` : ''}
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
              </li>
            ))}
          </ol>
        )}
      </Card>

      </div>

      {/* คอลัมน์ขวา — ตัวเลขกับข้อเท็จจริงที่ต้องเห็นตลอดเวลาที่กรอกฟอร์มฝั่งซ้าย */}
      <div className="stack">
        <Card title="สรุปยอด" right={
          left > 0
            ? <Badge kind={paid > 0 ? 'warn' : 'gray'}>{paid > 0 ? 'ชำระบางส่วน' : 'ยังไม่ชำระ'}</Badge>
            : <Badge kind="ok"><Icon name="check" /> ชำระครบแล้ว</Badge>
        }>
          <div className="pay-due">
            <span>คงเหลือ</span>
            <b className={left > 0 ? 'due' : 'ok'}>{money(left)}</b>
          </div>
          <div className="pay-bar-wrap">
            <div className="pay-bar"><span style={{ width: `${pct}%` }} /></div>
            <small>{net > 0 ? `ชำระแล้ว ${pct}% ของ ${money(net)}` : 'ยังไม่มียอดจากออเดอร์'}</small>
          </div>
          <dl className="pay-facts">
            <dt>ยอดสุทธิ</dt><dd>{money(net)}</dd>
            <dt>รับแล้ว</dt><dd className="ok">{money(paid)}</dd>
          </dl>
        </Card>

        <Card title="รายละเอียด">
          <dl className="pay-meta">
            <dt><Icon name="user" /> ลูกค้า</dt>
            <dd>{custName(c) || '—'}</dd>
            <dt><Icon name="phone" /> โทร</dt>
            <dd>{c.phone || '—'}</dd>
            <dt><Icon name="board" /> เคส</dt>
            <dd className="mono">{c.case_code}</dd>
            <dt><Icon name="glasses" /> ออเดอร์</dt>
            <dd className="mono">
              {c.order
                ? <Link href={'/orders/detail?id=' + c.order.id}>{c.order.invoice_code || `#${c.order.id}`}</Link>
                : <span className="muted">ยังไม่มีออเดอร์</span>}
            </dd>
            <dt><Icon name="calendar" /> วันนัดรับ</dt>
            <dd>{c.order?.appointment_date ? fmtDate(c.order.appointment_date) : '—'}</dd>
          </dl>
        </Card>
      </div>
      </Split>
    </>
  );
}
