# Case 9-Process Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `frontend-next/` + `api/` (PHP) so every Case tracks all 9
processes (intake, exam, sales, center-point, payment, production, QC,
delivery, close) with its own per-process status, full audit trail, and
non-linear ordering between exam/sales.

**Architecture:** ~70% of this already exists (see the design doc below) —
this plan is additive: new columns/tables, new endpoints on existing route
files, 2 new route files worth of endpoints, and a large frontend-next
buildout (new shared components, a new Orders domain, new/expanded
case-detail panels, a reworked 9-step case-detail dashboard, and 8 new
per-process list pages). No existing table is dropped or has a column type
changed; no existing route's current behavior changes except where a task
explicitly says so.

**Tech Stack:** PHP 8 (no framework, the `api/` router seen in this repo),
MariaDB, Next.js 15 App Router / React (static export, client components).

**Spec:** `docs/superpowers/plans/2026-08-26-case-9-process-workflow-design.md`
(the investigation + design proposal this plan implements — read it first for
the *why*; this document is the *how*).

## Global Constraints

- **Additive DB only**: every schema change is `ADD COLUMN` (with a default)
  or `CREATE TABLE IF NOT EXISTS`. Never `DROP`, never change an existing
  column's type. Follow `api/services/Migrate.php`'s existing idempotent
  pattern (guard every change with an `information_schema` check) — do not
  hand-run a raw `ALTER TABLE` outside that guarded script.
- **Stock never moves except through `pickLot()`/`releaseLot()`**
  (`api/core/Helpers.php`) — these are already correct and already tested
  this session. No task in this plan edits `inventory_logs`, `stock_lots`,
  `products`, or `categories` directly.
- **Every case mutation logs through `logEvent()`/`setStatus()`**
  (`api/core/Sql.php`) exactly as every existing route already does. A new
  endpoint that changes case state and does NOT call one of these is a bug.
- **Reuse `upsertFactory()`** (`api/core/Sql.php:110`) for any new one-row-
  per-case table update, exactly as `centerings`/`frame_fittings`/
  `production_jobs` already do.
- **`Db::tx()` / `Tx` / `bad()` / `missing()`** are the only transaction and
  error primitives — never `die()`, never a bare `echo`.
- **Frontend conventions, no exceptions**: `readForm()`/`onSubmit()`
  (`lib/hooks.js`), `useAsync()` for all data loads, `api.get/post/put/del`
  (`lib/apiClient.js`), `useToast()` for all success/error feedback,
  `useConfirm()` before any destructive action, `DataTable`/`Picker`/
  `FormGrid`/`Field`/`Card`/`Badge` (`components/ui.jsx`, `DataTable.jsx`,
  `Picker.jsx`) for all new UI — do not introduce a new form or table
  pattern. Every new panel/page must look and behave like
  `PaymentPanel.jsx`/`ProductionPanel.jsx` (already read in full — mirror
  their exact structure).
- **Teal palette only** — no new CSS colors, no theme change. Reuse existing
  classes from `globals.css` (`.card`, `.stepper`, `.step`, `.badge`, etc.);
  only add new CSS if a genuinely new shape is needed (documented per-task
  below where that happens).
- **6-state process-status vocabulary** (from the user-supplied UI
  reference): `done` (เสร็จแล้ว) / `in_progress` (กำลังดำเนินการ) / `waiting`
  (รอ) / `not_started` (ยังไม่เริ่ม) / `problem` (มีปัญหา) / `sent_back`
  (ส่งกลับมาแก้ไข). This is computed **client-side** per process from the
  data `caseDetail()` already returns (see Task 14) — it is not a new DB
  enum, except the 2 places this plan adds a real `status` column
  (`production_jobs.status` in Task 1, `payments` soft-cancel in Task 4).
- **Out of scope, do not touch**: `frontend/` (old React app), the legacy
  Node app (`server.js`/`lib/`/`public/`), `inventory_logs`/`stock_lots`/
  `products`/`categories` schema, the `sales`/`v_sale_history` legacy
  quick-sale table.
- **Verification convention** (matches this session's already-completed
  stock-backend-schema-fix plan): PHP tasks verify via `curl` against a
  locally-started `php -S` instance on a scratch port + a direct SQL check
  of the resulting rows — never trust the response body alone. Frontend
  tasks verify via a live browser (Chrome headless/CDP or Playwright)
  against the real dev API, screenshot both desktop (1280px+) and iPad
  (810px) widths, check for zero console errors.
- **This plan runs directly on `main`**, matching every prior plan executed
  in this repo this session (no worktree) — commit after each task, per-task
  review, continuous execution, no pausing between tasks.

---

### Task 1: Additive DB migration for all 9 processes

**Files:**
- Modify: `api/services/Migrate.php`

**Interfaces:**
- Produces (for every later task): `custom_orders.{frame_price,lens_od_price,lens_os_price,options_price}`,
  `frame_fittings.{frame_box_a,frame_box_b}`, `qc_checks.{check_lens_od,check_lens_os}`,
  `payments.{cancelled_at,cancelled_by,cancel_reason}`,
  `production_jobs.{status,started_at,started_by,received_by_customer_name}`,
  `cases.closed_by`, new table `production_withdrawals`, and a data-only
  update making `case_statuses.stage_group` = `'centering'` for code
  `centering` and `'payment'` for code `payment` (both codes already exist,
  currently grouped under `sales`).

- [ ] **Step 1: Add an additive-column helper to `Migrate`**

In `api/services/Migrate.php`, add this private method to the `Migrate`
class (alongside the existing `tables()`/`run()`):

```php
    /** @return string[] "table.column" names actually added this run */
    private static function addColumns(string $table, array $columns): array
    {
        $added = [];
        foreach ($columns as $name => $ddl) {
            $exists = Db::get(
                'SELECT COUNT(*) n FROM information_schema.columns
                  WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
                $table,
                $name
            );
            if (!(int) ($exists['n'] ?? 0)) {
                Db::pdo()->exec("ALTER TABLE `$table` ADD COLUMN `$name` $ddl");
                $added[] = "$table.$name";
            }
        }
        return $added;
    }
```

- [ ] **Step 2: Add the new `production_withdrawals` table to `tables()`**

Inside `Migrate::tables()`'s returned array, add a new entry (same style as
the existing `bookings`/`booking_notes`/`notification_log` entries):

```php
            /* every stock item pulled for a case's production — the initial
               pickLot() calls at "เริ่มผลิต" and any later "เบิกเพิ่ม" */
            'production_withdrawals' => "CREATE TABLE IF NOT EXISTS production_withdrawals (
                id                int(10) unsigned NOT NULL AUTO_INCREMENT,
                case_id           int(10) unsigned NOT NULL,
                production_job_id int(10) unsigned DEFAULT NULL,
                item_type         varchar(20) NOT NULL,
                stock_lot_id      int(10) unsigned DEFAULT NULL,
                is_extra          tinyint(1) NOT NULL DEFAULT 0,
                reason            varchar(255) DEFAULT NULL,
                withdrawn_by      int(10) unsigned DEFAULT NULL,
                withdrawn_at      datetime NOT NULL DEFAULT current_timestamp(),
                PRIMARY KEY (id),
                KEY idx_pw_case (case_id),
                KEY fk_pw_job (production_job_id),
                KEY fk_pw_lot (stock_lot_id),
                KEY fk_pw_emp (withdrawn_by),
                CONSTRAINT fk_pw_case FOREIGN KEY (case_id) REFERENCES cases (id) ON DELETE CASCADE,
                CONSTRAINT fk_pw_job  FOREIGN KEY (production_job_id) REFERENCES production_jobs (id) ON DELETE SET NULL,
                CONSTRAINT fk_pw_lot  FOREIGN KEY (stock_lot_id) REFERENCES stock_lots (id) ON DELETE SET NULL,
                CONSTRAINT fk_pw_emp  FOREIGN KEY (withdrawn_by) REFERENCES employees (id) ON DELETE SET NULL
              ) $c",
```

(`$c` is the existing `self::CHARSET` constant already used by every other
entry in that array — keep using it, don't hardcode the charset string.)

- [ ] **Step 3: Call `addColumns()` for every table from `run()`**

In `Migrate::run()`, after the existing `foreach (self::tables() ...)` loop
and before the `DEFAULT_SETTINGS` loop, add:

```php
        $added = array_merge(
            self::addColumns('custom_orders', [
                'frame_price'    => 'decimal(10,2) NOT NULL DEFAULT 0',
                'lens_od_price'  => 'decimal(10,2) NOT NULL DEFAULT 0',
                'lens_os_price'  => 'decimal(10,2) NOT NULL DEFAULT 0',
                'options_price'  => 'decimal(10,2) NOT NULL DEFAULT 0',
            ]),
            self::addColumns('frame_fittings', [
                'frame_box_a' => 'decimal(6,2) DEFAULT NULL',
                'frame_box_b' => 'decimal(6,2) DEFAULT NULL',
            ]),
            self::addColumns('qc_checks', [
                'check_lens_od' => 'tinyint(1) NOT NULL DEFAULT 0',
                'check_lens_os' => 'tinyint(1) NOT NULL DEFAULT 0',
            ]),
            self::addColumns('payments', [
                'cancelled_at'  => 'datetime DEFAULT NULL',
                'cancelled_by'  => 'int(10) unsigned DEFAULT NULL',
                'cancel_reason' => 'varchar(255) DEFAULT NULL',
            ]),
            self::addColumns('production_jobs', [
                'status'                    => "varchar(30) NOT NULL DEFAULT 'WAITING_FOR_ITEMS'",
                'started_at'                => 'datetime DEFAULT NULL',
                'started_by'                => 'int(10) unsigned DEFAULT NULL',
                'received_by_customer_name' => 'varchar(120) DEFAULT NULL',
            ]),
            self::addColumns('cases', [
                'closed_by' => 'int(10) unsigned DEFAULT NULL',
            ])
        );
        Db::run("UPDATE case_statuses SET stage_group = 'centering' WHERE code = 'centering'");
        Db::run("UPDATE case_statuses SET stage_group = 'payment' WHERE code = 'payment'");
        $created = array_merge($created, $added);
```

(`$created` is the existing local variable the function already builds and
returns — just extend it rather than adding a second return value.)

- [ ] **Step 4: Verify against the live DB**

Trigger `Migrate::run()` the same way the app already does on every request
(it's already called somewhere in the request path — find that call site,
don't add a new one). Confirm via direct SQL:

```sql
SELECT COLUMN_NAME FROM information_schema.columns
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN
   ('custom_orders','frame_fittings','qc_checks','payments','production_jobs','cases')
   AND COLUMN_NAME IN ('frame_price','lens_od_price','lens_os_price','options_price',
     'frame_box_a','frame_box_b','check_lens_od','check_lens_os',
     'cancelled_at','cancelled_by','cancel_reason',
     'status','started_at','started_by','received_by_customer_name','closed_by');
-- expect 16 rows
SELECT COUNT(*) FROM information_schema.tables
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_withdrawals'; -- expect 1
SELECT code, stage_group FROM case_statuses WHERE code IN ('centering','payment');
-- expect stage_group = 'centering' and 'payment' respectively
```

Run `Migrate::run()` a second time and confirm it makes zero changes
(idempotency — matches the existing `bookings`/`booking_notes` tables'
already-proven behavior).

- [ ] **Step 5: Commit**

```bash
git add api/services/Migrate.php
git commit -m "Add additive schema for the 9-process case workflow"
```

---

### Task 2: Server-side Net Total computation on orders

**Files:**
- Modify: `api/routes/orders.php`

**Interfaces:**
- Consumes: `custom_orders.{frame_price,lens_od_price,lens_os_price,options_price}` (Task 1).
- Produces: `POST /api/orders` and `PUT /api/orders/:id` now reject a
  discount larger than the computed total (`bad('ส่วนลดห้ามมากกว่ายอดรวม')`),
  and recompute `total_price` server-side whenever any of the 4 new price
  fields are present in the request body.

- [ ] **Step 1: Add the 4 new columns to `ORDER_COLS`/`MONEY_ORDER_COLS`**

In `api/routes/orders.php`, extend the existing constants (currently at
lines 10–21):

```php
const ORDER_COLS = ['case_id', 'customer_id', 'employee_id', 'recorded_by',
    'final_prescription_id', 'order_date', 'appointment_date', 'appointment_time',
    'lens_type', 'frame_product_id', 'frame_name', 'frame_brand', 'frame_model',
    'frame_color', 'frame_size', 'frame_sku', 'lens_product_id', 'right_lens_product_id',
    'lens_name', 'lens_brand', 'lens_design', 'lens_index', 'lens_coating', 'lens_tint',
    'lens_addons', 'frame_price', 'lens_od_price', 'lens_os_price', 'options_price',
    'total_price', 'discount', 'deposit', 'deposit_pay_type',
    'marketing', 'notes'];

const INT_ORDER_COLS = ['case_id', 'customer_id', 'employee_id', 'recorded_by',
    'final_prescription_id', 'frame_product_id', 'lens_product_id', 'right_lens_product_id'];

const MONEY_ORDER_COLS = ['frame_price', 'lens_od_price', 'lens_os_price', 'options_price',
    'total_price', 'discount', 'deposit'];
```

- [ ] **Step 2: Recompute `total_price` and validate the discount inside `orderVals()`**

Replace the existing `orderVals()` function body with:

```php
function orderVals(array $b): array
{
    $hasBreakdown = array_key_exists('frame_price', $b) || array_key_exists('lens_od_price', $b)
        || array_key_exists('lens_os_price', $b) || array_key_exists('options_price', $b);
    if ($hasBreakdown) {
        $b['total_price'] = num($b['frame_price'] ?? null) + num($b['lens_od_price'] ?? null)
            + num($b['lens_os_price'] ?? null) + num($b['options_price'] ?? null);
    }
    $total    = num($b['total_price'] ?? null);
    $discount = num($b['discount'] ?? null);
    if ($discount > $total) {
        bad('ส่วนลดห้ามมากกว่ายอดรวม');
    }

    $out = [];
    foreach (ORDER_COLS as $c) {
        if (in_array($c, INT_ORDER_COLS, true)) {
            $out[] = int_or($b[$c] ?? null);
        } elseif (in_array($c, MONEY_ORDER_COLS, true)) {
            $out[] = num($b[$c] ?? null);
        } elseif ($c === 'order_date') {
            $out[] = str_or($b['order_date'] ?? null) ?: nowStamp();
        } else {
            $out[] = nul($b[$c] ?? null);
        }
    }
    return $out;
}
```

(`total_price` stays in `ORDER_COLS`/`MONEY_ORDER_COLS` unchanged — this
just overwrites `$b['total_price']` in-place before the existing per-column
loop runs, so `PUT`'s full-overwrite behavior and `POST`'s insert both pick
up the recomputed value with no other call-site change.)

- [ ] **Step 3: Verify with curl + direct SQL**

Start `php -S 127.0.0.1:<scratch-port> -t api api/router.php`. POST an order
with `frame_price=1000&lens_od_price=500&lens_os_price=500&options_price=0&discount=200`
(real `customer_id`, `case_id` from the live DB) and confirm the response's
`total_price` is `2000` and `balance` is `1800`. POST the same with
`discount=5000` and confirm a 400 with the exact Thai message. Confirm via
direct SQL that the inserted row's `total_price` column is `2000.00`.

- [ ] **Step 4: Commit**

```bash
git add api/routes/orders.php
git commit -m "Compute custom_orders.total_price server-side from its price breakdown"
```

---

### Task 3: Center-point A/B fields and QC OD/OS split

**Files:**
- Modify: `api/routes/workflow.php`

**Interfaces:**
- Consumes: `frame_fittings.{frame_box_a,frame_box_b}`, `qc_checks.{check_lens_od,check_lens_os}` (Task 1).
- Produces: `POST /api/frame-fittings` accepts `frame_box_a`/`frame_box_b`;
  `POST /api/qc-checks` accepts `check_lens_od`/`check_lens_os` (in addition
  to, not replacing, the existing 5 boolean checks — `check_lens` keeps
  being written as `check_lens_od AND check_lens_os` so nothing reading the
  old combined field breaks).

- [ ] **Step 1: Add A/B to the frame-fittings `upsertFactory()` call**

In `api/routes/workflow.php`, in the existing `POST('/api/frame-fittings', upsertFactory([...]))`
call (currently lines 25–33), add `'frame_box_a'` and `'frame_box_b'` to the
`cols` array (right after `'dbl'`, before `'r_pd'`) — leave `intCols` alone
(these are decimals, handled by `nul()` like `ed`/`dbl` already are).

- [ ] **Step 2: Add the OD/OS QC columns to the `qc-checks` handler**

In the existing `POST('/api/qc-checks', ...)` handler (currently lines
59–103), change the `INSERT` to also write the 2 new columns and derive the
legacy combined one:

```php
POST('/api/qc-checks', function (array $req) {
    $body   = $req['body'];
    $caseId = int_or($body['case_id'] ?? null);
    if (!$caseId) {
        bad('กรุณาระบุเคส');
    }
    $result   = str_or($body['result'] ?? null) === 'fail' ? 'fail' : 'pass';
    $lensOd   = boolInt($body['check_lens_od'] ?? null);
    $lensOs   = boolInt($body['check_lens_os'] ?? null);

    $id = Db::tx(function (Tx $q) use ($body, $caseId, $result, $lensOd, $lensOs) {
        $a = $q->get('SELECT COALESCE(MAX(attempt),0) n FROM qc_checks WHERE case_id = ?', $caseId);
        $r = $q->run(
            'INSERT INTO qc_checks (case_id, job_id, attempt, result, action_taken,
               check_rx, check_centering, check_lens, check_lens_od, check_lens_os,
               check_frame, check_finish, defects, note, checked_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            $caseId,
            int_or($body['job_id'] ?? null),
            (int) $a['n'] + 1,
            $result,
            nul($body['action_taken'] ?? null),
            boolInt($body['check_rx'] ?? null),
            boolInt($body['check_centering'] ?? null),
            $lensOd && $lensOs ? 1 : 0,
            $lensOd,
            $lensOs,
            boolInt($body['check_frame'] ?? null),
            boolInt($body['check_finish'] ?? null),
            nul($body['defects'] ?? null),
            nul($body['note'] ?? null),
            int_or($body['checked_by'] ?? null)
        );
        logEvent($q, $caseId, [
            'action'      => 'qc_' . $result,
            'entity'      => 'qc_check',
            'entity_id'   => $r['insertId'],
            'employee_id' => int_or($body['checked_by'] ?? null),
            'note'        => nul($body['defects'] ?? null),
        ]);
        setStatus($q, $caseId, $result === 'pass' ? 'packing' : 'qc_failed', [
            'employee_id' => int_or($body['checked_by'] ?? null),
            'action'      => 'qc_' . $result,
        ]);
        return $r['insertId'];
    });

    return Db::get('SELECT * FROM qc_checks WHERE id = ?', $id);
});
```

- [ ] **Step 2: Verify with curl + direct SQL**

POST `/api/frame-fittings` with `frame_box_a=54&frame_box_b=32` (real
`case_id`) and confirm the response row has those values. POST
`/api/qc-checks` with `check_lens_od=1&check_lens_os=0` and confirm the row
has `check_lens_od=1, check_lens_os=0, check_lens=0` (AND of the two).

- [ ] **Step 3: Commit**

```bash
git add api/routes/workflow.php
git commit -m "Add center-point A/B fields and split QC lens check into OD/OS"
```

---

### Task 4: Soft-cancel payments instead of hard delete

**Files:**
- Modify: `api/routes/payments.php`, `api/routes/cases.php`, `api/routes/orders.php`, `api/core/Sql.php`

**Interfaces:**
- Consumes: `payments.{cancelled_at,cancelled_by,cancel_reason}` (Task 1).
- Produces: `DELETE /api/payments/:id` becomes a soft-cancel (still the same
  route/method — frontend-next's existing `api.del('/api/payments/' + p.id)`
  call in `PaymentPanel.jsx` keeps working unchanged); every place that sums
  `payments.amount` now excludes cancelled rows.

- [ ] **Step 1: Change `DELETE /api/payments/:id` to a soft-cancel**

In `api/routes/payments.php`, replace the existing `DELETE('/api/payments/:id', ...)`
handler (currently lines 89–112) with:

```php
DELETE('/api/payments/:id', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $p    = Db::get('SELECT * FROM payments WHERE id = ?', $id);
    if (!$p) {
        missing();
    }
    if ($p['cancelled_at']) {
        bad('รายการนี้ถูกยกเลิกไปแล้ว');
    }
    Db::tx(function (Tx $q) use ($id, $p, $body) {
        if ($p['order_id'] && $p['kind'] === 'deposit') {
            $q->run(
                'UPDATE custom_orders SET deposit = GREATEST(deposit - ?, 0) WHERE id = ?',
                (float) $p['amount'],
                (int) $p['order_id']
            );
        }
        $q->run(
            'UPDATE payments SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?',
            nowStamp(),
            int_or($body['employee_id'] ?? null),
            nul($body['reason'] ?? null),
            $id
        );
        logEvent($q, int_or($p['case_id']), [
            'action'    => 'payment_cancelled',
            'entity'    => 'payment',
            'entity_id' => $id,
            'note'      => (string) $p['amount'],
        ]);
    });
    return ['ok' => true];
});
```

- [ ] **Step 2: Exclude cancelled rows from every payment SUM**

In `api/routes/payments.php`'s `GET /api/payments` handler, add
`p.cancelled_at IS NULL` to the `$where` array unconditionally (as the first
entry, before the optional filters).

In `api/core/Sql.php`, change `ORDER_FROM`'s payment subquery (currently
line 24) from:
```php
      LEFT JOIN (SELECT order_id, SUM(amount) paid FROM payments
                 WHERE order_id IS NOT NULL GROUP BY order_id) pay ON pay.order_id = o.id';
```
to:
```php
      LEFT JOIN (SELECT order_id, SUM(amount) paid FROM payments
                 WHERE order_id IS NOT NULL AND cancelled_at IS NULL
                 GROUP BY order_id) pay ON pay.order_id = o.id';
```

In `api/routes/cases.php`'s `caseDetail()`, the `$payments` query (currently
lines 91–96) already returns every payment row for the panel's history
table (cancelled rows must still be visible there, per "ห้าม Update ทับจนข้อมูลเดิมหาย" —
don't filter this SELECT). Instead, change the `$paid = sumCol($payments, 'amount');`
line (currently line 123) to sum only non-cancelled rows:
```php
    $paid = sumCol(array_filter($payments, fn($p) => !$p['cancelled_at']), 'amount');
```

In `api/routes/orders.php`'s `close`/`reopen` handlers, the balance/paid
calculations already go through `Sql::ORDER_SELECT`'s `pay` subquery (fixed
above) or a direct `SUM(amount) FROM payments WHERE order_id = ?` in `close`
(currently line 267) — add `AND cancelled_at IS NULL` to that one query too.

- [ ] **Step 3: Verify with curl + direct SQL**

Create a payment, confirm it counts in `paid`. `DELETE` it, confirm the row
still exists in the DB with `cancelled_at` set (not gone), and confirm
`GET /api/cases/:id`'s `paid` no longer includes it while `payments[]` still
lists it (with `cancelled_at` present so the frontend can render a
"ยกเลิกแล้ว" state in Task 14).

- [ ] **Step 4: Commit**

```bash
git add api/routes/payments.php api/routes/cases.php api/routes/orders.php api/core/Sql.php
git commit -m "Soft-cancel payments instead of hard-deleting them"
```

---

### Task 5: Photo/file upload endpoint

**Files:**
- Create: `api/routes/uploads.php`
- Modify: `api/core/Http.php`, `api/index.php`, `.gitignore`

**Interfaces:**
- Consumes: `case_photos` table (already exists, 0 rows, unchanged by this task).
- Produces: `POST /api/uploads` (multipart), `GET /api/uploads/:id` (binary),
  `GET /api/uploads?case_id=` (list), `DELETE /api/uploads/:id` — used by
  Task 8's `PhotoUpload.jsx`.

- [ ] **Step 1: Let `Http::body()` handle multipart requests**

In `api/core/Http.php`, change `Http::body()` (currently lines 68–83) to
return `$_POST` for a multipart request instead of attempting to JSON-decode
its raw body (which is not JSON and would otherwise throw `400 Invalid JSON
body`):

```php
    /** Decode the JSON request body; {} when there is none.
     *  A multipart request (file upload) has already been parsed into
     *  $_POST/$_FILES by PHP itself — hand that back instead of trying to
     *  JSON-decode the raw multipart body. */
    public static function body(): array
    {
        $ct = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
        if (str_starts_with($ct, 'multipart/form-data')) {
            return $_POST;
        }
        $raw = file_get_contents('php://input');
        if ($raw === false || trim($raw) === '') {
            return [];
        }
        if (strlen($raw) > 2 * 1024 * 1024) {
            throw new HttpError(413, 'Payload too large');
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            throw new HttpError(400, 'Invalid JSON body');
        }
        return $data;
    }
```

- [ ] **Step 2: Create `api/routes/uploads.php`**

```php
<?php
/**
 * Case photos — center-point reference shots, payment slips, anything else
 * that gets attached to a case. Files live under api/uploads/<case_id>/ on
 * local disk (gitignored), rows live in the existing case_photos table.
 */
declare(strict_types=1);

const UPLOAD_MIME_EXT = [
    'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp',
    'application/pdf' => 'pdf',
];

function uploadDir(int $caseId): string
{
    $dir = dirname(__DIR__) . "/uploads/$caseId";
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    return $dir;
}

GET('/api/uploads', function (array $req) {
    $caseId = int_or($req['query']['case_id'] ?? null);
    if (!$caseId) {
        bad('กรุณาระบุเคส');
    }
    return Db::all(
        'SELECT p.*, e.employee_name AS taken_by_name FROM case_photos p
           LEFT JOIN employees e ON e.id = p.taken_by
          WHERE p.case_id = ? ORDER BY p.id DESC',
        $caseId
    );
});

GET('/api/uploads/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    $p  = Db::get('SELECT * FROM case_photos WHERE id = ?', $id);
    if (!$p) {
        missing();
    }
    $path = dirname(__DIR__) . "/uploads/{$p['case_id']}/{$p['file_name']}";
    if (!is_file($path)) {
        missing();
    }
    header('Content-Type: ' . ($p['mime_type'] ?: 'application/octet-stream'));
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: private, max-age=31536000');
    readfile($path);
    exit;
});

POST('/api/uploads', function (array $req) {
    $body   = $req['body'];
    $caseId = int_or($body['case_id'] ?? null);
    if (!$caseId) {
        bad('กรุณาระบุเคส');
    }
    if (!Db::get('SELECT id FROM cases WHERE id = ?', $caseId)) {
        bad('ไม่พบเคส');
    }
    $file = $_FILES['file'] ?? null;
    if (!$file || $file['error'] !== UPLOAD_ERR_OK) {
        bad('กรุณาเลือกไฟล์');
    }
    if ($file['size'] > 8 * 1024 * 1024) {
        bad('ไฟล์ใหญ่เกินไป (จำกัด 8MB)');
    }
    $mime = mime_content_type($file['tmp_name']) ?: '';
    $ext  = UPLOAD_MIME_EXT[$mime] ?? null;
    if (!$ext) {
        bad('รองรับเฉพาะไฟล์ JPG, PNG, WEBP, PDF');
    }

    $fileName = uniqid('photo_', true) . ".$ext";
    $dest     = uploadDir($caseId) . "/$fileName";
    if (!move_uploaded_file($file['tmp_name'], $dest)) {
        bad('บันทึกไฟล์ไม่สำเร็จ');
    }

    $id = Db::tx(function (Tx $q) use ($body, $caseId, $fileName, $file, $mime) {
        $r = $q->run(
            'INSERT INTO case_photos (case_id, centering_id, payment_id, kind, file_name,
               original_name, mime_type, file_size, caption, taken_by)
             VALUES (?,?,?,?,?,?,?,?,?,?)',
            $caseId,
            int_or($body['centering_id'] ?? null),
            int_or($body['payment_id'] ?? null),
            str_or($body['kind'] ?? null, 'other') ?: 'other',
            $fileName,
            str_or($file['name'] ?? null),
            $mime,
            (int) $file['size'],
            nul($body['caption'] ?? null),
            int_or($body['taken_by'] ?? null)
        );
        logEvent($q, $caseId, [
            'action'      => 'photo_uploaded',
            'entity'      => 'case_photo',
            'entity_id'   => $r['insertId'],
            'employee_id' => int_or($body['taken_by'] ?? null),
        ]);
        return $r['insertId'];
    });

    return Db::get('SELECT * FROM case_photos WHERE id = ?', $id);
});

DELETE('/api/uploads/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    $p  = Db::get('SELECT * FROM case_photos WHERE id = ?', $id);
    if (!$p) {
        missing();
    }
    $path = dirname(__DIR__) . "/uploads/{$p['case_id']}/{$p['file_name']}";
    Db::tx(function (Tx $q) use ($id, $p) {
        $q->run('DELETE FROM case_photos WHERE id = ?', $id);
        logEvent($q, int_or($p['case_id']), [
            'action'    => 'photo_deleted',
            'entity'    => 'case_photo',
            'entity_id' => $id,
        ]);
    });
    if (is_file($path)) {
        unlink($path);
    }
    return ['ok' => true];
});
```

- [ ] **Step 3: Register the route file and gitignore the upload dir**

In `api/index.php`, add `'uploads'` to the `foreach` route-file list
(currently lines 36–40) — put it right after `'workflow'`.

In `.gitignore`, add a line: `api/uploads/`

- [ ] **Step 4: Verify with curl + direct SQL**

```bash
curl -F "case_id=<real-id>" -F "kind=centering" -F "file=@some.jpg;type=image/jpeg" \
  http://127.0.0.1:<scratch-port>/api/uploads
```
Confirm the JSON response has an `id` and `file_name`. Confirm the file
exists on disk at `api/uploads/<case_id>/<file_name>`. `GET /api/uploads/:id`
and confirm the raw image bytes come back with `Content-Type: image/jpeg`.
`DELETE` it and confirm both the row and the file are gone.

- [ ] **Step 5: Commit**

```bash
git add api/routes/uploads.php api/core/Http.php api/index.php .gitignore
git commit -m "Add photo/file upload endpoint for case attachments"
```

---

### Task 6: Production lifecycle — start, withdraw-extra, pause/resume, deliver

**Files:**
- Modify: `api/routes/workflow.php`

**Interfaces:**
- Consumes: `production_jobs.{status,started_at,started_by,received_by_customer_name}`,
  `production_withdrawals` table (Task 1), `pickLot()`/`releaseLot()`
  (`api/core/Helpers.php`, unchanged).
- Produces: `POST /api/production-jobs/:id/start`,
  `POST /api/production-jobs/:id/withdraw`,
  `POST /api/production-jobs/:id/pause`,
  `POST /api/production-jobs/:id/resume`,
  `POST /api/production-jobs/:id/deliver` — used by Task 13
  (ProductionPanel rework) and Task 14 (DeliveryPanel).

- [ ] **Step 1: Add the 5 new endpoints to `workflow.php`**

Append to `api/routes/workflow.php` (after the existing `qc-checks` block):

```php
/**
 * "เริ่มผลิต" — only allowed once frame + both lenses are attached to the
 * order (fill already happened) and none of the three is already sold.
 * Withdraws all three via pickLot() in one transaction and marks the job
 * IN_PRODUCTION.
 */
POST('/api/production-jobs/:id/start', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $job  = Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
    if (!$job) {
        missing();
    }
    if ($job['status'] === 'IN_PRODUCTION' || $job['status'] === 'COMPLETED') {
        bad('งานนี้เริ่มผลิตไปแล้ว');
    }
    $order = $job['order_id'] ? Db::get('SELECT * FROM custom_orders WHERE id = ?', (int) $job['order_id']) : null;
    if (!$order) {
        bad('ไม่พบออเดอร์ของเคสนี้');
    }
    $items = [
        'frame'   => $order['frame_product_id'],
        'lens_od' => $order['lens_product_id'],
        'lens_os' => $order['right_lens_product_id'],
    ];
    foreach ($items as $type => $sid) {
        if (!$sid) {
            bad("ยังไม่มีสินค้า ($type) ในออเดอร์ — เข้าสู่ Flow สั่งสินค้าก่อน");
        }
        $s = Db::get('SELECT sold FROM v_stock_lot WHERE id = ?', (int) $sid);
        if (!$s || (int) $s['sold']) {
            bad("สินค้า ($type) ไม่พร้อมในสต็อก — เข้าสู่ Flow สั่งสินค้าก่อน");
        }
    }

    $empId = int_or($body['employee_id'] ?? null);
    Db::tx(function (Tx $q) use ($id, $job, $items, $empId) {
        foreach ($items as $type => $sid) {
            if (!pickLot($q, (int) $sid, 'เริ่มผลิต')) {
                bad("สินค้า ($type) ถูกขายไปแล้วระหว่างนี้ — ลองใหม่");
            }
            $q->run(
                'INSERT INTO production_withdrawals (case_id, production_job_id, item_type,
                   stock_lot_id, is_extra, withdrawn_by) VALUES (?,?,?,?,0,?)',
                (int) $job['case_id'], $id, $type, (int) $sid, $empId
            );
        }
        $q->run(
            "UPDATE production_jobs SET status='IN_PRODUCTION', started_at=?, started_by=? WHERE id=?",
            nowStamp(), $empId, $id
        );
        logEvent($q, (int) $job['case_id'], [
            'action' => 'production_started', 'entity' => 'production_job',
            'entity_id' => $id, 'employee_id' => $empId,
        ]);
        setStatus($q, (int) $job['case_id'], 'edging', ['employee_id' => $empId, 'action' => 'production_started']);
    });
    return Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
});

/** "เบิกเพิ่ม" — an item already withdrawn broke; pick a replacement unit. */
POST('/api/production-jobs/:id/withdraw', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $job  = Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
    if (!$job) {
        missing();
    }
    $type = str_or($body['item_type'] ?? null);
    if (!in_array($type, ['frame', 'lens_od', 'lens_os'], true)) {
        bad('กรุณาระบุประเภทสินค้า (frame, lens_od, lens_os)');
    }
    $sid = int_or($body['stock_lot_id'] ?? null);
    if (!$sid) {
        bad('กรุณาเลือกสินค้าจากสต็อก');
    }
    $s = Db::get('SELECT sold FROM v_stock_lot WHERE id = ?', $sid);
    if (!$s || (int) $s['sold']) {
        bad('สินค้าชิ้นนี้ไม่พร้อมในสต็อก');
    }
    $empId = int_or($body['employee_id'] ?? null);

    Db::tx(function (Tx $q) use ($id, $job, $type, $sid, $empId, $body) {
        if (!pickLot($q, $sid, 'เบิกเพิ่ม: ' . str_or($body['reason'] ?? null))) {
            bad('สินค้าชิ้นนี้ถูกขายไปแล้วระหว่างนี้ — ลองใหม่');
        }
        $q->run(
            'INSERT INTO production_withdrawals (case_id, production_job_id, item_type,
               stock_lot_id, is_extra, reason, withdrawn_by) VALUES (?,?,?,?,1,?,?)',
            (int) $job['case_id'], $id, $type, $sid, nul($body['reason'] ?? null), $empId
        );
        logEvent($q, (int) $job['case_id'], [
            'action' => 'production_withdraw_extra', 'entity' => 'production_withdrawal',
            'employee_id' => $empId, 'note' => "$type: " . str_or($body['reason'] ?? null),
        ]);
    });
    return Db::all('SELECT * FROM production_withdrawals WHERE production_job_id = ? ORDER BY id', $id);
});

/** "หยุดการผลิต / รอสินค้า" */
POST('/api/production-jobs/:id/pause', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $job  = Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
    if (!$job) {
        missing();
    }
    $empId = int_or($body['employee_id'] ?? null);
    Db::tx(function (Tx $q) use ($id, $job, $empId, $body) {
        $q->run("UPDATE production_jobs SET status='WAITING_FOR_ITEM' WHERE id=?", $id);
        logEvent($q, (int) $job['case_id'], [
            'action' => 'production_paused', 'entity' => 'production_job', 'entity_id' => $id,
            'employee_id' => $empId, 'note' => str_or($body['reason'] ?? null),
        ]);
        setStatus($q, (int) $job['case_id'], 'waiting_edging', ['employee_id' => $empId, 'action' => 'production_paused']);
    });
    return Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
});

/** กลับมาผลิตต่อ */
POST('/api/production-jobs/:id/resume', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $job  = Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
    if (!$job) {
        missing();
    }
    $empId = int_or($body['employee_id'] ?? null);
    Db::tx(function (Tx $q) use ($id, $job, $empId) {
        $q->run("UPDATE production_jobs SET status='IN_PRODUCTION' WHERE id=?", $id);
        logEvent($q, (int) $job['case_id'], [
            'action' => 'production_resumed', 'entity' => 'production_job', 'entity_id' => $id,
            'employee_id' => $empId,
        ]);
        setStatus($q, (int) $job['case_id'], 'edging', ['employee_id' => $empId, 'action' => 'production_resumed']);
    });
    return Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
});

/** ส่งมอบ — records who handed it over and who received it. */
POST('/api/production-jobs/:id/deliver', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $job  = Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
    if (!$job) {
        missing();
    }
    $empId = int_or($body['handed_over_by'] ?? null);
    Db::tx(function (Tx $q) use ($id, $job, $empId, $body) {
        $q->run(
            "UPDATE production_jobs SET status='COMPLETED', pickup_at=?, handed_over_by=?,
               received_by_customer_name=? WHERE id=?",
            str_or($body['pickup_at'] ?? null) ?: nowStamp(),
            $empId,
            nul($body['received_by_customer_name'] ?? null),
            $id
        );
        logEvent($q, (int) $job['case_id'], [
            'action' => 'delivered', 'entity' => 'production_job', 'entity_id' => $id,
            'employee_id' => $empId, 'note' => str_or($body['received_by_customer_name'] ?? null),
        ]);
        setStatus($q, (int) $job['case_id'], 'pickup', ['employee_id' => $empId, 'action' => 'delivered']);
    });
    return Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
});
```

(`edging`/`waiting_edging`/`packing`/`pickup` are existing `case_statuses`
codes already seeded in the live DB per the design doc's investigation —
this task does not add any new status code, only calls `setStatus()` with
codes that already exist.)

- [ ] **Step 2: Verify with curl + direct SQL**

Using a real order with all 3 items filled (`fill` already tested working
this session): POST `/start`, confirm `production_jobs.status='IN_PRODUCTION'`,
confirm 3 new `production_withdrawals` rows, confirm the 3 `stock_lots.remaining_qty`
each dropped by 1 (matches `pickLot()`'s already-proven behavior). POST
`/withdraw` with `item_type=lens_od` and a second stock lot id, confirm a 4th
`production_withdrawals` row with `is_extra=1`. POST `/pause` then `/resume`,
confirm `status` toggles `WAITING_FOR_ITEM` → `IN_PRODUCTION`. POST `/deliver`,
confirm `status='COMPLETED'` and the case's status moved to `pickup`.

- [ ] **Step 3: Commit**

```bash
git add api/routes/workflow.php
git commit -m "Add production start/withdraw-extra/pause/resume/deliver endpoints"
```

---

### Task 7: Record who closed a case

**Files:**
- Modify: `api/routes/cases.php`

**Interfaces:**
- Consumes: `cases.closed_by` (Task 1), `production_withdrawals` table (Task 1).
- Produces: `POST /api/cases/:id/status` sets `closed_by` when the target
  status is terminal; `caseDetail()`'s response gains a new
  `production_withdrawals` array field — consumed by Task 13's
  `ProductionPanel.jsx` (`c.production_withdrawals`).

- [ ] **Step 1: Add `production_withdrawals` to `caseDetail()`**

In `api/routes/cases.php`'s `caseDetail()` function (currently lines
41–141), add a new query alongside the existing `$qc`/`$payments` queries
(after the `$production` line, currently line 84):

```php
    $withdrawals = Db::all(
        'SELECT w.*, e.employee_name AS withdrawn_by_name FROM production_withdrawals w
           LEFT JOIN employees e ON e.id = w.withdrawn_by
          WHERE w.case_id = ? ORDER BY w.id',
        $id
    );
```

Then add `'production_withdrawals' => $withdrawals,` to the returned array
(currently lines 125–140), alongside the existing `'production' => $production,`
line.

- [ ] **Step 2: Set `closed_by` in the status-change handler**

In `api/routes/cases.php`'s `POST('/api/cases/:id/status', ...)` handler
(currently lines 204–222), after the existing `setStatus()` call, add:

```php
Db::tx(function (Tx $q) use ($id, $to, $body) {
    setStatus($q, $id, $to, [
        'employee_id' => int_or($body['employee_id'] ?? null),
        'note'        => nul($body['note'] ?? null),
        'action'      => 'status_change',
    ]);
    if ($to === 'cancelled' && nul($body['note'] ?? null) !== null) {
        $q->run('UPDATE cases SET cancelled_reason = ? WHERE id = ?', str_or($body['note']), $id);
    }
    $target = $q->get('SELECT is_terminal FROM case_statuses WHERE code = ?', $to);
    if ($target && (int) $target['is_terminal'] === 1) {
        $q->run('UPDATE cases SET closed_by = ? WHERE id = ?', int_or($body['employee_id'] ?? null), $id);
    }
});
```

(Replace the existing `Db::tx(function (Tx $q) use ($id, $to, $body) { ... })`
block with this extended version — same signature, same existing 2
statements plus the 2 new ones.)

- [ ] **Step 3: Verify with curl + direct SQL**

`GET /api/cases/:id` on a case with at least one production withdrawal
(create one via Task 6's `/start` endpoint first if none exists yet) and
confirm the response includes a non-empty `production_withdrawals` array.
POST `/api/cases/:id/status` with `status=completed&employee_id=<real-id>`
on a case whose current status is non-terminal. Confirm via SQL that
`cases.closed_by` is set to that employee id and `closed_at` is set (already
existing `setStatus()` behavior). POST a non-terminal status change and
confirm `closed_by` is NOT touched.

- [ ] **Step 4: Commit**

```bash
git add api/routes/cases.php
git commit -m "Record which employee closed a case"
```

---

### Task 8: StockPicker and PhotoUpload shared components

**Files:**
- Create: `frontend-next/components/StockPicker.jsx`
- Create: `frontend-next/components/PhotoUpload.jsx`

**Interfaces:**
- Consumes: `GET /api/stock?q=&type=&sold=0` (existing, fixed earlier this
  session), `POST /api/uploads` + `GET /api/uploads?case_id=` + `DELETE /api/uploads/:id`
  (Task 5), `Picker` component (`components/Picker.jsx`, read in full this
  session — reuse its exact prop contract).
- Produces: `<StockPicker type="Frame" onPick={fn} />` — used by Task 10
  (SalesPanel), Task 12 (Orders domain), Task 13 (ProductionPanel withdraw
  popup). `<PhotoUpload caseId={id} kind="centering" onUploaded={fn} />` —
  used by Task 11 (CenteringPanel).

- [ ] **Step 1: `StockPicker.jsx`**

```jsx
'use client';
/** Thin wrapper over Picker.jsx for choosing an available stock item. */
import { Picker } from './Picker.jsx';
import { api } from '../lib/apiClient.js';
import { money } from '../lib/format.js';

export function StockPicker({ type, onPick, selectedId = null }) {
  return (
    <Picker
      placeholder={`ค้นหาสินค้า${type ? ' (' + type + ')' : ''}…`}
      fetcher={(term) => api.get('/api/stock', { q: term, type: type || undefined, sold: 0, limit: 30 })}
      label={(r) => `${r.brand ? r.brand + ' ' : ''}${r.product_name}`}
      sub={(r) => `${r.sku ? 'SKU ' + r.sku + ' — ' : ''}${money(r.product_price)}`}
      onPick={onPick}
      selectedId={selectedId}
    />
  );
}
```

- [ ] **Step 2: `PhotoUpload.jsx`**

```jsx
'use client';
/** Multi-file upload + thumbnail grid for a case's attached photos. */
import { useRef } from 'react';
import { api } from '../lib/apiClient.js';
import { useAsync } from '../lib/hooks.js';
import { useToast } from './Toast.jsx';
import { useConfirm } from './Confirm.jsx';

export function PhotoUpload({ caseId, kind = 'other', centeringId = null, paymentId = null, takenBy = null }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const inputRef = useRef(null);
  const { data: photos, loading, reload } = useAsync(
    () => api.get('/api/uploads', { case_id: caseId }),
    [caseId]
  );

  const pick = () => inputRef.current?.click();

  const upload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      form.append('case_id', caseId);
      form.append('kind', kind);
      if (centeringId) form.append('centering_id', centeringId);
      if (paymentId) form.append('payment_id', paymentId);
      if (takenBy) form.append('taken_by', takenBy);
      try {
        await api.upload('/api/uploads', form);
      } catch (ex) { err(ex); }
    }
    ok('อัปโหลดรูปแล้ว');
    reload();
  };

  const remove = async (p) => {
    if (!await confirm('ลบรูป', p.original_name || '', { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del('/api/uploads/' + p.id);
      ok('ลบแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <div className="stack">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={upload}
      />
      <button type="button" className="btn btn-sm btn-light" onClick={pick}>📷 เพิ่มรูป</button>
      {loading ? null : (
        <div className="photo-grid">
          {(photos || []).map((p) => (
            <div className="photo-thumb" key={p.id}>
              {p.mime_type === 'application/pdf'
                ? <a href={api.url('/api/uploads/' + p.id)} target="_blank" rel="noreferrer">📄 {p.original_name}</a>
                : <img src={api.url('/api/uploads/' + p.id)} alt={p.original_name || ''} />}
              <button type="button" className="photo-thumb-del" onClick={() => remove(p)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add `api.upload()` and `api.url()` to `lib/apiClient.js`**

Read `frontend-next/lib/apiClient.js` in full first (it defines `api.get/post/put/del`
against `NEXT_PUBLIC_API_ORIGIN`). Add two more methods following its exact
existing pattern (same base-URL/error-handling logic as `api.post`, but
without JSON-stringifying the body and without setting a `Content-Type`
header — the browser sets the correct multipart boundary automatically for
a `FormData` body):

```js
  upload(path, formData) {
    return request(path, { method: 'POST', body: formData });
  },
  url(path) {
    return base + path;
  },
```

(Match the exact names `request`/`base` (or whatever the file's existing
internal helper/constant is actually called — read the file first) rather
than assuming; do not duplicate the origin-resolution logic that
`api.get`/`api.post` already have.)

- [ ] **Step 4: Add minimal CSS for `.photo-grid`/`.photo-thumb`**

In `frontend-next/app/globals.css`, append (teal palette, matching existing
`.card`/`.btn` tokens already in the file — read the file's `:root` custom
properties first and reuse them, don't hardcode new colors):

```css
.photo-grid{display:flex;flex-wrap:wrap;gap:8px}
.photo-thumb{position:relative;width:90px;height:90px;border-radius:8px;overflow:hidden;border:1px solid var(--line)}
.photo-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.photo-thumb-del{position:absolute;top:2px;right:2px;background:rgba(0,0,0,.55);color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:12px;line-height:1}
```

- [ ] **Step 5: Verify live**

Start the dev server, open any case-detail page temporarily rendering
`<PhotoUpload caseId={...} />` (a throwaway test render is fine — remove it
before commit, this component gets wired for real in Task 11), upload a
real JPG, confirm the thumbnail renders, confirm deleting it works. Check
in Chrome headless at both 1280px and 810px widths, zero console errors.

- [ ] **Step 6: Commit**

```bash
git add frontend-next/components/StockPicker.jsx frontend-next/components/PhotoUpload.jsx \
  frontend-next/lib/apiClient.js frontend-next/app/globals.css
git commit -m "Add StockPicker and PhotoUpload shared components"
```

---

### Task 9: Per-process case list pages

**Files:**
- Create: `frontend-next/components/ProcessCaseList.jsx`
- Create: `frontend-next/app/exam/page.jsx`
- Create: `frontend-next/app/sales/page.jsx`
- Create: `frontend-next/app/centering/page.jsx`
- Create: `frontend-next/app/case-payments/page.jsx` (route name avoids
  colliding with the existing `/income`+`/expense` finance pages and the
  existing per-case `PaymentPanel`)
- Create: `frontend-next/app/production/page.jsx`
- Create: `frontend-next/app/qc/page.jsx`
- Create: `frontend-next/app/delivery/page.jsx`
- Modify: `frontend-next/components/Shell.jsx`

**Interfaces:**
- Consumes: `GET /api/cases?stage_group=X&open=1` (existing, already
  supports this exact filter per `api/routes/cases.php`'s `GET /api/cases`
  handler).
- Produces: 7 new sidebar nav entries (process 1 "รับลูกค้า" already has
  `/cases/new`+`/cases`; process 9 "จบงาน" is reached via the case-detail
  ClosePanel from Task 14, not a separate list — a "closed" list isn't in
  the spec).

- [ ] **Step 1: `ProcessCaseList.jsx`**

Read `frontend-next/app/cases/page.jsx` in full first (the existing case
board/list) and mirror its exact list-rendering pattern (likely `DataTable`
+ `useAsync`). Write:

```jsx
'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../lib/apiClient.js';
import { useAsync } from '../lib/hooks.js';
import { PageHead, Loading } from './ui.jsx';
import { DataTable } from './DataTable.jsx';
import { StatusChip } from './StatusChip.jsx';
import { custName, fmtDateTime } from '../lib/format.js';

export function ProcessCaseList({ stageGroup, icon, title, subtitle }) {
  const router = useRouter();
  const { data, loading } = useAsync(
    () => api.get('/api/cases', { stage_group: stageGroup, open: 1, limit: 300 }),
    [stageGroup]
  );

  return (
    <div>
      <PageHead icon={icon} title={title} subtitle={subtitle} />
      {loading ? <Loading /> : (
        <DataTable
          columns={[
            { label: 'เคส', key: 'case_code', cls: 'mono' },
            { label: 'ลูกค้า', render: custName },
            { label: 'สถานะ', render: (c) => <StatusChip row={c} /> },
            { label: 'เปิดเมื่อ', render: (c) => fmtDateTime(c.opened_at), cls: 'nowrap' },
          ]}
          rows={data || []}
          onRowClick={(c) => router.push('/cases/detail?id=' + c.id)}
          empty="ไม่มีเคสในขั้นนี้"
        />
      )}
    </div>
  );
}
```

(Adjust import paths/column set to match whatever `app/cases/page.jsx` and
`components/StatusChip.jsx` actually expose — read both first; this is a
structural skeleton, not a byte-exact final file.)

- [ ] **Step 2: 7 thin page wrappers**

Each of `app/exam/page.jsx`, `app/sales/page.jsx`, `app/centering/page.jsx`,
`app/case-payments/page.jsx`, `app/production/page.jsx`, `app/qc/page.jsx`,
`app/delivery/page.jsx` is the same 6-line shape, e.g.:

```jsx
'use client';
import { ProcessCaseList } from '../../components/ProcessCaseList.jsx';

export default function ExamListPage() {
  return <ProcessCaseList stageGroup="exam" icon="👁" title="วัดสายตา" subtitle="เคสที่รอวัดสายตา" />;
}
```

Use `stageGroup` values `exam`, `sales`, `centering`, `payment` (note: the
route directory is `case-payments` but the API filter value stays
`payment`, matching Task 1's data update), `production`, `qc`, `delivery` —
and Thai `title`/`subtitle` matching the user's reference mockup's sidebar
labels (วัดสายตา / ขาย-เลือกกรอบ / วัด Center / ชำระเงิน / ผลิต / QC / ส่งมอบ).

- [ ] **Step 3: Wire the sidebar**

Read `frontend-next/components/Shell.jsx` in full and add the 7 new nav
entries in the same list/array structure it already uses for its existing
items (mirror the existing entries' exact shape — icon, label, href).

- [ ] **Step 4: Verify live**

Visit each of the 7 new URLs in a live browser against the real API,
confirm each lists the right subset of cases (cross-check counts against
`GET /api/cases?stage_group=X&open=1` called directly), zero console
errors, both 1280px and 810px widths.

- [ ] **Step 5: Commit**

```bash
git add frontend-next/components/ProcessCaseList.jsx frontend-next/app/exam \
  frontend-next/app/sales frontend-next/app/centering frontend-next/app/case-payments \
  frontend-next/app/production frontend-next/app/qc frontend-next/app/delivery \
  frontend-next/components/Shell.jsx
git commit -m "Add per-process case list pages and sidebar entries"
```

---

### Task 10: Orders (Sales) domain — list, new, edit, detail pages

**Files:**
- Create: `frontend-next/app/orders/OrderFormView.jsx`
- Create: `frontend-next/app/orders/page.jsx`
- Create: `frontend-next/app/orders/new/page.jsx`
- Create: `frontend-next/app/orders/edit/page.jsx`
- Create: `frontend-next/app/orders/detail/page.jsx`

**Interfaces:**
- Consumes: `GET/POST/PUT /api/orders`, `GET /api/orders/:id` (existing,
  extended by Task 2), `<StockPicker>` (Task 8), the established
  `editing`-prop shared-form-view pattern this session already used for
  every other domain (customers, prescriptions, suppliers, locations,
  finance) — **read one of those existing `*FormView.jsx` files in full
  before writing this one and copy its structure exactly** (loader guard
  for a missing/null response, `editing` boolean prop, query-string `id`
  convention, not the response body's own id).
- Produces: `/orders`, `/orders/new?customer=&case=`, `/orders/edit?id=`,
  `/orders/detail?id=` — routed to from Task 14's case-detail header link
  and Task 11's SalesPanel.

- [ ] **Step 1: Read the reference pattern**

Read `frontend-next/app/customers/CustomerFormView.jsx` and
`frontend-next/app/customers/detail/page.jsx` in full (both already exist
and are already reviewed/committed this session) — this is the exact
pattern `OrderFormView.jsx` must follow: `editing` prop, not-found guard,
query-string `id` for writes.

- [ ] **Step 2: `OrderFormView.jsx`**

Build the form with: customer/case context (read-only, passed in via props
from the case-detail SalesPanel or picked via `Picker` on the standalone
`/orders/new` page), 3 `StockPicker` instances (Frame / Lens OD / Lens OS,
`type="Frame"` / `type="Lens"` / `type="Lens"` respectively — check the live
`categories.code` values via `GET /api/stock?type=X` during verification to
confirm the exact type string, do not assume "Lens" is correct without
checking), a prescription-source display block reading
`c.prescriptions` (old/measured/final, each labelled with its `kind`,
per `RX_KIND_LABEL` already in `lib/constants.js`), 4 price inputs
(`frame_price`/`lens_od_price`/`lens_os_price`/`options_price`) that
live-sum into a read-only Total display, a `discount` input, and a
client-side "Net Total ห้ามติดลบ" guard (disable submit / show an inline
error when `discount > total`, mirroring Task 2's server-side rule so the
user sees the same validation before submitting, not just after a 400).
Submit via `api.post('/api/orders', {...})` (create) or
`api.put('/api/orders/' + id, {...})` (edit), following `readForm()` +
`onSubmit()` exactly as every other panel in this codebase does.

- [ ] **Step 3: `page.jsx` (list), `new/page.jsx`, `edit/page.jsx`, `detail/page.jsx`**

Follow the exact file shape of the existing `frontend-next/app/customers/`
directory's 4 equivalent files (list uses `DataTable`, `new`/`edit` wrap
`OrderFormView` with `editing={false}`/`editing={true}`, `detail` shows the
read-only order + its `payment_rows`).

- [ ] **Step 4: Verify live**

Create a real order against a real case/customer through the live UI,
confirm the Net Total calc matches Task 2's server response exactly, edit
it, view its detail page, confirm `/orders` lists it. Both viewport widths,
zero console errors.

- [ ] **Step 5: Commit**

```bash
git add frontend-next/app/orders
git commit -m "Port the Orders (Sales) domain to frontend-next"
```

---

### Task 11: SalesPanel — case-detail sales tab

**Files:**
- Create: `frontend-next/app/cases/detail/panels/SalesPanel.jsx`

**Interfaces:**
- Consumes: `OrderFormView.jsx` (Task 10, reused in embedded mode — add
  an optional prop there if its current shape assumes a full page layout;
  check during implementation whether it needs a `compact`/`embedded` prop
  to drop its own `PageHead`, since it's now rendered inside a tab, not a
  standalone route).
- Produces: the `การขาย` tab wired into Task 14's case-detail page.

- [ ] **Step 1: Build the panel**

```jsx
'use client';
import { OrderFormView } from '../../../orders/OrderFormView.jsx';

export function SalesPanel({ c, reload, actorId }) {
  return (
    <div className="stack">
      <OrderFormView
        embedded
        editing={!!c.order}
        orderId={c.order?.id}
        caseId={c.id}
        customerId={c.customer_id}
        onSaved={reload}
        actorId={actorId}
      />
    </div>
  );
}
```

(Exact prop names depend on what Task 10 actually settles on — this is the
intended shape; reconcile against `OrderFormView.jsx`'s real signature
during implementation rather than treating this snippet as gospel over the
already-committed component.)

- [ ] **Step 2: Verify live**

Open a case with no order yet, confirm the sales tab lets you create one
inline without navigating away; open a case with an existing order, confirm
it loads for editing; confirm `reload()` refreshes the case-detail's
overview KPIs after a save. Both viewport widths, zero console errors.

- [ ] **Step 3: Commit**

```bash
git add frontend-next/app/cases/detail/panels/SalesPanel.jsx
git commit -m "Add the case-detail Sales panel"
```

---

### Task 12: Split CenteringPanel and QcPanel out of ProductionPanel

**Files:**
- Create: `frontend-next/app/cases/detail/panels/CenteringPanel.jsx`
- Create: `frontend-next/app/cases/detail/panels/QcPanel.jsx`
- Modify: `frontend-next/app/cases/detail/panels/ProductionPanel.jsx` (remove the centering form + QC section — done fully in Task 13, this task only extracts them)

**Interfaces:**
- Consumes: `POST /api/centerings` (existing, extended with A/B in Task 3
  — wait, A/B was added to `frame_fittings` not `centerings` per Task 1/3;
  `CenteringPanel` renders the *centering* fields, A/B lives on the
  *frame-fitting* fields which stay in `ProductionPanel.jsx` per Task 13 —
  keep that distinction exact, don't move A/B here), `<PhotoUpload>`
  (Task 8), `POST /api/qc-checks` (existing, extended with OD/OS split in
  Task 3).
- Produces: `Center Point` and `QC` tabs wired into Task 14.

- [ ] **Step 1: `CenteringPanel.jsx`**

Move the existing "จุดศูนย์กลาง — Centering" `<form>` block (currently
`ProductionPanel.jsx` lines 77–100, already read in full above) into this
new file verbatim, keeping its exact field list and `EmployeeSelect`
pattern. Add below the form: the selected frame from `c.order` (read-only
display — `c.order.frame_name`/`frame_brand`/`frame_sku`, matching the
design doc's "แสดง Frame ที่เลือกจาก Process การขายประกอบการวัด Center Point"
requirement) and `<PhotoUpload caseId={c.id} kind="centering" centeringId={c.centering?.id} takenBy={actorId()} />`.

- [ ] **Step 2: `QcPanel.jsx`**

Move the existing "QC" card (currently `ProductionPanel.jsx` lines 147–197)
into this new file verbatim, then: replace the single `check_lens` entry in
the `QC_CHECKS` array with two entries `['check_lens_od', 'เลนส์ OD']` and
`['check_lens_os', 'เลนส์ OS']` (matching Task 3's new columns).

- [ ] **Step 3: Trim `ProductionPanel.jsx`**

Remove the "จุดศูนย์กลาง — Centering" form and the whole "QC" card+form
block from `ProductionPanel.jsx` (they now live in the 2 new files) —
leave the "วัดกรอบ — Frame Fitting" form and the "งานผลิต — Production" form
in place (Task 13 reworks the latter further).

- [ ] **Step 4: Verify live**

Confirm the Centering tab saves correctly and shows the frame reference +
photo upload; confirm QC tab saves with the OD/OS split and the history
table still renders every past attempt. Both viewport widths, zero console
errors.

- [ ] **Step 5: Commit**

```bash
git add frontend-next/app/cases/detail/panels/CenteringPanel.jsx \
  frontend-next/app/cases/detail/panels/QcPanel.jsx \
  frontend-next/app/cases/detail/panels/ProductionPanel.jsx
git commit -m "Split Centering and QC into their own case-detail panels"
```

---

### Task 13: ProductionPanel rework — stock-gated start, withdraw-extra, pause/resume

**Files:**
- Modify: `frontend-next/app/cases/detail/panels/ProductionPanel.jsx`

**Interfaces:**
- Consumes: `POST /api/production-jobs/:id/{start,withdraw,pause,resume}`
  (Task 6), `<StockPicker>` (Task 8), `frame_fittings.{frame_box_a,frame_box_b}`
  (Task 3).
- Produces: the `ผลิต` tab's full lifecycle UI, wired into Task 14.

- [ ] **Step 1: Add A/B inputs to the Frame Fitting form**

In the existing "วัดกรอบ — Frame Fitting" form (kept in this file per Task
12), add 2 more `text(...)` calls for `frame_box_a`/`frame_box_b` next to
the existing `ed`/`dbl` fields, following the file's exact existing
`text(name, label, source)` helper pattern (already defined at the top of
this file).

- [ ] **Step 2: Add the production-lifecycle UI**

Add a new card above the existing "งานผลิต — Production" form:

```jsx
<div className="card">
  <div className="card-head">
    <h2>สถานะการผลิต</h2>
    <Badge kind={STATUS_BADGE[p.status] || 'gray'}>{STATUS_LABEL[p.status] || 'ยังไม่เริ่ม'}</Badge>
  </div>
  <div className="card-body">
    {p.status === 'IN_PRODUCTION' || p.status === 'COMPLETED' ? (
      <Row style={{ gap: 8 }}>
        <button type="button" className="btn btn-light" onClick={() => setWithdrawOpen(true)}>
          🧾 เบิกเพิ่ม
        </button>
        {p.status === 'IN_PRODUCTION' && (
          <button type="button" className="btn btn-light" onClick={pause}>⏸ หยุดการผลิต / รอสินค้า</button>
        )}
      </Row>
    ) : p.status === 'WAITING_FOR_ITEM' ? (
      <button type="button" className="btn" onClick={resume}>▶ กลับมาผลิตต่อ</button>
    ) : (
      <button type="button" className="btn" onClick={start} disabled={!c.order}>▶ เริ่มผลิต</button>
    )}
    {(c.production_withdrawals || []).length > 0 && (
      <DataTable
        columns={[
          { label: 'รายการ', key: 'item_type' },
          { label: 'ประเภท', render: (w) => (w.is_extra ? <Badge kind="warn">เบิกเพิ่ม</Badge> : 'เริ่มผลิต') },
          { label: 'เหตุผล', key: 'reason' },
          { label: 'เมื่อ', render: (w) => fmtDateTime(w.withdrawn_at), cls: 'nowrap' },
        ]}
        rows={c.production_withdrawals || []}
        empty="ยังไม่มีการเบิก"
      />
    )}
  </div>
  {withdrawOpen && (
    <WithdrawPopup caseId={c.id} jobId={p.id} onClose={() => setWithdrawOpen(false)} onDone={reload} actorId={actorId} />
  )}
</div>
```

Define `STATUS_LABEL`/`STATUS_BADGE` maps at the top of the file (module
scope, matching the file's existing `PACK_ITEMS`/`QC_CHECKS` const-array
style):

```jsx
const STATUS_LABEL = {
  WAITING_FOR_ITEMS: 'รอเริ่มงาน', READY_TO_PRODUCE: 'พร้อมผลิต', IN_PRODUCTION: 'กำลังผลิต',
  WAITING_FOR_ITEM: 'รอสินค้า', COMPLETED: 'เสร็จแล้ว',
};
const STATUS_BADGE = {
  WAITING_FOR_ITEMS: 'gray', READY_TO_PRODUCE: 'blue', IN_PRODUCTION: 'warn',
  WAITING_FOR_ITEM: 'danger', COMPLETED: 'ok',
};
```

`start`/`pause`/`resume` are `async` handlers posting to the Task 6
endpoints with `{ employee_id: actorId() }`, wrapped in the file's existing
`try { ... ok(...); reload(); } catch (ex) { err(ex); }` pattern (identical
shape to the existing `post()` helper already in this file — reuse it,
don't write a new one, e.g. `post('/api/production-jobs/' + p.id + '/start')({ preventDefault(){} })`
is awkward for a plain button click; instead write 3 small dedicated async
functions calling `api.post` directly, matching `PaymentPanel.jsx`'s
`remove()` handler's exact shape for a non-form button action).

- [ ] **Step 3: `WithdrawPopup` sub-component**

A small modal/inline card (check `components/Confirm.jsx` for this
codebase's existing modal-overlay pattern and reuse its CSS classes rather
than inventing new ones) with a `<Select>` for `item_type`
(`frame`/`lens_od`/`lens_os`), a `<StockPicker>` filtered to that type, a
reason `<textarea>`, and a submit calling
`POST /api/production-jobs/:id/withdraw`.

- [ ] **Step 4: Verify live**

Walk a real case through: order with all 3 items filled → open Production
tab → "เริ่มผลิต" enabled and works (confirm the 3 stock lots decrement) →
"เบิกเพิ่ม" popup withdraws a 4th → "หยุดการผลิต" then "กลับมาผลิตต่อ" both
work. Also confirm "เริ่มผลิต" is disabled/blocked with a clear error when
an item is missing from stock (test against a case whose order has an
unfilled item). Both viewport widths, zero console errors.

- [ ] **Step 5: Commit**

```bash
git add frontend-next/app/cases/detail/panels/ProductionPanel.jsx
git commit -m "Add stock-gated production start, withdraw-extra, and pause/resume UI"
```

---

### Task 14: DeliveryPanel and ClosePanel

**Files:**
- Create: `frontend-next/app/cases/detail/panels/DeliveryPanel.jsx`
- Create: `frontend-next/app/cases/detail/panels/ClosePanel.jsx`

**Interfaces:**
- Consumes: `POST /api/production-jobs/:id/deliver` (Task 6),
  `POST /api/cases/:id/status` (existing, extended in Task 7).
- Produces: `ส่งมอบ` tab and the header's "จบงาน" action, wired into Task 15.

- [ ] **Step 1: `DeliveryPanel.jsx`**

A card showing the case's readiness (QC result, payment status, production
status — all already in `c.qc_checks`/`c.payments`/`c.production`) and, once
`c.qc_checks[0]?.result === 'pass'` and `c.production?.status === 'COMPLETED'`
is not yet true (i.e. not yet delivered), a form with `received_by_customer_name`,
`handed_over_by` (`EmployeeSelect`), `pickup_at` (datetime-local, default
now — reuse `nowLocal()`/`toStamp()` from `lib/format.js` exactly as
`PaymentPanel.jsx` already does for `paid_at`), submitting to
`POST /api/production-jobs/:id/deliver`. Once delivered, show the recorded
delivery details read-only instead of the form.

- [ ] **Step 2: `ClosePanel.jsx`**

A pre-close checklist card computed client-side (no new backend call needed
— every input already exists in `caseDetail()`'s response):

```jsx
const checks = [
  ['การขายเรียบร้อย', !!c.order],
  ['Production เสร็จ', c.production?.status === 'COMPLETED'],
  ['QC ผ่าน', c.qc_checks?.[0]?.result === 'pass'],
  ['ส่งมอบแล้ว', !!c.production?.pickup_at],
  ['ชำระเงินตามเงื่อนไข', Number(c.balance) <= 0],
];
```

Render each as a check/warning row (not a hard block — the design doc's R1
and the spec's own non-linear philosophy mean this is a warning list, not a
disabled button); a `final_note` textarea (writes to the existing
`cases.notes` field via the existing `PUT /api/cases/:id`); a "จบงาน / Close
Case" button calling `POST /api/cases/:id/status` with the case's terminal
`completed` status code (read the live `case_statuses` table during
implementation to confirm which code(s) have `is_terminal=1` and use the
correct one — `completed` per the design doc's earlier investigation, but
verify against the live DB, not this plan's memory of it).

- [ ] **Step 3: Verify live**

Walk a case through delivery (confirms `production_jobs.status='COMPLETED'`,
`received_by_customer_name` recorded) then close it (confirms
`cases.status` becomes terminal, `closed_by`/`closed_at` set per Task 7).
Confirm the checklist correctly shows warnings on an incomplete case and all
green on a fully-complete one. Both viewport widths, zero console errors.

- [ ] **Step 4: Commit**

```bash
git add frontend-next/app/cases/detail/panels/DeliveryPanel.jsx \
  frontend-next/app/cases/detail/panels/ClosePanel.jsx
git commit -m "Add Delivery and Close-case panels"
```

---

### Task 15: Case-detail page — 9-step dashboard overhaul

**Files:**
- Modify: `frontend-next/app/cases/detail/page.jsx`
- Modify: `frontend-next/app/globals.css` (only if a genuinely new shape is
  needed beyond the existing `.stepper`/`.step`/`.card` classes — check
  first before adding anything)

**Interfaces:**
- Consumes: every panel from Tasks 11–14 (`SalesPanel`, `CenteringPanel`,
  `QcPanel`, `ProductionPanel`, `DeliveryPanel`, `ClosePanel`), plus the
  existing `RxPanel`/`LensPanel`/`PaymentPanel`/`NotifyPanel`/`TimelinePanel`.
- Produces: the final 9-step case-detail dashboard — this is the last task
  in the plan.

- [ ] **Step 1: Read the current file in full**

`frontend-next/app/cases/detail/page.jsx` was already read in full earlier
this session (it has the existing 7-stage stepper + `STAGE_META`/
`stageInfo`/`STAGE_CHECKS`/`statusesOfGroup`/`entryStatusOf` — all defined
locally in this file, duplicating `lib/constants.js`'s `STAGE_META`).
Re-read it fresh before editing (it may have been touched by an earlier
task in this plan) and confirm its exact current shape before making
changes.

- [ ] **Step 2: Fix the STAGE_META duplication (flagged during investigation)**

Delete the module-level `STAGE_META`/`stageInfo`/`GROUPS`/`ALL_GROUPS`
block from this file and import `STAGE_META`, `stageInfo` from
`../../../lib/constants.js` instead — but first **extend
`lib/constants.js`'s `STAGE_META`** with the 2 new groups:

```js
export const STAGE_META = {
  reception: { label: 'รับลูกค้า', color: '#7a5cc4', icon: '🛎' },
  exam: { label: 'วัดสายตา', color: '#2f6fd0', icon: '👁' },
  sales: { label: 'ขาย/เลือกกรอบ', color: '#0f8f8f', icon: '🛍' },
  centering: { label: 'วัด Center', color: '#8a6d00', icon: '🎯' },
  payment: { label: 'ชำระเงิน', color: '#0a7a3d', icon: '💳' },
  production: { label: 'ผลิต/เลนส์', color: '#c07000', icon: '🔧' },
  qc: { label: 'ตรวจ QC', color: '#b32020', icon: '🔍' },
  delivery: { label: 'ส่งมอบ', color: '#127a4a', icon: '📦' },
  done: { label: 'จบงาน', color: '#6b7a90', icon: '✅' },
};
export const STAGE_GROUPS = ['reception', 'exam', 'sales', 'centering', 'payment', 'production', 'qc', 'delivery'];
```

(9 entries total including `done`, matching the case board's existing use
of `STAGE_GROUPS` for its columns — check `app/cases/page.jsx`'s board view
for any hardcoded assumption of exactly 7 groups before this change, and
update it if found, since it's the same shared constant.)

- [ ] **Step 3: Add a 6-state per-process status computation**

Add a new local function (this file, not `lib/constants.js` — it needs
per-case data, not just vocabulary):

```jsx
const PROCESS_STATE_META = {
  done: { label: 'เสร็จแล้ว', icon: '✓', cls: 'ok' },
  in_progress: { label: 'กำลังดำเนินการ', icon: '◐', cls: 'warn' },
  waiting: { label: 'รอ', icon: '⏳', cls: 'gray' },
  not_started: { label: 'ยังไม่เริ่ม', icon: '○', cls: 'gray' },
  problem: { label: 'มีปัญหา', icon: '!', cls: 'danger' },
  sent_back: { label: 'ส่งกลับมาแก้ไข', icon: '↩', cls: 'danger' },
};

function processState(group, c) {
  switch (group) {
    case 'reception': return c.customer_id ? 'done' : 'not_started';
    case 'exam': return (c.prescriptions || []).some((r) => r.kind === 'final') ? 'done'
      : (c.prescriptions || []).length ? 'in_progress' : 'not_started';
    case 'sales': return c.order ? 'done' : 'not_started';
    case 'centering': return c.centering ? 'done' : 'not_started';
    case 'payment': return Number(c.balance) <= 0 && c.payments?.length ? 'done'
      : c.payments?.length ? 'in_progress' : 'not_started';
    case 'production': {
      const last = c.qc_checks?.[0];
      if (last && last.result === 'fail') return 'sent_back';
      if (c.production?.status === 'COMPLETED') return 'done';
      if (c.production?.status === 'WAITING_FOR_ITEM') return 'problem';
      if (c.production?.status === 'IN_PRODUCTION') return 'in_progress';
      return 'not_started';
    }
    case 'qc': {
      const last = c.qc_checks?.[0];
      if (!last) return 'not_started';
      return last.result === 'pass' ? 'done' : 'sent_back';
    }
    case 'delivery': return c.production?.pickup_at ? 'done' : 'not_started';
    case 'done': return c.closed_at ? 'done' : 'not_started';
    default: return 'not_started';
  }
}
```

(This is the plan's proposed logic, derived directly from the fields
`caseDetail()` already returns — during implementation, sanity-check every
branch against a handful of real live cases at different stages and adjust
any branch that disagrees with real data; the exact field-level rules here
are a starting point, not a byte-exact contract.)

- [ ] **Step 4: Rework the stepper JSX**

Replace the existing `.stepper` block's per-step render with one using
`STAGE_GROUPS` (9 groups now) instead of the old local `ALL_GROUPS`, using
`processState(g, c)` to pick the icon/class from `PROCESS_STATE_META`
instead of the current binary filled/todo logic, and add the legend row
below it:

```jsx
<div className="stepper-legend">
  {Object.entries(PROCESS_STATE_META).map(([k, m]) => (
    <span key={k} className={`legend-item ${m.cls}`}>{m.icon} {m.label}</span>
  ))}
</div>
```

- [ ] **Step 5: Add the new tabs and panels**

Extend `TAB_NAMES`/`PANELS`/`STAGE_TAB` (all already defined in this file)
to include `การขาย` → `SalesPanel`, `Center Point` → `CenteringPanel`,
`QC` → `QcPanel`, `ส่งมอบ` → `DeliveryPanel`, and add `ภาพรวม` (Overview) as
the new default tab (index 0) rendering the overview grid from Step 6
below, plus a `จบงาน` action in the header (not a tab — matches the
reference mockup putting close-case in the header actions, not the tab
row) rendering `ClosePanel` in a modal/expandable section, following
whatever overlay pattern `components/Confirm.jsx` already establishes.

- [ ] **Step 6: Build the Overview tab**

A 2-column card grid (reuse `Split`/`Card`/`Kv` from `components/ui.jsx` —
check their exact prop shapes first) with: ข้อมูลลูกค้า, ข้อมูลเคส,
สินค้าที่เลือก (3-up frame/lens-OD/lens-OS from `c.order`), สรุปการชำระเงิน
(reuse the existing KPIs block already in this file, currently rendered
unconditionally — move it here, and per the design doc's "before first
payment" rule, hide the "รับแล้ว"/"คงเหลือ" KPIs and show only "ยอดสุทธิ" +
a "ยังไม่ชำระ" badge when `c.payments.length === 0`), หมายเหตุจากเคส
(`c.notes`), and กิจกรรมล่าสุดในเคส (`c.events.slice(0, 5)` with a link to
the Timeline tab for the rest).

- [ ] **Step 7: Verify live**

Walk 3-4 real cases at different stages through the full new page: confirm
the 9-step stepper renders correct per-process states, the legend matches,
every tab loads its panel without error, the Overview tab's fields all
populate correctly (including the before/after-first-payment KPI
difference), and closing a case via the header action works end to end.
Screenshot at 1280px and 810px, zero console errors — this is the
capstone verification for the whole plan, so also spot-re-check 2-3 tasks
from earlier (e.g. re-open a case's Production tab and confirm start/
withdraw/pause still work through the new tab wiring, not just in
isolation).

- [ ] **Step 8: Commit**

```bash
git add frontend-next/app/cases/detail/page.jsx frontend-next/lib/constants.js \
  frontend-next/app/cases/page.jsx frontend-next/app/globals.css
git commit -m "Rework case-detail into the 9-step process dashboard"
```
