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
import { useState } from 'react';
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
import { RxSets } from '../../../components/RxSets.jsx';
import { EyewearHistory } from '../../../components/EyewearHistory.jsx';
import { EmployeeSelect } from '../../../components/Selects.jsx';
import { StockEmbedModal } from '../../../components/StockEmbedModal.jsx';
import { RX_KIND_LABEL } from '../../../lib/constants.js';
import {
  custName, fmtDateTime, money, power, rxNum,
} from '../../../lib/format.js';
import { Icon } from '../../../components/Icon.jsx';

const n = (v) => Number(v || 0);

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
function SellingPrice({ label, value, onChange }) {
  return (
    <div className="sell-price">
      <label>{label}</label>
      <input type="number" step="1" min="0" value={value} onChange={onChange} />
      <small>ราคาของออเดอร์นี้ ไม่กระทบราคาสินค้าในคลัง</small>
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
  /* ติ๊ก "กรอบเดิมของลูกค้า" เป็น state ที่ตั้งค่าจากออเดอร์ทีหลัง (ดู useEffect
     ใต้ตัวแปร o) — ตั้งตรงนี้เลยไม่ได้เพราะ o ยังไม่มีค่าในบรรทัดนี้ */
  const [oldFrame, setOldFrame] = useState(false);
  /** ข้างที่กำลังเปิดใบสั่งตัดอยู่ ('r' | 'l') หรือ null เมื่อไม่ได้เปิด */
  const [rxFor, setRxFor] = useState(null);
  /** ใบสั่งตัดที่เพิ่งเปิดในหน้านี้ แยกตามข้าง — ไม่มีล็อตให้ผูก จึงเก็บเอง */
  const [rxLens, setRxLens] = useState({});

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
    lensOd: o.left_lens || null,
    lensOs: o.right_lens || null,
  };

  /* ออเดอร์เก่าที่มีชื่อกรอบแต่ไม่ได้ผูกกับของในคลัง คือกรอบเดิมของลูกค้า —
     ติ๊กให้เองตอนเปิดมาแก้ ไม่งั้นกดบันทึกซ้ำแล้วชื่อกรอบจะหาย · `items` เป็น
     null แปลว่ายังไม่มีใครแตะฟอร์ม จึงยังอ่านสถานะจากออเดอร์ได้ */
  const oldFrameFromOrder = Boolean(o.frame_name) && !o.frame_product_id && !o.frame;
  const usesOldFrame = items === undefined ? oldFrame || oldFrameFromOrder : oldFrame;
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
    body.customer_id = customerId;
    body.case_id = caseId;
    body.final_prescription_id = rxId;
    /* กรอบเดิมของลูกค้า = ไม่มีของออกจากคลัง ชื่อกรอบยังถูกบันทึกตามที่พิมพ์
       และเดินไปกับใบสั่งเหมือนกรอบที่ขายจริง */
    body.frame_product_id = usesOldFrame ? null : (picked.frame?.id ?? null);
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

    try {
      const saved = editing
        ? await api.put('/api/orders/' + id, body)
        : await api.post('/api/orders', body);
      const oid = editing ? id : saved.id;
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
          icon="👓"
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
                      {`  R ${power(rx.r_sphere)}/${power(rx.r_cylinder)}×${rxNum(rx.r_axis)}`
                        + `   L ${power(rx.l_sphere)}/${power(rx.l_cylinder)}×${rxNum(rx.l_axis)}`
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

      <form onSubmit={onSubmit(save)}>
        <Card title="รายละเอียดออเดอร์">
          {/* ไม่ถาม "ช่องทางที่รู้จัก" ที่นี่แล้ว — ถามไปแล้วตอนเปิดเคส ถามซ้ำตอนขายได้
              คำตอบที่ขัดกันเอง คอลัมน์ custom_orders.marketing ยังอยู่และของเก่ายังอ่านได้
              ส่งค่าเดิมไปกับฟอร์มด้วย เพราะ PUT เขียนทับทุกคอลัมน์ ไม่ส่งคือล้างทิ้ง */}
          <input type="hidden" name="marketing" value={o.marketing || ''} readOnly />
          <FormGrid>
            <Field label="พนักงานผู้ขาย / Employee">
              <EmployeeSelect name="employee_id" defaultValue={o.employee_id || ''} />
            </Field>
          </FormGrid>
        </Card>

        <Card title="กรอบแว่น — Frame">
          <p className="hint">เลือกกรอบจากสต็อก แล้วใส่ราคาขายของออเดอร์นี้</p>

          {/* ลูกค้าเอากรอบเดิมมาเปลี่ยนเลนส์ — งานที่ร้านทำทุกวัน แต่ไม่มีของ
              ออกจากคลังสักชิ้น · ติ๊กแล้วออเดอร์บันทึกว่าใช้กรอบเดิม ชื่อกรอบ
              ไปโผล่ในใบสั่งและในประวัติพร้อมเลขออเดอร์เหมือนกรอบที่ขายจริง
              ต่างกันตรงไม่มี frame_product_id จึงไม่มีอะไรถูกตัดจากสต็อก */}
          <label className={`toggle-card ${usesOldFrame ? 'on' : ''}`}>
            <input
              type="checkbox"
              name="uses_old_frame"
              checked={usesOldFrame}
              onChange={(e) => {
                setOldFrame(e.target.checked);
                if (e.target.checked) {
                  setItems({ ...picked, frame: null });
                  setP({ frame_price: 0 });
                }
              }}
            />
            <span className="toggle-card__text">
              <b>ใช้กรอบเก่าของลูกค้า</b>
              <small>ลูกค้าเอากรอบเดิมมาเปลี่ยนเลนส์ — ไม่มีของออกจากคลัง</small>
            </span>
          </label>

          {usesOldFrame ? (
            /* ไม่มีช่องให้พิมพ์ชื่อ — กรอบของลูกค้าไม่ใช่สินค้าของร้าน ชื่อที่
               พิมพ์เองจะกลายเป็นสิบแบบในสิบใบ แล้วค้นหาทีหลังไม่เจอ · ใบสั่งและ
               ประวัติเขียนคำเดียวกันทุกใบว่า oldframe */
            <p className="hint">บันทึกในใบสั่งว่า <b>oldframe</b> · ไม่ตัดของออกจากคลัง</p>
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

        <Card title="เลนส์ — Lens">
          <p className="hint">
            ถ้ายังต้องสั่งเลนส์จากซัพพลายเออร์ ให้ข้ามการเลือกสต็อกไปก่อน —
            ราคาขายสองข้างตั้งแยกกันได้ ไม่บังคับให้เท่ากัน
          </p>
          <Split>
            {[
              ['lensOd', 'r', 'เลนส์ขวา (R)', 'lens_od_price', 'lens_r_name', 'lens_r_sku', o.lens_r_name, o.lens_r_sku],
              ['lensOs', 'l', 'เลนส์ซ้าย (L)', 'lens_os_price', 'lens_l_name', 'lens_l_sku', o.lens_l_name, o.lens_l_sku],
            ].map(([slot, side, legend, priceKey, nameKey, skuKey, savedName, savedSku]) => {
              const item = picked[slot];
              return (
                <Fieldset key={slot} legend={legend}>
                  <StockPicker
                    type="Lens"
                    picked={item}
                    onPick={(r) => setPicked({ [slot]: r })}
                    onClear={() => setItems({ ...picked, [slot]: null })}
                    selectedId={item?.id ?? null}
                  />
                  {/* เลนส์สั่งตัดไม่มีของบนชั้นให้เลือก จึงไม่ได้อยู่ในรายการ
                      ข้างบน — ปุ่มนี้เปิดใบสั่งจากค่าสายตาที่เพิ่งวัดได้เลย
                      ผลที่ได้คือชื่อกับ SKU ไม่ใช่ล็อต ตอนยืนยันการขายจึงไม่มี
                      อะไรถูกตัดจากคลังซ้ำอีกรอบ */}
                  {!item ? (
                    <button
                      type="button"
                      className="btn btn-light btn-sm"
                      style={{ marginBottom: 10 }}
                      onClick={() => setRxFor(side)}
                    >
                      <Icon name="glasses" /> สั่งตัดเลนส์ RX ({side.toUpperCase()})
                    </button>
                  ) : null}
                  <SellingPrice
                    label={`ราคาขาย${legend.replace(/ \(.\)$/, '')} / Selling Price (${side.toUpperCase()})`}
                    value={p[priceKey]}
                    onChange={(e) => setP({ [priceKey]: e.target.value })}
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
                      ['คงเหลือในคลัง', item?.remaining_qty != null ? `${item.remaining_qty} ชิ้น` : '—'],
                    ]}
                  >
                    <FormGrid>
                      {/* ใบสั่งตัดที่เพิ่งเปิดชนะค่าที่บันทึกไว้ — `key` มีเลข
                          ใบสั่งอยู่ด้วย ช่องจึงถูกวาดใหม่พร้อมค่าใหม่ ไม่ใช่ค้าง
                          ค่าเดิมแบบที่ defaultValue เป็นตามปกติ */}
                      <Field label={`ชื่อเลนส์ (${side.toUpperCase()})`}>
                        <input
                          key={`ln${side}${item?.id ?? rxLens[side]?.referenceDoc ?? '0'}`}
                          name={nameKey}
                          defaultValue={
                            item ? stockLabel(item) : (rxLens[side]?.name || savedName || '')
                          }
                          placeholder="เช่น Crizal Easy Pro 1.56"
                        />
                      </Field>
                      <Field label={`SKU (${side.toUpperCase()})`}>
                        <input
                          key={`lk${side}${item?.id ?? rxLens[side]?.referenceDoc ?? '0'}`}
                          name={skuKey}
                          defaultValue={item?.sku || rxLens[side]?.sku || savedSku || ''}
                        />
                      </Field>
                    </FormGrid>
                    {rxLens[side] ? (
                      <p className="hint">
                        เปิดใบสั่งตัดแล้ว — {rxLens[side].referenceDoc} · เลนส์นี้ไม่ถูกตัดจากคลัง
                      </p>
                    ) : null}
                  </ItemDetails>
                </Fieldset>
              );
            })}
          </Split>
        </Card>

        {/* กล่องเปิดใบสั่งตัดตัวจริงของฝั่งคลัง ฝังมาเป็น iframe — เลขใบสั่ง
            สิทธิ์กรอกต้นทุน และการเลือกรุ่นเลนส์ ทำงานเหมือนเปิดจากหน้าคลังทุกอย่าง */}
        {rxFor ? (
          <StockEmbedModal
            what="rx"
            title={`สั่งตัดเลนส์ ${rxFor === 'r' ? 'ขวา (R)' : 'ซ้าย (L)'}`}
            onClose={() => setRxFor(null)}
            onRx={(order) => {
              setRxLens((m) => ({ ...m, [rxFor]: order }));
              setRxFor(null);
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
                      : 'กรอบ + เลนส์ขวา + เลนส์ซ้าย'
                }
              />
            </Kpis>
          </div>
        </Card>

        <Card title="หมายเหตุ">
          <textarea
            name="notes"
            defaultValue={o.notes || ''}
            placeholder="รายละเอียดเพิ่มเติม เช่น สีเลนส์ ทรงกรอบ การปรับขาแว่น"
          />
          <FormActions style={{ marginTop: 14 }}>
            <button className="btn btn-lg" type="submit">
              <Icon name="save" /> {editing ? 'บันทึกการแก้ไข' : 'เปิดออเดอร์'}
            </button>
            {!embedded && <Link className="btn btn-light" href={cancelHref}>ยกเลิก</Link>}
          </FormActions>
        </Card>
      </form>
    </>
  );
}
