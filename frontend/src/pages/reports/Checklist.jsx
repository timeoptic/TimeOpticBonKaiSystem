import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAsync } from '../../lib/hooks.js';
import { useMeta } from '../../api/meta.jsx';
import { Card, Field, Loading, PageHead, PrintButton, Toolbar } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Select } from '../../components/Selects.jsx';
import { fmtDate, money, sumBy } from '../../lib/format.js';

export default function Checklist() {
  const [params] = useSearchParams();
  const { meta } = useMeta();
  const [type, setType] = useState(params.get('type') || 'Lens');

  const { data: rows, loading, error } = useAsync(
    () => api.get('/api/reports/checklist', { type }),
    [type]
  );

  const qty = rows ? sumBy(rows, (r) => r.qty) : 0;

  return (
    <div>
      <PageHead
        icon="📋"
        title="Stock Checklist"
        subtitle="เช็คลิสต์สินค้าคงเหลือ"
        actions={<PrintButton />}
      />

      <Toolbar className="no-print">
        <Field label="ประเภทสินค้า">
          <Select
            options={meta.lists.product_type || ['Lens']}
            value={type}
            onChange={(e) => setType(e.target.value)}
          />
        </Field>
      </Toolbar>

      {loading && <Loading text="กำลังนับ…" />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (
        <Card title={`${type} Checklist — คงเหลือ ${qty} ชิ้น`} tight>
          <DataTable
            rowKey={(r) => r.product_name}
            columns={[
              { label: 'ชื่อสินค้า', key: 'product_name' },
              { label: 'จำนวน', key: 'qty', cls: 'num' },
              { label: 'ราคาขาย', render: (r) => money(r.price), cls: 'num' },
              { label: 'รับเข้าครั้งแรก', render: (r) => fmtDate(r.oldest), cls: 'nowrap' },
              { label: 'นับจริง', render: () => <span className="muted">__________</span> },
            ]}
            rows={rows}
            empty="ไม่มีสินค้าคงเหลือในประเภทนี้"
          />
        </Card>
      )}
    </div>
  );
}
