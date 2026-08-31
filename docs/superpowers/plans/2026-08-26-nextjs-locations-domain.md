# Next.js Locations Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the `locations` domain (`/locations` — a single list+create+delete page for product storage locations) from `frontend/` (Vite) to `frontend-next/` (Next.js), against the same PHP API + MariaDB.

**Architecture:** The simplest domain in this series so far: one static route, no id-bearing sub-routes, no query-param state, no shared component needed (unlike `finance`, this page has exactly one consumer). `GET /api/locations` returns a **plain array** directly (`Db::all(...)`, no `{ok,data}` envelope and no `{rows,total}` wrapper like `finance`) — confirmed by reading `api/routes/locations.php` directly.

**Tech Stack:** Same as prior plans — Next.js 15 (App Router, static export), React 19.2.8, `frontend-next/lib/apiClient.js`, shared UI components.

**Spec:** `docs/superpowers/specs/2026-08-25-nextjs-frontend-only-migration-design.md`

**Depends on:** Foundation (complete). No cross-links to/from any other domain.

## Global Constraints

- `frontend/` (Vite) and `api/` (PHP) are not touched by this plan.
- **This plan does not touch, query, or reason about the `stock` table.** `api/routes/locations.php` operates entirely on `product_locations`, a table keyed by `product_name` text, not by `stock` id — verified directly, zero reference to `stock` anywhere in the file.
- No SSR — every page a Client Component.
- No `useSearchParams()` anywhere in this domain — no `QueryParamPage` wrapping needed or should be added.
- `GET /api/locations` returns a plain array (`[{id, product_name, location}, ...]`), not `{ok,data}` or `{rows,total}` — the ported page must pass the `useAsync` result straight through as `rows`, exactly like the Vite original does, not unwrap a nonexistent envelope.
- `frontend-next/lib/crumb.js` already contains `['/locations', 'ตำแหน่งสินค้า']` and `components/Shell.jsx` already has the nav entry — confirmed by direct read. No changes needed to either file in this plan.
- UI must work at 1920×1080, 810×1080 (iPad portrait), 1080×810 (iPad landscape) — verified with real Chrome headless DevTools Protocol screenshots.
- `npm run build` must pass AND the resulting `frontend-next/out/` must be served and loaded in a real browser with the console checked.
- **Standing environment cautions carried forward from this session:** (1) ports 8080/5173 may belong to an unrelated project (`C:\TimeOpticDigitalSystem`) — verify any PHP/Vite instance is this repo's before trusting it, by response shape or process command line, never by port number alone. (2) Do not run `npm run build` in the shared `frontend-next/` checkout while the shared `npm run dev` instance (kept running at `localhost:3000` for the user's own viewing) might also be active — both write to `.next/` and this has already corrupted that cache once this session. Prefer reading the shared dev server directly for visual checks, or build/serve from a temp copy if an isolated static export is truly needed. (3) `app/providers.jsx`'s `Gate` component blocks ALL page content whenever `/api/meta` fails — verifying any page-level `error` branch requires letting `/api/meta` succeed while failing only the domain's own endpoint (e.g. via CDP `Fetch`-domain interception), not simply pointing the whole API origin at a dead port, which only proves the Gate's screen works (already proven) and not the page's own error handling.

---

## File Structure

```
frontend-next/
└── app/
    └── locations/
        └── page.jsx      LocationList (single file, no sub-routes, no shared component)
```

**Interfaces later domain plans will rely on:** none.

---

### Task 1: Port LocationList (`/locations`)

**Files:**
- Create: `frontend-next/app/locations/page.jsx` (port of `frontend/src/pages/shop/LocationList.jsx`)

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js` (`useAsync, useDebounced, onSubmit`), `components/Toast.jsx` (`useToast`), `components/ui.jsx` (`Card, Field, FormActions, FormGrid, Loading, PageHead, Toolbar`), `components/DataTable.jsx`.

- [ ] **Step 1: Write `frontend-next/app/locations/page.jsx`**

```jsx
'use client';
import { useState } from 'react';
import { api } from '../../lib/apiClient.js';
import { useAsync, useDebounced, onSubmit } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import { Card, Field, FormActions, FormGrid, Loading, PageHead, Toolbar } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';

export default function LocationsPage() {
  const { ok, err } = useToast();
  const [term, setTerm] = useState('');
  const q = useDebounced(term);

  const { data: rows, loading, reload } = useAsync(
    () => api.get('/api/locations', { q: q.trim() }),
    [q]
  );

  const add = async (body, form) => {
    try {
      await api.post('/api/locations', body);
      ok('เพิ่มแล้ว');
      form.reset();
      reload();
    } catch (ex) { err(ex); }
  };

  const remove = async (r) => {
    try {
      await api.del('/api/locations/' + r.id);
      ok('ลบแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <div>
      <PageHead icon="📍" title="Product Location" subtitle="ตำแหน่งจัดเก็บสินค้า" />

      <div className="card">
        <div className="card-head"><h2>เพิ่มตำแหน่งสินค้า</h2></div>
        <form className="card-body" onSubmit={onSubmit(add)}>
          <FormGrid>
            <Field label="ชื่อสินค้า / ProductName *"><input name="product_name" required /></Field>
            <Field label="ตำแหน่ง / Location *">
              <input name="location" required placeholder="เช่น ตู้PRO1, Display, ข้างหลัง" />
            </Field>
            <Field label=" ">
              <button className="btn" type="submit">+ เพิ่มตำแหน่ง</button>
            </Field>
          </FormGrid>
          <FormActions />
        </form>
      </div>

      <Toolbar>
        <Field label="ค้นหา" className="grow">
          <input
            type="search"
            placeholder="ค้นหาชื่อสินค้า / ตำแหน่ง"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </Field>
      </Toolbar>

      {loading ? <Loading /> : (
        <Card tight>
          <DataTable
            columns={[
              { label: 'ID', key: 'id', cls: 'mono' },
              { label: 'ชื่อสินค้า', key: 'product_name' },
              { label: 'ตำแหน่ง', key: 'location' },
              {
                label: '',
                cls: 'nowrap',
                render: (r) => (
                  <button type="button" className="btn btn-sm btn-light" onClick={() => remove(r)}>🗑</button>
                ),
              },
            ]}
            rows={rows}
            empty="ยังไม่มีข้อมูลตำแหน่งสินค้า"
          />
        </Card>
      )}
    </div>
  );
}
```

Note: `rows` (from `useAsync`'s `data`, renamed) can be `undefined` while `loading` is `true`, but the `loading ? <Loading /> : (...)` guard means `DataTable` never sees `rows` while it's undefined — matching the Vite original's exact behavior. Once loaded, `api.get('/api/locations', ...)` resolves to the plain array or `null` (on a malformed 2xx body, per `lib/apiClient.js`); `DataTable.jsx` itself already guards `!rows` internally (confirmed in the customers/finance domains' final reviews), so no additional guard is needed here — the Vite original has the same shape and no guard, and this plan does not need to introduce one preemptively where the shared `DataTable` already covers it.

- [ ] **Step 2: Verify the build compiles**

Run (from `frontend-next/`): `npm run build`. Expected: succeeds, producing `out/locations/index.html`.

- [ ] **Step 3: Commit**

```bash
git add frontend-next/app/locations/page.jsx
git commit -m "Port LocationList to frontend-next"
```

---

### Task 2: Build, browser-load check, and verify against the real API

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

```bash
cd frontend-next
npm test
```
Expected: all existing tests still pass.

- [ ] **Step 2: Serve the static export and check the browser console**

Load `/locations/` in headless Chrome via the DevTools Protocol; check for console errors against a live API. Also confirm the page doesn't crash if `/api/locations` itself fails (use CDP `Fetch`-domain interception to let `/api/meta` succeed while failing only `/api/locations`, per this plan's Global Constraint about the `Gate` component — do not just kill the whole API origin, which only re-proves the already-known Gate behavior).

- [ ] **Step 3: Manually verify against the real PHP API + MariaDB, compared with the still-running Vite app**

Start a PHP API instance serving **this repo's** `api/` (verify by response shape or process command line before trusting anything already running on 8080). Compare `/locations` (Next) vs `/#/locations` (Vite) — same rows for a few search terms. Create one real entry (e.g. `product_name: "TEST-locations-task2"`, `location: "QA"`), confirm it appears, then **delete it via the 🗑 button** and confirm — via a fresh `GET /api/locations?q=TEST-locations-task2` re-check, not just UI trust — that it's actually gone (this domain has a working DELETE endpoint). Stop all servers when done.

- [ ] **Step 4: No commit needed for this task** unless a real bug was found and fixed.

---

### Task 3: Verify in-browser at all three required breakpoints

**Files:** none (verification only; fix in `frontend-next/app/globals.css` only if something real is found).

- [ ] **Step 1: Start the servers, launch Chrome headless with remote debugging** (same method as every prior plan; same port-ownership caution).

- [ ] **Step 2: Screenshot and inspect `/locations` at all three required sizes: 1920×1080, 810×1080, 1080×810.**

Check specifically: no horizontal scroll on the page body itself at any size; the 3-field `FormGrid` (product name, location, submit button) doesn't clip or overlap at 810×1080; the 4-column `DataTable` renders cleanly; the sidebar drawer's 3 close mechanisms still work at 810×1080 (regression check).

- [ ] **Step 3: If anything real is found, fix it in `frontend-next/app/globals.css` only, re-screenshot until it passes. If nothing needs fixing, say so plainly.**

- [ ] **Step 4: Kill headless Chrome and any servers you started yourself.**

- [ ] **Step 5: Commit any fix** (message: `Fix responsive layout issues found verifying the locations domain`). Skip if nothing needed fixing.

---

## Self-Review Notes

- **Spec coverage:** the one Vite page (`LocationList.jsx`) is covered by Task 1.
- **Placeholder scan:** no TBDs; every step has runnable code or an exact command.
- **Type/name consistency:** the ported page is a plain default-exported page component, matching the plan's File Structure. No new shared interfaces.
- **Scope:** this plan covers only `/locations`. No new shared components or `lib/` modules needed — the simplest domain in the series so far.

## After This Plan

One domain remains before circling back to the `stock`-dependent group: **suppliers** (`SupplierList.jsx`) — same shape as this one (single list+create+toggle page), also confirmed independent of `stock` (`api/routes/suppliers.php` does not appear in the stock-touching route list). After suppliers, every domain not blocked by the live database's `stock`-table mismatch will be complete; `orders`/`stock`/`sales`/`reports` remain deferred until that backend issue is resolved separately.
