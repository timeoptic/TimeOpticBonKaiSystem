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
      {/* หน้านี้อ่านอย่างเดียว — ค่าสายตาเกิดและถูกแก้ในเคสของมันเอง ที่นี่ไว้ค้นย้อนหลัง
          กดแถวแล้วไปที่เคสที่วัดใบนั้น ไม่ใช่ฟอร์มแก้ใบเดี่ยว ๆ */}
      <PageHead
        icon="👁"
        title="Prescriptions"
        subtitle="ประวัติการวัดสายตา — กดแถวเพื่อเปิดเคสที่วัดใบนั้น"
        actions={<Link className="btn btn-ghost" href="/exam"><Icon name="eye" /> ขั้นวัดสายตา</Link>}
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
            /* ใบเก่าจากระบบเดิมบางใบไม่ผูกเคส — พาไปที่ลูกค้าแทน ดีกว่าคลิกแล้วไม่มีอะไรเกิด */
            onRowClick={(t) => router.push(t.case_id
              ? `/cases/detail?id=${t.case_id}&step=exam`
              : `/customers/detail?id=${t.customer_id}`)}
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
