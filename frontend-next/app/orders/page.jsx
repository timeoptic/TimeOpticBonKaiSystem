'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync, useDebounced } from '../../lib/hooks.js';
import {
  Card, Field, LinkTabs, Loading, OrderStatusBadge, PageHead, Toolbar,
} from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { QueryParamPage } from '../../components/QueryParamPage.jsx';
import { custName, fmtDate, fmtDateTime, money, sumBy } from '../../lib/format.js';

const STATUS_TABS = [
  ['/orders?status=all', 'ทั้งหมด'],
  ['/orders?status=unfilled', 'รอของ (Unfilled)'],
  ['/orders?status=unclosed', 'รอลูกค้ารับ (Unclosed)'],
  ['/orders?status=closed', 'ปิดการขายแล้ว'],
];

function OrderListInner() {
  const router = useRouter();
  const params = useSearchParams();
  const status = params.get('status') || 'all';
  const [term, setTerm] = useState(params.get('q') || '');
  const q = useDebounced(term);

  const { data: rows, loading, error } = useAsync(
    () => api.get('/api/orders', { status, q: q.trim(), limit: 500 }),
    [status, q]
  );

  const totals = rows ? {
    total: sumBy(rows, (o) => o.total_price),
    deposit: sumBy(rows, (o) => o.deposit),
    discount: sumBy(rows, (o) => o.discount),
    balance: sumBy(rows, (o) => o.balance),
  } : null;

  return (
    <div>
      <PageHead
        icon="👓"
        title="Order History"
        subtitle="ประวัติการสั่งตัดแว่น"
        actions={<Link className="btn btn-ghost" href="/orders/new">+ เปิดออเดอร์ใหม่</Link>}
      />

      <LinkTabs items={STATUS_TABS} isActive={(to) => to.endsWith('=' + status)} />

      <Toolbar>
        <Field label="ค้นหา" className="grow">
          <input
            type="search"
            autoFocus
            placeholder="ชื่อลูกค้า / เบอร์ / Invoice / เลนส์ / กรอบ"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </Field>
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
              { label: 'ยอดรวม', render: (o) => money(o.total_price), cls: 'num' },
              { label: 'ส่วนลด', render: (o) => money(o.discount), cls: 'num' },
              { label: 'รับแล้ว', render: (o) => money(o.paid), cls: 'num' },
              { label: 'คงเหลือ', render: (o) => money(o.balance), cls: 'num' },
              { label: 'สถานะ', render: (o) => <OrderStatusBadge order={o} /> },
            ]}
            rows={rows}
            onRowClick={(o) => router.push('/orders/detail?id=' + o.id)}
            empty="ไม่พบออเดอร์"
            footer={rows.length ? (
              <tr>
                <td colSpan={7}>{`รวม ${rows.length} ออเดอร์`}</td>
                <td className="num">{money(totals.total)}</td>
                <td className="num">{money(totals.discount)}</td>
                <td />
                <td className="num">{money(totals.balance)}</td>
                <td />
              </tr>
            ) : null}
          />
        </Card>
      )}
    </div>
  );
}

export default function OrderListPage() {
  return (
    <QueryParamPage>
      <OrderListInner />
    </QueryParamPage>
  );
}
