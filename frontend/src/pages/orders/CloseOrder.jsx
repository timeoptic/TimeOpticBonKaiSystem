import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAsync, readForm } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import { Card, Field, FormActions, FormGrid, Kv, Loading, PageHead } from '../../components/ui.jsx';
import { EmployeeSelect, ListSelect } from '../../components/Selects.jsx';
import { custName, money, nowLocal, toStamp } from '../../lib/format.js';

export default function CloseOrder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { ok, err } = useToast();

  const { data: o, loading } = useAsync(() => api.get('/api/orders/' + id), [id]);

  if (loading) return <Loading />;

  if (Number(o.order_closed)) {
    return (
      <>
        <PageHead icon="✅" title="Close Order" subtitle="ปิดการขาย" />
        <Card>
          <p>ออเดอร์นี้ปิดการขายไปแล้ว</p>
          <Link className="btn btn-light" to={'/orders/' + o.id}>← กลับ</Link>
        </Card>
      </>
    );
  }

  const unfilled = !o.left_lens || !o.right_lens || !o.frame;

  const save = async (e) => {
    e.preventDefault();
    const body = readForm(e.currentTarget);
    body.order_close_date = toStamp(body.order_close_date);
    try {
      await api.post(`/api/orders/${o.id}/close`, body);
      ok('ปิดการขายเรียบร้อย');
      navigate('/orders/' + o.id);
    } catch (ex) {
      err(ex);
    }
  };

  return (
    <>
      <PageHead icon="✅" title="Close Order" subtitle="ปิดการขาย" />
      <form onSubmit={save}>
        <Card title="ปิดการขาย — Close Order">
          {unfilled && (
            <p
              className="badge warn"
              style={{ display: 'block', padding: '10px 14px', marginBottom: 12 }}
            >
              ⚠ ยังเติมสินค้าไม่ครบ — ปิดได้ แต่แนะนำให้เติมของก่อนเพื่อให้ตัดสต็อกถูกต้อง
            </p>
          )}

          <Kv
            style={{ marginBottom: 16 }}
            rows={[
              ['Invoice', o.invoice_code],
              ['ลูกค้า', custName(o)],
              ['ราคารวม', money(o.total_price)],
              ['ส่วนลด', money(o.discount)],
              ['มัดจำที่รับแล้ว', money(o.deposit)],
              ['คงเหลือ', <b>{money(o.balance)}</b>],
            ]}
          />

          <FormGrid>
            <Field label="รับเงินเพิ่ม / OrderCloseIncome">
              <input name="order_close_income" type="number" step="1" defaultValue={o.balance} />
            </Field>
            <Field label="ชำระด้วย / PayType">
              <ListSelect name="order_close_pay_type" kind="pay_type" defaultValue="Cash" />
            </Field>
            <Field label="พนักงานผู้ปิดการขาย">
              <EmployeeSelect name="order_close_employee_id" defaultValue={o.employee_id || ''} />
            </Field>
            <Field label="วันเวลาที่ปิด">
              <input name="order_close_date" type="datetime-local" defaultValue={nowLocal()} />
            </Field>
          </FormGrid>

          <Field label="หมายเหตุ" className="full">
            <textarea name="notes" defaultValue={o.notes || ''} />
          </Field>

          <p className="hint">
            เมื่อปิดการขาย ระบบจะตัดสต็อกเลนส์ซ้าย/ขวา และกรอบที่ผูกกับออเดอร์นี้ให้อัตโนมัติ
          </p>

          <FormActions>
            <button className="btn btn-lg btn-ok" type="submit">✅ ปิดการขาย</button>
            <Link className="btn btn-light" to={'/orders/' + o.id}>ยกเลิก</Link>
          </FormActions>
        </Card>
      </form>
    </>
  );
}
