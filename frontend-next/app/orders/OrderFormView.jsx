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
 * <StockPicker> selections (frame / lens OD / lens OS), and the four price
 * fields + discount, which are kept live so the Total / Net Total mirror
 * what the server (Task 2's orderVals()) will compute and validate.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync, onSubmit } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import {
  Card, Field, Fieldset, FormActions, FormGrid, Kpi, Kpis, Loading, PageHead, Row, Split,
} from '../../components/ui.jsx';
import { Picker } from '../../components/Picker.jsx';
import { StockPicker } from '../../components/StockPicker.jsx';
import { EmployeeSelect, ListSelect } from '../../components/Selects.jsx';
import { RX_KIND_LABEL } from '../../lib/constants.js';
import {
  custName, fmtDateTime, money, power, rxNum,
} from '../../lib/format.js';
import { Icon } from '../../components/Icon.jsx';

const n = (v) => Number(v || 0);

/** compact display line for a picked stock item, with a way to clear it */
function PickedItem({ item, onClear }) {
  if (!item) return <span className="muted">ยังไม่ได้เลือก</span>;
  return (
    <Row>
      <b>{item.product_name}</b>
      <span className="muted">{`#${item.id} · ${money(item.product_price)}`}</span>
      <button type="button" className="btn btn-sm btn-light" onClick={onClear}>ล้าง</button>
    </Row>
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

  const defaultRxId = editing ? (o.final_prescription_id ?? null) : (rxList[0]?.id ?? null);
  const rxId = rxIdState === undefined ? defaultRxId : rxIdState;

  const picked = items ?? {
    frame: o.frame || null,
    lensOd: o.left_lens || null,
    lensOs: o.right_lens || null,
  };
  const setPicked = (patch) => setItems({ ...picked, ...patch });

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
  const discountTooHigh = n(p.discount) > total;
  const balance = netTotal - n(p.deposit);

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
    if (discountTooHigh) return err('ส่วนลดห้ามมากกว่ายอดรวม');

    body.customer_id = customerId;
    body.case_id = caseId;
    body.final_prescription_id = rxId;
    body.frame_product_id = picked.frame?.id ?? null;
    body.lens_product_id = picked.lensOd?.id ?? null;
    body.right_lens_product_id = picked.lensOs?.id ?? null;

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

        <Card title="เลือกผลวัดสายตา">
          {!contextCustomer && <span className="muted">เลือกลูกค้าก่อน</span>}
          {contextCustomer && rxList.length === 0 && (
            <div className="stack">
              <span className="muted">ยังไม่มีผลวัดสายตาให้เลือก</span>
              <Link
                className="btn btn-sm btn-accent"
                href={`/prescriptions/new?customer=${customerId}${caseId ? '&case=' + caseId : ''}`}
              >
                <Icon name="eye" /> วัดสายตาเลย
              </Link>
            </div>
          )}
          {contextCustomer && rxList.length > 0 && (
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
          <FormGrid>
            <Field label="พนักงานผู้ขาย / Employee">
              <EmployeeSelect name="employee_id" defaultValue={o.employee_id || ''} />
            </Field>
            <Field label="ช่องทางที่รู้จัก / Marketing">
              <ListSelect name="marketing" kind="marketing" defaultValue={o.marketing || ''} blank="—" />
            </Field>
          </FormGrid>
        </Card>

        <Card title="กรอบแว่น — Frame">
          <p className="hint">ถ้ายังไม่มีของในคลัง ให้ข้ามการเลือกสต็อกไปก่อน แล้วกรอกแค่รายละเอียดกรอบ</p>
          <StockPicker type="Frame" onPick={(r) => setPicked({ frame: r })} selectedId={picked.frame?.id ?? null} />
          <div style={{ marginTop: 8 }}><PickedItem item={picked.frame} onClear={() => setPicked({ frame: null })} /></div>
          <div style={{ marginTop: 10 }}>
            <FormGrid>
              <Field label="ชื่อกรอบ / Frame name">
                <input name="frame_name" defaultValue={o.frame_name || ''} placeholder="เช่น Coach 5191 / กรอบลูกค้า" />
              </Field>
              <Field label="ยี่ห้อ / Brand"><input name="frame_brand" defaultValue={o.frame_brand || ''} /></Field>
              <Field label="รุ่น / Model"><input name="frame_model" defaultValue={o.frame_model || ''} /></Field>
              <Field label="สี / Color"><input name="frame_color" defaultValue={o.frame_color || ''} /></Field>
              <Field label="ไซส์ / Size"><input name="frame_size" defaultValue={o.frame_size || ''} /></Field>
              <Field label="SKU"><input name="frame_sku" defaultValue={o.frame_sku || ''} /></Field>
            </FormGrid>
          </div>
        </Card>

        <Card title="เลนส์ — Lens">
          <p className="hint">ถ้ายังต้องสั่งเลนส์จากซัพพลายเออร์ ให้ข้ามการเลือกสต็อกไปก่อน</p>
          <Split>
            <Fieldset legend="เลนส์ขวา (OD)">
              <StockPicker type="Lens" onPick={(r) => setPicked({ lensOd: r })} selectedId={picked.lensOd?.id ?? null} />
              <div style={{ marginTop: 8 }}>
                <PickedItem item={picked.lensOd} onClear={() => setPicked({ lensOd: null })} />
              </div>
            </Fieldset>
            <Fieldset legend="เลนส์ซ้าย (OS)">
              <StockPicker type="Lens" onPick={(r) => setPicked({ lensOs: r })} selectedId={picked.lensOs?.id ?? null} />
              <div style={{ marginTop: 8 }}>
                <PickedItem item={picked.lensOs} onClear={() => setPicked({ lensOs: null })} />
              </div>
            </Fieldset>
          </Split>
          <div style={{ marginTop: 10 }}>
            <FormGrid>
              <Field label="ชื่อเลนส์ / Lens name">
                <input name="lens_name" defaultValue={o.lens_name || ''} placeholder="เช่น Hoya Blue 1.5 -+0.50" />
              </Field>
              <Field label="ยี่ห้อ / Brand"><input name="lens_brand" defaultValue={o.lens_brand || ''} /></Field>
              <Field label="ดีไซน์ / Design"><input name="lens_design" defaultValue={o.lens_design || ''} /></Field>
              <Field label="ค่าดัชนี / Index"><input name="lens_index" defaultValue={o.lens_index || ''} /></Field>
              <Field label="โค้ตติ้ง / Coating"><input name="lens_coating" defaultValue={o.lens_coating || ''} /></Field>
              <Field label="สี / Tint"><input name="lens_tint" defaultValue={o.lens_tint || ''} /></Field>
              <Field label="ออพชั่นเสริม / Add-ons" className="full">
                <input name="lens_addons" defaultValue={o.lens_addons || ''} />
              </Field>
            </FormGrid>
          </div>
        </Card>

        <Card title="ราคา & ส่วนลด">
          <FormGrid>
            <Field label="ราคากรอบ / FramePrice">
              <input
                name="frame_price" type="number" step="1" min="0"
                value={p.frame_price} onChange={(e) => setP({ frame_price: e.target.value })}
              />
            </Field>
            <Field label="ราคาเลนส์ขวา / LensOdPrice">
              <input
                name="lens_od_price" type="number" step="1" min="0"
                value={p.lens_od_price} onChange={(e) => setP({ lens_od_price: e.target.value })}
              />
            </Field>
            <Field label="ราคาเลนส์ซ้าย / LensOsPrice">
              <input
                name="lens_os_price" type="number" step="1" min="0"
                value={p.lens_os_price} onChange={(e) => setP({ lens_os_price: e.target.value })}
              />
            </Field>
            <Field label="ค่าออพชั่นเสริม / OptionsPrice">
              <input
                name="options_price" type="number" step="1" min="0"
                value={p.options_price} onChange={(e) => setP({ options_price: e.target.value })}
              />
            </Field>
          </FormGrid>

          <div style={{ marginTop: 10 }}>
            <Kpis>
              <Kpi label="ราคารวม (Total)" value={money(total)} sub="กรอบ + เลนส์ขวา + เลนส์ซ้าย + ออพชั่น" />
            </Kpis>
          </div>

          <div style={{ marginTop: 10 }}>
            <FormGrid>
              <Field
                label="ส่วนลด / Discount"
                hint={discountTooHigh ? 'ส่วนลดห้ามมากกว่ายอดรวม' : ''}
              >
                <input
                  name="discount" type="number" step="1" min="0"
                  value={p.discount} onChange={(e) => setP({ discount: e.target.value })}
                  aria-invalid={discountTooHigh}
                />
              </Field>
              <Field label="มัดจำ / Deposit">
                <input
                  name="deposit" type="number" step="1" min="0"
                  value={p.deposit} onChange={(e) => setP({ deposit: e.target.value })}
                />
              </Field>
              <Field label="ชำระมัดจำด้วย / DepositPayType">
                <ListSelect name="deposit_pay_type" kind="pay_type" defaultValue={o.deposit_pay_type || 'Cash'} />
              </Field>
            </FormGrid>
          </div>

          <div style={{ marginTop: 10 }}>
            <Kpis>
              <Kpi
                label="ยอดสุทธิ (Net Total)"
                value={money(netTotal)}
                kind={discountTooHigh ? 'danger' : 'accent'}
                sub={discountTooHigh ? 'ห้ามติดลบ — แก้ส่วนลดก่อนบันทึก' : 'ราคารวม − ส่วนลด'}
              />
              <Kpi label="คงเหลือรับตอนรับของ" value={money(balance)} sub="ยอดสุทธิ − มัดจำ" />
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
            <button className="btn btn-lg" type="submit" disabled={discountTooHigh}>
              <Icon name="save" /> {editing ? 'บันทึกการแก้ไข' : 'เปิดออเดอร์'}
            </button>
            {!embedded && <Link className="btn btn-light" href={cancelHref}>ยกเลิก</Link>}
          </FormActions>
        </Card>
      </form>
    </>
  );
}
