'use client';
/**
 * กระดานส่งมอบ — "ตอนนี้ส่งมอบให้ใครได้บ้าง"
 *
 * ของเดิมหน้านี้เป็น ProcessCaseList ที่ถามแค่ `stage_group = 'delivery'` ซึ่งอ่านจาก
 * คอลัมน์ cases.status ของระบบเดิม เลยผิดสองทางพร้อมกัน: เคสที่ยังไม่มีออเดอร์/
 * ยังไม่ได้ผลิตติดมาด้วย ส่วนเคสที่ QC ผ่านแล้วจริง ๆ แต่ status ยังค้างอยู่ขั้นผลิต
 * กลับไม่ขึ้นเลย (/api/delivery รวมสองฝั่งแล้วบอกเหตุผลรายใบ)
 *
 * หน้าตาใช้ชิ้นส่วนเดียวกับกระดานผลิต — hero, การ์ดตัวเลขที่กดเป็นตัวกรองได้,
 * แถบค้นหา, ตารางแถบสีซ้ายมือ, แถบแบ่งหน้า
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync, useDebounced } from '../../lib/hooks.js';
import { Badge, Card, Loading, PageHead } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Icon } from '../../components/Icon.jsx';
import { custName, fmtDate, money } from '../../lib/format.js';

const BUCKET = {
  ready: { label: 'พร้อมส่งมอบ', kind: 'ok', row: 'ok' },
  waiting_customer: { label: 'รอลูกค้ามารับ', kind: 'blue', row: 'blue' },
  not_ready: { label: 'ยังไม่พร้อม', kind: 'gray', row: 'gray' },
};

const CARDS = [
  ['ready', 'พร้อมส่งมอบ', 'checkCircle', 'ok', 'QC ผ่านแล้ว รอส่งให้ลูกค้า'],
  ['waiting_customer', 'รอลูกค้ามารับ', 'clock', 'blue', 'แจ้งลูกค้าแล้ว รอเข้ามารับ'],
  ['not_ready', 'ยังไม่พร้อม', 'warning', 'warn', 'ติดผลิต / QC / ออเดอร์'],
];

const BOOKS = [
  ['', 'ประเภทงาน — ทั้งหมด'],
  ['sightfirst', 'SightFirst'],
  ['shop', 'ลูกค้าร้าน'],
];

const PER_PAGE = [10, 25, 50];

/** 1 … 4 5 [6] 7 8 … 12 — never more than seven buttons wide */
function pageWindow(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pages - 1, page + 1);
  if (from > 2) out.push('…');
  for (let n = from; n <= to; n++) out.push(n);
  if (to < pages - 1) out.push('…');
  out.push(pages);
  return out;
}

export default function DeliveryListPage() {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const [bucket, setBucket] = useState('');
  const [client, setClient] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const q = useDebounced(term, 250);

  const { data, loading, error } = useAsync(
    () => api.get('/api/delivery', { q: q.trim(), bucket, client }),
    [q, bucket, client],
  );

  const summary = data?.summary || {};
  const rows = useMemo(() => data?.rows || [], [data]);

  useEffect(() => { setPage(1); }, [q, bucket, client, perPage]);

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(page, pages);
  const from = total ? (current - 1) * perPage + 1 : 0;
  const to = Math.min(current * perPage, total);
  const shown = rows.slice((current - 1) * perPage, current * perPage);

  const openCase = (r) => router.push(`/cases/detail?id=${r.id}&step=delivery`);
  const hasFilter = Boolean(term || bucket || client);

  return (
    <div>
      <PageHead
        className="hero"
        icon="box"
        title="Delivery"
        subtitle="ส่งมอบ — เคสที่รอส่งให้ลูกค้า"
      />

      <div className="stat-cards">
        {CARDS.map(([key, label, icon, kind, desc]) => (
          <button
            type="button"
            key={key}
            className={`stat-card ${kind} ${bucket === key ? 'active' : ''}`}
            onClick={() => setBucket(bucket === key ? '' : key)}
          >
            <span className="stat-ic"><Icon name={icon} /></span>
            <span className="stat-body">
              <span className="stat-label">{label}</span>
              <span className="stat-value"><b>{summary[key] ?? 0}</b><span>เคส</span></span>
              <span className="stat-desc">{desc}</span>
            </span>
          </button>
        ))}
        {/* ใบนี้เป็นตัวเลขอ่านอย่างเดียว — เคสที่ส่งไปแล้วไม่อยู่ในตารางข้างล่าง */}
        <div className="stat-card static">
          <span className="stat-ic"><Icon name="box" /></span>
          <span className="stat-body">
            <span className="stat-label">ส่งมอบวันนี้</span>
            <span className="stat-value"><b>{summary.done_today ?? 0}</b><span>เคส</span></span>
            <span className="stat-desc">ปิดงานส่งมอบไปแล้ววันนี้</span>
          </span>
        </div>
      </div>

      <div className="filter-bar">
        <div className="search-field">
          <Icon name="search" />
          <input
            type="search"
            placeholder="ค้นหา Case / ชื่อลูกค้า / เบอร์ / กรอบ / เลนส์"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <select value={client} onChange={(e) => setClient(e.target.value)}>
          {BOOKS.map(([k, label]) => <option key={k || 'all'} value={k}>{label}</option>)}
        </select>
        <select value={bucket} onChange={(e) => setBucket(e.target.value)}>
          <option value="">ความพร้อม — ทั้งหมด</option>
          {Object.entries(BUCKET).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button
          type="button"
          className="btn btn-light"
          disabled={!hasFilter}
          onClick={() => { setTerm(''); setBucket(''); setClient(''); }}
        >
          <Icon name="refresh" /> รีเซ็ต
        </button>
      </div>

      {loading && <Loading />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (
        <Card tight>
          <DataTable
            className="data-grid"
            rowClass={(r) => `row-${(BUCKET[r.bucket] || BUCKET.not_ready).row}`}
            columns={[
              {
                label: 'Case ID',
                cls: 'nowrap',
                render: (r) => (
                  <div className="cell-2">
                    <b className="mono">
                      {r.case_code}
                      {Number(r.is_rush) ? <> <Badge kind="danger"><Icon name="flame" /> ด่วน</Badge></> : null}
                    </b>
                    <small className="cell-tags">
                      {`รับ: ${fmtDate(r.opened_at)}`}
                      {r.case_type ? (
                        <Badge kind={r.case_type === 'SIGHTFIRST' ? 'blue' : 'gray'}>{r.case_type}</Badge>
                      ) : null}
                    </small>
                  </div>
                ),
              },
              {
                label: 'ลูกค้า',
                render: (r) => (
                  <div className="cell-2">
                    <span>{custName(r)}</span>
                    <small>{r.phone || '—'}</small>
                  </div>
                ),
              },
              {
                label: 'สินค้า',
                render: (r) => (
                  <div className="cell-2">
                    <span>{r.frame_name || '—'}</span>
                    <small>{r.lens_name || '—'}</small>
                  </div>
                ),
              },
              {
                label: 'ความพร้อม',
                cls: 'nowrap',
                render: (r) => {
                  const b = BUCKET[r.bucket] || BUCKET.not_ready;
                  return (
                    <div className="cell-2">
                      <span><Badge kind={`${b.kind} dot`}>{b.label}</Badge></span>
                      <small>{r.reason || r.status_label_th || ''}</small>
                    </div>
                  );
                },
              },
              {
                label: 'ยอดคงเหลือ',
                cls: 'nowrap',
                /* ไม่มีออเดอร์ = ยังไม่มียอด อย่าไปบอกว่า "ชำระครบ" */
                render: (r) => {
                  if (!r.order_id || r.balance === null) return <span className="muted">—</span>;
                  return Number(r.balance) > 0
                    ? <b className="dlv-due">{money(r.balance)}</b>
                    : <Badge kind="ok dot">ชำระครบ</Badge>;
                },
              },
              {
                label: 'นัดรับ',
                cls: 'nowrap',
                render: (r) => (r.appointment_date ? fmtDate(r.appointment_date) : '—'),
              },
              {
                label: 'จัดการ',
                cls: 'nowrap right',
                render: (r) => (
                  <button
                    type="button"
                    className="row-action"
                    title="เปิดขั้นส่งมอบของเคสนี้"
                    aria-label={`เปิดเคส ${r.case_code}`}
                    onClick={() => openCase(r)}
                  >
                    ⋮
                  </button>
                ),
              },
            ]}
            rows={shown}
            onRowClick={openCase}
            empty="ไม่มีเคสที่ตรงกับตัวกรอง"
          />

          {total > 0 && (
            <div className="pager">
              <span>{`แสดง ${from} - ${to} จาก ${total} รายการ`}</span>
              <div className="pages">
                <button
                  type="button"
                  className="pg"
                  disabled={current === 1}
                  aria-label="หน้าก่อนหน้า"
                  onClick={() => setPage(current - 1)}
                >
                  ‹
                </button>
                {pageWindow(current, pages).map((n, i) => (n === '…' ? (
                  <span className="pg-gap" key={`gap${i}`}>…</span>
                ) : (
                  <button
                    type="button"
                    key={n}
                    className={`pg ${n === current ? 'active' : ''}`}
                    onClick={() => setPage(n)}
                  >
                    {n}
                  </button>
                )))}
                <button
                  type="button"
                  className="pg"
                  disabled={current === pages}
                  aria-label="หน้าถัดไป"
                  onClick={() => setPage(current + 1)}
                >
                  ›
                </button>
              </div>
              <label className="pg-per">
                แสดง
                <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}>
                  {PER_PAGE.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                รายการ / หน้า
              </label>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
