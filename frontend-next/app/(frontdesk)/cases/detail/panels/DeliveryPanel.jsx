'use client';
/**
 * ขั้น "ส่งมอบ" — จุดปิดงานหน้าร้าน ตอนลูกค้ายืนอยู่ตรงหน้าเคาน์เตอร์
 *
 * คำถามของหน้านี้เรียงตามลำดับที่พนักงานถามจริง:
 *   ส่งให้ใคร → ยอดเงินเป็นยังไง → ส่งอะไร → เก็บเงินที่เหลือ → ยืนยันส่งมอบ
 *
 * เดิมหน้านี้อ่านอย่างเดียว ค้างเงินอยู่ก็ต้องเด้งกลับไปขั้น "ชำระเงิน" แล้ววนกลับมา
 * ซึ่งเป็นการสลับหน้าจอตอนที่ลูกค้ายืนรออยู่ ตอนนี้รับเงินก้อนสุดท้ายจบที่นี่ได้เลย
 *
 * การรับเงินที่นี่ **ไม่ใช่ระบบใหม่** — ยิง POST /api/payments เส้นเดียวกับขั้น
 * "ชำระเงิน" แนบสลิปด้วย /api/uploads เหมือนกัน รายการจึงไปโผล่ในประวัติเดียวกัน
 * ต่างกันแค่ `source: 'delivery'` ที่มีไว้ตรวจย้อนว่ารับเงินจากหน้าไหน
 *
 * ไม่มีตัวเลือก "ประเภทการชำระ" ที่นี่ — คำถามเดียวของหน้านี้คือ "รับมาเท่าไหร่"
 * ส่วนสถานะระบบคิดจากเงินจริงที่ได้รับเอง (ดู kindFor())
 *
 * ปุ่มหลักยังเป็นปุ่มยืนยันของ ProcessShell ปุ่มเดียว (ไม่สร้างปุ่มซ้อน) โดย panel
 * ฝาก beforeComplete ไว้ให้เปิดกล่องยืนยันก่อน แล้วค่อยบันทึกการส่งมอบ
 * — ยอดค้างชำระ "ไม่ใช่" เงื่อนไขของการส่งมอบ เตือนได้แต่ห้ามปิดปุ่ม
 * (ฝั่ง API ก็คิดแบบเดียวกัน: processBlocking ของขั้นนี้ดูแค่ว่ามีออเดอร์หรือยัง)
 *
 * ขั้นนี้เป็นขั้นสุดท้าย — กดยืนยันแล้วเคสปิด
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../../lib/apiClient.js';
import { useAsync, useObjectUrls } from '../../../../../lib/hooks.js';
import { useToast } from '../../../../../components/Toast.jsx';
import { useConfirm } from '../../../../../components/Confirm.jsx';
import { Badge, Card, CardFold, Field, FormGrid, Kv, Row, Split, Stack } from '../../../../../components/ui.jsx';
import { EmployeeSelect, Select } from '../../../../../components/Selects.jsx';
import { useProcessActions } from '../../../../../components/ProcessShell.jsx';
import { useMeta } from '../../../../../contexts/MetaContext.jsx';
import { custName, fmtDate, fmtDateTime, money, nowLocal, toStamp } from '../../../../../lib/format.js';
import { Icon } from '../../../../../components/Icon.jsx';
import { DateTimeField } from '../../../../../components/DateTimeField.jsx';
import { Lightbox } from '../../../../../components/Lightbox.jsx';
import { isPreviewable } from '../../../../../lib/lightbox.js';
import { isUnpaidRow } from '../../../../../lib/paymentUnpaid.js';
import { useAuth } from '../../../../../contexts/AuthContext.jsx';
import { inSystemZone } from '../../../../../lib/roles.js';

/** grinder_employee_id = 0 — งานนี้ไม่มีคนเจีย (ค่าคอมงานเจียใน HRMS ไม่จ่าย) */
const NO_GRINDER_LABEL = 'ไม่มีคนเจีย';
/** บัญชีที่ไม่ใช่ช่าง ไม่ให้เลือกเป็นคนเจีย */
const NOT_GRINDERS = new Set(['ผู้ดูแลระบบ']);

/* ไอคอนต่อวิธีจ่าย — ชุดเดียวกับขั้น "ชำระเงิน" ตัวเลือกจริงมาจาก meta.lists.pay_type
   ไม่ได้พิมพ์รายการไว้เอง ร้านเพิ่มช่องทางใหม่แล้วที่นี่ขึ้นตาม */
const METHOD_ICON = {
  Cash: 'banknote', Transfer: 'coins', QR: 'chart', Credit: 'card',
  ThungNgern: 'moneyBag', Other: 'tag',
};

const SLIP_KIND = 'payment_slip';
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

/**
 * ประเภทของรายการรับเงิน คิดจากเงินจริง ไม่ได้ถามพนักงาน — หน้านี้มีคำถามเดียว
 * คือ "รับมาเท่าไหร่" คอลัมน์ `kind` ยังต้องมีค่าเพราะขั้น "ชำระเงิน" กับรายงาน
 * อ่านมันอยู่ จึงเดาให้ตรงกับความจริงแทนที่จะยัด 'final' ให้ทุกแถว
 */
function kindFor(paidBefore, amount, remaining) {
  const clears = amount >= remaining;
  if (paidBefore <= 0) return clears ? 'full' : 'deposit';
  return clears ? 'final' : 'partial';
}

/** กรอบ/เลนส์หนึ่งชิ้น: ป้ายกำกับ ชื่อสินค้า แล้วรายละเอียดรอง */
function Item({ label, name, sub }) {
  return (
    <div className="dlv-item">
      <span className="dlv-item-label">{label}</span>
      <b>{name || '—'}</b>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

/** ชื่อเลนส์ที่จะโชว์ — ออเดอร์เก็บรุ่นเดียวใช้ทั้งสองข้าง จึงแสดงครั้งเดียว */
function lensBlocks(order) {
  const sub = [order.lens_brand, order.lens_index, order.lens_coating, order.lens_design]
    .filter(Boolean).join(' · ');
  return [{ label: 'LENS', name: order.lens_name, sub }];
}

/** เวลาจาก DateTimeField ('YYYY-MM-DDTHH:MM') หรือจาก API ('YYYY-MM-DD HH:MM:SS') ให้เป็นรูปเดียวกัน */
const stampOf = (v) => {
  const s = toStamp(v || '');
  return s.length === 16 ? `${s}:00` : s;
};

/**
 * แก้วันส่งมอบที่บันทึกไปแล้ว — แอดมินขึ้นไป (ร้านขอ 22 ต.ค. 2026)
 * บังคับเหตุผล · บิลที่ปิดตอนส่งมอบขยับวันปิดตาม · ด่านจริงอยู่ที่
 * PUT /api/case-deliveries/:case_id/date ที่นี่แค่บอกคนแก้ก่อนกด
 */
function DeliveryDateDialog({ c, d, onClose, onSaved }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const [at, setAt] = useState(d.delivered_at || '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const changed = stampOf(at) !== stampOf(d.delivered_at);
  const future = stampOf(at) > stampOf(nowLocal());
  const blocked = !at ? 'เลือกวันเวลาส่งมอบ' : future ? 'วันส่งมอบต้องไม่เป็นเวลาในอนาคต' : null;
  const canSave = !busy && !blocked && changed && reason.trim() !== '';

  const save = async () => {
    if (!canSave) return;
    const sure = await confirm('ยืนยันแก้วันส่งมอบ', (
      <Kv
        rows={[
          ['ส่งมอบเมื่อ', <><span className="muted">{fmtDateTime(d.delivered_at)}</span> → <b>{fmtDateTime(stampOf(at))}</b></>],
          ['เหตุผล', reason.trim()],
        ]}
      />
    ), { confirmText: 'ยืนยันแก้ไข' });
    if (!sure) return;
    setBusy(true);
    try {
      await api.put(`/api/case-deliveries/${c.id}/date`, { delivered_at: stampOf(at), reason: reason.trim() });
      ok('แก้วันส่งมอบแล้ว');
      onSaved();
    } catch (ex) {
      err(ex);
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="แก้วันส่งมอบ">
        <h3>แก้วันส่งมอบ</h3>
        <div className="m-body">
          <Field label="ส่งมอบเมื่อ">
            <div style={{ maxWidth: 380 }}>
              <DateTimeField value={at} onChange={setAt} />
            </div>
          </Field>
          <Field label="เหตุผลที่แก้ไข *">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น ส่งแว่นจริงเมื่อวาน แต่ลืมกดส่งมอบ"
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

export function DeliveryPanel({ c, reload }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const { meta } = useMeta();
  const actions = useProcessActions();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const decide = useRef(null);
  const { actor } = useAuth();
  /* ลงวันส่งมอบย้อนหลัง / แก้วันที่บันทึกแล้ว ได้เฉพาะแอดมินขึ้นไป — ซ่อนปุ่มเป็นแค่มารยาท
     API ตรวจสิทธิ์เอง และพนักงานทั่วไปส่งวันอะไรไปก็ได้เวลาเซิร์ฟเวอร์ */
  const mayEditDate = inSystemZone(actor);
  const [editingDate, setEditingDate] = useState(false);

  const d = c.delivery || {};
  const o = c.order || {};
  const delivered = !!d.delivered_at;
  const paid = Number(c.paid) || 0;
  const net = (Number(o.total_price) || 0) - (Number(o.discount) || 0);
  /* รับเกินยอดเกิดได้จากข้อมูลเก่าหรือจากขั้น "ชำระเงิน" ที่ไม่ได้จำกัดเพดานไว้ —
     ที่นี่ถือว่าไม่มีอะไรค้าง แต่ต้องไม่โชว์ "คงเหลือ -2,000" ให้พนักงานงง */
  const rawBalance = Number(c.balance) || 0;
  const balance = Math.max(0, rawBalance);
  const overpaid = rawBalance < 0 ? -rawBalance : 0;
  const pct = net > 0 ? Math.min(100, Math.round((paid / net) * 100)) : 0;
  const name = custName(c);
  const blocking = actions?.state?.blocking || [];
  const payments = c.payments || [];
  const methods = meta.lists?.pay_type || ['Cash'];
  const methodLabel = meta.lists?.pay_type_labels || {};
  const empName = (id) => (meta.employees.find((e) => Number(e.id) === Number(id)) || {}).employee_name || '—';
  const lenses = lensBlocks(o);
  const frameSub = [o.frame_color, o.frame_size, o.frame_sku].filter(Boolean).join(' · ');
  /* ออเดอร์เก่าหลายใบไม่ได้แยก frame_model ไว้ ชื่อเต็มใน frame_name จึงบอกได้มากกว่า
     "Gucci" เฉย ๆ — ใช้ยี่ห้อ+รุ่นเมื่อมีจริงเท่านั้น */
  const frameName = o.frame_model
    ? [o.frame_brand, o.frame_model].filter(Boolean).join(' ')
    : (o.frame_name || o.frame_brand);

  /* ---- ฟอร์มรับเงิน ---------------------------------------------------- */
  const slipRef = useRef(null);
  const [slips, setSlips] = useState([]);
  /* URL พรีวิวคงที่ต่อไฟล์ — เดิมเรียก URL.createObjectURL ตรง ๆ ใน JSX ได้ blob ใหม่ทุกครั้ง
     ที่แผงรีเรนเดอร์ (พิมพ์จำนวนเงินหนึ่งตัวก็หนึ่งชุด) ค้างในหน่วยความจำจนปิดแท็บ */
  const urlOfSlip = useObjectUrls(slips);
  const [slipView, setSlipView] = useState(null);
  const pendingSlipImages = slips
    .filter((f) => isPreviewable(f.type) && urlOfSlip(f))
    .map((f) => ({ key: f.name + f.size, file: f, src: urlOfSlip(f), alt: f.name, name: f.name }));
  const [method, setMethod] = useState(null);
  const [receivedBy, setReceivedBy] = useState('');
  const [paidAt, setPaidAt] = useState(nowLocal());
  const [note, setNote] = useState('');
  /* ตั้งไว้เท่ายอดคงเหลือตั้งแต่เปิดหน้า — เคสที่เจอบ่อยที่สุดคือรับครบทีเดียว
     พนักงานจึงไม่ต้องพิมพ์เลขซ้ำกับที่อ่านอยู่บนจอ */
  const [amount, setAmount] = useState(balance > 0 ? String(balance) : '');
  const [saving, setSaving] = useState(false);

  const { data: files, reload: reloadFiles } = useAsync(
    () => api.get('/api/uploads', { case_id: c.id }),
    [c.id],
  );
  const slipsOf = (paymentId) =>
    (files || []).filter((f) => Number(f.payment_id) === Number(paymentId));

  const entered = Number(amount) || 0;
  const overpay = entered > balance;
  const amountError = !entered
    ? null
    : overpay ? `จำนวนเงินที่รับต้องไม่เกินยอดคงเหลือ ${money(balance)}` : null;
  /* ผู้รับเงินบังคับเหมือนขั้นชำระเงิน — POST /api/payments ปฏิเสธแถวที่ไม่มีคนรับ
     จอนี้จึงต้องถามก่อน ไม่ใช่ปล่อยให้กดแล้วเด้ง error จากเซิร์ฟเวอร์ */
  const canSubmit = entered > 0 && !overpay && !!method && !!receivedBy && !saving;

  const sendSlip = async (file, paymentId) => {
    const form = new FormData();
    form.append('file', file);
    form.append('case_id', c.id);
    form.append('payment_id', paymentId);
    form.append('kind', SLIP_KIND);
    await api.upload('/api/uploads', form);
  };

  /* รับเงิน แล้วดึงข้อมูลใหม่จากเซิร์ฟเวอร์ — ไม่เดายอดเองฝั่งจอ ตัวเลขที่โชว์
     ต้องเป็นตัวที่เซิร์ฟเวอร์คิด ไม่ใช่ตัวที่เราหวังว่ามันจะเป็น */
  const receive = async (e) => {
    e.preventDefault();
    if (!entered) return err(new Error('กรุณาระบุจำนวนเงินที่รับ'));
    if (overpay) return err(new Error(amountError));
    if (!method) return err(new Error('กรุณาเลือกช่องทางการชำระเงิน'));
    if (!receivedBy) return err(new Error('กรุณาเลือกผู้รับเงิน'));
    setSaving(true);
    try {
      const payload = {
        case_id: c.id,
        order_id: o.id || null,
        kind: kindFor(paid, entered, balance),
        method,
        amount: entered,
        received_by: receivedBy,
        paid_at: toStamp(paidAt),
        notes: note.trim() || null,
        source: 'delivery',
      };
      /* API ตอบ "อาจซ้ำ" เมื่อยอดเท่ากันกับออเดอร์เดียวกันเพิ่งถูกบันทึกไม่กี่นาที —
         ถามคนกดก่อน ยืนยันแล้วค่อยส่งใหม่ (เส้นเดียวกับขั้นชำระเงิน กติกาเดียวกัน) */
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
      /* สลิปพังไม่ควรทำให้เงินที่รับมาแล้วหายไปด้วย — แจ้งแยก แล้วปล่อยให้แนบ
         ซ้ำจากประวัติได้ ดีกว่าลบรายการทิ้งแล้วให้พนักงานกรอกใหม่ทั้งใบ */
      let slipFailed = 0;
      for (const file of slips) {
        try { await sendSlip(file, saved.id); } catch { slipFailed += 1; }
      }
      setSlips([]);
      if (slipRef.current) slipRef.current.value = '';
      setAmount('');
      setNote('');
      if (slipFailed) {
        err(new Error(`บันทึกการรับเงินแล้ว แต่แนบสลิปไม่สำเร็จ ${slipFailed} ไฟล์ — แนบซ้ำได้จากประวัติด้านล่าง`));
      } else {
        ok(`รับชำระ ${money(entered)} แล้ว`);
      }
      reload();
      reloadFiles();
    } catch (ex) {
      /* ค่าที่กรอกไว้ยังอยู่ครบ กดใหม่ได้เลยโดยไม่ต้องกรอกซ้ำ */
      err(ex);
    } finally {
      setSaving(false);
    }
  };

  /* ---- ส่งมอบ ---------------------------------------------------------- */
  const [handedBy, setHandedBy] = useState('');
  const [grinderId, setGrinderId] = useState('');
  /* "ไม่มีคนเจีย" แทนการเลือกบัญชีผู้ดูแลระบบ (ร้านเคยเลือกบัญชีนี้เมื่องานไม่ได้เจีย) */
  const grinderOptions = [
    ['', '— เลือกคนเจีย —'],
    ['0', NO_GRINDER_LABEL],
    ...meta.employees
      .filter((e) => !NOT_GRINDERS.has(String(e.employee_name || '').trim()))
      .map((e) => [e.id, e.employee_name]),
  ];
  const [dNote, setDNote] = useState('');
  /* เวลาส่งมอบคือ "ตอนนี้" เสมอ — จอโชว์เฉย ๆ แก้ไม่ได้ ของจริงจะถูกประทับตอน
     กดยืนยัน เดินตามนาฬิกาไปเรื่อย ๆ จะได้ไม่โชว์เวลาหนึ่งแต่บันทึกอีกเวลาหนึ่ง
     เมื่อเปิดหน้าค้างไว้ทั้งเช้า */
  const [deliveredAt, setDeliveredAt] = useState(nowLocal());
  /* แอดมินเลือกวันเองแล้ว (ย้อนหลัง) — null = ใช้ "ตอนนี้" ตามเดิม */
  const [pickedAt, setPickedAt] = useState(null);
  useEffect(() => {
    if (delivered) return undefined;
    const t = setInterval(() => setDeliveredAt(nowLocal()), 15000);
    return () => clearInterval(t);
  }, [delivered]);

  const saveDelivery = async () => {
    setBusy(true);
    try {
      await api.post('/api/case-deliveries', {
        case_id: c.id,
        order_id: o.id || null,
        /* ประทับเวลาตอนกดจริง ไม่ใช่ตอนเปิดหน้า — เว้นแต่แอดมินเลือกวันย้อนหลังไว้ */
        delivered_at: toStamp(pickedAt && mayEditDate ? pickedAt : nowLocal()),
        handed_over_by: handedBy,
        employee_id: handedBy,
        /* '0' = ไม่มีคนเจีย — ส่งเป็นเลข 0 ไม่ใช่ว่าง */
        grinder_employee_id: grinderId === '' ? null : grinderId,
        received_by_customer_name: name,
        note: dNote.trim() || null,
      });
      ok('บันทึกการส่งมอบแล้ว');
      return true;
    } catch (ex) {
      err(ex);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const close = (value) => {
    setAsk(false);
    decide.current?.(value);
    decide.current = null;
  };

  const confirmDeliver = async () => {
    const saved = await saveDelivery();
    close(saved);
  };

  /* ProcessShell เรียกอันนี้ก่อนกดยืนยันขั้นตอน — คืน false = ไม่ต้องไปต่อ */
  const fns = useRef({});
  fns.current.beforeComplete = () => {
    if (delivered) return true;
    if (blocking.length) {
      err(new Error(`ยังส่งมอบไม่ได้ — ${blocking.join(', ')}`));
      return false;
    }
    /* ใครเป็นคนยื่นของให้ลูกค้าต้องมีชื่อ — เดาจากคนที่ล็อกอินอยู่ไม่ได้ เครื่องหน้าร้าน
       เปิดค้างด้วยบัญชีเดียวทั้งวันแต่คนส่งมอบเปลี่ยนไปตามกะ */
    if (!handedBy) {
      err(new Error('กรุณาเลือกผู้ส่งมอบ'));
      return false;
    }
    if (!grinderId) {
      err(new Error('กรุณาเลือกคนเจีย'));
      return false;
    }
    return new Promise((resolve) => { decide.current = resolve; setAsk(true); });
  };

  const register = actions?.register;
  useEffect(() => {
    if (!register) return undefined;
    register({ beforeComplete: () => fns.current.beforeComplete() });
    return () => register({});
  }, [register]);

  /* ประวัติการรับเงิน — ไม่โชว์ป้าย "ประเภท" เพราะหน้านี้ไม่ได้ถามและไม่ควรสอน
     คำว่า "จ่ายบางส่วน" ให้พนักงาน สิ่งที่ต้องอ่านออกคือ ได้เท่าไหร่ ทางไหน เมื่อไหร่ ใครรับ */
  const history = (
    <Card
      title="ประวัติการชำระเงิน"
      right={<span className="muted">{`${payments.length} รายการ`}</span>}
    >
      {payments.length === 0 ? (
        <p className="muted">ยังไม่มีประวัติการชำระเงิน</p>
      ) : (
        <ol className="pay-feed compact">
          {payments.map((p) => (
            <li className={`pay-ev ${p.cancelled_at ? 'cancelled' : ''}`} key={p.id}>
              <span className={`pay-ev-dot ${p.cancelled_at ? 'off' : ''}`}>
                <Icon name={isUnpaidRow(p) ? 'hourglass' : METHOD_ICON[p.method] || 'coins'} />
              </span>
              <div className="pay-ev-body">
                <div className="pay-ev-head">
                  {/* รายการ 0 บาทจากขั้นชำระเงิน — บอกว่าตกลงให้มาจ่ายตอนนี้ ไม่ใช่เงินที่รับไปแล้ว */}
                  {isUnpaidRow(p) ? (
                    <>
                      <Badge kind="warn">ยังไม่ชำระ</Badge>
                      <span className="muted">บันทึกไว้ที่ขั้นชำระเงิน</span>
                    </>
                  ) : (
                    <>
                      <b>{money(p.amount)}</b>
                      <span className="muted">{methodLabel[p.method] || p.method}</span>
                    </>
                  )}
                  {p.cancelled_at ? <Badge kind="danger">ยกเลิกแล้ว</Badge> : null}
                </div>
                <div className="pay-ev-when muted">
                  {fmtDateTime(p.paid_at)}
                  {p.received_by_name ? ` · ${isUnpaidRow(p) ? 'ผู้บันทึก' : 'ผู้รับเงิน'} ${p.received_by_name}` : ''}
                  {p.notes ? ` · ${p.notes}` : ''}
                </div>
                {slipsOf(p.id).length > 0 && (
                  <div className="pay-row-slips">
                    {slipsOf(p.id).map((f) => (
                      <a
                        key={f.id}
                        className="btn btn-sm btn-light"
                        href={api.url('/api/uploads/' + f.id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Icon name="receipt" /> ดูหลักฐาน
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );

  if (delivered) {
    return (
      <Stack>
        <Card title="ส่งมอบแล้ว" badge={<Badge kind="ok"><Icon name="check" /> เรียบร้อย</Badge>}>
          <Kv
            rows={[
              ['ส่งมอบเมื่อ', mayEditDate ? (
                <Row style={{ gap: 8 }}>
                  <span>{fmtDateTime(d.delivered_at)}</span>
                  <button type="button" className="btn btn-sm btn-light" onClick={() => setEditingDate(true)}>
                    <Icon name="pencil" /> เปิดการแก้ไข
                  </button>
                </Row>
              ) : fmtDateTime(d.delivered_at)],
              ['ผู้รับสินค้า', d.received_by_customer_name || '—'],
              ['ผู้ส่งมอบ', d.handed_over_by_name || empName(d.handed_over_by)],
              ...(d.grinder_employee_id != null
                ? [['คนเจีย', Number(d.grinder_employee_id) === 0
                  ? NO_GRINDER_LABEL
                  : d.grinder_name || empName(d.grinder_employee_id)]]
                : []),
              ...(d.note ? [['หมายเหตุ', d.note]] : []),
              /* ส่งมอบแล้วแต่ยังค้างเงินได้ — สองสถานะนี้แยกกัน ไม่ได้ปิดตามกัน */
              ['ยอดคงเหลือ', balance > 0
                ? <b className="dlv-due">{money(balance)}</b>
                : <Badge kind="ok"><Icon name="check" /> ชำระครบแล้ว</Badge>],
              ...(overpaid > 0 ? [['รับเกิน', <b className="dlv-due">{money(overpaid)}</b>]] : []),
            ]}
          />
        </Card>
        {history}
        {editingDate ? (
          <DeliveryDateDialog
            c={c}
            d={d}
            onClose={() => setEditingDate(false)}
            onSaved={() => { setEditingDate(false); reload?.(); }}
          />
        ) : null}
      </Stack>
    );
  }

  return (
    <>
      <Stack>
        {/* แถว 1 — ลูกค้าคือใคร กับ เงินเป็นยังไง */}
        <Split>
          <Card title="ข้อมูลลูกค้า">
            <div className="dlv-cust">
              <b>{name}</b>
              <a href={`tel:${c.phone || ''}`} className="dlv-phone">
                <Icon name="phone" /> {c.phone || '—'}
              </a>
              <span className="dlv-case mono">{c.case_code}</span>
            </div>
            <Kv
              rows={[
                ['วันนัดรับ', o.appointment_date ? fmtDate(o.appointment_date) : '—'],
                ...(o.notes ? [['หมายเหตุออเดอร์', o.notes]] : []),
              ]}
            />
          </Card>

          <Card
            title="สถานะการชำระเงิน"
            badge={balance > 0
              ? <Badge kind={paid > 0 ? 'warn' : 'gray'}>
                  <Icon name="warning" /> {paid > 0 ? 'ค้างชำระ' : 'ยังไม่ชำระ'}
                </Badge>
              : <Badge kind="ok"><Icon name="check" /> ชำระครบแล้ว</Badge>}
          >
            <div className="dlv-money">
              <div><span>ยอดสุทธิ</span><b>{money(net)}</b></div>
              <div><span>ชำระแล้ว</span><b className="ok">{money(paid)}</b></div>
              <div><span>คงเหลือ</span><b className={balance > 0 ? 'due' : 'ok'}>{money(balance)}</b></div>
            </div>
            {overpaid > 0 && (
              <p className="hint">{`รับเงินเกินยอด ${money(overpaid)} — ตรวจที่ขั้น “ชำระเงิน”`}</p>
            )}
            <div className="pay-bar-wrap">
              <div className="pay-bar"><span style={{ width: `${pct}%` }} /></div>
              <small>{net > 0 ? `ชำระแล้ว ${pct}% ของ ${money(net)}` : 'ยังไม่มียอดจากออเดอร์'}</small>
            </div>
            <p className="hint dlv-hint">
              สามารถส่งมอบสินค้าได้แม้ยังมียอดค้างชำระ — ยอดที่ค้างจะยังอยู่ในระบบตามเดิม
            </p>
          </Card>
        </Split>

        {/* แถว 2 — ของที่ต้องส่ง กับ เงินที่ต้องเก็บ */}
        <Split>
          <Card title="ข้อมูลออเดอร์">
            {o.id ? (
              <div className="dlv-items">
                <Item label="FRAME" name={frameName} sub={frameSub} />
                {lenses.map((l) => <Item key={l.label} label={l.label} name={l.name} sub={l.sub} />)}
              </div>
            ) : (
              <p className="muted">ยังไม่มีออเดอร์ในเคสนี้</p>
            )}
          </Card>

          {balance > 0 ? (
            /* หุบได้ — ลูกค้าที่ยังไม่จ่ายวันนี้ไม่ต้องให้ฟอร์มทั้งใบกินจอ แต่ยอดคงเหลือ
               ยังอ่านได้จากหัวการ์ดตอนหุบ · เปิดไว้เป็นค่าเริ่มต้นเพราะเคสที่เจอบ่อย
               ที่สุดคือมารับแว่นแล้วจ่ายเลย เปิดมาต้องกดรับเงินได้ทันทีไม่ต้องคลิกกาง */
            <CardFold
              defaultOpen
              title="รับชำระยอดคงเหลือ"
              right={<span className="dlv-due-tag">คงเหลือ <b>{money(balance)}</b></span>}
            >
              <form onSubmit={receive}>
                <div className="pay-amount">
                  <label htmlFor="dlv-amount">จำนวนเงินที่รับ</label>
                  <div className="pay-amount-input">
                    <span>฿</span>
                    <input
                      id="dlv-amount"
                      type="number"
                      step="1"
                      min="1"
                      max={balance}
                      required
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      aria-invalid={!!amountError}
                      aria-describedby="dlv-amount-help"
                    />
                  </div>
                  <div id="dlv-amount-help" className={`pay-after ${amountError ? 'over' : ''}`}>
                    {amountError || `ยอดคงเหลือปัจจุบัน ${money(balance)}`}
                  </div>
                </div>

                <div className="pay-choices">
                  <div>
                    <label id="dlv-method-label">ช่องทางการชำระเงิน</label>
                    <Row style={{ gap: 6 }} role="group" aria-labelledby="dlv-method-label">
                      {methods.map((v) => (
                        <button
                          type="button"
                          key={v}
                          className={`chip-btn ${method === v ? 'active' : ''}`}
                          aria-pressed={method === v}
                          onClick={() => setMethod(v)}
                        >
                          <Icon name={METHOD_ICON[v] || 'coins'} /> {methodLabel[v] || v}
                        </button>
                      ))}
                    </Row>
                  </div>
                </div>

                <FormGrid>
                  <Field label="ผู้รับเงิน *">
                    <EmployeeSelect
                      name="received_by"
                      value={receivedBy}
                      onChange={(e) => setReceivedBy(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="วันที่รับเงิน">
                    <DateTimeField value={paidAt} onChange={setPaidAt} />
                  </Field>
                </FormGrid>

                {/* แนบได้ทุกช่องทาง ไม่ใช่เฉพาะโอน — เงินสดก็มีหลักฐานได้ เช่น รูปใบเสร็จ
                    ที่เซ็นรับแล้ว การเดาแทนว่าช่องทางไหน "ไม่ต้องมี" คือการปิดประตูใส่
                    กรณีที่ร้านใช้จริง */}
                {(
                  <div className="slip-drop">
                    <div className="slip-drop-head">
                      <b><Icon name="receipt" /> สลิป / หลักฐานการชำระ</b>
                      <span className="muted">รูปหรือ PDF · แนบได้หลายไฟล์ · ไม่บังคับ</span>
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
                            {isPreviewable(f.type) && urlOfSlip(f)
                              ? (
                                <button
                                  type="button"
                                  className="slip-open"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSlipView(pendingSlipImages.findIndex((x) => x.file === f));
                                  }}
                                  aria-label={`ดูรูปใหญ่ ${f.name}`}
                                  title="กดเพื่อดูรูปใหญ่"
                                >
                                  <img src={urlOfSlip(f)} alt={f.name} />
                                </button>
                              )
                              : <span className="slip-file"><Icon name="file" /></span>}
                          </span>
                        ))}
                        {slipView !== null && pendingSlipImages.length > 0 ? (
                          <Lightbox
                            items={pendingSlipImages}
                            index={slipView}
                            onIndex={setSlipView}
                            onClose={() => setSlipView(null)}
                          />
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-sm btn-light"
                          onClick={() => { setSlips([]); if (slipRef.current) slipRef.current.value = ''; }}
                        >
                          ล้างไฟล์
                        </button>
                      </Row>
                    ) : (
                      <p className="muted" style={{ margin: '8px 0 0' }}>
                        ยังไม่ได้แนบไฟล์ — บันทึกได้โดยไม่มีสลิป
                      </p>
                    )}
                  </div>
                )}

                <Field label="หมายเหตุ" className="full">
                  <textarea
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="ไม่กรอกก็ได้"
                  />
                </Field>

                <div className="pay-actions">
                  <button className="btn btn-lg" type="submit" disabled={!canSubmit}>
                    <Icon name="check" />
                    {saving ? ' กำลังบันทึก...' : ` รับชำระ ${money(entered || 0)}`}
                  </button>
                </div>
              </form>
            </CardFold>
          ) : (
            <Card title="การชำระเงิน">
              <div className="dlv-paid-ok">
                <Icon name="check" />
                <div>
                  <b>ชำระครบแล้ว</b>
                  <span>ไม่มีจำนวนเงินค้างชำระ</span>
                </div>
              </div>
            </Card>
          )}
        </Split>

        {history}

        {/* บันทึกการส่งมอบ — ฟอร์มอยู่ที่นี่ แต่ปุ่มยืนยันยังเป็นปุ่มเดียวของ
            ProcessShell ด้านบน จะได้ไม่มีปุ่ม "ส่งมอบเสร็จ" สองอันบนจอเดียวกัน */}
        <Card title={<><Icon name="file" /> บันทึกการส่งมอบ</>}>
          <FormGrid>
            <Field label="ผู้ส่งมอบ *">
              <EmployeeSelect
                name="handed_over_by"
                value={handedBy}
                onChange={(e) => setHandedBy(e.target.value)}
                required
              />
            </Field>
            <Field label="วันที่ส่งมอบ">
              {mayEditDate ? (
                <div style={{ maxWidth: 380 }}>
                  <DateTimeField value={pickedAt ?? deliveredAt} onChange={setPickedAt} />
                  {pickedAt ? (
                    <button type="button" className="btn btn-sm btn-light" onClick={() => setPickedAt(null)}>
                      ใช้เวลาตอนนี้
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="dlv-stamp">{fmtDateTime(deliveredAt)}</div>
              )}
            </Field>
          </FormGrid>
          <FormGrid>
            <Field
              label={(
                <>
                  คนเจีย / ผู้ดำเนินการเจีย *{' '}
                  <span title="พนักงานที่เจียเลนส์ของงานนี้ — ต้องเลือกก่อนกดส่งมอบ">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true" style={{ verticalAlign: '-2px' }}><path fillRule="evenodd" d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19zM10.9 7h2.2v2.2h-2.2zm0 4h2.2v6h-2.2z" /></svg>
                  </span>
                </>
              )}
            >
              <Select
                name="grinder_employee_id"
                options={grinderOptions}
                value={grinderId}
                onChange={(e) => setGrinderId(e.target.value)}
                required
              />
            </Field>
          </FormGrid>
          <Field label="หมายเหตุ" className="full">
            <textarea
              rows={2}
              value={dNote}
              onChange={(e) => setDNote(e.target.value)}
              placeholder="ไม่กรอกก็ได้"
            />
          </Field>
          <p className="hint">
            กรอกไว้ก่อนได้ — จะถูกบันทึกตอนกดปุ่ม “ส่งมอบเสร็จ — ปิดเคส” ด้านบน
          </p>
        </Card>
      </Stack>

      {ask && (
        <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) close(false); }}>
          <div className="modal">
            <h3>{balance > 0 ? 'ลูกค้ายังมียอดค้างชำระ' : 'ยืนยันการส่งมอบ'}</h3>
            <div className="m-body">
              <Kv
                rows={[
                  ['ลูกค้า', <><b>{name}</b>{c.phone ? <div className="muted">{c.phone}</div> : null}</>],
                  ['Case', <span className="mono">{c.case_code}</span>],
                  ['Frame', frameName || '—'],
                  ['Lens', lenses.map((l) => l.name).filter(Boolean).join(' / ') || '—'],
                ]}
              />
              {balance > 0 ? (
                <div className="dlv-warn">
                  <Icon name="warning" />
                  <div>
                    <b>{`ยอดคงเหลือ ${money(balance)}`}</b>
                    <span>ส่งมอบสินค้าได้ แต่ยอดค้างชำระจะยังคงอยู่ในระบบ</span>
                  </div>
                </div>
              ) : (
                <p className="dlv-confirm-msg">ลูกค้าชำระเงินครบแล้ว — ยืนยันว่าได้ส่งมอบแว่นให้ลูกค้าเรียบร้อย</p>
              )}
            </div>
            <div className="m-foot">
              <button type="button" className="btn btn-light" onClick={() => close(false)} disabled={busy}>
                {balance > 0 ? 'กลับไปรับชำระเงิน' : 'ยกเลิก'}
              </button>
              {/* ค้างเงินอยู่ยังกดได้ แต่ไม่ใช้สีปุ่มหลัก — ให้เป็นการตัดสินใจ ไม่ใช่ทางที่ไหลไปเอง */}
              <button
                type="button"
                className={`btn ${balance > 0 ? 'btn-warn' : ''}`}
                onClick={confirmDeliver}
                disabled={busy}
              >
                <Icon name="box" />
                {busy ? ' กำลังบันทึก...' : balance > 0 ? ' ยืนยันส่งมอบทั้งที่ยังค้างชำระ' : ' ยืนยันส่งมอบ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
