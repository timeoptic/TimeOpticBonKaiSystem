# Next.js Finance Domain (Income / Expense) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the `finance` domain (income ledger, expense ledger — two thin pages sharing one component) from `frontend/` (Vite) to `frontend-next/` (Next.js), against the same PHP API + MariaDB.

**Architecture:** Unlike every prior domain plan, `Ledger` in the Vite source is a genuinely shared, parameterized component consumed by two unrelated top-level routes (`/income`, `/expense`) — there is no single "owning" route folder for it. It becomes this plan's one new shared component, `frontend-next/components/Ledger.jsx`, exactly mirroring how `RxTable.jsx` already lives in `components/` rather than under one domain's `app/` folder. Both routes are static, id-less, query-param-less — no `useSearchParams`, no `QueryParamPage` wrapping, no `editing` prop, no not-found guard: this domain has none of the failure modes the customers/prescriptions plans had to guard against, because there is no id-bearing detail/edit route here at all. Deletes act on `r.id` read directly from a freshly-loaded list row, never from a separately-fetched record or a URL param, so there is no stale/idless-record risk to guard against.

**Tech Stack:** Same as prior plans — Next.js 15 (App Router, static export), React 19.2.8, `frontend-next/lib/apiClient.js`, shared UI components.

**Spec:** `docs/superpowers/specs/2026-08-25-nextjs-frontend-only-migration-design.md`

**Depends on:** Foundation (complete). Does not depend on cases/bookings/customers/prescriptions domains — no cross-links exist between finance and any other domain in either direction.

## Global Constraints

- `frontend/` (Vite) and `api/` (PHP) are not touched by this plan.
- **This plan does not touch, query, or reason about the `stock` table.** `api/routes/cashflow.php` (which serves `GET/POST/PUT/DELETE /api/income` and `/api/expense`, generated from one shared description for both tables) was verified directly to have zero reference to `stock` anywhere in the file.
- No SSR — every page a Client Component.
- Neither page calls `useSearchParams()` — no `QueryParamPage` wrapping is needed or should be added (don't cargo-cult it in from other domains; it would be dead weight here).
- The shared `Ledger` component takes its five variance points (`title, subtitle, icon, endpoint, typeKey, typeList, withPayType`) as explicit props from each thin page — never inferred from the route path or any other implicit source.
- `GET /api/income` and `GET /api/expense` both return `{ rows: [...], total: <number> }` directly (not the `{ ok, data }` envelope most other endpoints use) — confirmed by reading `api/routes/cashflow.php:59-63`. The ported component must read `data.rows` / `data.total`, not `data.data` or similar.
- UI must work at 1920×1080, 810×1080 (iPad portrait), 1080×810 (iPad landscape) — verified with real Chrome headless DevTools Protocol screenshots.
- `npm run build` must pass AND the resulting `frontend-next/out/` must be served and loaded in a real browser with the console checked, for both `/income/` and `/expense/`.
- `frontend-next/lib/crumb.js` already contains `['/income', 'รายรับ']` and `['/expense', 'รายจ่าย']` — confirmed by direct read. No crumb changes are needed in this plan.
- **Environment note carried forward from the prescriptions-domain plan's final review:** ports `8080` (PHP) and `5173` (Vite) on this machine may belong to an unrelated project (`C:\TimeOpticDigitalSystem`), not this repo — confirmed as an active, ongoing collision during that plan's execution. Any task in this plan that starts a PHP API instance must verify it is serving **this repo's** `api/` (e.g. by checking the process command line, or by hitting an endpoint and confirming the response shape matches this repo's schema) before treating it as usable — never assume by port number alone. Prefer starting your own instance on an alternate port over trusting an "already running" one on 8080/5173.

---

## File Structure

```
frontend-next/
├── components/
│   └── Ledger.jsx        shared component (NOT a page) — takes all variance as props
├── app/
│   ├── income/
│   │   └── page.jsx      renders <Ledger title="Menu Income" subtitle="รายรับ" icon="💰"
│   │                              endpoint="/api/income" typeKey="income_type"
│   │                              typeList="income_type" withPayType={false} />
│   └── expense/
│       └── page.jsx      renders <Ledger title="Expense" subtitle="รายจ่าย" icon="💸"
│                                  endpoint="/api/expense" typeKey="expense_type"
│                                  typeList="expense_type" withPayType />
```

**Interfaces later domain plans will rely on:** none new beyond `Ledger` itself, which nothing else currently links to or is expected to reuse (it is genuinely a two-consumer component, not a general-purpose one).

---

### Task 1: `Ledger` shared component and its two thin pages

**Files:**
- Create: `frontend-next/components/Ledger.jsx` (port of `frontend/src/pages/finance/Ledger.jsx`'s inner `Ledger` function — the exported `IncomeView`/`ExpenseView` wrapper pattern from Vite becomes the two Next.js page files below instead, since Next.js pages are files, not exported components)
- Create: `frontend-next/app/income/page.jsx`
- Create: `frontend-next/app/expense/page.jsx`

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js` (`useAsync, useDebounced, onSubmit`), `components/Toast.jsx` (`useToast`), `components/Confirm.jsx` (`useConfirm`), `components/ui.jsx` (`Card, Field, FormActions, FormGrid, Loading, PageHead, Toolbar`), `components/DataTable.jsx`, `components/Selects.jsx` (`ListSelect`), `lib/format.js` (`fmtDate, money, todayISO`).
- Produces: `Ledger({ title, subtitle, icon, endpoint, typeKey, typeList, withPayType })` — a plain exported function component from `components/Ledger.jsx`, not a page. Both `page.jsx` files import and render it with literal props (no shared constant/config object needed — five short prop lines per page is clearer than a config-object indirection for only two call sites).

- [ ] **Step 1: Write `frontend-next/components/Ledger.jsx`**

```jsx
'use client';
/**
 * Shared income/expense ledger: an entry form on top, a filtered, totaled
 * history below. Port of frontend/src/pages/finance/Ledger.jsx's inner
 * component — only the endpoint, the type column, and whether a payment
 * method is recorded differ between the two call sites (app/income/page.jsx,
 * app/expense/page.jsx).
 */
import { useState } from 'react';
import { api } from '../lib/apiClient.js';
import { useAsync, useDebounced, onSubmit } from '../lib/hooks.js';
import { useToast } from './Toast.jsx';
import { useConfirm } from './Confirm.jsx';
import { Card, Field, FormActions, FormGrid, Loading, PageHead, Toolbar } from './ui.jsx';
import { DataTable } from './DataTable.jsx';
import { ListSelect } from './Selects.jsx';
import { fmtDate, money, todayISO } from '../lib/format.js';

export function Ledger({ title, subtitle, icon, endpoint, typeKey, typeList, withPayType }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();

  const [term, setTerm] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useDebounced(term);

  const { data, loading, error, reload } = useAsync(
    () => api.get(endpoint, { q: q.trim(), from, to, limit: 500 }),
    [q, from, to]
  );

  const add = async (body, form) => {
    try {
      await api.post(endpoint, body);
      ok('บันทึกแล้ว');
      form.reset();
      reload();
    } catch (ex) { err(ex); }
  };

  const remove = async (r) => {
    if (!await confirm('ลบรายการ', `ลบรายการ #${r.id} (${money(r.amount)})?`,
      { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del(`${endpoint}/${r.id}`);
      ok('ลบแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const thisMonth = () => {
    const d = new Date();
    setFrom(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
    setTo(todayISO());
  };

  const columns = [
    { label: 'ID', key: 'id', cls: 'mono' },
    { label: 'วันที่', render: (r) => fmtDate(r.cf_date), cls: 'nowrap' },
    { label: 'ประเภท', key: typeKey },
    { label: 'สาขา', key: 'branch' },
    { label: 'จำนวนเงิน', render: (r) => money(r.amount), cls: 'num' },
    ...(withPayType ? [{ label: 'ชำระ', key: 'pay_type' }] : []),
    { label: 'หมายเหตุ', key: 'notes' },
    {
      label: '',
      cls: 'nowrap',
      render: (r) => (
        <button type="button" className="btn btn-sm btn-light" onClick={() => remove(r)}>🗑</button>
      ),
    },
  ];

  return (
    <div>
      <PageHead icon={icon} title={title} subtitle={subtitle} />

      <div className="card">
        <div className="card-head"><h2>บันทึกรายการใหม่</h2></div>
        <form className="card-body" onSubmit={onSubmit(add)}>
          <FormGrid>
            <Field label="วันที่ / CFDate">
              <input name="cf_date" type="date" defaultValue={todayISO()} required />
            </Field>
            <Field label={typeKey === 'income_type' ? 'ประเภทรายรับ / IncomeType' : 'ประเภทรายจ่าย / ExpenseType'}>
              <ListSelect name={typeKey} kind={typeList} defaultValue="" />
            </Field>
            <Field label="สาขา / Branch">
              <ListSelect name="branch" kind="branch" defaultValue="Timeoptic" />
            </Field>
            <Field label="จำนวนเงิน / Amount">
              <input name="amount" type="number" step="1" min="0" defaultValue={0} required />
            </Field>
            {withPayType && (
              <Field label="ชำระด้วย / PayType">
                <ListSelect name="pay_type" kind="pay_type" defaultValue="Cash" />
              </Field>
            )}
            <Field label="หมายเหตุ / Notes" className="full">
              <textarea name="notes" />
            </Field>
          </FormGrid>
          <FormActions>
            <button className="btn btn-lg" type="submit">✔ Enter — บันทึก</button>
          </FormActions>
        </form>
      </div>

      <Toolbar>
        <Field label="ค้นหา" className="grow">
          <input
            type="search"
            placeholder="ประเภท / สาขา / หมายเหตุ"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </Field>
        <Field label="ตั้งแต่วันที่">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="ถึงวันที่">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <button type="button" className="btn btn-light" onClick={thisMonth}>เดือนนี้</button>
      </Toolbar>

      {loading && <Loading />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (
        <Card tight>
          <DataTable
            columns={columns}
            rows={data.rows}
            empty="ไม่พบรายการ"
            footer={data.rows.length ? (
              <tr>
                <td colSpan={4}>{`รวม ${data.rows.length} รายการ`}</td>
                <td className="num">{money(data.total)}</td>
                <td colSpan={withPayType ? 3 : 2} />
              </tr>
            ) : null}
          />
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write `frontend-next/app/income/page.jsx`**

```jsx
'use client';
import { Ledger } from '../../components/Ledger.jsx';

export default function IncomePage() {
  return (
    <Ledger
      title="Menu Income" subtitle="รายรับ" icon="💰"
      endpoint="/api/income" typeKey="income_type" typeList="income_type" withPayType={false}
    />
  );
}
```

- [ ] **Step 3: Write `frontend-next/app/expense/page.jsx`**

```jsx
'use client';
import { Ledger } from '../../components/Ledger.jsx';

export default function ExpensePage() {
  return (
    <Ledger
      title="Expense" subtitle="รายจ่าย" icon="💸"
      endpoint="/api/expense" typeKey="expense_type" typeList="expense_type" withPayType
    />
  );
}
```

- [ ] **Step 4: Verify the build compiles**

Run (from `frontend-next/`): `npm run build`. Expected: succeeds, producing `out/income/index.html`, `out/expense/index.html`.

- [ ] **Step 5: Commit**

```bash
git add frontend-next/components/Ledger.jsx frontend-next/app/income/page.jsx frontend-next/app/expense/page.jsx
git commit -m "Add shared Ledger component and wire /income and /expense pages"
```

---

### Task 2: Build, browser-load check, and verify against the real API

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

```bash
cd frontend-next
npm test
```
Expected: all existing tests still pass (no new tests in this domain — no new `lib/` logic was added).

- [ ] **Step 2: Serve the static export and check the browser console**

Using the already-built `out/` from Task 1, serve it locally and load, in headless Chrome via the DevTools Protocol, watching the console for errors: `/income/` and `/expense/`. Both should render cleanly against a live or unreachable API alike (no crash either way — this component has no id/editing-mode guard to test since it has none of those failure modes, but it must still not throw if the API is briefly unreachable; `error &&` renders a plain `<Card><p>` with the error message, confirm that path too by pointing the static build's API origin at a closed port for one check).

- [ ] **Step 3: Manually verify against the real PHP API + MariaDB, compared with the still-running Vite app**

Start a PHP API instance serving **this repo's** `api/` — verify it's this repo's, not the `C:\TimeOpticDigitalSystem` one that has previously been found squatting port 8080 during this plan series (check the response shape of a quick `GET /api/meta` call, or the process command line, before trusting anything already running on 8080). Start Next dev server pointed at that instance, and the Vite app for comparison (same verification: confirm it's this repo's `frontend/`, not the other project's, before trusting an "already running" instance on 5173).

- Compare `/income` (Next) vs `/#/income` (Vite) — load both, confirm the same rows and the same total appear.
- Compare `/expense` (Next) vs `/#/expense` (Vite) — same check; also confirm the "ชำระ / PayType" column appears on expense but not income (the `withPayType` prop difference), on both apps.
- Create one real entry on the Next `/income` page (e.g. amount 1, notes tagged `TEST-finance-task2`, so it's unambiguous and easy to find), confirm it appears in the list with the correct total update, then **delete it via the 🗑 button** and confirm it's gone (this domain, unlike prescriptions, DOES have a working DELETE endpoint — use it, don't leave test data behind).
- Repeat the create-then-delete check once on `/expense` (a real entry, tagged, then deleted) to exercise the `withPayType` form path (the `pay_type` field) at least once through a real write.
- Try the "เดือนนี้" (this month) quick-filter button on either page and confirm `from`/`to` populate and the list re-filters.
- Stop all servers when done.

- [ ] **Step 4: No commit needed for this task** (verification only — skip straight to Task 3 unless a real bug was found, in which case fix it, re-verify, and commit the fix with a message describing the actual bug).

---

### Task 3: Verify in-browser at all three required breakpoints

**Files:** none (verification only; fix in `frontend-next/app/globals.css` only if something real is found).

- [ ] **Step 1: Start the servers, launch Chrome headless with remote debugging** (same method as every prior plan; same port-ownership caution as Task 2).

- [ ] **Step 2: Screenshot and inspect `/income` and `/expense` at all three required sizes: 1920×1080, 810×1080, 1080×810.**

Both pages share the identical layout shape (a "new entry" form card, a filter toolbar with 3 fields plus a button, then a totaled `DataTable`) — check specifically: no horizontal scroll on the page body itself at any size; the entry-form `FormGrid` and the filter `Toolbar` don't clip or overlap at 810×1080; the `DataTable`'s footer row (the totals row) renders correctly and doesn't break the table layout at any width; the sidebar drawer's 3 close mechanisms still work at 810×1080 (regression check, not new work).

- [ ] **Step 3: If anything real is found, fix it in `frontend-next/app/globals.css` only, re-screenshot until it passes. If nothing needs fixing, say so plainly.**

- [ ] **Step 4: Kill headless Chrome and both dev servers.**

- [ ] **Step 5: Commit any fix** (message: `Fix responsive layout issues found verifying the finance domain`). Skip if nothing needed fixing.

---

## Self-Review Notes

- **Spec coverage:** both Vite views (`IncomeView`, `ExpenseView`) are covered — as two thin pages sharing the one new component, exactly mirroring the Vite source's own structure (one `Ledger` function, two parameterized call sites).
- **Placeholder scan:** no TBDs; every step has runnable code or an exact command.
- **Type/name consistency:** `Ledger` takes exactly `{ title, subtitle, icon, endpoint, typeKey, typeList, withPayType }`; both page files pass all seven explicitly, matching the Vite source's `IncomeView`/`ExpenseView` prop values exactly (including `withPayType={false}` written explicitly on the income page rather than omitted, matching the plan's own emphasis elsewhere on being explicit rather than relying on a prop defaulting to falsy).
- **Scope:** this plan covers only `income`/`expense`. It introduces exactly one new shared component (`Ledger.jsx`) — a deliberate, justified exception to the "no new shared components" pattern every prior domain plan since Foundation has followed, because this is the first domain where the Vite source itself already shares one component across two unrelated routes.

## After This Plan

Two domains remain before circling back to the `stock`-dependent group: **locations** (`LocationList.jsx`, a single list+create+delete page much like this one — no id-bearing sub-routes) and **suppliers** (`SupplierList.jsx`, same shape). Recommend porting those next, in either order (no dependency between them), before returning to `orders`/`stock`/`sales`/`reports` once the backend's `stock`-table mismatch is resolved separately.
