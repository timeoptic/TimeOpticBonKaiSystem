'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../lib/apiClient.js';
import { useAsync, useDebounced } from '../../../lib/hooks.js';
import { PAGE_SIZES } from '../../../lib/pager.js';
import {
  Card, Field, LinkTabs, Loading, OrderStatusBadge, PageHead, Toolbar,
} from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { Pager } from '../../../components/Pager.jsx';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { custName, fmtDate, fmtDateTime, money, sumBy } from '../../../lib/format.js';

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
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PAGE_SIZES[0]);

  const { data: rows, loading, error } = useAsync(
    () => api.get('/api/orders', { status, q: q.trim(), limit: 500 }),
    [status, q]
  );

  const all = rows || [];

  /* เปลี่ยนแท็บสถานะหรือคำค้น = ผลคนละชุด กลับไปหน้า 1 ไม่งั้นค้างอยู่หน้าที่ไม่มีอยู่จริง */
  useEffect(() => { setPage(1); }, [status, q, perPage]);

  /* ยอดท้ายตารางคิดจากผลค้นทั้งหมด ไม่ใช่เฉพาะหน้าที่เปิดอยู่ — คนเปิดหน้านี้มาดูว่า
     ทั้งตัวกรองนี้เป็นเงินเท่าไร ยอดที่ขยับทุกครั้งที่กดเลขหน้าคือคำตอบของคนละคำถาม */
  const totals = {
    total: sumBy(all, (o) => o.total_price),
    deposit: sumBy(all, (o) => o.deposit),
    discount: sumBy(all, (o) => o.discount),
    balance: sumBy(all, (o) => o.balance),
  };

  return (
    <div>
      <PageHead
        icon="glasses"
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
              { label: 'ID', key: 'id', cls: 'mono', mobile: 'meta' },
              { label: 'วันที่สั่ง', render: (o) => fmtDateTime(o.order_date), cls: 'nowrap', mobile: 'body' },
              { label: 'Invoice', key: 'invoice_code', cls: 'mono', mobile: 'title' },
              { label: 'ลูกค้า', render: custName, mobile: 'subtitle' },
              { label: 'พนักงาน', render: (o) => o.employee_name || '-', mobile: 'meta' },
              { label: 'เลนส์', key: 'lens_name', mobile: 'meta' },
              { label: 'กรอบ', key: 'frame_name', mobile: 'meta' },
              { label: 'ยอดรวม', render: (o) => money(o.total_price), cls: 'num', mobile: 'body' },
              { label: 'ส่วนลด', render: (o) => money(o.discount), cls: 'num', mobile: 'meta' },
              { label: 'รับแล้ว', render: (o) => money(o.paid), cls: 'num', mobile: 'meta' },
              { label: 'คงเหลือ', render: (o) => money(o.balance), cls: 'num', mobile: 'body' },
              { label: 'สถานะ', render: (o) => <OrderStatusBadge order={o} />, mobile: 'status' },
            ]}
            rows={all}
            page={page}
            perPage={perPage}
            onRowClick={(o) => router.push('/orders/detail?id=' + o.id)}
            empty="ไม่พบออเดอร์"
            footer={all.length ? (
              <tr>
                <td colSpan={7}>{`รวม ${all.length} ออเดอร์`}</td>
                <td className="num">{money(totals.total)}</td>
                <td className="num">{money(totals.discount)}</td>
                <td />
                <td className="num">{money(totals.balance)}</td>
                <td />
              </tr>
            ) : null}
          />

          <Pager
            total={all.length}
            page={page}
            perPage={perPage}
            onPage={setPage}
            onPerPage={setPerPage}
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
