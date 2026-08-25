# Next.js Frontend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a new Next.js (App Router, static export) app at `frontend-next/`, sitting next to the existing `frontend/` (Vite) app, that ports every shared/core client module (API client, format/constants/hooks, Toast/Confirm/Meta providers, shared UI components) and proves the whole pattern end-to-end with one pilot vertical slice (`/` Dashboard + `/employees`) reading and writing the real PHP API + MariaDB `timeoptic` database — no changes to `api/` beyond one CORS origin.

**Architecture:** `frontend-next/` is a standalone Next.js app (its own `package.json`, independent of the repo-root `package.json` and of `frontend/`'s). Every page is a Client Component (`'use client'`) that fetches from the PHP API via `lib/apiClient.js`, exactly the pattern `frontend/src/pages/**` already uses — this is a routing/build-tool swap, not a data-fetching redesign. `next.config.js` sets `output: 'export'` so the production build is static files deployable next to `api/` under Apache, with zero Node process at runtime.

**Tech Stack:** Next.js 15 (App Router, static export), React 19.2.8, react-dom 19.2.8, Node's built-in `node:test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-08-25-nextjs-frontend-only-migration-design.md`

## Global Constraints

- `api/` (PHP) and the MariaDB schema are not touched, except one line: `api/config.php`'s `cors_origins` gains the Next dev server's origin.
- No SSR — every page keeps today's client-fetch pattern (`useAsync` + the API client). `output: 'export'` in `next.config.js`.
- Record-detail routes read their id from a query string (`?id=`), never a `[id]` path segment — static export can't pre-render unbounded database IDs. (Not exercised in this Foundation plan — `/` and `/employees` have no id-keyed routes — but every later domain plan must follow it.)
- UI must work at three breakpoints: **1920×1080** (desktop), **810×1080** (iPad portrait), **1080×810** (iPad landscape). Verify with Chrome headless DevTools Protocol screenshots before marking any page task done.
- `frontend/` (the Vite app) is not deleted in this plan — it stays running side-by-side for comparison until every domain is ported.

---

## File Structure

```
frontend-next/
├── app/
│   ├── layout.jsx              root layout: <html lang="th">, metadata/favicon, imports globals.css
│   ├── globals.css              copy of frontend/src/styles/app.css
│   ├── providers.jsx             'use client' — wraps children in Toast/Confirm/Meta providers + Shell
│   ├── page.jsx                  Dashboard (pilot page)
│   └── employees/
│       └── page.jsx              EmployeeList (pilot page)
├── components/
│   ├── ui.jsx                    PageHead, Card, Field, Badge, Loading, Kpi, Kpis, Kv, etc.
│   ├── DataTable.jsx
│   ├── Selects.jsx                Select, EmployeeSelect, ListSelect, SupplierSelect, StatusSelect
│   ├── Shell.jsx                  sidebar/topbar frame, owns crumb-from-pathname logic
│   ├── Toast.jsx
│   └── Confirm.jsx
├── contexts/
│   └── MetaContext.jsx            MetaProvider / useMeta / useBookingLabels
├── lib/
│   ├── apiClient.js               fetch wrapper, prefixes NEXT_PUBLIC_API_ORIGIN
│   ├── format.js                  copy of frontend/src/lib/format.js
│   ├── constants.js                copy of frontend/src/lib/constants.js
│   ├── hooks.js                   copy of frontend/src/lib/hooks.js + 'use client'
│   └── __tests__/
│       ├── apiClient.test.js
│       └── format.test.js
├── .env.local                     NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:8080 (dev only, git-ignored)
├── .env.example                   documents NEXT_PUBLIC_API_ORIGIN
├── next.config.js                 output: 'export'
└── package.json

api/
└── config.php                     Modify: cors_origins gains http://localhost:3000
```

**Interfaces every later domain plan (bookings, cases, customers, orders, …) will rely on:**

- `lib/apiClient.js` exports `api.get(path, query?, signal?)`, `api.post(path, body?)`, `api.put(path, body?)`, `api.del(path)` — same names/signatures as today's `frontend/src/api/client.js`, plus automatic `NEXT_PUBLIC_API_ORIGIN` prefixing.
- `lib/format.js`, `lib/constants.js`, `lib/hooks.js` export the same names as their `frontend/src/lib/*` originals.
- `contexts/MetaContext.jsx` exports `MetaProvider`, `useMeta()` (`{ meta, reload, ready, error }`), `useBookingLabels()`.
- `components/ui.jsx`, `DataTable.jsx`, `Selects.jsx`, `Shell.jsx`, `Toast.jsx`, `Confirm.jsx` export the same names as today's `frontend/src/components` equivalents — later plans import from `../../components/...` (relative, matching this app's depth) instead of Vite's `../components/...`.
- **Record-detail URL convention** every later domain plan must follow: a list page at `app/<domain>/page.jsx`, a detail/edit page at `app/<domain>/detail/page.jsx` (or `edit/page.jsx`) reading `useSearchParams().get('id')`, linked from the list as `href={`/<domain>/detail?id=${row.id}`}`.

---

### Task 1: Scaffold the Next.js app at `frontend-next/`

**Files:**
- Create: `frontend-next/package.json`
- Create: `frontend-next/next.config.js`
- Create: `frontend-next/.env.local`
- Create: `frontend-next/.env.example`
- Create: `frontend-next/app/layout.jsx`
- Create: `frontend-next/app/globals.css` (copy of `frontend/src/styles/app.css`)
- Create: `frontend-next/app/page.jsx` (temporary placeholder, replaced in Task 8)
- Modify: `.gitignore` (repo root) — add `frontend-next/node_modules`, `frontend-next/.next`, `frontend-next/out`, `frontend-next/.env.local`

**Interfaces:**
- Produces: a running `next dev` server at `http://localhost:3000` rendering `app/layout.jsx` → `app/page.jsx`.

- [ ] **Step 1: Create `frontend-next/package.json`**

```json
{
  "name": "timeoptic-frontend-next",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "test": "node --test lib/__tests__"
  },
  "dependencies": {
    "next": "^15.5.0",
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  }
}
```

Run: `cd frontend-next && npm install`
Expected: installs without errors; `frontend-next/node_modules/next` exists.

- [ ] **Step 2: Create `frontend-next/next.config.js`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  reactStrictMode: true,
};

module.exports = nextConfig;
```

- [ ] **Step 3: Create `frontend-next/.env.local` and `.env.example`**

`.env.local` (dev only — points at the PHP dev server; static export has no proxy so this can't rely on Vite-style `server.proxy`):
```
NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:8080
```

`.env.example`:
```
# Origin the app fetches the PHP API from in development.
# Leave empty in production — Apache serves the static build and api/ from
# the same origin, so relative /api/... paths already work.
NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:8080
```

- [ ] **Step 4: Add `frontend-next` build artifacts to `.gitignore`**

Read the repo-root `.gitignore` first, then append:
```
frontend-next/node_modules
frontend-next/.next
frontend-next/out
frontend-next/.env.local
```

- [ ] **Step 5: Copy the existing stylesheet into `app/globals.css`**

Run: `cp frontend/src/styles/app.css frontend-next/app/globals.css`

- [ ] **Step 6: Create `frontend-next/app/layout.jsx`**

```jsx
export const metadata = {
  title: 'TimeOptic — ระบบจัดการร้านแว่นตา',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>👓</text></svg>",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Create a placeholder `frontend-next/app/page.jsx`**

```jsx
export default function Home() {
  return <p>TimeOptic Next.js frontend foundation — scaffold OK</p>;
}
```

- [ ] **Step 8: Run the dev server and verify it boots**

Run (from `frontend-next/`): `npm run dev` (background), then check `http://localhost:3000` returns 200 and contains "scaffold OK".
Expected: page loads with no console errors. Stop the dev server after confirming.

- [ ] **Step 9: Commit**

```bash
git add frontend-next/package.json frontend-next/package-lock.json frontend-next/next.config.js frontend-next/.env.example frontend-next/app/layout.jsx frontend-next/app/globals.css frontend-next/app/page.jsx .gitignore
git commit -m "Scaffold Next.js frontend app at frontend-next/"
```

(`.env.local` is git-ignored per Step 4 — do not add it.)

---

### Task 2: Port the API client (`lib/apiClient.js`)

**Files:**
- Create: `frontend-next/lib/apiClient.js`
- Test: `frontend-next/lib/__tests__/apiClient.test.js`

**Interfaces:**
- Produces: `api.get(path, query?, signal?)`, `api.post(path, body?)`, `api.put(path, body?)`, `api.del(path)` — same behavior as `frontend/src/api/client.js`, plus a `NEXT_PUBLIC_API_ORIGIN` prefix read per-request (not cached at module load, so tests can flip it between calls and — more importantly — so Next's build-time static replacement of `process.env.NEXT_PUBLIC_*` references works the same way regardless of where in the file the reference appears).

- [ ] **Step 1: Write the failing test**

```javascript
// frontend-next/lib/__tests__/apiClient.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

function stubFetch(response) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return response;
  };
  return calls;
}

const okJson = (data) => ({ ok: true, status: 200, json: async () => data });

test('api.get: prefixes the path with NEXT_PUBLIC_API_ORIGIN when set', async () => {
  process.env.NEXT_PUBLIC_API_ORIGIN = 'http://127.0.0.1:8080';
  const { api } = await import('../apiClient.js');
  const calls = stubFetch(okJson({ ok: 1 }));
  await api.get('/api/meta');
  assert.equal(calls[0].url, 'http://127.0.0.1:8080/api/meta');
});

test('api.get: falls back to a relative path when NEXT_PUBLIC_API_ORIGIN is empty', async () => {
  process.env.NEXT_PUBLIC_API_ORIGIN = '';
  const { api } = await import('../apiClient.js');
  const calls = stubFetch(okJson({ ok: 1 }));
  await api.get('/api/meta');
  assert.equal(calls[0].url, '/api/meta');
});

test('api.get: serializes query params, skipping blank/null/undefined', async () => {
  process.env.NEXT_PUBLIC_API_ORIGIN = '';
  const { api } = await import('../apiClient.js');
  const calls = stubFetch(okJson([]));
  await api.get('/api/customers', { q: 'สม', page: '', archived: null });
  assert.equal(calls[0].url, '/api/customers?q=%E0%B8%AA%E0%B8%A1');
});

test('api.post: sends a JSON body and content-type header', async () => {
  process.env.NEXT_PUBLIC_API_ORIGIN = '';
  const { api } = await import('../apiClient.js');
  const calls = stubFetch(okJson({ id: 1 }));
  await api.post('/api/employees', { employee_name: 'ทดสอบ' });
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['content-type'], 'application/json');
  assert.equal(calls[0].opts.body, JSON.stringify({ employee_name: 'ทดสอบ' }));
});

test('request: throws with the server error message on a non-ok response', async () => {
  process.env.NEXT_PUBLIC_API_ORIGIN = '';
  const { api } = await import('../apiClient.js');
  global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'กรุณากรอกชื่อ' }) });
  await assert.rejects(() => api.post('/api/employees', {}), /กรุณากรอกชื่อ/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend-next && node --test lib/__tests__/apiClient.test.js`
Expected: FAIL — `lib/apiClient.js` does not exist yet.

- [ ] **Step 3: Write `frontend-next/lib/apiClient.js`**

```javascript
'use client';
/**
 * API client. Port of frontend/src/api/client.js, with one addition: every
 * call is prefixed with NEXT_PUBLIC_API_ORIGIN (set in .env.local during
 * development, left empty in production) since a static export has no dev
 * proxy the way Vite's server.proxy did.
 */

function apiOrigin() {
  return process.env.NEXT_PUBLIC_API_ORIGIN || '';
}

const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== '' && v !== null && v !== undefined) p.set(k, v);
  }
  const s = p.toString();
  return s ? '?' + s : '';
};

async function request(method, path, body, signal) {
  const res = await fetch(apiOrigin() + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

export const api = {
  get: (path, query, signal) => request('GET', path + qs(query), null, signal),
  post: (path, body) => request('POST', path, body || {}),
  put: (path, body) => request('PUT', path, body || {}),
  del: (path) => request('DELETE', path),
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/__tests__/apiClient.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend-next/lib/apiClient.js frontend-next/lib/__tests__/apiClient.test.js
git commit -m "Port API client to frontend-next/lib/apiClient.js"
```

---

### Task 3: Port format/constants/hooks

**Files:**
- Create: `frontend-next/lib/format.js` (copy of `frontend/src/lib/format.js`, no changes)
- Create: `frontend-next/lib/constants.js` (copy of `frontend/src/lib/constants.js`, no changes)
- Create: `frontend-next/lib/hooks.js` (copy of `frontend/src/lib/hooks.js`, add `'use client'`)
- Test: `frontend-next/lib/__tests__/format.test.js`

**Interfaces:**
- Produces: same exports as the originals — `money, moneyShort, numFmt, count, power, rxNum, fmtDate, fmtDateTime, dateOnly, dtLocal, hhmm, toStamp, custName, bookingName, nowLocal, todayISO, sumBy` (format.js); `STAGE_META, stageInfo, STAGE_GROUPS, ACTION_LABEL, RX_KIND_LABEL, BOOKING_STATUS_CLASS, BOOKING_STEP_LABEL, BOOKING_STEPS, TH_MONTHS, TH_DOW, SHOP, NATIONALITIES, BRANDS` (constants.js); `useDebounced, useAsync, readForm, onSubmit` (hooks.js).

- [ ] **Step 1: Copy `format.js` and `constants.js` verbatim**

Run:
```bash
cp frontend/src/lib/format.js frontend-next/lib/format.js
cp frontend/src/lib/constants.js frontend-next/lib/constants.js
```

- [ ] **Step 2: Copy `hooks.js` and add the client directive**

Run: `cp frontend/src/lib/hooks.js frontend-next/lib/hooks.js`

Add `'use client';` as the first line of `frontend-next/lib/hooks.js` (before the existing header comment) — it uses `useState`/`useEffect`/`useRef`.

- [ ] **Step 3: Write tests for the pure formatting functions**

```javascript
// frontend-next/lib/__tests__/format.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money, power, fmtDate, fmtDateTime, custName, hhmm, todayISO } from '../format.js';

test('money: baht sign, Thai grouping, 2dp', () => {
  assert.equal(money(1234.5), '฿1,234.50');
  assert.equal(money(null), '฿0.00');
});

test('power: signed 2dp for numbers, dash for blank, passthrough for non-numeric', () => {
  assert.equal(power(''), '—');
  assert.equal(power(null), '—');
  assert.equal(power(-1.25), '-1.25');
  assert.equal(power(2), '+2.00');
  assert.equal(power('plano'), 'plano');
});

test('fmtDate: DD/MM/YYYY from a MySQL datetime string', () => {
  assert.equal(fmtDate('2026-08-25 14:30:00'), '25/08/2026');
});

test('fmtDateTime: adds HH:MM', () => {
  assert.equal(fmtDateTime('2026-08-25 14:05:00'), '25/08/2026 14:05');
});

test('custName: joins first+last, falls back when both blank', () => {
  assert.equal(custName({ first_name: 'สม', last_name: 'ชาย' }), 'สม ชาย');
  assert.equal(custName({}), '(ไม่มีชื่อ)');
});

test('hhmm: truncates a HH:MM:SS time column', () => {
  assert.equal(hhmm('09:30:00'), '09:30');
  assert.equal(hhmm(null), '');
});

test('todayISO: offsets by days', () => {
  const iso = todayISO(0);
  assert.match(iso, /^\d{4}-\d{2}-\d{2}$/);
});
```

- [ ] **Step 4: Run tests**

Run: `node --test lib/__tests__/format.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend-next/lib/format.js frontend-next/lib/constants.js frontend-next/lib/hooks.js frontend-next/lib/__tests__/format.test.js
git commit -m "Port format/constants/hooks helpers to frontend-next"
```

---

### Task 4: Port Toast, Confirm, and Meta providers

**Files:**
- Create: `frontend-next/components/Toast.jsx` (copy of `frontend/src/components/Toast.jsx`, add `'use client'`)
- Create: `frontend-next/components/Confirm.jsx` (copy of `frontend/src/components/Confirm.jsx`, add `'use client'`)
- Create: `frontend-next/contexts/MetaContext.jsx` (port of `frontend/src/api/meta.jsx`, import path updated)

**Interfaces:**
- Produces: `ToastProvider`, `useToast()` (`{ ok, err }`); `ConfirmProvider`, `useConfirm()`; `MetaProvider`, `useMeta()` (`{ meta, reload, ready, error }`), `useBookingLabels()`.

- [ ] **Step 1: Copy Toast and Confirm, adding `'use client'`**

Run:
```bash
cp frontend/src/components/Toast.jsx frontend-next/components/Toast.jsx
cp frontend/src/components/Confirm.jsx frontend-next/components/Confirm.jsx
```

Add `'use client';` as the first line of both files.

- [ ] **Step 2: Write `frontend-next/contexts/MetaContext.jsx`**

```jsx
'use client';
/**
 * /api/meta holds every dropdown the app needs — staff, case statuses,
 * suppliers, booking vocabulary. Fetched once at boot and shared through
 * context; reload() refreshes it after adding an employee or supplier.
 * Port of frontend/src/api/meta.jsx.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/apiClient.js';

const EMPTY = {
  lists: {}, employees: [], statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '', now: '',
};

const MetaContext = createContext({ meta: EMPTY, reload: async () => {}, ready: false, error: null });

export function MetaProvider({ children }) {
  const [meta, setMeta] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    const data = await api.get('/api/meta');
    setMeta({ ...EMPTY, ...data });
    return data;
  }, []);

  useEffect(() => {
    let alive = true;
    reload()
      .then(() => alive && setReady(true))
      .catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, [reload]);

  return (
    <MetaContext.Provider value={{ meta, reload, ready, error }}>
      {children}
    </MetaContext.Provider>
  );
}

export const useMeta = () => useContext(MetaContext);

export function useBookingLabels() {
  const { meta } = useMeta();
  const b = meta.booking || {};
  const of = (list, code) => ((list || []).find(([c]) => c === code) || [null, code])[1];
  return {
    serviceTypes: b.service_types || [],
    statuses: b.statuses || [],
    channels: b.channels || [],
    intakeQuestions: b.intake_questions || [],
    serviceLabel: (c) => of(b.service_types, c),
    statusLabel: (c) => of(b.statuses, c),
    channelLabel: (c) => of(b.channels, c),
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend-next/components/Toast.jsx frontend-next/components/Confirm.jsx frontend-next/contexts/MetaContext.jsx
git commit -m "Port Toast, Confirm, and Meta providers to frontend-next"
```

---

### Task 5: Port shared UI components (`ui.jsx`, `DataTable.jsx`, `Selects.jsx`, `Shell.jsx`)

**Files:**
- Create: `frontend-next/components/ui.jsx` (copy of `frontend/src/components/ui.jsx`, swap `react-router-dom`'s `Link` for `next/link`, add `'use client'`)
- Create: `frontend-next/components/DataTable.jsx` (copy of `frontend/src/components/DataTable.jsx`, add `'use client'`)
- Create: `frontend-next/components/Selects.jsx` (copy of `frontend/src/components/Selects.jsx`, update the `useMeta` import path, add `'use client'`)
- Create: `frontend-next/components/Shell.jsx` (port of `frontend/src/components/Shell.jsx` + the crumb logic from `frontend/src/App.jsx` — Next's file-based routing replaces the central `<Routes>` table, so `Shell` computes its own crumb from `usePathname()`)

**Interfaces:**
- Consumes: `contexts/MetaContext.jsx` (`useMeta`).
- Produces: `PageHead, Card, Field, Split, Stack, Row, Toolbar, FormGrid, FormActions, Badge, Empty, Loading, Kpi, Kpis, Fieldset, Check, Tabs, LinkTabs, OrderStatusBadge, PrintButton, Kv` (ui.jsx); `DataTable` (DataTable.jsx); `Select, EmployeeSelect, ListSelect, SupplierSelect, StatusSelect` (Selects.jsx); `Shell` (Shell.jsx).

- [ ] **Step 1: Write `frontend-next/components/ui.jsx`**

```jsx
'use client';
/** The small presentational pieces the pages are built from. Port of frontend/src/components/ui.jsx. */
import { Fragment } from 'react';
import Link from 'next/link';

export function PageHead({ icon, title, subtitle, actions = null }) {
  return (
    <div className="page-head">
      <div className="ph-icon">{icon}</div>
      <h1>{title}{subtitle ? <span>{subtitle}</span> : null}</h1>
      {actions ? <div className="ph-actions">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, badge, right, tight, children, className = '' }) {
  return (
    <div className={`card ${className}`}>
      {title || badge || right ? (
        <div className="card-head">
          {title ? <h2>{title}</h2> : null}
          {badge}
          {right ? <div className="right">{right}</div> : null}
        </div>
      ) : null}
      <div className={`card-body ${tight ? 'tight' : ''}`}>{children}</div>
    </div>
  );
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      <label>{label}</label>
      {children}
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export const Split = ({ children }) => <div className="split">{children}</div>;
export const Stack = ({ children, style }) => <div className="stack" style={style}>{children}</div>;
export const Row = ({ children, style }) => <div className="row" style={style}>{children}</div>;
export const Toolbar = ({ children, className = '' }) => (
  <div className={`toolbar ${className}`}>{children}</div>
);
export const FormGrid = ({ children, two = false }) => (
  <div className={`form-grid ${two ? 'two' : ''}`}>{children}</div>
);
export const FormActions = ({ children, style }) => (
  <div className="form-actions" style={style}>{children}</div>
);

export const Badge = ({ kind = '', children, style, title }) => (
  <span className={`badge ${kind}`} style={style} title={title}>{children}</span>
);

export const Empty = ({ children = 'ไม่มีข้อมูล' }) => <div className="empty">{children}</div>;

export const Loading = ({ text = 'กำลังโหลด…' }) => (
  <div className="loading"><span className="spin" /> {text}</div>
);

export function Kpi({ label, value, sub, kind = '' }) {
  return (
    <div className={`kpi ${kind}`}>
      <div className="k-label">{label}</div>
      <div className="k-value">{value}</div>
      {sub ? <div className="k-sub">{sub}</div> : null}
    </div>
  );
}

export const Kpis = ({ children }) => <div className="kpis">{children}</div>;

export function Fieldset({ legend, children }) {
  return <fieldset><legend>{legend}</legend>{children}</fieldset>;
}

export function Check({ name, checked, onChange, children, defaultChecked }) {
  return (
    <label className="check">
      <input type="checkbox" name={name} checked={checked} defaultChecked={defaultChecked} onChange={onChange} />
      {' '}{children}
    </label>
  );
}

export function Tabs({ names, active, onSelect }) {
  return (
    <div className="tabs">
      {names.map((n) => (
        <a
          key={n}
          href="#"
          className={n === active ? 'active' : ''}
          onClick={(e) => { e.preventDefault(); onSelect(n); }}
        >
          {n}
        </a>
      ))}
    </div>
  );
}

export function LinkTabs({ items, isActive }) {
  return (
    <div className="tabs">
      {items.map(([to, label]) => (
        <Link key={to} href={to} className={isActive(to) ? 'active' : ''}>{label}</Link>
      ))}
    </div>
  );
}

export function OrderStatusBadge({ order }) {
  if (Number(order.order_closed)) return <Badge kind="ok">ปิดการขายแล้ว</Badge>;
  const unfilled = !order.lens_product_id || !order.right_lens_product_id || !order.frame_product_id;
  return unfilled
    ? <Badge kind="warn">รอของ / ยังไม่เติม</Badge>
    : <Badge kind="blue">รอลูกค้ารับ</Badge>;
}

export const PrintButton = () => (
  <button type="button" className="btn btn-ghost no-print" onClick={() => window.print()}>
    🖨 พิมพ์
  </button>
);

export function Kv({ rows, style }) {
  return (
    <dl className="kv" style={style}>
      {rows.filter(Boolean).map(([k, v], i) => (
        <Fragment key={`${k}-${i}`}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
```

- [ ] **Step 2: Write `frontend-next/components/DataTable.jsx`**

```jsx
'use client';
/**
 * The one table the whole app uses. Port of frontend/src/components/DataTable.jsx.
 * columns: [{ label, key?, render?(row, i), cls?, }]
 */
import { Empty } from './ui.jsx';

export function DataTable({
  columns,
  rows,
  onRowClick = null,
  empty = 'ไม่มีข้อมูล',
  footer = null,
  rowKey = (row, i) => row?.id ?? i,
}) {
  if (!rows || !rows.length) return <Empty>{empty}</Empty>;

  return (
    <div className="table-wrap">
      <table className="grid">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={c.label + i} className={c.cls || ''}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              className={onRowClick ? 'clickable' : ''}
              onClick={(e) => {
                if (!onRowClick) return;
                if (e.target.closest('a,button,input,select,textarea')) return;
                onRowClick(row);
              }}
            >
              {columns.map((c, j) => (
                <td key={c.label + j} className={c.cls || ''}>
                  {c.render ? c.render(row, i) : (row[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Write `frontend-next/components/Selects.jsx`**

```jsx
'use client';
/** Dropdowns fed from /api/meta. Port of frontend/src/components/Selects.jsx. */
import { useMeta } from '../contexts/MetaContext.jsx';

export function Select({ name, options, value, defaultValue, onChange, ...rest }) {
  const norm = (options || []).map((o) => (Array.isArray(o) ? o : [o, o]));
  const controlled = value !== undefined;
  return (
    <select
      name={name}
      {...(controlled
        ? { value: value ?? '', onChange }
        : { defaultValue: defaultValue ?? '', onChange })}
      {...rest}
    >
      {norm.map(([v, label]) => (
        <option key={String(v)} value={v}>{label}</option>
      ))}
    </select>
  );
}

export function EmployeeSelect({ name, value, defaultValue, onChange, blank = '— เลือกพนักงาน —', ...rest }) {
  const { meta } = useMeta();
  const options = [['', blank], ...meta.employees.map((e) => [e.id, e.employee_name])];
  return (
    <Select name={name} options={options} value={value} defaultValue={defaultValue} onChange={onChange} {...rest} />
  );
}

export function ListSelect({ name, kind, value, defaultValue, onChange, blank = null, ...rest }) {
  const { meta } = useMeta();
  const options = [...(blank ? [['', blank]] : []), ...(meta.lists[kind] || [])];
  return (
    <Select name={name} options={options} value={value} defaultValue={defaultValue} onChange={onChange} {...rest} />
  );
}

export function SupplierSelect({ name, value, defaultValue, onChange, blank = '— ไม่ระบุ —', ...rest }) {
  const { meta } = useMeta();
  const options = [['', blank], ...(meta.suppliers || []).map((s) => [s.id, s.name])];
  return (
    <Select name={name} options={options} value={value} defaultValue={defaultValue} onChange={onChange} {...rest} />
  );
}

export function StatusSelect({ name, value, defaultValue, onChange, openOnly = false, ...rest }) {
  const { meta } = useMeta();
  const options = (meta.statuses || [])
    .filter((s) => !openOnly || !Number(s.is_terminal))
    .map((s) => [s.code, `${s.stage_no} ${s.label_th}`]);
  return (
    <Select name={name} options={options} value={value} defaultValue={defaultValue} onChange={onChange} {...rest} />
  );
}
```

- [ ] **Step 4: Write `frontend-next/components/Shell.jsx`**

```jsx
'use client';
/**
 * Sidebar + topbar frame around every page. Port of frontend/src/components/Shell.jsx,
 * absorbing the crumb-from-path logic that used to live in frontend/src/App.jsx
 * (Next's file-based routing replaced the central <Routes> table).
 */
import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  ['หน้าหลัก', [
    ['🏠', 'เมนูหลัก', '/'],
  ]],
  ['งานในร้าน', [
    ['📅', 'ปฏิทินจองคิว', '/bookings'],
    ['🗂', 'กระดานงาน', '/cases'],
    ['🔎', 'ติดตามเลนส์', '/lens-tracker'],
  ]],
  ['งานหน้าร้าน', [
    ['👥', 'ลูกค้า', '/customers'],
    ['👁', 'วัดสายตา', '/prescriptions'],
    ['👓', 'ออเดอร์ตัดแว่น', '/orders'],
    ['🛍', 'ขายสินค้า', '/sales'],
  ]],
  ['คลังสินค้า', [
    ['📦', 'สต็อกสินค้า', '/stock'],
    ['📍', 'ตำแหน่งสินค้า', '/locations'],
  ]],
  ['การเงิน', [
    ['💰', 'รายรับ', '/income'],
    ['💸', 'รายจ่าย', '/expense'],
  ]],
  ['ข้อมูลระบบ', [
    ['🧑‍💼', 'พนักงาน', '/employees'],
    ['🏭', 'ซัพพลายเออร์', '/suppliers'],
    ['📊', 'รายงาน', '/reports'],
    ['⚙️', 'ตั้งค่า/แจ้งเตือน', '/settings'],
  ]],
];

/** path -> breadcrumb, matched longest-first. Detail/edit pages under a
    domain (e.g. /customers/detail?id=5) still match their domain's '/customers'
    entry, since the id lives in the query string, not the path. */
const TITLES = [
  ['/', 'เมนูหลัก'],
  ['/customers/new', 'ลูกค้าใหม่'],
  ['/customers/detail', 'รายละเอียดลูกค้า'],
  ['/customers/edit', 'แก้ไขลูกค้า'],
  ['/customers', 'ลูกค้า'],
  ['/prescriptions/new', 'บันทึกการวัดสายตา'],
  ['/prescriptions', 'วัดสายตา'],
  ['/bookings/new', 'จองคิวใหม่'],
  ['/bookings', 'ปฏิทินจองคิว'],
  ['/settings', 'ตั้งค่า/แจ้งเตือน'],
  ['/cases/new', 'เปิดเคสใหม่'],
  ['/cases', 'กระดานงาน'],
  ['/lens-tracker', 'ติดตามเลนส์'],
  ['/employees', 'พนักงาน'],
  ['/orders/new', 'เปิดออเดอร์ใหม่'],
  ['/orders', 'ออเดอร์ตัดแว่น'],
  ['/sales/new', 'ขายสินค้าทั่วไป'],
  ['/sales', 'ขายสินค้า'],
  ['/stock/new', 'เพิ่มสินค้าเข้าคลัง'],
  ['/stock', 'สต็อกสินค้า'],
  ['/locations', 'ตำแหน่งสินค้า'],
  ['/suppliers', 'ซัพพลายเออร์'],
  ['/income', 'รายรับ'],
  ['/expense', 'รายจ่าย'],
  ['/reports/daily', 'สรุปรายวัน'],
  ['/reports/monthly', 'รายรับรายเดือน'],
  ['/reports/checklist', 'เช็คลิสต์สต็อก'],
  ['/reports/labels', 'พิมพ์ป้ายราคา'],
  ['/reports/unsold', 'สินค้าค้างสต็อก'],
  ['/reports', 'รายงาน'],
  ['/print/order', 'ใบสั่งตัดแว่น'],
  ['/print/prescription', 'ใบวัดสายตา'],
];

export function crumbFor(pathname) {
  if (pathname === '/') return 'เมนูหลัก';
  const hit = TITLES
    .filter(([p]) => p !== '/' && (pathname === p || pathname.startsWith(p + '/')))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? hit[1] : 'TimeOptic';
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  const p = (n) => String(n).padStart(2, '0');
  return (
    <span id="clock">
      {`${p(now.getDate())}/${p(now.getMonth() + 1)}/${now.getFullYear()}  ${p(now.getHours())}:${p(now.getMinutes())}`}
    </span>
  );
}

export function Shell({ children }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const crumb = crumbFor(pathname);

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    document.title = `${crumb} — TimeOptic`;
    window.scrollTo(0, 0);
  }, [crumb, pathname]);

  const base = '/' + (pathname.split('/')[1] || '');

  return (
    <div className="app" id="app">
      <aside className={`sidebar ${open ? 'open' : ''}`} id="sidebar">
        <div className="brand">
          <span className="brand-mark">◎◎</span>
          <span className="brand-text"><b>TimeOptic</b><small>ระบบจัดการร้านแว่นตา</small></span>
        </div>
        <nav id="nav">
          {NAV.map(([group, items]) => (
            <Fragment key={group}>
              <div className="nav-group">{group}</div>
              {items.map(([icon, label, to]) => (
                <Link key={to} href={to} className={to === base ? 'active' : ''}>
                  <span className="ic">{icon}</span>{label}
                </Link>
              ))}
            </Fragment>
          ))}
        </nav>
        <div className="sidebar-foot"><Clock /></div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn"
            id="menu-toggle"
            title="เมนู"
            aria-label="เมนู"
            onClick={() => setOpen((v) => !v)}
          >
            ☰
          </button>
          <div className="crumb" id="crumb">{crumb}</div>
          <div className="spacer" />
          <Link className="btn btn-ghost" href="/">🏠 เมนูหลัก</Link>
        </header>
        <div className="content" id="view">{children}</div>
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend-next/components/ui.jsx frontend-next/components/DataTable.jsx frontend-next/components/Selects.jsx frontend-next/components/Shell.jsx
git commit -m "Port shared UI components (ui, DataTable, Selects, Shell) to frontend-next"
```

---

### Task 6: Wire the root layout (providers + Shell)

**Files:**
- Create: `frontend-next/app/providers.jsx`
- Modify: `frontend-next/app/layout.jsx`

**Interfaces:**
- Consumes: `ToastProvider`, `ConfirmProvider`, `MetaProvider`, `Shell`.
- Produces: every `app/**/page.jsx` automatically renders inside the sidebar/topbar chrome with toast/confirm/meta available via `useToast()`/`useConfirm()`/`useMeta()`.

- [ ] **Step 1: Write `frontend-next/app/providers.jsx`**

```jsx
'use client';
import { ToastProvider } from '../components/Toast.jsx';
import { ConfirmProvider } from '../components/Confirm.jsx';
import { MetaProvider } from '../contexts/MetaContext.jsx';
import { Shell } from '../components/Shell.jsx';

export function Providers({ children }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <MetaProvider>
          <Shell>{children}</Shell>
        </MetaProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
```

- [ ] **Step 2: Update `frontend-next/app/layout.jsx` to use it**

```jsx
import './globals.css';
import { Providers } from './providers.jsx';

export const metadata = {
  title: 'TimeOptic — ระบบจัดการร้านแว่นตา',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>👓</text></svg>",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Run the dev server and verify the shell renders**

Run (from `frontend-next/`): `npm run dev`, open `http://localhost:3000`.
Expected: sidebar + topbar render around the placeholder page text. The meta fetch will fail with a visible error state (PHP API isn't running yet in this check, or CORS isn't updated until Task 7) — that's expected at this point, not a bug to fix here.

- [ ] **Step 4: Commit**

```bash
git add frontend-next/app/providers.jsx frontend-next/app/layout.jsx
git commit -m "Wire frontend-next root layout with providers and Shell"
```

---

### Task 7: Allow the Next dev server to call the PHP API (CORS)

**Files:**
- Modify: `api/config.php`

**Interfaces:** none new — this only widens `Http::cors()`'s allow-list, already consumed by `api/index.php`.

- [ ] **Step 1: Read `api/config.php` and add the Next dev origin**

Find the `cors_origins` array (currently `['http://localhost:5173', 'http://127.0.0.1:5173']`) and add the Next.js dev server's default origin:

```php
'cors_origins' => [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
],
```

- [ ] **Step 2: Verify the PHP API still boots and serves the existing Vite app unaffected**

Run: `start-api.bat` (or `php -S 127.0.0.1:8080 api/router.php` if that's what the batch file wraps), then `curl http://127.0.0.1:8080/api/meta`.
Expected: same JSON response as before this change — adding an allowed origin doesn't change behavior for requests from origins already on the list, or with no `Origin` header (like `curl`).

- [ ] **Step 3: Commit**

```bash
git add api/config.php
git commit -m "Allow the Next.js dev server origin in the PHP API's CORS allow-list"
```

---

### Task 8: Page pilot — Dashboard (`/`) and Employees (`/employees`)

**Files:**
- Modify: `frontend-next/app/page.jsx` (replace the Task 1 placeholder with the real Dashboard)
- Create: `frontend-next/app/employees/page.jsx`

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js` (`useAsync`), `contexts/MetaContext.jsx` (`useMeta`), `components/ui.jsx`, `components/DataTable.jsx`, `components/Selects.jsx`, `lib/constants.js` (`stageInfo`), `lib/format.js`.

- [ ] **Step 1: Write `frontend-next/app/page.jsx`** (port of `frontend/src/pages/Dashboard.jsx`; `react-router-dom`'s `Link`/`useNavigate` swapped for `next/link`/`next/navigation`)

```jsx
'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../lib/apiClient.js';
import { useAsync } from '../lib/hooks.js';
import { Badge, Card, Kpi, Kpis, Loading, PageHead } from '../components/ui.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { stageInfo } from '../lib/constants.js';
import { count, custName, fmtDate, fmtDateTime, hhmm, money, moneyShort } from '../lib/format.js';

const TILES = [
  ['📅', 'ปฏิทินจองคิว', 'Queue Booking', '/bookings'],
  ['➕', 'จองคิวใหม่', 'New Booking', '/bookings/new'],
  ['🗂', 'กระดานงาน', 'Case Board', '/cases'],
  ['➕', 'เปิดเคสใหม่', 'New Case', '/cases/new'],
  ['👥', 'ลูกค้าใหม่', 'New Customer', '/customers/new'],
  ['👁', 'วัดสายตา', 'Prescription', '/prescriptions/new'],
  ['👓', 'เปิดออเดอร์ตัดแว่น', 'Custom Order', '/orders/new'],
  ['🔎', 'ติดตามเลนส์', 'Lens Tracker', '/lens-tracker'],
  ['🛍', 'ขายสินค้าทั่วไป', 'Product Sale', '/sales/new'],
  ['📦', 'เพิ่มสินค้าเข้าคลัง', 'Add to Stock', '/stock/new'],
  ['📜', 'ประวัติการสั่งซื้อ', 'Order History', '/orders'],
  ['💸', 'รายจ่าย', 'Expense', '/expense'],
  ['💰', 'รายรับ', 'Income', '/income'],
  ['📊', 'รายงาน', 'Reports', '/reports'],
];

function MinsAway({ value }) {
  const m = Number(value);
  if (!Number.isFinite(m)) return null;
  if (m < -5) return <span className="muted">ผ่านไปแล้ว</span>;
  if (m < 0) return <Badge kind="warn">ถึงเวลาแล้ว</Badge>;
  return <Badge kind={m <= 15 ? 'danger' : m <= 60 ? 'warn' : 'gray'}>{m} นาที</Badge>;
}

export default function Home() {
  const router = useRouter();
  const { data: d, error, loading } = useAsync(() => api.get('/api/dashboard'), []);

  if (loading) return <Loading />;
  if (error) {
    return (
      <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>
    );
  }

  const s = d.stats;
  const stages = Object.entries(d.board || {});
  const bookings = d.bookings_today || [];

  const orderCols = [
    { label: 'วันที่สั่ง', render: (o) => fmtDateTime(o.order_date), cls: 'nowrap' },
    { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
    { label: 'ลูกค้า', render: custName },
    { label: 'พนักงาน', render: (o) => o.employee_name || '-' },
    { label: 'เลนส์', render: (o) => o.lens_name || '-' },
    { label: 'กรอบ', render: (o) => o.frame_name || '-' },
    { label: 'นัดรับ', render: (o) => fmtDate(o.appointment_date), cls: 'nowrap' },
    { label: 'ยอดรวม', render: (o) => money(o.total_price), cls: 'num' },
    { label: 'คงเหลือ', render: (o) => money(o.balance), cls: 'num' },
  ];

  return (
    <div>
      <PageHead
        icon="👓"
        title="Main Menu"
        subtitle="เมนูหลัก"
        actions={(
          <>
            <Link className="btn btn-ghost" href="/cases">🗂 กระดานงาน</Link>
            <Link className="btn btn-ghost" href="/reports/daily">📅 สรุปรายวัน</Link>
          </>
        )}
      />

      <Kpis>
        <Kpi kind="ok" label="รับเงินวันนี้" value={moneyShort(s.received_today.amount)} sub={`${s.received_today.n} รายการ`} />
        <Kpi kind="accent" label="ขายสินค้าวันนี้" value={moneyShort(s.sales_today.amount)} sub={`${s.sales_today.n} รายการ`} />
        <Kpi kind="danger" label="รายจ่ายวันนี้" value={moneyShort(s.expense_today.amount)} sub="Expense" />
        <Kpi
          kind="warn"
          label="เคสที่ยังไม่จบ"
          value={String(s.open_cases)}
          sub={s.rush_cases ? `ด่วน ${s.rush_cases} เคส 🔥` : 'ทั้งร้าน'}
        />
        <Kpi kind="warn" label="รอเลนส์มา" value={String(s.lens_waiting)} sub="Waiting arrival" />
        <Kpi
          kind="accent"
          label="คิวจองวันนี้"
          value={String(s.bookings_today ?? 0)}
          sub={`ยังไม่มา ${s.bookings_pending ?? 0} คิว`}
        />
        <Kpi label="นัดรับแว่นวันนี้" value={String(s.appointments_today)} sub="Appointment" />
        <Kpi label="สินค้าคงคลัง" value={count(s.stock_on_hand)} sub="ชิ้น" />
        <Kpi label="ลูกค้าทั้งหมด" value={count(s.customers)} sub="คน" />
      </Kpis>

      {stages.length > 0 && (
        <Card title="งานค้างแต่ละขั้นตอน">
          <div className="row" style={{ gap: 10 }}>
            {stages.map(([g, n]) => {
              const info = stageInfo(g);
              return (
                <Link
                  key={g}
                  href={`/cases?stage=${g}`}
                  style={{
                    display: 'flex', gap: 9, alignItems: 'center', padding: '10px 15px',
                    borderRadius: 9, background: `${info.color}14`, color: info.color,
                    fontWeight: 700, textDecoration: 'none',
                  }}
                >
                  {`${info.icon} ${info.label}`}
                  <span className="badge" style={{ background: info.color, color: '#fff' }}>{n}</span>
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      <Card
        title="คิวจองวันนี้ — Today's Queue"
        tight
        badge={<Badge kind="blue">{bookings.length}</Badge>}
        right={<Link className="btn btn-sm btn-light" href="/bookings">ดูปฏิทิน</Link>}
      >
        <DataTable
          columns={[
            { label: 'เวลา', cls: 'nowrap', render: (b) => <b>{hhmm(b.booking_time)}</b> },
            { label: 'อีก', cls: 'num', render: (b) => <MinsAway value={b.mins_away} /> },
            { label: 'รหัส', key: 'booking_code', cls: 'mono' },
            { label: 'ลูกค้า', render: (b) => [b.first_name, b.last_name].filter(Boolean).join(' ') || '(ไม่ระบุ)' },
            { label: 'เบอร์โทร', key: 'phone', cls: 'nowrap' },
            { label: 'ผู้ดูแล', key: 'assigned_name' },
            { label: 'สถานะ', key: 'status' },
            {
              label: 'แจ้งเตือน',
              render: (b) => (b.reminder_sent_at
                ? <Badge kind="ok">🔔 ส่งแล้ว</Badge>
                : <span className="muted">{`ก่อน ${b.reminder_minutes} น.`}</span>),
            },
            { label: 'บันทึกเบื้องต้น', render: (b) => (b.intake_note || '').slice(0, 70) },
          ]}
          rows={bookings}
          onRowClick={(b) => router.push(`/bookings/detail?id=${b.id}`)}
          empty="วันนี้ยังไม่มีคิวจอง"
        />
      </Card>

      <div className="tiles" style={{ marginBottom: 20 }}>
        {TILES.map(([ic, th, en, to]) => (
          <Link key={to + th} className="tile" href={to}>
            <span className="t-ic">{ic}</span>
            <span><b>{th}</b><small>{en}</small></span>
          </Link>
        ))}
      </div>

      <Card
        title="ออเดอร์ว่าง — Unfilled Orders (ยังไม่ได้เติมเลนส์/กรอบ)"
        tight
        badge={<Badge kind="warn">{d.unfilled.length}</Badge>}
      >
        <DataTable
          columns={orderCols}
          rows={d.unfilled}
          onRowClick={(o) => router.push(`/orders/detail?id=${o.id}`)}
          empty="ไม่มีออเดอร์ที่รอของ 🎉"
        />
      </Card>

      <Card
        title="ออเดอร์ที่ยังไม่ปิดการขาย — Unclosed Orders (ของครบ รอลูกค้ารับ)"
        tight
        badge={<Badge kind="blue">{d.unclosed.length}</Badge>}
      >
        <DataTable
          columns={orderCols}
          rows={d.unclosed}
          onRowClick={(o) => router.push(`/orders/detail?id=${o.id}`)}
          empty="ไม่มีออเดอร์รอรับ"
        />
      </Card>
    </div>
  );
}
```

Note: `onRowClick` targets now use `/bookings/detail?id=` and `/orders/detail?id=` per the spec's query-string convention, even though those pages don't exist yet (they land in the `bookings`/`orders` domain plans) — this file doesn't need to change again when those plans land.

- [ ] **Step 2: Write `frontend-next/app/employees/page.jsx`** (port of `frontend/src/pages/EmployeeList.jsx` — only the import paths change)

```jsx
'use client';
import { api } from '../../lib/apiClient.js';
import { useAsync, onSubmit } from '../../lib/hooks.js';
import { useMeta } from '../../contexts/MetaContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import { Badge, Card, Field, FormActions, FormGrid, Loading, PageHead } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { ListSelect } from '../../components/Selects.jsx';
import { fmtDate } from '../../lib/format.js';

export default function EmployeeList() {
  const { reload: reloadMeta } = useMeta();
  const { ok, err } = useToast();
  const { data: rows, loading, reload } = useAsync(() => api.get('/api/employees'), []);

  const add = async (body, form) => {
    try {
      await api.post('/api/employees', body);
      await reloadMeta();
      ok('เพิ่มพนักงานแล้ว');
      form.reset();
      reload();
    } catch (ex) {
      err(ex);
    }
  };

  const toggle = async (r) => {
    try {
      await api.put('/api/employees/' + r.id, { ...r, active: Number(r.active) ? 0 : 1 });
      await reloadMeta();
      reload();
    } catch (ex) {
      err(ex);
    }
  };

  if (loading) return <Loading />;

  return (
    <>
      <PageHead icon="🧑‍💼" title="Employee" subtitle="พนักงาน" />

      <div className="card">
        <div className="card-head"><h2>เพิ่มพนักงานใหม่</h2></div>
        <form className="card-body" onSubmit={onSubmit(add)}>
          <FormGrid>
            <Field label="ชื่อเล่น / Nickname *"><input name="employee_name" required /></Field>
            <Field label="ชื่อจริง"><input name="first_name" /></Field>
            <Field label="นามสกุล"><input name="last_name" /></Field>
            <Field label="เพศ"><ListSelect name="sex" kind="sex" defaultValue="Female" /></Field>
            <Field label="วันเกิด"><input name="birth_date" type="date" /></Field>
            <Field label="หน้าที่ / Roles">
              <input name="roles" placeholder="เช่น sales, optometrist, technician" />
            </Field>
          </FormGrid>
          <FormActions>
            <button className="btn" type="submit">✔ เพิ่มพนักงาน</button>
          </FormActions>
        </form>
      </div>

      <Card title="รายชื่อพนักงาน" tight>
        <DataTable
          columns={[
            { label: 'ID', key: 'id', cls: 'mono' },
            { label: 'ชื่อเล่น', key: 'employee_name' },
            { label: 'ชื่อจริง', key: 'first_name' },
            { label: 'นามสกุล', key: 'last_name' },
            { label: 'เพศ', key: 'sex' },
            { label: 'หน้าที่', key: 'roles' },
            { label: 'วันเกิด', render: (r) => fmtDate(r.birth_date), cls: 'nowrap' },
            {
              label: 'สถานะ',
              render: (r) => (Number(r.active)
                ? <Badge kind="ok">ทำงานอยู่</Badge>
                : <Badge kind="gray">ลาออก</Badge>),
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
          empty="ยังไม่มีพนักงาน"
        />
      </Card>
    </>
  );
}
```

- [ ] **Step 3: Manually verify against the real PHP API + MariaDB**

Make sure XAMPP's MySQL is running, then start both: `start-api.bat` (PHP on :8080) and, from `frontend-next/`, `npm run dev` (Next on :3000).

Open `http://localhost:3000/` and `http://localhost:3000/employees` in a browser. Compare against the still-running Vite app at `http://localhost:5173/#/` and `http://localhost:5173/#/employees` (via `start-web.bat`) — same data (they hit the same PHP API + database), same layout, same KPI numbers. Add a test employee via the Next.js page's form and confirm it appears in both apps after reload (proves the write path works end-to-end against the real API).

- [ ] **Step 4: Commit**

```bash
git add frontend-next/app/page.jsx frontend-next/app/employees/page.jsx
git commit -m "Port Dashboard and Employees pages to frontend-next"
```

---

### Task 9: Verify in-browser at all three required breakpoints

**Files:** none (verification only).

- [ ] **Step 1: Start both servers**

XAMPP's MySQL running, `start-api.bat` running (PHP on :8080), and `npm run dev` from `frontend-next/` (Next on :3000).

- [ ] **Step 2: Launch Chrome headless with remote debugging**

Run: `"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --remote-debugging-port=9222 --disable-gpu` (adjust the path if Chrome is installed elsewhere) as a background process.

- [ ] **Step 3: For each of the three required sizes, load `/` and `/employees`, screenshot, and inspect**

Sizes: **1920×1080**, **810×1080** (iPad portrait), **1080×810** (iPad landscape).

For each size: connect over the DevTools Protocol WebSocket, call `Emulation.setDeviceMetricsOverride` with that width/height, navigate to `http://localhost:3000/` (then `/employees`), call `Page.captureScreenshot`, and save/view the PNG.

Expected, at every size:
- Layout matches the Vite app (`http://localhost:5173`) at the same size.
- The ☰ menu button is not obscured by the sidebar drawer at 810×1080 — verify with `document.elementFromPoint()` at the button's center coordinates and confirm it resolves to the button itself, not the drawer.
- No horizontal scroll on the page body at any of the three sizes.
- Dashboard KPI cards and both order tables render without overflow; Employees page form and table are usable (inputs reachable, add button visible) at all three sizes.

- [ ] **Step 4: Fix anything that fails, then re-screenshot until all three sizes pass**

This is a real check, not a formality — if `app/globals.css` behaves differently under Next's rendering than it did under Vite (e.g., a CSS ordering or specificity difference), fix it in `frontend-next/app/globals.css` now rather than deferring.

- [ ] **Step 5: Kill the headless Chrome process and both dev servers**

- [ ] **Step 6: Commit any fixes made in Step 4**

```bash
git add frontend-next/app/globals.css
git commit -m "Fix responsive layout issues found during breakpoint verification"
```

(Skip this commit if Step 4 required no changes.)

---

## Self-Review Notes

- **Spec coverage:** static export config (Task 1), `NEXT_PUBLIC_API_ORIGIN` prefixing (Task 2), file-based routing + query-string id convention documented for later plans (Task 5's `Shell`/`TITLES`, Task 8's `onRowClick` links), CORS's one-line PHP change (Task 7), no-SSR client-fetch pattern preserved (Task 8). The stock/locations/suppliers, income/expense, reports, and print domains aren't in Foundation — they get their own plans, per the spec's migration approach.
- **Placeholder scan:** no TBDs; every step has runnable code or an exact shell command.
- **Type/name consistency:** `lib/apiClient.js` exports `api` with `get/post/put/del`, imported with that exact name everywhere (`MetaContext.jsx`, `Dashboard`, `EmployeeList`). `components/Shell.jsx`'s `crumbFor` is exported (not just used internally) in case a later domain plan needs to extend `TITLES` and wants to unit test the lookup — matches the pattern already established.
- **Scope:** this plan covers Foundation only — scaffold, shared lib/components, providers, CORS, and the `/` + `/employees` pilot. Each business domain (bookings, cases, customers, prescriptions, orders, stock/locations/suppliers, sales/cashflow, reports, settings) gets its own plan, written just before it's executed, following the query-string id convention and the interfaces this plan produces.

---

## After Foundation

Once this plan is executed and verified, the next plan is **cases** (case board + case detail + workflow sub-tables), since `bookings`, `orders`, and the already-ported `Dashboard` all link to case data — porting it early keeps later domain plans from linking to a page that doesn't exist yet.
