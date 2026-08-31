# Next.js Prescriptions Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the `prescriptions` domain (search/list, create/edit form) from `frontend/` (Vite) to `frontend-next/` (Next.js), against the same PHP API + MariaDB, applying the `editing`-prop shared-view template proven by bookings/cases/customers, plus a guard this plan bakes in from the start that customers-domain's final review had to retrofit after the fact: any loaded record dereferenced for a write action (save/cancel/print URL) must be checked for null/idless data before render, and outgoing write URLs must prefer the query-string `id` over an id read back out of the response body.

**Architecture:** Same client-fetch, no-SSR pattern as every prior plan. This domain needs **no new shared components** — `Picker`, `Select`, `EmployeeSelect`, `ListSelect`, `Card`, `Field`, `Fieldset`, `Check`, `FormGrid`, `FormActions`, `Row`, `Split`, `Loading`, `PageHead` all already exist from Foundation/cases/customers. The Vite `PrescriptionForm.jsx` is dual-mode (`/prescriptions/new` and `/prescriptions/:id` off one component deriving `editing` from `!!useParams().id`) — this plan follows the customers-domain template exactly: one shared `PrescriptionFormView` component taking `editing` as an explicit prop, rendered by two thin page files, using `?id=` instead of a path param.

**Tech Stack:** Same as prior plans — Next.js 15 (App Router, static export), React 19.2.8, `frontend-next/lib/apiClient.js`, shared UI components, `components/QueryParamPage.jsx`.

**Spec:** `docs/superpowers/specs/2026-08-25-nextjs-frontend-only-migration-design.md`

**Depends on:** Foundation, cases-domain, bookings-domain, and customers-domain plans (all complete). `app/error.jsx` (global error boundary) already exists and protects this domain's pages too. `app/cases/detail/panels/RxPanel.jsx` and `app/customers/detail/page.jsx` already link to `/prescriptions/edit?id=` and `/prescriptions/new?customer=&case=` — this plan makes those links resolve for the first time.

## Global Constraints

- `frontend/` (Vite) and `api/` (PHP) are not touched by this plan.
- **This plan does not touch, query, or reason about the `stock` table or anything downstream of it** (the `stock`/`sales`/`orders`-fill/`reports` domains are known to be broken against the live database right now, per a separate assessment — completely out of scope here; `prescriptions.php` has zero dependency on `stock` and was independently verified clean).
- No SSR — every page a Client Component.
- Any component calling `useSearchParams()` must be wrapped in `QueryParamPage`, and that hook must only be called inside the wrapped child, never a `page.jsx` default export directly.
- `editing` in the prescription-form flow is an explicit prop — never derived from `searchParams.get('id') != null`.
- **Any shared view component that uses `useAsync` and later dereferences its `data` must destructure and guard `error` before doing so, and must guard `editing && !id` inside the loader itself (not just at render) before this component's first commit.** `useAsync`'s effect fires on every render regardless of any earlier `return`, so a render-only guard does not prevent a doomed request; the loader itself must short-circuit.
- **New this plan (learned from customers-domain's final review):** after the `loading`/`error`/`editing && !id` guards, also guard against a loaded-but-idless/null record before rendering write actions — `if (editing && (!data || !data.t || !data.t.id)) return <not-found card>;` — and build every outgoing write URL (`PUT`, and any Cancel/Print link that embeds the record's own id) from the query-string `id`, never from a field read back out of the loaded response body. A crash-free page that still arms a delete/save button against a nonexistent record is not an acceptable outcome.
- Record-edit routes use `?id=` — `/prescriptions/edit?id=`. There is no separate `/prescriptions/detail` route; Vite has none either (a prescription's own detail view IS its edit form).
- UI must work at 1920×1080, 810×1080 (iPad portrait), 1080×810 (iPad landscape) — verified with real Chrome headless DevTools Protocol screenshots.
- `npm run build` must pass AND the resulting `frontend-next/out/` must be served and loaded in a real browser with the console checked — **including both an edit URL with a bogus/nonexistent id (`?id=999999999`) AND an edit URL with NO id at all (bare `/prescriptions/edit`)**. Testing only the wrong-id case is not sufficient — a prior domain plan's final review found the bare-no-id path is precisely what the loader-level `editing && !id` guard exists to protect, and it must be exercised directly, not inferred from source reading.

---

## File Structure

```
frontend-next/
├── app/
│   ├── prescriptions/
│   │   ├── page.jsx                  PrescriptionList
│   │   ├── PrescriptionFormView.jsx  shared inner component (NOT a route)
│   │   ├── new/
│   │   │   └── page.jsx              renders <PrescriptionFormView editing={false} />
│   │   └── edit/
│   │       └── page.jsx              renders <PrescriptionFormView editing />
```

No new files under `components/` or `lib/` — this domain reuses everything Foundation/cases/customers already built.

**Interfaces later domain plans will rely on:** none new. `RxPanel.jsx` (cases domain) and `CustomerDetail.jsx` (customers domain) already link to `/prescriptions/edit?id=` and `/prescriptions/new?customer=&case=` in the exact shapes this plan produces — no changes needed on their side.

---

### Task 1: `PrescriptionFormView` shared component (prescription create/edit)

**Files:**
- Create: `frontend-next/app/prescriptions/PrescriptionFormView.jsx` (port of `frontend/src/pages/prescriptions/PrescriptionForm.jsx`, restructured with an explicit `editing` prop, PLUS the not-found/write-URL guard this plan's Global Constraints require from the start)

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js` (`useAsync, onSubmit`), `components/Toast.jsx`, `components/ui.jsx` (`Card, Check, Field, Fieldset, FormActions, FormGrid, Loading, PageHead, Row, Split`), `components/Picker.jsx`, `components/Selects.jsx` (`EmployeeSelect, ListSelect, Select`), `lib/format.js` (`custName, dtLocal, nowLocal, toStamp`).
- Produces: `PrescriptionFormView({ editing })` — not a page (no `page.jsx` filename). Calls `useSearchParams()` internally (for `id` when editing, `customer`/`case` when creating) — every caller MUST render it inside `QueryParamPage`; Task 2 does this.

- [ ] **Step 1: Write `frontend-next/app/prescriptions/PrescriptionFormView.jsx`**

```jsx
'use client';
/**
 * Shared prescription create/edit form. Port of frontend/src/pages/prescriptions/PrescriptionForm.jsx,
 * restructured the same way app/customers/CustomerFormView.jsx was: `editing` is an explicit prop,
 * not derived from a route param, and outgoing write URLs use the query-string `id` rather than an
 * id read back out of the loaded response body (see this plan's Global Constraints).
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync, onSubmit } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import {
  Card, Check, Field, Fieldset, FormActions, FormGrid, Loading, PageHead, Row, Split,
} from '../../components/ui.jsx';
import { Picker } from '../../components/Picker.jsx';
import { EmployeeSelect, ListSelect, Select } from '../../components/Selects.jsx';
import { custName, dtLocal, nowLocal, toStamp } from '../../lib/format.js';

const HEALTH = [
  ['health_cataract', 'ต้อกระจก'], ['health_eye_surgery', 'เคยผ่าตัดตา'],
  ['health_diabetes', 'เบาหวาน'], ['health_bp', 'ความดัน'], ['health_heart', 'โรคหัวใจ'],
];

/** one eye's eight measurement boxes */
function EyeSide({ side, t }) {
  const k = side === 'R' ? 'r' : 'l';
  const v = (f) => t[`${k}_${f}`] ?? '';
  const box = (f, label, placeholder) => (
    <Field label={label}>
      <input name={`${k}_${f}`} defaultValue={v(f)} placeholder={placeholder} />
    </Field>
  );
  return (
    <Fieldset legend={side === 'R' ? 'ตาขวา — Right (R)' : 'ตาซ้าย — Left (L)'}>
      <FormGrid>
        {box('sphere', 'Sphere', '-1.25')}
        {box('cylinder', 'Cylinder', '-0.50')}
        {box('axis', 'Axis', '90')}
        {box('add', 'Add', '+2.00')}
        {box('pd', 'PD', '32')}
        {box('va', 'VA', '1.0')}
        {box('prism', 'Prism')}
        {box('base', 'Base')}
      </FormGrid>
    </Fieldset>
  );
}

// editing must always be passed explicitly by the caller (true or false) — if a future
// page forgets it, editing becomes undefined (falsy), silently serving a *create* form
// on what was meant to be an *edit* route.
export function PrescriptionFormView({ editing }) {
  const router = useRouter();
  const params = useSearchParams();
  const { ok, err } = useToast();
  const [picked, setPicked] = useState(null);

  const id = editing ? params.get('id') : null;
  const queryCustomer = params.get('customer');
  const queryCase = params.get('case');

  const { data, loading, error } = useAsync(() => {
    if (editing && !id) return Promise.resolve(null);
    return (async () => {
      const t = editing ? await api.get('/api/prescriptions/' + id) : {};
      const cid = editing ? t.customer_id : (queryCustomer ? Number(queryCustomer) : null);
      const customer = cid ? await api.get('/api/customers/' + cid) : null;
      return { t, customer };
    })();
  }, [editing, id, queryCustomer]);

  if (loading) return <Loading />;
  if (error) return <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>;
  if (editing && !id) {
    return <Card><h2>ไม่พบรหัสการวัดสายตา</h2><p className="muted">ไม่มี id ของรายการที่จะแก้ไข</p></Card>;
  }
  if (editing && (!data || !data.t || !data.t.id)) {
    return <Card><h2>ไม่พบข้อมูลการวัดสายตา</h2><p className="muted">ไม่พบรายการนี้ในระบบ</p></Card>;
  }

  const t = editing ? data.t : {};
  const customer = picked ?? (data && data.customer);
  const caseId = editing ? t.case_id : (queryCase ? Number(queryCase) : null);

  const save = async (body) => {
    if (!customer) return err('กรุณาเลือกลูกค้าก่อน');
    body.customer_id = customer.id;
    body.case_id = caseId;
    body.test_date = toStamp(body.test_date);
    try {
      if (editing) await api.put('/api/prescriptions/' + id, body);
      else await api.post('/api/prescriptions', body);
      ok('บันทึกผลวัดสายตาเรียบร้อย');
      router.push(caseId ? '/cases/detail?id=' + caseId : '/customers/detail?id=' + customer.id);
    } catch (ex) {
      err(ex);
    }
  };

  return (
    <>
      <PageHead
        icon="👁"
        title="Prescription"
        subtitle="บันทึกการวัดสายตา"
        actions={caseId ? <Link className="btn btn-ghost" href={'/cases/detail?id=' + caseId}>← กลับไปที่เคส</Link> : null}
      />

      <Split>
        <Card title="ลูกค้า">
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

      <Card>
        <form onSubmit={onSubmit(save)}>
          <FormGrid two>
            <Field label="ชนิดค่าสายตา">
              <Select
                name="kind"
                options={[['old', 'ค่าเดิม (แว่นเก่า)'], ['measured', 'ค่าที่วัดได้'], ['final', 'ค่าที่ใช้จริง']]}
                defaultValue={t.kind || 'measured'}
              />
            </Field>
            <Field label="พนักงานผู้วัด">
              <EmployeeSelect name="performed_by" defaultValue={t.performed_by || ''} />
            </Field>
            <Field label="วันที่วัด">
              <input name="test_date" type="datetime-local" defaultValue={dtLocal(t.test_date) || nowLocal()} />
            </Field>
            <Field label="ใช้สำหรับ / TestFor">
              <ListSelect name="test_for" kind="test_for" defaultValue={t.test_for || ''} blank="—" />
            </Field>
          </FormGrid>

          <div className="split" style={{ marginTop: 14 }}>
            <EyeSide side="R" t={t} />
            <EyeSide side="L" t={t} />
          </div>

          <Fieldset legend="ข้อมูลเพิ่มเติม">
            <FormGrid>
              <Field label="PD รวม"><input name="pd_total" defaultValue={t.pd_total || ''} /></Field>
              <Field label="แว่นเดิมเป็นแบบ"><input name="old_glasses_type" defaultValue={t.old_glasses_type || ''} /></Field>
              <Field label="ระยะแนวตั้ง R"><input name="dist_vertical_r" defaultValue={t.dist_vertical_r || ''} /></Field>
              <Field label="ระยะแนวตั้ง L"><input name="dist_vertical_l" defaultValue={t.dist_vertical_l || ''} /></Field>
              <Field label="ระยะจอ R"><input name="dist_monitor_r" defaultValue={t.dist_monitor_r || ''} /></Field>
              <Field label="ระยะจอ L"><input name="dist_monitor_l" defaultValue={t.dist_monitor_l || ''} /></Field>
              <Field label="รู้จักร้านจาก">
                <ListSelect name="known_from" kind="marketing" defaultValue={t.known_from || ''} blank="—" />
              </Field>
            </FormGrid>
          </Fieldset>

          <Fieldset legend="ประวัติสุขภาพ">
            <Row style={{ gap: 16 }}>
              {HEALTH.map(([k, label]) => (
                <Check key={k} name={k} defaultChecked={!!Number(t[k])}>{label}</Check>
              ))}
            </Row>
            <Field label="รายละเอียดสุขภาพ" className="full">
              <input name="health_note" defaultValue={t.health_note || ''} />
            </Field>
          </Fieldset>

          <FormGrid two>
            <Field label="บันทึกการตรวจ / Exam note">
              <textarea name="exam_note" defaultValue={t.exam_note || ''} />
            </Field>
            <Field label="หมายเหตุ / Notes">
              <textarea name="notes" defaultValue={t.notes || ''} />
            </Field>
          </FormGrid>

          <FormActions style={{ marginTop: 14 }}>
            <button className="btn btn-lg" type="submit">
              {editing ? '💾 บันทึกการแก้ไข' : '✔ บันทึกผลวัดสายตา'}
            </button>
            {editing && <Link className="btn btn-light" href={'/print/prescription?id=' + id}>🖨 พิมพ์</Link>}
            <Link className="btn btn-light" href={caseId ? '/cases/detail?id=' + caseId : '/prescriptions'}>ยกเลิก</Link>
          </FormActions>
        </form>
      </Card>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend-next/app/prescriptions/PrescriptionFormView.jsx
git commit -m "Add shared PrescriptionFormView component with explicit editing prop and not-found guards"
```

---

### Task 2: Wire the two prescription-form pages (`/prescriptions/new`, `/prescriptions/edit`)

**Files:**
- Create: `frontend-next/app/prescriptions/new/page.jsx`
- Create: `frontend-next/app/prescriptions/edit/page.jsx`

**Interfaces:**
- Consumes: `components/QueryParamPage.jsx`, `app/prescriptions/PrescriptionFormView.jsx` (Task 1).

- [ ] **Step 1: Write `frontend-next/app/prescriptions/new/page.jsx`**

```jsx
'use client';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { PrescriptionFormView } from '../PrescriptionFormView.jsx';

export default function NewPrescriptionPage() {
  return (
    <QueryParamPage>
      <PrescriptionFormView editing={false} />
    </QueryParamPage>
  );
}
```

- [ ] **Step 2: Write `frontend-next/app/prescriptions/edit/page.jsx`**

```jsx
'use client';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { PrescriptionFormView } from '../PrescriptionFormView.jsx';

export default function EditPrescriptionPage() {
  return (
    <QueryParamPage>
      <PrescriptionFormView editing />
    </QueryParamPage>
  );
}
```

- [ ] **Step 3: Verify the build compiles**

Run (from `frontend-next/`): `npm run build`. Expected: succeeds, producing `out/prescriptions/new/index.html`, `out/prescriptions/edit/index.html`.

- [ ] **Step 4: Commit**

```bash
git add frontend-next/app/prescriptions/new/page.jsx frontend-next/app/prescriptions/edit/page.jsx
git commit -m "Wire /prescriptions/new and /prescriptions/edit pages"
```

---

### Task 3: Port PrescriptionList (`/prescriptions`)

**Files:**
- Create: `frontend-next/app/prescriptions/page.jsx` (port of `frontend/src/pages/prescriptions/PrescriptionList.jsx`)

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js` (`useAsync, useDebounced`), `components/ui.jsx` (`Badge, Card, Field, Loading, PageHead, Toolbar`), `components/DataTable.jsx`, `components/QueryParamPage.jsx`, `lib/format.js` (`custName, fmtDateTime, power, rxNum`).

- [ ] **Step 1: Write `frontend-next/app/prescriptions/page.jsx`**

Port of `frontend/src/pages/prescriptions/PrescriptionList.jsx`: router/import swaps as in every prior plan; wrapped in `QueryParamPage` (this page reads no query params itself today, but the wrapper is kept for consistency with every other list page and to leave room for a future `?q=` restore without a later structural change). Link-target changes: row click → `/prescriptions/edit?id=`, print button → `/print/prescription?id=` (that target page doesn't exist yet — it belongs to the not-yet-ported `reports` domain — this is an accepted, plan-acknowledged gap, the same shape as `/orders/detail` links already present in the cases/customers domains).

```jsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync, useDebounced } from '../../lib/hooks.js';
import { Badge, Card, Field, Loading, PageHead, Toolbar } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { QueryParamPage } from '../../components/QueryParamPage.jsx';
import { custName, fmtDateTime, power, rxNum } from '../../lib/format.js';

function PrescriptionListInner() {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const q = useDebounced(term);

  const { data: rows, loading, error } = useAsync(
    () => api.get('/api/prescriptions', { q: q.trim(), limit: 300 }),
    [q]
  );

  return (
    <div>
      <PageHead
        icon="👁"
        title="Prescriptions"
        subtitle="ประวัติการวัดสายตา"
        actions={<Link className="btn btn-ghost" href="/prescriptions/new">+ วัดสายตาใหม่</Link>}
      />

      <Toolbar>
        <Field label="ค้นหา" className="grow">
          <input
            type="search"
            placeholder="ค้นหาด้วย ชื่อลูกค้า / เบอร์โทร / รหัส"
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
              { label: 'วันที่วัด', render: (t) => fmtDateTime(t.test_date), cls: 'nowrap' },
              { label: 'ชนิด', render: (t) => <Badge kind={t.kind === 'final' ? 'ok' : 'gray'}>{t.kind}</Badge> },
              { label: 'ลูกค้า', render: custName },
              { label: 'เบอร์โทร', key: 'phone', cls: 'nowrap' },
              { label: 'R Sph', render: (t) => power(t.r_sphere), cls: 'num' },
              { label: 'R Cyl', render: (t) => power(t.r_cylinder), cls: 'num' },
              { label: 'R Axis', render: (t) => rxNum(t.r_axis), cls: 'num' },
              { label: 'L Sph', render: (t) => power(t.l_sphere), cls: 'num' },
              { label: 'L Cyl', render: (t) => power(t.l_cylinder), cls: 'num' },
              { label: 'L Axis', render: (t) => rxNum(t.l_axis), cls: 'num' },
              { label: 'ใช้สำหรับ', key: 'test_for' },
              { label: 'ผู้วัด', key: 'employee_name' },
              {
                label: '',
                cls: 'nowrap',
                render: (t) => <Link className="btn btn-sm btn-light" href={'/print/prescription?id=' + t.id}>🖨</Link>,
              },
            ]}
            rows={rows}
            onRowClick={(t) => router.push('/prescriptions/edit?id=' + t.id)}
            empty="ไม่พบข้อมูล"
          />
        </Card>
      )}
    </div>
  );
}

export default function PrescriptionListPage() {
  return (
    <QueryParamPage>
      <PrescriptionListInner />
    </QueryParamPage>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend-next/app/prescriptions/page.jsx
git commit -m "Port PrescriptionList to frontend-next"
```

---

### Task 4: Breadcrumbs, build, browser-load check (both failure paths), and verify against the real API

**Files:**
- Modify: `frontend-next/lib/crumb.js` (add `/prescriptions/edit` — confirmed missing; `/prescriptions/new` and `/prescriptions` already present)

**Interfaces:** none new.

- [ ] **Step 1: Add the missing `crumb.js` entry**

`frontend-next/lib/crumb.js`'s `TITLES` array already has `['/prescriptions/new', 'บันทึกการวัดสายตา']` and `['/prescriptions', 'วัดสายตา']`, but is missing an `/prescriptions/edit` entry (confirmed by reading the file directly — unlike the customers-domain plan, this one genuinely needs a change here). Add, alongside the existing `/prescriptions/new` line:

```js
  ['/prescriptions/edit', 'แก้ไขผลวัดสายตา'],
```

- [ ] **Step 2: Run the full test suite**

```bash
cd frontend-next
npm test
```
Expected: all existing tests still pass (no new tests in this domain — no new `lib/` logic was added).

- [ ] **Step 3: Build, then serve and load the static export in a browser — both failure paths**

```bash
npm run build
```
Expected: succeeds, producing `out/prescriptions/index.html`, `out/prescriptions/new/index.html`, `out/prescriptions/edit/index.html`.

Serve `out/` locally and load, in headless Chrome via the DevTools Protocol, watching the console for errors:
- `/prescriptions/` (happy path)
- `/prescriptions/new/` (happy path)
- `/prescriptions/edit/` **with a bogus, nonexistent id** (e.g. `?id=999999999`) — confirm a clean in-shell error card, not a blank "Application error" page.
- `/prescriptions/edit/` **with NO id at all** (bare, no query string) — confirm the `ไม่พบรหัสการวัดสายตา` card renders cleanly and that **no** `GET /api/prescriptions/...` network request fires (the loader-level `editing && !id` guard must short-circuit before any request, not merely render a nice error after one). This exact check — the bare-no-id path, not just the wrong-id path — is what a prior domain plan's final review found missing from its own verification; do not skip it here.

If anything shows an uncaught error, a blank crash page, or a stray network request on the bare-no-id load, fix the root cause before proceeding.

- [ ] **Step 4: Manually verify against the real PHP API + MariaDB, compared with the still-running Vite app**

XAMPP MySQL running, PHP API running, Next dev server running, Vite app running for comparison.

- Compare `/prescriptions` (Next) vs `/#/prescriptions` (Vite) — same search results for a few different search terms.
- Compare `/prescriptions/new` vs `/#/prescriptions/new` — pick an existing real customer via the Picker (do not create a new one; this domain has no delete endpoint to clean up with, so avoid writing throwaway prescription records against a real customer's history if avoidable — if a write is unavoidable to prove the round trip, use a customer already carrying obvious test/demo data and note exactly what was written in the report), fill in a couple of RX fields, save, confirm it succeeds on both and redirects to that customer's detail page.
- Compare `/prescriptions/edit?id=<a real existing prescription id>` vs `/#/prescriptions/<id>` — same pre-filled fields on both.
- Confirm the `case` query-param flow at least once by source-level reasoning plus one live check: load `/prescriptions/new?customer=<id>&case=<id>` for a real case, confirm the "← กลับไปที่เคส" link appears and points at `/cases/detail?id=<that case id>`, and that saving redirects to the case detail page rather than the customer detail page (do not necessarily submit this one if it would write into a real case's history — reasoning from the rendered "กลับไปที่เคส" link plus the `caseId` construction in the code is acceptable if a live write here isn't clean to arrange; state clearly in the report which was done).

- [ ] **Step 5: Commit**

```bash
git add frontend-next/lib/crumb.js
git commit -m "Add missing /prescriptions/edit breadcrumb entry; verify prescriptions domain against real API"
```

---

### Task 5: Verify in-browser at all three required breakpoints

**Files:** none (verification only; fix in `frontend-next/app/globals.css` only if something real is found).

- [ ] **Step 1: Start both servers, launch Chrome headless with remote debugging** (same method as every prior plan).

- [ ] **Step 2: Screenshot and inspect `/prescriptions` (a wide `DataTable` with 13 columns plus a print-button column — check horizontal scroll containment via `.table-wrap{overflow-x:auto}`) and `/prescriptions/new` (a `Split` two-column picker layout, then a form with a two-column `EyeSide` pair side by side) at all three required sizes: 1920×1080, 810×1080, 1080×810.**

Check specifically: no horizontal scroll on the page body itself at any size; at 810×1080, the two `EyeSide` fieldsets (R and L) — rendered via a raw `<div className="split">` around them, same CSS class as the shared `Split` component — collapse to one column exactly like every other `.split` usage in this codebase (confirm rather than assume, since this is the first place two `Fieldset`s are placed inside a `.split` rather than two `Card`s); the sidebar drawer's 3 close mechanisms still work (regression check).

- [ ] **Step 3: If anything real is found, fix it in `frontend-next/app/globals.css` only, re-screenshot until it passes. If nothing needs fixing, say so plainly.**

- [ ] **Step 4: Kill headless Chrome and both dev servers.**

- [ ] **Step 5: Commit any fix** (message: `Fix responsive layout issues found verifying the prescriptions domain`). Skip if nothing needed fixing.

---

## Self-Review Notes

- **Spec coverage:** every page in `frontend/src/pages/prescriptions/` has a corresponding task (`PrescriptionList` → Task 3, `PrescriptionForm` → Tasks 1-2). The `editing`-prop template is applied, plus the not-found/write-URL guard proactively from Task 1, not retrofitted.
- **Placeholder scan:** no TBDs; every step has runnable code or an exact command. Task 4's Step 4 write-verification step is deliberately hedged (avoid junk data in a real customer's prescription history / a real case's event log) rather than mandating a blind write, matching this plan's Global Constraint of staying well clear of anything DB-risk-adjacent — a live read-only comparison plus one careful, clearly-logged write is sufficient evidence here, same bar the customers-domain plan itself used for creating (and, there, deleting) a marked test record.
- **Type/name consistency:** `PrescriptionFormView` takes exactly `{ editing }`; both Task 2 page files pass it explicitly. `caseId`/`customer`/`id` naming matches the Vite original and the customers-domain precedent (`c.id` vs `id` distinction) throughout.
- **Scope:** this plan covers only the `prescriptions` domain (list + dual-mode form). No new shared components or `lib/` modules were needed. `/print/prescription?id=` stays a known, accepted 404 until the `reports` domain lands — not this plan's concern, consistent with how `/orders/detail?id=` was left un-ported by the customers-domain plan.

## After This Plan

The domains that still depend on the live database's now-removed `stock` table (`orders` fill/close, `stock`, `sales`, and the stock-touching parts of `reports`) are explicitly out of scope until the backend catches up — see the separate legacy-app assessment for why. Domains with no such dependency remain to port: **finance** (`Ledger.jsx`, reused for both `/income` and `/expense` via a query/prop-driven `endpoint`), **locations** (`LocationList.jsx`), and **suppliers** (`SupplierList.jsx`) — each small, single-list-page domains confirmed independent of `stock` by their API route files (`cashflow.php`, `locations.php`, `suppliers.php` — none appear in the stock-touching route list). Recommend porting those three next, in that order (finance resolves the most currently-dead sidebar links), before circling back to the stock-dependent domains once the backend schema mismatch is resolved.
