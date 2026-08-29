'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync, useDebounced } from '../../lib/hooks.js';
import { Card, Field, Loading, PageHead, Toolbar } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { QueryParamPage } from '../../components/QueryParamPage.jsx';
import { Icon } from '../../components/Icon.jsx';

function CustomerListInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [term, setTerm] = useState(params.get('q') || '');
  const q = useDebounced(term);

  const { data: rows, loading, error } = useAsync(
    () => api.get('/api/customers', { q: q.trim(), limit: 300 }),
    [q]
  );

  return (
    <div>
      <PageHead
        icon="👥"
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
              { label: 'ID', key: 'id', cls: 'mono' },
              { label: 'ชื่อ', key: 'first_name' },
              { label: 'นามสกุล', key: 'last_name' },
              { label: 'เพศ', key: 'sex' },
              { label: 'สัญชาติ', key: 'nationality' },
              { label: 'เบอร์โทร', key: 'phone', cls: 'nowrap' },
              { label: 'LINE / WhatsApp', key: 'line_id', cls: 'nowrap' },
              { label: 'อีเมล', key: 'email' },
              {
                label: '',
                cls: 'nowrap',
                render: (r) => (
                  <>
                    <Link className="btn btn-sm btn-accent" href={`/cases/new?customer=${r.id}`}><Icon name="board" /> เปิดเคส</Link>
                    {' '}
                    <Link className="btn btn-sm btn-light" href={`/prescriptions/new?customer=${r.id}`}><Icon name="eye" /></Link>
                  </>
                ),
              },
            ]}
            rows={rows}
            onRowClick={(r) => router.push('/customers/detail?id=' + r.id)}
            empty="ไม่พบลูกค้า"
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
