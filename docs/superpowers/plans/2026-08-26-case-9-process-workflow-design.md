# Case 9-Process Workflow — Design Proposal

> Status: PROPOSAL — not yet approved, not yet an executable plan. Written to
> answer "investigate first, then propose a restructuring plan before coding"
> for the frontend-next + api/ (PHP) stack.

**Scope target:** `frontend-next/` + `api/` (PHP). Legacy Node app
(`server.js`/`lib/`/`public/`) and `frontend/` (old React) are out of scope —
not touched by this plan.

## 0. Headline finding

This is **not a greenfield build**. The live DB and PHP backend already
implement ~70% of the 9-process spec — this predates the stock-schema work
done earlier this session and was never surfaced because that work only
touched inventory tables. Concretely, these tables/routes already exist and
are already wired to frontend-next panels:

| Process | Existing table(s) | Existing route(s) |
|---|---|---|
| 1. เปิด Case | `cases`, `case_statuses` | `cases.php`: POST/PUT/status |
| 2. วัดสายตา | `prescriptions` (OD/OS split, `kind` old/measured/final, `based_on_id` lineage, old-glasses fields) | `prescriptions.php` |
| 3. ขาย | `custom_orders` (`lens_product_id`+`right_lens_product_id` already OD/OS split) | `orders.php` |
| 4. Center Point | `centerings` (PD/height split, vertex, panto) + `frame_fittings` (ED/DBL/lens_width/bridge_width) | `workflow.php` |
| 5. ชำระเงิน | `payments` | `payments.php` |
| 6. ผลิต | `production_jobs`, `lens_jobs` | `workflow.php`, `lens_jobs.php` |
| 7. QC | `qc_checks` (append-only, attempt-numbered) | `workflow.php` |
| 8. ส่งมอบ | `production_jobs.pickup_at/handed_over_by` (partial) | `workflow.php` |
| 9. จบ Case | `cases.closed_at/cancelled_reason` (partial) | `cases.php` |
| Audit log | `case_events` (case_id, from/to status, action, entity, entity_id, employee_id, note, payload — append-only) | `logEvent()` in `Helpers.php`, called from every mutating route above |

**The non-linear exam↔sales requirement is already satisfied at the DB/API
layer**: `setStatus()` (`api/core/Sql.php:75`) only checks the target status
code exists — it does **not** enforce `sort_order` sequencing. Moving a case
backward or skipping stages already works today. `sort_order` is display-only.

So this plan is **"fill the gaps," not "design 9 processes from scratch."**
The gaps are real and substantial (mostly on the frontend-next side), but the
data model doesn't need to be reinvented.

## 1. Gap list (what's actually missing)

### 1a. Backend — new columns (additive, no drops, matches "ใช้โครงสร้างเดิมให้มากที่สุด")

| # | Gap | Fix |
|---|---|---|
| G1 | 9 processes want 9 own statuses; today `stage_group` has 7 values, folding center-point into `sales` and payment into `sales`/`production` | Add `centering` and `payment` as their own `stage_group` values on the relevant existing `case_statuses` rows (data change, not schema change — `stage_group` is just a varchar column, no enum constraint found). No new table. |
| G2 | Orders: no server-side Net Total calc, no per-line price breakdown, no clamp-at-0 | Add columns to `custom_orders`: `frame_price`, `lens_od_price`, `lens_os_price`, `options_price` (all decimal, default 0). `total_price` becomes a server-computed sum of these; `net_total = GREATEST(total_price - discount, 0)` enforced in `orderVals()`, not trusted from client. |
| G3 | Center point: A/B frame-box dims not stored anywhere | Add `frame_box_a`, `frame_box_b` decimal columns to `frame_fittings` (where ED/DBL/lens_width/bridge_width already live). |
| G4 | QC: `check_lens`/`check_frame` are single booleans, spec wants OD/OS split for lens | Add `check_lens_od`, `check_lens_os` boolean columns to `qc_checks`; keep old `check_lens` column in place (unused going forward) so existing history rows stay valid — never rewritten, per "ห้ามลบประวัติ QC". |
| G5 | Payments: no slip attachment | **No new column needed** — `case_photos` already has a `payment_id` FK column, unused (0 rows). Wire the new upload endpoint (G7) to accept `payment_id`. |
| G6 | Payments: hard `DELETE`, spec wants soft-cancel so "รับแล้ว" excludes cancelled | Add `cancelled_at`, `cancelled_by`, `cancel_reason` columns to `payments`. Change the DELETE route to a cancel (UPDATE, not delete). Update every `SUM(amount)` site (`caseDetail()`, `orderDetail()`, `Sql::ORDER_SELECT`'s `pay` subquery) to add `AND cancelled_at IS NULL`. |
| G7 | No file/image upload anywhere in the PHP backend | New `api/routes/uploads.php`: `POST /api/uploads` (multipart, `$_FILES`), validates case_id + optional `centering_id`/`payment_id`/`kind`, saves to `api/uploads/<case_id>/<uuid>.<ext>` (new gitignored dir, mirroring how `backups/` is already gitignored), inserts into existing `case_photos` table, returns a servable URL. `GET /api/uploads/:id` or a static file route to serve them. |
| G8 | Production: no stock-transaction hook, no "เบิกเพิ่ม", no "หยุดการผลิต/รอสินค้า" state | Add columns to `production_jobs`: `status` enum(`WAITING_FOR_ITEMS`,`READY_TO_PRODUCE`,`IN_PRODUCTION`,`WAITING_FOR_ITEM`,`COMPLETED`) default `WAITING_FOR_ITEMS`, `started_at`, `started_by`. New table `production_withdrawals` (`id, case_id, production_job_id, item_type` enum(`frame`,`lens_od`,`lens_os`), `stock_lot_id, inventory_log_id, is_extra` bool, `reason, withdrawn_by, withdrawn_at`) — each row created by calling the existing `pickLot()` and logging which item/why. "หยุดการผลิต" writes `status='WAITING_FOR_ITEM'` + a `case_events` row (already generic enough, no new table needed for the pause reason — goes in `note`). |
| G9 | Delivery: no customer-side recipient name | Add `received_by_customer_name` varchar column to `production_jobs` (reuses existing `pickup_at`/`handed_over_by` for the rest). |
| G10 | Close case: no `closed_by` | Add `closed_by` employee FK column to `cases` (`closed_at` already exists). `final_note` can reuse the existing `cases.notes` field — no new column. |

All of G1–G10 are additive (`ADD COLUMN`/`CREATE TABLE`, no `DROP`/no type
changes to existing columns) — consistent with this session's standing rule
of never touching live data destructively, and with `lib/migrate.js`'s own
proven `information_schema`-guarded idempotent pattern (same technique should
be used for the PHP-side migration, run once via a small guarded script, not
a raw hand-run `ALTER TABLE`).

### 1b. Backend — route changes

- `orders.php`: `orderVals()` gets the server-side price-sum + clamp logic (G2).
- `payments.php`: DELETE → soft-cancel (G6); every payment-sum query gets the `cancelled_at IS NULL` filter.
- `workflow.php`: production-jobs endpoints extended for start/withdraw-extra/pause/resume (G8); qc-checks extended for split lens columns (G4); frame-fittings extended for A/B (G3).
- New `uploads.php` (G7).
- `Lookups::caseStatuses()` needs no code change — it already returns whatever's in the table, so G1's data-only edit is picked up automatically.

### 1c. Frontend-next — this is the larger half of the work

Confirmed nothing exists yet for: **orders/sales pages, a stock/product
picker, a photo uploader, a delivery panel, a close-case panel.** Existing
panels (`RxPanel`, `LensPanel`, `ProductionPanel`, `PaymentPanel`,
`NotifyPanel`, `TimelinePanel` under `app/cases/detail/panels/`) already
call most of the routes above and need extending, not replacing.

| # | New/changed | Notes |
|---|---|---|
| F1 | `app/orders/` (new: list, detail, new, edit) + a `SalesPanel` inside case-detail | Frame picker + separate Lens OD / Lens OS pickers (reusing `components/Picker.jsx`), shows available prescriptions (old/measured/external) with source labelled, live Frame+LensOD+LensOS+Options→Net Total calc mirroring G2 server-side logic, discount input, note field. |
| F2 | `components/StockPicker.jsx` (new) | Thin wrapper over `Picker.jsx` hitting `GET /api/stock` (already fixed this session) — shared by Sales (F1) and Production's start/withdraw-extra (F5). |
| F3 | `components/PhotoUpload.jsx` (new — no existing base in the repo) | Multi-file input + preview grid, posts to G7's `/api/uploads`, used by Center Point (Process 4) and optionally Payment (slip). |
| F4 | `panels/CenteringPanel.jsx` extension (currently folded into `ProductionPanel.jsx`) | Add A/B inputs, wire `PhotoUpload`, show the selected Frame from the Sales panel for reference (already available via `c.order`). |
| F5 | `panels/ProductionPanel.jsx` rework | "เริ่มผลิต" button disabled until frame+lens_od+lens_os all resolvable in stock (checks `GET /api/stock` availability), on click calls a new start endpoint that runs `pickLot()`×3 + sets `started_at/by`. "เบิกเพิ่ม" button opens a popup (item picker + reason) → new withdrawal endpoint. "หยุดการผลิต" sets `WAITING_FOR_ITEM` + reason; a "กลับมาผลิตต่อ" action clears it. |
| F6 | `panels/QcPanel.jsx` (split out of `ProductionPanel.jsx`) | Adds OD/OS lens checks (G4), FAIL result routes back to `production` stage_group via existing non-order-enforced `setStatus()`. |
| F7 | `panels/DeliveryPanel.jsx` (new) | Lists QC-passed cases ready for delivery (reuses `GET /api/cases?stage_group=delivery`), records recipient name/who delivered/when. |
| F8 | `panels/ClosePanel.jsx` (new) | Pre-close checklist (sale done / production done / QC pass / delivered / payment condition met — computed client-side from `c.order`, `c.production`, `c.qc_checks`, `c.payments`, `c.notifications`, all already returned by `caseDetail()`), then calls `status` with the terminal `completed` code + `closed_by`. |
| F9 | `app/cases/detail/page.jsx` — the 9-step dashboard | Replace the current 7-stage stepper with 9 steps (adding centering + payment per G1), each step shows its own process status (not just case-wide status) using the per-process data already in `caseDetail()`'s response (`c.centering`, `c.payments`, `c.production`, `c.qc_checks`, etc.) rather than inferring from `case.status` alone — this directly satisfies the "แต่ละ Process มีสถานะของตัวเอง" requirement without new backend work, since the data is already there per-process. |
| F10 | `contexts/MetaContext.jsx` | No change expected — `meta.statuses` already carries `stage_group`; G1 is a data-only edit picked up automatically. |
| F11 | 9 dedicated sidebar list pages (`app/exam/`? — reuse existing where a domain page already fills the role: e.g. Process 6 "ผลิต" = a filtered case list by stage_group, not a whole new domain) | Confirmed by the user-supplied reference mockup: each process also gets its own top-level sidebar entry showing a list of cases currently at that stage (mirrors the original spec's "หน้าแรกของ Production ให้แสดงเป็นรายการงานตัดแว่นทั้งหมด" requirement for Process 6, generalized to all 9). Implementation: one shared `ProcessCaseList` component parameterized by `stage_group`, reusing `GET /api/cases?stage_group=X&open=1` (already supports this filter) — not 9 bespoke pages. |

### UI reference (user-supplied mockup, structure only — palette/theme NOT adopted, stays on this app's existing teal palette)

- **Case-detail header**: breadcrumb (กระดานงาน / รายละเอียดเคส) → case code + type/goal badge (e.g. `SIGHTFIRST`) → customer name → opened-at + received-by + phone line → พิมพ์ใบงาน / แชร์ / แก้ไขข้อมูลเคส actions.
- **9-step horizontal stepper**: numbered 01–09, each step shows its label, the date/time + employee who completed it (when done), and a sub-status pill for the current step (e.g. "ชำระบางส่วน" under step 05). Confirms F9's per-process-status direction.
- **Status legend — 6 states, richer than the original spec's 5**: เสร็จแล้ว (done/check) · กำลังดำเนินการ (in-progress/spinner) · รอ (waiting/hourglass) · ยังไม่เริ่ม (not-started/empty circle) · มีปัญหา (problem/exclamation) · ส่งกลับมาแก้ไข (sent-back-to-fix/undo arrow). The last one is new versus the original NOT_STARTED/IN_PROGRESS/WAITING/COMPLETED/CANCELLED list and maps directly onto QC's fail→back-to-production bounce (§1c F6) — adopt this 6-state model as the shared per-process status vocabulary instead of the narrower 5 from the original spec text.
- **Tabs row below the stepper**: ภาพรวม (overview) / วัดสายตา / การขาย / Center Point / การเงิน / ผลิต / QC / ส่งมอบ / Timeline — 7 process tabs (skips รับลูกค้า/จบงาน, which live in the header actions instead) + overview + timeline, matching F1–F8's panel set.
- **Overview tab** (default): 2-column card grid — ข้อมูลลูกค้า, ข้อมูลเคส (type/channel/received-by/opened-at/note), สินค้าที่เลือก (3-up: frame / lens OD / lens OS, each with brand/model/SKU/index/coating/price — directly matches `custom_orders`' already-split fields), สรุปการชำระเงิน (Net Total/รับแล้ว/คงเหลือ/สถานะ pill + a payment-history table, matching the "before vs after first payment" display rule from §1c F1/G6 already), หมายเหตุจากเคส, กิจกรรมล่าสุดในเคส (recent `case_events`, "ดูทั้งหมด" linking to the Timeline tab). Every field shown here is already present in `caseDetail()`'s existing response shape — this tab is a pure presentation task, no new backend field required.

## 2. Rulings made in this proposal (per the session's "rulings not stalls" norm — flag for override, not blocking)

- **R1**: `stage_group` gets 2 new values (`centering`, `payment`) via a data
  UPDATE on existing `case_statuses` rows, not a schema change and not a new
  status-code taxonomy. Cheapest path to "9 trackable processes," reuses
  100% of existing status-transition code.
- **R2**: Photo storage is local disk under a new gitignored `api/uploads/`
  dir, served by a small PHP static-file route — no S3/cloud storage, matching
  this app's existing single-server deployment model and the "reuse existing
  structure" instruction. Revisit only if disk space or multi-server
  deployment becomes a real constraint later.
- **R3**: Payment cancellation is soft (new columns), not a hard delete —
  required by the spec's own "รับแล้ว = ผลรวม Payment ที่ไม่ถูก Cancel" wording,
  which presupposes cancelled rows still exist.
- **R4**: QC's lens split adds new columns rather than repurposing the old
  `check_lens` column, so historical QC rows are never rewritten.
- **R5**: "เบิกเพิ่ม" gets its own `production_withdrawals` table rather than
  extending `inventory_logs` — `inventory_logs` stays the low-level stock
  ledger (already correct, don't touch it, per this session's earlier stock
  work being explicitly closed out); `production_withdrawals` is the
  case/production-facing view of "why was this withdrawn," referencing the
  `inventory_logs` row(s) it caused.

## 3. Explicitly out of scope for this plan

- `frontend/` (old React) and the legacy Node app (`server.js`/`lib/`/`public/`)
  — per the user's stack choice this turn.
- Reworking `sales`/`v_sale_history` (the separate legacy quick-sale table
  with the already-broken view found during DB investigation) — unrelated
  table, flagged as a pre-existing issue, not part of this feature.
- Any change to `inventory_logs`, `stock_lots`, `products`, `categories` —
  already fixed and closed out this session; this plan only *calls*
  `pickLot()`/`releaseLot()`, never modifies them.

## 4. Suggested execution shape (if approved)

Given the size (10 additive schema changes across 2 tables + 2 new tables,
~5 route files touched + 1 new route file, ~10 new/changed frontend-next
files including 2 genuinely new shared components with no existing base),
this should run as its own `writing-plans` → `subagent-driven-development`
cycle, broken into per-process tasks (roughly one task per gap-table row in
§1a paired with its §1c frontend row), same pattern as the stock-schema-fix
plan just completed. Recommend running the DB migration script (idempotent,
`information_schema`-guarded) as its own first task, verified against the
live DB before any route/frontend task touches the new columns.

**Not started — awaiting go-ahead on this proposal before writing the
full task-by-task plan.**
