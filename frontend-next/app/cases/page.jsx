'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync, useDebounced } from '../../lib/hooks.js';
import { Badge, Card, Check, Field, Loading, PageHead, Toolbar } from '../../components/ui.jsx';
import { QueryParamPage } from '../../components/QueryParamPage.jsx';
import { STAGE_GROUPS, stageInfo } from '../../lib/constants.js';
import { fmtDate, moneyShort } from '../../lib/format.js';

function CaseCard({ c, onOpen }) {
  const late = c.expected_arrival
    && new Date(c.expected_arrival) < new Date()
    && c.lens_status === 'waiting_arrival';

  return (
    <div className={`case-card ${Number(c.is_rush) ? 'rush' : ''}`} onClick={() => onOpen(c)}>
      <div className="cc-top">
        <b>{[c.first_name, c.last_name].filter(Boolean).join(' ')}</b>
        {Number(c.is_rush) ? <Badge kind="danger">🔥 ด่วน</Badge> : null}
      </div>
      <div className="cc-code">{`${c.case_code}${c.invoice_code ? ' · ' + c.invoice_code : ''}`}</div>
      <div className="cc-status">{`${c.stage_no} ${c.status_label_th}`}</div>
      {(c.lens_name || c.frame_name) && (
        <div className="cc-item">{[c.lens_name, c.frame_name].filter(Boolean).join(' / ')}</div>
      )}
      <div className="cc-foot">
        {c.appointment_date
          ? <span>{'📅 ' + fmtDate(c.appointment_date)}</span>
          : <span className="muted">—</span>}
        {c.balance !== null && c.balance !== undefined
          ? <span>{'ค้าง ' + moneyShort(c.balance)}</span>
          : null}
      </div>
      <div className="cc-foot">
        <span className="muted">{`เปิดมา ${c.age_days} วัน`}</span>
        {late ? <Badge kind="danger">เลนส์เลย ETA</Badge> : null}
        {Number(c.is_waiting) ? <Badge kind="warn">รอ</Badge> : null}
      </div>
    </div>
  );
}

function CaseBoardInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [term, setTerm] = useState(params.get('q') || '');
  const [rushOnly, setRushOnly] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const q = useDebounced(term, 250);

  const { data: rows, loading, error, reload } = useAsync(
    () => api.get('/api/cases', {
      q: q.trim(),
      rush: rushOnly ? 1 : '',
      open: showDone ? 0 : '',
      limit: 500,
    }),
    [q, rushOnly, showDone]
  );

  const byGroup = {};
  for (const r of rows || []) (byGroup[r.stage_group] ||= []).push(r);
  const groups = showDone ? [...STAGE_GROUPS, 'done'] : STAGE_GROUPS;

  return (
    <div>
      <PageHead
        icon="🗂"
        title="Case Board"
        subtitle="กระดานงานในร้าน"
        actions={(
          <>
            <Link className="btn btn-ghost" href="/cases/new">+ เปิดเคสใหม่</Link>
            <Link className="btn btn-ghost" href="/lens-tracker">🔎 ติดตามเลนส์</Link>
          </>
        )}
      />

      <Toolbar>
        <Field label="ค้นหา" className="grow">
          <input
            type="search"
            placeholder="ค้นหา เคส / ลูกค้า / เบอร์ / Invoice"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </Field>
        <Check checked={rushOnly} onChange={(e) => setRushOnly(e.target.checked)}>ด่วนเท่านั้น 🔥</Check>
        <Check checked={showDone} onChange={(e) => setShowDone(e.target.checked)}>แสดงเคสที่จบแล้ว</Check>
        <button type="button" className="btn btn-light" onClick={reload}>↻ รีเฟรช</button>
      </Toolbar>

      {loading && <Loading />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (
        <div className="board">
          {groups.map((g) => {
            const info = stageInfo(g);
            const list = byGroup[g] || [];
            return (
              <div className="board-col" key={g}>
                <div className="board-head" style={{ borderTopColor: info.color }}>
                  <span>{`${info.icon} ${info.label}`}</span>
                  <Badge kind="gray">{list.length}</Badge>
                </div>
                <div className="board-body">
                  {list.length
                    ? list.map((c) => (
                      <CaseCard key={c.id} c={c} onOpen={(x) => router.push('/cases/detail?id=' + x.id)} />
                    ))
                    : <div className="board-empty">—</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CaseBoardPage() {
  return (
    <QueryParamPage>
      <CaseBoardInner />
    </QueryParamPage>
  );
}
