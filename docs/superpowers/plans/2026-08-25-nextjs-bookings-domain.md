# Next.js Bookings Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the `bookings` domain (queue calendar, booking form, booking detail, notification settings) from `frontend/` (Vite) to `frontend-next/` (Next.js), against the same PHP API + MariaDB, applying the lessons the cases-domain plan's final review surfaced: split the Vite app's single dual-mode `BookingForm` into two real page files sharing one component with an explicit `editing` prop; extract testable date math out of JSX; and verify the actual static `out/` build in a browser (not just confirm `npm run build` exits 0), since that exact gap let a hydration bug ship unnoticed through the cases-domain plan.

**Architecture:** Same client-fetch, no-SSR pattern as every prior plan. Two new shared pieces this domain introduces: `lib/calendar.js` (pure date-math functions, unit-testable — `BookingCalendar.jsx` in the Vite source has this logic inline in JSX, where nothing can test it) and `components/BookingStatusBadge.jsx` (extracted from the Vite `BookingCalendar.jsx`, which exported it for `BookingDetail.jsx` to import cross-file — cleaner as a real shared component here). The Vite `BookingForm.jsx` served both `/bookings/new` and `/bookings/:id/edit` off one component that derived `editing` from `!!useParams().id`; this plan keeps one shared `BookingFormView` component but makes `editing` an explicit prop passed by two separate, thin page files (`/bookings/new`, `/bookings/edit?id=`) — not inferred from whether a query param happens to be present, since a "new booking" URL can legitimately carry other query params (`?customer=`, `?date=`) without meaning "edit".

**Tech Stack:** Same as prior plans — Next.js 15 (App Router, static export), React 19.2.8, `frontend-next/lib/apiClient.js`, shared UI components, `components/QueryParamPage.jsx` (from the cases-domain plan).

**Spec:** `docs/superpowers/specs/2026-08-25-nextjs-frontend-only-migration-design.md`

**Depends on:** `docs/superpowers/plans/2026-08-25-nextjs-frontend-foundation.md` and `docs/superpowers/plans/2026-08-25-nextjs-cases-domain.md` (both complete — `frontend-next/app/cases/detail/page.jsx` already exists and is a link target from this domain's booking detail page's "open case" flow, and `components/QueryParamPage.jsx`/`Picker.jsx` already exist).

## Global Constraints

- `frontend/` (Vite) and `api/` (PHP) are not touched by this plan.
- No SSR — every page a Client Component.
- Any component calling `useSearchParams()` must be wrapped in `QueryParamPage`, **and `useSearchParams()` itself must only be called inside the component `QueryParamPage` wraps — never in a `page.jsx` default export directly.** (This is the one rule Next enforces with a hard `next build` failure, not a warning — get it right the first time.)
- `editing` in the booking-form flow is an explicit prop (`true`/`false`) passed by which page file rendered the component — never derived from `searchParams.get('id') != null`.
- Record-detail routes use `?id=` — `/bookings/detail?id=`, `/bookings/edit?id=`.
- UI must work at 1920×1080, 810×1080 (iPad portrait), 1080×810 (iPad landscape) — verified with real Chrome headless DevTools Protocol screenshots. The calendar's month grid (a fixed 7-column grid, unlike the cases board's `auto-fit` kanban columns) is this domain's highest overflow risk and gets checked explicitly, not assumed safe.
- `npm run build` must pass AND the resulting `frontend-next/out/` must actually be served and loaded in a real browser with the console checked for errors — not just confirmed to exist on disk. This is a direct lesson from the cases-domain plan's final review, which found a hydration bug that `npm run build` succeeding had silently hidden.

---

## File Structure

```
frontend-next/
├── lib/
│   ├── calendar.js                NEW — daysInMonth, leadOffset, shiftMonth (pure, tested)
│   └── __tests__/
│       └── calendar.test.js       NEW
├── components/
│   └── BookingStatusBadge.jsx     NEW — extracted from Vite's BookingCalendar.jsx
├── app/
│   ├── bookings/
│   │   ├── page.jsx                BookingCalendar
│   │   ├── BookingFormView.jsx     shared inner component (NOT a route — no page.jsx name)
│   │   ├── new/
│   │   │   └── page.jsx            renders <BookingFormView editing={false} />
│   │   ├── edit/
│   │   │   └── page.jsx            renders <BookingFormView editing />
│   │   └── detail/
│   │       └── page.jsx            BookingDetail
│   └── settings/
│       └── page.jsx                Settings (Telegram notification config)
```

**Interfaces later domain plans will rely on:**

- `lib/calendar.js` exports `daysInMonth(year, month)`, `leadOffset(year, month)`, `shiftMonth(monthStr, delta)` — any future page with its own month/date grid can reuse these instead of reinventing the math inline.
- `components/BookingStatusBadge.jsx` exports `BookingStatusBadge({ b })`.
- The `editing`-prop pattern (`app/bookings/new/page.jsx` + `app/bookings/edit/page.jsx` both rendering one shared `app/bookings/BookingFormView.jsx`) is the template every future domain with a create/edit-shared-form Vite page (orders, prescriptions, stock) should follow.

---

### Task 1: Shared pieces — `lib/calendar.js` and `components/BookingStatusBadge.jsx`

**Files:**
- Create: `frontend-next/lib/calendar.js`
- Create: `frontend-next/lib/__tests__/calendar.test.js`
- Create: `frontend-next/components/BookingStatusBadge.jsx`

**Interfaces:**
- Produces: `daysInMonth`, `leadOffset`, `shiftMonth` (calendar.js); `BookingStatusBadge` (component).

- [ ] **Step 1: Write the failing tests for the date math**

```javascript
// frontend-next/lib/__tests__/calendar.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysInMonth, leadOffset, shiftMonth } from '../calendar.js';

test('daysInMonth: ordinary months', () => {
  assert.equal(daysInMonth(2026, 1), 31);
  assert.equal(daysInMonth(2026, 4), 30);
});

test('daysInMonth: February, leap vs non-leap year', () => {
  assert.equal(daysInMonth(2024, 2), 29); // leap
  assert.equal(daysInMonth(2026, 2), 28); // not leap
});

test('leadOffset: day-of-week the 1st of the month falls on (0=Sun..6=Sat)', () => {
  // 2026-08-01 is a Saturday
  assert.equal(leadOffset(2026, 8), 6);
  // 2026-11-01 is a Sunday
  assert.equal(leadOffset(2026, 11), 0);
});

test('shiftMonth: steps forward and backward within a year', () => {
  assert.equal(shiftMonth('2026-08', 1), '2026-09');
  assert.equal(shiftMonth('2026-08', -1), '2026-07');
});

test('shiftMonth: crosses a year boundary in both directions', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `frontend-next/`): `node --test lib/__tests__/calendar.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `frontend-next/lib/calendar.js`**

```javascript
/**
 * Pure month-grid date math for the booking calendar. Extracted from
 * frontend/src/pages/bookings/BookingCalendar.jsx, where this logic lived
 * inline in JSX and so could never be unit tested.
 */

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** Day of week (0=Sun..6=Sat) the month's 1st falls on — how many blank lead cells a grid needs. */
export function leadOffset(year, month) {
  return new Date(year, month - 1, 1).getDay();
}

/** 'YYYY-MM' shifted by delta months, e.g. shiftMonth('2026-12', 1) -> '2027-01'. */
export function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/__tests__/calendar.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write `frontend-next/components/BookingStatusBadge.jsx`**

Extracted from `frontend/src/pages/bookings/BookingCalendar.jsx`'s exported `BookingStatusBadge` (there, a page file exported it and `BookingDetail.jsx` imported it cross-file; here it becomes a real shared component since both `app/bookings/page.jsx` and `app/bookings/detail/page.jsx` need it).

```jsx
'use client';
/**
 * The colored status badge for a booking row, shared by the calendar's
 * day list and the booking detail page.
 * Extracted from frontend/src/pages/bookings/BookingCalendar.jsx (there it
 * was a page-level export imported cross-file by BookingDetail.jsx).
 */
import { useBookingLabels } from '../contexts/MetaContext.jsx';
import { Badge } from './ui.jsx';
import { BOOKING_STATUS_CLASS } from '../lib/constants.js';

export function BookingStatusBadge({ b }) {
  const { statusLabel } = useBookingLabels();
  return <Badge kind={BOOKING_STATUS_CLASS[b.status] || 'gray'}>{statusLabel(b.status)}</Badge>;
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend-next/lib/calendar.js frontend-next/lib/__tests__/calendar.test.js frontend-next/components/BookingStatusBadge.jsx
git commit -m "Add calendar date-math helpers and extract BookingStatusBadge"
```

---

### Task 2: Port BookingCalendar (`/bookings`)

**Files:**
- Create: `frontend-next/app/bookings/page.jsx` (port of `frontend/src/pages/bookings/BookingCalendar.jsx`)

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js` (`useAsync`), `contexts/MetaContext.jsx` (`useBookingLabels`), `components/ui.jsx`, `components/DataTable.jsx`, `components/QueryParamPage.jsx`, `components/BookingStatusBadge.jsx` (Task 1), `lib/calendar.js` (Task 1), `lib/constants.js` (`TH_DOW, TH_MONTHS`), `lib/format.js`.

- [ ] **Step 1: Write `frontend-next/app/bookings/page.jsx`**

Port of `frontend/src/pages/bookings/BookingCalendar.jsx`: router/import swaps as in every prior plan; the inline `daysInMonth`/`lead` calculations replaced with calls to `lib/calendar.js`; `BookingStatusBadge` now imported from `components/BookingStatusBadge.jsx` instead of being defined in this file; wrapped in `QueryParamPage` (reads `month`/`date` from the query string). Link-target changes: row click and the "open case" link both move to the `?id=` convention.

```jsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync } from '../../lib/hooks.js';
import { useBookingLabels } from '../../contexts/MetaContext.jsx';
import { Badge, Card, Loading, PageHead } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { QueryParamPage } from '../../components/QueryParamPage.jsx';
import { BookingStatusBadge } from '../../components/BookingStatusBadge.jsx';
import { daysInMonth, leadOffset, shiftMonth } from '../../lib/calendar.js';
import { TH_DOW, TH_MONTHS } from '../../lib/constants.js';
import { bookingName, dateOnly, fmtDate, hhmm, todayISO } from '../../lib/format.js';

function BookingCalendarInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { serviceLabel, channelLabel } = useBookingLabels();

  const monthParam = params.get('month');
  const [month, setMonth] = useState(
    /^\d{4}-\d{2}$/.test(monthParam || '') ? monthParam : todayISO().slice(0, 7)
  );
  const [selected, setSelected] = useState(params.get('date') || todayISO());

  const cal = useAsync(() => api.get('/api/bookings/calendar', { month }), [month]);
  const day = useAsync(() => api.get('/api/bookings', { date: selected, limit: 200 }), [selected]);

  const goToday = () => {
    setMonth(todayISO().slice(0, 7));
    setSelected(todayISO());
  };

  const [y, m] = month.split('-').map(Number);
  const totalDays = daysInMonth(y, m);
  const lead = leadOffset(y, m);
  const today = todayISO();

  const byDate = {};
  for (const d of cal.data?.days || []) byDate[dateOnly(d.d)] = d;

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(<div className="cal-cell cal-blank" key={'b' + i} />);
  for (let d = 1; d <= totalDays; d++) {
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const info = byDate[iso];
    const dow = new Date(y, m - 1, d).getDay();
    const busy = Number(info?.arrived || 0) + Number(info?.in_service || 0);
    const cls = [
      iso === today ? 'today' : '',
      iso === selected ? 'selected' : '',
      dow === 0 || dow === 6 ? 'weekend' : '',
      info ? 'has' : '',
    ].filter(Boolean).join(' ');

    cells.push(
      <div className={`cal-cell ${cls}`} key={iso} onClick={() => setSelected(iso)}>
        <div className="cal-date">{d}</div>
        {info && (
          <div className="cal-badges">
            {Number(info.pending) ? <span className="cal-b b-blue" title="รอมา">{info.pending}</span> : null}
            {busy ? <span className="cal-b b-warn" title="มาถึง/กำลังบริการ">{busy}</span> : null}
            {Number(info.done) ? <span className="cal-b b-ok" title="เสร็จสิ้น">{info.done}</span> : null}
            {Number(info.no_show) ? <span className="cal-b b-danger" title="ไม่มา">{info.no_show}</span> : null}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHead
        icon="📅"
        title="Queue Booking"
        subtitle="ปฏิทินจองคิวลูกค้า"
        actions={(
          <>
            <Link className="btn btn-ghost" href="/bookings/new">+ จองคิวใหม่</Link>
            <Link className="btn btn-ghost" href="/settings">⚙️ ตั้งค่าแจ้งเตือน</Link>
          </>
        )}
      />

      <div className="card">
        <div className="card-head">
          <button type="button" className="btn btn-sm btn-light" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <h2>{`${TH_MONTHS[m - 1]} ${y + 543}`}</h2>
          <button type="button" className="btn btn-sm btn-light" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
          <div className="right">
            <button type="button" className="btn btn-sm btn-light" onClick={goToday}>วันนี้</button>
          </div>
        </div>
        <div className="card-body">
          {cal.loading ? <Loading text="กำลังโหลดปฏิทิน…" /> : (
            <>
              <div className="cal-grid cal-dow">
                {TH_DOW.map((d) => <div className="cal-dowcell" key={d}>{d}</div>)}
              </div>
              <div className="cal-grid">{cells}</div>
              <div className="row" style={{ marginTop: 12, fontSize: 12 }}>
                <span><span className="cal-b b-blue">{' '}</span> รอมา</span>
                <span><span className="cal-b b-warn">{' '}</span> มาถึง/กำลังบริการ</span>
                <span><span className="cal-b b-ok">{' '}</span> เสร็จสิ้น</span>
                <span><span className="cal-b b-danger">{' '}</span> ไม่มาตามนัด</span>
              </div>
            </>
          )}
        </div>
      </div>

      <Card
        title={'คิววันที่ ' + fmtDate(selected)}
        badge={<Badge kind="gray">{`${day.data?.length ?? 0} คิว`}</Badge>}
        right={(
          <Link className="btn btn-sm btn-accent" href={`/bookings/new?date=${selected}`}>+ จองคิววันนี้</Link>
        )}
        tight
      >
        {day.loading ? <Loading text="กำลังโหลดคิว…" /> : (
          <DataTable
            columns={[
              { label: 'เวลา', render: (b) => <b>{hhmm(b.booking_time)}</b>, cls: 'nowrap' },
              { label: 'ระยะ', render: (b) => b.duration_min + ' น.', cls: 'num' },
              { label: 'รหัส', key: 'booking_code', cls: 'mono' },
              { label: 'ลูกค้า', render: bookingName },
              { label: 'เบอร์โทร', key: 'phone', cls: 'nowrap' },
              { label: 'บริการ', render: (b) => serviceLabel(b.service_type) },
              { label: 'ช่องทาง', render: (b) => channelLabel(b.channel) },
              { label: 'ผู้ดูแล', key: 'assigned_name' },
              { label: 'สถานะ', render: (b) => <BookingStatusBadge b={b} /> },
              {
                label: 'แจ้งเตือน',
                render: (b) => (b.reminder_sent_at
                  ? <Badge kind="ok">✓ ส่งแล้ว</Badge>
                  : <span className="muted">{`ก่อน ${b.reminder_minutes} น.`}</span>),
              },
              { label: 'บันทึกเบื้องต้น', render: (b) => (b.intake_note || '').slice(0, 60) },
              {
                label: '',
                cls: 'nowrap',
                render: (b) => (b.case_id
                  ? <Link className="btn btn-sm btn-light" href={'/cases/detail?id=' + b.case_id}>{'🗂 ' + b.case_code}</Link>
                  : <span className="muted">—</span>),
              },
            ]}
            rows={day.data || []}
            onRowClick={(b) => router.push('/bookings/detail?id=' + b.id)}
            empty="ยังไม่มีคิวในวันนี้"
          />
        )}
      </Card>
    </div>
  );
}

export default function BookingCalendarPage() {
  return (
    <QueryParamPage>
      <BookingCalendarInner />
    </QueryParamPage>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend-next/app/bookings/page.jsx
git commit -m "Port BookingCalendar to frontend-next"
```

---

### Task 3: `BookingFormView` shared component (booking create/edit)

**Files:**
- Create: `frontend-next/app/bookings/BookingFormView.jsx` (port of `frontend/src/pages/bookings/BookingForm.jsx`, restructured to take `editing` as an explicit prop)

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js` (`useAsync, readForm`), `contexts/MetaContext.jsx` (`useBookingLabels`), `components/Toast.jsx`, `components/ui.jsx`, `components/Picker.jsx`, `components/Selects.jsx`, `lib/format.js`.
- Produces: `BookingFormView({ editing })` — NOT a page (no default export needed to be a route; this file lives in `app/bookings/` without a `page.jsx` name, so Next does not treat it as a route). Consumed by Task 4's two thin page wrappers.
- Calls `useSearchParams()` internally (for `id` when editing, `customer`/`date` when not) — this means every caller MUST render `BookingFormView` inside a `QueryParamPage` boundary; Task 4 does this.

- [ ] **Step 1: Write `frontend-next/app/bookings/BookingFormView.jsx`**

```jsx
'use client';
/**
 * Shared booking create/edit form. Port of frontend/src/pages/bookings/BookingForm.jsx,
 * with one structural change: `editing` is now an explicit prop instead of being derived
 * from whether a path param was present (react-router's `!!useParams().id`). The two
 * callers — app/bookings/new/page.jsx and app/bookings/edit/page.jsx — each pass the
 * right value; this component itself reads `id` from the query string only when editing.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync, readForm } from '../../lib/hooks.js';
import { useBookingLabels } from '../../contexts/MetaContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import {
  Card, Field, FormActions, FormGrid, Loading, PageHead, Row, Split, Stack,
} from '../../components/ui.jsx';
import { Picker } from '../../components/Picker.jsx';
import { EmployeeSelect, Select } from '../../components/Selects.jsx';
import { custName, dateOnly, hhmm, todayISO } from '../../lib/format.js';

export function BookingFormView({ editing }) {
  const router = useRouter();
  const params = useSearchParams();
  const { ok, err } = useToast();
  const { serviceTypes, channels, intakeQuestions } = useBookingLabels();

  const id = editing ? params.get('id') : null;
  const queryCustomer = params.get('customer');
  const queryDate = params.get('date');

  const { data, loading } = useAsync(async () => {
    const b = editing ? await api.get('/api/bookings/' + id) : {};
    let customer = null;
    if (editing && b.customer_id) customer = await api.get('/api/customers/' + b.customer_id);
    else if (queryCustomer) customer = await api.get('/api/customers/' + queryCustomer);
    return { b, customer };
  }, [editing, id, queryCustomer]);

  /* undefined = untouched, null = explicitly cleared */
  const [override, setOverride] = useState(undefined);
  const [answers, setAnswers] = useState({});

  if (loading) return <Loading />;

  const b = data.b;
  const customer = override === undefined ? data.customer : override;

  const save = async (e) => {
    e.preventDefault();
    const body = { ...readForm(e.currentTarget), customer_id: customer ? customer.id : null };
    for (const k of Object.keys(body)) if (k.startsWith('q_')) delete body[k];

    // a linked customer owns the name fields; don't duplicate them on the booking
    if (customer) {
      body.first_name = null;
      body.last_name = null;
      body.phone = null;
      body.line_id = null;
    }
    if (!editing) {
      body.step_notes = intakeQuestions
        .map((q, i) => ({ question: q, note: (answers[i] || '').trim() }))
        .filter((x) => x.note)
        .map((x) => ({ step: 'intake', question: x.question, note: x.note }));
    }

    try {
      const saved = editing
        ? await api.put('/api/bookings/' + b.id, body)
        : await api.post('/api/bookings', body);
      ok(editing ? 'บันทึกแล้ว' : 'จองคิว ' + saved.booking_code + ' เรียบร้อย');
      router.push('/bookings/detail?id=' + saved.id);
    } catch (ex) {
      err(ex);
    }
  };

  /* when a customer is linked, the free-text fields are hidden and left blank */
  const freeText = (name, label) => (
    <Field label={label}>
      <input name={name} defaultValue={b.customer_id ? '' : (b[name] || '')} />
    </Field>
  );

  return (
    <>
      <PageHead
        icon="📅"
        title={editing ? 'Edit Booking' : 'New Booking'}
        subtitle={editing ? 'แก้ไขการจองคิว' : 'จองคิวลูกค้า'}
      />

      <Split>
        <Card title="ลูกค้าเดิม (ถ้ามี)">
          <Picker
            placeholder="ค้นหาลูกค้าเดิม (ชื่อ / เบอร์โทร / รหัส)"
            fetcher={(q) => api.get('/api/customers', { q, limit: 40 })}
            label={custName}
            sub={(r) => r.phone || ''}
            selectedId={customer?.id}
            onPick={setOverride}
          />
        </Card>

        <Card title="ลูกค้าที่จอง">
          {customer ? (
            <Row>
              <span className="badge blue">#{customer.id}</span>
              <b>{custName(customer)}</b>
              <span className="muted">{customer.phone || ''}</span>
              <button type="button" className="btn btn-sm btn-light" onClick={() => setOverride(null)}>
                ✕ ล้าง
              </button>
            </Row>
          ) : <span className="muted">ลูกค้าใหม่ — กรอกชื่อ/เบอร์ด้านล่างได้เลย</span>}

          <div style={{ display: customer ? 'none' : '', marginTop: 10 }}>
            <FormGrid>
              {freeText('first_name', 'ชื่อ')}
              {freeText('last_name', 'นามสกุล')}
              {freeText('phone', 'เบอร์โทร')}
              {freeText('line_id', 'LINE ID')}
            </FormGrid>
          </div>
        </Card>
      </Split>

      <form onSubmit={save}>
        <Card title="รายละเอียดการจอง">
          <FormGrid>
            <Field label="วันที่จอง *">
              <input
                name="booking_date"
                type="date"
                required
                defaultValue={dateOnly(b.booking_date) || queryDate || todayISO(1)}
              />
            </Field>
            <Field label="เวลา *">
              <input name="booking_time" type="time" required defaultValue={hhmm(b.booking_time) || '10:00'} />
            </Field>
            <Field label="ใช้เวลาประมาณ (นาที)">
              <input name="duration_min" type="number" min="5" step="5" defaultValue={b.duration_min ?? 30} />
            </Field>
            <Field label="บริการที่ต้องการ">
              <Select name="service_type" options={serviceTypes} defaultValue={b.service_type || 'eye_exam'} />
            </Field>
            <Field label="จองผ่านช่องทาง">
              <Select name="channel" options={channels} defaultValue={b.channel || 'phone'} />
            </Field>
            <Field label="พนักงานผู้ดูแล">
              <EmployeeSelect name="assigned_to" defaultValue={b.assigned_to || ''} />
            </Field>
            <Field
              label="แจ้งเตือนล่วงหน้า (นาที)"
              hint="ส่งเข้า Telegram ก่อนถึงคิว · ใส่ 0 = ไม่แจ้ง"
            >
              <input
                name="reminder_minutes"
                type="number"
                min="0"
                max="1440"
                defaultValue={b.reminder_minutes ?? 10}
              />
            </Field>
            <Field label="ผู้รับจอง">
              <EmployeeSelect name="created_by" defaultValue={b.created_by || ''} />
            </Field>
          </FormGrid>

          <Field label="บันทึกเบื้องต้น / Intake note" className="full">
            <textarea
              name="intake_note"
              defaultValue={b.intake_note || ''}
              placeholder="ลูกค้าโทรมาเรื่องอะไร มีอาการอย่างไร ต้องการอะไรเป็นพิเศษ"
            />
          </Field>
          <Field label="หมายเหตุอื่น ๆ" className="full">
            <textarea name="notes" defaultValue={b.notes || ''} />
          </Field>
        </Card>

        {!editing && (
          <Card title="คำถามเบื้องต้นตอนรับจอง (กรอกเท่าที่ถามได้)">
            <Stack>
              {intakeQuestions.map((q, i) => (
                <Field key={q} label={q}>
                  <input
                    placeholder="คำตอบ…"
                    value={answers[i] || ''}
                    onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })}
                  />
                </Field>
              ))}
            </Stack>
            <p className="hint">
              ข้อมูลนี้จะถูกส่งไปกับการแจ้งเตือน Telegram และคัดลอกเข้าเคสอัตโนมัติเมื่อลูกค้ามาถึง
            </p>
          </Card>
        )}

        <FormActions>
          <button className="btn btn-lg" type="submit">
            {editing ? '💾 บันทึกการแก้ไข' : '✔ บันทึกการจอง'}
          </button>
          <Link className="btn btn-light" href={editing ? '/bookings/detail?id=' + b.id : '/bookings'}>ยกเลิก</Link>
        </FormActions>
      </form>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend-next/app/bookings/BookingFormView.jsx
git commit -m "Add shared BookingFormView component with an explicit editing prop"
```

---

### Task 4: Wire the two booking-form pages (`/bookings/new`, `/bookings/edit`)

**Files:**
- Create: `frontend-next/app/bookings/new/page.jsx`
- Create: `frontend-next/app/bookings/edit/page.jsx`

**Interfaces:**
- Consumes: `components/QueryParamPage.jsx`, `app/bookings/BookingFormView.jsx` (Task 3).

- [ ] **Step 1: Write `frontend-next/app/bookings/new/page.jsx`**

```jsx
'use client';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { BookingFormView } from '../BookingFormView.jsx';

export default function NewBookingPage() {
  return (
    <QueryParamPage>
      <BookingFormView editing={false} />
    </QueryParamPage>
  );
}
```

- [ ] **Step 2: Write `frontend-next/app/bookings/edit/page.jsx`**

```jsx
'use client';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { BookingFormView } from '../BookingFormView.jsx';

export default function EditBookingPage() {
  return (
    <QueryParamPage>
      <BookingFormView editing />
    </QueryParamPage>
  );
}
```

- [ ] **Step 3: Verify the app compiles with Tasks 2-4 together**

Run (from `frontend-next/`): `npm run build`. Expected: succeeds, producing `out/bookings/index.html`, `out/bookings/new/index.html`, `out/bookings/edit/index.html`. (Task 5's `/bookings/detail` route doesn't exist yet — that's fine, this build only needs to include what exists so far. Full-domain build verification happens in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add frontend-next/app/bookings/new/page.jsx frontend-next/app/bookings/edit/page.jsx
git commit -m "Wire /bookings/new and /bookings/edit pages"
```

---

### Task 5: Port BookingDetail (`/bookings/detail?id=`)

**Files:**
- Create: `frontend-next/app/bookings/detail/page.jsx` (port of `frontend/src/pages/bookings/BookingDetail.jsx`)

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js`, `contexts/MetaContext.jsx`, `components/Toast.jsx`, `components/Confirm.jsx`, `components/ui.jsx`, `components/DataTable.jsx`, `components/Selects.jsx`, `components/BookingStatusBadge.jsx` (Task 1), `components/QueryParamPage.jsx`, `lib/constants.js` (`BOOKING_STEPS, BOOKING_STEP_LABEL`), `lib/format.js`.

- [ ] **Step 1: Write `frontend-next/app/bookings/detail/page.jsx`**

Port of `frontend/src/pages/bookings/BookingDetail.jsx`: `useParams()` → `useSearchParams().get('id')`; router/import swaps; `BookingStatusBadge` now imported from `components/BookingStatusBadge.jsx` (not `./BookingCalendar.jsx` cross-file, since it no longer lives there); wrapped in `QueryParamPage`. Link-target changes: edit link → `/bookings/edit?id=`, case link → `/cases/detail?id=`, customer link → `/customers/detail?id=`.

```jsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../lib/apiClient.js';
import { useAsync, readForm } from '../../../lib/hooks.js';
import { useBookingLabels } from '../../../contexts/MetaContext.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { useConfirm } from '../../../components/Confirm.jsx';
import {
  Badge, Card, Field, FormActions, FormGrid, Kv, Loading, PageHead, Row, Split, Stack,
} from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { EmployeeSelect, Select } from '../../../components/Selects.jsx';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { BookingStatusBadge } from '../../../components/BookingStatusBadge.jsx';
import { BOOKING_STEPS, BOOKING_STEP_LABEL } from '../../../lib/constants.js';
import { bookingName, dateOnly, fmtDate, fmtDateTime, hhmm } from '../../../lib/format.js';

function BookingDetailInner() {
  const params = useSearchParams();
  const id = params.get('id');
  const router = useRouter();
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const { serviceLabel, channelLabel } = useBookingLabels();

  const { data: b, loading, error, reload } = useAsync(() => api.get('/api/bookings/' + id), [id]);
  const [actor, setActor] = useState(undefined);
  const [sending, setSending] = useState(false);

  if (loading) return <Loading />;
  if (error) return <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>;

  const actorValue = actor === undefined ? (b.assigned_to || '') : actor;
  const empId = () => Number(actorValue) || null;

  const setStatus = async (status, extra = {}) => {
    try {
      await api.post(`/api/bookings/${b.id}/status`, { status, employee_id: empId(), ...extra });
      ok('อัปเดตสถานะแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const openCase = async () => {
    const message = b.customer_id
      ? `เปิดเคสใหม่ให้ ${bookingName(b)}?`
      : `ระบบจะสร้างลูกค้าใหม่ "${bookingName(b)}" แล้วเปิดเคสให้`;
    if (!await confirm('เปิดเคส', message, { confirmText: 'เปิดเคส' })) return;
    try {
      const r = await api.post(`/api/bookings/${b.id}/open-case`, { received_by: empId() });
      ok('เปิดเคส ' + r.caseCode + ' แล้ว');
      router.push('/cases/detail?id=' + r.caseId);
    } catch (ex) { err(ex); }
  };

  const remind = async () => {
    setSending(true);
    try {
      await api.post(`/api/bookings/${b.id}/remind`);
      ok('ส่งแล้ว');
      reload();
    } catch (ex) {
      err(ex);
    } finally {
      setSending(false);
    }
  };

  const removeBooking = async () => {
    if (!await confirm('ลบการจอง', `ลบ ${b.booking_code} ถาวร?`, { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del('/api/bookings/' + b.id);
      ok('ลบแล้ว');
      router.push('/bookings');
    } catch (ex) { err(ex); }
  };

  const addNote = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await api.post(`/api/bookings/${b.id}/notes`, readForm(form));
      ok('บันทึกแล้ว');
      form.reset();
      reload();
    } catch (ex) { err(ex); }
  };

  const removeNote = async (n) => {
    try {
      await api.del(`/api/bookings/${b.id}/notes/${n.id}`);
      ok('ลบแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <div>
      <PageHead
        icon="📅"
        title={b.booking_code}
        subtitle={bookingName(b)}
        actions={(
          <>
            {b.case_id && <Link className="btn btn-ghost" href={'/cases/detail?id=' + b.case_id}>{'🗂 ' + b.case_code}</Link>}
            <Link className="btn btn-ghost" href={`/bookings/edit?id=${b.id}`}>✎ แก้ไข</Link>
            <Link className="btn btn-ghost" href={`/bookings?date=${dateOnly(b.booking_date)}`}>← ปฏิทิน</Link>
          </>
        )}
      />

      <Split>
        <Card title="ข้อมูลการจอง">
          <Row style={{ marginBottom: 12 }}>
            <BookingStatusBadge b={b} />
            {b.reminder_sent_at
              ? <Badge kind="ok">{'🔔 แจ้งเตือนแล้ว ' + fmtDateTime(b.reminder_sent_at)}</Badge>
              : <Badge kind="gray">{`🔔 จะแจ้งก่อน ${b.reminder_minutes} นาที`}</Badge>}
          </Row>

          <Kv rows={[
            ['วันเวลา', <b>{`${fmtDate(b.booking_date)} เวลา ${hhmm(b.booking_time)} น.`}</b>],
            ['ใช้เวลา', b.duration_min + ' นาที'],
            ['บริการ', serviceLabel(b.service_type)],
            ['ช่องทางจอง', channelLabel(b.channel)],
            ['ลูกค้า', b.customer_id
              ? <Link href={'/customers/detail?id=' + b.customer_id}>{bookingName(b)}</Link>
              : bookingName(b) + ' (ลูกค้าใหม่)'],
            ['เบอร์โทร', b.phone || '-'],
            ['LINE', b.line_id || '-'],
            ['ผู้ดูแล', b.assigned_name || '-'],
            ['ผู้รับจอง', b.created_by_name || '-'],
            ['ยืนยันเมื่อ', fmtDateTime(b.confirmed_at) || '-'],
            ['มาถึงเมื่อ', fmtDateTime(b.arrived_at) || '-'],
            b.cancelled_reason ? ['เหตุผล', b.cancelled_reason] : null,
            ['หมายเหตุ', b.notes || '-'],
          ]}
          />

          {b.intake_note && (
            <div style={{ marginTop: 12 }}>
              <label>บันทึกเบื้องต้น</label>
              <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{b.intake_note}</p>
            </div>
          )}
        </Card>

        <Stack>
          <Card title="การจัดการคิว">
            <FormGrid>
              <Field label="ผู้ทำรายการ">
                <EmployeeSelect value={actorValue} onChange={(e) => setActor(e.target.value)} />
              </Field>
            </FormGrid>

            <Row style={{ marginTop: 12 }}>
              {b.status === 'booked' && (
                <button type="button" className="btn btn-sm btn-accent" onClick={() => setStatus('confirmed')}>
                  ✔ ยืนยันคิว
                </button>
              )}
              {['booked', 'confirmed'].includes(b.status) && (
                <button type="button" className="btn btn-sm btn-ok" onClick={() => setStatus('arrived')}>
                  🚶 ลูกค้ามาถึง
                </button>
              )}
              {!b.case_id && ['arrived', 'confirmed', 'booked'].includes(b.status) && (
                <button type="button" className="btn btn-sm" onClick={openCase}>🗂 เปิดเคสให้ลูกค้า</button>
              )}
              {b.status !== 'done' && (
                <button type="button" className="btn btn-sm btn-light" onClick={() => setStatus('done')}>
                  ✅ เสร็จสิ้น
                </button>
              )}
              {!['cancelled', 'no_show', 'done'].includes(b.status) && (
                <button
                  type="button"
                  className="btn btn-sm btn-light"
                  onClick={async () => {
                    if (!await confirm('ไม่มาตามนัด', 'บันทึกว่าลูกค้าไม่มาตามนัด?', { confirmText: 'บันทึก' })) return;
                    setStatus('no_show');
                  }}
                >
                  👻 ไม่มาตามนัด
                </button>
              )}
              {b.status !== 'cancelled' && (
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={async () => {
                    if (!await confirm('ยกเลิกคิว', `ยกเลิกการจอง ${b.booking_code}?`,
                      { confirmText: 'ยกเลิกคิว', danger: true })) return;
                    setStatus('cancelled');
                  }}
                >
                  ✕ ยกเลิกคิว
                </button>
              )}
            </Row>

            <hr style={{ border: 0, borderTop: '1px solid var(--line-soft)', margin: '14px 0' }} />

            <Row>
              <button type="button" className="btn btn-sm btn-light" disabled={sending} onClick={remind}>
                🔔 ส่งแจ้งเตือน Telegram เดี๋ยวนี้
              </button>
              {!b.case_id && (
                <button type="button" className="btn btn-sm btn-light" onClick={removeBooking}>🗑 ลบการจอง</button>
              )}
            </Row>

            {b.notifications?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <label>ประวัติการแจ้งเตือน</label>
                <div className="stack" style={{ gap: 4, marginTop: 5 }}>
                  {b.notifications.map((n) => (
                    <div className="row" style={{ fontSize: 12.5 }} key={n.id}>
                      {Number(n.ok) ? <Badge kind="ok">✓</Badge> : <Badge kind="danger">✕</Badge>}
                      <span className="muted">{fmtDateTime(n.created_at)}</span>
                      <span className="muted">{n.kind}</span>
                      {n.error ? <span style={{ color: 'var(--danger)' }}>{n.error}</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </Stack>
      </Split>

      <div className="card">
        <div className="card-head">
          <h2>บันทึกเบื้องต้นทีละขั้นตอน</h2>
          <Badge kind="gray">{`${(b.step_notes || []).length} รายการ`}</Badge>
        </div>

        <div className="card-body tight">
          <DataTable
            columns={[
              { label: 'เมื่อ', render: (n) => fmtDateTime(n.created_at), cls: 'nowrap' },
              {
                label: 'ขั้นตอน',
                render: (n) => <Badge kind="blue">{BOOKING_STEP_LABEL[n.step] || n.step}</Badge>,
              },
              { label: 'หัวข้อ/คำถาม', key: 'question' },
              { label: 'บันทึก', key: 'note' },
              { label: 'ผู้บันทึก', key: 'recorded_by_name' },
              {
                label: '',
                cls: 'nowrap',
                render: (n) => (
                  <button type="button" className="btn btn-sm btn-light" onClick={() => removeNote(n)}>🗑</button>
                ),
              },
            ]}
            rows={b.step_notes || []}
            empty="ยังไม่มีบันทึก"
          />
        </div>

        <form className="card-body" onSubmit={addNote}>
          <FormGrid>
            <Field label="ขั้นตอน">
              <Select name="step" options={BOOKING_STEPS} defaultValue="intake" />
            </Field>
            <Field label="หัวข้อ / คำถาม">
              <input name="question" placeholder="เช่น อาการที่พบ" />
            </Field>
            <Field label="ผู้บันทึก">
              <EmployeeSelect name="recorded_by" defaultValue={b.assigned_to || ''} />
            </Field>
          </FormGrid>
          <Field label="บันทึก *" className="full">
            <textarea name="note" required placeholder="สิ่งที่ลูกค้าบอก / สิ่งที่ต้องเตรียม" />
          </Field>
          <FormActions>
            <button className="btn" type="submit">+ เพิ่มบันทึก</button>
          </FormActions>
        </form>
      </div>
    </div>
  );
}

export default function BookingDetailPage() {
  return (
    <QueryParamPage>
      <BookingDetailInner />
    </QueryParamPage>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend-next/app/bookings/detail/page.jsx
git commit -m "Port BookingDetail to frontend-next"
```

---

### Task 6: Port Settings (`/settings`)

**Files:**
- Create: `frontend-next/app/settings/page.jsx` (port of `frontend/src/pages/bookings/Settings.jsx`)

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js`, `components/Toast.jsx`, `components/ui.jsx`, `components/DataTable.jsx`, `lib/format.js`. No `useSearchParams()` in this page — no `QueryParamPage` wrapper needed.

- [ ] **Step 1: Write `frontend-next/app/settings/page.jsx`**

Port of `frontend/src/pages/bookings/Settings.jsx`: import-path swap only (`api/client.js` → `lib/apiClient.js`), no router hooks used in the source at all, so no `Link`/`useSearchParams` changes needed either.

```jsx
'use client';
import { useState } from 'react';
import { api } from '../../lib/apiClient.js';
import { useAsync, readForm } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import {
  Badge, Card, Field, FormActions, FormGrid, Loading, PageHead,
} from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { fmtDateTime } from '../../lib/format.js';

export default function SettingsPage() {
  const { ok, err } = useToast();
  const { data, loading, error, reload } = useAsync(async () => {
    const [s, logs] = await Promise.all([
      api.get('/api/settings'),
      api.get('/api/notifications', { limit: 50 }),
    ]);
    return { s, logs };
  }, []);

  /* the token and chat id are also read by the two side buttons */
  const [token, setToken] = useState(undefined);
  const [chat, setChat] = useState(undefined);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (error) return <Card><p className="muted">{error.message}</p></Card>;

  const { s, logs } = data;
  const tokenValue = token === undefined ? (s.telegram_bot_token || '') : token;
  const chatValue = chat === undefined ? (s.telegram_chat_id || '') : chat;
  const enabled = s.telegram_enabled === '1';

  const save = async (e) => {
    e.preventDefault();
    const body = readForm(e.currentTarget);
    body.telegram_enabled = body.telegram_enabled ? '1' : '0';
    if (s.telegram_token_from_env) delete body.telegram_bot_token;
    try {
      await api.put('/api/settings', body);
      ok('บันทึกการตั้งค่าแล้ว');
      setToken(undefined);
      setChat(undefined);
      reload();
    } catch (ex) { err(ex); }
  };

  const test = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/settings/telegram/test', {
        telegram_bot_token: tokenValue,
        telegram_chat_id: chatValue,
      });
      ok(`ส่งสำเร็จ! บอท @${r.bot.username}`);
      reload();
    } catch (ex) {
      err(ex);
    } finally {
      setBusy(false);
    }
  };

  const runReminders = async () => {
    try {
      const r = await api.post('/api/reminders/run');
      ok(r.skipped ? r.skipped : `ตรวจ ${r.checked} คิว · ส่ง ${r.sent} ข้อความ`);
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <div>
      <PageHead icon="⚙️" title="Settings" subtitle="ตั้งค่าระบบแจ้งเตือน" />

      <div className="card">
        <div className="card-head">
          <h2>Telegram</h2>
          {s.telegram_configured
            ? <Badge kind="ok">ตั้งค่าแล้ว</Badge>
            : <Badge kind="warn">ยังไม่ได้ตั้งค่า</Badge>}
          {enabled ? <Badge kind="blue">เปิดใช้งาน</Badge> : <Badge kind="gray">ปิดอยู่</Badge>}
        </div>

        <form className="card-body" onSubmit={save}>
          <FormGrid>
            <Field label="เปิดใช้งาน" className="full">
              <label className="check">
                <input type="checkbox" name="telegram_enabled" defaultChecked={enabled} />
                {' '}ส่งแจ้งเตือนคิวเข้า Telegram
              </label>
            </Field>

            <Field
              label="Bot Token"
              className="full"
              hint={s.telegram_token_from_env
                ? 'กำหนดผ่าน environment variable TELEGRAM_BOT_TOKEN อยู่ — แก้ที่นี่ไม่ได้'
                : 'ได้จาก @BotFather ใน Telegram (คำสั่ง /newbot)'}
            >
              <input
                name="telegram_bot_token"
                placeholder="123456789:AAF..."
                disabled={!!s.telegram_token_from_env}
                value={tokenValue}
                onChange={(e) => setToken(e.target.value)}
              />
            </Field>

            <Field
              label="Chat ID (กลุ่มหรือคนที่จะรับแจ้งเตือน)"
              className="full"
              hint="ชวนบอทเข้ากลุ่มร้าน แล้วดู chat id ได้จาก @userinfobot หรือ @getidsbot"
            >
              <input
                name="telegram_chat_id"
                placeholder="-1001234567890 หรือ 123456789"
                value={chatValue}
                onChange={(e) => setChat(e.target.value)}
              />
            </Field>

            <Field label="แจ้งเตือนล่วงหน้าปริยาย (นาที)">
              <input
                name="reminder_default_minutes"
                type="number" min="0" max="1440"
                defaultValue={s.reminder_default_minutes || 10}
              />
            </Field>
            <Field label="ชื่อร้าน"><input name="shop_name" defaultValue={s.shop_name || ''} /></Field>
            <Field label="เวลาเปิดร้าน">
              <input name="shop_open_time" type="time" defaultValue={s.shop_open_time || '10:00'} />
            </Field>
            <Field label="เวลาปิดร้าน">
              <input name="shop_close_time" type="time" defaultValue={s.shop_close_time || '20:00'} />
            </Field>
          </FormGrid>

          <FormActions>
            <button className="btn btn-lg" type="submit">💾 บันทึกการตั้งค่า</button>
            <button type="button" className="btn btn-light" disabled={busy} onClick={test}>
              🧪 ทดสอบส่งข้อความ
            </button>
            <button type="button" className="btn btn-light" onClick={runReminders}>
              ⏱ รันตัวเตือนเดี๋ยวนี้
            </button>
          </FormActions>
        </form>
      </div>

      <Card title="วิธีตั้งค่า Telegram">
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
          <li>เปิด Telegram ค้นหา @BotFather แล้วพิมพ์ /newbot ตั้งชื่อบอท</li>
          <li>BotFather จะให้ Bot Token มา — ก็อปมาวางในช่องด้านบน</li>
          <li>สร้างกลุ่มของร้าน (เช่น &quot;TimeOptic คิวลูกค้า&quot;) แล้วเชิญบอทเข้ากลุ่ม</li>
          <li>เชิญ @getidsbot เข้ากลุ่มเพื่อดู Chat ID (ของกลุ่มจะขึ้นต้นด้วย -100) แล้วเตะออกได้</li>
          <li>วาง Chat ID ติ๊กเปิดใช้งาน → บันทึก → กดปุ่มทดสอบ</li>
        </ol>
      </Card>

      <Card title="ประวัติการแจ้งเตือนล่าสุด" tight>
        <DataTable
          columns={[
            { label: 'เมื่อ', render: (n) => fmtDateTime(n.created_at), cls: 'nowrap' },
            { label: 'ประเภท', key: 'kind' },
            { label: 'การจอง', key: 'booking_code', cls: 'mono' },
            {
              label: 'ผล',
              render: (n) => (Number(n.ok)
                ? <Badge kind="ok">สำเร็จ</Badge>
                : <Badge kind="danger">ไม่สำเร็จ</Badge>),
            },
            { label: 'ข้อผิดพลาด', key: 'error' },
          ]}
          rows={logs}
          empty="ยังไม่มีการแจ้งเตือน"
        />
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend-next/app/settings/page.jsx
git commit -m "Port Settings to frontend-next"
```

---

### Task 7: Breadcrumbs, build, browser-load check, and verify against the real API

**Files:**
- Modify: `frontend-next/lib/crumb.js` (add `/bookings/edit` — `/bookings/detail`, `/bookings/new`, `/settings` should already be present from Foundation/cases; check and add only what's missing)

**Interfaces:** none new.

- [ ] **Step 1: Check `frontend-next/lib/crumb.js`'s `TITLES` array**

Add exactly one missing entry (verify the others really are already present before assuming): `['/bookings/edit', 'แก้ไขการจองคิว'],` positioned before the existing `/bookings/new` or `/bookings` entries per the longest-match convention already established.

- [ ] **Step 2: Run the full test suite**

```bash
cd frontend-next
npm test
```
Expected: all tests pass, including the 6 new `calendar.test.js` tests.

- [ ] **Step 3: Build, then actually serve and load the static export in a browser — not just confirm the build exits 0**

This step exists because the cases-domain plan's final review found a hydration bug that `npm run build` succeeding had hidden — `next build` proves the code compiles, not that it runs correctly for a real user.

```bash
npm run build
```
Expected: succeeds, producing `out/bookings/index.html`, `out/bookings/new/index.html`, `out/bookings/edit/index.html`, `out/bookings/detail/index.html`, `out/settings/index.html`.

Then serve `out/` locally (e.g. `npx serve out` or any static file server) and load `/bookings/`, `/bookings/new/`, `/settings/` in headless Chrome (or a real browser if available) with the DevTools Protocol — watch the **console for errors**, specifically any React hydration warnings/errors. If anything shows up, fix the root cause before proceeding (do not proceed with a known hydration issue the way the cases-domain plan almost did).

- [ ] **Step 4: Manually verify against the real PHP API + MariaDB, compared with the still-running Vite app**

XAMPP MySQL running, PHP API running, Next dev server running (`npm run dev` from `frontend-next/`), Vite app running for comparison.

- Compare `/bookings` (Next) vs `/#/bookings` (Vite) — same calendar grid, same day badges, same day-list table for today.
- Compare `/bookings/new` vs `/#/bookings/new` — the customer Picker should behave identically; submitting a real test booking (date far in the future, e.g. a date next month, so it doesn't collide with real queue data) should succeed on both and produce the same `booking_code` shape.
- Compare `/bookings/edit?id=<n>` (pick the id of the test booking you just created) vs `/#/bookings/<n>/edit` — same pre-filled fields.
- Compare `/bookings/detail?id=<n>` vs `/#/bookings/<n>` — same header, KPIs/status, step-notes table. Exercise one safe write (add a step note) and confirm it round-trips.
- **Delete the test booking you created** from the real database afterward (via the "ลบการจอง" button in either app, or directly, verified by exact-content match) — this is the live production database, same discipline as every prior plan's write tests.
- Compare `/settings` vs `/#/settings` — same Telegram config values, same notification log rows. Do NOT click "ทดสอบส่งข้อความ" (test-send) unless you're certain it's safe to actually send a real Telegram message with this shop's configured bot/chat — if in doubt, skip that one button and note it in your report rather than guessing.
- Stop all servers when done.

- [ ] **Step 5: Commit**

```bash
git add frontend-next/lib/crumb.js
git commit -m "Add /bookings/edit breadcrumb entry; verify bookings domain against real API"
```

---

### Task 8: Verify in-browser at all three required breakpoints

**Files:** none (verification only; fix in `frontend-next/app/globals.css` only if something real is found).

- [ ] **Step 1: Start both servers.**

- [ ] **Step 2: Launch Chrome headless with remote debugging**, same method as every prior plan.

- [ ] **Step 3: Screenshot and inspect `/bookings` (the calendar — this domain's highest overflow risk, since its 7-column month grid is fixed, unlike the cases board's `auto-fit` kanban columns which can reflow) and `/bookings/detail?id=<n>` (a `Split` two-column detail layout) at all three required sizes: 1920×1080, 810×1080, 1080×810.**

Check specifically: the calendar's 7-column grid does not force horizontal scroll on the page body at 810×1080 — if it does, this is a real, expected-possible finding (unlike the cases board, which had CSS already handling `auto-fit` reflow, this fixed 7-column grid may not have been exercised at this width before); at 810×1080 with the sidebar drawer opened, confirm the drawer's close mechanisms still work on this new page (regression check); `/bookings/detail`'s `Split` layout doesn't clip content at narrow widths.

- [ ] **Step 4: If the calendar grid does overflow at 810×1080, fix it in `frontend-next/app/globals.css`** — likely by allowing the grid to shrink cell width/font-size at that breakpoint, or wrapping it in a horizontally-scrollable container the way `.table-wrap` already does for wide tables (check `globals.css` for that existing pattern and reuse it if it fits). Re-screenshot until it passes. If nothing needs fixing, say so plainly.

- [ ] **Step 5: Kill headless Chrome and both dev servers** (best effort, as in prior plans).

- [ ] **Step 6: Commit any fix** (message: `Fix responsive layout issues found verifying the bookings domain`). Skip if nothing needed fixing.

---

## Self-Review Notes

- **Spec coverage:** every page in `frontend/src/pages/bookings/` has a corresponding task, including the split of the dual-mode `BookingForm` into two real page files per the cases-domain final review's explicit recommendation. `npm run build` + browser-console-check is now a required, explicit step (Task 7), directly addressing the gap that let a hydration bug through the cases-domain plan.
- **Placeholder scan:** no TBDs; every step has runnable code or an exact command.
- **Type/name consistency:** `BookingFormView` (Task 3) takes exactly `{ editing }`; both Task 4 page files pass it correctly (`false` and no-prop-defaults-undefined-but-truthy respectively — note: `<BookingFormView editing />` passes `editing: true`, `<BookingFormView editing={false} />` passes `editing: false` explicitly, matching the "explicit prop" requirement exactly, not relying on a default value). `BookingStatusBadge` (Task 1) is imported by both Task 2 and Task 5 from `components/BookingStatusBadge.jsx`, never redefined.
- **Scope:** this plan covers only the `bookings` domain (plus the standalone `/settings` page, which lived in the same Vite folder). Links to not-yet-ported domains (`/customers/detail?id=`) are written now following the query-string-id convention.

## After This Plan

Next domain plan: **customers** (list, form, detail) — both `CaseForm`'s Picker and `BookingForm`'s Picker already link to `/customers/new`, and `BookingDetail`/`CaseDetail` both link to `/customers/detail?id=`, so porting it next resolves the largest number of currently-dangling (but intentionally pre-written) links across the two completed domains.
