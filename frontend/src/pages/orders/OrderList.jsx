import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAsync, useDebounced } from '../../lib/hooks.js';
import {
  Card, Field, LinkTabs, Loading, OrderStatusBadge, PageHead, Toolbar,
} from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { custName, fmtDate, fmtDateTime, money, sumBy } from '../../lib/format.js';

const STATUS_TABS = [
  ['/orders?status=all', 'ทั้งหมด'],
  ['/orders?status=unfilled', 'รอของ (Unfilled)'],
  ['/orders?status=unclosed', 'รอลูกค้ารับ (Unclosed)'],
  ['/orders?status=closed', 'ปิดการขายแล้ว'],
];

export default function OrderList() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const status = params.get('status') || 'all';

  const [term, setTerm] = useState(params.get('q') || '');
  const [from, setFrom] = useState(params.get('from') || '');
  const [to, setTo] = useState(params.get('to') || '');
  const q = useDebounced(term);

  const { data: rows, loading, error } = useAsync(
    () => api.get('/api/orders', { status, q: q.trim(), from, to, limit: 500 }),
    [status, q, from, to]
  );

  const clear = () => { setTerm(''); setFrom(''); setTo(''); };

  const totals = rows ? {
    total: sumBy(rows, (o) => o.total_price),
    deposit: sumBy(rows, (o) => o.deposit),
    discount: sumBy(rows, (o) => o.discount),
    income: sumBy(rows, (o) => o.order_close_income),
  } : null;

  return (
    <div>
      <PageHead
        icon="👓"
        title="Order History"
        subtitle="ประวัติการสั่งตัดแว่น"
        actions={<Link className="btn btn-ghost" to="/orders/new">+ เปิดออเดอร์ใหม่</Link>}
      />

      <LinkTabs items={STATUS_TABS} isActive={(to_) => to_.endsWith('=' + status)} />

      <Toolbar>
        <Field label="ค้นหา" className="grow">
          <input
            type="search"
            placeholder="ชื่อลูกค้า / เบอร์ / Invoice / เลนส์ / กรอบ"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </Field>
        <Field label="ตั้งแต่วันที่">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="ถึงวันที่">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <button type="button" className="btn btn-light" onClick={clear}>ล้างตัวกรอง</button>
      </Toolbar>

      {loading && <Loading text="กำลังค้นหา…" />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (
        <Card tight>
          <DataTable
            columns={[
              { label: 'ID', key: 'id', cls: 'mono' },
              { label: 'วันที่สั่ง', render: (o) => fmtDateTime(o.order_date), cls: 'nowrap' },
              { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
              { label: 'ลูกค้า', render: custName },
              { label: 'พนักงาน', render: (o) => o.employee_name || '-' },
              { label: 'เลนส์', key: 'lens_name' },
              { label: 'กรอบ', key: 'frame_name' },
              { label: 'นัดรับ', render: (o) => fmtDate(o.appointment_date), cls: 'nowrap' },
              { label: 'ยอดรวม', render: (o) => money(o.total_price), cls: 'num' },
              { label: 'มัดจำ', render: (o) => money(o.deposit), cls: 'num' },
              { label: 'ส่วนลด', render: (o) => money(o.discount), cls: 'num' },
              { label: 'รับเมื่อปิด', render: (o) => money(o.order_close_income), cls: 'num' },
              { label: 'สถานะ', render: (o) => <OrderStatusBadge order={o} /> },
            ]}
            rows={rows}
            onRowClick={(o) => navigate('/orders/' + o.id)}
            empty="ไม่พบออเดอร์"
            footer={rows.length ? (
              <tr>
                <td colSpan={8}>{`รวม ${rows.length} ออเดอร์`}</td>
                <td className="num">{money(totals.total)}</td>
                <td className="num">{money(totals.deposit)}</td>
                <td className="num">{money(totals.discount)}</td>
                <td className="num">{money(totals.income)}</td>
                <td />
              </tr>
            ) : null}
          />
        </Card>
      )}
    </div>
  );
}
