'use client';
/**
 * One list per workflow stage. Each `app/<stage>/page.jsx` is a thin wrapper
 * passing its own icon/title/subtitle + the `stage` it shows.
 *
 * กรองด้วย `process_stage` — ขั้นที่งานอยู่จริง ตัวเดียวกับที่กระดานงานใช้แบ่ง
 * คอลัมน์ · ของเดิมกรองด้วย `stage_group` ซึ่งอ่านจาก cases.status ที่คนตั้งด้วย
 * มือ สองหน้าจึงตอบคนละคำถาม: เคสที่กดปุ่ม "เริ่ม" ที่ขั้นวัดสายตาแล้วแต่ status
 * ยังค้างอยู่ "รับลูกค้า" ขึ้นบนกระดานงาน แต่หน้า /exam ขึ้น "ไม่มีเคสในขั้นนี้"
 * (ทั้งฐานไม่มีเคสเปิดที่ stage_group = 'exam' เลยสักใบ — หน้านั้นว่างมาตลอด)
 *
 * โหลดทั้งขั้นมาแล้วแบ่งหน้าในเบราว์เซอร์ แบบเดียวกับหน้าส่งมอบ — การ์ดตัวเลข
 * ทั้งสี่ใบนับจากก้อนนี้ จึงต้องได้มาครบ ไม่ใช่แค่หน้าแรก · ขั้นที่หนาที่สุดคือ
 * ชำระเงิน ~920 ใบ ≈ 860 KB ต่อการโหลดหนึ่งครั้ง (เปลี่ยนขั้น/ค้นหา/สลับสมุด
 * เท่านั้น ไม่ใช่ทุกตัวอักษร — ค้นหาหน่วงไว้ 250 ms) ถ้าวันหนึ่งช้าจนรำคาญ
 * ทางแก้คือย้ายไปเส้น paged=1&stage= ที่กระดานงานใช้ แล้วยกการนับขึ้นฝั่งเซิร์ฟเวอร์
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
import { FilterBar } from './FilterBar.jsx';
import { Pager } from './Pager.jsx';
import { PAGE_SIZES } from '../lib/pager.js';
import { StatusChip } from './StatusChip.jsx';
import { Icon } from './Icon.jsx';
import { CaseTags } from './CaseTags.jsx';
import { RxLensBadge } from './RxLensBadge.jsx';
import { custName, fmtDate, money } from '../lib/format.js';
import { Select } from './Selects.jsx';

const BOOKS = [
  ['', 'ประเภทงาน — ทั้งหมด'],
  ['sightfirst', 'SightFirst'],
  ['shop', 'ลูกค้าร้าน'],
];

/* การ์ดตัวเลข = ตัวกรองในตัว ทุกใบคิดจากรายการที่โหลดมาแล้ว ไม่ต้องยิง API ซ้ำ */
const VIEWS = {
  rush: { label: 'งานด่วน', icon: 'flame', kind: 'warn', desc: 'ต้องหยิบก่อนใบอื่น', test: (r) => Number(r.is_rush) },
  waiting: { label: 'รออยู่', icon: 'hourglass', kind: 'blue', desc: 'สถานะบอกว่ากำลังรอ', test: (r) => Number(r.is_waiting) },
  stale: { label: 'ค้างเกิน 7 วัน', icon: 'clock', kind: 'danger', desc: 'เปิดเคสมานานแล้วยังไม่ขยับ', test: (r) => Number(r.age_days) > 7 },
};

export function ProcessCaseList({ stage, icon, title, subtitle }) {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const [view, setView] = useState('');
  const [client, setClient] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PAGE_SIZES[0]);
  const q = useDebounced(term, 250);

  const { data, loading, error } = useAsync(
    () => api.get('/api/cases', {
      process_stage: stage, open: 1, limit: 5000, client, q: q.trim(),
    }),
    [stage, client, q],
  );

  const all = useMemo(() => data || [], [data]);
  const rows = useMemo(
    () => (view ? all.filter(VIEWS[view].test) : all),
    [all, view],
  );

  useEffect(() => { setPage(1); }, [q, view, client, perPage, stage]);

  const hasItems = all.some((r) => r.frame_name || r.lens_name);
  const hasMoney = all.some((r) => r.order_id);
  const openCase = (r) => router.push(`/cases/detail?id=${r.id}`);
  const activeFilters = [term, view, client].filter(Boolean).length;

  const columns = [
    {
      label: 'Case ID',
      cls: 'nowrap',
      mobile: 'title',
      render: (r) => (
        <div className="cell-2">
          <b className="mono">
            {r.case_code}
            {Number(r.is_rush) ? <> <Badge kind="danger"><Icon name="flame" /> ด่วน</Badge></> : null}
          </b>
          <small className="cell-tags">
            {`รับ: ${fmtDate(r.opened_at)}`}
            <CaseTags row={r} />
            <RxLensBadge row={r} />
          </small>
        </div>
      ),
    },
    {
      label: 'ลูกค้า',
      mobile: 'subtitle',
      render: (r) => (
        <div className="cell-2">
          <span>{custName(r)}</span>
          <small>{r.phone || '—'}</small>
        </div>
      ),
    },
    hasItems && {
      label: 'สินค้า',
      mobile: 'meta',
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
      mobile: 'status',
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
      mobile: 'body',
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
      mobile: 'body',
      render: (r) => {
        const d = Number(r.age_days) || 0;
        const cls = d > 14 ? 'age-bad' : d > 7 ? 'age-warn' : '';
        return <span className={`cc-age ${cls}`}>{`${d} วัน`}</span>;
      },
    },
    {
      label: 'นัดรับ',
      cls: 'nowrap',
      mobile: 'body',
      render: (r) => (r.appointment_date ? fmtDate(r.appointment_date) : '—'),
    },
    /* ปุ่ม ⋮ ทำงานเดียวกับปุ่มท้ายการ์ด — บนมือถือเหลือปุ่มเดียวพอ */
    {
      label: 'จัดการ',
      cls: 'nowrap right',
      mobile: false,
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

      <FilterBar
        count={activeFilters}
        resultCount={rows.length}
        onReset={() => { setTerm(''); setView(''); setClient(''); }}
        resetLabel="รีเซ็ต"
        search={(
          <div className="search-field">
            <Icon name="search" />
            <input
              type="search"
              placeholder="ค้นหา Case / ชื่อลูกค้า / เบอร์ / Invoice"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
          </div>
        )}
      >
        <Select value={client} onChange={(e) => setClient(e.target.value)} options={BOOKS} />
      </FilterBar>

      {loading && <Loading />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (
        <Card tight>
          <DataTable
            className="data-grid"
            rowClass={(r) => (Number(r.is_rush) ? 'row-danger' : Number(r.is_waiting) ? 'row-blue' : 'row-gray')}
            columns={columns}
            rows={rows}
            page={page}
            perPage={perPage}
            onRowClick={openCase}
            cardAction="เปิดเคส"
            empty="ไม่มีเคสในขั้นนี้"
          />

          <Pager
            total={rows.length}
            page={page}
            perPage={perPage}
            onPage={setPage}
            onPerPage={setPerPage}
          />
        </Card>
      )}
    </div>
  );
}
