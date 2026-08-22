import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAsync } from '../../lib/hooks.js';
import { Card, Field, Loading, PageHead, PrintButton, Toolbar } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Select } from '../../components/Selects.jsx';
import { fmtDate, money, sumBy } from '../../lib/format.js';

const RANGES = [[30, '30 วัน'], [90, '90 วัน'], [180, '180 วัน'], [365, '1 ปี'], [730, '2 ปี']];

export default function Unsold() {
  const [params] = useSearchParams();
  const [days, setDays] = useState(params.get('days') || 180);

  const { data: rows, loading, error } = useAsync(
    () => api.get('/api/reports/unsold-stock', { days }),
    [days]
  );

  const value = rows ? sumBy(rows, (r) => r.product_price) : 0;

  return (
    <div>
      <PageHead icon="🕰" title="Unsold Stock" subtitle="สินค้าค้างสต็อก" actions={<PrintButton />} />

      <Toolbar className="no-print">
        <Field label="ค้างนานกว่า">
          <Select options={RANGES} value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
      </Toolbar>

      {loading && <Loading />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (
        <Card title={`ค้างสต็อก ${rows.length} ชิ้น — มูลค่า ${money(value)}`} tight>
          <DataTable
            columns={[
              { label: 'ID', key: 'id', cls: 'mono' },
              { label: 'ประเภท', key: 'product_type' },
              { label: 'ชื่อสินค้า', key: 'product_name' },
              { label: 'ตำแหน่ง', render: (r) => r.location || '-' },
              { label: 'ราคาขาย', render: (r) => money(r.product_price), cls: 'num' },
              { label: 'รับเข้าเมื่อ', render: (r) => fmtDate(r.stock_date), cls: 'nowrap' },
              { label: 'ค้าง (วัน)', key: 'age_days', cls: 'num' },
            ]}
            rows={rows}
            empty="ไม่มีสินค้าค้างสต็อกตามเงื่อนไขนี้"
          />
        </Card>
      )}
    </div>
  );
}
