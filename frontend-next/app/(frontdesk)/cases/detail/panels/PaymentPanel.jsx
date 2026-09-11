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
import { useAsync, readForm, useNowLocal, useObjectUrls } from '../../../../../lib/hooks.js';
import { useToast } from '../../../../../components/Toast.jsx';
import { useConfirm } from '../../../../../components/Confirm.jsx';
import { Badge, Card, Field, FormGrid, Row, Split } from '../../../../../components/ui.jsx';
import { EmployeeSelect } from '../../../../../components/Selects.jsx';
import { Icon } from '../../../../../components/Icon.jsx';
import { useMeta } from '../../../../../contexts/MetaContext.jsx';
import { useAuth } from '../../../../../contexts/AuthContext.jsx';
import { inSystemZone } from '../../../../../lib/roles.js';
import {
  custName, dateOnly, fmtDate, fmtDateTime, money, todayISO, toStamp,
} from '../../../../../lib/format.js';
import { DateField } from '../../../../../components/DateField.jsx';
import { DateTimeField } from '../../../../../components/DateTimeField.jsx';
import { Lightbox } from '../../../../../components/Lightbox.jsx';
import { isPreviewable } from '../../../../../lib/lightbox.js';

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

/* พรีวิวไฟล์ที่เลือกไว้แต่ยังไม่ได้อัปโหลด
   URL มาจาก `useObjectUrls` ของการ์ดแม่ ไม่ได้สร้างเองในนี้แล้ว — การ์ดแม่ต้องใช้
   URL ตัวเดียวกันส่งให้หน้าดูรูปใหญ่ ถ้าต่างคนต่างสร้างจะได้คนละ blob ของไฟล์เดียวกัน */
function SlipThumb({ file, url, onOpen, onRemove }) {
  const image = isPreviewable(file.type) && url;
  return (
    <span className="slip-pick" title={file.name}>
      {image
        ? (
          <button
            type="button"
            className="slip-pick-open"
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            aria-label={`ดูรูปใหญ่ ${file.name}`}
          >
            <img src={url} alt={file.name} />
          </button>
        )
        : <span className="slip-file"><Icon name="file" /></span>}
      <button
        type="button"
        className="slip-pick-x"
        onClick={onRemove}
        aria-label={`เอา ${file.name} ออก`}
      >
        <Icon name="x" />
      </button>
    </span>
  );
}

/* การ์ดอัปโหลดสลิป — ทั้งใบเป็นที่วางไฟล์ ไม่ใช่ปุ่มเล็กๆ มุมขวา
   คนหน้าร้านเปิดแอปธนาคารค้างอยู่แล้ว ลากรูปทิ้งลงการ์ดตรงๆ เร็วกว่าไล่หาใน dialog
   และเห็นรูปที่จะแนบเรียงอยู่ก่อนกดบันทึก ว่าใช่สลิปใบที่ตั้งใจจริง */
function SlipDropCard({ files, onChange }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const urlOf = useObjectUrls(files);
  const [viewing, setViewing] = useState(null);
  const images = files
    .filter((f) => isPreviewable(f.type) && urlOf(f))
    .map((f) => ({ key: `${f.name}-${f.size}`, file: f, src: urlOf(f), alt: f.name, name: f.name }));

  /* ไฟล์ที่ลากมาวางไม่ผ่าน accept ของ <input> — ต้องกรองชนิดเองตรงนี้ และกัน
     ไฟล์เดิมซ้ำ (ชื่อ+ขนาดตรงกัน) เพราะเลือกสองรอบคือแนบสลิปใบเดียวกันสองใบ */
  const take = (list) => {
    const incoming = Array.from(list || []);
    const usable = incoming.filter((f) => f.type && ACCEPT.includes(f.type));
    setSkipped(incoming.length - usable.length);
    const next = [...files];
    for (const f of usable) {
      if (!next.some((e) => e.name === f.name && e.size === f.size)) next.push(f);
    }
    onChange(next);
  };

  return (
    <div
      className={`slip-drop ${over ? 'over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer?.files); }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { take(e.target.files); e.target.value = ''; }}
      />

      <button type="button" className="slip-drop-zone" onClick={() => inputRef.current?.click()}>
        <span className="slip-drop-icon"><Icon name="upload" /></span>
        <b>ลากสลิปมาวางที่นี่ หรือกดเพื่อเลือกไฟล์</b>
        <span className="muted">รูปหรือ PDF · แนบได้หลายไฟล์ · ผูกกับรายการนี้</span>
      </button>

      {files.length > 0 ? (
        <div className="slip-drop-files">
          {files.map((f) => (
            <SlipThumb
              key={`${f.name}-${f.size}`}
              file={f}
              url={urlOf(f)}
              onOpen={() => setViewing(images.findIndex((x) => x.file === f))}
              onRemove={() => { setSkipped(0); onChange(files.filter((x) => x !== f)); }}
            />
          ))}
          <button
            type="button"
            className="btn btn-sm btn-light"
            onClick={() => { setSkipped(0); onChange([]); }}
          >
            <Icon name="trash" /> ล้างไฟล์
          </button>
        </div>
      ) : (
        <p className="slip-drop-note muted">ยังไม่ได้แนบไฟล์ — บันทึกได้โดยไม่มีสลิป</p>
      )}

      {viewing !== null && images.length > 0 ? (
        <Lightbox items={images} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      ) : null}

      {skipped > 0 ? (
        <p className="slip-drop-note skip">
          <Icon name="warning" /> {`ข้าม ${skipped} ไฟล์ที่ไม่ใช่รูปหรือ PDF`}
        </p>
      ) : null}
    </div>
  );
}

/** เวลาจาก DateTimeField ('YYYY-MM-DDTHH:MM') หรือจาก API ('YYYY-MM-DD HH:MM:SS') ให้เป็นรูปเดียวกัน */
const stampOf = (v) => {
  const s = toStamp(v || '');
  return s.length === 16 ? `${s}:00` : s;
};

const CHANGE_TH = { textAlign: 'left', fontWeight: 400, color: 'var(--ink-faint)', padding: '5px 12px 5px 0', whiteSpace: 'nowrap' };

/**
 * แก้ไขรายการรับเงิน — แอดมิน/เจ้าของร้านเท่านั้น (ร้านขอ 11 ก.ย. 2026)
 *
 * ช่องชุดเดียวกับ "รับเงินเข้ามาใหม่" เติมค่าเดิมไว้ให้ · บังคับใส่เหตุผล · เวลารับแก้ได้
 * (ต่างจากตอนรับใหม่ที่ระบบประทับให้) เพราะนี่คือการแก้ของที่บันทึกผิดไปแล้ว ·
 * แก้จนเกินยอดคงเหลือไม่ได้ ยอดคงเหลือคิดโดยไม่นับรายการนี้ · ก่อนส่งสรุปว่าเปลี่ยนอะไร
 * · ด่านจริงทุกข้ออยู่ที่ PUT /api/payments/:id ที่นี่แค่บอกคนแก้ก่อนกด
 */
function PaymentEditDialog({ p, c, onClose, onSaved }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const { meta } = useMeta();

  const [amount, setAmount] = useState(String(Number(p.amount)));
  const [kind, setKind] = useState(p.kind);
  const [method, setMethod] = useState(p.method || 'Cash');
  const [reference, setReference] = useState(p.reference || '');
  const [receivedBy, setReceivedBy] = useState(p.received_by ? String(p.received_by) : '');
  const [paidAt, setPaidAt] = useState(p.paid_at || '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const methodLabel = meta.lists?.pay_type_labels || {};
  /* วิธีชำระของแถวเดิมต้องเลือกค้างไว้ได้ แม้จะถูกเอาออกจากรายการไปแล้ว */
  const methods = [...new Set([...(meta.lists?.pay_type || ['Cash']), p.method].filter(Boolean))];
  const kinds = KINDS.some(([v]) => v === p.kind) ? KINDS : [...KINDS, [p.kind, KIND_LABEL[p.kind] || p.kind]];
  const empName = (id) => (meta.employees || []).find((e) => String(e.id) === String(id))?.employee_name
    || (String(id) === String(p.received_by) ? p.received_by_name : '') || '—';

  const net = c.order ? Number(c.order.total_price) - Number(c.order.discount) : 0;
  const others = Math.max(0, (Number(c.paid) || 0) - Number(p.amount));
  const max = Math.max(0, net - others);
  const entered = Number(amount) || 0;
  const over = net > 0 && entered > max + 0.001;

  /* [ป้าย, ค่าเดิม, ค่าใหม่, เปลี่ยนไหม] — ใช้ทั้งตัดสินว่ามีอะไรให้บันทึก และสรุปก่อนยืนยัน */
  const rows = [
    ['จำนวนเงิน', money(p.amount), money(entered), Number(p.amount) !== entered],
    ['ประเภท', KIND_LABEL[p.kind] || p.kind, KIND_LABEL[kind] || kind, p.kind !== kind],
    ['วิธีชำระ', methodLabel[p.method] || p.method, methodLabel[method] || method, p.method !== method],
    ['อ้างอิง', p.reference || '—', reference.trim() || '—', (p.reference || '') !== reference.trim()],
    ['ผู้รับเงิน', empName(p.received_by), empName(receivedBy), String(p.received_by || '') !== receivedBy],
    ['รับเมื่อ', fmtDateTime(p.paid_at), fmtDateTime(stampOf(paidAt)), stampOf(p.paid_at) !== stampOf(paidAt)],
  ];
  const changes = rows.filter((r) => r[3]);
  const blocked = entered <= 0
    ? 'จำนวนเงินต้องมากกว่า 0'
    : over
      ? `แก้เกินยอดคงเหลือไม่ได้ — รายการนี้แก้ได้ไม่เกิน ${money(max)}`
      : !receivedBy ? 'เลือกผู้รับเงิน' : null;
  const canSave = !busy && !blocked && changes.length > 0 && reason.trim() !== '';

  const save = async () => {
    if (!canSave) return;
    const sure = await confirm('ยืนยันแก้ไขรายการรับเงิน', (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {changes.map(([label, from, to]) => (
            <tr key={label}>
              <th style={CHANGE_TH}>{label}</th>
              <td style={{ textAlign: 'right', padding: '5px 0' }}>
                <span className="muted">{from}</span> → <b>{to}</b>
              </td>
            </tr>
          ))}
          <tr>
            <th style={CHANGE_TH}>เหตุผล</th>
            <td style={{ textAlign: 'right', padding: '5px 0' }}>{reason.trim()}</td>
          </tr>
        </tbody>
      </table>
    ), { confirmText: 'ยืนยันแก้ไข' });
    if (!sure) return;

    setBusy(true);
    try {
      await api.put('/api/payments/' + p.id, {
        amount,
        kind,
        method,
        reference: reference.trim(),
        received_by: receivedBy,
        paid_at: stampOf(paidAt),
        reason: reason.trim(),
      });
      ok('แก้ไขรายการรับเงินแล้ว');
      onSaved();
    } catch (ex) {
      err(ex);
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="แก้ไขรายการรับเงิน">
        <h3>แก้ไขรายการรับเงิน</h3>
        <div className="m-body">
          <div className="pay-form">
            <div className="pay-amount">
              <label htmlFor="pe-amount">จำนวนเงินที่รับ</label>
              <div className="pay-amount-input">
                <span>฿</span>
                <input
                  id="pe-amount"
                  type="number"
                  step="1"
                  min="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className={`pay-after ${over ? 'over' : ''}`}>
                {over
                  ? <b>{`เกินยอดคงเหลือ — รายการนี้แก้ได้ไม่เกิน ${money(max)}`}</b>
                  : net > 0
                    ? <>แก้ได้ไม่เกิน <b>{money(max)}</b></>
                    : <>ออเดอร์ยังไม่มีราคา</>}
              </div>
            </div>

            <div className="pay-choices">
              <div>
                <label>ประเภท</label>
                <Row style={{ gap: 6 }}>
                  {kinds.map(([v, label]) => (
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
            <Field label="อ้างอิง (เลขที่โอน / เลขอนุมัติ)">
              <input id="pe-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <Field label="ผู้รับเงิน *">
              <EmployeeSelect value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
            </Field>
          </FormGrid>

          {/* แถวของตัวเอง — ในกล่องนี้ช่องของ FormGrid แคบ 150px วันที่ถูกตัดเหลือ "1:" */}
          <Field label="รับเมื่อ">
            <div style={{ maxWidth: 380 }}>
              <DateTimeField value={paidAt} onChange={setPaidAt} />
            </div>
          </Field>

          <Field label="เหตุผลที่แก้ไข *">
            <input
              id="pe-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น กดวิธีชำระผิด — ลูกค้าโอนมา"
              autoComplete="off"
            />
          </Field>
        </div>
        <div className="m-foot">
          {blocked ? <span className="process-blockers" style={{ marginRight: 'auto' }}>{blocked}</span> : null}
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button type="button" className="btn" onClick={save} disabled={!canSave}>
            <Icon name="check" />
            {busy ? ' กำลังบันทึก…' : ' บันทึกการแก้ไข'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PaymentPanel({ c, reload }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const { meta } = useMeta();
  const rowSlipRef = useRef(null);
  const { actor } = useAuth();
  /* แก้รายการรับเงินได้เฉพาะแอดมินขึ้นไป (เกณฑ์เดียวกับยกเลิกใบขาย POS) — ซ่อนปุ่ม
     เป็นแค่มารยาท PUT /api/payments/:id ตรวจสิทธิ์เอง */
  const mayEdit = inSystemZone(actor);
  const [editing, setEditing] = useState(null);

  const [slips, setSlips] = useState([]);          // files chosen for the payment being written
  /* สลิปของรายการรับเงินไหน กำลังดูใบที่เท่าไร · ปุ่ม < > วนเฉพาะสลิปของรายการนั้น
     ไม่ข้ามไปสลิปของรายการอื่น ซึ่งเป็นเงินคนละก้อน */
  const [slipView, setSlipView] = useState(null);
  const [attachTo, setAttachTo] = useState(null);  // payment a slip is being added to
  const [method, setMethod] = useState('Cash');
  const [kind, setKind] = useState(Number(c.paid) > 0 ? 'final' : 'deposit');
  const [amount, setAmount] = useState(Number(c.balance) > 0 ? String(c.balance) : '');
  const [receivedBy, setReceivedBy] = useState('');

  /* นาฬิกาของช่อง "รับเมื่อ" — เดินตลอด เพราะการ์ดนี้เป็นการ์ดรับเงิน "เข้ามาใหม่"
     ค่าที่ใส่ในใบจึงเป็นเวลาปัจจุบันเสมอ ไม่มีเคสที่ต้องแสดงเวลาที่บันทึกไว้แล้ว */
  const clockNow = useNowLocal();

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
  /* รับเกินยอดไม่ได้เลย (ร้านตัดสินไว้ · API กันซ้ำอีกชั้น) — เงื่อนไขเดิมเตือนเฉพาะตอน
     ยังมียอดค้าง พอยอดครบแล้วคำเตือนหายไป กดบันทึกซ้ำจึงผ่านไปเงียบ ๆ สามครั้ง
     ออเดอร์ยอด 0 = ยังไม่ใส่ราคา ไม่มียอดให้เทียบ จึงรับมัดจำได้ */
  const priced = net > 0;
  const fullyPaid = priced && left <= 0;
  const overpay = priced && enteredAmount > left;
  const [saving, setSaving] = useState(false);

  /* สองอย่างที่ต้องมีก่อนเงินจะลงระบบ — วันนัดรับ (อยู่การ์ดบนสุด บันทึกแยก) และ
     ผู้รับเงิน ปุ่มบันทึกจึงปิดไว้พร้อมบอกว่าขาดอะไร ดีกว่าให้กดแล้วค่อยเด้ง error */
  const missingBeforeSave = [
    c.order?.appointment_date ? null : 'วันนัดรับ',
    receivedBy ? null : 'ผู้รับเงิน',
  ].filter(Boolean);
  const blockedReason = fullyPaid
    ? 'ออเดอร์นี้ชำระครบแล้ว'
    : overpay ? `รับเกินยอดคงเหลือไม่ได้ — คงเหลือ ${money(left)}` : null;

  const chooseKind = (v) => {
    setKind(v);
    if ((v === 'full' || v === 'final') && left > 0) setAmount(String(left));
    if (v === 'deposit' && (!enteredAmount || enteredAmount === left)) setAmount('');
  };

  /**
   * บันทึกรับเงิน — กันผิดสามชั้น (เหตุการณ์ 11 ก.ย. 2026: ฿2,900 ถูกบันทึกสามครั้ง)
   *
   *   1. กล่องสรุปทุกครั้งก่อนส่ง — อ่านจากค่าที่จะส่งจริง ไม่ใช่ข้อความลอย ๆ
   *   2. ระหว่างส่ง ปุ่มล็อก และบันทึกเสร็จแล้วล้างจำนวนเงิน อ้างอิง สลิป — ปุ่มที่ยัง
   *      เขียนว่า "บันทึก ฿2,900" หลังบันทึกไปแล้ว คือปุ่มที่ชวนให้กดซ้ำ
   *   3. API ตอบว่า "อาจซ้ำ" (ยอดเท่ากันภายใน 10 นาที) → ถามอีกครั้ง ยืนยันแล้วค่อยส่งใหม่
   *      ส่วนรับเกินยอด API ปฏิเสธเสมอ ไม่มีทางยืนยันข้าม
   */
  const add = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (missingBeforeSave.length) {
      return err(new Error(`กรอกให้ครบก่อนบันทึก — ขาด: ${missingBeforeSave.join(', ')}`));
    }
    if (blockedReason) return err(new Error(blockedReason));

    const form = e.currentTarget;
    const body = readForm(form);
    const employeeName = (meta.employees || [])
      .find((x) => String(x.id) === String(receivedBy))?.employee_name || '—';
    const rows = [
      ['จำนวนเงิน', money(enteredAmount)],
      ['ประเภท', KIND_LABEL[kind] || kind],
      ['วิธีชำระ', methodLabel[method] || method],
      ['ผู้รับเงิน', employeeName],
      ['คงเหลือหลังรับ', priced ? money(afterThis) : 'ออเดอร์ยังไม่มีราคา'],
    ];
    if (body.reference) rows.push(['อ้างอิง', body.reference]);
    if (slips.length) rows.push(['สลิป', `${slips.length} ไฟล์`]);

    const confirmed = await confirm('ยืนยันบันทึกการรับเงิน', (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th style={{ textAlign: 'left', fontWeight: 400, color: 'var(--ink-faint)', padding: '5px 12px 5px 0', whiteSpace: 'nowrap' }}>{k}</th>
              <td style={{ textAlign: 'right', fontWeight: 600, padding: '5px 0' }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ), { confirmText: `ยืนยันบันทึก ${money(enteredAmount)}` });
    if (!confirmed) return;

    const payload = {
      ...body,
      kind,
      method,
      amount,
      paid_at: toStamp(body.paid_at),
      case_id: c.id,
      order_id: c.order?.id,
    };
    setSaving(true);
    try {
      let saved;
      try {
        saved = await api.post('/api/payments', payload);
      } catch (ex) {
        if (ex.reason !== 'possible_duplicate') throw ex;
        const again = await confirm('อาจเป็นรายการซ้ำ', ex.message, {
          confirmText: 'ไม่ซ้ำ — บันทึกอีกรายการ', danger: true,
        });
        if (!again) return;
        saved = await api.post('/api/payments', { ...payload, confirm_duplicate: true });
      }
      for (const file of slips) await sendSlip(file, saved.id);
      ok(slips.length ? `บันทึกการรับเงินและแนบสลิป ${slips.length} ไฟล์แล้ว` : 'บันทึกการรับเงินแล้ว');
      setSlips([]);
      setAmount('');
      form.reset();
      reload();
      reloadFiles();
    } catch (ex) {
      err(ex);
    } finally {
      setSaving(false);
    }
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

  /* รูปสลิปของรายการรับเงินหนึ่งรายการ ใช้ URL เดียวกับรูปย่อเป๊ะ · PDF ไม่อยู่ในชุดนี้ */
  const slipImages = (paymentId) => slipsOf(paymentId)
    .filter((f) => isPreviewable(f.mime_type))
    .map((f) => ({ key: f.id, src: api.url('/api/uploads/' + f.id), alt: f.original_name || 'สลิป', name: f.original_name || '' }));

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
                {fullyPaid ? (
                  <><b>ชำระครบแล้ว</b> — ไม่มียอดคงเหลือให้รับเพิ่ม</>
                ) : !priced ? (
                  <>ออเดอร์ยังไม่มีราคา — รับเป็น <b>มัดจำ</b> ได้</>
                ) : enteredAmount > 0 ? (
                  overpay
                    ? <>รับ {money(enteredAmount)} — <b>เกินยอดคงเหลือ {money(enteredAmount - left)} รับไม่ได้</b></>
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
            {/* เวลารับเงินเป็นของที่ระบบรู้เอง ไม่ใช่คำถามที่ต้องถามคนเก็บเงิน — แก้ไม่ได้
                เพราะใบรับเงินที่ย้อนเวลาได้ ทำให้ตอนปิดยอดสิ้นวันตอบไม่ได้ว่าเงินก้อนนี้
                เข้าลิ้นชักตอนไหนจริง ๆ · ก่อนหน้านี้เป็น defaultValue ที่ค้างอยู่ที่เวลา
                ตอนเปิดหน้า รับเงินใบที่สองของบ่ายนั้นจึงติดเวลาของใบแรกไปด้วย */}
            <Field label="รับเมื่อ" hint="ระบบประทับเวลาให้ตอนกดบันทึก">
              <DateTimeField name="paid_at" readOnly value={clockNow} />
            </Field>
          </FormGrid>

          <SlipDropCard files={slips} onChange={setSlips} />

          <div className="pay-actions">
            {blockedReason ? (
              <span className="process-blockers">{blockedReason}</span>
            ) : missingBeforeSave.length ? (
              <span className="process-blockers">{`ยังบันทึกไม่ได้ — ขาด: ${missingBeforeSave.join(', ')}`}</span>
            ) : null}
            <button
              className="btn btn-lg"
              type="submit"
              disabled={saving || !!blockedReason || missingBeforeSave.length > 0}
              title={blockedReason
                || (missingBeforeSave.length ? `ยังบันทึกไม่ได้ — ขาด: ${missingBeforeSave.join(', ')}` : undefined)}
            >
              <Icon name="check" />
              {saving
                ? ' กำลังบันทึก…'
                : fullyPaid ? ' ชำระครบแล้ว' : ` บันทึกการรับเงิน ${amount ? money(amount) : ''}`}
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
                        {isPreviewable(f.mime_type)
                          ? (
                            <button
                              type="button"
                              className="slip-open"
                              onClick={(e) => {
                                e.stopPropagation();
                                const index = slipImages(p.id).findIndex((x) => x.key === f.id);
                                if (index >= 0) setSlipView({ paymentId: p.id, index });
                              }}
                              aria-label={`ดูสลิป ${f.original_name || ''}`.trim()}
                              title="กดเพื่อดูรูปใหญ่"
                            >
                              <img src={api.url('/api/uploads/' + f.id)} alt={f.original_name || 'สลิป'} />
                            </button>
                          )
                          : (
                            <a href={api.url('/api/uploads/' + f.id)} target="_blank" rel="noreferrer">
                              <span className="slip-file"><Icon name="file" /></span>
                            </a>
                          )}
                        <button type="button" onClick={() => removeSlip(f)} title="ลบสลิป"><Icon name="x" /></button>
                      </span>
                    ))}
                    {slipView?.paymentId === p.id ? (
                      <Lightbox
                        items={slipImages(p.id)}
                        index={slipView.index}
                        onIndex={(index) => setSlipView({ paymentId: p.id, index })}
                        onClose={() => setSlipView(null)}
                      />
                    ) : null}
                    {mayEdit && !p.cancelled_at ? (
                      <button type="button" className="btn btn-sm btn-light" onClick={() => setEditing(p)}>
                        <Icon name="pencil" /> แก้ไข
                      </button>
                    ) : null}
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

      {editing ? (
        <PaymentEditDialog
          p={editing}
          c={c}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      ) : null}
    </>
  );
}
