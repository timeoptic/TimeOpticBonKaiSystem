'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../lib/apiClient.js';
import { useAsync, useDebounced } from '../../../lib/hooks.js';
import { PAGE_SIZES } from '../../../lib/pager.js';
import { Card, Field, Loading, PageHead, Toolbar } from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { Pager } from '../../../components/Pager.jsx';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { Icon } from '../../../components/Icon.jsx';

function CustomerListInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [term, setTerm] = useState(params.get('q') || '');
  const q = useDebounced(term);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PAGE_SIZES[0]);

  const { data: rows, loading, error } = useAsync(
    () => api.get('/api/customers', { q: q.trim(), limit: 300 }),
    [q]
  );

  const all = rows || [];

  /* คำค้นใหม่คือผลคนละชุด — ค้างอยู่หน้า 7 ของผลเก่าแล้วเจอตารางโล่งอ่านเหมือนค้นไม่เจอ */
  useEffect(() => { setPage(1); }, [q, perPage]);

  return (
    <div>
      <PageHead
        icon="users"
        title="Customer Search"
        subtitle="ค้นหาข้อมูลลูกค้า"
        actions={<Link className="btn btn-ghost" href="/customers/new">+ ลูกค้าใหม่</Link>}
      />

      <Toolbar>
        <Field label="ค้นหา" className="grow">
          <input
            type="search"
            autoFocus
            placeholder="ค้นหา ชื่อ / นามสกุล / เบอร์โทร / LINE / WhatsApp / อีเมล / รหัสลูกค้า"
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
              { label: 'ชื่อ', key: 'first_name', mobile: 'title' },
              /* ตารางนี้แยกคอลัมน์อยู่แล้ว ชื่อกลางจึงเป็นคอลัมน์ของตัวเอง
                 ไม่ใช่เอา custName มายัดรวม — คนกวาดตาหาสกุลจะได้อยู่ตำแหน่งเดิม */
              { label: 'ชื่อกลาง', key: 'mid_name', mobile: 'title' },
              { label: 'นามสกุล', key: 'last_name', mobile: 'title' },
              { label: 'เพศ', key: 'sex', mobile: 'meta' },
              { label: 'สัญชาติ', key: 'nationality', mobile: 'meta' },
              { label: 'เบอร์โทร', key: 'phone', cls: 'nowrap', mobile: 'subtitle' },
              { label: 'LINE / WhatsApp', key: 'line_id', cls: 'nowrap', mobile: 'body' },
              { label: 'อีเมล', key: 'email', mobile: 'body' },
              {
                label: '',
                cls: 'nowrap',
                mobile: 'extra',
                render: (r) => (
                  <Link className="btn btn-sm btn-accent" href={`/cases/new?customer=${r.id}`}><Icon name="board" /> เปิดเคส</Link>
                ),
              },
            ]}
            rows={all}
            page={page}
            perPage={perPage}
            onRowClick={(r) => router.push('/customers/detail?id=' + r.id)}
            empty="ไม่พบลูกค้า"
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

export default function CustomerListPage() {
  return (
    <QueryParamPage>
      <CustomerListInner />
    </QueryParamPage>
  );
}
