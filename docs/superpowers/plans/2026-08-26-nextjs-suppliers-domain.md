# Next.js Suppliers Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the `suppliers` domain (`/suppliers` — a single list+create+toggle-active page for lens/frame suppliers) from `frontend/` (Vite) to `frontend-next/` (Next.js), against the same PHP API + MariaDB. This is the last domain in the current wave before the `stock`-table-dependent group (`orders`, `stock`, `sales`, `reports`), which stays deferred until that backend schema mismatch is resolved separately.

**Architecture:** Same shape as `locations` (single page, no id-routing, no `useSearchParams`, no shared component needed) but closer in exact structure to the already-shipped `app/employees/page.jsx` — both are list+create+toggle-active pages (no delete endpoint at all, only a `PUT .../:id` flipping `active` 0/1) that call `useMeta().reload()` after a write so the app-wide lookup lists (used elsewhere for supplier pickers) stay fresh. `app/employees/page.jsx` is the closest existing template in this codebase and this plan follows its exact conventions line-for-line where the two domains overlap.

**Tech Stack:** Same as prior plans — Next.js 15 (App Router, static export), React 19.2.8, `frontend-next/lib/apiClient.js`, shared UI components.

**Spec:** `docs/superpowers/specs/2026-08-25-nextjs-frontend-only-migration-design.md`

**Depends on:** Foundation (complete, provides `contexts/MetaContext.jsx`'s `useMeta`). No cross-links to/from any other already-ported domain.

## Global Constraints

- `frontend/` (Vite) and `api/` (PHP) are not touched by this plan.
- **This plan does not touch, query, or reason about the `stock` table.** `api/routes/suppliers.php` operates entirely on the `suppliers` table — verified directly, zero `stock` reference.
- No SSR — every page a Client Component.
- No `useSearchParams()` anywhere in this domain — no `QueryParamPage` wrapping needed or should be added.
- `GET /api/suppliers` returns a plain array directly (`Db::all(...)`, same shape as `locations`, not `{ok,data}` or `{rows,total}`) — the ported page must pass the `useAsync` result straight through as `rows`.
- There is **no DELETE endpoint** for suppliers — only `PUT /api/suppliers/:id` (used here to flip `active`). Any test supplier created during verification cannot be removed afterward; tag it unambiguously (e.g. `name: "TEST-suppliers-taskN"`) and note in the report that it is a permanent, harmless, clearly-marked artifact — same precedent as the prescriptions-domain plan, which also had no delete path.
- After any successful `add`/`toggle`, the page must call `useMeta()`'s `reload()` (aliased `reloadMeta`) before the toast/list-reload — matching `app/employees/page.jsx`'s exact pattern — because supplier names feed a `SupplierSelect` picker used elsewhere in the app (`components/Selects.jsx`) that reads from the shared meta context, not from this page's own state.
- `frontend-next/lib/crumb.js` and `components/Shell.jsx` already contain `/suppliers` entries — confirmed by direct read. No changes needed to either in this plan.
- UI must work at 1920×1080, 810×1080 (iPad portrait), 1080×810 (iPad landscape) — verified with real Chrome headless DevTools Protocol screenshots.
- `npm run build` must pass AND the resulting `out/` must be served and loaded in a real browser with the console checked.
- **`npm run build` must NEVER be run directly in the shared `frontend-next/` checkout.** This corrupted the shared dev server's `.next/` cache twice already this session (each requiring a manual `rm -rf .next` + restart). Always verify a build from a **detached `git worktree`** instead, with `node_modules` junctioned (not copied — copying ~200MB of `node_modules` is slow and wasteful; a junction is instant and safe since the worktree never installs its own):
  ```bash
  git worktree add /tmp/<unique-name> HEAD
  # Windows: create a directory junction (no admin rights needed, same volume)
  cmd /c mklink /J "\tmp\<unique-name>\frontend-next\node_modules" "C:\test\timeoptic-web\frontend-next\node_modules"
  cd /tmp/<unique-name>/frontend-next && npm run build
  # then, from the ORIGINAL repo (never from inside the worktree):
  git worktree remove /tmp/<unique-name> --force
  ```
  This was independently discovered and proven to work by the locations-domain plan's Task 2 — reuse it verbatim rather than re-deriving it. The worktree is structurally incapable of touching the shared checkout's `.next/`, so this is safe even while the shared `npm run dev` instance (kept running for the user's own live viewing) is active.
- **Ports 8080/5173 may still belong to an unrelated project** (`C:\TimeOpticDigitalSystem`) — verify any PHP/Vite instance is this repo's before trusting it. **However, this repo's own PHP API is now also reachable on `127.0.0.1:8082`**, which the shared dev server at `localhost:3000` is now configured to use (`frontend-next/.env.development`'s `NEXT_PUBLIC_API_ORIGIN` was repointed there earlier this session after 8080 turned out to be durably squatted). Verification tasks in this plan should prefer starting their own throwaway instance on yet another free port (this repo's PHP has no fixed-port requirement) rather than reusing 8082 directly, to avoid any interference with the shared dev server the user may be actively viewing — but if reusing the shared dev server read-only (no writes, no restarts) for a quick visual check, `:3000`/`:8082` are known-good as of this plan.
- `app/providers.jsx`'s `Gate` component blocks ALL page content whenever `/api/meta` fails. Verifying `/suppliers`'s own error handling (not just the Gate's) requires letting `/api/meta` succeed while failing only `/api/suppliers` — via CDP `Fetch`-domain interception, not by killing the whole API origin.
- **Every verification task must end with explicit "no leaked processes" evidence**: a listing of every process/port this task itself started, confirmed stopped, AND a listing confirming the shared (`:3000`, MySQL) and foreign (`:8080`/`:5173`) processes are unchanged — not merely a claim. (A prior task in this series leaked a stray Vite process that a later task had to discover and clean up.)

---

## File Structure

```
frontend-next/
└── app/
    └── suppliers/
        └── page.jsx      SupplierList (single file, no sub-routes, no shared component)
```

**Interfaces later domain plans will rely on:** none new. `components/Selects.jsx`'s existing `SupplierSelect` already reads supplier names from `useMeta()` — this plan doesn't change that, it just makes the page that lets you add/edit suppliers exist.

---

### Task 1: Port SupplierList (`/suppliers`)

**Files:**
- Create: `frontend-next/app/suppliers/page.jsx` (port of `frontend/src/pages/shop/SupplierList.jsx`, following `frontend-next/app/employees/page.jsx`'s exact established conventions for the `useMeta`/toggle-active pattern)

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js` (`useAsync, onSubmit`), `contexts/MetaContext.jsx` (`useMeta`), `components/Toast.jsx` (`useToast`), `components/ui.jsx` (`Badge, Card, Field, FormActions, FormGrid, Loading, PageHead`), `components/DataTable.jsx`.

- [ ] **Step 1: Write `frontend-next/app/suppliers/page.jsx`**

```jsx
'use client';
import { api } from '../../lib/apiClient.js';
import { useAsync, onSubmit } from '../../lib/hooks.js';
import { useMeta } from '../../contexts/MetaContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import { Badge, Card, Field, FormActions, FormGrid, Loading, PageHead } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';

export default function SupplierList() {
  const { reload: reloadMeta } = useMeta();
  const { ok, err } = useToast();
  const { data: rows, loading, reload } = useAsync(() => api.get('/api/suppliers'), []);

  const add = async (body, form) => {
    try {
      await api.post('/api/suppliers', body);
      await reloadMeta();
      ok('เพิ่มแล้ว');
      form.reset();
      reload();
    } catch (ex) { err(ex); }
  };

  const toggle = async (r) => {
    try {
      await api.put('/api/suppliers/' + r.id, { ...r, active: Number(r.active) ? 0 : 1 });
      await reloadMeta();
      reload();
    } catch (ex) { err(ex); }
  };

  if (loading) return <Loading />;

  return (
    <>
      <PageHead icon="🏭" title="Suppliers" subtitle="ซัพพลายเออร์เลนส์/สินค้า" />

      <div className="card">
        <div className="card-head"><h2>เพิ่มซัพพลายเออร์</h2></div>
        <form className="card-body" onSubmit={onSubmit(add)}>
          <FormGrid>
            <Field label="ชื่อซัพพลายเออร์ *"><input name="name" required /></Field>
            <Field label="ผู้ติดต่อ"><input name="contact_person" /></Field>
            <Field label="เบอร์โทร"><input name="phone" /></Field>
            <Field label="อีเมล"><input name="email" type="email" /></Field>
            <Field label="Lead time ปกติ (วัน)">
              <input name="default_lead_days" type="number" min="0" defaultValue={7} />
            </Field>
          </FormGrid>
          <FormActions>
            <button className="btn" type="submit">+ เพิ่มซัพพลายเออร์</button>
          </FormActions>
        </form>
      </div>

      <Card title="รายชื่อซัพพลายเออร์" tight>
        <DataTable
          columns={[
            { label: 'ID', key: 'id', cls: 'mono' },
            { label: 'ชื่อ', key: 'name' },
            { label: 'ผู้ติดต่อ', key: 'contact_person' },
            { label: 'เบอร์โทร', key: 'phone', cls: 'nowrap' },
            { label: 'อีเมล', key: 'email' },
            { label: 'Lead time', render: (r) => r.default_lead_days + ' วัน', cls: 'num' },
            {
              label: 'สถานะ',
              render: (r) => (Number(r.active) ? <Badge kind="ok">ใช้งาน</Badge> : <Badge kind="gray">ปิด</Badge>),
            },
            {
              label: '',
              cls: 'nowrap',
              render: (r) => (
                <button type="button" className="btn btn-sm btn-light" onClick={() => toggle(r)}>
                  {Number(r.active) ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                </button>
              ),
            },
          ]}
          rows={rows}
          empty="ยังไม่มีซัพพลายเออร์"
        />
      </Card>
    </>
  );
}
```

Note: like `locations`, `DataTable.jsx:19`'s own `if (!rows || !rows.length) return <Empty>...` guard already covers `rows` being `null`/`undefined`/`[]`, and the `loading ? <Loading /> : (...)`-equivalent early return (`if (loading) return <Loading />;`, matching this page's — and `employees`'s — exact early-return style rather than `locations`'s ternary style) means `DataTable` is never mounted during the initial load. No additional guard is needed here, for the same reasons the locations-domain plan's final review independently re-derived and confirmed.

- [ ] **Step 2: Verify the build compiles (via a detached worktree — see Global Constraints)**

From the main checkout: `git worktree add <temp-path> HEAD`, junction `node_modules` in (Windows: `mklink /J`), `cd` into the worktree's `frontend-next/` and run `npm run build`. Expected: succeeds, producing `out/suppliers/index.html`. Remove the worktree afterward (`git worktree remove <temp-path> --force`, run from the main checkout, never from inside the worktree).

- [ ] **Step 3: Commit** (from the main checkout, not the worktree)

```bash
git add frontend-next/app/suppliers/page.jsx
git commit -m "Port SupplierList to frontend-next"
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

- [ ] **Step 2: Serve the static export (from the Task 1 worktree build, or a fresh one built the same way) and check the browser console**

Load `/suppliers/` in headless Chrome via the DevTools Protocol; check for console errors against a live API. Also confirm the page's own behavior (via CDP `Fetch`-interception letting `/api/meta` succeed while failing only `/api/suppliers`) rather than just re-proving the `Gate`'s already-known screen.

- [ ] **Step 3: Manually verify against the real PHP API + MariaDB, compared with the still-running Vite app**

Start your own throwaway PHP API instance serving **this repo's** `api/` (verify by response shape or process command line — don't assume by port number) and your own Vite instance for comparison. Compare `/suppliers` (Next) vs `/#/suppliers` (Vite) — same rows. Create one real entry (`name: "TEST-suppliers-task2"`, fill the other fields plausibly), confirm it appears on both apps with the same shape, confirm the "Lead time" column renders `<N> วัน` correctly. **Toggle its active status** (there's no delete endpoint — this is the one write action fully exercisable both ways) and confirm the badge flips `ใช้งาน` ↔ `ปิด` and persists across a reload. Do not attempt to delete it (no endpoint exists) — leave it, clearly tagged, as a documented, harmless permanent artifact (same as this plan's Global Constraints require).

- [ ] **Step 4: "No leaked processes" evidence**

Paste a listing of every process/port your own work started, confirmed stopped, plus a listing confirming the shared (`:3000`, MySQL) and foreign (`:8080`/`:5173` if present) processes are unchanged from before you started.

- [ ] **Step 5: No commit needed for this task** unless a real bug was found and fixed.

---

### Task 3: Verify in-browser at all three required breakpoints

**Files:** none (verification only; fix in `frontend-next/app/globals.css` only if something real is found).

- [ ] **Step 1: Start your own PHP API instance (verified to be this repo's) and launch Chrome headless with remote debugging.** Prefer the real API over mocked data this time — the locations-domain plan's final review flagged that mocking weakened its own responsive evidence; this repo's API is readily startable on a throwaway port (or the shared `:3000`/`:8082` pairing may be reused read-only if already healthy — check first with a plain `curl` before assuming).

- [ ] **Step 2: Screenshot and inspect `/suppliers` at all three required sizes: 1920×1080, 810×1080, 1080×810, against real supplier rows (not mocked).**

Check specifically: no horizontal scroll on the page body itself at any size; the 5-field `FormGrid` doesn't clip or overlap at 810×1080; the 7-column `DataTable` (including the status `Badge` and the toggle button) renders cleanly; the sidebar drawer's 3 close mechanisms still work at 810×1080 (regression check).

- [ ] **Step 3: If anything real is found, fix it in `frontend-next/app/globals.css` only, re-screenshot until it passes. If nothing needs fixing, say so plainly.**

- [ ] **Step 4: Kill headless Chrome and any servers you started yourself. Paste "no leaked processes" evidence, same bar as Task 2's Step 4.**

- [ ] **Step 5: Commit any fix** (message: `Fix responsive layout issues found verifying the suppliers domain`). Skip if nothing needed fixing.

---

## Self-Review Notes

- **Spec coverage:** the one Vite page (`SupplierList.jsx`) is covered by Task 1.
- **Placeholder scan:** no TBDs; every step has runnable code or an exact command.
- **Type/name consistency:** matches `app/employees/page.jsx`'s established `useMeta`/`reloadMeta`/toggle pattern exactly — verified by reading that file directly before writing this plan, not from memory.
- **Scope:** this plan covers only `/suppliers`. No new shared components or `lib/` modules needed.
- **Process fixes carried forward from the locations-domain plan's final review:** build verification now mandates a detached worktree (not the shared checkout) with an exact reusable command sequence; Task 3 prefers real data over mocks now that this repo's own API is reachable again on `:8082`; both verification tasks require explicit "no leaked processes" evidence rather than an implicit cleanup claim.

## After This Plan

This is the last domain in the current wave — after `suppliers`, every domain independent of the live database's `stock`-table mismatch will be complete (Foundation, cases, bookings, customers, prescriptions, finance, locations, suppliers). The remaining domains (`orders`, `stock`, `sales`, and the stock-touching parts of `reports`) stay deferred until that backend schema issue is resolved separately — porting their frontends now would produce pages verifiable only against a broken backend, which this session's standing directive explicitly avoids.
