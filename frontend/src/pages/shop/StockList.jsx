import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAsync, useDebounced } from '../../lib/hooks.js';
import { useMeta } from '../../api/meta.jsx';
import { Badge, Card, Field, Loading, PageHead, Toolbar } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Select } from '../../components/Selects.jsx';
import { fmtDate, fmtDateTime, money, sumBy } from '../../lib/format.js';

export default function StockList() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { meta } = useMeta();

  const [term, setTerm] = useState(params.get('q') || '');
  const [type, setType] = useState(params.get('type') || '');
  const [sold, setSold] = useState(params.get('sold') ?? '0');
  const q = useDebounced(term);

  const { data: rows, loading, error } = useAsync(
    () => api.get('/api/stock', { q: q.trim(), type, sold, limit: 500 }),
    [q, type, sold]
  );

  const value = rows ? sumBy(rows.filter((r) => !Number(r.sold)), (r) => r.product_price) : 0;

  return (
    <div>
      <PageHead
        icon="📦"
        title="Menu Stock"
        subtitle="รายการสินค้าในคลัง"
        actions={(
          <>
            <Link className="btn btn-ghost" to="/stock/new">+ เพิ่มสินค้าเข้าคลัง</Link>
            <Link className="btn btn-ghost" to="/reports/labels">🏷 พิมพ์ป้ายราคา</Link>
          </>
        )}
      />

      <Toolbar>
        <Field label="ค้นหา" className="grow">
          <input
            type="search"
            placeholder="ชื่อสินค้า / ผู้ขาย / รหัส"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </Field>
        <Field label="ประเภทสินค้า">
          <Select
            options={[['', 'ทุกประเภท'], ...(meta.lists.product_type || [])]}
            value={type}
            onChange={(e) => setType(e.target.value)}
          />
        </Field>
        <Field label="สถานะ">
          <Select
            options={[['0', 'คงเหลือในคลัง'], ['1', 'ขายแล้ว'], ['', 'ทั้งหมด']]}
            value={sold}
            onChange={(e) => setSold(e.target.value)}
          />
        </Field>
      </Toolbar>

      {loading && <Loading />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (
        <Card tight>
          <DataTable
            columns={[
              { label: 'ID', key: 'id', cls: 'mono' },
              { label: 'ประเภท', key: 'product_type' },
              { label: 'ชื่อสินค้า', key: 'product_name' },
              { label: 'ตำแหน่ง', render: (r) => r.location || '-' },
              { label: 'ราคาขาย', render: (r) => money(r.product_price), cls: 'num' },
              { label: 'ต้นทุน', render: (r) => money(r.product_expense), cls: 'num' },
              { label: 'ผู้ขาย/แบรนด์', render: (r) => r.vendor_name || r.brand || '-' },
              { label: 'รับเข้าเมื่อ', render: (r) => fmtDateTime(r.stock_date), cls: 'nowrap' },
              {
                label: 'สถานะ',
                render: (r) => (Number(r.sold)
                  ? <Badge kind="gray">{'ขายแล้ว ' + fmtDate(r.clear_date)}</Badge>
                  : <Badge kind="ok">ในคลัง</Badge>),
              },
              { label: 'หมายเหตุ', key: 'notes' },
            ]}
            rows={rows}
            onRowClick={(r) => navigate('/stock/' + r.id)}
            empty="ไม่พบสินค้า"
            footer={rows.length ? (
              <tr>
                <td colSpan={4}>{`${rows.length} รายการ (มูลค่าคงคลัง)`}</td>
                <td className="num">{money(value)}</td>
                <td colSpan={5} />
              </tr>
            ) : null}
          />
        </Card>
      )}
    </div>
  );
}
