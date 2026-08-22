import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAsync, readForm } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import {
  Card, Field, Fieldset, FormActions, FormGrid, Loading, PageHead, Row, Split,
} from '../../components/ui.jsx';
import { Picker } from '../../components/Picker.jsx';
import { StockPicker } from '../../components/StockPicker.jsx';
import { EmployeeSelect, ListSelect } from '../../components/Selects.jsx';
import {
  custName, dateOnly, dtLocal, fmtDateTime, money, nowLocal, power, rxNum, todayISO, toStamp,
} from '../../lib/format.js';

export default function OrderForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { ok, err } = useToast();

  const queryCustomer = params.get('customer');
  const queryCase = params.get('case');
  const queryRx = params.get('eyetest');

  const { data, loading } = useAsync(async () => {
    const o = editing ? await api.get('/api/orders/' + id) : {};
    const cid = editing ? o.customer_id : (queryCustomer ? Number(queryCustomer) : null);
    const customer = cid ? await api.get('/api/customers/' + cid) : null;
    return { o, customer };
  }, [id, queryCustomer]);

  /* selections the form owns */
  const [customerOverride, setCustomerOverride] = useState(null);
  const [rxIdState, setRxId] = useState(undefined);
  const [items, setItems] = useState(undefined);
  const [totals, setTotals] = useState(undefined);

  if (loading) return <Loading />;

  const o = data.o;

  if (editing && Number(o.order_closed)) {
    return (
      <>
        <PageHead icon="👓" title="Custom Order" subtitle="แก้ไขออเดอร์" />
        <Card>
          <p>ออเดอร์นี้ปิดการขายแล้ว จึงแก้ไขไม่ได้</p>
          <Link className="btn btn-light" to={'/orders/' + o.id}>← กลับไปดูออเดอร์</Link>
        </Card>
      </>
    );
  }

  const customer = customerOverride ?? data.customer;
  const rxList = customer?.prescriptions || [];
  const caseId = editing ? o.case_id : (queryCase ? Number(queryCase) : null);

  const defaultRxId = editing
    ? o.final_prescription_id
    : (queryRx ? Number(queryRx) : (rxList[0]?.id ?? null));
  const rxId = rxIdState === undefined ? defaultRxId : rxIdState;

  const picked = items ?? {
    left: o.left_lens || null,
    right: o.right_lens || null,
    frame: o.frame || null,
  };
  const setPicked = (patch) => setItems({ ...picked, ...patch });

  const t = totals ?? {
    total: o.total_price ?? 0,
    discount: o.discount ?? 0,
    deposit: o.deposit ?? 0,
  };
  const setT = (patch) => setTotals({ ...t, ...patch });
  const balance = Number(t.total || 0) - Number(t.discount || 0) - Number(t.deposit || 0);

  const chooseCustomer = async (r) => {
    try {
      const full = await api.get('/api/customers/' + r.id);
      setCustomerOverride(full);
      setRxId(full.prescriptions?.[0]?.id ?? null);
    } catch (ex) {
      err(ex);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!customer) return err('กรุณาเลือกลูกค้าก่อน');
    const body = {
      ...readForm(e.currentTarget),
      customer_id: customer.id,
      case_id: caseId,
      final_prescription_id: rxId,
      lens_product_id: picked.left?.id ?? null,
      right_lens_product_id: picked.right?.id ?? null,
      frame_product_id: picked.frame?.id ?? null,
    };
    body.order_date = toStamp(body.order_date);
    try {
      const saved = editing
        ? await api.put('/api/orders/' + o.id, body)
        : await api.post('/api/orders', body);
      ok(editing ? 'บันทึกออเดอร์แล้ว' : 'เปิดออเดอร์ ' + saved.invoice_code + ' เรียบร้อย');
      navigate(caseId ? '/cases/' + caseId : '/orders/' + saved.id);
    } catch (ex) {
      err(ex);
    }
    return undefined;
  };

  return (
    <>
      <PageHead
        icon="👓"
        title="Custom Order"
        subtitle={editing ? 'แก้ไขออเดอร์ตัดแว่น' : 'เปิดออเดอร์ตัดแว่นใหม่'}
      />

      <Split>
        <Card
          title="เลือกลูกค้า"
          right={<Link className="btn btn-sm btn-light" to="/customers/new?next=order">+ ลูกค้าใหม่</Link>}
        >
          {customer ? (
            <Row>
              <span className="badge blue">#{customer.id}</span>
              <b>{custName(customer)}</b>
              <span className="muted">{customer.phone || ''}</span>
              <Link className="btn btn-sm btn-light" to={'/customers/' + customer.id}>ดูข้อมูล</Link>
            </Row>
          ) : <span className="muted">ยังไม่ได้เลือกลูกค้า</span>}
          <div style={{ marginTop: 10 }}>
            <Picker
              placeholder="ค้นหาลูกค้า (ชื่อ / เบอร์โทร / รหัส)"
              fetcher={(q) => api.get('/api/customers', { q, limit: 40 })}
              label={custName}
              sub={(r) => r.phone || ''}
              selectedId={customer?.id}
              onPick={chooseCustomer}
            />
          </div>
        </Card>

        <Card title="เลือกผลวัดสายตา">
          {!customer && <span className="muted">เลือกลูกค้าก่อน</span>}
          {customer && rxList.length === 0 && (
            <div className="stack">
              <span className="muted">ลูกค้ารายนี้ยังไม่มีผลวัดสายตา</span>
              <Link className="btn btn-sm btn-accent" to={`/prescriptions/new?customer=${customer.id}&next=order`}>
                👁 วัดสายตาเลย
              </Link>
            </div>
          )}
          {customer && rxList.length > 0 && (
            <div className="picker">
              {rxList.map((rx) => (
                <div
                  key={rx.id}
                  className={`p-row ${rx.id === rxId ? 'sel' : ''}`}
                  onClick={() => setRxId(rx.id)}
                >
                  <span className="p-main">
                    <b>{fmtDateTime(rx.test_date)}</b>
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

      <form onSubmit={save}>
        <Card title="รายละเอียดออเดอร์">
          <FormGrid>
            <Field label="พนักงานผู้ขาย / Employee">
              <EmployeeSelect name="employee_id" defaultValue={o.employee_id || ''} />
            </Field>
            <Field label="วันที่สั่ง / Order date">
              <input name="order_date" type="datetime-local" defaultValue={dtLocal(o.order_date) || nowLocal()} />
            </Field>
            <Field label="วันนัดรับ / Appointment">
              <input
                name="appointment_date"
                type="date"
                defaultValue={dateOnly(o.appointment_date) || todayISO(7)}
              />
            </Field>
            <Field label="ช่องทางที่รู้จัก / Marketing">
              <ListSelect name="marketing" kind="marketing" defaultValue={o.marketing || 'Walk-in'} />
            </Field>
            <Field label="ชื่อเลนส์ / LenName">
              <input
                name="lens_name"
                defaultValue={o.lens_name || ''}
                placeholder="เช่น Hoya Blue1.5-+0.50"
                key={'lens-' + (picked.left?.id || picked.right?.id || 'none')}
              />
            </Field>
            <Field label="ชื่อกรอบ / FrameName">
              <input
                name="frame_name"
                defaultValue={o.frame_name || ''}
                placeholder="เช่น Coach 5191 / กรอบลูกค้า"
                key={'frame-' + (picked.frame?.id || 'none')}
              />
            </Field>
          </FormGrid>
        </Card>

        <Card title="ราคา & การชำระเงิน">
          <FormGrid>
            <Field label="ราคารวม / TotalPrice">
              <input
                name="total_price" type="number" step="1" min="0"
                value={t.total} onChange={(e) => setT({ total: e.target.value })}
              />
            </Field>
            <Field label="ส่วนลด / Discount">
              <input
                name="discount" type="number" step="1" min="0"
                value={t.discount} onChange={(e) => setT({ discount: e.target.value })}
              />
            </Field>
            <Field
              label="มัดจำ / Deposit"
              hint={editing ? 'แก้ยอดมัดจำที่นี่จะไม่สร้างรายการรับเงิน — ใช้แท็บ "การเงิน" ในเคสแทน' : ''}
            >
              <input
                name="deposit" type="number" step="1" min="0"
                value={t.deposit} onChange={(e) => setT({ deposit: e.target.value })}
              />
            </Field>
            <Field label="ชำระมัดจำด้วย / DepositPayType">
              <ListSelect name="deposit_pay_type" kind="pay_type" defaultValue={o.deposit_pay_type || 'Cash'} />
            </Field>
            <div className="kpi accent">
              <div className="k-label">คงเหลือรับตอนรับของ</div>
              <div className="k-value">{money(balance)}</div>
              <div className="k-sub">ราคารวม − ส่วนลด − มัดจำ</div>
            </div>
          </FormGrid>
        </Card>

        <Card title="สินค้าที่ใช้ (ถ้ามีของในคลังแล้ว)">
          <p className="hint">
            ถ้ายังต้องสั่งเลนส์จากซัพพลายเออร์ ให้ข้ามส่วนนี้ไปก่อน
            แล้วค่อยใช้เมนู &quot;เติมของเข้าออเดอร์&quot; ตอนของมาถึง
          </p>
          <Split>
            <Fieldset legend="เลนส์ซ้าย — Left Lens">
              <StockPicker label="เลนส์ซ้าย" type="Lens" value={picked.left} onChange={(r) => setPicked({ left: r })} />
            </Fieldset>
            <Fieldset legend="เลนส์ขวา — Right Lens">
              <StockPicker label="เลนส์ขวา" type="Lens" value={picked.right} onChange={(r) => setPicked({ right: r })} />
            </Fieldset>
          </Split>
          <Fieldset legend="กรอบแว่น — Frame">
            <StockPicker label="กรอบแว่น" type="Frame" value={picked.frame} onChange={(r) => setPicked({ frame: r })} />
          </Fieldset>
        </Card>

        <Card title="หมายเหตุ">
          <textarea
            name="notes"
            defaultValue={o.notes || ''}
            placeholder="รายละเอียดเพิ่มเติม เช่น สีเลนส์ ทรงกรอบ การปรับขาแว่น"
          />
          <FormActions style={{ marginTop: 14 }}>
            <button className="btn btn-lg" type="submit">
              {editing ? '💾 บันทึกการแก้ไข' : '✔ Enter — เปิดออเดอร์'}
            </button>
            <Link className="btn btn-light" to={editing ? '/orders/' + o.id : '/orders'}>ยกเลิก</Link>
          </FormActions>
        </Card>
      </form>
    </>
  );
}
