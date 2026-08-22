import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAsync, useDebounced } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/Confirm.jsx';
import { Card, Field, Loading, PageHead, Toolbar } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { fmtDateTime, money, sumBy } from '../../lib/format.js';

export default function SaleList() {
  const [params] = useSearchParams();
  const { ok, err } = useToast();
  const confirm = useConfirm();

  const [term, setTerm] = useState(params.get('q') || '');
  const [from, setFrom] = useState(params.get('from') || '');
  const [to, setTo] = useState(params.get('to') || '');
  const q = useDebounced(term);

  const { data: rows, loading, error, reload } = useAsync(
    () => api.get('/api/sales', { q: q.trim(), from, to, limit: 500 }),
    [q, from, to]
  );

  const cancel = async (r) => {
    if (!await confirm(
      'ยกเลิกการขาย',
      `ยกเลิกรายการขาย #${r.id} และคืนสินค้ากลับเข้าคลัง?`,
      { confirmText: 'ยกเลิกการขาย', danger: true }
    )) return;
    try {
      await api.del('/api/sales/' + r.id);
      ok('ยกเลิกแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const total = rows ? sumBy(rows, (r) => Number(r.price) - Number(r.discount)) : 0;

  return (
    <div>
      <PageHead
        icon="🧾"
        title="Sales History"
        subtitle="ประวัติการขายสินค้า"
        actions={<Link className="btn btn-ghost" to="/sales/new">+ ขายสินค้า</Link>}
      />

      <Toolbar>
        <Field label="ค้นหา" className="grow">
          <input
            type="search"
            placeholder="Invoice / ชื่อสินค้า / หมายเหตุ"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </Field>
        <Field label="ตั้งแต่วันที่">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="ถึงวันที่">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </Toolbar>

      {loading && <Loading />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (
        <Card tight>
          <DataTable
            columns={[
              { label: 'ID', key: 'id', cls: 'mono' },
              { label: 'วันที่ขาย', render: (r) => fmtDateTime(r.sale_date), cls: 'nowrap' },
              { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
              { label: 'สินค้า', render: (r) => r.product_name || `#${r.product_stock_id}` },
              { label: 'ประเภท', key: 'product_type' },
              { label: 'ราคา', render: (r) => money(r.price), cls: 'num' },
              { label: 'ส่วนลด', render: (r) => money(r.discount), cls: 'num' },
              { label: 'สุทธิ', render: (r) => money(Number(r.price) - Number(r.discount)), cls: 'num' },
              { label: 'ชำระ', key: 'pay_type' },
              { label: 'ช่องทาง', key: 'marketing' },
              { label: 'พนักงาน', key: 'employee_name' },
              { label: 'หมายเหตุ', key: 'notes' },
              {
                label: '',
                cls: 'nowrap',
                render: (r) => (
                  <button
                    type="button"
                    className="btn btn-sm btn-light"
                    title="ยกเลิกการขาย (คืนสินค้าเข้าคลัง)"
                    onClick={() => cancel(r)}
                  >
                    🗑
                  </button>
                ),
              },
            ]}
            rows={rows}
            empty="ไม่พบรายการขาย"
            footer={rows.length ? (
              <tr>
                <td colSpan={7}>{`รวม ${rows.length} รายการ`}</td>
                <td className="num">{money(total)}</td>
                <td colSpan={5} />
              </tr>
            ) : null}
          />
        </Card>
      )}
    </div>
  );
}
