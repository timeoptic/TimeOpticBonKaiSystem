# Next.js Foundation Implementation Plan

> **STATUS: SUPERSEDED.** This plan implemented a Next.js app that replaced
> the PHP backend (`app/api/*` routes talking to MariaDB directly). The user
> narrowed scope afterward: keep `api/` (PHP) and MariaDB as-is, port only
> the frontend to Next.js. No task in this plan was executed. See
> `docs/superpowers/plans/2026-08-25-nextjs-frontend-foundation.md` instead.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a single Next.js (App Router) app at the repo root that owns both UI and API, port every shared/core module (DB access, helpers, SQL fragments, lookups, booking vocabulary, shared UI components, providers), and prove the whole pattern end-to-end with one pilot vertical slice (`/` Dashboard + `/employees`) reading and writing the real MariaDB `timeoptic` database.

**Architecture:** `mysql2/promise` pool in `lib/db.js` replaces `api/core/Db.php` (PDO). Next.js file-based `app/api/*/route.js` handlers replace `api/index.php` + `api/core/Router.php` + `api/routes/*.php`, wrapped by a shared `lib/apiRoute.js` error handler that mirrors `api/index.php`'s try/catch → JSON envelope. Client-side pages stay a fetch-driven SPA-in-Next pattern (each page is a Client Component calling `lib/apiClient.js`), matching the existing app's data-fetching style — no server components fetching data, so the port is behavior-preserving rather than a redesign.

**Tech Stack:** Next.js 15 (App Router), React 19.2.8, react-dom 19.2.8, mysql2 ^3.23.4 (already a root dependency), Node's built-in `node:test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-08-25-nextjs-monorepo-migration-design.md`

## Global Constraints

- No changes to the MariaDB schema (27 tables + 7 views) — every port reads/writes the same tables the PHP version does.
- Behavior-preserving port, not a redesign — page layout, copy, and API response shapes stay identical to what `api/routes/*.php` and `frontend/src/pages/*.jsx` produce today.
- DB config comes from `.env` at repo root via the same variable names as today: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` (Next.js loads `.env` automatically — no hand-rolled parser needed).
- UI must work at three breakpoints: **1920×1080** (desktop), **810×1080** (iPad portrait), **1080×810** (iPad landscape). Verify with Chrome headless DevTools Protocol screenshots before marking any page task done — do not eyeball the code and assume.
- Legacy `api/`, `frontend/`, `lib/`, `public/`, `server.js` are **not deleted** in this plan — they stay as the live reference implementation until every domain is ported in later plans.

---

## File Structure

```
timeoptic-web/
├── app/
│   ├── layout.jsx              root layout: <html lang="th">, metadata/favicon, imports globals.css
│   ├── globals.css              copy of frontend/src/styles/app.css
│   ├── providers.jsx             'use client' — wraps children in Toast/Confirm/Meta providers
│   ├── page.jsx                  Dashboard (pilot page)
│   ├── employees/
│   │   └── page.jsx              EmployeeList (pilot page)
│   └── api/
│       ├── meta/route.js
│       ├── dashboard/route.js
│       └── employees/
│           ├── route.js          GET, POST
│           └── [id]/route.js     PUT
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
│   ├── config.js                  db + telegram config from process.env
│   ├── db.js                      mysql2 pool: all/get/run/tx/verifyConnection
│   ├── httpError.js               HttpError, bad(), missing()
│   ├── apiRoute.js                withRoute() wrapper + readJsonBody()
│   ├── helpers.js                 num/intOr/strOr/nul/boolInt/like/round2/nowStamp/today/invoiceCode/nextCode/sumCol/sumBy
│   ├── sql.js                     Sql constants + logEvent + setStatus + upsertFactory
│   ├── lookups.js                 lists(), caseStatuses()
│   ├── booking.js                 SERVICE_TYPES/STATUSES/CHANNELS/INTAKE_QUESTIONS + serviceLabel + shape
│   ├── format.js                  copy of frontend/src/lib/format.js
│   ├── constants.js                copy of frontend/src/lib/constants.js
│   ├── hooks.js                   copy of frontend/src/lib/hooks.js + 'use client'
│   ├── apiClient.js                copy of frontend/src/api/client.js
│   └── __tests__/
│       ├── helpers.test.js
│       ├── format.test.js
│       ├── httpError.test.js
│       └── booking.test.js
├── package.json                   add next/react/react-dom deps + dev/build/start scripts
└── next.config.js
```

**Interfaces every later domain plan (bookings, cases, customers, orders, …) will rely on:**

- `lib/db.js` exports `all(sql, ...params)`, `get(sql, ...params)`, `run(sql, ...params)`, `tx(fn)`, `verifyConnection()`.
- `lib/httpError.js` exports `HttpError`, `bad(msg)`, `missing(msg?)`.
- `lib/apiRoute.js` exports `withRoute(handler)` where `handler({ params, query, body })` returns the JSON payload (or throws `HttpError`).
- `lib/helpers.js` exports `num, intOr, strOr, nul, boolInt, like, round2, nowStamp, today, invoiceCode, nextCode, sumCol, sumBy`.
- `lib/sql.js` exports `Sql` (object with `ORDER_SELECT, ORDER_FROM, UNFILLED, BOOKING_SELECT, BOOKING_FROM`), `logEvent(tx, caseId, fields)`, `setStatus(tx, caseId, toStatus, opt)`, `upsertFactory(spec)`.
- `lib/lookups.js` exports `lists()`, `caseStatuses()` (both async, hit the DB).
- `lib/booking.js` exports `SERVICE_TYPES, STATUSES, CHANNELS, INTAKE_QUESTIONS, STATUS_CODES, serviceLabel(code), shape(booking)`.
- `contexts/MetaContext.jsx` exports `MetaProvider`, `useMeta()` (`{ meta, reload, ready, error }`), `useBookingLabels()`.
- `components/ui.jsx`, `DataTable.jsx`, `Selects.jsx` export the same names as today's `frontend/src/components` equivalents — later plans import from `@/components/...` instead of relative `../components/...`.

---

### Task 1: Scaffold the Next.js app

**Files:**
- Modify: `package.json` (repo root)
- Create: `next.config.js`
- Create: `app/layout.jsx`
- Create: `app/globals.css` (copy of `frontend/src/styles/app.css`)
- Create: `app/page.jsx` (temporary placeholder, replaced in Task 15)

**Interfaces:**
- Produces: a running `next dev` server at `http://localhost:3000` rendering `app/layout.jsx` → `app/page.jsx`.

- [ ] **Step 1: Install Next.js and React into the root package.json**

Read the current root `package.json` first (it has `mysql2` as a dependency and `server.js` scripts for the legacy Node app — keep both, the legacy app stays runnable). Add:

```json
{
  "dependencies": {
    "mysql2": "^3.23.4",
    "next": "^15.5.0",
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "node --test lib/__tests__",
    "dev:legacy": "node --env-file-if-exists=.env --watch server.js",
    "start:legacy": "node --env-file-if-exists=.env server.js"
  }
}
```

Run: `npm install`
Expected: installs without errors; `node_modules/next` exists.

- [ ] **Step 2: Create `next.config.js`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = nextConfig;
```

- [ ] **Step 3: Copy the existing stylesheet into `app/globals.css`**

Run: `cp frontend/src/styles/app.css app/globals.css`

- [ ] **Step 4: Create `app/layout.jsx`**

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

- [ ] **Step 5: Create a placeholder `app/page.jsx`**

```jsx
export default function Home() {
  return <p>TimeOptic Next.js foundation — scaffold OK</p>;
}
```

- [ ] **Step 6: Run the dev server and verify it boots**

Run: `npm run dev` (background), then check `http://localhost:3000` returns 200 and contains "scaffold OK".
Expected: page loads with no console errors. Stop the dev server after confirming.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json next.config.js app/layout.jsx app/globals.css app/page.jsx
git commit -m "Scaffold Next.js app at repo root"
```

---

### Task 2: Port pure helpers (`lib/helpers.js`)

**Files:**
- Create: `lib/helpers.js`
- Test: `lib/__tests__/helpers.test.js`

**Interfaces:**
- Produces: `num, intOr, strOr, nul, boolInt, like, round2, nowStamp, today, invoiceCode, nextCode, sumCol, sumBy` — same signatures as `api/core/Helpers.php`, ported to JS. `nextCode` depends on `lib/db.js` (Task 3) — write it now with the import, it isn't tested until Task 3 lands.

- [ ] **Step 1: Write the failing tests for the pure functions**

```javascript
// lib/__tests__/helpers.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { num, intOr, strOr, nul, boolInt, like, round2, sumCol, sumBy } from '../helpers.js';

test('num: fallback on empty/non-numeric, otherwise the number', () => {
  assert.equal(num(''), 0);
  assert.equal(num(null), 0);
  assert.equal(num('abc'), 0);
  assert.equal(num('12.5'), 12.5);
  assert.equal(num(undefined, 9), 9);
});

test('intOr: parses leading digits like parseInt, else default', () => {
  assert.equal(intOr('12abc'), 12);
  assert.equal(intOr(''), null);
  assert.equal(intOr(null, 5), 5);
  assert.equal(intOr(true), 1);
  assert.equal(intOr(false), 0);
  assert.equal(intOr('7'), 7);
});

test('strOr: trims, defaults on null/array', () => {
  assert.equal(strOr('  hi  '), 'hi');
  assert.equal(strOr(null, 'd'), 'd');
  assert.equal(strOr(true), '1');
});

test('nul: empty string becomes null', () => {
  assert.equal(nul(''), null);
  assert.equal(nul('  x '), 'x');
});

test('boolInt: truthy forms become 1', () => {
  assert.equal(boolInt(true), 1);
  assert.equal(boolInt('1'), 1);
  assert.equal(boolInt('true'), 1);
  assert.equal(boolInt('on'), 1);
  assert.equal(boolInt('0'), 0);
  assert.equal(boolInt(false), 0);
});

test('like: wraps for LIKE and escapes wildcards', () => {
  assert.equal(like('abc'), '%abc%');
  assert.equal(like('50%_off'), '%50\\%\\_off%');
});

test('round2: rounds to 2dp, falsy becomes 0', () => {
  assert.equal(round2(1.005), 1);
  assert.equal(round2(null), 0);
  assert.equal(round2(3.14159), 3.14);
});

test('sumCol: sums a numeric key across rows', () => {
  assert.equal(sumCol([{ n: 1 }, { n: '2.5' }, {}], 'n'), 3.5);
});

test('sumBy: groups and sums, blank key becomes "-"', () => {
  const rows = [{ k: 'a', amt: 1 }, { k: 'a', amt: 2 }, { k: '', amt: 3 }];
  assert.deepEqual(sumBy(rows, 'k', (r) => r.amt), { a: 3, '-': 3 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/__tests__/helpers.test.js`
Expected: FAIL — `lib/helpers.js` does not exist yet.

- [ ] **Step 3: Write `lib/helpers.js`**

```javascript
/**
 * Value coercion + date/code helpers.
 * Port of api/core/Helpers.php — same semantics, so route code reads the same.
 */
import { get } from './db.js';

export function num(v, d = 0) {
  if (v === '' || v === null || v === undefined || Number.isNaN(Number(v))) return d;
  return Number(v);
}

export function intOr(v, d = null) {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (v === null || v === undefined || v === '' || Array.isArray(v)) return d;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v);
  const m = s.match(/^\s*[-+]?\d+/);
  if (m) return parseInt(m[0], 10);
  return d;
}

export function strOr(v, d = '') {
  if (v === null || v === undefined || Array.isArray(v)) return d;
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v).trim();
}

export function nul(v) {
  const s = strOr(v);
  return s === '' ? null : s;
}

export function boolInt(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0;
}

/** Wrap a term for LIKE, escaping the wildcards. */
export function like(q) {
  let s = String(q ?? '').trim();
  s = s.replaceAll('\\', '\\\\');
  s = s.replaceAll('%', '\\%').replaceAll('_', '\\_');
  return `%${s}%`;
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** 'YYYY-MM-DD HH:mm:ss' for right now (Asia/Bangkok — set via TZ or formatted manually). */
export function nowStamp(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function today() {
  return nowStamp().slice(0, 10);
}

/** Invoice code in the shop's Access format: C + yyMMddHHmmss */
export function invoiceCode(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `C${yy}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Next sequential code for a year-scoped series, e.g. CASE-2026-0008 */
export async function nextCode(prefix, table, column) {
  const year = new Date().getFullYear();
  const row = await get(
    `SELECT MAX(CAST(SUBSTRING_INDEX(\`${column}\`, '-', -1) AS UNSIGNED)) AS n
       FROM \`${table}\` WHERE \`${column}\` LIKE ?`,
    `${prefix}-${year}-%`
  );
  const n = (row?.n ?? 0) + 1;
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}

export function sumCol(rows, key) {
  return rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);
}

export function sumBy(rows, key, amount) {
  const m = {};
  for (const r of rows) {
    const k = r[key] !== '' && r[key] !== null && r[key] !== undefined ? String(r[key]) : '-';
    m[k] = round2((m[k] || 0) + (Number(amount(r)) || 0));
  }
  return m;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/__tests__/helpers.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/helpers.js lib/__tests__/helpers.test.js
git commit -m "Port core helpers to lib/helpers.js"
```

---

### Task 3: Port the DB layer (`lib/db.js`)

**Files:**
- Create: `lib/config.js`
- Create: `lib/db.js`
- Create: `scripts/db-smoke-test.js` (throwaway verification script, not committed to the app's runtime path but kept in the repo as a reusable smoke check)

**Interfaces:**
- Consumes: nothing new.
- Produces: `all(sql, ...params)`, `get(sql, ...params)`, `run(sql, ...params)`, `tx(fn)`, `verifyConnection()` — a transaction callback `fn` receives `{ all, get, run }` bound to the transaction's connection (mirrors PHP's `Tx` object). **Nested `tx()` calls are not supported** (each `tx()` call takes a fresh pooled connection) — the current codebase never nests `Db::tx()` calls, so this is safe; flag it if a later domain port tries to.

- [ ] **Step 1: Create `lib/config.js`**

```javascript
/**
 * TimeOptic — configuration. Next.js loads .env automatically; this just
 * applies the same defaults api/config.php used for a stock XAMPP install.
 */
export const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'timeoptic',
};

export const telegramConfig = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || null,
  chatId: process.env.TELEGRAM_CHAT_ID || null,
};
```

- [ ] **Step 2: Create `lib/db.js`**

```javascript
/**
 * Data layer — MariaDB/MySQL via mysql2/promise.
 * Port of api/core/Db.php: all/get/run/tx with the same signatures.
 *
 * dateStrings:true and decimalNumbers:false keep DATE/DATETIME/DECIMAL
 * columns coming back as strings, matching what PDO returned — lib/format.js
 * and the ported page components assume string values from the API.
 */
import mysql from 'mysql2/promise';
import { dbConfig } from './config.js';

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
      charset: 'utf8mb4',
      dateStrings: true,
      decimalNumbers: false,
      waitForConnections: true,
      connectionLimit: 10,
    });
  }
  return pool;
}

/** All matching rows. */
export async function all(sql, ...params) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

/** First row, or null. */
export async function get(sql, ...params) {
  const rows = await all(sql, ...params);
  return rows[0] ?? null;
}

/** Write. Returns { insertId, affected }. */
export async function run(sql, ...params) {
  const [result] = await getPool().execute(sql, params);
  return { insertId: result.insertId, affected: result.affectedRows };
}

/**
 * Run fn inside a transaction. fn receives { all, get, run } bound to the
 * transaction's own connection — always use those inside fn, not the
 * module-level all/get/run, or the write will run outside the transaction.
 */
export async function tx(fn) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const txAll = async (sql, ...params) => (await conn.execute(sql, params))[0];
    const txGet = async (sql, ...params) => (await txAll(sql, ...params))[0] ?? null;
    const txRun = async (sql, ...params) => {
      const [result] = await conn.execute(sql, params);
      return { insertId: result.insertId, affected: result.affectedRows };
    };
    const out = await fn({ all: txAll, get: txGet, run: txRun });
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Startup check — mirrors the banner the PHP/Node servers printed. */
export async function verifyConnection() {
  const v = await get('SELECT VERSION() AS version, DATABASE() AS db');
  const t = await get(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?',
    dbConfig.database
  );
  return { version: v?.version ?? '?', db: v?.db ?? '?', tables: Number(t?.n ?? 0) };
}
```

- [ ] **Step 3: Write a smoke-test script against the real database**

```javascript
// scripts/db-smoke-test.js
import { verifyConnection, get, tx } from '../lib/db.js';

const info = await verifyConnection();
console.log('Connected:', info);
if (info.tables < 27) throw new Error(`expected >=27 tables, found ${info.tables}`);

const row = await get('SELECT 1 + 1 AS n');
if (row.n !== 2) throw new Error('basic query failed');

const out = await tx(async (t) => {
  const before = await t.get('SELECT COUNT(*) AS n FROM employees');
  return before.n;
});
console.log('employees count (via tx):', out);
console.log('OK');
```

- [ ] **Step 4: Run it against the real XAMPP MariaDB (must be running)**

Run: `node scripts/db-smoke-test.js`
Expected: prints `Connected: { version: ..., db: 'timeoptic', tables: 27 }` (or more, if views count — adjust the assertion if the real count differs) then `OK`. If it fails to connect, start XAMPP's MySQL service first.

- [ ] **Step 5: Commit**

```bash
git add lib/config.js lib/db.js scripts/db-smoke-test.js
git commit -m "Port DB layer to lib/db.js (mysql2)"
```

---

### Task 4: Port HTTP error handling (`lib/httpError.js`, `lib/apiRoute.js`)

**Files:**
- Create: `lib/httpError.js`
- Create: `lib/apiRoute.js`
- Test: `lib/__tests__/httpError.test.js`

**Interfaces:**
- Produces: `HttpError`, `bad(msg)` (throws 400), `missing(msg?)` (throws 404), `withRoute(handler)` — wraps a Next.js route handler.

- [ ] **Step 1: Write the failing test**

```javascript
// lib/__tests__/httpError.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, bad, missing } from '../httpError.js';

test('bad() throws a 400 HttpError with the given message', () => {
  assert.throws(() => bad('กรุณากรอกชื่อ'), (e) => e instanceof HttpError && e.status === 400 && e.message === 'กรุณากรอกชื่อ');
});

test('missing() throws a 404, with a default message', () => {
  assert.throws(() => missing(), (e) => e instanceof HttpError && e.status === 404);
  assert.throws(() => missing('ไม่พบเคส'), (e) => e.message === 'ไม่พบเคส');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/__tests__/httpError.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `lib/httpError.js`**

```javascript
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** 400 — the caller sent something we cannot accept */
export function bad(msg) {
  throw new HttpError(400, msg);
}

/** 404 */
export function missing(msg = 'ไม่พบข้อมูล / Not found') {
  throw new HttpError(404, msg);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/__tests__/httpError.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write `lib/apiRoute.js`**

```javascript
/**
 * Wraps a Next.js API route handler so route files can just return data or
 * throw HttpError, the same shape api/index.php's try/catch gave every
 * api/routes/*.php handler.
 */
import { NextResponse } from 'next/server';
import { HttpError } from './httpError.js';

async function readJsonBody(request) {
  const raw = await request.text();
  if (!raw || raw.trim() === '') return {};
  if (raw.length > 2 * 1024 * 1024) throw new HttpError(413, 'Payload too large');
  try {
    const data = JSON.parse(raw);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('not an object');
    }
    return data;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

/**
 * handler receives { params, query, body } and returns the JSON payload
 * (or null — a real answer for "this row doesn't exist yet", not an error).
 */
export function withRoute(handler) {
  return async function (request, context) {
    const method = request.method;
    try {
      const url = new URL(request.url);
      const query = Object.fromEntries(url.searchParams);
      const params = context?.params ? await context.params : {};
      const body = method === 'GET' || method === 'DELETE' ? {} : await readJsonBody(request);
      const result = await handler({ params, query, body });
      return NextResponse.json(result ?? null, {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      console.error(`[${method} ${request.url}]`, e);
      return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
    }
  };
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/httpError.js lib/apiRoute.js lib/__tests__/httpError.test.js
git commit -m "Port HTTP error handling to lib/httpError.js and lib/apiRoute.js"
```

---

### Task 5: Port SQL fragments and case-workflow writes (`lib/sql.js`)

**Files:**
- Create: `lib/sql.js`

**Interfaces:**
- Consumes: `lib/helpers.js` (`nul, intOr, strOr, boolInt`).
- Produces: `Sql` (`ORDER_SELECT, ORDER_FROM, UNFILLED, BOOKING_SELECT, BOOKING_FROM`), `logEvent(tx, caseId, fields)`, `setStatus(tx, caseId, toStatus, opt)`, `upsertFactory(spec)`. `logEvent`/`setStatus`/`upsertFactory` take the `tx`-scoped `{ all, get, run }` object from `lib/db.js`'s `tx()`, matching the PHP `Tx` parameter.

No unit tests here — every function does real writes/reads against `cases`/`case_events`/`case_statuses` and the workflow tables, so it's verified in a later domain plan (cases) against the real DB, per the spec's testing approach. Port faithfully now; wire up later.

- [ ] **Step 1: Write `lib/sql.js`**

```javascript
/**
 * SQL fragments shared by more than one route, plus the two case-workflow
 * writes (audit log + status move) several routes call.
 * Port of api/core/Sql.php.
 */
import { nul, intOr, strOr, boolInt } from './helpers.js';
import { bad } from './httpError.js';

export const Sql = {
  ORDER_SELECT: `
    o.*, c.first_name, c.last_name, c.phone, c.line_id,
    e.employee_name AS employee_name,
    ce.employee_name AS close_employee_name,
    cs.case_code,
    COALESCE(pay.paid, 0) AS paid,
    o.total_price - o.discount - COALESCE(pay.paid, 0) AS balance`,

  ORDER_FROM: `
    FROM custom_orders o
    JOIN customers c        ON c.id  = o.customer_id
    LEFT JOIN employees e   ON e.id  = o.employee_id
    LEFT JOIN employees ce  ON ce.id = o.order_close_employee_id
    LEFT JOIN cases cs      ON cs.id = o.case_id
    LEFT JOIN (SELECT order_id, SUM(amount) paid FROM payments
               WHERE order_id IS NOT NULL GROUP BY order_id) pay ON pay.order_id = o.id`,

  UNFILLED: `(COALESCE(o.lens_product_id,0)=0
                  OR COALESCE(o.right_lens_product_id,0)=0
                  OR COALESCE(o.frame_product_id,0)=0)`,

  BOOKING_SELECT: `
    b.*, c.first_name AS cust_first_name, c.last_name AS cust_last_name,
    c.phone AS cust_phone, c.line_id AS cust_line_id,
    e.employee_name AS assigned_name, cr.employee_name AS created_by_name,
    ca.case_code, ca.status AS case_status,
    TIMESTAMP(b.booking_date, b.booking_time) AS starts_at`,

  BOOKING_FROM: `
    FROM bookings b
    LEFT JOIN customers c  ON c.id  = b.customer_id
    LEFT JOIN employees e  ON e.id  = b.assigned_to
    LEFT JOIN employees cr ON cr.id = b.created_by
    LEFT JOIN cases ca     ON ca.id = b.case_id`,
};

/** Append a row to the case audit log. No-op without a case id. */
export async function logEvent(t, caseId, f) {
  if (!caseId) return;
  await t.run(
    `INSERT INTO case_events (case_id, from_status, to_status, action, entity,
       entity_id, employee_id, note, payload)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    caseId,
    nul(f.from_status ?? null),
    nul(f.to_status ?? null),
    strOr(f.action ?? null),
    nul(f.entity ?? null),
    intOr(f.entity_id ?? null),
    intOr(f.employee_id ?? null),
    nul(f.note ?? null),
    f.payload !== undefined && f.payload !== null ? JSON.stringify(f.payload) : null
  );
}

/** Move a case to a new status (validated) and log it. */
export async function setStatus(t, caseId, toStatus, opt = {}) {
  if (!caseId || !toStatus) return;
  const c = await t.get('SELECT id, status FROM cases WHERE id = ?', caseId);
  if (!c) return;
  const target = await t.get('SELECT code, is_terminal FROM case_statuses WHERE code = ?', toStatus);
  if (!target) bad(`ไม่รู้จักสถานะ "${toStatus}"`);
  if (c.status === toStatus) return;
  const closedAt = Number(target.is_terminal) === 1 ? 'NOW()' : 'closed_at';
  await t.run(`UPDATE cases SET status = ?, closed_at = ${closedAt} WHERE id = ?`, toStatus, caseId);
  await logEvent(t, caseId, {
    from_status: c.status,
    to_status: toStatus,
    action: opt.action ?? 'status_change',
    employee_id: opt.employee_id ?? null,
    note: opt.note ?? null,
  });
}

/**
 * Shared create-or-update handler for the one-row-per-case workflow tables
 * (centerings, frame_fittings, production_jobs).
 */
export function upsertFactory(spec) {
  return async function (req) {
    const body = req.body;
    const { table, cols, intCols = [], boolCols = [] } = spec;

    const caseId = intOr(body.case_id ?? null);
    if (!caseId) bad('กรุณาระบุเคส');

    const vals = cols.map((c) => {
      if (intCols.includes(c)) return intOr(body[c] ?? null);
      if (boolCols.includes(c)) return boolInt(body[c] ?? null);
      return nul(body[c] ?? null);
    });

    const { tx } = await import('./db.js');
    const id = await tx(async (t) => {
      const ex = await t.get(`SELECT id FROM \`${table}\` WHERE case_id = ? ORDER BY id DESC LIMIT 1`, caseId);
      let rid;
      if (ex) {
        const set = cols.map((c) => `\`${c}\`=?`).join(',');
        await t.run(`UPDATE \`${table}\` SET ${set} WHERE id = ?`, ...vals, ex.id);
        rid = ex.id;
      } else {
        const names = cols.map((c) => `\`${c}\``).join(',');
        const marks = cols.map(() => '?').join(',');
        const r = await t.run(`INSERT INTO \`${table}\` (case_id, ${names}) VALUES (?, ${marks})`, caseId, ...vals);
        rid = r.insertId;
      }
      const emp = intOr(body.performed_by ?? null) ?? intOr(body.recorded_by ?? null) ?? intOr(body.employee_id ?? null);
      await logEvent(t, caseId, { action: spec.action, entity: table, entity_id: rid, employee_id: emp });
      if (spec.status) {
        await setStatus(t, caseId, spec.status, {
          employee_id: intOr(body.performed_by ?? null) ?? intOr(body.recorded_by ?? null),
          action: spec.action,
        });
      }
      return rid;
    });

    const { get } = await import('./db.js');
    return get(`SELECT * FROM \`${table}\` WHERE id = ?`, id);
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/sql.js
git commit -m "Port SQL fragments and case-workflow writes to lib/sql.js"
```

---

### Task 6: Port lookups (`lib/lookups.js`)

**Files:**
- Create: `lib/lookups.js`

**Interfaces:**
- Consumes: `lib/db.js` (`all`).
- Produces: `lists()` (async), `caseStatuses()` (async).

- [ ] **Step 1: Write `lib/lookups.js`**

```javascript
/**
 * Dropdown sources. Port of api/core/Lookups.php.
 * Most live in the schema's list_* tables; the free-text columns offer
 * whatever the shop has actually typed before, with a starter set when a
 * table is still empty.
 */
import { all } from './db.js';

const LIST_TABLES = {
  sex: 'list_sex',
  marketing: 'list_marketing',
  pay_type: 'list_pay_type',
  product_type: 'list_product_type',
  len_type: 'list_len_type',
};

export async function lists() {
  const out = {};
  for (const [kind, table] of Object.entries(LIST_TABLES)) {
    const rows = await all(`SELECT code, label_th FROM \`${table}\` ORDER BY sort_order, code`);
    out[kind] = rows.map((r) => r.code);
    out[`${kind}_labels`] = Object.fromEntries(rows.map((r) => [r.code, r.label_th]));
  }

  const col = (rows) => rows.map((r) => r.c);

  out.expense_type = col(await all(
    "SELECT DISTINCT expense_type c FROM expenses WHERE expense_type IS NOT NULL AND expense_type <> '' ORDER BY c"
  ));
  out.income_type = col(await all(
    "SELECT DISTINCT income_type c FROM incomes WHERE income_type IS NOT NULL AND income_type <> '' ORDER BY c"
  ));
  out.branch = [...new Set([
    ...col(await all("SELECT DISTINCT branch c FROM expenses WHERE branch <> '' ORDER BY c")),
    ...col(await all("SELECT DISTINCT branch c FROM incomes  WHERE branch <> '' ORDER BY c")),
  ])];

  if (!out.expense_type.length) {
    out.expense_type = ['เลนส์', 'ค่าขนส่ง', 'จิปาถะ', 'ตกแต่ง', 'สินค้าแว่น',
      'คอนแทคเลนส์', 'ซ่อมบำรุง', 'ค่าเช่า', 'ค่าทำบัญชี', 'Internet', 'โทรศัพท์', 'เงินเดือน'];
  }
  if (!out.income_type.length) out.income_type = ['ค่าเช่า', 'ประกันสังคม', 'อื่นๆ'];
  if (!out.branch.length) out.branch = ['Timeoptic', 'ส่วนตัว'];

  out.test_for = ['Distance', 'Reading', 'Progressive', 'Bi-focal'];
  out.payment_kind = ['deposit', 'partial', 'final', 'full'];
  out.lens_source = ['stock', 'order'];
  return out;
}

export async function caseStatuses() {
  return all(
    `SELECT code, stage_no, label_th, label_en, stage_group, sort_order,
            is_waiting, is_terminal
       FROM case_statuses ORDER BY sort_order`
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/lookups.js
git commit -m "Port dropdown lookups to lib/lookups.js"
```

---

### Task 7: Port booking vocabulary (`lib/booking.js`)

**Files:**
- Create: `lib/booking.js`
- Test: `lib/__tests__/booking.test.js`

**Interfaces:**
- Produces: `SERVICE_TYPES, STATUSES, CHANNELS, INTAKE_QUESTIONS, STATUS_CODES` (arrays), `serviceLabel(code)`, `shape(booking)`.

- [ ] **Step 1: Write the failing test**

```javascript
// lib/__tests__/booking.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceLabel, shape, SERVICE_TYPES } from '../booking.js';

test('serviceLabel: known code returns Thai label, unknown returns the code', () => {
  assert.equal(serviceLabel('eye_exam'), 'วัดสายตา');
  assert.equal(serviceLabel('nope'), 'nope');
});

test('SERVICE_TYPES has 7 entries', () => {
  assert.equal(SERVICE_TYPES.length, 7);
});

test('shape: null passes through', () => {
  assert.equal(shape(null), null);
});

test('shape: linked customer fields win over free-text booking fields', () => {
  const out = shape({ cust_first_name: 'A', first_name: 'B', cust_phone: '02', phone: '08' });
  assert.equal(out.first_name, 'A');
  assert.equal(out.phone, '02');
});

test('shape: falls back to the free-text fields when no linked customer', () => {
  const out = shape({ first_name: 'Walk-in', phone: '08' });
  assert.equal(out.first_name, 'Walk-in');
  assert.equal(out.phone, '08');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/__tests__/booking.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `lib/booking.js`**

```javascript
/**
 * Booking vocabulary. Kept in code rather than the database, same decision
 * the PHP/Node versions made. Port of api/services/Booking.php.
 */
export const SERVICE_TYPES = [
  ['eye_exam', 'วัดสายตา'],
  ['choose_frame', 'เลือกกรอบ/เลนส์'],
  ['pickup', 'รับแว่น'],
  ['adjust', 'ปรับ/ซ่อมแว่น'],
  ['contact_lens', 'คอนแทคเลนส์'],
  ['consult', 'ปรึกษา/สอบถาม'],
  ['other', 'อื่น ๆ'],
];

export const STATUSES = [
  ['booked', 'จองแล้ว'],
  ['confirmed', 'ยืนยันแล้ว'],
  ['arrived', 'ลูกค้ามาถึง'],
  ['in_service', 'กำลังให้บริการ'],
  ['done', 'เสร็จสิ้น'],
  ['no_show', 'ไม่มาตามนัด'],
  ['cancelled', 'ยกเลิก'],
];

export const CHANNELS = [
  ['phone', 'โทรศัพท์'], ['line', 'LINE'], ['facebook', 'Facebook'],
  ['walk_in', 'เดินเข้าร้าน'], ['web', 'เว็บไซต์'], ['other', 'อื่น ๆ'],
];

export const INTAKE_QUESTIONS = [
  'มาด้วยเรื่องอะไร / อาการที่พบ',
  'เคยตัดแว่นกับเราหรือยัง',
  'ใช้แว่น/คอนแทคเลนส์เดิมแบบไหน',
  'ใช้สายตาหนักด้านไหน (จอ/ขับรถ/อ่านหนังสือ)',
  'งบประมาณคร่าว ๆ',
  'ต้องการรับแว่นเมื่อไหร่',
];

export const STATUS_CODES = ['booked', 'confirmed', 'arrived', 'in_service', 'done', 'no_show', 'cancelled'];

export function serviceLabel(code) {
  return SERVICE_TYPES.find(([c]) => c === code)?.[1] ?? String(code);
}

/** The linked customer record wins over the free-text fields typed at booking time. */
export function shape(b) {
  if (!b) return null;
  return {
    ...b,
    first_name: b.cust_first_name ?? b.first_name ?? null,
    last_name: b.cust_last_name ?? b.last_name ?? null,
    phone: b.cust_phone ?? b.phone ?? null,
    line_id: b.cust_line_id ?? b.line_id ?? null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/__tests__/booking.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/booking.js lib/__tests__/booking.test.js
git commit -m "Port booking vocabulary to lib/booking.js"
```

---

### Task 8: Port client-side formatting/constants/hooks

**Files:**
- Create: `lib/format.js` (copy of `frontend/src/lib/format.js`, no changes needed — pure functions, no react-router dependency)
- Create: `lib/constants.js` (copy of `frontend/src/lib/constants.js`, no changes needed)
- Create: `lib/hooks.js` (copy of `frontend/src/lib/hooks.js`, add `'use client'` at the top since it uses React state/effect hooks)
- Test: `lib/__tests__/format.test.js`

**Interfaces:**
- Produces: same exports as the originals — `money, moneyShort, numFmt, count, power, rxNum, fmtDate, fmtDateTime, dateOnly, dtLocal, hhmm, toStamp, custName, bookingName, nowLocal, todayISO, sumBy` (format.js); `STAGE_META, stageInfo, STAGE_GROUPS, ACTION_LABEL, RX_KIND_LABEL, BOOKING_STATUS_CLASS, BOOKING_STEP_LABEL, BOOKING_STEPS, TH_MONTHS, TH_DOW, SHOP, NATIONALITIES, BRANDS` (constants.js); `useDebounced, useAsync, readForm, onSubmit` (hooks.js).

- [ ] **Step 1: Copy `format.js` and `constants.js` verbatim**

Run:
```bash
cp frontend/src/lib/format.js lib/format.js
cp frontend/src/lib/constants.js lib/constants.js
```

- [ ] **Step 2: Copy `hooks.js` and add the client directive**

Run: `cp frontend/src/lib/hooks.js lib/hooks.js`

Then add a `'use client';` line at the very top of `lib/hooks.js` (before the existing header comment), since it uses `useState`/`useEffect`/`useRef` and Next.js requires the directive on any module that touches client-only React APIs.

- [ ] **Step 3: Write tests for the pure formatting functions**

```javascript
// lib/__tests__/format.test.js
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
git add lib/format.js lib/constants.js lib/hooks.js lib/__tests__/format.test.js
git commit -m "Port client-side format/constants/hooks helpers"
```

---

### Task 9: Port the client API wrapper (`lib/apiClient.js`)

**Files:**
- Create: `lib/apiClient.js` (copy of `frontend/src/api/client.js`, no changes needed — relative `/api/*` paths work identically under Next.js since the API routes live at the same origin)

**Interfaces:**
- Produces: `api.get(path, query?, signal?)`, `api.post(path, body?)`, `api.put(path, body?)`, `api.del(path)`.

- [ ] **Step 1: Copy the file and add the client directive**

Run: `cp frontend/src/api/client.js lib/apiClient.js`

Add `'use client';` at the top (it's only ever called from Client Components that fetch on the browser side, and uses `fetch`/`AbortSignal` in a way tied to browser interaction).

- [ ] **Step 2: Commit**

```bash
git add lib/apiClient.js
git commit -m "Port API client wrapper to lib/apiClient.js"
```

---

### Task 10: Port Toast, Confirm, and Meta providers

**Files:**
- Create: `components/Toast.jsx` (copy of `frontend/src/components/Toast.jsx`, add `'use client'`, no other changes)
- Create: `components/Confirm.jsx` (copy of `frontend/src/components/Confirm.jsx`, add `'use client'`, no other changes)
- Create: `contexts/MetaContext.jsx` (port of `frontend/src/api/meta.jsx`, updates the import path for `api`)

**Interfaces:**
- Produces: `ToastProvider`, `useToast()` (`{ ok, err }`); `ConfirmProvider`, `useConfirm()`; `MetaProvider`, `useMeta()` (`{ meta, reload, ready, error }`), `useBookingLabels()`.

- [ ] **Step 1: Copy Toast and Confirm, adding `'use client'`**

Run:
```bash
cp frontend/src/components/Toast.jsx components/Toast.jsx
cp frontend/src/components/Confirm.jsx components/Confirm.jsx
```

Add `'use client';` as the first line of both files.

- [ ] **Step 2: Write `contexts/MetaContext.jsx`**

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
git add components/Toast.jsx components/Confirm.jsx contexts/MetaContext.jsx
git commit -m "Port Toast, Confirm, and Meta providers"
```

---

### Task 11: Port shared UI components (`components/ui.jsx`, `DataTable.jsx`, `Selects.jsx`, `Shell.jsx`)

**Files:**
- Create: `components/ui.jsx` (copy of `frontend/src/components/ui.jsx`, swap `react-router-dom`'s `Link` for `next/link`, add `'use client'`)
- Create: `components/DataTable.jsx` (copy of `frontend/src/components/DataTable.jsx`, no react-router dependency — add `'use client'` since it takes an `onRowClick` handler)
- Create: `components/Selects.jsx` (copy of `frontend/src/components/Selects.jsx`, update the `useMeta` import path, add `'use client'`)
- Create: `components/Shell.jsx` (port of `frontend/src/components/Shell.jsx` + the crumb logic from `frontend/src/App.jsx`, since Next's file-based routing replaces the central `<Routes>` table — `Shell` now computes its own crumb from `usePathname()`)

**Interfaces:**
- Consumes: `contexts/MetaContext.jsx` (`useMeta`).
- Produces: `PageHead, Card, Field, Split, Stack, Row, Toolbar, FormGrid, FormActions, Badge, Empty, Loading, Kpi, Kpis, Fieldset, Check, Tabs, LinkTabs, OrderStatusBadge, PrintButton, Kv` (ui.jsx); `DataTable` (DataTable.jsx); `Select, EmployeeSelect, ListSelect, SupplierSelect, StatusSelect` (Selects.jsx); `Shell` (Shell.jsx) — same names as today, so later plans' pages import unchanged.

- [ ] **Step 1: Write `components/ui.jsx`**

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

- [ ] **Step 2: Write `components/DataTable.jsx`**

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

- [ ] **Step 3: Write `components/Selects.jsx`**

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

- [ ] **Step 4: Write `components/Shell.jsx`**

Absorbs the `TITLES`/`crumbFor` logic from `frontend/src/App.jsx` (Next's file-based routing removes the need for a central `<Routes>` table, but the breadcrumb table itself is still needed) and the `react-router-dom` `useLocation`/`NavLink`/`Link` swapped for `next/navigation`'s `usePathname` and `next/link`.

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

/** path -> breadcrumb, matched longest-first */
const TITLES = [
  ['/', 'เมนูหลัก'],
  ['/customers/new', 'ลูกค้าใหม่'],
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

Note: `NavLink`'s `active` auto-highlighting is replaced with an explicit `className={to === base ? 'active' : ''}` comparison (same logic the original `Shell` already used for the `base` computation — only the `NavLink` import itself needed swapping since `next/link`'s `Link` doesn't do automatic active-class matching).

- [ ] **Step 5: Commit**

```bash
git add components/ui.jsx components/DataTable.jsx components/Selects.jsx components/Shell.jsx
git commit -m "Port shared UI components (ui, DataTable, Selects, Shell) for Next.js"
```

---

### Task 12: Wire the root layout (providers + Shell)

**Files:**
- Create: `app/providers.jsx`
- Modify: `app/layout.jsx`

**Interfaces:**
- Consumes: `ToastProvider`, `ConfirmProvider`, `MetaProvider`, `Shell`.
- Produces: every `app/**/page.jsx` automatically renders inside the sidebar/topbar chrome with toast/confirm/meta available via `useToast()`/`useConfirm()`/`useMeta()`.

- [ ] **Step 1: Write `app/providers.jsx`**

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

- [ ] **Step 2: Update `app/layout.jsx` to use it**

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

Run: `npm run dev`, open `http://localhost:3000`.
Expected: sidebar + topbar render around the placeholder page text. The meta fetch will fail with a visible error state (no `/api/meta` route exists yet — that's Task 13) — that's expected at this point, not a bug to fix here.

- [ ] **Step 4: Commit**

```bash
git add app/providers.jsx app/layout.jsx
git commit -m "Wire root layout with Toast/Confirm/Meta providers and Shell"
```

---

### Task 13: API pilot — `/api/meta` and `/api/employees`

**Files:**
- Create: `app/api/meta/route.js`
- Create: `app/api/employees/route.js`
- Create: `app/api/employees/[id]/route.js`

**Interfaces:**
- Consumes: `lib/apiRoute.js` (`withRoute`), `lib/db.js` (`all, get, run`), `lib/lookups.js` (`lists, caseStatuses`), `lib/booking.js`, `lib/helpers.js` (`today, nowStamp, strOr, nul, boolInt, intOr`).
- Produces: `GET /api/meta`, `GET/POST /api/employees`, `PUT /api/employees/:id` — same response shapes as `api/routes/meta.php` / `api/routes/employees.php`.

- [ ] **Step 1: Write `app/api/meta/route.js`**

```javascript
import { withRoute } from '../../../lib/apiRoute.js';
import { all } from '../../../lib/db.js';
import { lists, caseStatuses } from '../../../lib/lookups.js';
import { SERVICE_TYPES, STATUSES, CHANNELS, INTAKE_QUESTIONS } from '../../../lib/booking.js';
import { today, nowStamp } from '../../../lib/helpers.js';

export const GET = withRoute(async () => ({
  lists: await lists(),
  employees: await all(
    'SELECT id, employee_name, first_name, last_name, roles FROM employees WHERE active = 1 ORDER BY employee_name'
  ),
  statuses: await caseStatuses(),
  suppliers: await all(
    'SELECT id, name, default_lead_days FROM suppliers WHERE active = 1 ORDER BY name'
  ),
  booking: {
    service_types: SERVICE_TYPES,
    statuses: STATUSES,
    channels: CHANNELS,
    intake_questions: INTAKE_QUESTIONS,
  },
  today: today(),
  now: nowStamp(),
}));
```

- [ ] **Step 2: Write `app/api/employees/route.js`**

`bad` lives in `lib/httpError.js`; `strOr`/`nul` live in `lib/helpers.js` — import each from its own module.

```javascript
import { withRoute } from '../../../lib/apiRoute.js';
import { all, get, run } from '../../../lib/db.js';
import { bad } from '../../../lib/httpError.js';
import { strOr, nul } from '../../../lib/helpers.js';

export const GET = withRoute(async () =>
  all('SELECT * FROM employees ORDER BY active DESC, employee_name')
);

export const POST = withRoute(async ({ body }) => {
  if (strOr(body.employee_name) === '') bad('กรุณากรอกชื่อเล่นพนักงาน');
  const r = await run(
    `INSERT INTO employees (employee_name, first_name, last_name, sex, birth_date, roles, active)
     VALUES (?,?,?,?,?,?,1)`,
    strOr(body.employee_name),
    nul(body.first_name ?? null),
    nul(body.last_name ?? null),
    nul(body.sex ?? null),
    nul(body.birth_date ?? null),
    nul(body.roles ?? null)
  );
  return get('SELECT * FROM employees WHERE id = ?', r.insertId);
});
```

- [ ] **Step 3: Write `app/api/employees/[id]/route.js`**

```javascript
import { withRoute } from '../../../../lib/apiRoute.js';
import { get, run } from '../../../../lib/db.js';
import { missing } from '../../../../lib/httpError.js';
import { intOr, strOr, nul, boolInt } from '../../../../lib/helpers.js';

export const PUT = withRoute(async ({ params, body }) => {
  const id = intOr(params.id);
  if (!(await get('SELECT id FROM employees WHERE id = ?', id))) missing();
  await run(
    `UPDATE employees SET employee_name=?, first_name=?, last_name=?, sex=?,
       birth_date=?, roles=?, active=? WHERE id=?`,
    strOr(body.employee_name ?? null),
    nul(body.first_name ?? null),
    nul(body.last_name ?? null),
    nul(body.sex ?? null),
    nul(body.birth_date ?? null),
    nul(body.roles ?? null),
    boolInt(body.active ?? null),
    id
  );
  return get('SELECT * FROM employees WHERE id = ?', id);
});
```

- [ ] **Step 4: Manually verify against the real DB (XAMPP MySQL running)**

Run: `npm run dev`, then in another terminal:
```bash
curl http://localhost:3000/api/meta
curl http://localhost:3000/api/employees
curl -X POST http://localhost:3000/api/employees -H "content-type: application/json" -d '{"employee_name":"ทดสอบ"}'
```
Expected: `/api/meta` returns `lists/employees/statuses/suppliers/booking/today/now`; `/api/employees` returns an array; the POST returns the newly created row with an `id`. Compare shapes against the equivalent PHP responses (`http://127.0.0.1:8080/api/meta` etc, with `start-api.bat` running) — they should match field-for-field.

- [ ] **Step 5: Commit**

```bash
git add app/api/meta/route.js app/api/employees/route.js "app/api/employees/[id]/route.js"
git commit -m "Port /api/meta and /api/employees routes to Next.js"
```

---

### Task 14: API pilot — `/api/dashboard`

**Files:**
- Create: `app/api/dashboard/route.js`

**Interfaces:**
- Consumes: `lib/apiRoute.js`, `lib/db.js`, `lib/sql.js` (`Sql`), `lib/helpers.js` (`today`).
- Produces: `GET /api/dashboard` — same response shape as `api/routes/dashboard.php`.

- [ ] **Step 1: Write `app/api/dashboard/route.js`**

```javascript
import { withRoute } from '../../../lib/apiRoute.js';
import { all, get } from '../../../lib/db.js';
import { Sql } from '../../../lib/sql.js';
import { today } from '../../../lib/helpers.js';

export const GET = withRoute(async () => {
  const d = today();

  let bookingsToday = [];
  try {
    bookingsToday = await all(
      `SELECT b.*, e.employee_name AS assigned_name,
              COALESCE(c.first_name, b.first_name) AS first_name,
              COALESCE(c.last_name,  b.last_name)  AS last_name,
              COALESCE(c.phone,      b.phone)      AS phone,
              ca.case_code,
              TIMESTAMPDIFF(MINUTE, NOW(), TIMESTAMP(b.booking_date, b.booking_time)) AS mins_away
         FROM bookings b
         LEFT JOIN customers c ON c.id = b.customer_id
         LEFT JOIN employees e ON e.id = b.assigned_to
         LEFT JOIN cases ca    ON ca.id = b.case_id
        WHERE b.booking_date = CURDATE() AND b.status <> 'cancelled'
        ORDER BY b.booking_time`
    );
  } catch {
    // the bookings table may not exist yet on a fresh database
    bookingsToday = [];
  }

  const { ORDER_SELECT: sel, ORDER_FROM: from, UNFILLED: unf } = Sql;

  const unfilled = await all(
    `SELECT ${sel} ${from} WHERE o.order_closed = 0 AND ${unf}
      ORDER BY o.order_date DESC LIMIT 100`
  );
  const unclosed = await all(
    `SELECT ${sel} ${from} WHERE o.order_closed = 0 AND NOT ${unf}
      ORDER BY o.appointment_date IS NULL, o.appointment_date, o.order_date DESC
      LIMIT 200`
  );
  const board = await all(
    'SELECT stage_group, COUNT(*) n FROM v_case_board WHERE is_terminal = 0 GROUP BY stage_group'
  );
  const lens = await all('SELECT risk_level, COUNT(*) n FROM v_lens_tracker GROUP BY risk_level');

  const one = async (sql, ...p) => (await get(sql, ...p)) ?? {};
  const pairs = (rows, k) => Object.fromEntries(rows.map((r) => [String(r[k]), Number(r.n)]));

  const pending = bookingsToday.filter((b) => b.status === 'booked' || b.status === 'confirmed').length;

  return {
    unfilled,
    unclosed,
    bookings_today: bookingsToday,
    board: pairs(board, 'stage_group'),
    lens_risk: pairs(lens, 'risk_level'),
    stats: {
      customers: Number((await one('SELECT COUNT(*) n FROM customers')).n ?? 0),
      open_cases: Number((await one(
        `SELECT COUNT(*) n FROM cases c JOIN case_statuses s ON s.code = c.status
          WHERE s.is_terminal = 0`
      )).n ?? 0),
      rush_cases: Number((await one(
        `SELECT COUNT(*) n FROM cases c JOIN case_statuses s ON s.code = c.status
          WHERE s.is_terminal = 0 AND c.is_rush = 1`
      )).n ?? 0),
      open_orders: Number((await one('SELECT COUNT(*) n FROM custom_orders WHERE order_closed = 0')).n ?? 0),
      stock_on_hand: Number((await one('SELECT COUNT(*) n FROM stock WHERE sold = 0')).n ?? 0),
      lens_waiting: Number((await one(
        "SELECT COUNT(*) n FROM lens_jobs WHERE status = 'waiting_arrival'"
      )).n ?? 0),
      received_today: await one(
        'SELECT COUNT(*) n, COALESCE(SUM(amount),0) amount FROM payments WHERE DATE(paid_at) = ?', d
      ),
      sales_today: await one(
        'SELECT COUNT(*) n, COALESCE(SUM(price - discount),0) amount FROM sales WHERE DATE(sale_date) = ?', d
      ),
      expense_today: await one(
        'SELECT COALESCE(SUM(amount),0) amount FROM expenses WHERE cf_date = ?', d
      ),
      appointments_today: Number((await one(
        'SELECT COUNT(*) n FROM custom_orders WHERE order_closed = 0 AND appointment_date = ?', d
      )).n ?? 0),
      bookings_today: bookingsToday.length,
      bookings_pending: pending,
    },
  };
});
```

- [ ] **Step 2: Manually verify against the real DB**

Run: `curl http://localhost:3000/api/dashboard | node -e "process.stdin.pipe(process.stdout)"` (or just open it in a browser) and compare the JSON shape field-by-field against `curl http://127.0.0.1:8080/api/dashboard` (PHP API running via `start-api.bat`).
Expected: same top-level keys (`unfilled, unclosed, bookings_today, board, lens_risk, stats`), same `stats` sub-keys, equivalent values (values may differ slightly if run at a different moment, but shapes and today's aggregate counts should match).

- [ ] **Step 3: Commit**

```bash
git add app/api/dashboard/route.js
git commit -m "Port /api/dashboard route to Next.js"
```

---

### Task 15: Page pilot — Dashboard (`/`) and Employees (`/employees`)

**Files:**
- Modify: `app/page.jsx` (replace the Task 1 placeholder with the real Dashboard)
- Create: `app/employees/page.jsx`

**Interfaces:**
- Consumes: `lib/apiClient.js`, `lib/hooks.js` (`useAsync`), `contexts/MetaContext.jsx` (`useMeta`), `components/ui.jsx`, `components/DataTable.jsx`, `components/Selects.jsx`, `lib/constants.js` (`stageInfo`), `lib/format.js`.

- [ ] **Step 1: Write `app/page.jsx`** (port of `frontend/src/pages/Dashboard.jsx`; `react-router-dom`'s `Link`/`useNavigate` swapped for `next/link`/`next/navigation`)

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
          onRowClick={(b) => router.push('/bookings/' + b.id)}
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
          onRowClick={(o) => router.push('/orders/' + o.id)}
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
          onRowClick={(o) => router.push('/orders/' + o.id)}
          empty="ไม่มีออเดอร์รอรับ"
        />
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Write `app/employees/page.jsx`** (port of `frontend/src/pages/EmployeeList.jsx` — only the import paths change)

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

- [ ] **Step 3: Commit**

```bash
git add app/page.jsx app/employees/page.jsx
git commit -m "Port Dashboard and Employees pages to Next.js"
```

---

### Task 16: Verify in-browser at all three required breakpoints

**Files:** none (verification only).

- [ ] **Step 1: Start both servers**

Make sure XAMPP's MySQL is running, then: `npm run dev` (Next.js on :3000). No need to run the legacy PHP/Vite servers for this check — the Next.js app is now self-contained.

- [ ] **Step 2: Launch Chrome headless with remote debugging**

Run: `"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --remote-debugging-port=9222 --disable-gpu` (adjust the path if Chrome is installed elsewhere) as a background process.

- [ ] **Step 3: For each of the three required sizes, load `/` and `/employees`, screenshot, and inspect**

Sizes: **1920×1080**, **810×1080** (iPad portrait), **1080×810** (iPad landscape).

For each size: connect over the DevTools Protocol WebSocket, call `Emulation.setDeviceMetricsOverride` with that width/height, navigate to `http://localhost:3000/` (then `/employees`), call `Page.captureScreenshot`, and save/view the PNG.

Expected, at every size:
- Sidebar/topbar layout matches what the Vite React version renders at the same size (compare against `http://localhost:5173` if the legacy frontend is running, or against memory of its known-good behavior).
- The ☰ menu button is not obscured by the sidebar drawer at 810×1080 — verify with `document.elementFromPoint()` at the button's center coordinates and confirm it resolves to the button itself, not the drawer.
- No horizontal scroll on the page body at any of the three sizes.
- Dashboard KPI cards and both order tables render without overflow; Employees page form and table are usable (inputs reachable, add button visible) at all three sizes.

- [ ] **Step 4: Fix anything that fails, then re-screenshot until all three sizes pass**

This is a real check, not a formality — if the sidebar/topbar CSS in `app/globals.css` behaves differently under Next's rendering than it did under Vite (e.g., a CSS ordering or specificity difference), fix it in `app/globals.css` now rather than deferring.

- [ ] **Step 5: Kill the headless Chrome process and the dev server**

- [ ] **Step 6: Commit any fixes made in Step 4**

```bash
git add app/globals.css
git commit -m "Fix responsive layout issues found during breakpoint verification"
```

(Skip this commit if Step 4 required no changes.)

---

## Self-Review Notes

- **Spec coverage:** every item in the spec's "Target structure" and "Key decisions" sections has a corresponding task — Next.js scaffold (Task 1), `mysql2` DB layer (Task 3), no-ORM hand-written SQL (Tasks 3/5/13/14), single-app "monorepo" (Task 1, no workspaces tooling added), legacy kept untouched (no delete step anywhere in this plan). The reminder-cron and auth items from the spec are explicitly out of scope for Foundation — they'll land with the `bookings`/`settings` domain plan and are not needed for the pilot slice.
- **Placeholder scan:** no TBDs; every step has runnable code or an exact shell command.
- **Type/name consistency:** `lib/db.js` exports `all/get/run/tx/verifyConnection` and every later task (`lib/helpers.js`'s `nextCode`, `lib/sql.js`, the API routes) imports exactly those names. `lib/httpError.js`'s `HttpError/bad/missing` are imported with those exact names everywhere they're used.
- **Scope:** this plan covers Foundation only. Each business domain (bookings, cases, customers, prescriptions, orders, stock/locations/suppliers, payments, lens_jobs, workflow, sales, cashflow, reports, settings) gets its own plan, written just before it's executed, following the interfaces this plan produces.

---

## After Foundation

Once this plan is executed and verified, the next plan is **cases** (case board + case detail + workflow sub-tables) since `bookings`, `orders`, and `dashboard` all reference case data — porting it early keeps later domain plans from having to stub it out.
