'use client';
/**
 * Shared order (custom_orders) create/edit form. Restructured the same way
 * app/customers/CustomerFormView.jsx was: `editing` is an explicit prop, not
 * derived from a route param, outgoing write URLs use the query-string `id`
 * rather than an id read back out of the loaded response body, and the same
 * loading/error/not-found guards run before anything else.
 *
 * Unlike CustomerFormView this form also owns a few pieces of state that
 * can't live in plain uncontrolled inputs: the picked customer/case context
 * (read-only once a case is known, pickable via <Picker> for a standalone
 * order), which prescription becomes final_prescription_id, the three
 * <StockPicker> selections (frame / lens R / lens L), and the four price
 * fields, which are kept live so the Total / Net Total mirror what the server
 * (Task 2's orderVals()) will compute and validate. The stored discount rides
 * along in the same live state even though nothing here can edit it any more.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../lib/apiClient.js';
import { useAsync, onSubmit } from '../../../lib/hooks.js';
import { useToast } from '../../../components/Toast.jsx';
import {
  Badge, Card, Field, Fieldset, FormActions, FormGrid, Kpi, Kpis, Kv, Loading, PageHead, Row, Split,
} from '../../../components/ui.jsx';
import { Picker } from '../../../components/Picker.jsx';
import { StockPicker, stockLabel } from '../../../components/StockPicker.jsx';
import { CatalogLensPicker } from '../../../components/CatalogLensPicker.jsx';
import { LENS_SOURCE, requisitionItems, savedLens } from '../../../lib/lens/lensSource.js';
import { RxSets } from '../../../components/RxSets.jsx';
import { RxArrival } from '../../../components/RxLensBadge.jsx';
import { EyewearHistory } from '../../../components/EyewearHistory.jsx';
import { ListSelect } from '../../../components/Selects.jsx';
import { StepEmployeeSelect } from '../../../components/StepEmployeeSelect.jsx';
import { StockEmbedModal } from '../../../components/StockEmbedModal.jsx';
import { RX_KIND_LABEL } from '../../../lib/constants.js';
import {
  custName, cylPower, fmtDateTime, money, rxNum, sphPower,
} from '../../../lib/format.js';
import { Icon } from '../../../components/Icon.jsx';
import { pairDisplay, pairPrice, splitPairPrice } from '../../../lib/pricing.js';
import { COLOR_MATCH, TINT_COLORS, TINT_LEVELS, dyeColorOf, dyeLevelOf, lensTintForSave } from '../../../lib/lensTint.js';
import s from './OrderFormView.module.css';

/* รูปเหล่านี้ไม่อยู่ใน lib/icons.js — ไฟล์นั้นอยู่ใน chunk กลางที่แท็บเก่าโหลดค้างไว้ ไอคอนใหม่จะขึ้นเป็นชื่อแทนรูป */
const PaletteGlyph = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M12 2.5a9.5 9.5 0 0 0 0 19h1.2a2.1 2.1 0 0 0 1.6-3.5 1.4 1.4 0 0 1 1-2.4h1.9a4.8 4.8 0 0 0 4.8-4.8C22.5 6 17.8 2.5 12 2.5zM7 13.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4zm2.6-4.6a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4zm4.8 0a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4zm3.2 3.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4z" />
  </svg>
);
/* ไอคอนรูปภาพบนการ์ดสีตามตัวอย่าง */
const ImageGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.8" />
    <path d="M21 16l-5-5-9 9" />
  </svg>
);
const InfoGlyph = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19zM10.9 7h2.2v2.2h-2.2zm0 4h2.2v6h-2.2z" />
  </svg>
);

const n = (v) => Number(v || 0);

/** บรรทัดรองของการ์ดเลนส์สั่งตัด — รูปเดียวกับบรรทัดรองของเลนส์ที่เลือกจากสต็อก */
const rxSub = (rx) => ['สั่งตัด RX', rx.sku ? 'SKU ' + rx.sku : null].filter(Boolean).join(' · ');

/** compact display line for a picked stock item, with a way to clear it */
/**
 * What an item from stock IS, is decided in the stock record, not here: the
 * details of a picked item are shown to read, never to type over. Nothing is
 * picked — a customer's own frame — is the one case where someone has to fill
 * them in, and then the fields are the form.
 */
/**
 * ราคาขายของชิ้นนี้ในออเดอร์นี้ — อยู่นอก ItemDetails เสมอ
 *
 * ItemDetails พับรายละเอียดสินค้าเก็บไว้หลังปุ่ม "ดูรายละเอียด" ซึ่งถูกสำหรับ ยี่ห้อ/รุ่น/สี
 * ที่อ่านทีเดียวก็พอ แต่ราคาขายคือสิ่งที่คนขายต้องแตะทุกใบ ซ่อนไว้แปลว่าต้องกดเปิดก่อน
 * ทุกครั้ง หรือแย่กว่านั้นคือไม่รู้ว่ามีให้แก้แล้วปล่อยราคาตั้งต้นไป
 */
function SellingPrice({ label, value, onChange, hint, variant }) {
  return (
    <div className={variant ? `sell-price ${variant}` : 'sell-price'}>
      <label>{label}</label>
      {/* step any ไม่ใช่ 1 — ราคารายข้างที่มาจากการแบ่งราคาคู่เลขคี่ได้ .50 (4,001 → 2,000.50)
          step="1" ทำให้เบราว์เซอร์ถือว่าค่านั้นผิด แล้วไม่ยอมให้กดบันทึกออเดอร์เลย */}
      <input type="number" step="any" min="0" value={value} onChange={onChange} />
      {/* hint="" คือสั่งว่าไม่ต้องมีบรรทัดอธิบาย — ช่องที่อธิบายตัวเองได้อยู่แล้ว
          ไม่ต้องเสียพื้นที่ให้ตัวหนังสือเทาอีกบรรทัด */}
      {hint === '' ? null : <small>{hint ?? 'ราคาของออเดอร์นี้ ไม่กระทบราคาสินค้าในคลัง'}</small>}
    </div>
  );
}

/**
 * ราคาขายเลนส์ทั้งคู่ — ช่องที่คนขายหน้าร้านใช้จริง
 *
 * ลูกค้าถามราคาเป็น "คู่" ไม่มีใครถามราคาเลนส์ข้างเดียว ช่องนี้จึงอยู่บนสุดของ
 * การ์ดเลนส์และตัวโตกว่าช่องรายข้าง · แต่ตัวเลขที่บันทึกยังเป็น lens_od_price /
 * lens_os_price เหมือนเดิมทุกอย่าง ช่องนี้ไม่ได้ถูกเก็บลงฐาน: ค่าที่โชว์คือผลบวก
 * ของสองข้างเสมอ กรอกลงไปเมื่อไหร่ก็แค่สั่งแบ่งครึ่งลงสองข้างให้ครั้งหนึ่ง
 * หลังจากนั้นยังลงไปแก้รายข้างทับได้ตามปกติ แล้วยอดคู่ตรงนี้จะขยับตามเอง
 *
 * ── ช่องนี้จำข้อความที่กำลังพิมพ์เอง ────────────────────────────────────────
 * ค่าที่โชว์คำนวณจากสองข้างใหม่ทุกครั้งที่วาด · เดิมผูก value ไว้กับตัวเลขนั้นตรง ๆ
 * ผลคือลบจนว่างไม่ได้: ค่าว่างถูกแบ่งเป็น 0/0 แล้ววาดกลับมาเป็น "0" ทันที ต้องพิมพ์
 * ต่อจากเลข 0 ที่ค้างอยู่ และทศนิยมกลางทางอย่าง "15." ก็โดนทับ · ตอนนี้ระหว่างพิมพ์
 * ช่องแสดงสิ่งที่พิมพ์จริง (ยังแบ่งลงสองข้างทุกตัวอักษรเหมือนเดิม) ออกจากช่องแล้วค่อย
 * กลับไปแสดงผลบวกของสองข้าง · ราคา 0 เป็นช่องว่าง ให้ placeholder บอกแทน
 *
 * export ไว้ให้ทดสอบคอมโพเนนต์ตัวจริงได้โดยไม่ต้องล็อกอินเข้าหน้าออเดอร์
 */
export function PairSellingPrice({ od, os, onSplit, dyed = false }) {
  const pair = pairPrice(od, os);
  const uneven = n(od) !== n(os);
  /* null = ไม่ได้พิมพ์อยู่ แสดงผลบวกของสองข้าง · ข้อความ = กำลังพิมพ์ แสดงตามที่พิมพ์ */
  const [draft, setDraft] = useState(null);
  return (
    <div className="pair-bar">
      <div className="pair-bar-main">
        <div className="pair-bar-text">
          <label htmlFor="pair-price">ราคาขายเลนส์คู่ / Selling Price (Pair)</label>
          <small>
            {dyed ? 'ราคาเลนส์ทั้งคู่ (R+L) รวมค่าย้อมสีแล้ว' : 'ราคาเลนส์ทั้งคู่ (R+L)'}
            {' — กรอกที่นี่ ระบบแบ่งลงสองข้างข้างละครึ่งให้เอง'}
          </small>
        </div>
        <input
          id="pair-price"
          type="number"
          inputMode="decimal"
          /* any ไม่ใช่ 1 — ราคาคู่ที่แบ่งลงสองข้างได้ .50 หรือกรอกทศนิยมเองเป็นเรื่องปกติ
             step="1" ทำให้เบราว์เซอร์ถือว่าค่าพวกนั้นผิด แล้วไม่ยอมส่งฟอร์ม */
          step="any"
          min="0"
          placeholder="0"
          value={draft ?? pairDisplay(pair)}
          onFocus={() => setDraft(pairDisplay(pair))}
          onChange={(e) => {
            setDraft(e.target.value);
            onSplit(splitPairPrice(e.target.value));
          }}
          onBlur={() => setDraft(null)}
        />
      </div>
      {/* สองข้างไม่เท่ากันไม่ใช่ความผิดพลาด — เลนส์คนละรุ่นซ้ายขวาก็ราคาต่างกันได้
          แต่ต้องบอกให้รู้ ไม่งั้นยอดคู่ข้างบนจะดูเหมือนหารครึ่งมาแล้วทั้งที่ไม่ใช่
          ปุ่มข้าง ๆ คือทางกลับ สำหรับคนที่แก้รายข้างไปแล้วอยากได้เท่ากันเหมือนเดิม */}
      {uneven ? (
        <div className="pair-bar-split">
          <span>ราคาสองข้างไม่เท่ากัน — R {money(od)} + L {money(os)}</span>
          <button
            type="button"
            className="btn btn-sm btn-light"
            onClick={() => onSplit(splitPairPrice(pair))}
          >
            <Icon name="circleHalf" /> หารครึ่งให้เท่ากัน
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ItemDetails({ picked, rows, children }) {
  const [open, setOpen] = useState(false);
  /* กรอบไม่มีช่องกรอกเองแล้ว ไม่มี children ก็ไม่ต้องเว้นที่ไว้เปล่า ๆ */
  if (!picked) return children ? <div style={{ marginTop: 10 }}>{children}</div> : null;
  return (
    <div style={{ marginTop: 10 }}>
      <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'x' : 'search'} /> {open ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'}
      </button>
      {open ? <div style={{ marginTop: 10 }}><Kv rows={rows} /></div> : null}
    </div>
  );
}

// editing must always be passed explicitly by the caller (true or false) — if a future
// page forgets it, editing becomes undefined (falsy), silently serving a *create* form
// on what was meant to be an *edit* route.
//
// caseId/customerId/orderId are optional overrides for the query-string-derived
// `case`/`customer`/`id` values, used when this form is embedded somewhere that has
// no query string of its own (e.g. a case-detail tab) rather than routed to directly.
// When omitted, behavior is identical to before: values come from useSearchParams().
// `embedded` (default false) drops the standalone <PageHead> and the "ยกเลิก" nav
// link, since an embedding page already has its own header/chrome. `onSaved`, when
// given, is called with the saved order after a successful write — the standalone
// pages don't pass it and keep navigating away exactly as before; an embedded caller
// (e.g. SalesPanel) uses it to reload() its own data instead of navigating away.
export function OrderFormView({
  editing, caseId: caseIdProp, customerId: customerIdProp, orderId, embedded = false, onSaved,
  locked = false, onUnlock,
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { ok, err } = useToast();

  const id = editing ? (orderId ?? params.get('id')) : null;
  const queryCustomer = customerIdProp != null ? String(customerIdProp) : params.get('customer');
  const queryCase = caseIdProp != null ? String(caseIdProp) : params.get('case');

  const { data, loading, error } = useAsync(() => {
    if (editing && !id) return Promise.resolve(null);
    return (async () => {
      const o = editing ? await api.get('/api/orders/' + id) : {};
      if (editing && !o?.id) return { o };

      let caseId = editing ? (o.case_id ?? null) : (queryCase ? Number(queryCase) : null);
      let customerId = editing ? (o.customer_id ?? null) : (queryCustomer ? Number(queryCustomer) : null);
      let customer = null;
      if (caseId) {
        customer = await api.get('/api/cases/' + caseId);
        if (!customerId) customerId = customer.customer_id ?? null;
      } else if (customerId) {
        customer = await api.get('/api/customers/' + customerId);
      }
      return {
        o, caseId, customerId, customer,
      };
    })();
  }, [editing, id, queryCase, queryCustomer]);

  /* selections the form owns beyond plain uncontrolled inputs */
  const [customerOverride, setCustomerOverride] = useState(null);
  const [rxIdState, setRxId] = useState(undefined);
  const [items, setItems] = useState(undefined);
  const [prices, setPrices] = useState(undefined);
  /* ติ๊ก "กรอบเดิมของลูกค้า" — undefined = ยังไม่มีใครกด อ่านจากออเดอร์ที่บันทึกไว้แทน
     (ดู usesOldFrame ใต้ตัวแปร o · ตั้งจากออเดอร์ตรงนี้ไม่ได้เพราะ o ยังไม่มีค่า)
     กดแล้วเป็น true/false ของคนกดตลอด ไม่ผูกกับ `items` */
  const [oldFrame, setOldFrame] = useState(undefined);
  /* ย้อมสีเลนส์ — undefined = ยังไม่มีใครกด อ่านจากออเดอร์ที่บันทึกไว้แทน */
  const [dyeOn, setDyeOn] = useState(undefined);
  const [dyePick, setDyePick] = useState(undefined);
  /** ข้างที่กำลังเปิดใบสั่งตัดอยู่ ('r' | 'l') หรือ null เมื่อไม่ได้เปิด */
  const [rxFor, setRxFor] = useState(null);
  /** ใบสั่งตัดที่เพิ่งเปิดในหน้านี้ แยกตามข้าง — ไม่มีล็อตให้ผูก จึงเก็บเอง */
  const [rxLens, setRxLens] = useState({});
  /** ข้างที่กำลังถามยืนยันยกเลิกใบสั่งตัด ('r' | 'l') — ถามในการ์ดเลย ไม่เปิดกล่องซ้อน */
  const [asking, setAsking] = useState(null);
  /** ข้างที่กำลังยกเลิกใบสั่งตัดอยู่ กันกดซ้ำระหว่างรอ API */
  const [dropping, setDropping] = useState(null);

  /* บันทึกออเดอร์เองทันทีหลังเปิดหรือล้างใบสั่งตัด RX (ร้านขอ 3 พ.ย. 2026) — เดิมต้องกด
     "บันทึกการแก้ไข" ก่อน ใบสั่งจึงผูกกับออเดอร์ · CASE-2026-00408: เปิด RX แล้วกด "จบขั้นตอน"
     ทันที ออเดอร์ไม่ถูกบันทึก ใบ RX ลอย และเลนส์สต็อกเดิมโดนตัดซ้ำ · ส่งทั้งฟอร์มผ่าน
     requestSubmit หลัง render ที่ rxLens เปลี่ยนแล้ว ให้ save() อ่านค่าใหม่ · เฉพาะออเดอร์ที่มีอยู่แล้ว
     ออเดอร์ใหม่ยังต้องกด "เปิดออเดอร์" เอง ไม่สร้างออเดอร์ครึ่ง ๆ กลาง ๆ ให้ */
  const formRef = useRef(null);
  const [autoSave, setAutoSave] = useState(0);
  useEffect(() => {
    if (autoSave && editing) formRef.current?.requestSubmit();
  }, [autoSave, editing]);

  /* ประวัติแว่นเดิม — ยิงแยกจากตัวออเดอร์เพราะลูกค้าเปลี่ยนได้ทีหลัง เมื่อคนขายเลือก
     จาก Picker ในโหมดออเดอร์ลอย (ไม่มีเคส) ต้องโหลดประวัติของคนใหม่ตามไปด้วย
     exclude_case กันไม่ให้เคสที่กำลังเปิดอยู่โผล่มาเป็น "ของเดิม" ของตัวเอง */
  const histCustomerId = customerOverride?.id ?? data?.customerId ?? null;
  const histCaseId = data?.caseId ?? null;
  const { data: history, loading: historyLoading } = useAsync(
    () => (histCustomerId
      ? api.get(`/api/customers/${histCustomerId}/eyewear-history`,
        histCaseId ? { exclude_case: histCaseId } : undefined)
      : Promise.resolve([])),
    [histCustomerId, histCaseId],
  );

  if (loading) return <Loading />;
  if (error) return <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>;
  if (editing && !id) {
    return <Card><h2>ไม่พบรหัสออเดอร์</h2><p className="muted">ไม่มี id ของออเดอร์ที่จะแก้ไข</p></Card>;
  }
  if (editing && (!data || !data.o || !data.o.id)) {
    return <Card><h2>ไม่พบข้อมูลออเดอร์</h2><p className="muted">ไม่พบออเดอร์รายนี้ในระบบ</p></Card>;
  }

  const o = editing ? data.o : {};
  const caseId = data.caseId ?? null;
  const contextCustomer = customerOverride ?? data.customer;
  // contextCustomer may be a *case* object (when context came from ?case=/o.case_id) —
  // its own `.id` is the case's id, not the customer's, so customerId must never be
  // read from contextCustomer.id. customerOverride (from the standalone Picker) is
  // always a real customer object, and data.customerId is already resolved correctly
  // by the loader (including the case.customer_id fallback).
  const customerId = customerOverride?.id ?? data.customerId ?? null;
  const rxList = contextCustomer?.prescriptions || [];

  /* With a case in hand there is nothing to choose: the case's own round holds
     ค่าเดิม / ค่าที่วัด / ค่าที่ใช้จริง, and an order is always built from the
     ค่าที่ใช้จริง — showing a list of rows to pick from invited picking the wrong
     one. Without a case (a bare order for a walk-in) the list stays. */
  const caseRx = caseId
    ? rxList.filter((r) => Number(r.case_id) === Number(caseId))
    : [];
  const caseSets = {
    old: caseRx.find((r) => r.kind === 'old') || null,
    measured: caseRx.find((r) => r.kind === 'measured') || null,
    final: caseRx.find((r) => r.kind === 'final') || null,
  };

  const defaultRxId = editing
    ? (o.final_prescription_id ?? null)
    : (caseId
      ? (caseSets.final?.id ?? caseSets.measured?.id ?? null)
      : (rxList[0]?.id ?? null));
  const rxId = rxIdState === undefined ? defaultRxId : rxIdState;

  const picked = items ?? {
    frame: o.frame || null,
    lensOd: savedLens(o.left_lens, o.lens_catalog_r),
    lensOs: savedLens(o.right_lens, o.lens_catalog_l),
  };

  /* ออเดอร์เก่าที่มีชื่อกรอบแต่ไม่ได้ผูกกับของในคลัง คือกรอบเดิมของลูกค้า —
     ติ๊กให้เองตอนเปิดมาแก้ ไม่งั้นกดบันทึกซ้ำแล้วชื่อกรอบจะหาย
     เดิมอ่านจากออเดอร์ "ตอนที่ items ยังไม่ถูกแตะ" ซึ่งผิดสองทาง (ร้านเจอ 15 ก.ย. 2026):
     เอาติ๊กออกไม่ได้เพราะการเอาออกไม่แตะ items ค่าจึงเด้งกลับเป็นของออเดอร์ และกดล้างเลนส์
     แล้วติ๊กหายเองทั้งที่ไม่มีใครกด · ตอนนี้อ่านจากออเดอร์จนกว่าจะมีคนกดติ๊กเท่านั้น
     (e2e/order-old-frame.spec.js) */
  const oldFrameFromOrder = Boolean(o.frame_name) && !o.frame_product_id && !o.frame;
  const usesOldFrame = oldFrame === undefined ? oldFrameFromOrder : oldFrame;
  const savedDye = dyeColorOf(o.lens_tint);
  const dyed = dyeOn === undefined ? Boolean(savedDye) : dyeOn;
  const dyeColor = dyePick ? dyePick.color : savedDye;
  const dyeLevel = dyePick ? dyePick.level : dyeLevelOf(o.lens_tint);
  /* Picking a stock item is a statement of fact about the order: it fills in
     that item's own details and its price, instead of leaving staff to retype
     what the system already knows. The fields stay editable afterwards. */
  const setPicked = (patch) => {
    setItems({ ...picked, ...patch });
    const [slot, item] = Object.entries(patch)[0] || [];
    if (!item) return;
    const priceField = { frame: 'frame_price', lensOd: 'lens_od_price', lensOs: 'lens_os_price' }[slot];
    if (priceField) setP({ [priceField]: Number(item.product_price) || 0 });
  };

  const p = prices ?? {
    frame_price: o.frame_price ?? 0,
    lens_od_price: o.lens_od_price ?? 0,
    lens_os_price: o.lens_os_price ?? 0,
    options_price: o.options_price ?? 0,
    discount: o.discount ?? 0,
    deposit: o.deposit ?? 0,
  };
  const setP = (patch) => setPrices({ ...p, ...patch });


  const total = n(p.frame_price) + n(p.lens_od_price) + n(p.lens_os_price) + n(p.options_price);
  const netTotal = total - n(p.discount);
  /* ตั้งส่วนลดที่นี่ไม่ได้แล้ว เหลือไว้เตือนอย่างเดียวว่าค่าเดิมกินเกินราคารวม
     ห้ามใช้บล็อกการบันทึก ไม่งั้นออเดอร์นั้นจะแก้อะไรไม่ได้เลย */
  const discountTooHigh = n(p.discount) > total;

  /* ใบสั่งตัด RX ของแต่ละข้าง — ที่เพิ่งเปิดในหน้านี้ชนะของที่บันทึกไว้ในออเดอร์
     `rxLens[side]` เป็น null แปลว่ากดล้างไปแล้ว ไม่ใช่ยังไม่มีใครแตะ */
  const rxOf = (side) => {
    if (rxLens[side] !== undefined) return rxLens[side];
    const logId = Number(o[`lens_${side}_rx_id`]) || null;
    return logId
      ? {
        id: logId,
        referenceDoc: o[`lens_${side}_rx_doc`] || '',
        name: o[`lens_${side}_name`] || '',
        sku: o[`lens_${side}_sku`] || '',
        /* คลังติ๊กว่าเลนส์มาถึงเมื่อไร (orderDetail) — ใบที่เพิ่งเปิดในหน้านี้ยังไม่มีทางมาถึง */
        arrivedAt: o[`lens_${side}_rx_arrived_at`] || null,
        /* คลังกดว่าเลนส์เจียร์เสีย (orderDetail) — ใบนี้เสียและยังไม่มีใบแทน / ใบก่อนหน้าที่เสีย */
        scrappedAt: o[`lens_${side}_rx_scrapped_at`] || null,
        scraps: o[`lens_${side}_rx_scraps`] || [],
      }
      : null;
  };

  /* "ล้าง" บนการ์ดสั่งตัด = ยกเลิกใบสั่งตัวจริงในคลังด้วย ไม่ใช่แค่เอาชื่อออกจากฟอร์ม
     ใบที่ยังไม่มีตัวเลขเงินถูกลบทิ้ง ใบที่ลงราคา/ต้นทุนแล้วถูกยกเลิกพร้อมเหตุผล (ดู
     Rx::remove ฝั่งคลัง) · ใบที่ถูกลบหรือยกเลิกไปก่อนแล้วที่หน้าคลัง แค่เอาออกจากฟอร์ม */
  const dropRx = async (side, rx) => {
    setAsking(null);
    setDropping(side);
    try {
      await api.post(`/stock-api/rx/${rx.id}/delete`, { note: 'ล้างเลนส์ออกจากออเดอร์ที่หน้าเคส' });
      ok(editing
        ? `ยกเลิกใบสั่ง ${rx.referenceDoc} แล้ว`
        : `ยกเลิกใบสั่ง ${rx.referenceDoc} แล้ว — กดเปิดออเดอร์เพื่อเก็บการเปลี่ยนแปลง`);
    } catch (ex) {
      if (ex.status !== 404 && ex.reason !== 'already_cancelled') {
        err(ex);
        setDropping(null);
        return;
      }
    }
    setDropping(null);
    setRxLens((m) => ({ ...m, [side]: null }));
    setAutoSave((n) => n + 1);
  };

  const chooseCustomer = async (r) => {
    try {
      const full = await api.get('/api/customers/' + r.id);
      setCustomerOverride(full);
      setRxId(full.prescriptions?.[0]?.id ?? null);
    } catch (ex) {
      err(ex);
    }
  };

  const save = async (body) => {
    if (!customerId) return err('กรุณาเลือกลูกค้าก่อน');
    if (dyed && !dyeColor) return err(new Error('กรุณาเลือกสีและระดับความเข้มที่จะย้อม'));
    /* บังคับตั้งแต่ 11 พ.ย. 2026 (ร้านขอ) — ค่าคอมงานเจียใน HRMS คิดจากประเภทกรอบ */
    if (!String(body.frame_type ?? '').trim()) return err(new Error('กรุณาเลือกประเภทกรอบ'));
    body.customer_id = customerId;
    body.case_id = caseId;
    body.final_prescription_id = rxId;
    /* กรอบเดิมของลูกค้า = ไม่มีของออกจากคลัง ชื่อกรอบยังถูกบันทึกตามที่พิมพ์
       และเดินไปกับใบสั่งเหมือนกรอบที่ขายจริง */
    /* กรอบจากคลังของอีกสาขา (แพไม้ ← บ่อนไก่) — id เป็นล็อตของระบบนั้น ไม่เก็บ ตัดด้วย SKU */
    const remoteFrame = !usesOldFrame && Boolean(picked.frame?.remote);
    body.frame_remote = remoteFrame ? 1 : null;
    body.frame_product_id = usesOldFrame || remoteFrame ? null : (picked.frame?.id ?? null);
    body.lens_product_id = picked.lensOd?.id ?? null;
    body.right_lens_product_id = picked.lensOs?.id ?? null;

    /* The detail fields are collapsed while an item is picked, so they may not
       be in the form at all — the order still has to carry what was chosen. */
    const fill = (field, value) => {
      if (!body[field] && value) body[field] = value;
    };
    if (usesOldFrame) {
      /* คำเดียวกันทุกใบ ไม่ให้พิมพ์เอง — กรอบของลูกค้าไม่ใช่สินค้าของร้าน
         ถ้าปล่อยให้พิมพ์ จะได้สิบคำในสิบใบแล้วนับทีหลังไม่ได้ว่ากี่ใบใช้กรอบเดิม */
      body.frame_name = 'oldframe';
    } else if (picked.frame) {
      fill('frame_name', stockLabel(picked.frame));
      fill('frame_brand', picked.frame.brand);
      fill('frame_model', picked.frame.model);
      fill('frame_color', picked.frame.color);
      fill('frame_size', picked.frame.size);
      fill('frame_sku', picked.frame.sku);
    } else if (editing) {
      /* ไม่มีช่องกรอกกรอบเองในฟอร์มแล้ว ออเดอร์เก่าที่พิมพ์ชื่อกรอบไว้เองจึงไม่มีอะไร
         ส่งค่ามา — ต้องส่งของเดิมกลับไป ไม่งั้น PUT เขียนทับจนชื่อกรอบหายทั้งระบบ */
      fill('frame_name', o.frame_name);
      fill('frame_brand', o.frame_brand);
      fill('frame_model', o.frame_model);
      fill('frame_color', o.frame_color);
      fill('frame_size', o.frame_size);
      fill('frame_sku', o.frame_sku);
    }
    /* ชื่อกับ SKU แยกข้าง — ออเดอร์ที่สองตาคนละรุ่นเคยเก็บได้แค่ชื่อเดียว
       ช่องในฟอร์มชนะเสมอ (คนขายพิมพ์ทับได้) ถ้าไม่มีค่อยเอาชื่อของชิ้นที่เลือก */
    fill('lens_r_name', picked.lensOd ? stockLabel(picked.lensOd) : '');
    fill('lens_r_sku', picked.lensOd?.sku);
    fill('lens_l_name', picked.lensOs ? stockLabel(picked.lensOs) : '');
    fill('lens_l_sku', picked.lensOs?.sku);

    /* ใบสั่งตัด RX ผูกไว้กับออเดอร์ — เปิดกลับมาจะได้การ์ดเดิม และปุ่มล้างรู้ว่าต้อง
       ยกเลิกใบไหน · ช่องชื่อกับ SKU ถูกซ่อนตอนมีการ์ด จึงเติมจากใบสั่งให้เอง */
    for (const side of ['r', 'l']) {
      const rx = rxOf(side);
      body[`lens_${side}_rx_id`] = rx?.id ?? null;
      body[`lens_${side}_rx_doc`] = rx?.referenceDoc || null;
      if (rx) {
        fill(`lens_${side}_name`, rx.name);
        fill(`lens_${side}_sku`, rx.sku);
      }
    }

    /* lens_* ชุดเดิม (ชื่อรวม ยี่ห้อ index coating) ยังเขียนอยู่เพื่อไม่ให้หน้าอื่น
       ที่อ่านฟิลด์เหล่านี้พังไป — ยึดข้างขวาเป็นตัวแทนเมื่อมีทั้งสองข้าง */
    const lens = picked.lensOd || picked.lensOs;
    if (lens) {
      body.lens_name = stockLabel(lens);
      body.lens_brand = lens.brand || '';
      body.lens_design = lens.lens_design || '';
      body.lens_index = lens.lens_index || '';
      body.lens_coating = lens.coating || '';
      body.lens_tint = lens.tint || '';
      body.lens_addons = o.lens_addons || '';
    } else if (editing) {
      body.lens_name = o.lens_name || '';
      body.lens_brand = o.lens_brand || '';
      body.lens_design = o.lens_design || '';
      body.lens_index = o.lens_index || '';
      body.lens_coating = o.lens_coating || '';
      body.lens_tint = o.lens_tint || '';
      body.lens_addons = o.lens_addons || '';
    }

    body.lens_tint = lensTintForSave(dyed ? dyeColor : '', dyeLevel, body.lens_tint);

    try {
      const saved = editing
        ? await api.put('/api/orders/' + id, body)
        : await api.post('/api/orders', body);
      const oid = editing ? id : saved.id;
      /* Bewell: เลนส์จากรายการเลนส์ที่เลือกในรอบนี้ → ใบเบิกเลนส์ (ร่าง จนกว่าจะยืนยันขั้นขาย
         จึงนับเป็น "ใช้เลนส์") · `items` มีค่าเฉพาะตอนมีคนแตะตัวเลือกในรอบนี้ เปิดออเดอร์เก่า
         มาแก้เรื่องอื่นจึงไม่ล้างใบเบิกเดิม · เรียกพลาดไม่ทำให้ออเดอร์พัง */
      const lensItems = LENS_SOURCE === 'catalog' ? requisitionItems(items, p) : [];
      /* แตะตัวเลือกแล้วไม่เหลือเลนส์จากรายการสักข้าง (กด "ล้าง") ก็ต้องส่งไปด้วย — ส่ง [] =
         ยกเลิกใบเดิม ไม่งั้นประวัติเลนส์ยังนับว่าใช้เลนส์ที่ไม่ได้อยู่ในออเดอร์แล้ว */
      if (lensItems.length || (LENS_SOURCE === 'catalog' && items && editing)) {
        try {
          await api.post('/api/lens-requisitions/sync', { order_id: oid, items: lensItems });
        } catch (ex) {
          err('บันทึกออเดอร์แล้ว แต่ออกใบเบิกเลนส์ไม่สำเร็จ: ' + (ex?.message || ex));
        }
      }
      ok(editing ? 'บันทึกออเดอร์แล้ว' : 'เปิดออเดอร์ ' + saved.invoice_code + ' เรียบร้อย');
      onSaved?.(saved);
      if (!embedded) {
        router.push(caseId ? '/cases/detail?id=' + caseId : '/orders/detail?id=' + oid);
      }
    } catch (ex) {
      err(ex);
    }
    return undefined;
  };

  const cancelHref = editing
    ? '/orders/detail?id=' + id
    : (caseId ? '/cases/detail?id=' + caseId : '/orders');

  return (
    <>
      {!embedded && (
        <PageHead
          icon="glasses"
          title="Custom Order"
          subtitle={editing ? 'แก้ไขออเดอร์ตัดแว่น' : 'เปิดออเดอร์ตัดแว่นใหม่'}
        />
      )}

      <Split>
        {/* คอลัมน์ซ้ายมีสองใบ: ลูกค้าคนนี้เป็นใคร แล้วครั้งก่อนเขาตัดแว่นอะไรไป
            คำถามสองข้อที่คนขายถามติดกันเสมอ

            พอจอแคบเหลือคอลัมน์เดียว ลำดับที่ได้คือ ลูกค้า → ประวัติแว่นเดิม →
            ค่าสายตาของเคส ซึ่งเป็นลำดับที่ต้องการพอดี: รู้ว่าคู่เดิมเป็นอะไรก่อน
            แล้วค่อยดูค่าที่วัดได้รอบนี้ว่าเปลี่ยนไปแค่ไหน จึงไม่ต้องสั่ง order ทับ */}
        <div className="stack">
        <Card
          title="ลูกค้า / เคส"
          right={!editing && !caseId
            ? <Link className="btn btn-sm btn-light" href="/customers/new?next=order">+ ลูกค้าใหม่</Link>
            : null}
        >
          {contextCustomer ? (
            <Row>
              <span className="badge blue">#{customerId}</span>
              <b>{custName(contextCustomer)}</b>
              <span className="muted">{contextCustomer.phone || ''}</span>
              {(contextCustomer.case_code || o.case_code) && (
                <Link className="btn btn-sm btn-light" href={'/cases/detail?id=' + caseId}>
                  <Icon name="board" /> {contextCustomer.case_code || o.case_code}
                </Link>
              )}
            </Row>
          ) : <span className="muted">ยังไม่ได้เลือกลูกค้า</span>}

          {!editing && !caseId && (
            <div style={{ marginTop: 10 }}>
              <Picker
                placeholder="ค้นหาลูกค้า (ชื่อ / เบอร์โทร / รหัส)"
                fetcher={(q) => api.get('/api/customers', { q, limit: 40 })}
                label={custName}
                sub={(r) => r.phone || ''}
                selectedId={customerId}
                onPick={chooseCustomer}
              />
            </div>
          )}
        </Card>

        <EyewearHistory rows={history} loading={historyLoading} />
        </div>

        <Card
          title={caseId ? 'ค่าสายตาของเคส' : 'เลือกผลวัดสายตา'}
          badge={caseId && caseSets.final ? <Badge kind="ok">ใช้ค่าที่ยืนยันแล้ว</Badge> : null}
        >
          {caseId ? (
            <>
              {caseRx.length ? (
                <RxSets old={caseSets.old} measured={caseSets.measured} final={caseSets.final} />
              ) : (
                <p className="muted">ยังไม่มีการวัดสายตาในเคสนี้</p>
              )}
              {!caseSets.final && (
                <p className="hint">
                  {caseSets.measured
                    ? 'ยังไม่ได้กดยืนยันผลวัดสายตา — ออเดอร์นี้จะอ้างอิงค่าที่วัดได้ไปก่อน'
                    : 'ยังไม่มีค่าสายตาให้ใช้กับออเดอร์นี้'}
                </p>
              )}
              <Row style={{ marginTop: 10 }}>
                <Link className="btn btn-sm btn-light" href={`/cases/detail?id=${caseId}&step=exam`}>
                  <Icon name="eye" /> เปิดขั้นวัดสายตา
                </Link>
              </Row>
            </>
          ) : null}
          {!caseId && !contextCustomer && <span className="muted">เลือกลูกค้าก่อน</span>}
          {!caseId && contextCustomer && rxList.length === 0 && (
            <div className="stack">
              <span className="muted">ยังไม่มีผลวัดสายตาให้เลือก</span>
              {/* วัดสายตาทำในเคส ไม่ใช่ใบลอย ๆ — ออเดอร์ที่ยังไม่มีเคสจึงต้องเปิดเคสก่อน */}
              <Link className="btn btn-sm btn-accent" href={`/cases/new?customer=${customerId}`}>
                <Icon name="board" /> เปิดเคสเพื่อวัดสายตา
              </Link>
            </div>
          )}
          {!caseId && contextCustomer && rxList.length > 0 && (
            <div className="picker">
              {rxList.map((rx) => (
                <div
                  key={rx.id}
                  className={`p-row ${rx.id === rxId ? 'sel' : ''}`}
                  onClick={() => setRxId(rx.id)}
                >
                  <span className="p-main">
                    <b>{RX_KIND_LABEL[rx.kind] || rx.kind}</b>{' '}
                    <span className="muted">{fmtDateTime(rx.test_date)}</span>
                    <span className="muted">
                      {`  R ${sphPower(rx.r_sphere)}/${cylPower(rx.r_cylinder)}×${rxNum(rx.r_axis)}`
                        + `   L ${sphPower(rx.l_sphere)}/${cylPower(rx.l_cylinder)}×${rxNum(rx.l_axis)}`
                        + (rx.test_for ? '  · ' + rx.test_for : '')}
                    </span>
                  </span>
                  <span className="p-id">#{rx.id}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Split>

      <form ref={formRef} onSubmit={onSubmit(save)}>
        {/* ล็อก = ปิดทุกช่องในครั้งเดียว · display:contents ไม่ให้กล่องนี้เปลี่ยนเลย์เอาต์
            pointerEvents กันแถวในรายการที่กดได้แต่ไม่ใช่ปุ่ม ซึ่ง disabled ไปไม่ถึง */}
        {locked ? <style>{'.order-form-locked .card{opacity:.65}'}</style> : null}
        <fieldset
          disabled={locked}
          className={locked ? 'order-form-locked' : undefined}
          style={{ display: 'contents', pointerEvents: locked ? 'none' : undefined }}
        >
        <Card title="รายละเอียดออเดอร์">
          {/* ไม่ถาม "ช่องทางที่รู้จัก" ที่นี่แล้ว — ถามไปแล้วตอนเปิดเคส ถามซ้ำตอนขายได้
              คำตอบที่ขัดกันเอง คอลัมน์ custom_orders.marketing ยังอยู่และของเก่ายังอ่านได้
              ส่งค่าเดิมไปกับฟอร์มด้วย เพราะ PUT เขียนทับทุกคอลัมน์ ไม่ส่งคือล้างทิ้ง */}
          <input type="hidden" name="marketing" value={o.marketing || ''} readOnly />
          <FormGrid>
            <Field label="พนักงานผู้ขาย / Employee">
              {/* ถ้าออเดอร์ผูกเคส contextCustomer คือตัวเคส — ใช้ประเภทงานของเคสเลือกรายชื่อผู้ขาย */}
              <StepEmployeeSelect step="sales" caseType={caseId ? contextCustomer?.case_type : null} name="employee_id" defaultValue={o.employee_id || ''} />
            </Field>
          </FormGrid>
        </Card>

        <Card title={<><Icon name="glasses" /> กรอบแว่น — Frame</>}>
          <p className="hint">เลือกกรอบจากสต็อก แล้วใส่ราคาขายของออเดอร์นี้</p>
          {/* ลูกค้าเอากรอบเดิมมาเปลี่ยนเลนส์ — งานที่ร้านทำทุกวัน แต่ไม่มีของ
              ออกจากคลังสักชิ้น · เลือกแล้วออเดอร์บันทึกว่าใช้กรอบเดิม ชื่อกรอบ
              ไปโผล่ในใบสั่งและในประวัติพร้อมเลขออเดอร์เหมือนกรอบที่ขายจริง
              ต่างกันตรงไม่มี frame_product_id จึงไม่มีอะไรถูกตัดจากสต็อก */}
          <div className={s.frameSource}>
            <label className={`${s.frameOption} ${usesOldFrame ? '' : s.on}`}>
              <input
                type="radio"
                name="frame_source"
                checked={!usesOldFrame}
                onChange={() => setOldFrame(false)}
              />
              <span className={s.frameIcon}><Icon name="home" /></span>
              <span><b>กรอบจากสต็อก</b><small>เลือกกรอบที่มีในร้าน</small></span>
            </label>
            <label className={`${s.frameOption} ${usesOldFrame ? s.on : ''}`}>
              <input
                type="radio"
                name="frame_source"
                checked={usesOldFrame}
                onChange={() => {
                  setOldFrame(true);
                  setItems({ ...picked, frame: null });
                  setP({ frame_price: 0 });
                }}
              />
              <span className={s.frameIcon}><Icon name="user" /></span>
              <span><b>กรอบลูกค้า</b><small>ใช้กรอบเดิม / ไม่ตัดสต็อก</small></span>
            </label>
          </div>

          {/* ถามทั้งกรอบจากสต็อกและกรอบเก่าของลูกค้า (เจ้าของร้านขอ 2026-09-10)
              ช่างต้องรู้ว่าเจาะหรือเซาะร่อง ไม่ว่ากรอบมาจากไหน · ต้องอยู่ในฟอร์มเสมอ
              เพราะ PUT เขียนทับทุกคอลัมน์ รายการมาจาก Lookups::FRAME_TYPES ตัวเดียวกับที่ API ใช้ตรวจ */}
          <Field label={<>ประเภทกรอบ / Frame Type <span style={{ color: 'var(--danger, #d33)' }}>*</span></>}>
            <ListSelect
              name="frame_type"
              kind="frame_type"
              defaultValue={o.frame_type || ''}
              blank="— เลือกประเภทกรอบ —"
            />
          </Field>

          {usesOldFrame ? (
            /* ไม่มีช่องให้พิมพ์ชื่อ — กรอบของลูกค้าไม่ใช่สินค้าของร้าน ชื่อที่
               พิมพ์เองจะกลายเป็นสิบแบบในสิบใบ แล้วค้นหาทีหลังไม่เจอ · ใบสั่งและ
               ประวัติเขียนคำเดียวกันทุกใบว่า oldframe */
            <div className={s.oldFrameNote}>
              <InfoGlyph />
              <span>บันทึกเป็นชื่อว่า <b>oldframe</b> · ไม่ตัดของออกจากคลัง</span>
            </div>
          ) : (
            <StockPicker
              type="Frame"
              picked={picked.frame}
              onPick={(r) => setPicked({ frame: r })}
              onClear={() => setItems({ ...picked, frame: null })}
              selectedId={picked.frame?.id ?? null}
            />
          )}
          <SellingPrice
            variant={s.framePrice}
            label="ราคาขายกรอบ / Selling Price"
            value={p.frame_price}
            onChange={(e) => setP({ frame_price: e.target.value })}
          />
          <ItemDetails
            picked={picked.frame}
            rows={[
              ['ชื่อกรอบ', picked.frame ? stockLabel(picked.frame) : '—'],
              ['ราคา', money(p.frame_price)],
              ['ยี่ห้อ', picked.frame?.brand || '—'],
              ['รุ่น', picked.frame?.model || '—'],
              ['สี', picked.frame?.color || '—'],
              ['ไซส์', picked.frame?.size || '—'],
              ['SKU', picked.frame?.sku || '—'],
              ['คงเหลือในคลัง', picked.frame?.remaining_qty != null ? `${picked.frame.remaining_qty} ชิ้น` : '—'],
              picked.frame?.location ? ['ตำแหน่งเก็บ', picked.frame.location] : null,
            ].filter(Boolean)}
          />
        </Card>

        <Card title={<><Icon name="glasses" /> เลนส์ — Lens</>}>
          <p className="hint">
            {LENS_SOURCE === 'catalog'
              ? 'เลือกเลนส์จากรายการเลนส์ทีละข้าง · ไม่ตัดสต็อก — บันทึกเป็น "ใช้เลนส์" (ประวัติเลนส์) เมื่อยืนยันขั้นขาย'
              : 'ถ้ายังต้องสั่งเลนส์จากซัพพลายเออร์ ให้ข้ามการเลือกสต็อกไปก่อน'}
          </p>
          <div className={s.tintBar}>
            <div className={s.tintHead}>
              <PaletteGlyph />
              <div>
                <b>ย้อมสีเลนส์ / Lens Tint (Dye)</b>
                <small>เลือกสีและระดับความเข้ม (1 = อ่อนที่สุด | 4 = เข้มที่สุด)</small>
              </div>
            </div>
            <div className={s.tintOptions}>
              <label className={`${s.tintOption} ${dyed ? '' : s.on}`}>
                <input type="radio" name="lens_tint_mode" checked={!dyed} onChange={() => setDyeOn(false)} />
                <span><b>ไม่ย้อมสี</b><small>เลนส์สีใสปกติ</small></span>
              </label>
              <label className={`${s.tintOption} ${dyed ? s.on : ''}`}>
                <input type="radio" name="lens_tint_mode" checked={dyed} onChange={() => setDyeOn(true)} />
                <span><b>ย้อมสี</b><small>เลือกสีและระดับความเข้ม</small></span>
              </label>
            </div>
            {dyed ? (
              <div className={s.swatches} role="group" aria-label="ตัวอย่างสีย้อม">
                {TINT_COLORS.map(({ en, th, head, shades }) => (
                  <div key={en} className={`${s.swatch} ${dyeColor === th ? s.on : ''}`}>
                    <div className={s.swatchHead} style={{ background: head }}>
                      <b>{en}</b>
                      <small>{th}</small>
                    </div>
                    <div className={s.levels}>
                      {TINT_LEVELS.map((level, i) => {
                        const on = dyeColor === th && dyeLevel === level;
                        return (
                          <button
                            key={level}
                            type="button"
                            className={`${s.level} ${on ? s.on : ''}`}
                            aria-label={`${th} ระดับ ${level}`}
                            aria-pressed={on}
                            onClick={() => setDyePick({ color: th, level })}
                          >
                            <span className={s.shade} style={{ backgroundColor: shades[i] }} />
                            <span className={s.levelNo}>{level}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {/* สีตามตัวอย่าง — การ์ดท้ายแถว ไม่มีระดับ 1–4 กดทั้งการ์ดเพื่อเลือก */}
                <button
                  type="button"
                  className={`${s.swatch} ${s.matchCard} ${dyeColor === COLOR_MATCH.th ? s.on : ''}`}
                  aria-pressed={dyeColor === COLOR_MATCH.th}
                  onClick={() => setDyePick({ color: COLOR_MATCH.th, level: 0 })}
                >
                  <b>สีตามตัวอย่าง</b>
                  <b>(Color Match)</b>
                  <ImageGlyph />
                </button>
                {dyeColor && !dyeLevel && dyeColor !== COLOR_MATCH.th ? (
                  <p className={s.legacyDye}>
                    ออเดอร์นี้บันทึกไว้ว่า “ย้อมสี {dyeColor}” แบบยังไม่มีระดับความเข้ม — เลือกใหม่ด้านบนได้ ถ้าไม่เลือกจะคงค่าเดิม
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          {/* mirror: ขวา/ซ้ายต้องกว้างเท่ากัน — ค่าเริ่มต้นของ .split ให้ฝั่งขวากว้าง
              กว่า 15% ซึ่งทำให้เลนส์รุ่นเดียวกันสองข้างขึ้นกล่องสูงไม่เท่ากัน */}
          <Split className="mirror">
            {[
              ['lensOd', 'r', 'เลนส์ขวา (R)', 'lens_od_price', 'lens_r_name', 'lens_r_sku', o.lens_r_name, o.lens_r_sku],
              ['lensOs', 'l', 'เลนส์ซ้าย (L)', 'lens_os_price', 'lens_l_name', 'lens_l_sku', o.lens_l_name, o.lens_l_sku],
            ].map(([slot, side, legend, priceKey, nameKey, skuKey, savedName, savedSku]) => {
              const item = picked[slot];
              const rx = item ? null : rxOf(side);
              /* ว่าง = กดล้างใบสั่งตัด RX หรือกดล้างเลนส์จากรายการที่ออเดอร์เลือกไว้ — ช่องชื่อที่โผล่มา
                 แทนการ์ดต้องว่าง ไม่ใช่ชื่อเลนส์ที่เพิ่งล้าง (บันทึกแล้วชื่อเดิมจะกลับเข้าออเดอร์) */
              const fromCatalog = slot === 'lensOd' ? o.lens_catalog_r : o.lens_catalog_l;
              const cleared = rxLens[side] === null || (!item && !!items && !!fromCatalog);
              return (
                <Fieldset key={slot} legend={<><Icon name="eye" /> {legend}</>}>
                  {/* สั่งตัดแล้วขึ้นการ์ดแบบเดียวกับเลนส์ที่เลือกจากสต็อก — ช่องค้นหากับ
                      ปุ่มสั่งตัดหายไปจนกว่าจะกดล้าง ข้างเดียวจะได้ไม่มีทั้งเลนส์สต็อก
                      และใบสั่งตัดพร้อมกัน */}
                  {rx ? (
                    <div className="picked-item">
                      <Icon name="glasses" />
                      <b>{rx.name || 'เลนส์สั่งตัด RX'}</b>
                      <span className="muted" title={rxSub(rx)}>
                        {asking === side ? 'ยกเลิกใบสั่งนี้ในคลังด้วย?' : rxSub(rx)}
                      </span>
                      <span className="p-id">{rx.referenceDoc}</span>
                      {asking === side ? null : (
                        <RxArrival arrivedAt={rx.arrivedAt} scrappedAt={rx.scrappedAt} scraps={rx.scraps} />
                      )}
                      {asking === side ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => dropRx(side, rx)}
                          >
                            ยกเลิกใบสั่ง
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-light"
                            onClick={() => setAsking(null)}
                          >
                            ไม่
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-light"
                          onClick={() => setAsking(side)}
                          disabled={dropping === side}
                        >
                          {dropping === side ? 'กำลังยกเลิก…' : 'ล้าง'}
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {/* Bewell (LENS_SOURCE=catalog): รายการเลนส์ ไม่ใช่ของในคลัง — ดู lib/lens/lensSource.js */}
                      {/* ไม่มีปุ่ม "ล้าง" (ร้านขอ 26 ก.ย. 2026) — เลือกเลนส์แล้วเปลี่ยนเป็นตัวอื่นได้อย่างเดียว */}
                      {LENS_SOURCE === 'catalog' ? (
                        <CatalogLensPicker
                          picked={item}
                          locked={o.lens_locked || null}
                          onPick={(r) => setPicked({ [slot]: r })}
                        />
                      ) : (
                        <StockPicker
                          type="Lens"
                          picked={item}
                          onPick={(r) => setPicked({ [slot]: r })}
                          onClear={() => setItems({ ...picked, [slot]: null })}
                          selectedId={item?.id ?? null}
                        />
                      )}
                      {/* เลนส์สั่งตัดไม่มีของบนชั้นให้เลือก จึงไม่ได้อยู่ในรายการ
                          ข้างบน — ปุ่มนี้เปิดใบสั่งจากค่าสายตาที่เพิ่งวัดได้เลย
                          ผลที่ได้คือชื่อกับ SKU ไม่ใช่ล็อต ตอนยืนยันการขายจึงไม่มี
                          อะไรถูกตัดจากคลังซ้ำอีกรอบ */}
                      {/* ขึ้นเสมอ แม้ข้างนี้มีเลนส์อยู่แล้ว (ร้านขอ 19 พ.ย. 2026 — ออเดอร์เก่าจาก Access มีเลนส์
                          ติดมา และรายการเลนส์ไม่มีปุ่มล้าง ปุ่มนี้เลยหายไปทั้งเคส) · สั่งตัดแล้วใบ RX แทนเลนส์เดิม
                          ของข้างนี้ (ดู onRx ข้างล่าง) */}
                      <button
                        type="button"
                        className="btn btn-light btn-sm"
                        style={{ marginBottom: 10 }}
                        onClick={() => setRxFor(side)}
                      >
                        <Icon name="glasses" /> {item ? 'สั่งตัดเลนส์ RX แทน' : 'สั่งตัดเลนส์ RX'} ({side.toUpperCase()})
                      </button>
                      {/* ใบที่ออเดอร์เคยผูกไว้ถูกลบ/ยกเลิกที่หน้าคลังแล้ว (API ตัดลิงก์ทิ้ง
                          ใน orderDetail) — บอกไว้ คนจะได้ไม่งงว่าใบเดิมหายไปไหน */}
                      {!item && rxLens[side] === undefined && o[`lens_${side}_rx_gone_doc`] ? (
                        <p className="muted" style={{ margin: '0 0 10px' }}>
                          ใบสั่งตัด {o[`lens_${side}_rx_gone_doc`]} ที่เคยผูกไว้ถูกลบที่หน้าคลังแล้ว
                          — กดสั่งตัดใหม่ แล้วบันทึกออเดอร์
                        </p>
                      ) : null}
                    </>
                  )}
                  {/* ราคารายข้างเป็นของรองจากราคาคู่ — เงียบลงทั้งสีและขนาด ไม่ให้
                      แย่งสายตากับแถบสรุปราคาคู่ท้ายการ์ด แต่ยังกรอกทับได้ทุกเมื่อ
                      ป้ายสั้นลงเหลือแค่ข้าง เพราะคำว่า "ราคาขาย" เต็ม ๆ เป็นของแถบคู่ */}
                  <SellingPrice
                    variant="sell-price-side"
                    label={`${dyed ? 'ราคาผลิตและย้อมสี' : 'ราคาเฉพาะข้างนี้'} (${side.toUpperCase()})`}
                    value={p[priceKey]}
                    onChange={(e) => setP({ [priceKey]: e.target.value })}
                    hint=""
                  />
                  <ItemDetails
                    picked={item}
                    rows={[
                      ['ชื่อเลนส์', item ? stockLabel(item) : '—'],
                      ['ยี่ห้อ', item?.brand || '—'],
                      ['ชนิด', item?.lens_design || '—'],
                      ['Index', item?.lens_index || '—'],
                      ['Coating', item?.coating || '—'],
                      ['SKU', item?.sku || '—'],
                      item?.catalog
                        ? ['ราคาขาย (คู่)', `${Number(item.pair_price || 0).toLocaleString('th-TH')} บาท`]
                        : ['คงเหลือในคลัง', item?.remaining_qty != null ? `${item.remaining_qty} ชิ้น` : '—'],
                    ]}
                  >
                    {rx ? null : (
                      <FormGrid>
                        {/* กดล้างใบสั่งตัดแล้วช่องต้องว่าง ไม่ใช่กลับไปเป็นชื่อเลนส์ที่
                            เพิ่งยกเลิก — `key` เปลี่ยนตาม ช่องจึงถูกวาดใหม่ ไม่ค้างค่าเดิม
                            แบบที่ defaultValue เป็นตามปกติ */}
                        <Field label={`ชื่อเลนส์ (${side.toUpperCase()})`}>
                          <input
                            key={`ln${side}${item?.id ?? (cleared ? 'x' : '0')}`}
                            name={nameKey}
                            defaultValue={
                              item ? stockLabel(item) : (cleared ? '' : (savedName || ''))
                            }
                            placeholder="เช่น Crizal Easy Pro 1.56"
                          />
                        </Field>
                        <Field label={`SKU (${side.toUpperCase()})`}>
                          <input
                            key={`lk${side}${item?.id ?? (cleared ? 'x' : '0')}`}
                            name={skuKey}
                            defaultValue={item?.sku || (cleared ? '' : (savedSku || ''))}
                          />
                        </Field>
                      </FormGrid>
                    )}
                  </ItemDetails>
                </Fieldset>
              );
            })}
          </Split>
          {/* ราคาคู่ปิดท้ายการ์ด — อ่านเป็นบรรทัดสรุปของสองข้างที่เพิ่งเลือกไป
              เหมือนยอดรวมที่อยู่ใต้รายการเสมอ ไม่ใช่ช่องที่ต้องกรอกก่อนรู้ว่าขายอะไร */}
          <PairSellingPrice
            od={p.lens_od_price}
            os={p.lens_os_price}
            onSplit={({ od, os }) => setP({ lens_od_price: od, lens_os_price: os })}
            dyed={dyed}
          />
        </Card>

        {/* กล่องเปิดใบสั่งตัดตัวจริงของฝั่งคลัง ฝังมาเป็น iframe — เลขใบสั่ง
            สิทธิ์กรอกต้นทุน และการเลือกรุ่นเลนส์ ทำงานเหมือนเปิดจากหน้าคลังทุกอย่าง */}
        {rxFor ? (
          <StockEmbedModal
            what="rx"
            side={rxFor}
            title={`สั่งตัดเลนส์ ${rxFor === 'r' ? 'ขวา (R)' : 'ซ้าย (L)'}`}
            onClose={() => setRxFor(null)}
            onRx={(order) => {
              /* ใบ RX แทนเลนส์ที่เลือกไว้ของข้างนี้ — ไม่งั้นข้างเดียวมีทั้งเลนส์และใบสั่งตัด (การ์ด RX ไม่ขึ้น) */
              const slot = rxFor === 'r' ? 'lensOd' : 'lensOs';
              if (picked[slot]) setItems({ ...picked, [slot]: null });
              setRxLens((m) => ({ ...m, [rxFor]: order }));
              setRxFor(null);
              setAutoSave((n) => n + 1);
            }}
          />
        ) : null}

        <Card title="ราคา">
          {/* ราคากรอบ/เลนส์ กรอกอยู่ข้างสินค้าแต่ละชิ้นด้านบน ส่งค่าไปกับฟอร์มผ่านช่องซ่อน
              จะได้ไม่ต้องมีช่องราคาเดียวกันสองที่ให้สับสนว่าอันไหนจริง */}
          <input type="hidden" name="frame_price" value={p.frame_price} readOnly />
          <input type="hidden" name="lens_od_price" value={p.lens_od_price} readOnly />
          <input type="hidden" name="lens_os_price" value={p.lens_os_price} readOnly />
          {/* ค่าออพชั่นเสริม กับ มัดจำ/ช่องทางจ่ายมัดจำ ไม่ได้อยู่ขั้นนี้ — เงินทุกก้อนรับที่ขั้น
              "ชำระเงิน" ที่เดียว ค่าที่เคยบันทึกไว้ยังส่งไปกับฟอร์มเพื่อไม่ให้การแก้ออเดอร์ล้างทิ้ง */}
          <input type="hidden" name="options_price" value={p.options_price} readOnly />
          <input type="hidden" name="deposit" value={p.deposit} readOnly />
          <input type="hidden" name="deposit_pay_type" value={o.deposit_pay_type || 'Cash'} readOnly />
          {/* ส่วนลดไม่ได้ตั้งที่ขั้นนี้แล้ว ค่าที่เคยบันทึกไว้ยังส่งไปกับฟอร์มเหมือน
              ค่าออพชั่น/มัดจำ จะได้ไม่ถูกล้างทิ้งตอนกลับมาแก้ออเดอร์ */}
          <input type="hidden" name="discount" value={p.discount} readOnly />

          {/* เหลือใบเดียว — ยอดสุทธิคือตัวเลขที่ลูกค้าจ่ายจริง อีกใบเป็นแค่ทางผ่าน
              ที่มาของยอดยกไปอยู่บรรทัดล่างแทน จะได้ยังทานกับราคาที่กรอกข้างบนได้ */}
          <div style={{ marginTop: 10 }}>
            <Kpis>
              <Kpi
                label="ยอดสุทธิ (Net Total)"
                value={money(netTotal)}
                kind={discountTooHigh ? 'danger' : 'accent'}
                sub={
                  discountTooHigh
                    ? `ส่วนลดเดิม ${money(n(p.discount))} มากกว่าราคารวม ${money(total)}`
                    : n(p.discount)
                      ? `ราคารวม ${money(total)} − ส่วนลด ${money(n(p.discount))}`
                      : 'กรอบ + เลนส์คู่ (R+L)'
                }
              />
            </Kpis>
          </div>
        </Card>

        </fieldset>

        <Card title="หมายเหตุ">
          <textarea
            name="notes"
            disabled={locked}
            defaultValue={o.notes || ''}
            placeholder="รายละเอียดเพิ่มเติม เช่น สีเลนส์ ทรงกรอบ การปรับขาแว่น"
          />
          <FormActions style={{ marginTop: 14 }}>
            {locked ? (
              /* key แยกกัน: ถ้า React ใช้ปุ่มตัวเดิม ปุ่มจะกลายเป็น submit ระหว่างคลิกแล้วบันทึกทันที */
              onUnlock ? <button key="unlock" className="btn btn-lg" type="button" onClick={onUnlock}>เปิดการแก้ไข</button> : null
            ) : (
              <button key="submit" className="btn btn-lg" type="submit">
                <Icon name="save" /> {editing ? 'บันทึกการแก้ไข' : 'เปิดออเดอร์'}
              </button>
            )}
            {!embedded && <Link className="btn btn-light" href={cancelHref}>ยกเลิก</Link>}
          </FormActions>
        </Card>
      </form>
    </>
  );
}
