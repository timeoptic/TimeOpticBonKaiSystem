# Next.js Customers Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the `customers` domain (search/list, create/edit form, detail with cases/prescriptions/orders history) from `frontend/` (Vite) to `frontend-next/` (Next.js), against the same PHP API + MariaDB, applying the exact fix pattern the bookings-domain plan's final review had to retrofit after the fact: the shared create/edit form component destructures and guards `error` from the start, and guards `editing && !id` inside the data loader itself (not just at render) from the start — no later hotfix needed this time.

**Architecture:** Same client-fetch, no-SSR pattern as every prior plan. This domain needs **no new shared components** — `DataTable`, `StatusChip`, `OrderStatusBadge`, `Card`, `Kv`, `Loading`, `Field`, `FormGrid`, `FormActions`, `ListSelect` all already exist from Foundation/cases. The Vite `CustomerForm.jsx` is dual-mode (`/customers/new` and `/customers/:id/edit` off one component deriving `editing` from `!!useParams().id`) — this plan follows the bookings-domain template exactly: one shared `CustomerFormView` component taking `editing` as an explicit prop, rendered by two thin page files.

**Tech Stack:** Same as prior plans — Next.js 15 (App Router, static export), React 19.2.8, `frontend-next/lib/apiClient.js`, shared UI components, `components/QueryParamPage.jsx`.

**Spec:** `docs/superpowers/specs/2026-08-25-nextjs-frontend-only-migration-design.md`

**Depends on:** Foundation, cases-domain, and bookings-domain plans (all complete). `app/error.jsx` (a global error boundary added during the bookings-domain plan's final-review fix) already exists and protects this domain's pages too — no need to add another one.

## Global Constraints

- `frontend/` (Vite) and `api/` (PHP) are not touched by this plan.
- No SSR — every page a Client Component.
- Any component calling `useSearchParams()` must be wrapped in `QueryParamPage`, and that hook must only be called inside the wrapped child, never a `page.jsx` default export directly.
- `editing` in the customer-form flow is an explicit prop — never derived from `searchParams.get('id') != null`.
- **Any shared view component that uses `useAsync` and later dereferences its `data` must destructure and guard `error` before doing so, and must guard `editing && !id` inside the loader itself (not just at render) before this component's first commit — this is not optional, it is the exact bug class the bookings-domain plan's final review found and had to fix after the fact.** `useAsync`'s effect fires on every render regardless of any earlier `return`, so a render-only guard does not prevent a doomed request; the loader itself must short-circuit.
- Record-detail routes use `?id=` — `/customers/detail?id=`, `/customers/edit?id=`.
- UI must work at 1920×1080, 810×1080 (iPad portrait), 1080×810 (iPad landscape) — verified with real Chrome headless DevTools Protocol screenshots.
- `npm run build` must pass AND the resulting `frontend-next/out/` must be served and loaded in a real browser with the console checked — **including at least one edit/detail URL with a bogus/nonexistent id**, not just happy-path URLs. This is a direct process fix from the bookings-domain plan's final review: its browser-console check only exercised happy paths and missed the one real bug in that range, which lived entirely in a failure path.

---

## File Structure

```
frontend-next/
├── app/
│   ├── customers/
│   │   ├── page.jsx                CustomerList
│   │   ├── CustomerFormView.jsx    shared inner component (NOT a route)
│   │   ├── new/
│   │   │   └── page.jsx            renders <CustomerFormView editing={false} />
│   │   ├── edit/
│   │   │   └── page.jsx            renders <CustomerFormView editing />
│   │   └── detail/
│   │       └── page.jsx            CustomerDetail
```

No new files under `components/` or `lib/` this time — this domain reuses everything Foundation/cases already built.

**Interfaces later domain plans will rely on:** none new. This plan is purely an application of already-established patterns (`QueryParamPage`, the `editing`-prop shared-view template, the query-string-id convention) — its value to later plans (prescriptions, orders) is proving the template holds for a *simpler* domain with no panels/no new components, and demonstrating the error/loader-guard fix baked in from the start rather than retrofitted.

---

### Task 1: `CustomerFormView` shared component (customer create/edit)

**Files:**
- Create: `frontend-next/app/customers/CustomerFormView.jsx` (port of `frontend/src/pages/customers/CustomerForm.jsx`, restructured with an explicit `editing` prop, PLUS the error/loader guards the bookings-domain plan had to retrofit)

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js` (`useAsync, onSubmit`), `components/Toast.jsx`, `components/ui.jsx`, `components/Selects.jsx` (`ListSelect`), `lib/constants.js` (`NATIONALITIES`), `lib/format.js` (`dateOnly`).
- Produces: `CustomerFormView({ editing })` — not a page (no `page.jsx` filename). Calls `useSearchParams()` internally (for `id` when editing, `next` always) — every caller MUST render it inside `QueryParamPage`; Task 2 does this.

- [ ] **Step 1: Write `frontend-next/app/customers/CustomerFormView.jsx`**

```jsx
'use client';
/**
 * Shared customer create/edit form. Port of frontend/src/pages/customers/CustomerForm.jsx,
 * restructured the same way app/bookings/BookingFormView.jsx was: `editing` is an explicit
 * prop, not derived from a route param. This version also bakes in, from the start, the
 * error/loader guards that BookingFormView needed a hotfix to add after its final review —
 * see the plan's Global Constraints for why both guards are required together.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync, onSubmit } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import { Card, Field, FormActions, FormGrid, Loading, PageHead } from '../../components/ui.jsx';
import { ListSelect } from '../../components/Selects.jsx';
import { NATIONALITIES } from '../../lib/constants.js';
import { dateOnly } from '../../lib/format.js';

// editing must always be passed explicitly by the caller (true or false) — if a future
// page forgets it, editing becomes undefined (falsy), silently serving a *create* form
// on what was meant to be an *edit* route.
export function CustomerFormView({ editing }) {
  const router = useRouter();
  const params = useSearchParams();
  const { ok, err } = useToast();

  const id = editing ? params.get('id') : null;

  const { data: c, loading, error } = useAsync(() => {
    if (editing && !id) return Promise.resolve({});
    return editing ? api.get('/api/customers/' + id) : Promise.resolve({});
  }, [editing, id]);

  if (loading) return <Loading />;
  if (error) return <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>;
  if (editing && !id) {
    return <Card><h2>ไม่พบรหัสลูกค้า</h2><p className="muted">ไม่มี id ของลูกค้าที่จะแก้ไข</p></Card>;
  }

  const save = async (body) => {
    try {
      const saved = editing
        ? await api.put('/api/customers/' + c.id, body)
        : await api.post('/api/customers', body);
      ok('บันทึกลูกค้าเรียบร้อย');
      if (params.get('next') === 'case') router.push('/cases/new?customer=' + saved.id);
      else router.push('/customers/detail?id=' + saved.id);
    } catch (ex) {
      err(ex);
    }
  };

  return (
    <>
      <PageHead
        icon="👥"
        title={editing ? 'Edit Customer' : 'New Customer'}
        subtitle={editing ? 'แก้ไขข้อมูลลูกค้า' : 'ลูกค้าใหม่'}
      />
      <form className="card" onSubmit={onSubmit(save)}>
        <div className="card-body">
          <FormGrid>
            <Field label="ชื่อ / First name">
              <input name="first_name" defaultValue={c.first_name || ''} required />
            </Field>
            <Field label="ชื่อกลาง / Mid name">
              <input name="mid_name" defaultValue={c.mid_name || ''} />
            </Field>
            <Field label="นามสกุล / Last name">
              <input name="last_name" defaultValue={c.last_name || ''} />
            </Field>
            <Field label="เพศ / Sex">
              <ListSelect name="sex" kind="sex" defaultValue={c.sex || ''} blank="—" />
            </Field>
            <Field label="สัญชาติ / Nationality">
              <input name="nationality" defaultValue={c.nationality || ''} list="nat-list" />
            </Field>
            <Field label="วันเกิด / Birth date">
              <input name="birth_date" type="date" defaultValue={dateOnly(c.birth_date)} />
            </Field>
            <Field label="เบอร์โทร / Phone">
              <input name="phone" defaultValue={c.phone || ''} />
            </Field>
            <Field label="LINE ID">
              <input name="line_id" defaultValue={c.line_id || ''} />
            </Field>
            <Field label="อีเมล / Email">
              <input name="email" type="email" defaultValue={c.email || ''} />
            </Field>
            <Field label="หมายเหตุ / Notes" className="full">
              <textarea name="notes" defaultValue={c.notes || ''} />
            </Field>
          </FormGrid>

          <datalist id="nat-list">
            {NATIONALITIES.map((n) => <option key={n} value={n} />)}
          </datalist>

          <FormActions>
            <button className="btn btn-lg" type="submit">
              {editing ? '💾 บันทึกการแก้ไข' : '✔ บันทึกลูกค้าใหม่'}
            </button>
            <Link className="btn btn-light" href={editing ? '/customers/detail?id=' + c.id : '/customers'}>ยกเลิก</Link>
          </FormActions>
        </div>
      </form>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend-next/app/customers/CustomerFormView.jsx
git commit -m "Add shared CustomerFormView component with explicit editing prop and loader guards"
```

---

### Task 2: Wire the two customer-form pages (`/customers/new`, `/customers/edit`)

**Files:**
- Create: `frontend-next/app/customers/new/page.jsx`
- Create: `frontend-next/app/customers/edit/page.jsx`

**Interfaces:**
- Consumes: `components/QueryParamPage.jsx`, `app/customers/CustomerFormView.jsx` (Task 1).

- [ ] **Step 1: Write `frontend-next/app/customers/new/page.jsx`**

```jsx
'use client';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { CustomerFormView } from '../CustomerFormView.jsx';

export default function NewCustomerPage() {
  return (
    <QueryParamPage>
      <CustomerFormView editing={false} />
    </QueryParamPage>
  );
}
```

- [ ] **Step 2: Write `frontend-next/app/customers/edit/page.jsx`**

```jsx
'use client';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { CustomerFormView } from '../CustomerFormView.jsx';

export default function EditCustomerPage() {
  return (
    <QueryParamPage>
      <CustomerFormView editing />
    </QueryParamPage>
  );
}
```

- [ ] **Step 3: Verify the build compiles**

Run (from `frontend-next/`): `npm run build`. Expected: succeeds, producing `out/customers/new/index.html`, `out/customers/edit/index.html`.

- [ ] **Step 4: Commit**

```bash
git add frontend-next/app/customers/new/page.jsx frontend-next/app/customers/edit/page.jsx
git commit -m "Wire /customers/new and /customers/edit pages"
```

---

### Task 3: Port CustomerList (`/customers`)

**Files:**
- Create: `frontend-next/app/customers/page.jsx` (port of `frontend/src/pages/customers/CustomerList.jsx`)

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js` (`useAsync, useDebounced`), `components/ui.jsx`, `components/DataTable.jsx`, `components/QueryParamPage.jsx`.

- [ ] **Step 1: Write `frontend-next/app/customers/page.jsx`**

Port of `frontend/src/pages/customers/CustomerList.jsx`: router/import swaps as in every prior plan; wrapped in `QueryParamPage` (reads `q` from the query string). Link-target changes: row click and the prescription-history row's edit/print links (none here — this page doesn't have those) — just the row click and the "เปิดเคส"/prescription-new buttons, which stay as static routes with a `?customer=` query param (unchanged, since `/cases/new` and `/prescriptions/new` are themselves static routes, not id-bearing detail routes).

```jsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync, useDebounced } from '../../lib/hooks.js';
import { Card, Field, Loading, PageHead, Toolbar } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { QueryParamPage } from '../../components/QueryParamPage.jsx';

function CustomerListInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [term, setTerm] = useState(params.get('q') || '');
  const q = useDebounced(term);

  const { data: rows, loading, error } = useAsync(
    () => api.get('/api/customers', { q: q.trim(), limit: 300 }),
    [q]
  );

  return (
    <div>
      <PageHead
        icon="👥"
        title="Customer Search"
        subtitle="ค้นหาข้อมูลลูกค้า"
        actions={<Link className="btn btn-ghost" href="/customers/new">+ ลูกค้าใหม่</Link>}
      />

      <Toolbar>
        <Field label="ค้นหา" className="grow">
          <input
            type="search"
            autoFocus
            placeholder="ค้นหา ชื่อ / นามสกุล / เบอร์โทร / LINE / อีเมล / รหัสลูกค้า"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </Field>
      </Toolbar>

      {loading && <Loading text="กำลังค้นหา…" />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (
        <Card tight>
          <DataTable
            columns={[
              { label: 'ID', key: 'id', cls: 'mono' },
              { label: 'ชื่อ', key: 'first_name' },
              { label: 'นามสกุล', key: 'last_name' },
              { label: 'เพศ', key: 'sex' },
              { label: 'สัญชาติ', key: 'nationality' },
              { label: 'เบอร์โทร', key: 'phone', cls: 'nowrap' },
              { label: 'LINE', key: 'line_id' },
              { label: 'อีเมล', key: 'email' },
              {
                label: '',
                cls: 'nowrap',
                render: (r) => (
                  <>
                    <Link className="btn btn-sm btn-accent" href={`/cases/new?customer=${r.id}`}>🗂 เปิดเคส</Link>
                    {' '}
                    <Link className="btn btn-sm btn-light" href={`/prescriptions/new?customer=${r.id}`}>👁</Link>
                  </>
                ),
              },
            ]}
            rows={rows}
            onRowClick={(r) => router.push('/customers/detail?id=' + r.id)}
            empty="ไม่พบลูกค้า"
          />
        </Card>
      )}
    </div>
  );
}

export default function CustomerListPage() {
  return (
    <QueryParamPage>
      <CustomerListInner />
    </QueryParamPage>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend-next/app/customers/page.jsx
git commit -m "Port CustomerList to frontend-next"
```

---

### Task 4: Port CustomerDetail (`/customers/detail?id=`)

**Files:**
- Create: `frontend-next/app/customers/detail/page.jsx` (port of `frontend/src/pages/customers/CustomerDetail.jsx`)

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js`, `components/Toast.jsx`, `components/Confirm.jsx`, `components/ui.jsx`, `components/DataTable.jsx`, `components/StatusChip.jsx`, `components/QueryParamPage.jsx`, `lib/format.js`.

- [ ] **Step 1: Write `frontend-next/app/customers/detail/page.jsx`**

Port of `frontend/src/pages/customers/CustomerDetail.jsx`: `useParams()` → `useSearchParams().get('id')`; router/import swaps; wrapped in `QueryParamPage`. Link-target changes: edit link → `/customers/edit?id=`, case row click → `/cases/detail?id=`, prescription edit link → `/prescriptions/edit?id=`, prescription print link → `/print/prescription?id=`, order row click → `/orders/detail?id=`. The "เปิดเคส"/"วัดสายตา"/"เปิดออเดอร์" action buttons stay as static routes with `?customer=` (unchanged).

```jsx
'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../lib/apiClient.js';
import { useAsync } from '../../../lib/hooks.js';
import { useToast } from '../../../components/Toast.jsx';
import { useConfirm } from '../../../components/Confirm.jsx';
import {
  Badge, Card, FormActions, Kv, Loading, OrderStatusBadge, PageHead, Split,
} from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { StatusChip } from '../../../components/StatusChip.jsx';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { custName, fmtDate, fmtDateTime, money, power, rxNum } from '../../../lib/format.js';

function CustomerDetailInner() {
  const params = useSearchParams();
  const id = params.get('id');
  const router = useRouter();
  const { ok, err } = useToast();
  const confirm = useConfirm();

  const { data: c, loading, error } = useAsync(() => api.get('/api/customers/' + id), [id]);

  if (loading) return <Loading />;
  if (error) return <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>;

  const remove = async () => {
    if (!await confirm('ลบลูกค้า', `ลบ "${custName(c)}" ออกจากระบบ?`, { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del('/api/customers/' + c.id);
      ok('ลบแล้ว');
      router.push('/customers');
    } catch (ex) {
      err(ex);
    }
  };

  return (
    <div>
      <PageHead
        icon="👤"
        title={custName(c)}
        subtitle={`รหัสลูกค้า #${c.id}`}
        actions={(
          <>
            <Link className="btn btn-ghost" href={`/cases/new?customer=${c.id}`}>🗂 เปิดเคส</Link>
            <Link className="btn btn-ghost" href={`/prescriptions/new?customer=${c.id}`}>👁 วัดสายตา</Link>
            <Link className="btn btn-ghost" href={`/orders/new?customer=${c.id}`}>👓 เปิดออเดอร์</Link>
            <Link className="btn btn-ghost" href={`/customers/edit?id=${c.id}`}>✎ แก้ไข</Link>
          </>
        )}
      />

      <Split>
        <Card title="ข้อมูลลูกค้า">
          <Kv rows={[
            ['ชื่อ-นามสกุล', custName(c)],
            ['เพศ', c.sex || '-'],
            ['สัญชาติ', c.nationality || '-'],
            ['วันเกิด', fmtDate(c.birth_date) || '-'],
            ['เบอร์โทร', c.phone || '-'],
            ['LINE', c.line_id || '-'],
            ['อีเมล', c.email || '-'],
            ['หมายเหตุ', c.notes || '-'],
            ['ลูกค้าตั้งแต่', fmtDate(c.created_at)],
          ]}
          />
          <FormActions style={{ marginTop: 14 }}>
            <button type="button" className="btn btn-sm btn-danger" onClick={remove}>🗑 ลบลูกค้า</button>
          </FormActions>
        </Card>

        <Card title="เคสของลูกค้า" tight>
          <DataTable
            columns={[
              { label: 'เคส', key: 'case_code', cls: 'mono' },
              { label: 'สถานะ', render: (k) => <StatusChip row={k} /> },
              { label: 'เปิดเมื่อ', render: (k) => fmtDate(k.opened_at), cls: 'nowrap' },
              { label: 'ยอด', render: (k) => (k.net_price === null ? '-' : money(k.net_price)), cls: 'num' },
              { label: 'ค้าง', render: (k) => (k.balance === null ? '-' : money(k.balance)), cls: 'num' },
            ]}
            rows={c.cases}
            onRowClick={(k) => router.push('/cases/detail?id=' + k.id)}
            empty="ยังไม่มีเคส"
          />
        </Card>
      </Split>

      <Card title="ประวัติค่าสายตา" tight>
        <DataTable
          columns={[
            { label: 'วันที่', render: (t) => fmtDateTime(t.test_date), cls: 'nowrap' },
            { label: 'ชนิด', render: (t) => <Badge kind={t.kind === 'final' ? 'ok' : 'gray'}>{t.kind}</Badge> },
            {
              label: 'R (Sph/Cyl/Axis/Add)',
              cls: 'nowrap',
              render: (t) => `${power(t.r_sphere)} / ${power(t.r_cylinder)} / ${rxNum(t.r_axis)} / ${power(t.r_add)}`,
            },
            {
              label: 'L (Sph/Cyl/Axis/Add)',
              cls: 'nowrap',
              render: (t) => `${power(t.l_sphere)} / ${power(t.l_cylinder)} / ${rxNum(t.l_axis)} / ${power(t.l_add)}`,
            },
            { label: 'ใช้สำหรับ', key: 'test_for' },
            { label: 'ผู้วัด', key: 'employee_name' },
            {
              label: '',
              cls: 'nowrap',
              render: (t) => (
                <>
                  <Link className="btn btn-sm btn-light" href={'/prescriptions/edit?id=' + t.id}>✎</Link>{' '}
                  <Link className="btn btn-sm btn-light" href={'/print/prescription?id=' + t.id}>🖨</Link>
                </>
              ),
            },
          ]}
          rows={c.prescriptions}
          empty="ยังไม่มีประวัติการวัดสายตา"
        />
      </Card>

      <Card title="ประวัติการสั่งตัดแว่น" tight>
        <DataTable
          columns={[
            { label: 'วันที่', render: (o) => fmtDateTime(o.order_date), cls: 'nowrap' },
            { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
            { label: 'เลนส์', key: 'lens_name' },
            { label: 'กรอบ', key: 'frame_name' },
            { label: 'ยอดรวม', render: (o) => money(o.total_price), cls: 'num' },
            { label: 'รับแล้ว', render: (o) => money(o.paid), cls: 'num' },
            { label: 'คงเหลือ', render: (o) => money(o.balance), cls: 'num' },
            { label: 'สถานะ', render: (o) => <OrderStatusBadge order={o} /> },
          ]}
          rows={c.orders}
          onRowClick={(o) => router.push('/orders/detail?id=' + o.id)}
          empty="ยังไม่มีออเดอร์"
        />
      </Card>
    </div>
  );
}

export default function CustomerDetailPage() {
  return (
    <QueryParamPage>
      <CustomerDetailInner />
    </QueryParamPage>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend-next/app/customers/detail/page.jsx
git commit -m "Port CustomerDetail to frontend-next"
```

---

### Task 5: Breadcrumbs, build, browser-load check (including a failure path), and verify against the real API

**Files:**
- Modify: `frontend-next/lib/crumb.js` (check `/customers/detail`, `/customers/edit`, `/customers/new`, `/customers` are present — they should already be, from Foundation/cases/bookings — add only what's genuinely missing)

**Interfaces:** none new.

- [ ] **Step 1: Check `frontend-next/lib/crumb.js`'s `TITLES` array**

Read it. `/customers/new`, `/customers/detail`, `/customers/edit`, `/customers` should already all be present (added across Foundation and the cases-domain plan). If genuinely nothing is missing, say so plainly and skip to Step 2 without a commit for this step — don't force a change.

- [ ] **Step 2: Run the full test suite**

```bash
cd frontend-next
npm test
```
Expected: all existing tests still pass (no new tests in this domain — no new `lib/` logic was added).

- [ ] **Step 3: Build, then serve and load the static export in a browser — including a failure path this time**

```bash
npm run build
```
Expected: succeeds, producing `out/customers/index.html`, `out/customers/new/index.html`, `out/customers/edit/index.html`, `out/customers/detail/index.html`.

Serve `out/` locally and load, in headless Chrome via the DevTools Protocol, watching the console for errors:
- `/customers/` (happy path)
- `/customers/new/` (happy path)
- `/customers/edit/` **with a bogus, nonexistent id** (e.g. `?id=999999999`) — per the bookings-domain plan's final review, this is the failure-path check that a prior domain's plan skipped, which let a real crash bug through. Confirm it shows a clean in-shell error (not a blank "Application error" page) — `app/error.jsx` (already built) plus this plan's Task 1 loader guard should both prevent that, but confirm it directly rather than assuming.
- `/customers/detail/` **with a bogus, nonexistent id** — same check.

If anything shows an uncaught error or a blank crash page, fix the root cause before proceeding.

- [ ] **Step 4: Manually verify against the real PHP API + MariaDB, compared with the still-running Vite app**

XAMPP MySQL running, PHP API running, Next dev server running, Vite app running for comparison.

- Compare `/customers` (Next) vs `/#/customers` (Vite) — same search results for a few different search terms.
- Compare `/customers/new` vs `/#/customers/new` — create a real test customer (name clearly marked, e.g. "TEST-customers-task5"), confirm it succeeds on both and produces the same shape of response.
- Compare `/customers/edit?id=<the test customer's id>` vs `/#/customers/<id>/edit` — same pre-filled fields; edit one field and save, confirm it round-trips.
- Compare `/customers/detail?id=<the test customer's id>` vs `/#/customers/<id>` — same header, same (empty, for a fresh test customer) cases/prescriptions/orders tables.
- **Delete the test customer** you created — via the "ลบลูกค้า" button, verified by exact-content match, not left in the live database.
- Stop all servers when done.

- [ ] **Step 5: Commit** (only if Step 1 found something to add to `crumb.js`; otherwise no commit for this task)

```bash
git add frontend-next/lib/crumb.js
git commit -m "Verify customers domain against real API"
```

(Adjust the commit to include `crumb.js` only if it actually changed — if nothing changed, there is nothing to commit for this task, which is fine.)

---

### Task 6: Verify in-browser at all three required breakpoints

**Files:** none (verification only; fix in `frontend-next/app/globals.css` only if something real is found).

- [ ] **Step 1: Start both servers.**

- [ ] **Step 2: Launch Chrome headless with remote debugging**, same method as every prior plan.

- [ ] **Step 3: Screenshot and inspect `/customers` (a wide `DataTable` with 8 columns plus action buttons — check for horizontal scroll containment, this project's tables already handle this via `.table-wrap{overflow-x:auto}` per prior domains' findings, but confirm rather than assume) and `/customers/detail?id=<n>` (a `Split` two-column layout plus three full-width `DataTable` history sections) at all three required sizes: 1920×1080, 810×1080, 1080×810.**

Check specifically: no horizontal scroll on the page body itself at any size (the tables may scroll internally, that's fine and expected — the page body must not); at 810×1080 with the sidebar drawer opened, confirm the drawer's 3 close mechanisms still work (regression check); the `Split` layout on the detail page doesn't clip content at narrow widths.

- [ ] **Step 4: If anything real is found, fix it in `frontend-next/app/globals.css` only, re-screenshot until it passes. If nothing needs fixing, say so plainly.**

- [ ] **Step 5: Kill headless Chrome and both dev servers.**

- [ ] **Step 6: Commit any fix** (message: `Fix responsive layout issues found verifying the customers domain`). Skip if nothing needed fixing.

---

## Self-Review Notes

- **Spec coverage:** every page in `frontend/src/pages/customers/` has a corresponding task. The `editing`-prop + error/loader-guard pattern from the bookings-domain plan's final-review fix is applied proactively in Task 1, not retrofitted. The browser-console check explicitly includes failure-path URLs this time (Task 5), directly closing the gap the bookings-domain final review identified.
- **Placeholder scan:** no TBDs; every step has runnable code or an exact command.
- **Type/name consistency:** `CustomerFormView` takes exactly `{ editing }`; both Task 2 page files pass it explicitly. All link targets to not-yet-ported domains (`/orders/detail?id=`) follow the established query-string-id convention.
- **Scope:** this plan covers only the `customers` domain. No new shared components or `lib/` modules were needed — a signal that the shared foundation built across the first three plans is now covering new domains with near-zero marginal shared-code cost.

## After This Plan

Next domain plan: **prescriptions** (list, form — also dual-mode new/edit, following the now-three-times-proven `editing`-prop template) — `RxPanel` (cases domain), `CustomerDetail`, and `CustomerFormView`'s "วัดสายตา" button all already link to `/prescriptions/new?customer=`, and `CustomerDetail`/`RxPanel` both link to `/prescriptions/edit?id=` and `/print/prescription?id=`, so porting it next resolves the largest number of currently pre-written links.
