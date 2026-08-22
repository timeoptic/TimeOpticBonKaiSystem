import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAsync } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/Confirm.jsx';
import {
  Badge, Card, Kv, Loading, OrderStatusBadge, PageHead, Row, Split, Stack,
} from '../../components/ui.jsx';
import { RxTable } from '../../components/RxTable.jsx';
import { custName, fmtDate, fmtDateTime, money } from '../../lib/format.js';

/** one physical item line inside the order's key/value list */
const itemValue = (s) => (s
  ? <>{s.product_name} <span className="muted">{`#${s.id} · ${money(s.product_price)}`}</span></>
  : <Badge kind="warn">ยังไม่ได้เติม</Badge>);

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { ok, err } = useToast();
  const confirm = useConfirm();

  const { data: o, loading, error, reload } = useAsync(() => api.get('/api/orders/' + id), [id]);

  if (loading) return <Loading />;
  if (error) return <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>;

  const t = o.prescription;
  const closed = Number(o.order_closed);

  const reopen = async () => {
    if (!await confirm('เปิดออเดอร์อีกครั้ง',
      'ระบบจะยกเลิกการปิดการขาย และคืนสินค้ากลับเข้าคลัง', { confirmText: 'เปิดใหม่' })) return;
    try {
      await api.post(`/api/orders/${o.id}/reopen`);
      ok('เปิดออเดอร์อีกครั้งแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const remove = async () => {
    if (!await confirm('ลบออเดอร์', `ลบออเดอร์ ${o.invoice_code}?`, { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del('/api/orders/' + o.id);
      ok('ลบแล้ว');
      navigate('/orders');
    } catch (ex) { err(ex); }
  };

  return (
    <div>
      <PageHead
        icon="👓"
        title={o.invoice_code}
        subtitle={custName(o)}
        actions={(
          <>
            {!closed && <Link className="btn btn-ghost" to={`/orders/${o.id}/fill`}>📦 เติมของ</Link>}
            {!closed && <Link className="btn btn-ghost" to={`/orders/${o.id}/close`}>✅ ปิดการขาย</Link>}
            {!closed && <Link className="btn btn-ghost" to={`/orders/${o.id}/edit`}>✎ แก้ไข</Link>}
            <Link className="btn btn-ghost" to={'/print/order/' + o.id}>🖨 ใบสั่งตัดแว่น</Link>
            {t && <Link className="btn btn-ghost" to={'/print/prescription/' + t.id}>🖨 ใบวัดสายตา</Link>}
            {o.case_id && (
              <Link className="btn btn-ghost" to={'/cases/' + o.case_id}>🗂 {o.case_code || 'เคส'}</Link>
            )}
          </>
        )}
      />

      <Split>
        <Card title="ข้อมูลออเดอร์">
          <Row style={{ marginBottom: 12 }}><OrderStatusBadge order={o} /></Row>
          <Kv rows={[
            ['รหัสออเดอร์', '#' + o.id],
            ['Invoice', o.invoice_code],
            ['ลูกค้า', (
              <>
                <Link to={'/customers/' + o.customer_id}>{custName(o)}</Link>
                {o.phone ? ` · ${o.phone}` : ''}
              </>
            )],
            ['พนักงาน', o.employee_name || '-'],
            ['วันที่สั่ง', fmtDateTime(o.order_date)],
            ['วันนัดรับ', fmtDate(o.appointment_date) || '-'],
            ['ช่องทาง', o.marketing || '-'],
            ['เลนส์', o.lens_name || '-'],
            ['กรอบ', o.frame_name || '-'],
            ['เลนส์ซ้าย (stock)', itemValue(o.left_lens)],
            ['เลนส์ขวา (stock)', itemValue(o.right_lens)],
            ['กรอบ (stock)', itemValue(o.frame)],
            ['หมายเหตุ', o.notes || '-'],
          ]}
          />
        </Card>

        <Stack>
          <Card title="ยอดเงิน">
            <Kv rows={[
              ['ราคารวม', money(o.total_price)],
              ['ส่วนลด', money(o.discount)],
              ['มัดจำ', `${money(o.deposit)} (${o.deposit_pay_type || '-'})`],
              ['รับเงินแล้วรวม', money(o.paid)],
              ['คงเหลือ', <b>{money(o.balance)}</b>],
            ]}
            />
            {closed ? (
              <Kv
                style={{ marginTop: 10 }}
                rows={[
                  ['ปิดเมื่อ', fmtDateTime(o.order_close_date)],
                  ['ผู้ปิด', o.close_employee_name || '-'],
                  ['ชำระด้วย', o.order_close_pay_type],
                ]}
              />
            ) : null}
          </Card>

          {t && (
            <Card title="ผลวัดสายตาที่ใช้">
              <RxTable t={t} />
              <p className="hint">
                {`วัดเมื่อ ${fmtDateTime(t.test_date)}${t.test_for ? ' · ' + t.test_for : ''}`}
              </p>
            </Card>
          )}

          <Card title="การจัดการ">
            <Row>
              {closed
                ? <button type="button" className="btn btn-light" onClick={reopen}>↩ เปิดออเดอร์อีกครั้ง</button>
                : <button type="button" className="btn btn-danger" onClick={remove}>🗑 ลบออเดอร์</button>}
            </Row>
          </Card>
        </Stack>
      </Split>
    </div>
  );
}
