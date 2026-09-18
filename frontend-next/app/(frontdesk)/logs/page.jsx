'use client';
/**
 * บันทึกการใช้งาน — ใครทำอะไรในระบบ เมื่อไหร่
 *
 * หน้านี้อ่านอย่างเดียว ไม่มีปุ่มลบและไม่มีปุ่มแก้โดยตั้งใจ · ล็อกที่ลบทิ้งได้จาก
 * หน้าจอคือล็อกที่เชื่อไม่ได้ในวันที่ต้องใช้จริง ๆ · ของเก่าหายไปเองตามอายุที่
 * `api/services/ActivityLog.php` กำหนดไว้ ซึ่งเป็นกฎเดียวกับทุกแถว ไม่ใช่การเลือก
 *
 * ต่างจากหน้าตารางอื่นของระบบตรงที่ **แบ่งหน้าที่ฝั่ง API ไม่ใช่ฝั่งนี้** — ตารางนี้
 * โตเป็นแสนแถวภายในไม่กี่เดือน การขอมาทั้งชุดแล้วหั่นในเบราว์เซอร์แบบหน้าลูกค้า
 * จะกลายเป็นการส่งข้อมูลสิบเมกะไบต์เพื่อแสดงยี่สิบแถว
 */
import { useEffect, useState } from 'react';
import { api } from '../../../lib/apiClient.js';
import { useAsync, useDebounced } from '../../../lib/hooks.js';
import {
  Badge, Card, Field, Kpi, Kpis, Loading, PageHead,
} from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { FilterBar } from '../../../components/FilterBar.jsx';
import { Pager } from '../../../components/Pager.jsx';
import DateRangeField from '@/stockmod/components/DateRangeField';
import { Select } from '../../../components/Selects.jsx';
import { Icon } from '../../../components/Icon.jsx';
import { AdminOnly } from '../../../components/AdminOnly.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { downloadCsv } from '../../../lib/exportCsv.js';
import { fmtDate, todayISO } from '../../../lib/format.js';

/**
 * สี่ชนิดของแถว — คำอธิบายเป็นภาษาที่คนเปิดหน้านี้ใช้ ไม่ใช่ศัพท์ในตาราง
 * `keep` คือสิ่งที่คนอ่านต้องรู้ก่อนจะเชื่อว่า "ไม่มีในล็อก = ไม่เคยเกิดขึ้น"
 */
const KINDS = {
  audit:   { label: 'แก้ข้อมูล', badge: 'blue',   keep: '3 ปี' },
  auth:    { label: 'เข้า-ออกระบบ', badge: 'mint', keep: '3 ปี' },
  error:   { label: 'ข้อผิดพลาด', badge: 'danger', keep: '1 ปี' },
  request: { label: 'เปิดดู', badge: 'gray',      keep: '30 วัน' },
};

const KIND_OPTIONS = [
  ['', 'ทุกชนิด'],
  ...Object.entries(KINDS).map(([k, v]) => [k, `${v.label} (${v.keep})`]),
];

/**
 * ค่าเริ่มต้นของหน้านี้คือ 25 ไม่ใช่ 5 เหมือนหน้าอื่น
 *
 * ห้าแถวบนหน้าที่มีวันละหลายพันแถวไม่ได้แปลว่า "หน้าสั้น" แต่แปลว่าเรื่องที่มา
 * เปิดหาอยู่หน้าที่ 40 · หน้าลูกค้าห้าแถวยังพอ เพราะที่นั่นค้นหาแล้วเจอ ที่นี่
 * คนกวาดตาไล่ตามเวลา
 */
const DEFAULT_PER_PAGE = 25;

/** เวลาระดับวินาที — ลำดับของสิ่งที่เกิดในนาทีเดียวกันคือสิ่งที่คนมาเปิดล็อกอ่าน */
function logTime(v) {
  if (!v) return '';
  const s = String(v).replace(' ', 'T');
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${fmtDate(v)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** ค่าว่างในล็อกมีความหมาย ("เดิมไม่ได้กรอก") จึงเขียนออกมา ไม่ใช่ปล่อยช่องโล่ง */
function CellValue({ value }) {
  if (value === null || value === undefined || value === '') {
    return <span className="log-empty">(ว่าง)</span>;
  }
  return <span>{String(value)}</span>;
}

function KindBadge({ kind }) {
  const k = KINDS[kind] || { label: kind, badge: 'gray' };
  return <Badge kind={k.badge}>{k.label}</Badge>;
}

/** กล่องรายละเอียดของแถวเดียว — ที่เดียวที่ "ก่อน → หลัง" ถูกกางออกมาเต็ม ๆ */
function LogDetail({ row, onClose }) {
  if (!row) return null;
  const changes = row.changes || [];
  return (
    <div
      className="modal-back"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal wide" role="dialog" aria-modal="true">
        <h3>{row.summary || `${row.method} ${row.path}`}</h3>
        <div className="m-body">
          <dl className="kv log-kv">
            <dt>เมื่อ</dt><dd>{logTime(row.at)}</dd>
            <dt>ผู้ใช้</dt>
            <dd>{row.actor_name || '(ยังไม่ได้เข้าสู่ระบบ)'}{row.actor_role ? ` · ${row.actor_role}` : ''}</dd>
            <dt>ชนิด</dt><dd><KindBadge kind={row.kind} /></dd>
            <dt>เส้นทาง</dt><dd className="mono log-path">{row.method} {row.path}</dd>
            <dt>ผลลัพธ์</dt><dd>{row.status} · ใช้เวลา {row.duration_ms} ms</dd>
            {row.entity ? (
              <>
                <dt>ข้อมูลที่แตะ</dt>
                <dd className="mono">{row.entity}{row.entity_id ? ` #${row.entity_id}` : ''}</dd>
              </>
            ) : null}
            <dt>เครื่องที่ใช้</dt>
            <dd className="log-ua">{row.ip || '—'}{row.user_agent ? ` · ${row.user_agent}` : ''}</dd>
          </dl>

          {changes.length > 0 && (
            <>
              <h4 className="log-h4">สิ่งที่เปลี่ยน</h4>
              <div className="table-wrap">
                <table className="log-diff">
                  <thead>
                    <tr><th>ช่อง</th><th>ค่าเดิม</th><th>ค่าใหม่</th></tr>
                  </thead>
                  <tbody>
                    {changes.map((c) => (
                      <tr key={c.field}>
                        <td className="mono">{c.field}</td>
                        <td className="log-before"><CellValue value={c.before} /></td>
                        <td className="log-after"><CellValue value={c.after} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {row.payload ? (
            <>
              <h4 className="log-h4">
                {row.kind === 'error' ? 'ข้อความผิดพลาด' : 'ข้อมูลที่ส่งมา'}
              </h4>
              <pre className="log-json">{JSON.stringify(row.payload, null, 2)}</pre>
            </>
          ) : null}

          {changes.length === 0 && !row.payload && (
            <p className="muted">คำขอนี้ไม่ได้เปลี่ยนข้อมูลอะไร</p>
          )}
        </div>
        <div className="m-foot">
          <button type="button" className="btn btn-light" onClick={onClose}>ปิด</button>
        </div>
      </div>
    </div>
  );
}

function LogsPageInner() {
  const { err } = useToast();
  const [term, setTerm] = useState('');
  const [kind, setKind] = useState('');
  const [actorId, setActorId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);
  const [detail, setDetail] = useState(null);
  const q = useDebounced(term);

  const query = {
    q: q.trim(), kind, actor_id: actorId, from, to,
  };

  const { data, loading, error } = useAsync(
    (signal) => api.get('/api/logs', { ...query, limit: perPage, offset: (page - 1) * perPage }, signal),
    [q, kind, actorId, from, to, page, perPage],
  );

  /* รายชื่อคนกับตัวเลขวันนี้ไม่ขึ้นกับตัวกรอง โหลดครั้งเดียวพอ */
  const { data: meta } = useAsync(
    () => Promise.all([api.get('/api/logs/actors'), api.get('/api/logs/stats')])
      .then(([actors, stats]) => ({ actors, stats })),
    [],
  );

  /* ตัวกรองเปลี่ยน = ผลคนละชุด · ค้างอยู่หน้า 7 ของชุดเก่าแล้วเจอตารางโล่ง
     อ่านเหมือนระบบไม่มีข้อมูล */
  useEffect(() => { setPage(1); }, [q, kind, actorId, from, to, perPage]);

  const rows = data?.rows || [];
  const total = data?.total || 0;
  const today = meta?.stats?.today;
  const oldest = meta?.stats?.oldest;

  const actorOptions = [
    ['', 'ทุกคน'],
    ...(meta?.actors || []).map((a) => [String(a.id), a.name || `#${a.id}`]),
  ];

  const clearAll = () => {
    setTerm(''); setKind(''); setActorId(''); setFrom(''); setTo('');
  };
  const activeFilters = (kind ? 1 : 0) + (actorId ? 1 : 0) + ((from || to) ? 1 : 0);

  const setToday = () => { setFrom(todayISO()); setTo(todayISO()); };

  /* ส่งออกตามตัวกรองที่ค้างอยู่ ไม่ใช่แค่หน้าที่เปิดอยู่ — คนกดปุ่มนี้กำลังจะเอา
     ผลของ "การค้นหา" ไปทำอะไรต่อ ไม่ใช่ผลของ "หน้าที่ 3" */
  const exportCsv = async () => {
    try {
      const all = await api.get('/api/logs', { ...query, limit: 500, offset: 0 });
      downloadCsv(`activity-log-${todayISO()}.csv`, [
        { label: 'เมื่อ', value: (r) => r.at },
        { label: 'ผู้ใช้', value: (r) => r.actor_name || '' },
        { label: 'บทบาท', value: (r) => r.actor_role || '' },
        { label: 'ชนิด', value: (r) => (KINDS[r.kind]?.label || r.kind) },
        { label: 'สิ่งที่ทำ', value: (r) => r.summary || '' },
        { label: 'วิธี', value: (r) => r.method },
        { label: 'เส้นทาง', value: (r) => r.path },
        { label: 'ผลลัพธ์', value: (r) => r.status },
        { label: 'ใช้เวลา (ms)', value: (r) => r.duration_ms },
        { label: 'ข้อมูล', value: (r) => (r.entity ? `${r.entity}${r.entity_id ? `#${r.entity_id}` : ''}` : '') },
        {
          label: 'สิ่งที่เปลี่ยน',
          value: (r) => (r.changes || [])
            .map((c) => `${c.field}: ${c.before ?? ''} → ${c.after ?? ''}`)
            .join(' | '),
        },
        { label: 'ที่อยู่ IP', value: (r) => r.ip || '' },
      ], all.rows || []);
    } catch (ex) { err(ex); }
  };

  /* บนมือถือการ์ดกลับหัวจากตาราง: สิ่งที่ทำเป็นหัว เวลากับคนเป็นบรรทัดรอง
     ตารางบนเดสก์ท็อปกวาดตาลงตามเวลา แต่การ์ดใบเดียวบนจอแคบต้องตอบก่อนว่า
     "เรื่องอะไร" — เวลาที่เป็นตัวหนาใหญ่ในการ์ดคือหัวข้อที่ทุกใบเหมือนกันหมด */
  const columns = [
    { label: 'เมื่อ', render: (r) => logTime(r.at), cls: 'nowrap', mobile: 'subtitle' },
    {
      label: 'ผู้ใช้',
      mobile: 'subtitle',
      render: (r) => (r.actor_name || <span className="log-empty">(ยังไม่เข้าระบบ)</span>),
    },
    { label: 'ชนิด', mobile: 'status', render: (r) => <KindBadge kind={r.kind} /> },
    { label: 'สิ่งที่ทำ', key: 'summary', mobile: 'title' },
    {
      label: 'เปลี่ยน',
      cls: 'nowrap',
      /* ท้ายการ์ด ไม่ใช่คู่ป้าย/ค่า — แถวส่วนใหญ่ไม่มีอะไรเปลี่ยน ถ้าเป็นคู่ป้าย
         จะได้คำว่า "เปลี่ยน" ห้อยอยู่กับความว่างเปล่าในเกือบทุกใบ */
      mobile: 'extra',
      render: (r) => (r.changes?.length
        ? <span className="log-chg">{r.changes.length} ช่อง</span>
        : ''),
    },
    /* สองคอลัมน์นี้ไม่ขึ้นบนมือถือเลย ไม่ใช่พับเก็บใต้ "ดูเพิ่มเติม"
       การ์ดที่มีทั้งปุ่มพับและปุ่ม "ดูรายละเอียด" คือสองทางไปหาของชิ้นเดียวกัน
       และกล่องรายละเอียดมีทั้งเส้นทางและรหัสผลอยู่แล้ว · ส่วนแถวที่พัง ป้ายสีแดง
       "ข้อผิดพลาด" บอกไปแล้วตั้งแต่หัวการ์ด เลข 500 จึงไม่ได้เพิ่มอะไร */
    {
      label: 'เส้นทาง',
      cls: 'mono nowrap',
      mobile: false,
      render: (r) => `${r.method} ${r.path}`,
    },
    {
      label: 'ผล',
      cls: 'num',
      mobile: false,
      render: (r) => (Number(r.status) >= 400
        ? <b className="log-bad">{r.status}</b>
        : r.status),
    },
  ];

  return (
    <div>
      <PageHead
        icon="clock"
        title="Activity Log"
        subtitle="บันทึกการใช้งาน — ใครทำอะไร เมื่อไหร่"
      />

      {!error && (
        <Kpis>
          <Kpi
            label="วันนี้ทั้งหมด"
            value={today ? today.total.toLocaleString('th-TH') : '…'}
            sub={oldest ? `เก็บย้อนหลังถึง ${fmtDate(oldest)}` : null}
          />
          <Kpi label="การแก้ข้อมูลวันนี้" value={today ? today.audit.toLocaleString('th-TH') : '…'} />
          <Kpi
            label="ข้อผิดพลาดวันนี้"
            value={today ? today.error.toLocaleString('th-TH') : '…'}
            kind={today && today.error > 0 ? 'warn' : ''}
          />
          <Kpi label="คนที่ใช้งานวันนี้" value={today ? today.actors.toLocaleString('th-TH') : '…'} />
        </Kpis>
      )}

      <FilterBar
        count={activeFilters}
        resultCount={total}
        onReset={clearAll}
        actions={(
          <button type="button" className="btn btn-light" onClick={exportCsv}>
            <Icon name="download" /> ส่งออก CSV
          </button>
        )}
        search={(
          <div className="search-field">
            <Icon name="search" />
            <input
              type="search"
              placeholder="ชื่อคน / สิ่งที่ทำ / เส้นทาง / ค่าที่เปลี่ยน"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
          </div>
        )}
      >
        <Field label="ชนิด">
          <Select value={kind} onChange={(e) => setKind(e.target.value)} options={KIND_OPTIONS} />
        </Field>
        <Field label="ใคร">
          <Select value={actorId} onChange={(e) => setActorId(e.target.value)} options={actorOptions} />
        </Field>
        <Field label="ช่วงวันที่">
          <DateRangeField
            split
            clearable
            placeholder="ทั้งหมด"
            from={from}
            to={to}
            onApply={({ from: f, to: t }) => { setFrom(f); setTo(t); }}
          />
        </Field>
        <button type="button" className="btn btn-light" onClick={setToday}>วันนี้</button>
      </FilterBar>

      {loading && <Loading />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (
        <Card tight>
          <DataTable
            columns={columns}
            rows={rows}
            /* แบ่งหน้าที่ API แล้ว — แถวที่ได้มาคือหน้านี้ทั้งหมด ไม่ต้องหั่นซ้ำ */
            page={1}
            perPage={perPage}
            onRowClick={setDetail}
            empty={activeFilters || q.trim()
              ? 'ไม่มีบันทึกที่ตรงกับตัวกรองนี้'
              : 'ยังไม่มีบันทึกการใช้งาน'}
          />
          <Pager
            total={total}
            page={page}
            perPage={perPage}
            onPage={setPage}
            onPerPage={setPerPage}
          />
        </Card>
      )}

      <LogDetail row={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

/* งานของแอดมิน — พนักงานขายที่พิมพ์ URL เข้ามาตรง ๆ จะเห็นคำอธิบาย
   ไม่ใช่หน้าเปล่าหรือถูกเด้งกลับเงียบ ๆ */
export default function LogsPage() {
  return <AdminOnly zone="system"><LogsPageInner /></AdminOnly>;
}
