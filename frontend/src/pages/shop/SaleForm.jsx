import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { readForm } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import { Card, Field, FormActions, FormGrid, Kv, PageHead, Split } from '../../components/ui.jsx';
import { Picker } from '../../components/Picker.jsx';
import { EmployeeSelect, ListSelect } from '../../components/Selects.jsx';
import { money, nowLocal, toStamp } from '../../lib/format.js';

export default function SaleForm() {
  const navigate = useNavigate();
  const { ok, err } = useToast();

  const [item, setItem] = useState(null);
  const [price, setPrice] = useState(0);
  const [discount, setDiscount] = useState(0);

  const net = Number(price || 0) - Number(discount || 0);

  const choose = (r) => {
    setItem(r);
    setPrice(r.product_price);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!item) return err('กรุณาเลือกสินค้าจากคลังก่อน');
    const body = { ...readForm(e.currentTarget), product_stock_id: item.id };
    body.sale_date = toStamp(body.sale_date);
    try {
      const saved = await api.post('/api/sales', body);
      ok('บันทึกการขาย ' + saved.invoice_code + ' เรียบร้อย');
      navigate('/sales');
    } catch (ex) {
      err(ex);
    }
    return undefined;
  };

  return (
    <>
      <PageHead icon="🛍" title="Product Sale" subtitle="ขายสินค้าทั่วไป" />

      <Split>
        <Card title="เลือกสินค้าจากคลัง">
          <Picker
            placeholder="ค้นหาสินค้าในคลัง (ชื่อ / รหัส)"
            fetcher={(q) => api.get('/api/stock', { q, sold: 0, limit: 40 })}
            label={(r) => r.product_name}
            sub={(r) => `${r.product_type} · ${money(r.product_price)}${r.location ? ' · ' + r.location : ''}`}
            selectedId={item?.id}
            onPick={choose}
          />
        </Card>

        <Card title="สินค้าที่เลือก">
          {item ? (
            <Kv rows={[
              ['รหัสสินค้า', '#' + item.id],
              ['ชื่อสินค้า', item.product_name],
              ['ประเภท', item.product_type],
              ['ราคาตั้ง', money(item.product_price)],
              ['ตำแหน่ง', item.location || '-'],
            ]}
            />
          ) : <span className="muted">เลือกสินค้าจากคลังทางซ้าย</span>}
        </Card>
      </Split>

      <form onSubmit={save}>
        <Card title="รายละเอียดการขาย">
          <FormGrid>
            <Field label="พนักงาน / Employee"><EmployeeSelect name="employee_id" defaultValue="" /></Field>
            <Field label="วันที่ขาย / SaleDate">
              <input name="sale_date" type="datetime-local" defaultValue={nowLocal()} />
            </Field>
            <Field label="ราคา / Price">
              <input
                name="price" type="number" step="1" min="0"
                value={price} onChange={(e) => setPrice(e.target.value)}
              />
            </Field>
            <Field label="ส่วนลด / Discount">
              <input
                name="discount" type="number" step="1" min="0"
                value={discount} onChange={(e) => setDiscount(e.target.value)}
              />
            </Field>
            <Field label="ชำระด้วย / PayType">
              <ListSelect name="pay_type" kind="pay_type" defaultValue="Cash" />
            </Field>
            <Field label="ช่องทาง / Marketing">
              <ListSelect name="marketing" kind="marketing" defaultValue="Walk-in" />
            </Field>
            <div className="kpi accent">
              <div className="k-label">ยอดสุทธิ</div>
              <div className="k-value">{money(net)}</div>
            </div>
          </FormGrid>

          <Field label="หมายเหตุ / Notes" className="full">
            <textarea name="notes" />
          </Field>

          <FormActions>
            <button className="btn btn-lg" type="submit">✔ Enter — บันทึกการขาย</button>
            <Link className="btn btn-light" to="/sales">ยกเลิก</Link>
          </FormActions>
        </Card>
      </form>
    </>
  );
}
