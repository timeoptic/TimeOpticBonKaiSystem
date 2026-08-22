import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAsync, readForm } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import {
  Card, Field, Fieldset, FormActions, FormGrid, Kv, Loading, PageHead, Split,
} from '../../components/ui.jsx';
import { StockPicker } from '../../components/StockPicker.jsx';
import { custName, dateOnly, fmtDateTime, money } from '../../lib/format.js';

export default function FillOrder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { ok, err } = useToast();

  const { data: o, loading } = useAsync(() => api.get('/api/orders/' + id), [id]);
  const [items, setItems] = useState(undefined);

  if (loading) return <Loading />;

  if (Number(o.order_closed)) {
    return (
      <>
        <PageHead icon="📦" title="Fill Order" subtitle="เติมของเข้าออเดอร์" />
        <Card>
          <p>ออเดอร์นี้ปิดการขายแล้ว</p>
          <Link className="btn btn-light" to={'/orders/' + o.id}>← กลับ</Link>
        </Card>
      </>
    );
  }

  const picked = items ?? { left: o.left_lens, right: o.right_lens, frame: o.frame };
  const setPicked = (patch) => setItems({ ...picked, ...patch });

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/api/orders/${o.id}/fill`, {
        ...readForm(e.currentTarget),
        lens_product_id: picked.left?.id ?? null,
        right_lens_product_id: picked.right?.id ?? null,
        frame_product_id: picked.frame?.id ?? null,
      });
      ok('เติมของเข้าออเดอร์เรียบร้อย');
      navigate('/orders/' + o.id);
    } catch (ex) {
      err(ex);
    }
  };

  return (
    <>
      <PageHead icon="📦" title="Fill Order" subtitle="เติมของเข้าออเดอร์" />
      <form onSubmit={save}>
        <Card title="ออเดอร์">
          <Kv rows={[
            ['Invoice', o.invoice_code],
            ['ลูกค้า', custName(o)],
            ['วันที่สั่ง', fmtDateTime(o.order_date)],
            ['ยอดรวม', money(o.total_price)],
            ['คงเหลือ', money(o.balance)],
          ]}
          />
        </Card>

        <Card title="เลือกสินค้าจริงจากคลัง">
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

          <FormGrid>
            <Field label="ชื่อเลนส์ที่แสดงบนใบสั่ง">
              <input
                name="lens_name"
                defaultValue={o.lens_name || ''}
                key={'lens-' + (picked.left?.id || picked.right?.id || 'none')}
              />
            </Field>
            <Field label="ชื่อกรอบที่แสดงบนใบสั่ง">
              <input name="frame_name" defaultValue={o.frame_name || ''} key={'frame-' + (picked.frame?.id || 'none')} />
            </Field>
            <Field label="วันนัดรับ">
              <input name="appointment_date" type="date" defaultValue={dateOnly(o.appointment_date)} />
            </Field>
          </FormGrid>

          <Field label="หมายเหตุ" className="full">
            <textarea name="notes" defaultValue={o.notes || ''} />
          </Field>

          <FormActions>
            <button className="btn btn-lg" type="submit">✔ บันทึกการเติมของ</button>
            <Link className="btn btn-light" to={'/orders/' + o.id}>ยกเลิก</Link>
          </FormActions>
        </Card>
      </form>
    </>
  );
}
