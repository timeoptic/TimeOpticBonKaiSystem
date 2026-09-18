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
 * ─────────────────────────────────────────────────────────────────────────
 * ค้นหา กรอง นับ และแบ่งหน้า ทำที่ฝั่ง API ทั้งหมด
 * ─────────────────────────────────────────────────────────────────────────
 *
 * เดิมหน้านี้ขอเคสมาทีเดียวทั้งกอง (`limit: 3000`) แล้วกรองในเบราว์เซอร์
 * เหตุผลตอนนั้นคือ "ตัวเลขบนชิปจะได้ตรง และสลับมุมมองไม่ต้องยิงซ้ำ" ซึ่งพังลง
 * เมื่อข้อมูลจริงเข้ามา:
 *
 *   · เคสที่ยังทำไม่จบมี 1,173 ใบ = ส่งข้อมูลราว 1 MB **ใหม่ทุกครั้ง**
 *     ที่พิมพ์ค้นหาหรือกดชิป แล้ววาดการ์ดครบ 1,173 ใบลง DOM พร้อมกัน
 *   · กด "เคสที่จบแล้ว" มี 7,752 ใบ แต่เพดานอยู่ที่ 3,000 → หายไปเงียบ ๆ
 *     4,752 ใบ และตัวเลขบนชิปที่นับจากแถวที่โหลดมาก็ผิดตามไปด้วย
 *
 * ตอนนี้ API คืน 20 ใบต่อคอลัมน์ พร้อม `counts` และ `by_stage` ที่นับจากของจริง
 * ทั้งกอง — ยอดบนหัวคอลัมน์จึงตรงเสมอโดยไม่ต้องโหลดทุกใบมานับเอง และไม่มี
 * เพดานให้ชนอีก (ดู `caseBoardPage()` ใน api/routes/cases.php)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ตัวกรองสี่กลุ่ม ไม่ใช่ชิปกองเดียว
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ของเดิมวางชิปสี่อันไว้แถวเดียวกันหน้าตาเหมือนกันหมด: ด่วน / ค้างชำระ /
 * ซ่อนขั้นที่ว่าง / เคสที่จบแล้ว · สามอันแรกกดสะสมกันได้ อันที่สามไม่ใช่ตัวกรอง
 * เคสด้วยซ้ำ (มันซ่อนคอลัมน์) ผลคือกด "จบแล้ว + ด่วน + ค้างชำระ" แล้วได้กระดาน
 * ว่างเปล่าโดยไม่มีอะไรบอกว่าเพราะอะไร
 *
 * จึงแยกเป็นสี่กลุ่มที่มีป้ายกำกับของตัวเอง — ประเภทลูกค้า / ตัวกรองเคส /
 * ขั้นตอน เลือกได้กลุ่มละหนึ่งและใช้ร่วมกันได้ ส่วน "ซ่อนขั้นที่ว่าง" เป็นสวิตช์
 * ในกลุ่ม "การแสดงผล" เพราะมันไม่ได้กรองเคสออก มันซ่อนคอลัมน์
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../lib/apiClient.js';
import { useAsync, useDebounced } from '../../../lib/hooks.js';
import { Badge, Card, Loading, PageHead } from '../../../components/ui.jsx';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { FilterSheet } from '../../../components/FilterBar.jsx';
import { Pager } from '../../../components/Pager.jsx';
import { BOARD_PAGE_SIZES } from '../../../lib/pager.js';
import { STAGE_GROUPS, stageInfo } from '../../../lib/constants.js';
import {
  CARD_PAGE, CASE_FILTERS, boardColumns, boardQuery, dateFieldOptions, stageOptions,
} from '../../../lib/caseBoard.js';
import { DateField } from '../../../components/DateField.jsx';
import { custName, fmtDate, moneyShort } from '../../../lib/format.js';
import { Icon } from '../../../components/Icon.jsx';
import { CaseTags, SIGHT_FIRST } from '../../../components/CaseTags.jsx';
import { RxLensBadge } from '../../../components/RxLensBadge.jsx';
import { Select } from '../../../components/Selects.jsx';

/** the two books of work, plus everything at once */
const CLIENTS = [
  ['', 'ทั้งหมด', 'all'],
  ['sightfirst', 'SightFirst', 'sightfirst'],
  ['shop', 'ลูกค้าร้าน', 'shop'],
];

/** การ์ดคือกระดาน ลิสต์คือตาราง — ข้อมูลชุดเดียวกัน คนละวิธีกวาดตา */
const VIEWS = [
  ['card', 'การ์ด', 'board'],
  ['list', 'ลิสต์', 'menu'],
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
        {/* ตัวหารมาจากเคสใบนั้น ไม่ใช่ค่าคงที่ของทั้งแอป — เคสตรวจสายตามีสองขั้น
            ถ้าหารด้วย 6 การ์ดจะเขียนว่า "2/6 ขั้น" เหมือนงานค้าง ทั้งที่จบแล้ว
            คำตอบเก่าที่ยังไม่มี process_total ให้ตกกลับไปใช้ค่าเดิม */}
        <span className="muted">{` · ${c.process_done ?? 0}/${c.process_total ?? STAGE_GROUPS.length} ขั้น`}</span>
      </div>
      <div className="cc-sub muted">{`สถานะ: ${c.status_label_th}`}</div>
      {(c.lens_name || c.frame_name) && (
        <div className="cc-item">{[c.lens_name, c.frame_name].filter(Boolean).join(' / ')}</div>
      )}
      {/* เลนส์สั่งตัดมาถึงร้านหรือยัง — คลังติ๊กบนหน้าใบสั่งตัด (ร้านขอไว้ 14 ก.ย. 2026) */}
      {Number(c.rx_lens_total) ? <div className="cc-tags"><RxLensBadge row={c} /></div> : null}
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
      empty="ไม่พบเคสที่ตรงกับตัวกรองที่เลือก"
      cardAction="เปิดเคส"
      columns={[
        {
          label: 'Case ID',
          cls: 'nowrap',
          mobile: 'title',
          render: (c) => (
            <div className="cell-2">
              <b className="mono">
                {c.case_code}
                {Number(c.is_rush) ? <> <Badge kind="danger"><Icon name="flame" /> ด่วน</Badge></> : null}
              </b>
              <small className="cell-tags">
                {`เปิด: ${fmtDate(c.opened_at)}`}
                <CaseTags row={c} />
                <RxLensBadge row={c} />
              </small>
            </div>
          ),
        },
        {
          label: 'ลูกค้า',
          mobile: 'subtitle',
          render: (c) => (
            <div className="cell-2">
              <span>{custName(c)}</span>
              <small>{c.phone || '—'}</small>
            </div>
          ),
        },
        /* กรอบกับเลนส์เป็นข้อมูลลำดับสอง — บนมือถือพับไว้ใต้ "ดูเพิ่มเติม"
           คนที่เปิดกระดานงานบนมือถือกำลังหาว่า "ใบไหนถึงคิวแล้ว" ไม่ใช่ว่าใบนี้ใช้เลนส์รุ่นไหน */
        {
          label: 'สินค้า',
          mobile: 'meta',
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
          mobile: 'body',
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
          mobile: 'body',
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
          mobile: 'body',
          render: (c) => (c.closed_at ? fmtDate(c.closed_at) : '—'),
        } : {
          label: 'นัดรับ',
          cls: 'nowrap',
          mobile: 'body',
          render: (c) => (c.appointment_date ? fmtDate(c.appointment_date) : '—'),
        },
      ]}
    />
  );
}

/**
 * ไม่มีเคสไหนเข้าเงื่อนไข — บอกว่าเพราะตัวกรอง แล้วยื่นทางออกให้ ไม่ปล่อยหน้าว่าง
 *
 * กระดานที่ว่างเพราะยังไม่มีเคสในร้านเป็นคนละเรื่องกับกระดานที่ว่างเพราะตัวกรอง
 * — อันแรกไม่มีอะไรให้ล้าง ยื่นปุ่มล้างตัวกรองไปก็กดแล้วไม่มีอะไรเกิดขึ้น
 */
function NoMatch({ hasFilter, onClear }) {
  return (
    <Card>
      <div className="board-none">
        <Icon name={hasFilter ? 'search' : 'board'} />
        <b>{hasFilter ? 'ไม่พบเคสที่ตรงกับตัวกรองที่เลือก' : 'ยังไม่มีเคสในกระดาน'}</b>
        {hasFilter ? (
          <button type="button" className="btn btn-light" onClick={onClear}>
            <Icon name="x" /> ล้างตัวกรอง
          </button>
        ) : (
          <Link className="btn btn-light" href="/cases/new">+ เปิดเคสใหม่</Link>
        )}
      </div>
    </Card>
  );
}

function CaseBoardInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [term, setTerm] = useState(params.get('q') || '');
  const [client, setClient] = useState(params.get('client') || '');
  /* กรองด้วย "ขั้นตอน" ไม่ใช่ "ประเภทงาน" — คนเปิดกระดานถามว่าตอนนี้งานค้างอยู่ขั้นไหน
     ไม่ได้ถามว่าเป็นงานตัดใหม่หรือเปลี่ยนเลนส์ (อันนั้นดูที่ป้ายในแถวได้อยู่แล้ว)

     อ่านจาก URL เหมือน q กับ client ข้างบน — ชิปในการ์ด "งานค้างแต่ละขั้นตอน"
     ของหน้าเมนูหลักลิงก์มาที่ /cases?stage=... มาตลอด แต่บรรทัดนี้เคยเป็น
     useState('') เฉย ๆ ทุกชิปจึงพามาที่กระดานที่ไม่ถูกกรอง — เหมือนกันหมดทุกใบ */
  const [stage, setStage] = useState(params.get('stage') || '');
  const [caseFilter, setCaseFilter] = useState('');
  /* ช่วงวันที่ อ่านจาก URL เหมือนตัวกรองข้างบน — ลิงก์ /cases?from=...&to=... ส่งต่อกันได้ */
  const [dateField, setDateField] = useState(params.get('date_field') || 'opened');
  const [from, setFrom] = useState(params.get('from') || '');
  const [to, setTo] = useState(params.get('to') || '');
  const [view, setView] = useState('card');
  const [hideEmpty, setHideEmpty] = useState(true);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(BOARD_PAGE_SIZES[0]);
  /**
   * 350 ms — ยาวกว่าเดิมหนึ่งขั้น
   *
   * คำขอของกระดานหนักกว่าตารางอื่นในแอป (ต้องคำนวณขั้นของทุกใบที่ตรงตัวกรอง
   * เพื่อจะนับ) การยิงระหว่างพิมพ์จึงมีราคาจริง · useAsync ยกเลิกคำขอเก่าให้
   * อยู่แล้ว คำที่พิมพ์ค้างไว้ครึ่งคำจึงไม่มีทางแซงคำเต็มขึ้นมาแสดง
   */
  const q = useDebounced(term, 350);

  const showDone = caseFilter === 'done';

  /* ตัวกรองชุดเดียว ใช้ทั้งกับจำนวนเคสและกับรายการที่แสดง — เลขบนหัวคอลัมน์
     กับการ์ดในคอลัมน์นั้นจึงมาจากคำถามเดียวกันเสมอ (lib/caseBoard.js, มีเทสต์) */
  const filters = useMemo(
    () => boardQuery({ q, client, stage, caseFilter, dateField, from, to }),
    [q, client, stage, caseFilter, dateField, from, to],
  );

  const { data, loading, error, reload } = useAsync(
    (signal) => api.get(
      '/api/cases',
      view === 'card'
        ? { ...filters, group_by: 'stage', per_group: CARD_PAGE }
        : { ...filters, limit: perPage, offset: (page - 1) * perPage },
      signal,
    ),
    [filters, view, page, perPage],
  );

  /* การ์ดที่ "โหลดเพิ่ม" มาต่อท้ายชุดแรกของคอลัมน์นั้น ๆ */
  const [extra, setExtra] = useState({});
  const [busy, setBusy] = useState('');
  const [moreError, setMoreError] = useState('');

  /* เปลี่ยนตัวกรองเมื่อไหร่ = เริ่มนับหนึ่งใหม่ ทั้งเลขหน้าของลิสต์และของที่
     โหลดเพิ่มมาในทุกคอลัมน์ · ไม่ล้างแล้วจะเหลือการ์ดของตัวกรองก่อนหน้าคาไว้ */
  useEffect(() => {
    setExtra({});
    setBusy('');
    setMoreError('');
    setPage(1);
  }, [filters, view]);

  const loadMore = useCallback(async (g) => {
    const first = data?.groups?.[g]?.rows?.length || 0;
    setBusy(g);
    setMoreError('');
    try {
      const res = await api.get('/api/cases', {
        ...filters, stage: g, limit: CARD_PAGE, offset: first + (extra[g]?.length || 0),
      });
      setExtra((e) => ({ ...e, [g]: [...(e[g] || []), ...(res?.rows || [])] }));
    } catch (e) {
      setMoreError(e.message);
    } finally {
      setBusy('');
    }
  }, [data, extra, filters]);

  const counts = data?.counts || { all: 0, sightfirst: 0, shop: 0 };
  const byStage = data?.by_stage || {};

  /**
   * ข้อมูลที่ถืออยู่เป็นของมุมมองที่เปิดอยู่จริงหรือยัง
   *
   * useAsync เก็บผลรอบก่อนไว้ระหว่างโหลดรอบใหม่ (ตั้งใจ — ไม่งั้นหน้าจะกระพริบ
   * ทุกครั้งที่กดรีเฟรช) แต่การ์ดกับลิสต์คืนคนละรูปแบบ · เฟรมแรกหลังกดสลับ
   * มุมมอง `view` เปลี่ยนไปแล้วแต่ effect ยังไม่ทันวิ่ง `loading` จึงยังเป็น false
   * และข้อมูลยังเป็นของมุมมองเก่า — ถ้าไม่กันไว้ จะเห็น "ไม่พบเคสที่ตรงกับตัวกรอง"
   * แวบหนึ่งทุกครั้งที่สลับ ทั้งที่มีเคสอยู่เต็มกระดาน
   */
  const ready = view === 'list' ? Array.isArray(data?.rows) : Boolean(data?.groups);

  /* คอลัมน์ที่วาด กับยอดรวมของกระดาน — lib/caseBoard.js (มีเทสต์)
     ลิสต์ไม่ได้แบ่งเป็นคอลัมน์ ยอดจึงมาจาก total ของหน้าที่ API ตัดมาให้ */
  const { columns, total: boardTotal } = boardColumns({ byStage, stage, caseFilter, hideEmpty });
  const total = view === 'list' ? (data?.total ?? 0) : boardTotal;
  const stageChoices = stageOptions({ stage, caseFilter });
  /* แผ่นตัวกรองของจอโทรศัพท์ · บนเดสก์ท็อป .fb-panel เป็น display:contents
     ทุกกลุ่มจึงยังยืนอยู่ที่เดิม และ state นี้ไม่มีผลกับอะไรเลย */
  const [filterOpen, setFilterOpen] = useState(false);

  const openCase = (c) => router.push('/cases/detail?id=' + c.id);

  /* "ซ่อนขั้นที่ว่าง" ไม่นับเป็นตัวกรอง — มันเป็นการตั้งค่าการแสดงผล ปุ่มล้าง
     ตัวกรองจึงไม่แตะมัน คนที่ตั้งไว้ว่าไม่อยากเห็นคอลัมน์ว่างก็ยังไม่อยากเห็น */
  const hasFilter = Boolean(term || client || stage || caseFilter || from || to);
  /* ตัวเลขบนปุ่ม "ตัวกรอง (N)" ของจอโทรศัพท์ — คำค้นไม่นับ มันอยู่นอกแผ่นและ
     เห็นได้ด้วยตาว่าพิมพ์อะไรค้างไว้ · "ซ่อนขั้นที่ว่าง" ก็ไม่นับ ด้วยเหตุผลเดียว
     กับที่ปุ่มล้างตัวกรองไม่แตะมัน (มันเป็นการตั้งค่าการแสดงผล) */
  const activeFilters = [client, stage, caseFilter, from || to].filter(Boolean).length;
  const clearAll = () => {
    setTerm('');
    setClient('');
    setStage('');
    setCaseFilter('');
    setDateField('opened');
    setFrom('');
    setTo('');
  };

  const pickCaseFilter = (key) => {
    setCaseFilter(key);
    /* สลับไป/กลับจาก "เคสที่จบแล้ว" แล้วขั้นตอนที่เลือกไว้ใช้ไม่ได้อีก — ล้างทิ้ง
       ไม่งั้นกระดานจะว่างเปล่าโดยที่คนกดไม่รู้ว่าเพราะตัวกรองที่ค้างอยู่ */
    if (key === 'done' || showDone) setStage('');
    /* "วันปิดเคส" มีแต่ในกองที่จบแล้ว ออกจากกองนั้นก็กลับเป็นวันเปิดเคส */
    if (key !== 'done' && dateField === 'closed') setDateField('opened');
  };

  return (
    <div>
      <PageHead
        icon="board"
        title="Case Board"
        subtitle="กระดานงานในร้าน"
        actions={(
          <>
            <Link className="btn btn-ghost" href="/cases/new">+ เปิดเคสใหม่</Link>
            <Link className="btn btn-ghost" href="/delivery"><Icon name="box" /> กระดานส่งมอบ</Link>
          </>
        )}
      />

      <div className={`board-filters ${filterOpen ? 'fb-open' : ''}`.trim()}>
        <div className="bf-row">
          <label className="bf-search" htmlFor="case-search">
            <Icon name="search" /> ค้นหา
          </label>
          <input
            id="case-search"
            className="bf-search-input"
            type="search"
            placeholder="ค้นหา เคส / ลูกค้า / เบอร์ / Invoice"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          {/* โผล่เฉพาะจอโทรศัพท์ (globals.css: .fb-toggle) — สี่กลุ่มตัวกรองข้างล่าง
              รวมกันสูงราวครึ่งจอ 360px ก่อนที่การ์ดเคสใบแรกจะได้โผล่ */}
          <button
            type="button"
            className={`btn btn-light fb-toggle ${activeFilters ? 'on' : ''}`.trim()}
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen(true)}
          >
            <Icon name="filter" />
            {activeFilters ? `ตัวกรอง (${activeFilters})` : 'ตัวกรอง'}
          </button>
          <button type="button" className="btn btn-light bf-refresh" onClick={reload}>
            <Icon name="refresh" /> รีเฟรช
          </button>
          {/* จอโทรศัพท์เท่านั้น — บนคอมปุ่มล้างตัวกรองเป็นแถบยาวแถวล่าง (.fb-foot ของแผ่น) */}
          {hasFilter ? (
            <button type="button" className="btn btn-light bf-refresh bf-clear" onClick={clearAll}>
              <Icon name="x" /> ล้างตัวกรอง
            </button>
          ) : null}
        </div>

        <FilterSheet
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          /* นับคำค้นด้วย — ปุ่มล้างของแผ่นเป็นปุ่มล้างตัวเดียวบนคอม ถ้าไม่นับ พิมพ์ค้นหาไว้
             อย่างเดียวแล้วปุ่มจะกดไม่ได้ */
          count={activeFilters + (term ? 1 : 0)}
          resultCount={total}
          onReset={clearAll}
          resetLabel="ล้างตัวกรอง"
        >
        <div className="bf-groups">
          <div className="bf-group">
            <span className="bf-legend"><Icon name="users" /> ประเภทลูกค้า</span>
            <div className="seg seg-sm">
              {CLIENTS.map(([value, label, countKey]) => (
                <button
                  type="button"
                  key={value || 'all'}
                  className={client === value ? 'active' : ''}
                  aria-pressed={client === value}
                  onClick={() => setClient(value)}
                >
                  {label}
                  <Badge kind="gray">{counts[countKey] ?? 0}</Badge>
                </button>
              ))}
            </div>
          </div>

          <div className="bf-group">
            <span className="bf-legend"><Icon name="filter" /> ตัวกรองเคส</span>
            <div className="bf-chips">
              {CASE_FILTERS.map(([key, label, icon]) => (
                <button
                  type="button"
                  key={key || 'all'}
                  className={`chip ${caseFilter === key ? 'active' : ''}`}
                  aria-pressed={caseFilter === key}
                  onClick={() => pickCaseFilter(key)}
                >
                  {icon ? <Icon name={icon} /> : null}{label}
                </button>
              ))}
            </div>
          </div>

          <div className="bf-group">
            <span className="bf-legend"><Icon name="chart" /> ขั้นตอน</span>
            <Select
              className="bf-stage"
              value={stage}
              disabled={showDone}
              onChange={(e) => setStage(e.target.value)}
              options={[['', 'ทั้งหมด'], ...stageChoices.map((g) => [g, stageInfo(g).label])]}
            />
          </div>

          <div className="bf-group">
            <span className="bf-legend"><Icon name="calendar" /> ช่วงวันที่</span>
            <div className="bf-dates">
              <Select
                className="bf-date-field"
                value={dateField}
                onChange={(e) => setDateField(e.target.value)}
                options={dateFieldOptions({ caseFilter })}
              />
              <DateField value={from} max={to} placeholder="ตั้งแต่" onChange={setFrom} />
              <span className="bf-dates-sep muted">–</span>
              <DateField value={to} min={from} placeholder="ถึง" onChange={setTo} />
            </div>
          </div>

        </div>

        {/* การแสดงผลไม่ใช่ตัวกรอง จึงอยู่นอกกล่องสี่กลุ่ม — บนคอมยืนแถวล่างคู่กับปุ่มล้างตัวกรอง
            คั่นด้วยเส้นตั้ง · .fb-fields/.fb-foot เป็น display:contents ทั้งคู่ ปุ่มล้าง
            กับกลุ่มนี้จึงเป็นลูกของกริด .board-filters ตัวเดียวกันได้ */}
        <div className="bf-display">
          <span className="bf-legend">การแสดงผล</span>
          {/* ซ่อนคอลัมน์ ไม่ใช่กรองเคส — จึงเป็นสวิตช์ ไม่ใช่ชิปเหมือนตัวกรอง */}
          {view === 'card' && !showDone ? (
            <label className="bf-switch">
              <input
                type="checkbox"
                checked={hideEmpty}
                onChange={(e) => setHideEmpty(e.target.checked)}
              />
              <span className="track" aria-hidden="true" />
              ซ่อนขั้นที่ว่าง
            </label>
          ) : null}
          <div className="seg seg-sm">
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
        </FilterSheet>
      </div>

      {(loading || !ready) && !error && <Loading />}
      {error && <Card><p className="muted">{error.message}</p></Card>}

      {!loading && ready && !error && total === 0
        && <NoMatch hasFilter={hasFilter} onClear={clearAll} />}

      {!loading && ready && !error && total > 0 && view === 'list' && (
        <Card tight>
          <CaseList rows={data?.rows || []} showDone={showDone} onOpen={openCase} />
          <Pager
            total={total}
            page={page}
            perPage={perPage}
            sizes={BOARD_PAGE_SIZES}
            onPage={setPage}
            onPerPage={(n) => { setPerPage(n); setPage(1); }}
          />
        </Card>
      )}

      {!loading && ready && !error && total > 0 && view === 'card' && (
        /* กองเดียวไม่ต้องเป็นคอลัมน์ผอม ๆ — ปล่อยการ์ดไหลเต็มความกว้าง */
        <div className={`board ${showDone ? 'board-one' : ''}`.trim()}>
          {columns.map((g) => {
            const info = stageInfo(g);
            const list = [...(data?.groups?.[g]?.rows || []), ...(extra[g] || [])];
            const n = byStage[g] || 0;
            return (
              <div className="board-col" key={g} style={{ '--stage': info.color }}>
                <div className="board-head">
                  <span className="bh-ic"><Icon name={info.icon} /></span>
                  <span className="bh-name">{info.label}</span>
                  <span className="bh-count">{n.toLocaleString('th-TH')}</span>
                  <span className="bh-sub">
                    {`แสดง ${list.length.toLocaleString('th-TH')} จาก ${n.toLocaleString('th-TH')} เคส`}
                  </span>
                </div>
                <div className="board-body">
                  {list.length
                    ? list.map((c) => <CaseCard key={c.id} c={c} onOpen={openCase} />)
                    : <div className="board-empty">—</div>}
                </div>
                {list.length < n ? (
                  <div className="board-more">
                    <button
                      type="button"
                      className="btn btn-light btn-sm"
                      disabled={busy === g}
                      onClick={() => loadMore(g)}
                    >
                      {busy === g
                        ? 'กำลังโหลด…'
                        : `โหลดเพิ่ม (เหลืออีก ${(n - list.length).toLocaleString('th-TH')})`}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {moreError ? <Card><p className="muted">{moreError}</p></Card> : null}
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
