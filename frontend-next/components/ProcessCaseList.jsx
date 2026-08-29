'use client';
/**
 * One list per 9-process workflow stage. Each `app/<stage>/page.jsx` is a
 * thin wrapper passing its own icon/title/subtitle + `stageGroup` filter.
 *
 * หน้าตาใช้ชิ้นส่วนชุดเดียวกับกระดานผลิต/ส่งมอบ (hero, การ์ดตัวเลขที่กดกรองได้,
 * แถบค้นหา, ตารางแถบสีซ้ายมือ, แถบแบ่งหน้า) เพื่อให้ทั้ง 5 ขั้นหน้าตาเหมือนกันหมด
 *
 * คอลัมน์ "สินค้า" กับ "ยอดคงเหลือ" โผล่เฉพาะตอนมีข้อมูลจริงในรายการนั้น —
 * ขั้นวัดสายตายังไม่มีออเดอร์ ถ้าโชว์ไว้ก็ได้คอลัมน์ขีดกลางทั้งแถว
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/apiClient.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { Badge, Card, Loading, PageHead } from './ui.jsx';
import { DataTable } from './DataTable.jsx';
import { StatusChip } from './StatusChip.jsx';
import { Icon } from './Icon.jsx';
import { CaseTags } from './CaseTags.jsx';
import { custName, fmtDate, money } from '../lib/format.js';

const BOOKS = [
  ['', 'ประเภทงาน — ทั้งหมด'],
  ['sightfirst', 'SightFirst'],
  ['shop', 'ลูกค้าร้าน'],
];

const PER_PAGE = [10, 25, 50];

/* การ์ดตัวเลข = ตัวกรองในตัว ทุกใบคิดจากรายการที่โหลดมาแล้ว ไม่ต้องยิง API ซ้ำ */
const VIEWS = {
  rush: { label: 'งานด่วน', icon: 'flame', kind: 'warn', desc: 'ต้องหยิบก่อนใบอื่น', test: (r) => Number(r.is_rush) },
  waiting: { label: 'รออยู่', icon: 'hourglass', kind: 'blue', desc: 'สถานะบอกว่ากำลังรอ', test: (r) => Number(r.is_waiting) },
  stale: { label: 'ค้างเกิน 7 วัน', icon: 'clock', kind: 'danger', desc: 'เปิดเคสมานานแล้วยังไม่ขยับ', test: (r) => Number(r.age_days) > 7 },
};

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

export function ProcessCaseList({ stageGroup, icon, title, subtitle }) {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const [view, setView] = useState('');
  const [client, setClient] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const q = useDebounced(term, 250);

  const { data, loading, error } = useAsync(
    () => api.get('/api/cases', {
      stage_group: stageGroup, open: 1, limit: 300, client, q: q.trim(),
    }),
    [stageGroup, client, q],
  );

  const all = useMemo(() => data || [], [data]);
  const rows = useMemo(
    () => (view ? all.filter(VIEWS[view].test) : all),
    [all, view],
  );

  useEffect(() => { setPage(1); }, [q, view, client, perPage, stageGroup]);

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(page, pages);
  const from = total ? (current - 1) * perPage + 1 : 0;
  const to = Math.min(current * perPage, total);
  const shown = rows.slice((current - 1) * perPage, current * perPage);

  const hasItems = all.some((r) => r.frame_name || r.lens_name);
  const hasMoney = all.some((r) => r.order_id);
  const openCase = (r) => router.push(`/cases/detail?id=${r.id}`);
  const hasFilter = Boolean(term || view || client);

  const columns = [
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
            <CaseTags row={r} />
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
    hasItems && {
      label: 'สินค้า',
      render: (r) => (
        <div className="cell-2">
          <span>{r.frame_name || '—'}</span>
          <small>{r.lens_name || '—'}</small>
        </div>
      ),
    },
    {
      label: 'สถานะ',
      cls: 'nowrap',
      render: (r) => (
        <div className="cell-2">
          <span><StatusChip row={r} /></span>
          <small>{r.received_by_name ? `ผู้รับเรื่อง: ${r.received_by_name}` : ''}</small>
        </div>
      ),
    },
    hasMoney && {
      label: 'ยอดคงเหลือ',
      cls: 'nowrap',
      render: (r) => {
        if (!r.order_id || r.balance === null) return <span className="muted">—</span>;
        return Number(r.balance) > 0
          ? <b className="dlv-due">{money(r.balance)}</b>
          : <Badge kind="ok dot">ชำระครบ</Badge>;
      },
    },
    {
      label: 'เปิดมา',
      cls: 'nowrap num',
      render: (r) => {
        const d = Number(r.age_days) || 0;
        const cls = d > 14 ? 'age-bad' : d > 7 ? 'age-warn' : '';
        return <span className={`cc-age ${cls}`}>{`${d} วัน`}</span>;
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
          title="เปิดเคสนี้"
          aria-label={`เปิดเคส ${r.case_code}`}
          onClick={() => openCase(r)}
        >
          ⋮
        </button>
      ),
    },
  ].filter(Boolean);

  return (
    <div>
      <PageHead className="hero" icon={icon} title={title} subtitle={subtitle} />

      <div className="stat-cards">
        <button
          type="button"
          className={`stat-card ok ${view === '' ? 'active' : ''}`}
          onClick={() => setView('')}
        >
          <span className="stat-ic"><Icon name="board" /></span>
          <span className="stat-body">
            <span className="stat-label">เคสในขั้นนี้</span>
            <span className="stat-value"><b>{all.length}</b><span>เคส</span></span>
            <span className="stat-desc">ทั้งหมดที่ยังค้างอยู่ขั้นนี้</span>
          </span>
        </button>
        {Object.entries(VIEWS).map(([key, v]) => (
          <button
            type="button"
            key={key}
            className={`stat-card ${v.kind} ${view === key ? 'active' : ''}`}
            onClick={() => setView(view === key ? '' : key)}
          >
            <span className="stat-ic"><Icon name={v.icon} /></span>
            <span className="stat-body">
              <span className="stat-label">{v.label}</span>
              <span className="stat-value"><b>{all.filter(v.test).length}</b><span>เคส</span></span>
              <span className="stat-desc">{v.desc}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <div className="search-field">
          <Icon name="search" />
          <input
            type="search"
            placeholder="ค้นหา Case / ชื่อลูกค้า / เบอร์ / Invoice"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <select value={client} onChange={(e) => setClient(e.target.value)}>
          {BOOKS.map(([k, label]) => <option key={k || 'all'} value={k}>{label}</option>)}
        </select>
        <button
          type="button"
          className="btn btn-light"
          disabled={!hasFilter}
          onClick={() => { setTerm(''); setView(''); setClient(''); }}
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
            rowClass={(r) => (Number(r.is_rush) ? 'row-danger' : Number(r.is_waiting) ? 'row-blue' : 'row-gray')}
            columns={columns}
            rows={shown}
            onRowClick={openCase}
            empty="ไม่มีเคสในขั้นนี้"
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
