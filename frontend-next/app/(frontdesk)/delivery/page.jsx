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
import { api } from '../../../lib/apiClient.js';
import { useAsync, useDebounced } from '../../../lib/hooks.js';
import { Badge, Card, Loading, PageHead } from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { FilterBar } from '../../../components/FilterBar.jsx';
import { Pager } from '../../../components/Pager.jsx';
import { Icon } from '../../../components/Icon.jsx';
import { CaseTags } from '../../../components/CaseTags.jsx';
import { custName, fmtDate, fmtDateTime, money } from '../../../lib/format.js';
import { Select } from '../../../components/Selects.jsx';

const BUCKET = {
  ready: { label: 'พร้อมส่งมอบ', kind: 'ok', row: 'ok' },
  waiting_customer: { label: 'รอลูกค้ามารับ', kind: 'blue', row: 'blue' },
  not_ready: { label: 'ยังไม่พร้อม', kind: 'gray', row: 'gray' },
  delivered: { label: 'ส่งมอบแล้ว', kind: 'ok', row: 'ok' },
};

/* [คีย์ถัง, ป้าย, ไอคอน, สี, คำอธิบาย, คีย์ตัวเลขใน summary] */
const CARDS = [
  ['ready', 'พร้อมส่งมอบ', 'checkCircle', 'ok', 'QC ผ่านแล้ว รอส่งให้ลูกค้า', 'ready'],
  ['waiting_customer', 'รอลูกค้ามารับ', 'clock', 'blue', 'แจ้งลูกค้าแล้ว รอเข้ามารับ', 'waiting_customer'],
  ['not_ready', 'ยังไม่พร้อม', 'warning', 'warn', 'ติดผลิต / QC / ออเดอร์', 'not_ready'],
  /* ใบนี้ออกจากคิว — กดแล้วตารางเปลี่ยนไปเป็นของที่ส่งไปแล้ว ย้อนดูได้ตามช่วงเวลา */
  ['delivered', 'ส่งมอบวันนี้', 'box', '', 'ปิดงานส่งมอบไปแล้ววันนี้ — กดเพื่อดูรายชื่อ', 'done_today'],
];

const SPANS = [
  ['today', 'วันนี้'],
  ['7', '7 วันล่าสุด'],
  ['30', '30 วันล่าสุด'],
  ['all', 'ทั้งหมด'],
];

const BOOKS = [
  ['', 'ประเภทงาน — ทั้งหมด'],
  ['sightfirst', 'SightFirst'],
  ['shop', 'ลูกค้าร้าน'],
];

export default function DeliveryListPage() {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const [bucket, setBucket] = useState('');
  const [client, setClient] = useState('');
  const [span, setSpan] = useState('today');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const q = useDebounced(term, 250);
  const done = bucket === 'delivered';

  const { data, loading, error } = useAsync(
    () => api.get('/api/delivery', { q: q.trim(), bucket, client, span: done ? span : '' }),
    [q, bucket, client, done ? span : ''],
  );

  const summary = data?.summary || {};
  const rows = useMemo(() => data?.rows || [], [data]);

  useEffect(() => { setPage(1); }, [q, bucket, client, span, perPage]);

  const openCase = (r) => router.push(`/cases/detail?id=${r.id}&step=delivery`);
  /* ตัวเลขในวงเล็บบนปุ่ม "ตัวกรอง (N)" — นับเฉพาะตัวที่ถูกเปลี่ยนจากค่าเริ่มต้น
     ช่วงเวลานับเฉพาะตอนดูของที่ส่งไปแล้ว เพราะคิวที่ยังไม่ส่งไม่มีช่องนั้นให้เลือก */
  const activeFilters = [term, bucket, client, done && span !== 'today'].filter(Boolean).length;

  return (
    <div>
      <PageHead
        className="hero"
        icon="box"
        title="Delivery"
        subtitle="ส่งมอบ — เคสที่รอส่งให้ลูกค้า"
      />

      <div className="stat-cards">
        {CARDS.map(([key, label, icon, kind, desc, statKey]) => (
          <button
            type="button"
            key={key}
            className={`stat-card ${kind} ${bucket === key ? 'active' : ''}`}
            onClick={() => { setBucket(bucket === key ? '' : key); setSpan('today'); }}
          >
            <span className="stat-ic"><Icon name={icon} /></span>
            <span className="stat-body">
              <span className="stat-label">{label}</span>
              <span className="stat-value"><b>{summary[statKey] ?? 0}</b><span>เคส</span></span>
              <span className="stat-desc">{desc}</span>
            </span>
          </button>
        ))}
      </div>

      <FilterBar
        count={activeFilters}
        resultCount={rows.length}
        onReset={() => { setTerm(''); setBucket(''); setClient(''); setSpan('today'); }}
        resetLabel="รีเซ็ต"
        search={(
          <div className="search-field">
            <Icon name="search" />
            <input
              type="search"
              placeholder="ค้นหา Case / ชื่อลูกค้า / เบอร์ / กรอบ / เลนส์"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
          </div>
        )}
      >
        <Select value={client} onChange={(e) => setClient(e.target.value)} options={BOOKS} />
        <Select
          value={bucket}
          onChange={(e) => { setBucket(e.target.value); setSpan('today'); }}
          options={[['', 'ความพร้อม — ทั้งหมด'], ...Object.entries(BUCKET).map(([k, v]) => [k, v.label])]}
        />
        {/* ช่วงเวลามีความหมายเฉพาะกับของที่ส่งไปแล้ว — คิวที่ยังไม่ส่งไม่มีวันที่ให้ย้อน */}
        {done && (
          <Select
            value={span}
            onChange={(e) => setSpan(e.target.value)}
            options={SPANS.map(([k, label]) => [k, `ส่งมอบเมื่อ — ${label}`])}
          />
        )}
      </FilterBar>

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
              /* กรอบ/เลนส์ไม่ได้ตัดสินว่าจะส่งมอบได้หรือยัง — พับไว้ใต้ "ดูเพิ่มเติม" */
              {
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
                label: 'ความพร้อม',
                cls: 'nowrap',
                mobile: 'status',
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
                mobile: 'body',
                /* ไม่มีออเดอร์ = ยังไม่มียอด อย่าไปบอกว่า "ชำระครบ" */
                render: (r) => {
                  if (!r.order_id || r.balance === null) return <span className="muted">—</span>;
                  return Number(r.balance) > 0
                    ? <b className="dlv-due">{money(r.balance)}</b>
                    : <Badge kind="ok dot">ชำระครบ</Badge>;
                },
              },
              /* คิวที่ยังไม่ส่งสนใจ "นัดวันไหน" ส่วนของที่ส่งไปแล้วสนใจ "ส่งเมื่อไหร่" */
              done ? {
                label: 'ส่งมอบเมื่อ',
                cls: 'nowrap',
                mobile: 'body',
                render: (r) => (r.delivered_at ? fmtDateTime(r.delivered_at) : '—'),
              } : {
                label: 'นัดรับ',
                cls: 'nowrap',
                mobile: 'body',
                render: (r) => (r.appointment_date ? fmtDate(r.appointment_date) : '—'),
              },
              /* ปุ่ม ⋮ ซ้ำกับปุ่ม "เปิดขั้นส่งมอบ" ที่ท้ายการ์ดพอดี — บนมือถือจึงตัดทิ้ง
                 ไม่ใช่เพราะกดไม่ได้ แต่เพราะปุ่มสองอันที่ทำงานเดียวกันในการ์ดใบเดียว
                 ทำให้ต้องหยุดคิดว่ามันต่างกันตรงไหน */
              {
                label: 'จัดการ',
                cls: 'nowrap right',
                mobile: false,
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
            rows={rows}
            page={page}
            perPage={perPage}
            onRowClick={openCase}
            cardAction="เปิดขั้นส่งมอบ"
            empty="ไม่มีเคสที่ตรงกับตัวกรอง"
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
