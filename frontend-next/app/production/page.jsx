'use client';
/**
 * The production board — every job with a sale behind it that has not shipped,
 * in the order the bench should look at them.
 *
 * The question this page answers is "what can I actually make right now", so
 * stock readiness is a column, not something you find out by opening a case and
 * pressing a disabled button. The four counts at the top are the same filter.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync, useDebounced } from '../../lib/hooks.js';
import {
  Badge, Card, Loading, PageHead,
} from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Icon } from '../../components/Icon.jsx';
import { custName, fmtDate, power } from '../../lib/format.js';

const JOB_STATUS = {
  WAITING_FOR_ITEMS: { label: 'รอสินค้าเข้า', kind: 'gray' },
  READY_TO_PRODUCE: { label: 'พร้อมผลิต', kind: 'warn' },
  IN_PRODUCTION: { label: 'กำลังผลิต', kind: 'blue' },
  WAITING_FOR_ITEM: { label: 'หยุด — รอสินค้า', kind: 'danger' },
  COMPLETED: { label: 'ผลิตเสร็จ', kind: 'ok' },
};

const STOCK_STATE = {
  ready: { label: 'พร้อมทั้งหมด', kind: 'ok' },
  ordered: { label: 'รอสินค้าเข้า', kind: 'warn' },
  out_of_stock: { label: 'ขาดสต็อก', kind: 'danger' },
  not_chosen: { label: 'ยังไม่เลือกสินค้า', kind: 'gray' },
};

const CARDS = [
  ['WAITING_FOR_ITEMS', 'รอสินค้า', 'waiting', 'box', 'gray'],
  ['READY_TO_PRODUCE', 'พร้อมผลิต', 'ready', 'checkCircle', 'warn'],
  ['IN_PRODUCTION', 'กำลังผลิต', 'in_production', 'gear', 'blue'],
  ['COMPLETED', 'ผลิตเสร็จวันนี้', 'done_today', 'glasses', 'ok'],
];

/** the lens for one eye, as the bench reads it: product then power */
function LensCell({ row, side }) {
  const sph = side === 'od' ? row.r_sphere : row.l_sphere;
  const cyl = side === 'od' ? row.r_cylinder : row.l_cylinder;
  const item = (row.items || []).find((i) => i.item_type === (side === 'od' ? 'lens_od' : 'lens_os'));
  const bad = item && !['ready', 'withdrawn'].includes(item.status);
  return (
    <div className={`prod-lens ${bad ? 'bad' : ''}`}>
      <span>{item?.product_name || row.lens_name || '—'}</span>
      <small>{sph ? `${power(sph)}${cyl ? ` / ${power(cyl)}` : ''}` : '—'}</small>
    </div>
  );
}

export default function ProductionListPage() {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [stock, setStock] = useState('');
  const q = useDebounced(term, 250);

  const { data, loading, error } = useAsync(
    () => api.get('/api/production', { q: q.trim(), status, stock }),
    [q, status, stock],
  );

  const summary = data?.summary || {};
  const rows = data?.rows || [];

  return (
    <div>
      <PageHead icon="wrench" title="Production" subtitle="งานตัดแว่นในร้าน" />

      <div className="prod-cards">
        {CARDS.map(([code, label, key, icon, kind]) => (
          <button
            type="button"
            key={code}
            className={`prod-card ${kind} ${status === code ? 'active' : ''}`}
            onClick={() => setStatus(status === code ? '' : code)}
          >
            <div>
              <span>{label}</span>
              <b>{summary[key] ?? 0}</b>
              <small>งาน</small>
            </div>
            <span className="prod-card-icon"><Icon name={icon} /></span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="field grow">
          <input
            type="search"
            placeholder="ค้นหา Case / ชื่อลูกค้า / เฟรม / เลนส์"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <div className="field">
          <select value={stock} onChange={(e) => setStock(e.target.value)}>
            <option value="">สถานะสินค้า — ทั้งหมด</option>
            {Object.entries(STOCK_STATE).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">สถานะการผลิต — ทั้งหมด</option>
            {Object.entries(JOB_STATUS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
        {(term || status || stock) && (
          <button
            type="button"
            className="btn btn-light"
            onClick={() => { setTerm(''); setStatus(''); setStock(''); }}
          >
            <Icon name="refresh" /> ล้างตัวกรอง
          </button>
        )}
      </div>

      {loading && <Loading />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (
        <DataTable
          columns={[
            {
              label: 'เคส',
              cls: 'nowrap',
              render: (r) => (
                <>
                  <b className="mono">{r.case_code}</b>
                  {Number(r.is_rush) ? <> <Badge kind="danger"><Icon name="flame" /> ด่วน</Badge></> : null}
                </>
              ),
            },
            { label: 'ลูกค้า', render: (r) => custName(r) },
            {
              label: 'เฟรม',
              render: (r) => {
                const item = (r.items || []).find((i) => i.item_type === 'frame');
                const bad = item && !['ready', 'withdrawn'].includes(item.status);
                return (
                  <div className={`prod-lens ${bad ? 'bad' : ''}`}>
                    <span>{item?.product_name || r.frame_name || '—'}</span>
                    <small>{r.frame_size || item?.sku || ''}</small>
                  </div>
                );
              },
            },
            { label: 'Lens OD / ขวา', render: (r) => <LensCell row={r} side="od" /> },
            { label: 'Lens OS / ซ้าย', render: (r) => <LensCell row={r} side="os" /> },
            {
              label: 'สถานะสินค้า',
              cls: 'nowrap',
              render: (r) => {
                const s = STOCK_STATE[r.stock_state] || STOCK_STATE.not_chosen;
                return <Badge kind={s.kind}>{s.label}</Badge>;
              },
            },
            {
              label: 'สถานะการผลิต',
              cls: 'nowrap',
              render: (r) => {
                const s = JOB_STATUS[r.job_status] || JOB_STATUS.WAITING_FOR_ITEMS;
                return (
                  <>
                    <Badge kind={s.kind}>{s.label}</Badge>
                    {r.waiting_item ? <div className="muted">{`รอ: ${r.waiting_item}`}</div> : null}
                  </>
                );
              },
            },
            { label: 'รับงาน', render: (r) => fmtDate(r.opened_at), cls: 'nowrap' },
            { label: 'เริ่มผลิต', render: (r) => (r.started_at ? fmtDate(r.started_at) : '—'), cls: 'nowrap' },
            { label: 'ผู้รับผิดชอบ', render: (r) => r.technician_name || '—' },
          ]}
          rows={rows}
          onRowClick={(r) => router.push(`/cases/detail?id=${r.case_id}&step=production`)}
          empty="ไม่มีงานผลิตที่ตรงกับตัวกรอง"
        />
      )}
    </div>
  );
}
