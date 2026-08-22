import { useState } from 'react';
import { api } from '../../api/client.js';
import { useAsync, useDebounced } from '../../lib/hooks.js';
import { useMeta } from '../../api/meta.jsx';
import { Card, Empty, Field, Loading, PageHead, PrintButton, Toolbar } from '../../components/ui.jsx';
import { Select } from '../../components/Selects.jsx';
import { money } from '../../lib/format.js';

export default function Labels() {
  const { meta } = useMeta();
  const [type, setType] = useState('Frame');
  const [term, setTerm] = useState('');
  const q = useDebounced(term);

  const { data: rows, loading, error } = useAsync(
    () => api.get('/api/reports/stock-labels', { type, q: q.trim() }),
    [type, q]
  );

  return (
    <div>
      <PageHead icon="🏷" title="Stock Label" subtitle="พิมพ์ป้ายราคาสินค้า" actions={<PrintButton />} />

      <Toolbar className="no-print">
        <Field label="ประเภทสินค้า">
          <Select
            options={[['', 'ทุกประเภท'], ...(meta.lists.product_type || [])]}
            value={type}
            onChange={(e) => setType(e.target.value)}
          />
        </Field>
        <Field label="ค้นหา" className="grow">
          <input
            type="search"
            placeholder="กรองด้วยชื่อสินค้า"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </Field>
      </Toolbar>

      {loading && <Loading />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (rows.length === 0
        ? <Empty>ไม่มีสินค้าคงเหลือ</Empty>
        : (
          <div className="paper">
            <div className="labels">
              {rows.map((r) => (
                <div className="label" key={r.id}>
                  <b>{r.product_name}</b>
                  <div>{`#${r.id}${r.location ? ' · ' + r.location : ''}`}</div>
                  <div className="price">{money(r.product_price)}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
