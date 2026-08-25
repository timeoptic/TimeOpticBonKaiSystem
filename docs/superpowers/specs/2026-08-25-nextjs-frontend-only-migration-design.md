# TimeOptic Web — Frontend-Only Migration to Next.js

**Date:** 2026-08-25
**Status:** Approved for planning
**Supersedes:** `2026-08-25-nextjs-monorepo-migration-design.md` (that spec replaced the PHP
backend too; this one keeps it).

## Context

TimeOptic Web is the shop-management app for TimeOptic (glasses store), running
against an existing MariaDB `timeoptic` database (27 tables + 7 views, schema
predates this app and is not to be changed).

Current state:

- `api/` — PHP REST API, 85 endpoints across 18 route files. Live backend.
  **Not touched by this migration.**
- `frontend/` — React 19 + Vite 8 + React Router 7 SPA, 39 pages across 8
  domains (bookings, cases, customers, finance, orders, prescriptions,
  reports, shop) plus a top-level Dashboard and EmployeeList. **This is what
  gets replaced.**
- `lib/` + `public/` + `server.js` (repo root) — the original Node.js +
  vanilla JS version. Superseded, kept for reference/comparison. Out of
  scope, untouched.

## Goal

Replace `frontend/` (React + Vite) with a Next.js (App Router) app that
renders the same 39 pages and calls the same PHP REST API — a build-tool and
routing-model swap, not a backend or database change.

## Non-goals

- No changes to `api/` (PHP) or the MariaDB schema.
- No feature changes — like-for-like port of existing pages/behavior.
- No SSR. Every page keeps today's client-fetch pattern (`useAsync` + the API
  client), so behavior and the API contract stay identical. Next.js is used
  here for its file-based routing and dev tooling, not its server rendering.
- Not addressing the separate "stock system" website, cross-domain/SSO, or
  hosting-provider choice (Hostinger vs. others) — those were discussed
  separately and don't affect this migration's design.

## Key decisions

- **Static export (`next export`-equivalent output), not a Node server.**
  `next.config.js` sets `output: 'export'`. The build produces static
  HTML/CSS/JS the same way `vite build` produces `frontend/dist/` today —
  deployable to Apache (or any static host) with zero Node runtime at
  request time. This was chosen over real SSR because nothing in the app
  needs server rendering: every page already fetches its data client-side
  from the PHP API, and static export keeps the "no Node in production"
  deploy story identical to what the project has today, which matters given
  the target host (Hostinger) may not have a Node-capable plan.
- **File-based routing replaces the central `<Routes>` table.** Each page in
  `frontend/src/pages/**/*.jsx` becomes `app/<route>/page.jsx`. Dynamic
  segments (`/customers/:id`) become `app/customers/[id]/page.jsx`. The
  `TITLES`/`crumbFor` breadcrumb table and the `Shell` component move
  together, same as previously planned for the monorepo version — `Shell`
  computes its own crumb from `usePathname()` instead of receiving it from a
  parent route table.
- **`react-router-dom` is dropped**; `next/link`'s `Link` and
  `next/navigation`'s `usePathname`/`useRouter` replace `Link`/`NavLink`/
  `useLocation`/`useNavigate` everywhere they're used.
- **API base URL becomes configurable**, since Next's static export can't
  proxy `/api/*` to PHP the way Vite's dev server did (`vite.config.js`'s
  `server.proxy`). `lib/apiClient.js` reads a base URL from
  `NEXT_PUBLIC_API_ORIGIN` (default `http://127.0.0.1:8080` in dev, matching
  today's PHP dev server address) and prefixes every request with it. In
  production, `NEXT_PUBLIC_API_ORIGIN` is left empty so requests stay
  relative (`/api/...`), which works when Apache serves the Next.js static
  build and `api/` from the same origin, exactly like `frontend/dist/` does
  today.
- **CORS**: `api/core/Http.php`'s allowed-origins list gains the Next dev
  server's origin (`http://localhost:3000`) alongside the existing Vite one,
  so local development works against the real PHP API. This is the one line
  touched in `api/` — everything else there is untouched.
- **All shared client code ports with import-path changes only** — no logic
  changes: `lib/format.js`, `lib/constants.js`, `lib/hooks.js`,
  `api/client.js` → `lib/apiClient.js`, `api/meta.jsx` → `contexts/
  MetaContext.jsx`, and every component in `frontend/src/components/`.

## Target structure

```
timeoptic-web/
├── frontend-next/                (new Next.js app; frontend/ deleted once
│   ├── app/                       this reaches parity and is verified)
│   │   ├── layout.jsx             root layout: <html lang="th">, metadata/favicon
│   │   ├── globals.css            copy of frontend/src/styles/app.css
│   │   ├── providers.jsx          Toast/Confirm/Meta providers + Shell
│   │   ├── page.jsx               Dashboard
│   │   ├── employees/page.jsx
│   │   ├── customers/
│   │   │   ├── page.jsx             list
│   │   │   ├── new/page.jsx
│   │   │   └── [id]/
│   │   │       ├── page.jsx          detail
│   │   │       └── edit/page.jsx
│   │   ├── prescriptions/ ...     (same nesting pattern per domain)
│   │   ├── bookings/ ...
│   │   ├── cases/ ...
│   │   ├── lens-tracker/page.jsx
│   │   ├── orders/ ...
│   │   ├── sales/ ...
│   │   ├── stock/ ...
│   │   ├── locations/page.jsx
│   │   ├── suppliers/page.jsx
│   │   ├── income/page.jsx
│   │   ├── expense/page.jsx
│   │   ├── settings/page.jsx
│   │   ├── reports/ ...
│   │   └── print/
│   │       ├── order/[id]/page.jsx
│   │       └── prescription/[id]/page.jsx
│   ├── components/                ui.jsx, DataTable.jsx, Selects.jsx, Shell.jsx,
│   │                               Toast.jsx, Confirm.jsx, Picker.jsx, RxTable.jsx,
│   │                               StatusChip.jsx, StockPicker.jsx
│   ├── contexts/MetaContext.jsx
│   ├── lib/
│   │   ├── apiClient.js            fetch wrapper with NEXT_PUBLIC_API_ORIGIN prefix
│   │   ├── format.js, constants.js, hooks.js
│   ├── next.config.js              output: 'export'
│   └── package.json
├── api/                           unchanged, except one CORS origin added
├── lib/  public/  server.js       unchanged (legacy Node reference)
└── frontend/                      deleted once frontend-next/ reaches parity
```

`frontend-next/` is a new sibling directory during migration (so the working
Vite app stays available for side-by-side comparison), renamed to
`frontend/` (replacing the old one) once every domain is ported and verified.

## Migration approach

Port page-by-page, grouped by domain, same order the existing
`frontend/src/pages/` folders already use (bookings, cases, customers,
finance, orders, prescriptions, reports, shop) plus the two top-level pages
(Dashboard, EmployeeList). Foundation first (scaffold + shared lib/components
+ providers + one pilot domain), then one plan per remaining domain.

## Testing

- Each ported page checked in-browser against the equivalent page in the
  still-running Vite app, both pointed at the same real PHP API + MariaDB —
  same data, same layout, same actions (add/edit/toggle) producing the same
  result.
- Required breakpoints: **1920×1080** (desktop), **810×1080** (iPad
  portrait), **1080×810** (iPad landscape) — verified with Chrome headless
  DevTools Protocol screenshots before any page task is marked done.
- No unit tests needed for pure UI ports (no new logic); `lib/format.js`
  keeps whatever test coverage it's given during the port since its
  functions are pure and cheap to verify.

## Deployment

- `npm run build` in `frontend-next/` produces a static `out/` directory
  (Next's static-export output), deployed the same way `frontend/dist/` is
  today: copied alongside `api/` under Apache's document root, no Node
  process required at runtime.
- Dev: `npm run dev` (Next dev server, default port 3000) alongside
  `start-api.bat` (PHP on :8080); `NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:8080`
  in `frontend-next/.env.local` points the app at the PHP API since static
  export has no dev-time proxy.
