'use client';
/**
 * Case Board.
 *
 * The shop reads this list two ways before it reads it any other way: งาน
 * Sight First and งานลูกค้าร้าน are different books of work with different
 * people chasing them, so that split is the first control on the page rather
 * than something buried in a dropdown. A case nobody labelled is the shop's
 * own — walking in the door is the default, not a missing value.
 *
 * That split reads `customer_category`. It used to read `case_type`, which also
 * had to say what kind of job the case was — one column answering two questions
 * means neither answer is reliable.
 *
 * Filtering happens in the browser on purpose: the counts on every chip stay
 * live and switching views costs nothing. The same filters exist on
 * GET /api/cases for anything that needs them server-side.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../lib/apiClient.js';
import { useAsync, useDebounced } from '../../../lib/hooks.js';
import { Badge, Card, Field, Loading, PageHead } from '../../../components/ui.jsx';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { STAGE_GROUPS, stageInfo } from '../../../lib/constants.js';
import { DONE_STAGE } from '../../../lib/caseProcesses.js';
import { custName, fmtDate, moneyShort } from '../../../lib/format.js';
import { Icon } from '../../../components/Icon.jsx';
import { CaseTags, SIGHT_FIRST } from '../../../components/CaseTags.jsx';

/* the four yes/no views of the board. Four bare checkboxes in a row read as a
   settings dialog; the same four as chips read as "what am I looking at".
   "ซ่อนขั้นที่ว่าง" ไม่มีความหมายตอนดูเคสที่จบแล้ว — ทุกใบอยู่กองเดียวกัน */
const TOGGLES = [
  ['rush', 'ด่วนเท่านั้น', 'flame'],
  ['unpaid', 'ค้างชำระ', 'coins'],
  ['hideEmpty', 'ซ่อนขั้นที่ว่าง', null],
  ['showDone', 'เคสที่จบแล้ว', 'checkCircle'],
];

/** การ์ดคือกระดาน ลิสต์คือตาราง — ข้อมูลชุดเดียวกัน คนละวิธีกวาดตา */
const VIEWS = [
  ['card', 'การ์ด', 'board'],
  ['list', 'ลิสต์', 'clipboard'],
];

/** the two books of work, plus everything at once */
const CLIENTS = [
  ['', 'ทั้งหมด', null],
  ['sightfirst', 'SightFirst', (c) => c.customer_category === SIGHT_FIRST],
  ['shop', 'ลูกค้าร้าน', (c) => c.customer_category !== SIGHT_FIRST],
];

function CaseCard({ c, onOpen }) {
  const owed = Number(c.balance) > 0;

  return (
    <div className={`case-card ${Number(c.is_rush) ? 'rush' : ''}`} onClick={() => onOpen(c)}>
      <div className="cc-top">
        <b>{custName(c)}</b>
        {Number(c.is_rush) ? <Badge kind="danger"><Icon name="flame" /> ด่วน</Badge> : null}
      </div>
      <div className="cc-code">{`${c.case_code}${c.invoice_code ? ' · ' + c.invoice_code : ''}`}</div>
      {c.customer_category === SIGHT_FIRST || c.case_type ? (
        <div className="cc-tags"><CaseTags row={c} /></div>
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

/**
 * มุมมองลิสต์ — ข้อมูลชุดเดียวกับการ์ด แต่เรียงเป็นแถวให้กวาดตาลงทีเดียวจบ
 * และเทียบกันได้ตรง ๆ (การ์ดตอบ "กองไหนแน่น" ลิสต์ตอบ "ใบไหนเป็นใบไหน")
 */
function CaseList({ rows, showDone, onOpen }) {
  return (
    <DataTable
      className="data-grid"
      rows={rows}
      onRowClick={onOpen}
      empty="ไม่มีเคสที่ตรงกับตัวกรอง"
      columns={[
        {
          label: 'Case ID',
          cls: 'nowrap',
          render: (c) => (
            <div className="cell-2">
              <b className="mono">
                {c.case_code}
                {Number(c.is_rush) ? <> <Badge kind="danger"><Icon name="flame" /> ด่วน</Badge></> : null}
              </b>
              <small className="cell-tags">
                {`เปิด: ${fmtDate(c.opened_at)}`}
                <CaseTags row={c} />
              </small>
            </div>
          ),
        },
        {
          label: 'ลูกค้า',
          render: (c) => (
            <div className="cell-2">
              <span>{custName(c)}</span>
              <small>{c.phone || '—'}</small>
            </div>
          ),
        },
        {
          label: 'สินค้า',
          render: (c) => (
            <div className="cell-2">
              <span>{c.frame_name || '—'}</span>
              <small>{c.lens_name || '—'}</small>
            </div>
          ),
        },
        {
          label: 'ขั้นตอน',
          cls: 'nowrap',
          render: (c) => {
            const info = stageInfo(c.process_stage || c.stage_group);
            return (
              <div className="cell-2">
                <span><Icon name={info.icon} /> {info.label}</span>
                <small className="muted">
                  {showDone
                    ? c.status_label_th
                    : `${c.process_done ?? 0}/${STAGE_GROUPS.length} ขั้น · ${c.status_label_th}`}
                </small>
              </div>
            );
          },
        },
        {
          label: 'ยอดคงเหลือ',
          cls: 'nowrap',
          render: (c) => {
            if (!c.order_id) return <span className="muted">—</span>;
            return Number(c.balance) > 0
              ? <b className="dlv-due">{moneyShort(c.balance)}</b>
              : <Badge kind="ok dot">ชำระครบ</Badge>;
          },
        },
        /* เคสที่จบแล้วไม่มีนัดข้างหน้าให้ดู — ที่อยากรู้คือปิดไปเมื่อไหร่ */
        showDone ? {
          label: 'ปิดเมื่อ',
          cls: 'nowrap',
          render: (c) => (c.closed_at ? fmtDate(c.closed_at) : '—'),
        } : {
          label: 'นัดรับ',
          cls: 'nowrap',
          render: (c) => (c.appointment_date ? fmtDate(c.appointment_date) : '—'),
        },
      ]}
    />
  );
}

function CaseBoardInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [term, setTerm] = useState(params.get('q') || '');
  const [client, setClient] = useState(params.get('client') || '');
  /* กรองด้วย "ขั้นตอน" ไม่ใช่ "ประเภทงาน" — คนเปิดกระดานถามว่าตอนนี้งานค้างอยู่ขั้นไหน
     ไม่ได้ถามว่าเป็นงานตัดใหม่หรือเปลี่ยนเลนส์ (อันนั้นดูที่ป้ายในแถวได้อยู่แล้ว) */
  const [stage, setStage] = useState('');
  const [view, setView] = useState('card');
  const [toggles, setToggles] = useState({
    rush: false, unpaid: false, hideEmpty: true, showDone: false,
  });
  const setToggle = (k, v) => {
    setToggles((t) => ({ ...t, [k]: v }));
    /* สลับไป/กลับจาก "เคสที่จบแล้ว" แล้วขั้นตอนที่เลือกไว้ใช้ไม่ได้อีก — ล้างทิ้ง
       ไม่งั้นกระดานจะว่างเปล่าโดยที่คนกดไม่รู้ว่าเพราะตัวกรองที่ค้างอยู่ */
    if (k === 'showDone') setStage('');
  };
  const { rush: rushOnly, unpaid: unpaidOnly, hideEmpty, showDone } = toggles;
  const q = useDebounced(term, 250);

  /* "เคสที่จบแล้ว" = ดูเฉพาะเคสที่ปิดแล้ว ไม่ใช่เอามาต่อท้ายคิวที่ยังทำอยู่ —
     สองกองนี้ตอบคนละคำถาม ("วันนี้ต้องทำอะไร" กับ "ที่ทำไปแล้วมีอะไรบ้าง") */
  const { data: rows, loading, error, reload } = useAsync(
    () => api.get('/api/cases', {
      q: q.trim(),
      rush: rushOnly ? 1 : '',
      closed: showDone ? 1 : '',
      limit: 500,
    }),
    [q, rushOnly, showDone]
  );

  const all = rows || [];
  const shown = useMemo(() => {
    const pick = (CLIENTS.find(([v]) => v === client) || [])[2];
    return all.filter((c) => (!pick || pick(c))
      && (!stage || (c.process_stage || c.stage_group) === stage)
      && (!unpaidOnly || Number(c.balance) > 0));
  }, [all, client, stage, unpaidOnly]);

  /* Columns come from what the case has actually finished (process_stage,
     computed by the API), not from cases.status — that one is set by hand and
     drifts: a case could sit in "ส่งมอบ" with no order and no centering. */
  const byGroup = {};
  for (const r of shown) (byGroup[r.process_stage || r.stage_group] ||= []).push(r);
  const groups = showDone
    ? ['done']
    : STAGE_GROUPS.filter((g) => !hideEmpty || (byGroup[g] || []).length);

  /* ตัวเลือกต้องตรงกับคอลัมน์ที่กระดานใช้จริง — เคสที่จบแล้วอยู่ขั้น "จบงาน" ที่เดียว */
  const stageOptions = showDone ? [DONE_STAGE.id] : STAGE_GROUPS;
  const openCase = (c) => router.push('/cases/detail?id=' + c.id);

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
          <Field label="ขั้นตอน">
            <select value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="">ทั้งหมด</option>
              {stageOptions.map((g) => (
                <option key={g} value={g}>{stageInfo(g).label}</option>
              ))}
            </select>
          </Field>
          <button type="button" className="btn btn-light bf-refresh" onClick={reload}>
            <Icon name="refresh" /> รีเฟรช
          </button>
        </div>
        <div className="bf-chips">
          {TOGGLES.filter(([key]) => !(showDone && key === 'hideEmpty')).map(([key, label, icon]) => (
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
          <div className="seg seg-sm bf-view">
            {VIEWS.map(([value, label, icon]) => (
              <button
                type="button"
                key={value}
                className={view === value ? 'active' : ''}
                aria-pressed={view === value}
                onClick={() => setView(value)}
              >
                <Icon name={icon} /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && <Loading />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && view === 'list' && (
        <Card tight>
          <CaseList rows={shown} showDone={showDone} onOpen={openCase} />
        </Card>
      )}
      {!loading && !error && view === 'card' && (
        groups.length ? (
          /* กองเดียวไม่ต้องเป็นคอลัมน์ผอม ๆ — ปล่อยการ์ดไหลเต็มความกว้าง */
          <div className={`board ${showDone ? 'board-one' : ''}`.trim()}>
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
                      ? list.map((c) => <CaseCard key={c.id} c={c} onOpen={openCase} />)
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
