# Next.js Cases Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the `cases` domain (case board, new-case form, case detail with its 6 workflow panels, and the lens tracker) from `frontend/` (Vite) to `frontend-next/` (Next.js), against the same PHP API + MariaDB, following the Foundation plan's established patterns plus the query-string-id / Suspense convention the Foundation's final review flagged as mandatory for every page that reads `useSearchParams()`.

**Architecture:** Every ported page is a Client Component using the existing fetch-on-mount pattern (`useAsync` + `lib/apiClient.js`) — no SSR, no behavior changes, same PHP endpoints. `frontend/src/App.jsx`'s router previously passed `:id` as a path param (`/cases/:id`); Next's static export can't pre-render unbounded database IDs, so `CaseDetail` now reads `id` from a query string (`/cases/detail?id=5`) via `next/navigation`'s `useSearchParams()`. Next 15 requires any component calling `useSearchParams()` to sit under a `<Suspense>` boundary or `next build` fails outright — this affects **four** pages in this domain (CaseBoard reads `q`/`stage`, CaseForm reads `customer`, CaseDetail reads `id`, LensTracker reads `risk`), so this plan introduces one shared `QueryParamPage` wrapper component used by all four, rather than reinventing the pattern four times.

**Tech Stack:** Same as Foundation — Next.js 15 (App Router, static export), React 19.2.8, existing `frontend-next/lib/apiClient.js` and shared UI components.

**Spec:** `docs/superpowers/specs/2026-08-25-nextjs-frontend-only-migration-design.md`

**Depends on:** `docs/superpowers/plans/2026-08-25-nextjs-frontend-foundation.md` (must be complete — it is; see that plan's ledger).

## Global Constraints

- `frontend/` (Vite) and `api/` (PHP) are not touched by this plan at all — no exceptions this time (Foundation's one CORS line is already committed).
- No SSR — every page stays a Client Component (`'use client'`) using the pre-existing fetch pattern.
- Any component calling `useSearchParams()` must be wrapped in `<Suspense>` via the shared `QueryParamPage` component (Task 1) — this is not optional, `next build` fails without it.
- Record-detail routes use a query-string id (`?id=`), never a `[id]` path segment — `CaseDetail` becomes `/cases/detail?id=<n>`.
- UI must work at 1920×1080, 810×1080 (iPad portrait), 1080×810 (iPad landscape) — verified with real Chrome headless DevTools Protocol screenshots.
- `npm run build` must be run and pass (producing `frontend-next/out/`) before this plan is considered done — Foundation's final review found this had been skipped for the whole first plan; it must not be skipped again.

---

## File Structure

```
frontend-next/
├── components/
│   ├── QueryParamPage.jsx        NEW — Suspense wrapper for any page using useSearchParams()
│   ├── Picker.jsx                 port of frontend/src/components/Picker.jsx
│   ├── StatusChip.jsx             port of frontend/src/components/StatusChip.jsx
│   └── RxTable.jsx                port of frontend/src/components/RxTable.jsx
├── app/
│   ├── cases/
│   │   ├── page.jsx                CaseBoard (list/kanban)
│   │   ├── new/
│   │   │   └── page.jsx            CaseForm
│   │   └── detail/
│   │       ├── page.jsx            CaseDetail shell (reads ?id=)
│   │       └── panels/
│   │           ├── RxPanel.jsx
│   │           ├── LensPanel.jsx
│   │           ├── ProductionPanel.jsx
│   │           ├── PaymentPanel.jsx
│   │           ├── NotifyPanel.jsx
│   │           └── TimelinePanel.jsx
│   └── lens-tracker/
│       └── page.jsx                LensTracker
```

**Interfaces later domain plans will rely on:**

- `components/QueryParamPage.jsx` exports `QueryParamPage({ children })` — wraps `children` in `<Suspense fallback={<Loading />}>`. Every future page calling `useSearchParams()` (bookings, orders, customers, prescriptions, stock — anything with a `?id=` detail/edit route, or a list page with a `?q=`/filter query param) wraps its content with this component from `app/page.jsx`.
- `components/Picker.jsx` exports `Picker({ placeholder, fetcher, label, sub, onPick, autoLoad, selectedId })` — same signature as the Vite original, used by `CaseForm` here and by every future page that needs a customer/stock search-and-pick widget (orders, sales, bookings).
- `components/StatusChip.jsx` exports `StatusChip({ row })`.
- `components/RxTable.jsx` exports `RxTable({ t, withPrism, labels })` — will be reused by the `prescriptions` domain plan and by the print pages.

---

### Task 1: Shared components — `QueryParamPage`, `Picker`, `StatusChip`, `RxTable`

**Files:**
- Create: `frontend-next/components/QueryParamPage.jsx`
- Create: `frontend-next/components/Picker.jsx` (port of `frontend/src/components/Picker.jsx`)
- Create: `frontend-next/components/StatusChip.jsx` (port of `frontend/src/components/StatusChip.jsx`)
- Create: `frontend-next/components/RxTable.jsx` (port of `frontend/src/components/RxTable.jsx`)

**Interfaces:**
- Produces: `QueryParamPage`, `Picker`, `StatusChip`, `RxTable` — see the plan-level "Interfaces" section above for exact signatures.

- [ ] **Step 1: Write `frontend-next/components/QueryParamPage.jsx`**

```jsx
'use client';
/**
 * Wraps a page's content in a Suspense boundary. Required by every page that
 * calls next/navigation's useSearchParams() — Next 15 errors at build time
 * (static export) if that hook is used without one. See the cases-domain
 * plan's Architecture note for why this exists as a shared component instead
 * of being repeated per page.
 */
import { Suspense } from 'react';
import { Loading } from './ui.jsx';

export function QueryParamPage({ children, fallback = <Loading /> }) {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}
```

- [ ] **Step 2: Write `frontend-next/components/Picker.jsx`** (port of `frontend/src/components/Picker.jsx` — no logic changes, just the client directive; this file has zero react-router or Vite-specific dependencies)

```jsx
'use client';
/**
 * Search box + result list. Used to choose a customer or a stock item.
 * fetcher(term) -> Promise<rows>, label(row) -> string, sub(row) -> string
 * Port of frontend/src/components/Picker.jsx.
 */
import { useEffect, useRef, useState } from 'react';
import { useDebounced } from '../lib/hooks.js';

export function Picker({ placeholder, fetcher, label, sub, onPick, autoLoad = true, selectedId = null }) {
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState([]);
  const [state, setState] = useState(autoLoad ? 'loading' : 'idle');
  const [error, setError] = useState(null);
  const debounced = useDebounced(term, 220);
  const runId = useRef(0);

  useEffect(() => {
    if (!autoLoad && debounced === '') return undefined;
    const my = ++runId.current;
    let alive = true;
    setState('loading');
    fetcher(debounced)
      .then((data) => {
        if (!alive || my !== runId.current) return;
        setRows(data || []);
        setState('done');
      })
      .catch((e) => {
        if (!alive || my !== runId.current) return;
        setError(e.message);
        setState('error');
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, autoLoad]);

  return (
    <div className="stack">
      <input
        type="search"
        placeholder={placeholder}
        autoComplete="off"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      <div className="picker">
        {state === 'loading' && <div className="p-row"><span className="spin" /> กำลังค้นหา…</div>}
        {state === 'error' && <div className="p-row">{error}</div>}
        {state === 'done' && rows.length === 0 && <div className="p-row muted">ไม่พบข้อมูล</div>}
        {state === 'done' && rows.map((r) => (
          <div
            key={r.id}
            className={`p-row ${String(r.id) === String(selectedId) ? 'sel' : ''}`}
            onClick={() => onPick(r)}
          >
            <span className="p-main">
              <b>{label(r)}</b>
              {sub ? <span className="muted">{'  ' + sub(r)}</span> : null}
            </span>
            <span className="p-id">#{r.id}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `frontend-next/components/StatusChip.jsx`** (port of `frontend/src/components/StatusChip.jsx`, verbatim + client directive)

```jsx
'use client';
/** The coloured stage chip used on the board, lists and case header. Port of frontend/src/components/StatusChip.jsx. */
import { stageInfo } from '../lib/constants.js';

export function StatusChip({ row }) {
  const s = stageInfo(row.stage_group);
  return (
    <span
      className="badge"
      style={{ background: `${s.color}1a`, color: s.color }}
    >
      {`${row.stage_no || ''} ${row.status_label_th || row.status}`.trim()}
    </span>
  );
}
```

- [ ] **Step 4: Write `frontend-next/components/RxTable.jsx`** (port of `frontend/src/components/RxTable.jsx`, verbatim + client directive)

```jsx
'use client';
/** The R/L prescription grid, shared by the case, order and print views. Port of frontend/src/components/RxTable.jsx. */
import { power, rxNum } from '../lib/format.js';

export function RxTable({ t, withPrism = false, labels = ['R', 'L'] }) {
  const heads = ['', 'SPH', 'CYL', 'AXIS', 'ADD', 'PD', 'VA', ...(withPrism ? ['PRISM'] : [])];

  const row = (label, k) => (
    <tr key={k}>
      <td className="lbl">{label}</td>
      {[
        power(t[`${k}_sphere`]),
        power(t[`${k}_cylinder`]),
        rxNum(t[`${k}_axis`]),
        power(t[`${k}_add`]),
        rxNum(t[`${k}_pd`]),
        rxNum(t[`${k}_va`]),
        ...(withPrism ? [t[`${k}_prism`] || '—'] : []),
      ].map((v, i) => <td key={i}>{String(v)}</td>)}
    </tr>
  );

  return (
    <table className="doc" style={{ width: '100%' }}>
      <thead>
        <tr>{heads.map((h, i) => <th key={i}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {row(labels[0], 'r')}
        {row(labels[1], 'l')}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 5: Verify no import errors**

Run (from `frontend-next/`): `npm run dev` (background), confirm it boots with no console errors, stop it. These components aren't wired into a page yet, so this only checks parse/import correctness.

- [ ] **Step 6: Commit**

```bash
git add frontend-next/components/QueryParamPage.jsx frontend-next/components/Picker.jsx frontend-next/components/StatusChip.jsx frontend-next/components/RxTable.jsx
git commit -m "Add QueryParamPage wrapper and port Picker/StatusChip/RxTable components"
```

---

### Task 2: Port CaseBoard (`/cases`)

**Files:**
- Create: `frontend-next/app/cases/page.jsx` (port of `frontend/src/pages/cases/CaseBoard.jsx`)

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js` (`useAsync`, `useDebounced`), `components/ui.jsx` (`Badge, Card, Check, Field, Loading, PageHead, Toolbar`), `components/QueryParamPage.jsx`, `lib/constants.js` (`STAGE_GROUPS, stageInfo`), `lib/format.js` (`fmtDate, moneyShort`).

- [ ] **Step 1: Write `frontend-next/app/cases/page.jsx`**

Port of `frontend/src/pages/cases/CaseBoard.jsx` with these exact changes: `react-router-dom`'s `Link`/`useNavigate`/`useSearchParams` → `next/link`'s `Link` / `next/navigation`'s `useRouter`/`useSearchParams`; `to=` → `href=`; `navigate(...)` → `router.push(...)`; the whole default export's return value wrapped by `QueryParamPage` (since it calls `useSearchParams()` for the initial `q` value).

```jsx
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
```

Note: `onOpen` now navigates to `/cases/detail?id=` + the case id (was `/cases/` + id under React Router).

- [ ] **Step 2: Commit**

```bash
git add frontend-next/app/cases/page.jsx
git commit -m "Port CaseBoard to frontend-next"
```

---

### Task 3: Port CaseForm (`/cases/new`)

**Files:**
- Create: `frontend-next/app/cases/new/page.jsx` (port of `frontend/src/pages/cases/CaseForm.jsx`)

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js` (`useAsync, readForm`), `components/Toast.jsx` (`useToast`), `components/ui.jsx`, `components/Picker.jsx` (Task 1), `components/Selects.jsx` (`EmployeeSelect, StatusSelect`), `components/QueryParamPage.jsx`, `lib/format.js` (`custName`).

- [ ] **Step 1: Write `frontend-next/app/cases/new/page.jsx`**

Port of `frontend/src/pages/cases/CaseForm.jsx`: same router/import swaps as Task 2, plus `useNavigate` → `useRouter`'s `router.push`, wrapped in `QueryParamPage` (reads `customer` from the query string).

```jsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../lib/apiClient.js';
import { useAsync, readForm } from '../../../lib/hooks.js';
import { useToast } from '../../../components/Toast.jsx';
import {
  Card, Check, Field, FormActions, FormGrid, Loading, PageHead, Row, Split,
} from '../../../components/ui.jsx';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { Picker } from '../../../components/Picker.jsx';
import { EmployeeSelect, StatusSelect } from '../../../components/Selects.jsx';
import { custName } from '../../../lib/format.js';

function CaseFormInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { ok, err } = useToast();
  const queryCustomer = params.get('customer');

  const { data: initial, loading } = useAsync(
    () => (queryCustomer ? api.get('/api/customers/' + queryCustomer) : Promise.resolve(null)),
    [queryCustomer]
  );
  const [picked, setPicked] = useState(null);

  if (loading) return <Loading />;

  const customer = picked ?? initial;

  const save = async (e) => {
    e.preventDefault();
    if (!customer) return err('กรุณาเลือกลูกค้าก่อน');
    try {
      const saved = await api.post('/api/cases', {
        ...readForm(e.currentTarget),
        customer_id: customer.id,
      });
      ok('เปิดเคส ' + saved.case_code + ' แล้ว');
      router.push('/cases/detail?id=' + saved.id);
    } catch (ex) {
      err(ex);
    }
    return undefined;
  };

  return (
    <>
      <PageHead icon="🗂" title="New Case" subtitle="เปิดเคสใหม่" />

      <Split>
        <Card
          title="เลือกลูกค้า"
          right={<Link className="btn btn-sm btn-light" href="/customers/new">+ ลูกค้าใหม่</Link>}
        >
          <Picker
            placeholder="ค้นหาลูกค้า (ชื่อ / เบอร์โทร / รหัส)"
            fetcher={(q) => api.get('/api/customers', { q, limit: 40 })}
            label={custName}
            sub={(r) => r.phone || ''}
            selectedId={customer?.id}
            onPick={setPicked}
          />
        </Card>
        <Card title="ลูกค้าที่เลือก">
          {customer ? (
            <Row>
              <span className="badge blue">#{customer.id}</span>
              <b>{custName(customer)}</b>
              <span className="muted">{customer.phone || ''}</span>
            </Row>
          ) : <span className="muted">ยังไม่ได้เลือกลูกค้า</span>}
        </Card>
      </Split>

      <form onSubmit={save}>
        <Card title="เปิดเคสใหม่">
          <FormGrid>
            <Field label="พนักงานผู้รับเรื่อง"><EmployeeSelect name="received_by" defaultValue="" /></Field>
            <Field label="สถานะเริ่มต้น">
              <StatusSelect name="status" openOnly defaultValue="reception" />
            </Field>
            <Field label="ประเภทงาน">
              <Row>
                <Check name="is_rush">งานด่วน 🔥</Check>
                <Check name="is_new_customer">ลูกค้าใหม่</Check>
              </Row>
            </Field>
            <Field label="หมายเหตุความเร่งด่วน"><input name="priority_note" /></Field>
          </FormGrid>

          <Field label="บันทึกตอนรับเรื่อง / Reception note" className="full">
            <textarea name="reception_note" placeholder="ลูกค้าต้องการอะไร มีอาการอย่างไร" />
          </Field>

          <FormActions>
            <button className="btn btn-lg" type="submit">✔ เปิดเคส</button>
            <Link className="btn btn-light" href="/cases">ยกเลิก</Link>
          </FormActions>
        </Card>
      </form>
    </>
  );
}

export default function CaseFormPage() {
  return (
    <QueryParamPage>
      <CaseFormInner />
    </QueryParamPage>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend-next/app/cases/new/page.jsx
git commit -m "Port CaseForm to frontend-next"
```

---

### Task 4: Port the CaseDetail shell (`/cases/detail?id=`)

**Files:**
- Create: `frontend-next/app/cases/detail/page.jsx` (port of `frontend/src/pages/cases/CaseDetail.jsx`)

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js` (`useAsync`), `components/Toast.jsx`, `components/ui.jsx`, `components/StatusChip.jsx` (Task 1), `components/Selects.jsx`, `components/QueryParamPage.jsx`, `lib/format.js`, and the 6 panels from Task 5 (`./panels/*.jsx`).
- Produces: this file imports `RxPanel, LensPanel, ProductionPanel, PaymentPanel, NotifyPanel, TimelinePanel` from `./panels/` — Task 5 must create files with exactly those export names at exactly those paths for this file to build. Write this task's code now; it won't compile until Task 5 lands, which is expected — the two tasks are reviewed independently but only build together.

- [ ] **Step 1: Write `frontend-next/app/cases/detail/page.jsx`**

Port of `frontend/src/pages/cases/CaseDetail.jsx`: `useParams()` (path param `:id`) replaced with `useSearchParams().get('id')`; router/import swaps as before; wrapped in `QueryParamPage`.

```jsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '../../../lib/apiClient.js';
import { useAsync } from '../../../lib/hooks.js';
import { useToast } from '../../../components/Toast.jsx';
import {
  Badge, Card, Field, Kpi, Kpis, Loading, PageHead, Row, Tabs, Toolbar,
} from '../../../components/ui.jsx';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { StatusChip } from '../../../components/StatusChip.jsx';
import { EmployeeSelect, StatusSelect } from '../../../components/Selects.jsx';
import { custName, fmtDate, fmtDateTime, moneyShort } from '../../../lib/format.js';

import { RxPanel } from './panels/RxPanel.jsx';
import { LensPanel } from './panels/LensPanel.jsx';
import { ProductionPanel } from './panels/ProductionPanel.jsx';
import { PaymentPanel } from './panels/PaymentPanel.jsx';
import { NotifyPanel } from './panels/NotifyPanel.jsx';
import { TimelinePanel } from './panels/TimelinePanel.jsx';

const TAB_NAMES = ['ค่าสายตา', 'เลนส์', 'ผลิต & QC', 'การเงิน', 'ติดต่อลูกค้า', 'ไทม์ไลน์'];

function CaseDetailInner() {
  const params = useSearchParams();
  const id = params.get('id');
  const { ok, err } = useToast();
  const [tab, setTab] = useState(TAB_NAMES[0]);

  /* "ผู้ทำรายการ" is read by every panel when it writes, so it lives here */
  const [actor, setActor] = useState('');
  const actorId = () => Number(actor) || null;

  const [nextStatus, setNextStatus] = useState(null);

  const { data: c, loading, error, reload } = useAsync(() => api.get('/api/cases/' + id), [id]);

  if (loading) return <Loading />;
  if (error) return <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>;

  const changeStatus = async () => {
    try {
      await api.post(`/api/cases/${c.id}/status`, {
        status: nextStatus ?? c.status,
        employee_id: actorId(),
      });
      ok('เปลี่ยนสถานะแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const toggleRush = async () => {
    try {
      await api.put('/api/cases/' + c.id, { ...c, is_rush: Number(c.is_rush) ? 0 : 1 });
      reload();
    } catch (ex) { err(ex); }
  };

  const panelProps = { c, reload, actorId };
  const PANELS = {
    'ค่าสายตา': RxPanel,
    'เลนส์': LensPanel,
    'ผลิต & QC': ProductionPanel,
    'การเงิน': PaymentPanel,
    'ติดต่อลูกค้า': NotifyPanel,
    'ไทม์ไลน์': TimelinePanel,
  };
  const Panel = PANELS[tab];

  return (
    <div>
      <PageHead
        icon="🗂"
        title={c.case_code}
        subtitle={custName(c)}
        actions={(
          <>
            <Link className="btn btn-ghost" href={'/customers/detail?id=' + c.customer_id}>👤 ข้อมูลลูกค้า</Link>
            {c.order && <Link className="btn btn-ghost" href={'/orders/detail?id=' + c.order.id}>👓 ออเดอร์</Link>}
            {c.order && <Link className="btn btn-ghost" href={'/print/order?id=' + c.order.id}>🖨 ใบสั่ง</Link>}
          </>
        )}
      />

      <div className="card">
        <div className="card-body">
          <Row style={{ gap: 14, alignItems: 'center', marginBottom: 12 }}>
            <StatusChip row={c} />
            {Number(c.is_rush) ? <Badge kind="danger">🔥 งานด่วน</Badge> : null}
            {Number(c.is_waiting) ? <Badge kind="warn">สถานะรอ</Badge> : null}
            <span className="muted">{`เปิดเมื่อ ${fmtDateTime(c.opened_at)}`}</span>
            {c.received_by_name ? <span className="muted">{`รับโดย ${c.received_by_name}`}</span> : null}
            {c.phone ? <span className="muted">{'☎ ' + c.phone}</span> : null}
          </Row>

          <Toolbar>
            <Field label="ผู้ทำรายการ">
              <EmployeeSelect name="actor" value={actor} onChange={(e) => setActor(e.target.value)} />
            </Field>
            <Field label="เปลี่ยนสถานะเป็น">
              <StatusSelect
                name="to_status"
                value={nextStatus ?? c.status}
                onChange={(e) => setNextStatus(e.target.value)}
              />
            </Field>
            <button type="button" className="btn btn-accent" onClick={changeStatus}>→ เปลี่ยนสถานะ</button>
            <button type="button" className="btn btn-light" onClick={toggleRush}>
              {Number(c.is_rush) ? 'ยกเลิกงานด่วน' : '🔥 ตั้งเป็นงานด่วน'}
            </button>
          </Toolbar>
        </div>
      </div>

      {c.order && (
        <Kpis>
          <Kpi label="ราคารวม" value={moneyShort(c.order.total_price)} />
          <Kpi label="ส่วนลด" value={moneyShort(c.order.discount)} />
          <Kpi kind="ok" label="รับแล้ว" value={moneyShort(c.paid)} />
          <Kpi kind="warn" label="คงเหลือ" value={moneyShort(c.balance)} />
          <Kpi label="วันนัดรับ" value={fmtDate(c.order.appointment_date) || '—'} />
        </Kpis>
      )}

      <Tabs names={TAB_NAMES} active={tab} onSelect={setTab} />
      <Panel {...panelProps} />
    </div>
  );
}

export default function CaseDetailPage() {
  return (
    <QueryParamPage>
      <CaseDetailInner />
    </QueryParamPage>
  );
}
```

Note the two link-target changes beyond the router swap: `/customers/' + c.customer_id` → `/customers/detail?id=' + c.customer_id`, `/orders/' + c.order.id` → `/orders/detail?id=' + c.order.id`, `/print/order/' + c.order.id` → `/print/order?id=' + c.order.id` — all three follow the query-string-id convention for pages that don't exist yet in `frontend-next` (customers/orders/print domains land in later plans) but will when they do.

- [ ] **Step 2: Commit**

```bash
git add frontend-next/app/cases/detail/page.jsx
git commit -m "Port CaseDetail shell to frontend-next"
```

---

### Task 5: Port the 6 case workflow panels

**Files:**
- Create: `frontend-next/app/cases/detail/panels/RxPanel.jsx`
- Create: `frontend-next/app/cases/detail/panels/LensPanel.jsx`
- Create: `frontend-next/app/cases/detail/panels/ProductionPanel.jsx`
- Create: `frontend-next/app/cases/detail/panels/PaymentPanel.jsx`
- Create: `frontend-next/app/cases/detail/panels/NotifyPanel.jsx`
- Create: `frontend-next/app/cases/detail/panels/TimelinePanel.jsx`

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js` (`readForm`), `components/Toast.jsx`, `components/Confirm.jsx` (PaymentPanel only), `components/ui.jsx`, `components/DataTable.jsx`, `components/RxTable.jsx` (RxPanel only, Task 1), `components/Selects.jsx`, `lib/format.js`, `lib/constants.js` (TimelinePanel only).
- Consumed by: Task 4's `app/cases/detail/page.jsx`, which imports each panel by exactly these names from exactly these paths.

All 6 files are mechanical ports — none of them use `react-router-dom`'s hooks (only `Link`, which becomes `next/link`), so this task is pure import-path + `Link`/`to`→`href` substitution, no other logic changes, plus `'use client'` on every file. Each panel keeps its relative depth (`../../../lib/...` in the Vite source; `../../../../lib/...` here since `app/cases/detail/panels/` is one level deeper than `frontend/src/pages/cases/panels/`).

- [ ] **Step 1: Write `frontend-next/app/cases/detail/panels/RxPanel.jsx`**

```jsx
'use client';
import Link from 'next/link';
import { api } from '../../../../lib/apiClient.js';
import { useToast } from '../../../../components/Toast.jsx';
import { Badge, Card, Empty, Row, Stack } from '../../../../components/ui.jsx';
import { RxTable } from '../../../../components/RxTable.jsx';
import { RX_KIND_LABEL } from '../../../../lib/constants.js';
import { fmtDateTime } from '../../../../lib/format.js';

const HEALTH_FLAGS = [
  ['health_cataract', 'ต้อกระจก'],
  ['health_eye_surgery', 'เคยผ่าตัดตา'],
  ['health_diabetes', 'เบาหวาน'],
  ['health_bp', 'ความดัน'],
  ['health_heart', 'หัวใจ'],
];

export function RxPanel({ c, reload, actorId }) {
  const { ok, err } = useToast();
  const rows = c.prescriptions || [];

  const confirmRx = async (t) => {
    try {
      await api.post(`/api/prescriptions/${t.id}/confirm`, { employee_id: actorId() });
      ok('ยืนยันค่าสายตาแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <Stack>
      {rows.map((t) => {
        const flags = HEALTH_FLAGS.filter(([k]) => Number(t[k])).map(([, label]) => label);
        return (
          <Card
            key={t.id}
            title={`${RX_KIND_LABEL[t.kind] || t.kind} — ${fmtDateTime(t.test_date)}`}
            badge={t.kind === 'final' ? <Badge kind="ok">FINAL</Badge> : null}
          >
            <RxTable t={t} withPrism />
            <Row>
              {t.test_for ? <Badge kind="gray">{t.test_for}</Badge> : null}
              {t.performed_by_name ? <span className="muted">{'ผู้วัด ' + t.performed_by_name}</span> : null}
              {t.confirmed_at ? <Badge kind="ok">ยืนยันแล้ว</Badge> : null}
            </Row>
            {flags.length > 0 && (
              <p>
                <b>สุขภาพ: </b>
                {flags.join(', ')}
                {t.health_note ? ' — ' + t.health_note : ''}
              </p>
            )}
            {t.exam_note ? <p className="muted">{t.exam_note}</p> : null}
            <Row>
              <Link className="btn btn-sm btn-light" href={'/prescriptions/edit?id=' + t.id}>✎ แก้ไข</Link>
              <Link className="btn btn-sm btn-light" href={'/print/prescription?id=' + t.id}>🖨 พิมพ์</Link>
              {t.kind !== 'final' && (
                <button type="button" className="btn btn-sm btn-accent" onClick={() => confirmRx(t)}>
                  ✔ ใช้ค่านี้เป็นค่าจริง
                </button>
              )}
            </Row>
          </Card>
        );
      })}

      {rows.length === 0 && <Empty>ยังไม่มีค่าสายตาในเคสนี้</Empty>}

      <Row>
        <Link className="btn btn-accent" href={`/prescriptions/new?customer=${c.customer_id}&case=${c.id}`}>
          + บันทึกค่าสายตาใหม่
        </Link>
      </Row>
    </Stack>
  );
}
```

Note the two link-target changes: `/prescriptions/' + t.id` (edit) → `/prescriptions/edit?id=' + t.id` (the Vite original reused `/prescriptions/:id` for both viewing and editing via `PrescriptionForm`; this plan's convention keeps `new` as its own static route and moves the id-bearing edit route to `?id=`), `/print/prescription/' + t.id` → `/print/prescription?id=' + t.id`.

- [ ] **Step 2: Write `frontend-next/app/cases/detail/panels/LensPanel.jsx`**

```jsx
'use client';
import { useState } from 'react';
import { api } from '../../../../lib/apiClient.js';
import { readForm } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import {
  Badge, Card, Check, Field, FormActions, FormGrid, Row, Stack,
} from '../../../../components/ui.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { EmployeeSelect, Select, SupplierSelect } from '../../../../components/Selects.jsx';
import { dateOnly, fmtDate, fmtDateTime, todayISO } from '../../../../lib/format.js';

const yn = (v) => (Number(v) ? '✔' : '—');

export function LensPanel({ c, reload, actorId }) {
  const { ok, err } = useToast();
  const j = c.lens_job;

  /* the supplier block only applies when the lenses are being ordered in */
  const [source, setSource] = useState(j?.source || 'stock');

  const saveJob = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/lens-jobs', {
        ...readForm(e.currentTarget),
        case_id: c.id,
        order_id: c.order?.id,
        recorded_by: actorId(),
      });
      ok('บันทึกงานเลนส์แล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const receive = async () => {
    try {
      await api.post(`/api/lens-jobs/${j.id}/receive`, { received_by: actorId() });
      ok('บันทึกรับเลนส์แล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const addFollowup = async (e) => {
    e.preventDefault();
    const body = readForm(e.currentTarget);
    delete body.previous_eta_display;
    try {
      await api.post(`/api/lens-jobs/${j.id}/followup`, body);
      ok('บันทึกการติดตามแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <Stack>
      <div className="card">
        <div className="card-head">
          <h2>งานเลนส์ — Lens Job</h2>
          {j ? (
            <Badge kind={j.status === 'ready' ? 'ok' : 'warn'}>
              {j.status === 'ready' ? 'พร้อมแล้ว' : 'รอเลนส์มา'}
            </Badge>
          ) : null}
        </div>

        <form className="card-body" onSubmit={saveJob}>
          <FormGrid>
            <Field label="แหล่งเลนส์ / Source">
              <Select
                name="source"
                options={[['stock', 'มีในสต็อก (หยิบได้เลย)'], ['order', 'ต้องสั่งซัพพลายเออร์']]}
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </Field>
            <Field label="ผู้หยิบ/ผู้ตรวจ">
              <EmployeeSelect name="picked_by" defaultValue={j?.picked_by || ''} />
            </Field>
            <Field label="ตรวจสอบ">
              <Row>
                <Check name="rx_checked" defaultChecked={!!Number(j?.rx_checked)}>ตรวจค่าสายตา</Check>
                <Check name="lens_checked" defaultChecked={!!Number(j?.lens_checked)}>ตรวจเลนส์</Check>
              </Row>
            </Field>
          </FormGrid>

          <div className="form-grid" style={{ display: source === 'order' ? '' : 'none' }}>
            <Field label="ซัพพลายเออร์">
              <SupplierSelect name="supplier_id" defaultValue={j?.supplier_id || ''} blank="— เลือก —" />
            </Field>
            <Field label="เลขที่ใบสั่ง">
              <input name="supplier_order_no" defaultValue={j?.supplier_order_no || ''} />
            </Field>
            <Field label="วันที่สั่ง">
              <input name="order_date" type="date" defaultValue={dateOnly(j?.order_date) || todayISO()} />
            </Field>
            <Field label="Lead time (วัน)">
              <input name="lead_time_days" type="number" min="0" defaultValue={j?.lead_time_days ?? 7} />
            </Field>
            <Field label="คาดว่าจะถึง (ETA)">
              <input name="expected_arrival" type="date" defaultValue={dateOnly(j?.expected_arrival)} />
            </Field>
          </div>

          <Field label="หมายเหตุ" className="full">
            <textarea name="notes" defaultValue={j?.notes || ''} />
          </Field>

          <FormActions>
            <button className="btn" type="submit">{j ? '💾 บันทึกงานเลนส์' : '+ สร้างงานเลนส์'}</button>
            {j && j.status !== 'ready' && (
              <button type="button" className="btn btn-ok" onClick={receive}>📦 เลนส์มาถึงแล้ว</button>
            )}
          </FormActions>
        </form>
      </div>

      {j && (
        <div className="card">
          <div className="card-head">
            <h2>ติดตามเลนส์ — Follow-up</h2>
            <Badge kind="gray">{`${j.follow_up_count || 0} ครั้ง`}</Badge>
          </div>

          <div className="card-body tight">
            <DataTable
              columns={[
                { label: '#', key: 'seq', cls: 'num' },
                { label: 'เมื่อ', render: (f) => fmtDateTime(f.contacted_at), cls: 'nowrap' },
                { label: 'โดย', key: 'contacted_by_name' },
                { label: 'ช่องทาง', key: 'channel' },
                { label: 'ETA เดิม', render: (f) => fmtDate(f.previous_eta), cls: 'nowrap' },
                { label: 'ETA ใหม่', render: (f) => fmtDate(f.new_eta), cls: 'nowrap' },
                { label: 'กระทบนัด', render: (f) => yn(f.affects_appointment) },
                { label: 'แจ้งลูกค้า', render: (f) => yn(f.customer_notified) },
                { label: 'บันทึก', render: (f) => f.supplier_reply || f.note || '' },
              ]}
              rows={j.followups || []}
              empty="ยังไม่มีการติดตาม"
            />
          </div>

          <form className="card-body" onSubmit={addFollowup}>
            <FormGrid>
              <Field label="ผู้ติดต่อ"><EmployeeSelect name="contacted_by" defaultValue="" /></Field>
              <Field label="ช่องทาง">
                <Select name="channel" options={['phone', 'line', 'email', 'walk-in']} defaultValue="phone" />
              </Field>
              <Field label="ETA เดิม">
                <input name="previous_eta_display" defaultValue={dateOnly(j.expected_arrival) || '-'} disabled />
              </Field>
              <Field label="ETA ใหม่"><input name="new_eta" type="date" /></Field>
              <Field label="วันนัดใหม่ (ถ้าต้องเลื่อน)">
                <input name="new_appointment_date" type="date" />
              </Field>
              <Field label="ผลกระทบ">
                <Row>
                  <Check name="affects_appointment">กระทบวันนัด</Check>
                  <Check name="customer_notified">แจ้งลูกค้าแล้ว</Check>
                </Row>
              </Field>
            </FormGrid>
            <Field label="คำตอบจากซัพพลายเออร์ / บันทึก" className="full">
              <textarea name="supplier_reply" />
            </Field>
            <FormActions>
              <button className="btn btn-light" type="submit">+ บันทึกการติดตาม</button>
            </FormActions>
          </form>
        </div>
      )}
    </Stack>
  );
}
```

- [ ] **Step 3: Write `frontend-next/app/cases/detail/panels/ProductionPanel.jsx`**

```jsx
'use client';
import { api } from '../../../../lib/apiClient.js';
import { readForm } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import {
  Badge, Card, Check, Field, FormActions, FormGrid, Row, Split, Stack,
} from '../../../../components/ui.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { EmployeeSelect, Select } from '../../../../components/Selects.jsx';
import { dtLocal, fmtDateTime } from '../../../../lib/format.js';

const PACK_ITEMS = [
  ['pack_glasses', 'แว่น'], ['pack_case', 'กล่อง'], ['pack_cloth', 'ผ้าเช็ด'],
  ['pack_warranty', 'ใบรับประกัน'], ['pack_prescription', 'ใบค่าสายตา'],
  ['pack_accessories', 'อุปกรณ์เสริม'],
];

const QC_CHECKS = [
  ['check_rx', 'ค่าสายตา'], ['check_centering', 'จุดศูนย์กลาง'], ['check_lens', 'เลนส์'],
  ['check_frame', 'กรอบ'], ['check_finish', 'ความเรียบร้อย'],
];

export function ProductionPanel({ c, reload, actorId }) {
  const { ok, err } = useToast();
  const p = c.production || {};
  const ff = c.frame_fitting || {};
  const ce = c.centering || {};

  const post = (endpoint, extra) => async (e) => {
    e.preventDefault();
    try {
      await api.post(endpoint, { ...readForm(e.currentTarget), case_id: c.id, order_id: c.order?.id, ...extra });
      ok('บันทึกแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const saveQc = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/qc-checks', { ...readForm(e.currentTarget), case_id: c.id });
      ok('บันทึกผล QC แล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const text = (name, label, source) => (
    <Field label={label}><input name={name} defaultValue={source[name] || ''} /></Field>
  );

  return (
    <Stack>
      <Split>
        <div className="card">
          <div className="card-head"><h2>วัดกรอบ — Frame Fitting</h2></div>
          <form
            className="card-body"
            onSubmit={post('/api/frame-fittings', { recorded_by: actorId() })}
          >
            <FormGrid>
              {text('frame_size', 'Frame size', ff)}
              {text('lens_width', 'Lens width', ff)}
              {text('bridge_width', 'Bridge', ff)}
              {text('temple_length', 'Temple', ff)}
              {text('ed', 'ED', ff)}
              {text('dbl', 'DBL', ff)}
              <Field label="ผู้วัด">
                <EmployeeSelect name="performed_by" defaultValue={ff.performed_by || ''} />
              </Field>
            </FormGrid>
            <FormActions>
              <button className="btn btn-light" type="submit">💾 บันทึกการวัดกรอบ</button>
            </FormActions>
          </form>
        </div>

        <div className="card">
          <div className="card-head"><h2>จุดศูนย์กลาง — Centering</h2></div>
          <form
            className="card-body"
            onSubmit={post('/api/centerings', { recorded_by: actorId() })}
          >
            <FormGrid>
              {text('r_pd', 'R PD', ce)}
              {text('l_pd', 'L PD', ce)}
              {text('pd_total', 'PD รวม', ce)}
              {text('r_height', 'R Height', ce)}
              {text('l_height', 'L Height', ce)}
              {text('vertex_distance', 'Vertex', ce)}
              {text('pantoscopic_tilt', 'Pantoscopic tilt', ce)}
              {text('wrap_angle', 'Wrap angle', ce)}
              <Field label="ผู้วัด">
                <EmployeeSelect name="performed_by" defaultValue={ce.performed_by || ''} />
              </Field>
            </FormGrid>
            <FormActions>
              <button className="btn btn-light" type="submit">💾 บันทึกจุดศูนย์กลาง</button>
            </FormActions>
          </form>
        </div>
      </Split>

      <div className="card">
        <div className="card-head"><h2>งานผลิต — Production</h2></div>
        <form
          className="card-body"
          onSubmit={post('/api/production-jobs', { employee_id: actorId() })}
        >
          <FormGrid>
            <Field label="ช่างที่รับงาน">
              <EmployeeSelect name="assigned_technician" defaultValue={p.assigned_technician || ''} />
            </Field>
            <Field label="เริ่มฝน">
              <input name="edging_started_at" type="datetime-local" defaultValue={dtLocal(p.edging_started_at)} />
            </Field>
            <Field label="ฝนเสร็จ">
              <input name="edging_finished_at" type="datetime-local" defaultValue={dtLocal(p.edging_finished_at)} />
            </Field>
            <Field label="ผู้ฝน"><EmployeeSelect name="edged_by" defaultValue={p.edged_by || ''} /></Field>
            <Field label="ตรวจจับคู่">
              <Row>
                <Check name="match_customer_ok" defaultChecked={!!Number(p.match_customer_ok)}>ตรงลูกค้า</Check>
                <Check name="match_rx_ok" defaultChecked={!!Number(p.match_rx_ok)}>ตรงค่าสายตา</Check>
              </Row>
            </Field>
            <Field label="Checklist การแพ็ค" className="full">
              <Row>
                {PACK_ITEMS.map(([k, label]) => (
                  <Check key={k} name={k} defaultChecked={!!Number(p[k])}>{label}</Check>
                ))}
              </Row>
            </Field>
            <Field label="ผู้แพ็ค"><EmployeeSelect name="packed_by" defaultValue={p.packed_by || ''} /></Field>
            <Field label="ผู้ตรวจการแพ็ค">
              <EmployeeSelect name="pack_checked_by" defaultValue={p.pack_checked_by || ''} />
            </Field>
          </FormGrid>
          <Field label="บันทึกการผลิต" className="full">
            <textarea name="edging_remark" defaultValue={p.edging_remark || ''} />
          </Field>
          <FormActions>
            <button className="btn btn-light" type="submit">💾 บันทึกงานผลิต</button>
          </FormActions>
        </form>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>QC</h2>
          <Badge kind="gray">{`${(c.qc_checks || []).length} รอบ`}</Badge>
        </div>

        <div className="card-body tight">
          <DataTable
            columns={[
              { label: 'รอบ', key: 'attempt', cls: 'num' },
              {
                label: 'ผล',
                render: (r) => (
                  <Badge kind={r.result === 'pass' ? 'ok' : 'danger'}>
                    {r.result === 'pass' ? 'ผ่าน' : 'ไม่ผ่าน'}
                  </Badge>
                ),
              },
              { label: 'เมื่อ', render: (r) => fmtDateTime(r.checked_at), cls: 'nowrap' },
              { label: 'ผู้ตรวจ', key: 'checked_by_name' },
              { label: 'ข้อบกพร่อง', key: 'defects' },
              { label: 'แก้ไข', key: 'action_taken' },
            ]}
            rows={c.qc_checks || []}
            empty="ยังไม่มีการตรวจ QC"
          />
        </div>

        <form className="card-body" onSubmit={saveQc}>
          <FormGrid>
            <Field label="ผลตรวจ">
              <Select name="result" options={[['pass', '✅ ผ่าน'], ['fail', '❌ ไม่ผ่าน']]} defaultValue="pass" />
            </Field>
            <Field label="ผู้ตรวจ"><EmployeeSelect name="checked_by" defaultValue="" /></Field>
            <Field label="การแก้ไขที่ทำ">
              <input name="action_taken" placeholder="เช่น ฝนใหม่, สั่งเลนส์ใหม่" />
            </Field>
            <Field label="รายการตรวจ" className="full">
              <Row>
                {QC_CHECKS.map(([k, label]) => <Check key={k} name={k}>{label}</Check>)}
              </Row>
            </Field>
          </FormGrid>
          <Field label="ข้อบกพร่องที่พบ" className="full">
            <textarea name="defects" />
          </Field>
          <FormActions>
            <button className="btn" type="submit">+ บันทึกผล QC</button>
          </FormActions>
        </form>
      </div>
    </Stack>
  );
}
```

- [ ] **Step 4: Write `frontend-next/app/cases/detail/panels/PaymentPanel.jsx`**

```jsx
'use client';
import { api } from '../../../../lib/apiClient.js';
import { readForm } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import { useConfirm } from '../../../../components/Confirm.jsx';
import { Badge, Field, FormActions, FormGrid } from '../../../../components/ui.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { EmployeeSelect, ListSelect, Select } from '../../../../components/Selects.jsx';
import { fmtDateTime, money, nowLocal, toStamp } from '../../../../lib/format.js';

const KINDS = [
  ['deposit', 'มัดจำ'], ['partial', 'จ่ายบางส่วน'],
  ['final', 'ชำระส่วนที่เหลือ'], ['full', 'ชำระเต็ม'],
];

export function PaymentPanel({ c, reload }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();

  const add = async (e) => {
    e.preventDefault();
    const body = readForm(e.currentTarget);
    body.paid_at = toStamp(body.paid_at);
    try {
      await api.post('/api/payments', { ...body, case_id: c.id, order_id: c.order?.id });
      ok('บันทึกการรับเงินแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const remove = async (p) => {
    if (!await confirm('ลบรายการรับเงิน', `ลบ ${money(p.amount)} (${p.kind})?`,
      { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del('/api/payments/' + p.id);
      ok('ลบแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const payments = c.payments || [];

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <h2>ประวัติการรับเงิน</h2>
          <Badge kind="ok">{'รับแล้ว ' + money(c.paid)}</Badge>
        </div>

        <div className="card-body tight">
          <DataTable
            columns={[
              { label: 'เมื่อ', render: (p) => fmtDateTime(p.paid_at), cls: 'nowrap' },
              { label: 'ประเภท', key: 'kind' },
              { label: 'วิธี', key: 'method' },
              { label: 'จำนวน', render: (p) => money(p.amount), cls: 'num' },
              { label: 'อ้างอิง', key: 'reference' },
              { label: 'ผู้รับ', key: 'received_by_name' },
              { label: 'หมายเหตุ', key: 'notes' },
              {
                label: '',
                cls: 'nowrap',
                render: (p) => (
                  <button type="button" className="btn btn-sm btn-light" onClick={() => remove(p)}>🗑</button>
                ),
              },
            ]}
            rows={payments}
            empty="ยังไม่มีการรับเงิน"
            footer={payments.length ? (
              <tr>
                <td colSpan={3}>รวม</td>
                <td className="num">{money(c.paid)}</td>
                <td colSpan={4} />
              </tr>
            ) : null}
          />
        </div>

        <form className="card-body" onSubmit={add}>
          <FormGrid>
            <Field label="ประเภท">
              <Select name="kind" options={KINDS} defaultValue={Number(c.paid) > 0 ? 'final' : 'deposit'} />
            </Field>
            <Field label="จำนวนเงิน">
              <input
                name="amount"
                type="number"
                step="1"
                min="1"
                required
                defaultValue={Number(c.balance) > 0 ? c.balance : ''}
              />
            </Field>
            <Field label="วิธีชำระ"><ListSelect name="method" kind="pay_type" defaultValue="Cash" /></Field>
            <Field label="อ้างอิง (เลขที่โอน)"><input name="reference" /></Field>
            <Field label="ผู้รับเงิน"><EmployeeSelect name="received_by" defaultValue="" /></Field>
            <Field label="เมื่อ">
              <input name="paid_at" type="datetime-local" defaultValue={nowLocal()} />
            </Field>
          </FormGrid>
          <FormActions>
            <button className="btn" type="submit">+ บันทึกการรับเงิน</button>
          </FormActions>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write `frontend-next/app/cases/detail/panels/NotifyPanel.jsx`**

```jsx
'use client';
import { api } from '../../../../lib/apiClient.js';
import { readForm } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import { Field, FormActions, FormGrid } from '../../../../components/ui.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { EmployeeSelect, Select } from '../../../../components/Selects.jsx';
import { fmtDateTime } from '../../../../lib/format.js';

const RESULTS = [
  ['reached', 'ติดต่อได้'], ['no_answer', 'ไม่รับสาย'],
  ['left_message', 'ฝากข้อความ'], ['wrong_number', 'เบอร์ผิด'],
];

export function NotifyPanel({ c, reload }) {
  const { ok, err } = useToast();

  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/api/cases/${c.id}/notify`, readForm(e.currentTarget));
      ok('บันทึกแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>ประวัติการติดต่อลูกค้า</h2>
        {c.phone ? <a className="btn btn-sm btn-light" href={'tel:' + c.phone}>{'☎ ' + c.phone}</a> : null}
      </div>

      <div className="card-body tight">
        <DataTable
          columns={[
            { label: 'เมื่อ', render: (n) => fmtDateTime(n.contacted_at), cls: 'nowrap' },
            { label: 'ช่องทาง', key: 'channel' },
            { label: 'ผล', key: 'result' },
            { label: 'โดย', key: 'contacted_by_name' },
            { label: 'บันทึก', key: 'note' },
          ]}
          rows={c.notifications || []}
          empty="ยังไม่เคยติดต่อ"
        />
      </div>

      <form className="card-body" onSubmit={add}>
        <FormGrid>
          <Field label="ช่องทาง">
            <Select name="channel" options={['phone', 'line', 'sms', 'email', 'walk-in']} defaultValue="phone" />
          </Field>
          <Field label="ผลการติดต่อ">
            <Select name="result" options={RESULTS} defaultValue="reached" />
          </Field>
          <Field label="ผู้ติดต่อ"><EmployeeSelect name="contacted_by" defaultValue="" /></Field>
        </FormGrid>
        <Field label="บันทึก" className="full"><textarea name="note" /></Field>
        <FormActions>
          <button className="btn" type="submit">+ บันทึกการติดต่อ</button>
        </FormActions>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: Write `frontend-next/app/cases/detail/panels/TimelinePanel.jsx`**

```jsx
'use client';
import { api } from '../../../../lib/apiClient.js';
import { readForm } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import { Badge, Empty, Field } from '../../../../components/ui.jsx';
import { ACTION_LABEL } from '../../../../lib/constants.js';
import { fmtDateTime } from '../../../../lib/format.js';

export function TimelinePanel({ c, reload, actorId }) {
  const { ok, err } = useToast();
  const events = c.events || [];

  const addNote = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await api.post(`/api/cases/${c.id}/note`, { ...readForm(form), employee_id: actorId() });
      ok('บันทึกแล้ว');
      form.reset();
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>ไทม์ไลน์เคส</h2>
        <Badge kind="gray">{`${events.length} เหตุการณ์`}</Badge>
      </div>

      <form className="card-body" onSubmit={addNote}>
        <div className="row">
          <Field label="เพิ่มบันทึกลงไทม์ไลน์" className="grow">
            <input name="note" placeholder="พิมพ์บันทึก…" required />
          </Field>
          <button className="btn" type="submit">+ บันทึก</button>
        </div>
      </form>

      <div className="card-body">
        {events.length === 0 ? <Empty>ยังไม่มีเหตุการณ์</Empty> : (
          <div className="timeline">
            {events.map((ev) => (
              <div className="tl-item" key={ev.id}>
                <div className="tl-dot" />
                <div className="tl-body">
                  <div className="tl-head">
                    <b>{ACTION_LABEL[ev.action] || ev.action}</b>
                    {ev.to_label ? <Badge kind="blue">{`→ ${ev.to_label}`}</Badge> : null}
                    <span className="muted">{fmtDateTime(ev.created_at)}</span>
                    {ev.employee_name ? <span className="muted">{'· ' + ev.employee_name}</span> : null}
                  </div>
                  {ev.note ? <div className="tl-note">{ev.note}</div> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify the build compiles now that Task 4's page and this task's panels exist together**

Run (from `frontend-next/`): `npm run dev`, load `http://localhost:<port>/cases/detail?id=1` (any existing case id — check with a quick `curl http://127.0.0.1:8080/api/cases?limit=1` against the running PHP API if you need one) with the PHP API running. Confirm no import errors and all 6 tabs switch without a crash. Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add frontend-next/app/cases/detail/panels/
git commit -m "Port the 6 case workflow panels to frontend-next"
```

---

### Task 6: Port LensTracker (`/lens-tracker`)

**Files:**
- Create: `frontend-next/app/lens-tracker/page.jsx` (port of `frontend/src/pages/cases/LensTracker.jsx`)

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js` (`useAsync`), `components/ui.jsx`, `components/DataTable.jsx`, `components/Selects.jsx` (`Select`), `components/QueryParamPage.jsx`, `lib/format.js`.

- [ ] **Step 1: Write `frontend-next/app/lens-tracker/page.jsx`**

Port of `frontend/src/pages/cases/LensTracker.jsx`: router/import swaps as before, wrapped in `QueryParamPage` (reads `risk` from the query string).

```jsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync } from '../../lib/hooks.js';
import { Badge, Card, Check, Field, Loading, PageHead, Toolbar } from '../../components/ui.jsx';
import { QueryParamPage } from '../../components/QueryParamPage.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Select } from '../../components/Selects.jsx';
import { custName, fmtDate } from '../../lib/format.js';

const RISKS = [['', 'ทุกระดับ'], ['late', 'เลย ETA'], ['soon', 'ใกล้ถึง'], ['ok', 'ปกติ']];

function LensTrackerInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [risk, setRisk] = useState(params.get('risk') || '');
  const [threat, setThreat] = useState(false);

  const { data: rows, loading, error, reload } = useAsync(
    () => api.get('/api/lens-tracker', { risk, threatens: threat ? 1 : '' }),
    [risk, threat]
  );

  return (
    <div>
      <PageHead
        icon="🔎"
        title="Lens Tracker"
        subtitle="ติดตามเลนส์ที่สั่งซัพพลายเออร์"
        actions={<Link className="btn btn-ghost" href="/cases">← กระดานงาน</Link>}
      />

      <Toolbar>
        <Field label="ระดับความเสี่ยง">
          <Select options={RISKS} value={risk} onChange={(e) => setRisk(e.target.value)} />
        </Field>
        <Check checked={threat} onChange={(e) => setThreat(e.target.checked)}>เฉพาะที่กระทบวันนัด</Check>
        <button type="button" className="btn btn-light" onClick={reload}>↻ รีเฟรช</button>
      </Toolbar>

      {loading && <Loading />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (
        <Card tight>
          <DataTable
            columns={[
              { label: 'เคส', key: 'case_code', cls: 'mono' },
              { label: '', render: (r) => (Number(r.is_rush) ? <Badge kind="danger">🔥</Badge> : '') },
              { label: 'ลูกค้า', render: custName },
              { label: 'เบอร์', key: 'phone', cls: 'nowrap' },
              { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
              { label: 'เลนส์', key: 'lens_name' },
              { label: 'ซัพพลายเออร์', key: 'supplier_name' },
              { label: 'เลขที่สั่ง', key: 'supplier_order_no' },
              { label: 'สั่งเมื่อ', render: (r) => fmtDate(r.order_date), cls: 'nowrap' },
              { label: 'ETA', render: (r) => fmtDate(r.expected_arrival), cls: 'nowrap' },
              {
                label: 'เหลือ (วัน)',
                cls: 'num',
                render: (r) => (r.days_to_eta === null ? '—' : String(r.days_to_eta)),
              },
              {
                label: 'ความเสี่ยง',
                render: (r) => (
                  <Badge kind={r.risk_level === 'late' ? 'danger' : r.risk_level === 'soon' ? 'warn' : 'ok'}>
                    {r.risk_level}
                  </Badge>
                ),
              },
              { label: 'ตามแล้ว', key: 'follow_up_count', cls: 'num' },
              { label: 'วันนัด', render: (r) => fmtDate(r.appointment_date), cls: 'nowrap' },
              {
                label: 'กระทบนัด',
                render: (r) => (Number(r.threatens_appointment) ? <Badge kind="danger">เสี่ยงเลื่อน</Badge> : ''),
              },
            ]}
            rows={rows}
            onRowClick={(r) => router.push('/cases/detail?id=' + r.case_id)}
            empty="ไม่มีเลนส์ที่กำลังรอ"
          />
        </Card>
      )}
    </div>
  );
}

export default function LensTrackerPage() {
  return (
    <QueryParamPage>
      <LensTrackerInner />
    </QueryParamPage>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend-next/app/lens-tracker/page.jsx
git commit -m "Port LensTracker to frontend-next"
```

---

### Task 7: Add `/cases` and `/lens-tracker` to Shell's breadcrumb table, build, and verify against the real API

**Files:**
- Modify: `frontend-next/lib/crumb.js` (add `/cases/detail`, `/cases/new` already present — check; `/lens-tracker` already present — check; add anything missing)

**Interfaces:** none new.

- [ ] **Step 1: Check `frontend-next/lib/crumb.js`'s `TITLES` array**

Read it. It already has `/cases/new`, `/cases`, `/lens-tracker`, `/customers/detail`, `/customers/edit`, `/bookings/detail`, `/orders/detail` (from Foundation + its final-review fix wave). Add exactly one missing entry, in the correct longest-match-first position (immediately before the existing `/cases` line, matching the pattern already used for `/customers/detail`):

```javascript
  ['/cases/detail', 'รายละเอียดเคส'],
```

- [ ] **Step 2: Run the full test suite and the build**

```bash
cd frontend-next
npm test
npm run build
```

Expected: all existing tests still pass; `npm run build` succeeds and produces `frontend-next/out/cases/index.html`, `out/cases/new/index.html`, `out/cases/detail/index.html`, `out/lens-tracker/index.html`. If the build fails (e.g., a missed `Suspense` boundary), fix the root cause — do not skip this step, Foundation's final review found that skipping it hid real problems.

- [ ] **Step 3: Manually verify against the real PHP API + MariaDB, compared with the still-running Vite app**

XAMPP MySQL running, PHP API running (`start-api.bat`), Next dev server running (`npm run dev` from `frontend-next/`), Vite app running for comparison (`start-web.bat` or `npm run dev` from `frontend/`).

- Open `/cases` (Next) vs `/#/cases` (Vite) — same case cards, same columns, same counts.
- Open `/cases/new` vs `/#/cases/new` — pick a customer via the Picker, confirm the search works identically.
- Open `/cases/detail?id=<n>` (pick a real case id from the board) vs `/#/cases/<n>` — same header, same KPIs, same tab content across all 6 tabs. Exercise at least one write per panel type that's safe to test (e.g., add a timeline note, since it's non-destructive) and confirm it round-trips to the real DB and shows up in both apps after reload — clean up any test data you add the same way Foundation's Task 8 did (delete it from the live DB afterward, don't leave it).
- Open `/lens-tracker` vs `/#/lens-tracker` — same rows, same risk filter behavior.

- [ ] **Step 4: Commit**

```bash
git add frontend-next/lib/crumb.js
git commit -m "Add /cases/detail breadcrumb entry; verify cases domain against real API"
```

---

### Task 8: Verify in-browser at all three required breakpoints

**Files:** none (verification only; fix in `frontend-next/app/globals.css` only if something real is found).

- [ ] **Step 1: Start both servers** (PHP API + Next dev server, per Task 7 Step 3).

- [ ] **Step 2: Launch Chrome headless with remote debugging**, same method as Foundation's Task 9 (`--headless --remote-debugging-port=9222 --disable-gpu`).

- [ ] **Step 3: Screenshot and inspect `/cases` (kanban board — the widest, most layout-sensitive new page in this domain) and `/cases/detail?id=<n>` (tabbed panels, several multi-column forms) at all three required sizes: 1920×1080, 810×1080, 1080×810.**

Check specifically: the kanban board's columns don't force horizontal scroll on the page body at 810×1080 (a `board` grid with several columns is the highest-risk layout in this domain for that); the case detail tabs remain reachable/tappable at 810×1080; no content is clipped in the narrower panel forms (ProductionPanel's `Split` two-column layout is the next-highest risk).

- [ ] **Step 4: Fix anything real in `frontend-next/app/globals.css` only, re-screenshot until it passes.** If nothing needs fixing, say so plainly — don't invent a change to justify the step.

- [ ] **Step 5: Kill headless Chrome and both dev servers.**

- [ ] **Step 6: Commit any fix from Step 4** (message: `Fix responsive layout issues found verifying the cases domain`). Skip if no fix was needed.

---

## Self-Review Notes

- **Spec coverage:** every page in `frontend/src/pages/cases/` (including all 6 panels) has a corresponding task; the `QueryParamPage`/Suspense requirement Foundation's final review flagged is applied to all four pages in this domain that call `useSearchParams()` (CaseBoard, CaseForm, CaseDetail, LensTracker); `npm run build` is a required step this time (Task 7), not skipped.
- **Placeholder scan:** no TBDs; every step has runnable code or an exact command.
- **Type/name consistency:** Task 4's `app/cases/detail/page.jsx` imports `RxPanel, LensPanel, ProductionPanel, PaymentPanel, NotifyPanel, TimelinePanel` from `./panels/*.jsx` with exactly the export names Task 5 defines. `QueryParamPage` (Task 1) is imported with that exact name by Tasks 2, 3, 4, and 6.
- **Scope:** this plan covers only the `cases` domain. Links to not-yet-ported domains (customers, orders, prescriptions, print) are written now using the query-string-id convention so they don't need revisiting later, matching the pattern Foundation's Dashboard page already established.

## After This Plan

Next domain plan: **bookings** (calendar, booking form/detail, settings) — `Dashboard`'s queue table already links to `/bookings/detail?id=`, so this keeps the same "port what's already linked-to" ordering Foundation used for `cases`.
