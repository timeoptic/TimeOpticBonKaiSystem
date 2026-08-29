'use client';
/**
 * Case Board.
 *
 * The shop reads this list two ways before it reads it any other way: งาน
 * SIGHTFIRST and งานลูกค้าร้าน are different books of work with different
 * people chasing them, so that split is the first control on the page rather
 * than something buried in a dropdown. A case nobody labelled is the shop's
 * own — walking in the door is the default, not a missing value.
 *
 * Filtering happens in the browser on purpose: the counts on every chip stay
 * live and switching views costs nothing. The same filters exist on
 * GET /api/cases for anything that needs them server-side.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync, useDebounced } from '../../lib/hooks.js';
import { Badge, Card, Field, Loading, PageHead } from '../../components/ui.jsx';
import { QueryParamPage } from '../../components/QueryParamPage.jsx';
import { useMeta } from '../../contexts/MetaContext.jsx';
import { STAGE_GROUPS, stageInfo } from '../../lib/constants.js';
import { fmtDate, moneyShort } from '../../lib/format.js';
import { Icon } from '../../components/Icon.jsx';

const SIGHTFIRST = 'SIGHTFIRST';

/* the four yes/no views of the board. Four bare checkboxes in a row read as a
   settings dialog; the same four as chips read as "what am I looking at". */
const TOGGLES = [
  ['rush', 'ด่วนเท่านั้น', 'flame'],
  ['unpaid', 'ค้างชำระ', 'coins'],
  ['hideEmpty', 'ซ่อนขั้นที่ว่าง', null],
  ['showDone', 'เคสที่จบแล้ว', 'checkCircle'],
];

/** the two books of work, plus everything at once */
const CLIENTS = [
  ['', 'ทั้งหมด', null],
  ['sightfirst', 'SightFirst', (c) => c.case_type === SIGHTFIRST],
  ['shop', 'ลูกค้าร้าน', (c) => c.case_type !== SIGHTFIRST],
];

function CaseCard({ c, onOpen }) {
  const owed = Number(c.balance) > 0;

  return (
    <div className={`case-card ${Number(c.is_rush) ? 'rush' : ''}`} onClick={() => onOpen(c)}>
      <div className="cc-top">
        <b>{[c.first_name, c.last_name].filter(Boolean).join(' ')}</b>
        {Number(c.is_rush) ? <Badge kind="danger"><Icon name="flame" /> ด่วน</Badge> : null}
      </div>
      <div className="cc-code">{`${c.case_code}${c.invoice_code ? ' · ' + c.invoice_code : ''}`}</div>
      {c.case_type ? (
        <div className="cc-tags">
          <Badge kind={c.case_type === SIGHTFIRST ? 'blue' : 'gray'}>{c.case_type}</Badge>
        </div>
      ) : null}
      <div className="cc-status">
        <Icon name={stageInfo(c.process_stage || c.stage_group).icon} />
        {' '}{stageInfo(c.process_stage || c.stage_group).label}
        <span className="muted">{` · ${c.process_done ?? 0}/${STAGE_GROUPS.length} ขั้น`}</span>
      </div>
      <div className="cc-sub muted">{`สถานะ: ${c.status_label_th}`}</div>
      {(c.lens_name || c.frame_name) && (
        <div className="cc-item">{[c.lens_name, c.frame_name].filter(Boolean).join(' / ')}</div>
      )}
      <div className="cc-foot">
        {c.appointment_date
          ? <span><Icon name="calendar" /> {fmtDate(c.appointment_date)}</span>
          : <span className="muted">—</span>}
        {owed ? <span className="cc-owed">{'ค้าง ' + moneyShort(c.balance)}</span> : null}
      </div>
      <div className="cc-foot">
        <span className="muted">{`เปิดมา ${c.age_days} วัน`}</span>
        {Number(c.is_waiting) ? <Badge kind="warn">รอ</Badge> : null}
      </div>
    </div>
  );
}

function CaseBoardInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { meta } = useMeta();

  const [term, setTerm] = useState(params.get('q') || '');
  const [client, setClient] = useState(params.get('client') || '');
  const [caseType, setCaseType] = useState('');
  const [toggles, setToggles] = useState({
    rush: false, unpaid: false, hideEmpty: true, showDone: false,
  });
  const setToggle = (k, v) => setToggles((t) => ({ ...t, [k]: v }));
  const { rush: rushOnly, unpaid: unpaidOnly, hideEmpty, showDone } = toggles;
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

  const all = rows || [];
  const shown = useMemo(() => {
    const pick = (CLIENTS.find(([v]) => v === client) || [])[2];
    return all.filter((c) => (!pick || pick(c))
      && (!caseType || c.case_type === caseType)
      && (!unpaidOnly || Number(c.balance) > 0));
  }, [all, client, caseType, unpaidOnly]);

  /* Columns come from what the case has actually finished (process_stage,
     computed by the API), not from cases.status — that one is set by hand and
     drifts: a case could sit in "ส่งมอบ" with no order and no centering. */
  const byGroup = {};
  for (const r of shown) (byGroup[r.process_stage || r.stage_group] ||= []).push(r);
  const groups = (showDone ? [...STAGE_GROUPS, 'done'] : STAGE_GROUPS)
    .filter((g) => !hideEmpty || (byGroup[g] || []).length);

  const types = meta.lists?.case_type || [];

  return (
    <div>
      <PageHead
        icon="🗂"
        title="Case Board"
        subtitle="กระดานงานในร้าน"
        actions={(
          <>
            <Link className="btn btn-ghost" href="/cases/new">+ เปิดเคสใหม่</Link>
            <Link className="btn btn-ghost" href="/delivery"><Icon name="box" /> กระดานส่งมอบ</Link>
          </>
        )}
      />

      <div className="seg">
        {CLIENTS.map(([value, label, pick]) => (
          <button
            type="button"
            key={value || 'all'}
            className={client === value ? 'active' : ''}
            onClick={() => setClient(value)}
          >
            {label}
            <Badge kind="gray">{pick ? all.filter(pick).length : all.length}</Badge>
          </button>
        ))}
      </div>

      <div className="board-filters">
        <div className="bf-row">
          <Field label="ค้นหา" className="grow">
            <input
              type="search"
              placeholder="ค้นหา เคส / ลูกค้า / เบอร์ / Invoice"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
          </Field>
          <Field label="ประเภทงาน">
            <select value={caseType} onChange={(e) => setCaseType(e.target.value)}>
              <option value="">ทั้งหมด</option>
              {types.map((t) => {
                const [v, label] = Array.isArray(t) ? t : [t, t];
                return <option key={v} value={v}>{label}</option>;
              })}
            </select>
          </Field>
          <button type="button" className="btn btn-light bf-refresh" onClick={reload}>
            <Icon name="refresh" /> รีเฟรช
          </button>
        </div>
        <div className="bf-chips">
          {TOGGLES.map(([key, label, icon]) => (
            <button
              type="button"
              key={key}
              className={`chip ${toggles[key] ? 'active' : ''}`}
              aria-pressed={toggles[key]}
              onClick={() => setToggle(key, !toggles[key])}
            >
              {icon ? <Icon name={icon} /> : null}{label}
            </button>
          ))}
        </div>
      </div>

      {loading && <Loading />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (
        groups.length ? (
          <div className="board">
            {groups.map((g) => {
              const info = stageInfo(g);
              const list = byGroup[g] || [];
              return (
                <div className="board-col" key={g}>
                  <div className="board-head" style={{ borderTopColor: info.color }}>
                    <span><Icon name={info.icon} /> {info.label}</span>
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
        ) : <Card><p className="muted">ไม่มีเคสที่ตรงกับตัวกรอง</p></Card>
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
