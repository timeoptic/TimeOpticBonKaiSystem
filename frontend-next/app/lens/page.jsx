'use client';
/**
 * The เลนส์ board — every sold case that has not been handed to the bench yet,
 * sorted the way the floor should work through them.
 *
 * The question here is not "what can I make" (that is /production) but "what am
 * I still waiting for": a piece nobody picked, a piece that is here but nobody
 * claimed, a piece on order. Cases already sent to production drop off the
 * list, because at that point they are somebody else's problem.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync, useDebounced } from '../../lib/hooks.js';
import { Badge, Card, Loading, PageHead } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Icon } from '../../components/Icon.jsx';
import { custName, fmtDate } from '../../lib/format.js';

const STOCK_STATE = {
  reserved: { label: 'จองครบแล้ว', kind: 'ok' },
  ready: { label: 'มีของ — ยังไม่ได้จอง', kind: 'warn' },
  ordered: { label: 'รอสินค้าเข้า', kind: 'warn' },
  out_of_stock: { label: 'ของไม่พอ', kind: 'danger' },
  not_chosen: { label: 'ยังไม่เลือกสินค้า', kind: 'gray' },
};

const CARDS = [
  ['not_chosen', 'ยังไม่เลือกสินค้า', 'warning', 'gray'],
  ['out_of_stock', 'ของไม่พอ', 'xCircle', 'danger'],
  ['ordered', 'รอสินค้าเข้า', 'clock', 'warn'],
  ['ready', 'มีของ รอจอง', 'circleHalf', 'warn'],
  ['reserved', 'จองครบ พร้อมส่งผลิต', 'checkCircle', 'ok'],
];

const ITEM_STATE = {
  reserved: 'ok', withdrawn: 'ok', ready: 'warn', ordered: 'warn',
  out_of_stock: 'bad', not_chosen: 'bad', not_required: 'off',
};

/** one piece of the job, as a chip that says its name and how it stands */
function ItemCell({ row, type, fallback }) {
  const i = (row.items || []).find((x) => x.item_type === type);
  const cls = ITEM_STATE[i?.status] || 'bad';
  return (
    <div className={`lens-cell ${cls}`}>
      <span>{i?.product_name || fallback || '—'}</span>
      <small>{i?.status === 'not_required' ? 'ไม่ใช้ชิ้นนี้' : (i?.note || i?.sku || '')}</small>
    </div>
  );
}

export default function LensBoardPage() {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const [stock, setStock] = useState('');
  const [done, setDone] = useState(false);
  const q = useDebounced(term, 250);

  const { data, loading, error } = useAsync(
    () => api.get('/api/lens', { q: q.trim(), stock, done: done ? '1' : '' }),
    [q, stock, done],
  );

  const summary = data?.summary || {};
  const rows = data?.rows || [];

  return (
    <div>
      <PageHead icon="👓" title="เลนส์" subtitle="เช็คของ · จองของ · สั่งของ ก่อนส่งเข้าห้องผลิต" />

      <div className="prod-cards">
        {CARDS.map(([code, label, icon, kind]) => (
          <button
            type="button"
            key={code}
            className={`prod-card ${kind} ${stock === code ? 'active' : ''}`}
            onClick={() => setStock(stock === code ? '' : code)}
          >
            <div>
              <span>{label}</span>
              <b>{summary[code] ?? 0}</b>
              <small>เคส</small>
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
        <button
          type="button"
          className={`btn ${done ? '' : 'btn-light'}`}
          onClick={() => setDone((v) => !v)}
        >
          <Icon name="check" /> รวมที่ส่งผลิตแล้ว
        </button>
        {(term || stock) && (
          <button
            type="button"
            className="btn btn-light"
            onClick={() => { setTerm(''); setStock(''); }}
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
            { label: 'กรอบ', render: (r) => <ItemCell row={r} type="frame" fallback={r.frame_name} /> },
            { label: 'เลนส์ขวา (OD)', render: (r) => <ItemCell row={r} type="lens_od" fallback={r.lens_name} /> },
            { label: 'เลนส์ซ้าย (OS)', render: (r) => <ItemCell row={r} type="lens_os" fallback={r.lens_name} /> },
            {
              label: 'สถานะสินค้า',
              cls: 'nowrap',
              render: (r) => {
                const s = STOCK_STATE[r.stock_state] || STOCK_STATE.not_chosen;
                return (
                  <>
                    <Badge kind={s.kind}>{s.label}</Badge>
                    {r.lens_state === 'completed'
                      ? <div className="muted">ส่งเข้าห้องผลิตแล้ว</div>
                      : null}
                  </>
                );
              },
            },
            { label: 'นัดรับ', render: (r) => fmtDate(r.appointment_date) || '—', cls: 'nowrap' },
            { label: 'รับงาน', render: (r) => fmtDate(r.opened_at), cls: 'nowrap' },
          ]}
          rows={rows}
          onRowClick={(r) => router.push(`/cases/detail?id=${r.case_id}&step=lens`)}
          empty="ไม่มีเคสที่รอเช็คเลนส์"
        />
      )}
    </div>
  );
}
