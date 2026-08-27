'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync, useDebounced } from '../../lib/hooks.js';
import { Badge, Card, Field, Loading, PageHead, Toolbar } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { QueryParamPage } from '../../components/QueryParamPage.jsx';
import { custName, fmtDateTime, power, rxNum } from '../../lib/format.js';
import { Icon } from '../../components/Icon.jsx';

function PrescriptionListInner() {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const q = useDebounced(term);

  const { data: rows, loading, error } = useAsync(
    () => api.get('/api/prescriptions', { q: q.trim(), limit: 300 }),
    [q]
  );

  return (
    <div>
      <PageHead
        icon="👁"
        title="Prescriptions"
        subtitle="ประวัติการวัดสายตา"
        actions={<Link className="btn btn-ghost" href="/prescriptions/new">+ วัดสายตาใหม่</Link>}
      />

      <Toolbar>
        <Field label="ค้นหา" className="grow">
          <input
            type="search"
            placeholder="ค้นหาด้วย ชื่อลูกค้า / เบอร์โทร / รหัส"
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
              { label: 'วันที่วัด', render: (t) => fmtDateTime(t.test_date), cls: 'nowrap' },
              { label: 'ชนิด', render: (t) => <Badge kind={t.kind === 'final' ? 'ok' : 'gray'}>{t.kind}</Badge> },
              { label: 'ลูกค้า', render: custName },
              { label: 'เบอร์โทร', key: 'phone', cls: 'nowrap' },
              { label: 'R Sph', render: (t) => power(t.r_sphere), cls: 'num' },
              { label: 'R Cyl', render: (t) => power(t.r_cylinder), cls: 'num' },
              { label: 'R Axis', render: (t) => rxNum(t.r_axis), cls: 'num' },
              { label: 'L Sph', render: (t) => power(t.l_sphere), cls: 'num' },
              { label: 'L Cyl', render: (t) => power(t.l_cylinder), cls: 'num' },
              { label: 'L Axis', render: (t) => rxNum(t.l_axis), cls: 'num' },
              { label: 'ใช้สำหรับ', key: 'test_for' },
              { label: 'ผู้วัด', key: 'employee_name' },
              {
                label: '',
                cls: 'nowrap',
                render: (t) => <Link className="btn btn-sm btn-light" href={'/print/prescription?id=' + t.id}><Icon name="printer" /></Link>,
              },
            ]}
            rows={rows}
            onRowClick={(t) => router.push('/prescriptions/edit?id=' + t.id)}
            empty="ไม่พบข้อมูล"
          />
        </Card>
      )}
    </div>
  );
}

export default function PrescriptionListPage() {
  return (
    <QueryParamPage>
      <PrescriptionListInner />
    </QueryParamPage>
  );
}
