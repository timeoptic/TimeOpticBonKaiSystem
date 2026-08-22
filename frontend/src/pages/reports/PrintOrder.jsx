import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAsync } from '../../lib/hooks.js';
import { Card, Kv, Loading, PageHead, PrintButton } from '../../components/ui.jsx';
import { RxTable } from '../../components/RxTable.jsx';
import { SHOP } from '../../lib/constants.js';
import { custName, fmtDate, fmtDateTime, money } from '../../lib/format.js';

export default function PrintOrder() {
  const { id } = useParams();
  const { data: o, loading, error } = useAsync(() => api.get('/api/reports/order/' + id), [id]);

  if (loading) return <Loading />;
  if (error) return <Card><p className="muted">{error.message}</p></Card>;

  const t = o.prescription;
  const lensIds = [o.lens_product_id, o.right_lens_product_id].filter(Boolean).join(' / ') || '-';
  const closed = Number(o.order_closed);

  return (
    <>
      <PageHead
        icon="🖨"
        title="ใบสั่งตัดแว่น"
        subtitle={o.invoice_code}
        actions={(
          <>
            <PrintButton />
            <Link className="btn btn-ghost no-print" to={'/orders/' + o.id}>← กลับ</Link>
          </>
        )}
      />

      <div className="paper">
        <div className="doc-head">
          <div>
            <h1>{SHOP.name}</h1>
            <div className="shop">{SHOP.tagline}</div>
            <div className="shop">{SHOP.line2}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h1 style={{ fontSize: 19 }}>ใบสั่งตัดแว่น</h1>
            <div className="shop">{'Invoice: ' + o.invoice_code}</div>
            <div className="shop">{'วันที่: ' + fmtDateTime(o.order_date)}</div>
            <div className="shop">{'นัดรับ: ' + (fmtDate(o.appointment_date) || '-')}</div>
          </div>
        </div>

        <Kv
          style={{ marginBottom: 14 }}
          rows={[
            ['ลูกค้า', custName(o)],
            ['เบอร์โทร', o.phone || '-'],
            ['พนักงาน', o.employee_name || '-'],
          ]}
        />

        <h3 style={{ margin: '14px 0 0', fontSize: 14 }}>ค่าสายตา — Prescription</h3>
        {t ? <RxTable t={t} /> : <p className="muted">ไม่มีข้อมูลการวัดสายตาผูกกับออเดอร์นี้</p>}

        <h3 style={{ margin: 0, fontSize: 14 }}>รายการสินค้า</h3>
        <table className="doc">
          <thead>
            <tr><th>รายการ</th><th>รายละเอียด</th><th>รหัสสินค้า</th></tr>
          </thead>
          <tbody>
            <tr><td>เลนส์</td><td>{o.lens_name || '-'}</td><td>{lensIds}</td></tr>
            <tr><td>กรอบ</td><td>{o.frame_name || '-'}</td><td>{o.frame_product_id || '-'}</td></tr>
          </tbody>
        </table>

        <table className="doc">
          <tbody>
            <tr><td className="lbl" style={{ width: 'auto' }}>ราคารวม</td><td>{money(o.total_price)}</td></tr>
            <tr><td className="lbl" style={{ width: 'auto' }}>ส่วนลด</td><td>{money(o.discount)}</td></tr>
            <tr>
              <td className="lbl" style={{ width: 'auto' }}>{`มัดจำ (${o.deposit_pay_type})`}</td>
              <td>{money(o.deposit)}</td>
            </tr>
            <tr>
              <td className="lbl" style={{ width: 'auto' }}>
                {closed ? 'รับเมื่อปิดการขาย' : 'คงเหลือชำระ'}
              </td>
              <td><b>{money(closed ? o.order_close_income : o.balance)}</b></td>
            </tr>
          </tbody>
        </table>

        {o.notes ? <p><b>หมายเหตุ: </b>{o.notes}</p> : null}

        <div className="sign">
          <div><div className="line" />ลายเซ็นลูกค้า</div>
          <div><div className="line" />ผู้รับออเดอร์</div>
        </div>
      </div>
    </>
  );
}
