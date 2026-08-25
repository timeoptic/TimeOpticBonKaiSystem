# TimeOptic Web — Migration to Next.js Monorepo

**Date:** 2026-08-25
**Status:** Approved for planning

## Context

TimeOptic Web is the shop-management app for TimeOptic (glasses store), running
against an existing MariaDB `timeoptic` database (27 tables + 7 views, schema
predates this app and is not to be changed).

Current state — three parallel implementations in one repo:

- `api/` — PHP REST API, 85 endpoints across 18 route files (`api/routes/*.php`),
  plus `api/core/` (Db/Router/Http/Helpers/Sql/Lookups) and `api/services/`
  (Booking, Migrate, Scheduler, Telegram). This is the live backend.
- `frontend/` — React 19 + Vite 8 + React Router 7 SPA, 39 pages across 8 domains
  (bookings, cases, customers, finance, orders, prescriptions, reports, shop) plus
  a top-level Dashboard and EmployeeList. This is the live frontend. Calls the PHP
  API via `frontend/src/api/client.js`.
- `lib/` + `public/` + `server.js` (repo root) — the original Node.js + vanilla JS
  version. Superseded, kept only for reference/comparison. Out of scope — will be
  deleted as part of this migration.

Target deploy host: **Hostinger**, on a plan that supports a persistent Node.js
process (Business plan's "Setup Node.js App" in hPanel, or a VPS). This is a
hosting-plan prerequisite to verify before the deploy step; it does not block
building the code.

## Goal

Collapse the three implementations into a single **Next.js (App Router)**
application that owns both the UI and the API, replacing the PHP backend
entirely. One codebase, one deploy artifact, one Node process.

## Non-goals

- No changes to the MariaDB schema (27 tables + 7 views stay as-is).
- No feature changes — this is a like-for-like port of existing behavior
  (pages, endpoints, booking/reminder logic), not a redesign.
- Not addressing the separate "stock system" website or cross-domain/SSO
  concerns discussed earlier — out of scope for this migration.

## Target structure

```
timeoptic-web/                     (single Next.js app)
├── app/
│   ├── (dashboard)/                route group for the 39 pages, mirroring
│   │   ├── bookings/                 frontend/src/pages/bookings/ etc.
│   │   ├── cases/
│   │   ├── customers/
│   │   ├── finance/
│   │   ├── orders/
│   │   ├── prescriptions/
│   │   ├── reports/
│   │   ├── shop/
│   │   ├── page.jsx                 (Dashboard)
│   │   └── employees/
│   └── api/
│       ├── bookings/route.js        one route module group per
│       ├── cases/route.js           api/routes/*.php file (18 groups,
│       ├── ...                      85 endpoint handlers total)
│       └── cron/reminder/route.js   replaces api/cli/reminder.php
├── components/                      Shell, Card, Table, Field, Picker, Toast,
│                                     Confirm — ported from frontend/src/components
├── lib/
│   ├── db.js                        mysql2 pool, replaces api/core/Db.php (PDO)
│   ├── helpers.js                   replaces api/core/Helpers.php
│   ├── sql.js                       replaces api/core/Sql.php
│   ├── lookups.js                   replaces api/core/Lookups.php
│   ├── booking.js                   replaces api/services/Booking.php
│   ├── scheduler.js                 replaces api/services/Scheduler.php
│   ├── telegram.js                  replaces api/services/Telegram.php
│   ├── format.js, constants.js, hooks.js   ported from frontend/src/lib
│   └── apiClient.js                 client-side fetch wrapper, ported from
│                                     frontend/src/api/client.js
├── .env                              DB_HOST/PORT/USER/PASS/NAME,
│                                     TELEGRAM_BOT_TOKEN/CHAT_ID (same names as
│                                     today's .env.example)
└── package.json                     single dependency set (react, next, mysql2)
```

`app/api/*/route.js` handlers take over what `api/routes/*.php` +
`api/index.php` (front controller) + `api/router.php` do today. `api/core/Router.php`
and the PHP front-controller pattern are dropped entirely — Next's file-based
API routing replaces them.

## Key decisions

- **Single Next.js app, not a Turborepo/workspaces monorepo.** "Monorepo" here
  means *frontend + backend live in one app/one repo* (as opposed to today's
  split of `frontend/` + `api/` + legacy `lib/`), not a multi-package build
  system. There's no second app in *this* repo to share code with, so a
  workspaces setup would add tooling overhead with no payoff.
- **DB access via `mysql2`**, already a root dependency, talking to the same
  MariaDB `timeoptic` database over the same connection settings. No ORM —
  ports the existing hand-written SQL from `api/routes/*.php` /
  `api/core/Sql.php` as parameterized queries, matching current query shapes.
- **Reminder cron**: `api/cli/reminder.php` (invoked today via Windows Task
  Scheduler) becomes `app/api/cron/reminder/route.js`, still invoked by Windows
  Task Scheduler (or Hostinger's cron, if available on the target plan) hitting
  the URL on a schedule — same operational model, just an HTTP endpoint instead
  of a CLI script.
- **Auth/session**: none exists today (no login system in the current app per
  the explored code) — carried forward as-is, not introduced as part of this
  migration.
- **Legacy cleanup**: `api/`, `frontend/`, `lib/`, `public/`, `server.js`,
  `start-api.bat`, `start-web.bat` are deleted once the Next.js app reaches
  parity and is verified working.

## Migration approach

Port page-by-page and route-by-route, grouped by domain (bookings, cases,
customers, finance, orders, prescriptions, reports, shop, employees,
dashboard), so each domain slice is independently testable against the same
live `timeoptic` database before moving to the next. This mirrors the
existing `api/routes/*.php` split, which was itself chosen (per the current
README) to keep each domain's logic in one file instead of one 1,773-line
file — the same rationale carries over to `app/api/*/route.js`.

## Testing

- Each ported API route group verified against the real MariaDB `timeoptic`
  DB (same one XAMPP uses today) with the equivalent PHP endpoint as the
  behavioral reference — same request in, same response shape out.
- Each ported page checked in-browser at the two required breakpoints
  (iPad + desktop, per existing UI requirement) before being marked done.
- Booking → case-opening flow and the Telegram reminder path get an explicit
  end-to-end check, since they're the most stateful flows in the app.

## Deployment

- `npm run build && npm start` (Next's production server) as the Hostinger
  Node.js app entry point, replacing both `start-api.bat` and `start-web.bat`.
- Prerequisite to verify before this step: the chosen Hostinger plan supports
  a persistent Node.js process.
