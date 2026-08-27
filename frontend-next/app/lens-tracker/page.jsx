'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync } from '../../lib/hooks.js';
import { Badge, Card, Check, Field, Loading, PageHead, Toolbar } from '../../components/ui.jsx';
import { QueryParamPage } from '../../components/QueryParamPage.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Select } from '../../components/Selects.jsx';
import { custName, fmtDate } from '../../lib/format.js';
import { Icon } from '../../components/Icon.jsx';

const RISKS = [['', 'ทุกระดับ'], ['late', 'เลย ETA'], ['soon', 'ใกล้ถึง'], ['ok', 'ปกติ']];

function LensTrackerInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [risk, setRisk] = useState(params.get('risk') || '');
  const [threat, setThreat] = useState(false);

  const { data: rows, loading, error, reload } = useAsync(
    () => api.get('/api/lens-tracker', { risk, threatens: threat ? 1 : '' }),
    [risk, threat]
  );

  return (
    <div>
      <PageHead
        icon="🔎"
        title="Lens Tracker"
        subtitle="ติดตามเลนส์ที่สั่งซัพพลายเออร์"
        actions={<Link className="btn btn-ghost" href="/cases"><Icon name="arrowLeft" /> กระดานงาน</Link>}
      />

      <Toolbar>
        <Field label="ระดับความเสี่ยง">
          <Select options={RISKS} value={risk} onChange={(e) => setRisk(e.target.value)} />
        </Field>
        <Check checked={threat} onChange={(e) => setThreat(e.target.checked)}>เฉพาะที่กระทบวันนัด</Check>
        <button type="button" className="btn btn-light" onClick={reload}><Icon name="refresh" /> รีเฟรช</button>
      </Toolbar>

      {loading && <Loading />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (
        <Card tight>
          <DataTable
            columns={[
              { label: 'เคส', key: 'case_code', cls: 'mono' },
              { label: '', render: (r) => (Number(r.is_rush) ? <Badge kind="danger"><Icon name="flame" /></Badge> : '') },
              { label: 'ลูกค้า', render: custName },
              { label: 'เบอร์', key: 'phone', cls: 'nowrap' },
              { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
              { label: 'เลนส์', key: 'lens_name' },
              { label: 'ซัพพลายเออร์', key: 'supplier_name' },
              { label: 'เลขที่สั่ง', key: 'supplier_order_no' },
              { label: 'สั่งเมื่อ', render: (r) => fmtDate(r.order_date), cls: 'nowrap' },
              { label: 'ETA', render: (r) => fmtDate(r.expected_arrival), cls: 'nowrap' },
              {
                label: 'เหลือ (วัน)',
                cls: 'num',
                render: (r) => (r.days_to_eta === null ? '—' : String(r.days_to_eta)),
              },
              {
                label: 'ความเสี่ยง',
                render: (r) => (
                  <Badge kind={r.risk_level === 'late' ? 'danger' : r.risk_level === 'soon' ? 'warn' : 'ok'}>
                    {r.risk_level}
                  </Badge>
                ),
              },
              { label: 'ตามแล้ว', key: 'follow_up_count', cls: 'num' },
              { label: 'วันนัด', render: (r) => fmtDate(r.appointment_date), cls: 'nowrap' },
              {
                label: 'กระทบนัด',
                render: (r) => (Number(r.threatens_appointment) ? <Badge kind="danger">เสี่ยงเลื่อน</Badge> : ''),
              },
            ]}
            rows={rows}
            onRowClick={(r) => router.push('/cases/detail?id=' + r.case_id)}
            empty="ไม่มีเลนส์ที่กำลังรอ"
          />
        </Card>
      )}
    </div>
  );
}

export default function LensTrackerPage() {
  return (
    <QueryParamPage>
      <LensTrackerInner />
    </QueryParamPage>
  );
}
