# Stock Backend Schema Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every PHP API route in `api/` that still queries the now-dropped `stock` table (a database migration on 2026-08-24 replaced it with `products` + `stock_lots` + `categories` + `inventory_logs`, fronted by a read-only compatibility view `v_stock_lot`), so the current production stack (`frontend/` Vite + `api/` PHP) works again end-to-end. **Zero database schema changes** — this plan is code-only, against the schema exactly as it already exists.

**Architecture — corrected after a real design mistake caught mid-execution:** this plan's first draft assumed every `stock_lots` row should represent exactly one physical unit (`initial_qty=1, remaining_qty=1` always), to make the fix "simple." **That assumption is wrong and was caught by Task 1's own task review**: the live, shared database already contains real multi-unit lots (35 lots, 193 actual units, up to 25 units in a single lot) written by this repo's own **legacy Node.js app** (`lib/api.js` — uncommitted, but already running and already fully solved this exact problem correctly). Rather than re-deriving a design from scratch, this plan now **ports `lib/api.js`'s already-correct, already-verified stock/sales logic into PHP** — same semantics, same SQL shapes, same `inventory_logs` conventions, translated from JS to PHP idioms. Read `lib/api.js` lines 574-745 (stock CRUD, `expandLots`, `pickLot`/`releaseLot`, `findOrCreateProduct`) and lines 1310-1373 (sales) and 1503-1529 (reports) as the reference implementation for this plan — every task below cites the exact lines it ports from.

**The core trick this plan ports:** a `stock_lots` row is a genuine batch (`initial_qty`/`remaining_qty` can be any quantity), but the old `frontend/` UI is built around "one row = one individually sellable/deletable/printable item." `lib/api.js`'s `expandLots()` helper bridges this: it takes N lot rows and *expands* them into individual virtual item-rows (`remaining_qty` copies with `sold:0`, `initial_qty - remaining_qty` copies with `sold:1`) purely in application code, for the three places that need item-level display (`GET /api/stock` list, `stock-labels`, `unsold-stock`). Places that only need a total (`stock_on_hand`, `checklist`) use `SUM(remaining_qty)` directly — no expansion needed, exactly as `lib/api.js` already does. Selling one unit decrements `remaining_qty` by 1 (`pickLot`); returning increments it by 1 (`releaseLot`); deleting one "item" from a lot either removes the whole lot (if it had only 1 unit left) or decrements both `initial_qty` and `remaining_qty` by 1 (if it had more) — `lib/api.js:724-744`'s exact logic.

**Tech Stack:** PHP 8, the existing `api/core/Db.php`/`Db::tx`/`Tx` helper pattern already used throughout `api/routes/*.php` — no new dependencies. `Tx::run()` returns `['insertId' => int, 'affected' => int]` (confirmed via `api/core/Db.php:164-171`) — the `affected` key is what this plan's `pickLot`-equivalent uses to detect a double-sell race.

**Depends on:** Nothing in the Next.js migration series. This plan touches only `api/` — `frontend/` (Vite) and `frontend-next/` are both explicitly untouched; this fix restores the CURRENT production stack (`frontend/`+`api/`).

## Global Constraints

- **Zero database schema changes.** No `CREATE`, `ALTER`, `DROP`, no `CREATE OR REPLACE VIEW`. Every fix is a PHP query/logic change against the schema exactly as it exists today.
- **Zero changes to `frontend/`.** Every fix must preserve the exact JSON response shape each affected `frontend/src/pages/**` component already expects.
- **Match `lib/api.js`'s already-verified semantics, don't re-derive.** Where this plan's tasks specify PHP code, that code is a direct port of specific `lib/api.js` lines (cited per task) — not an independent design. If a task's implementer finds a discrepancy between this plan's PHP code and the cited JS reference, the JS reference is the authority (it's live, tested, and already handles real multi-unit lot data) — flag the discrepancy and ask rather than picking one silently.
- **`inventory_logs.quantity` sign convention, exactly as `lib/api.js` already writes it**: `IN` uses the positive amount received; `OUT` (a sale) uses `-1`; `RETURN` (undoing a sale) uses `+1`; `ADJUST` (deleting one unit from a lot) uses `-1`. Matching signs matters because existing log rows already use this convention — a PHP write using the opposite sign would corrupt any future `SUM(quantity)` reasoning over this shared table.
- **`inventory_logs` insert-before-delete ordering matters** (per `lib/api.js:730-736`'s own comment): when deleting a `stock_lots` row entirely, insert the `inventory_logs` row (with `lot_id` still pointing at the about-to-be-deleted lot) *before* the `DELETE`, not after — `inventory_logs.lot_id`'s foreign key is `ON DELETE SET NULL`, so logging first preserves the correct `lot_id` at insert time and lets the FK cascade null it out afterward, rather than trying to log against an id that no longer exists.
- **`findOrCreateProduct`'s dedup-by-sku behavior** (`lib/api.js:623-642`): when a submitted `sku` matches an existing `products.sku`, reuse that `products.id` — "add to stock" for an existing SKU means a new *lot* under the same product, not a new product. Only create a new `products` row when the sku is blank or genuinely new. This is a real behavioral choice already proven in production use, not an incidental detail — port it exactly, don't simplify to "always insert a new product."
- **`categories.code` maps 1:1 to the `product_type` values this app already uses** (`Lens`, `Frame`, `Sunglass`, `ContactLen`, `Accessory` — confirmed via direct `SELECT` against the live `categories` table). Resolve `category_id` by looking up `categories.code = <product_type>`; fail loudly (`bad(...)`) if that lookup ever misses.
- **This live database is shared** with a concurrently-developed sibling project (`branches`, `branch_issues`, `stock_requests` tables landed via migration this morning, same DB) — and, as this plan's own history shows, with this repo's own legacy Node.js app, which is *actively writing real data to these exact tables right now*. Do not assume the numbers you see mid-verification are static; a live write from another process is a real possibility, not a hypothetical.
- **Verification must check against an independent ground truth, not the same query the code just ran** (the specific mistake this plan's first Task 1 draft made — cross-checking a wrong query against a manual run of *itself* and calling it verified). Every write task's verification must compare the API's output against either a differently-shaped SQL query that reasons about the same fact a different way, or an actual behavioral consequence (a KPI changing by the expected delta, a row's `sold` flag flipping) — never a byte-for-byte copy of the query under test.
- Every write task in this plan must be verified with at least one real create→read→mutate→re-read round trip against the live database, through the actual PHP endpoints. Where a real write leaves permanent data, state exactly what was left and why.
- This repo's own PHP API must be verified as the one under test before running anything against it (ports 8080/5173 may belong to an unrelated concurrent project) — start a throwaway instance on an alternate port, verify via `/api/meta`'s response shape or the process command line, don't assume by port number.

---

## File Structure

```
api/core/Helpers.php   Add: expandLots(array $lots): array — a direct port of lib/api.js's
                        expandLots() (lib/api.js:588-595), placed alongside this file's existing
                        sumCol()/sumBy() row-array helpers. Shared by Task 2 (reports.php) and
                        Task 5 (stock.php).

api/routes/
├── dashboard.php   Modify: 1 line (stock_on_hand KPI — now SUM(remaining_qty), corrected)
├── reports.php     Modify: 4 queries (daily-closed join, checklist, stock-labels, unsold-stock —
│                   the latter two now use expandLots())
├── lens_jobs.php   Modify: 1 query (lensJobDetail()'s left+right lens join — unaffected by the
│                   quantity-model correction, pure name join)
├── cases.php       Modify: 1 query (case detail's own, separate lens-job sub-select — same)
└── sales.php       Modify: GET's join, POST's sell logic (now pickLot-equivalent), DELETE's
                    return logic (now releaseLot-equivalent)

api/routes/stock.php   Full rewrite: findOrCreateProduct-equivalent dedup-by-sku, expandLots-based
                        GET list, batch-quantity POST (one lot per call, not one lot per unit),
                        PUT matching lib/api.js's exact field set (no sku edit), per-unit DELETE
                        semantics (whole-lot delete only when down to 1 unit).
```

No `frontend/` or `frontend-next/` files are touched anywhere in this plan.

---

### Task 1: Fix `dashboard.php`'s `stock_on_hand` KPI — CORRECTED

**Files:**
- Modify: `api/routes/dashboard.php:81`

**Reference:** `lib/api.js:190` — `stock_on_hand: (await one('SELECT COALESCE(SUM(remaining_qty),0) n FROM stock_lots')).n`

**Frontend contract:** `frontend/src/pages/Dashboard.jsx:94` renders this as `<Kpi label="สินค้าคงคลัง" value={count(s.stock_on_hand)} sub="ชิ้น" />` — "ชิ้น" means pieces/units, confirming this must be a unit sum, not a count of lot-rows.

- [ ] **Step 1: Change the query**

In `api/routes/dashboard.php`, line 81, change:

```php
            'stock_on_hand' => (int) ($one('SELECT COUNT(*) n FROM stock WHERE sold = 0')['n'] ?? 0),
```

to:

```php
            'stock_on_hand' => (int) ($one('SELECT COALESCE(SUM(remaining_qty),0) n FROM stock_lots')['n'] ?? 0),
```

(`COALESCE` makes the `?? 0` PHP fallback technically redundant, but keep it anyway — it's the file's existing pattern for every other `stats` key, and consistency here costs nothing.)

- [ ] **Step 2: Verify against the real API — with an independent ground truth this time**

Start this repo's own PHP API on a throwaway port (verified). `curl /api/dashboard` and read `stats.stock_on_hand`. Cross-check it against `SELECT COALESCE(SUM(remaining_qty),0) AS n FROM stock_lots` run directly — this is the same query, so **also** run `SELECT COUNT(*) lots, SUM(remaining_qty) units FROM stock_lots WHERE remaining_qty > 0` and confirm in the report that `units` (not `lots`) is what the API returned, explicitly showing the two numbers differ (proving the fix isn't accidentally back to counting lots). If a previous task run already changed live data (this DB is shared and being written to by other processes), re-run the cross-check fresh rather than trusting an earlier number.

- [ ] **Step 3: Commit**

```bash
git add api/routes/dashboard.php
git commit -m "Fix dashboard stock_on_hand KPI to sum stock_lots.remaining_qty instead of the dropped stock table"
```

(If Task 1 was already attempted once this session with the wrong query and committed, this step amends that mistake with a *new* commit — never force-amend a prior commit; a fresh corrective commit is always correct here.)

---

### Task 2: Fix `reports.php`'s four stock-referencing queries — CORRECTED

**Files:**
- Modify: `api/routes/reports.php:22` (daily-closed's `sales` join — unaffected by the quantity-model correction)
- Modify: `api/routes/reports.php:117-118` (checklist — now sums `remaining_qty`, grouped)
- Modify: `api/routes/reports.php:139-145` (stock-labels — now uses `expandLots()`)
- Modify: `api/routes/reports.php:148-153` (unsold-stock — now uses `expandLots()`)
- Modify: `api/core/Helpers.php` — add `expandLots()`

**Reference:** `lib/api.js:588-595` (`expandLots`), `:1503-1508` (checklist), `:1510-1521` (stock-labels), `:1523-1530` (unsold-stock).

**Frontend contract:** the `frontend/src/pages/reports/{Checklist,Labels,Unsold}.jsx` pages read plain arrays of item-shaped rows (`product_name`, `product_type`, `product_price`, `id`, `sold`, plus whatever `product_locations`/`age_days` columns each query already had) — `expandLots()`'s output rows carry all of `v_stock_lot`'s columns (spread from the source lot) plus a computed `sold`, so the shape is preserved exactly; only the *count* of rows per lot changes (correctly, from 1 misleading row to N accurate ones).

- [ ] **Step 1: Add `expandLots()` to `api/core/Helpers.php`**

Add this function to `api/core/Helpers.php`, near the existing `sumCol()`/`sumBy()` functions (matching their doc-comment style):

```php
/** expand one lot row (with initial_qty/remaining_qty) into per-unit rows —
 *  a direct port of lib/api.js's expandLots(), for the item-level list/print
 *  endpoints (stock list, price labels, unsold-stock report). Anything that
 *  only needs a total should use SUM(remaining_qty) directly instead. */
function expandLots(array $lots): array
{
    $out = [];
    foreach ($lots as $lot) {
        for ($i = 0; $i < (int) $lot['remaining_qty']; $i++) {
            $out[] = array_merge($lot, ['sold' => 0]);
        }
        for ($i = 0; $i < (int) $lot['initial_qty'] - (int) $lot['remaining_qty']; $i++) {
            $out[] = array_merge($lot, ['sold' => 1]);
        }
    }
    return $out;
}
```

- [ ] **Step 2: Fix the `daily-closed` sales join**

In `api/routes/reports.php`, the `sales` query inside `/api/reports/daily-closed` (around line 19-25):

```php
    $sales = Db::all(
        'SELECT s.*, st.product_name, e.employee_name
           FROM sales s
           LEFT JOIN stock st    ON st.id = s.product_stock_id
           LEFT JOIN employees e ON e.id  = s.employee_id
          WHERE DATE(s.sale_date) BETWEEN ? AND ? ORDER BY s.sale_date',
        $from, $to
    );
```

Change `LEFT JOIN stock st` to `LEFT JOIN v_stock_lot st` (pure name join, no quantity semantics involved — unaffected by this plan's design correction):

```php
    $sales = Db::all(
        'SELECT s.*, st.product_name, e.employee_name
           FROM sales s
           LEFT JOIN v_stock_lot st ON st.id = s.product_stock_id
           LEFT JOIN employees e    ON e.id  = s.employee_id
          WHERE DATE(s.sale_date) BETWEEN ? AND ? ORDER BY s.sale_date',
        $from, $to
    );
```

- [ ] **Step 3: Fix `/api/reports/checklist` — now sums quantity, doesn't count lots**

Change:

```php
GET('/api/reports/checklist', fn(array $r) => Db::all(
    'SELECT product_name, COUNT(*) qty, MAX(product_price) price, MIN(stock_date) oldest
       FROM stock WHERE sold = 0 AND product_type = ?
      GROUP BY product_name ORDER BY product_name',
    str_or($r['query']['type'] ?? null, 'Lens') ?: 'Lens'
));
```

to (matching `lib/api.js:1503-1508` exactly — note the join is directly against `stock_lots`+`products`, not `v_stock_lot`, and the group/order is by `p.name` not `product_name`, since that's what the reference implementation does):

```php
GET('/api/reports/checklist', fn(array $r) => Db::all(
    'SELECT p.name AS product_name, SUM(sl.remaining_qty) qty,
            MAX(p.base_selling_price) price, MIN(sl.received_date) oldest
       FROM stock_lots sl JOIN products p ON p.id = sl.product_id
      WHERE sl.remaining_qty > 0 AND p.product_type = ?
      GROUP BY p.name ORDER BY p.name',
    str_or($r['query']['type'] ?? null, 'Lens') ?: 'Lens'
));
```

- [ ] **Step 4: Fix `/api/reports/stock-labels` — now expands lots into per-unit label rows**

Change:

```php
GET('/api/reports/stock-labels', function (array $req) {
    $q     = $req['query'];
    $where = ['s.sold = 0'];
    $args  = [];

    if ($type = str_or($q['type'] ?? null)) {
        $where[] = 's.product_type = ?';
        $args[]  = $type;
    }
    if ($term = str_or($q['q'] ?? null)) {
        $where[] = 's.product_name LIKE ?';
        $args[]  = like($term);
    }
    $sqlWhere = implode(' AND ', $where);

    return Db::all(
        "SELECT s.id, s.product_name, s.product_type, s.product_price, l.location
           FROM stock s LEFT JOIN product_locations l ON l.product_name = s.product_name
          WHERE $sqlWhere
          GROUP BY s.id ORDER BY s.product_name, s.id LIMIT 500",
        ...$args
    );
});
```

to (matching `lib/api.js:1510-1521` — the SQL-level `sold=0` filter is dropped because `expandLots()` needs BOTH sold and unsold virtual units to fan out a partially-sold lot correctly, then the unsold filter is applied in PHP *after* expansion, and `product_locations`/`remaining_qty`/`initial_qty` are carried through so `expandLots()` has what it needs):

```php
GET('/api/reports/stock-labels', function (array $req) {
    $q     = $req['query'];
    $where = [];
    $args  = [];

    if ($type = str_or($q['type'] ?? null)) {
        $where[] = 's.product_type = ?';
        $args[]  = $type;
    }
    if ($term = str_or($q['q'] ?? null)) {
        $where[] = 's.product_name LIKE ?';
        $args[]  = like($term);
    }
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $lots = Db::all(
        "SELECT s.id, s.product_name, s.product_type, s.product_price,
                s.remaining_qty, s.initial_qty, l.location
           FROM v_stock_lot s LEFT JOIN product_locations l ON l.product_name = s.product_name
           $sqlWhere
          ORDER BY s.product_name, s.id",
        ...$args
    );
    $rows = array_values(array_filter(expandLots($lots), fn($r) => !$r['sold']));
    return array_slice($rows, 0, 500);
});
```

- [ ] **Step 5: Fix `/api/reports/unsold-stock` — same expand-then-filter shape**

Change:

```php
GET('/api/reports/unsold-stock', fn(array $r) => Db::all(
    'SELECT s.*, l.location, DATEDIFF(NOW(), s.stock_date) age_days
       FROM stock s LEFT JOIN product_locations l ON l.product_name = s.product_name
      WHERE s.sold = 0 AND DATEDIFF(NOW(), s.stock_date) >= ?
      GROUP BY s.id ORDER BY s.stock_date LIMIT 500',
    int_or($r['query']['days'] ?? null, 180)
));
```

to (matching `lib/api.js:1523-1530` — again, the SQL drops the `sold=0` pre-filter so a partially-sold lot's still-remaining units are correctly represented, and the PHP-side filter runs after `expandLots()`):

```php
GET('/api/reports/unsold-stock', function (array $r) {
    $lots = Db::all(
        'SELECT s.*, l.location, DATEDIFF(NOW(), s.stock_date) age_days
           FROM v_stock_lot s LEFT JOIN product_locations l ON l.product_name = s.product_name
          WHERE DATEDIFF(NOW(), s.stock_date) >= ?
          ORDER BY s.stock_date',
        int_or($r['query']['days'] ?? null, 180)
    );
    $rows = array_values(array_filter(expandLots($lots), fn($x) => !$x['sold']));
    return array_slice($rows, 0, 500);
});
```

- [ ] **Step 6: Verify against the real API**

Start this repo's own PHP API (verified). `curl` all 4 endpoints. For `checklist`, cross-check one product's returned `qty` against a direct `SELECT SUM(remaining_qty) FROM stock_lots WHERE product_id = (SELECT id FROM products WHERE name = '<that product>')` — confirm they match, and confirm the number is a plausible *unit* count (not a lot count) by also checking `SELECT COUNT(*) FROM stock_lots WHERE product_id = ... ` differs from it whenever that product has any multi-unit lot. For `stock-labels`/`unsold-stock`, confirm the response has as many rows as `SUM(remaining_qty)` across the matching lots predicts (an independent ground truth, not a re-run of the same query), not as many rows as there are matching lot-rows.

- [ ] **Step 7: Commit**

```bash
git add api/core/Helpers.php api/routes/reports.php
git commit -m "Fix reports.php's four stock-referencing queries, adding expandLots() for item-level reports"
```

---

### Task 3: Fix `lens_jobs.php` and `cases.php`'s stock joins

**Files:**
- Modify: `api/routes/lens_jobs.php` — inside the shared `lensJobDetail(?int $id): array` function (around line 34-43), used by `GET /api/lens-jobs/:id`. `lens_jobs.php` has exactly ONE query joining `stock`. (The `left_lens_stock_id`/`right_lens_stock_id` names that appear again later in this same file, inside `POST /api/lens-jobs` around line 74-84, are plain column names in an INSERT/UPDATE column list, not a second `JOIN stock` query.)
- Modify: `api/routes/cases.php` — a separate, distinct query embedded in the case-detail handler (around line 74-79) with its own `LEFT JOIN stock ls`/`LEFT JOIN stock rs` pair.

This task is unaffected by the batch-quantity design correction — both queries are pure name joins (`product_name`) against `v_stock_lot`, not quantity-aware logic.

**Frontend contract:** `frontend/src/pages/cases/panels/LensPanel.jsx` (verify the exact file if this name has drifted) reads `left_lens_name`/`right_lens_name` off the lens-job object — `v_stock_lot` still provides `product_name`, no shape change.

- [ ] **Step 1: Fix `lens_jobs.php`'s `lensJobDetail()` query**

Around line 34-41:

```php
    $j = Db::get(
        'SELECT lj.*, s.name AS supplier_name,
                ls.product_name AS left_lens_name, rs.product_name AS right_lens_name
           FROM lens_jobs lj
           LEFT JOIN suppliers s ON s.id = lj.supplier_id
           LEFT JOIN stock ls    ON ls.id = lj.left_lens_stock_id
           LEFT JOIN stock rs    ON rs.id = lj.right_lens_stock_id
          WHERE lj.id = ?',
```

Change the two `stock` joins to `v_stock_lot`:

```php
    $j = Db::get(
        'SELECT lj.*, s.name AS supplier_name,
                ls.product_name AS left_lens_name, rs.product_name AS right_lens_name
           FROM lens_jobs lj
           LEFT JOIN suppliers s      ON s.id  = lj.supplier_id
           LEFT JOIN v_stock_lot ls   ON ls.id = lj.left_lens_stock_id
           LEFT JOIN v_stock_lot rs   ON rs.id = lj.right_lens_stock_id
          WHERE lj.id = ?',
```

- [ ] **Step 2: Fix `cases.php`'s embedded lens-job query**

Around line 74-79:

```php
                ls.product_name AS left_lens_name, rs.product_name AS right_lens_name
           FROM lens_jobs lj
           LEFT JOIN suppliers sup ON sup.id = lj.supplier_id
           LEFT JOIN stock ls      ON ls.id  = lj.left_lens_stock_id
           LEFT JOIN stock rs      ON rs.id  = lj.right_lens_stock_id
          WHERE lj.case_id = ? ORDER BY lj.id DESC LIMIT 1',
```

Change the two `stock` joins to `v_stock_lot`:

```php
                ls.product_name AS left_lens_name, rs.product_name AS right_lens_name
           FROM lens_jobs lj
           LEFT JOIN suppliers sup    ON sup.id = lj.supplier_id
           LEFT JOIN v_stock_lot ls   ON ls.id  = lj.left_lens_stock_id
           LEFT JOIN v_stock_lot rs   ON rs.id  = lj.right_lens_stock_id
          WHERE lj.case_id = ? ORDER BY lj.id DESC LIMIT 1',
```

- [ ] **Step 3: Verify against the real API**

`curl /api/lens-jobs/<a real lens_jobs id, if any exist — check with a read-only SELECT first>` and `curl /api/cases/<a real case id>` for a case with no lens job yet (should return `null`/absent lens-job fields via the `LEFT JOIN`, not an error). A populated-join case (a real lens job sourced `from=stock`) may not be creatable yet if Task 5 hasn't landed — it's acceptable to verify only the `NULL`-join path now and defer the populated-join check to Task 6.

- [ ] **Step 4: Commit**

```bash
git add api/routes/lens_jobs.php api/routes/cases.php
git commit -m "Fix lens_jobs.php and cases.php's stock joins to use v_stock_lot"
```

---

### Task 4: Fix `sales.php` — read join, sell (POST), and return (DELETE) — CORRECTED

**Files:**
- Modify: `api/routes/sales.php:33` (GET's join — unaffected by the design correction)
- Modify: `api/routes/sales.php` — POST's sell mutation (around line 44-97) and DELETE's return mutation (around line 103-120), both now port `lib/api.js`'s `pickLot()`/`releaseLot()` logic instead of a single-table `sold`/`clear_date` flip.

**Reference:** `lib/api.js:597-621` (`pickLot`/`releaseLot`), `:1330-1373` (POST/DELETE `/api/sales`).

**Frontend contract:** `frontend/src/pages/shop/{SaleList,SaleForm}.jsx` — unchanged from the first draft's analysis; `SaleList.jsx` reads `st.product_name`/`st.product_type`, `SaleForm.jsx` posts `{product_stock_id: item.id, ...}` and expects the created `sales` row back. No shape change.

- [ ] **Step 1: Fix the GET join**

Line 33, change `LEFT JOIN stock st ON st.id = s.product_stock_id` to `LEFT JOIN v_stock_lot st ON st.id = s.product_stock_id`.

- [ ] **Step 2: Add `pickLot()`/`releaseLot()` helper functions to `sales.php`**

Add near the top of `api/routes/sales.php`, after the `declare(strict_types=1);` line, direct ports of `lib/api.js:597-621`:

```php
/** Sell 1 unit from the given lot (replaces the old `UPDATE stock SET sold=1`).
 *  Returns false if the lot has nothing left (guards a double-sell race) — does
 *  nothing and returns true if $lotId is falsy (a sale with no stock item attached). */
function pickLot(Tx $q, ?int $lotId, ?string $note): bool
{
    if (!$lotId) {
        return true;
    }
    $r = $q->run(
        'UPDATE stock_lots SET remaining_qty = remaining_qty - 1 WHERE id = ? AND remaining_qty > 0',
        $lotId
    );
    if (!$r['affected']) {
        return false;
    }
    $lot = $q->get('SELECT product_id FROM stock_lots WHERE id = ?', $lotId);
    $q->run(
        "INSERT INTO inventory_logs (product_id, lot_id, action_type, quantity, notes)
         VALUES (?,?,'OUT',-1,?)",
        (int) $lot['product_id'], $lotId, nul($note)
    );
    return true;
}

/** Return 1 unit to the given lot (replaces the old `UPDATE stock SET sold=0`). */
function releaseLot(Tx $q, ?int $lotId, ?string $note): void
{
    if (!$lotId) {
        return;
    }
    $r = $q->run('UPDATE stock_lots SET remaining_qty = remaining_qty + 1 WHERE id = ?', $lotId);
    if (!$r['affected']) {
        return;
    }
    $lot = $q->get('SELECT product_id FROM stock_lots WHERE id = ?', $lotId);
    $q->run(
        "INSERT INTO inventory_logs (product_id, lot_id, action_type, quantity, notes)
         VALUES (?,?,'RETURN',1,?)",
        (int) $lot['product_id'], $lotId, nul($note)
    );
}
```

(Note the `-1`/`+1` quantity signs in the `inventory_logs` inserts — this matches `lib/api.js`'s exact convention, per this plan's Global Constraints. `Tx`/`Db` are already available in every route file's scope — no new `use` import needed, matching how the rest of `api/routes/*.php` already calls `Tx $q` methods.)

- [ ] **Step 3: Rewrite the POST sell path**

Replace the entire `POST('/api/sales', ...)` handler with (porting `lib/api.js:1330-1361`):

```php
POST('/api/sales', function (array $req) {
    $body = $req['body'];
    $sid  = int_or($body['product_stock_id'] ?? null);
    if (!$sid) {
        bad('กรุณาเลือกสินค้าจากคลัง');
    }

    $id = Db::tx(function (Tx $q) use ($body, $sid) {
        $s = $q->get('SELECT * FROM v_stock_lot WHERE id = ?', $sid);
        if (!$s) {
            bad("ไม่พบสินค้ารหัส $sid");
        }
        if ((int) $s['sold']) {
            bad("สินค้ารหัส $sid ({$s['product_name']}) ถูกขายไปแล้ว");
        }

        $stamp   = str_or($body['sale_date'] ?? null) ?: nowStamp();
        $rawPrice = $body['price'] ?? null;
        $price   = ($rawPrice === null || $rawPrice === '')
            ? (float) $s['product_price']
            : num($rawPrice);
        $discount = num($body['discount'] ?? null);
        $payType  = str_or($body['pay_type'] ?? null, 'Cash') ?: 'Cash';
        $invoiceCode = str_or($body['invoice_code'] ?? null) ?: invoiceCode();

        $r = $q->run(
            'INSERT INTO sales (invoice_code, sale_date, product_stock_id, customer_id,
               employee_id, price, discount, pay_type, marketing, notes)
             VALUES (?,?,?,?,?,?,?,?,?,?)',
            $invoiceCode, $stamp, $sid, int_or($body['customer_id'] ?? null),
            int_or($body['employee_id'] ?? null), $price, $discount, $payType,
            str_or($body['marketing'] ?? null, 'Walk-in') ?: 'Walk-in',
            nul($body['notes'] ?? null)
        );

        if (!pickLot($q, $sid, trim("ขายสินค้า $invoiceCode"))) {
            bad("สินค้ารหัส $sid ({$s['product_name']}) ถูกขายไปแล้ว");
        }

        $net = round2($price - $discount);
        if ($net > 0) {
            $q->run(
                'INSERT INTO payments (sale_id, kind, method, amount, received_by, paid_at, notes)
                 VALUES (?,?,?,?,?,?,?)',
                $r['insertId'], 'full', $payType, $net,
                int_or($body['employee_id'] ?? null), $stamp, 'ขายสินค้าทั่วไป'
            );
        }
        return $r['insertId'];
    });

    return Db::get('SELECT * FROM sales WHERE id = ?', $id);
});
```

(`$s['sold']` from `v_stock_lot` is checked *before* the transaction's own `pickLot` re-checks `remaining_qty > 0` atomically — this two-layer check matches `lib/api.js:1336`+`:1347-1349` exactly: the first check gives a nicer pre-flight error message using the stock item's own name, the second is the real race-safe guard inside the same transaction.)

- [ ] **Step 4: Rewrite the DELETE return path**

Replace the entire `DELETE('/api/sales/:id', ...)` handler with (porting `lib/api.js:1363-1373`):

```php
DELETE('/api/sales/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    $s  = Db::get('SELECT * FROM sales WHERE id = ?', $id);
    if (!$s) {
        missing();
    }
    Db::tx(function (Tx $q) use ($id, $s) {
        $sid = $s['product_stock_id'] ? (int) $s['product_stock_id'] : null;
        releaseLot($q, $sid, trim('ยกเลิกการขาย ' . ($s['invoice_code'] ?? '')));
        $q->run('DELETE FROM payments WHERE sale_id = ?', $id);
        $q->run('DELETE FROM sales WHERE id = ?', $id);
    });
    return ['ok' => true];
});
```

- [ ] **Step 5: Verify against the real API — a full sell-then-return round trip**

Task 5 (`stock.php`) is not done yet when this task runs in dependency order — create the test stock item via a direct, minimal SQL insert for verification purposes only (not through the not-yet-fixed `POST /api/stock`): insert one `products` row (`name = 'TEST-sales-task4'`, a synthetic unique `sku`) and one matching `stock_lots` row (`initial_qty=1, remaining_qty=1`), then:
- `POST /api/sales` with that lot's id as `product_stock_id` — confirm `200`, confirm the response is a real `sales` row.
- Re-`SELECT` the `stock_lots` row directly — confirm `remaining_qty` is now `0`.
- Confirm a new `inventory_logs` row exists for that `lot_id` with `action_type='OUT'` and `quantity=-1` (the sign matters — confirm it, don't just confirm a row exists).
- `DELETE /api/sales/<the new sale's id>` — confirm `200`.
- Re-`SELECT` the `stock_lots` row again — confirm `remaining_qty` is back to `1`.
- Confirm a new `inventory_logs` row exists with `action_type='RETURN'` and `quantity=1`.
- **Also verify the double-sell guard**: attempt a second `POST /api/sales` against a lot whose `remaining_qty` is already `0` (e.g. re-sell the same test lot before returning it) — confirm it's rejected with an error, not silently accepted.
- Clean up: the `DELETE /api/sales` call above removes the `sales`/`payments` rows it created. Leave the test `products`/`stock_lots` rows in place (no delete endpoint reachable without `stock.php` fixed yet) — state exactly what was left.

- [ ] **Step 6: Commit**

```bash
git add api/routes/sales.php
git commit -m "Fix sales.php's sell/return logic to decrement/increment stock_lots.remaining_qty via pickLot/releaseLot"
```

---

### Task 5: Rewrite `stock.php` — CORRECTED to the real batch-quantity model

**Files:**
- Modify: `api/routes/stock.php` (full rewrite — replace `STOCK_COLS`/`stockVals()` with a `findOrCreateProduct`-equivalent plus small field-extraction helpers; rewrite `GET`/`POST`/`PUT`/`DELETE` to match `lib/api.js`'s exact batch-quantity semantics)

**Reference:** `lib/api.js:582-742` in full — `PRODUCT_ATTR_FIELDS`, `findOrCreateProduct`, and all four `/api/stock*` handlers.

**Frontend contract:** `frontend/src/pages/shop/{StockList,StockForm}.jsx` and `SaleForm.jsx`'s `Picker` — every field either page reads is preserved (see the first draft's analysis, still valid: `product_type, product_name, location, product_price, product_expense, vendor_name, brand, stock_date, sold, clear_date, notes, id`). `StockForm.jsx`'s "Amount" field's hint text ("สร้างเป็นสินค้ารายชิ้น ชิ้นละ 1 รหัส" — "creates individual items, one code each") is now technically describing `expandLots()`'s *effect* rather than the literal DB write (one lot row, expanded to N virtual items on read) — the user-visible behavior (submitting `amount=10` produces what looks like 10 individually listed/sellable items) is unchanged, only preserved by different means, exactly as `lib/api.js`'s own Thai comments (`api.js:577-578`) say was the deliberate goal: *"path and response shape stay identical to the old `stock` table; the frontend needs no changes; everything new is internal."*

- [ ] **Step 1: Replace `STOCK_COLS`/`stockVals()` with `findOrCreateProduct` and small field helpers**

Replace lines 8-31 (the `STOCK_COLS` constant and `stockVals()` function) with (porting `lib/api.js:582-583` and `:623-642`):

```php
const STOCK_ATTR_FIELDS = ['model', 'color', 'size', 'lens_design', 'lens_index',
    'coating', 'tint', 'addons', 'product_line', 'vendor_name'];

function stockAttributes(array $b): string
{
    $out = [];
    foreach (STOCK_ATTR_FIELDS as $f) {
        $out[$f] = nul($b[$f] ?? null);
    }
    return json_encode($out);
}

/** Find an existing product by sku (adding stock for an existing SKU = a new lot
 *  under the same product), or create a new one — matches the old behavior where
 *  each "add to stock" submission was conceptually a new physical item, ported
 *  from lib/api.js's findOrCreateProduct (lib/api.js:623-642). */
function findOrCreateProduct(Tx $q, array $b): int
{
    $sku = nul($b['sku'] ?? null);
    if ($sku) {
        $existing = $q->get('SELECT id FROM products WHERE sku = ?', $sku);
        if ($existing) {
            return (int) $existing['id'];
        }
    }
    $productType = str_or($b['product_type'] ?? null, 'Frame') ?: 'Frame';
    $cat = $q->get('SELECT id FROM categories WHERE code = ?', $productType);
    if (!$cat) {
        bad("ไม่รู้จักประเภทสินค้า: $productType");
    }
    $finalSku = $sku ?: ('SKU-' . strtoupper(uniqid()));
    $r = $q->run(
        'INSERT INTO products (sku, category_id, product_type, name, brand,
           base_selling_price, is_custom_made, attributes)
         VALUES (?,?,?,?,?,?,0,?)',
        $finalSku, (int) $cat['id'], $productType, str_or($b['product_name'] ?? null),
        nul($b['brand'] ?? null), num($b['product_price'] ?? null), stockAttributes($b)
    );
    return $r['insertId'];
}
```

- [ ] **Step 2: Fix `GET /api/stock` (list) — now expands lots into per-unit rows**

Replace the entire `GET('/api/stock', ...)` handler with (porting `lib/api.js:644-663`):

```php
GET('/api/stock', function (array $req) {
    $q     = $req['query'];
    $where = [];
    $args  = [];

    if ($term = str_or($q['q'] ?? null)) {
        $p = like($term);
        $where[] = '(s.product_name LIKE ? OR s.brand LIKE ? OR s.brand_name LIKE ?
                     OR s.vendor_name LIKE ? OR s.sku LIKE ? OR CAST(s.id AS CHAR) = ?)';
        array_push($args, $p, $p, $p, $p, $p, $term);
    }
    if ($type = str_or($q['type'] ?? null)) {
        $where[] = 's.product_type = ?';
        $args[]  = $type;
    }
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $lots = Db::all(
        "SELECT s.*, l.location, sup.name AS supplier_name
           FROM v_stock_lot s
           LEFT JOIN product_locations l ON l.product_name = s.product_name
           LEFT JOIN suppliers sup       ON sup.id = s.supplier_id
           $sqlWhere
          ORDER BY s.id DESC",
        ...$args
    );

    $rows = expandLots($lots);
    $sold = str_or($q['sold'] ?? null);
    if ($sold === '0' || $sold === '1') {
        $target = (int) $sold;
        $rows = array_values(array_filter($rows, fn($r) => $r['sold'] === $target));
    }
    return array_slice($rows, 0, min(int_or($q['limit'] ?? null, 300), 2000));
});
```

(`expandLots()` was added to `api/core/Helpers.php` in Task 2 — reused here, not redefined.)

- [ ] **Step 3: Fix `GET /api/stock/names`**

Replace with (porting `lib/api.js:665-674` — note this groups by `products`, joined with `stock_lots`, summing `initial_qty` — this is the "known product names for the datalist + their all-time received quantity" endpoint, distinct from `checklist`'s "currently available quantity" which sums `remaining_qty`):

```php
GET('/api/stock/names', function (array $req) {
    $type = str_or($req['query']['type'] ?? null);
    $filter = $type !== '' ? 'WHERE p.product_type = ?' : '';
    $args   = $type !== '' ? [$type] : [];
    return Db::all(
        "SELECT p.name AS product_name, p.product_type, MAX(p.base_selling_price) product_price,
                COALESCE(SUM(sl.initial_qty),0) n
           FROM products p LEFT JOIN stock_lots sl ON sl.product_id = p.id
           $filter
          GROUP BY p.name, p.product_type ORDER BY p.name",
        ...$args
    );
});
```

- [ ] **Step 4: Fix `GET /api/stock/:id`**

Replace with (porting `lib/api.js:676-682` — unchanged in shape from the first draft, this one doesn't need `expandLots` since it's a single-lot lookup, not a list):

```php
GET('/api/stock/:id', function (array $req) {
    $s = Db::get(
        'SELECT s.*, l.location FROM v_stock_lot s
           LEFT JOIN product_locations l ON l.product_name = s.product_name
          WHERE s.id = ? LIMIT 1',
        int_or($req['params']['id'])
    );
    if (!$s) {
        missing();
    }
    return $s;
});
```

- [ ] **Step 5: Rewrite `POST /api/stock` — one lot per call, `amount` sets its quantity, not the row count**

Replace the entire `POST('/api/stock', ...)` handler with (porting `lib/api.js:684-703`):

```php
POST('/api/stock', function (array $req) {
    $body = $req['body'];
    if (str_or($body['product_name'] ?? null) === '') {
        bad('กรุณากรอกชื่อสินค้า');
    }
    $amount    = min(max(int_or($body['amount'] ?? null, 1) ?? 1, 1), 500);
    $stockDate = str_or($body['stock_date'] ?? null) ?: nowStamp();

    $lotId = Db::tx(function (Tx $q) use ($body, $amount, $stockDate) {
        $productId = findOrCreateProduct($q, $body);
        $r = $q->run(
            'INSERT INTO stock_lots (lot_number, product_id, supplier_id, cost_per_unit,
               initial_qty, remaining_qty, received_date, notes)
             VALUES (?,?,?,?,?,?,DATE(?),?)',
            'LOT-' . strtoupper(uniqid()), $productId, int_or($body['supplier_id'] ?? null),
            num($body['product_expense'] ?? null), $amount, $amount, $stockDate,
            nul($body['notes'] ?? null)
        );
        $q->run(
            "INSERT INTO inventory_logs (product_id, lot_id, action_type, quantity, notes)
             VALUES (?,?,'IN',?,'รับเข้าคลัง')",
            $productId, $r['insertId'], $amount
        );
        return $r['insertId'];
    });

    // Old behavior returned one id per individual item; now every unit in this
    // batch shares the one lot id — StockForm.jsx's success toast
    // (`ids[0]${count>1 ? '–'+ids.at(-1) : ''}`) still renders sensibly with a
    // single-element ids array (it just won't show a range for amount>1 anymore,
    // a cosmetic difference StockForm.jsx doesn't need to change for).
    return ['ok' => true, 'ids' => [$lotId], 'count' => $amount];
});
```

- [ ] **Step 6: Rewrite `PUT /api/stock/:id` — matches `lib/api.js`'s exact field set (no sku edit)**

Replace the entire `PUT('/api/stock/:id', ...)` handler with (porting `lib/api.js:705-722` — note `sku` is deliberately NOT editable here, matching the reference implementation exactly; the earlier draft's inclusion of a sku update was not derived from any verified source and must not be carried over):

```php
PUT('/api/stock/:id', function (array $req) {
    $id  = int_or($req['params']['id']);
    $lot = Db::get('SELECT * FROM stock_lots WHERE id = ?', $id);
    if (!$lot) {
        missing();
    }
    $body = $req['body'];

    Db::tx(function (Tx $q) use ($id, $lot, $body) {
        $q->run(
            'UPDATE products SET product_type=?, name=?, brand=?, base_selling_price=?, attributes=?
               WHERE id = (SELECT product_id FROM stock_lots WHERE id = ?)',
            str_or($body['product_type'] ?? null, 'Frame') ?: 'Frame',
            str_or($body['product_name'] ?? null), nul($body['brand'] ?? null),
            num($body['product_price'] ?? null), stockAttributes($body), $id
        );
        $q->run(
            'UPDATE stock_lots SET supplier_id=?, cost_per_unit=?, notes=? WHERE id = ?',
            int_or($body['supplier_id'] ?? null), num($body['product_expense'] ?? null),
            nul($body['notes'] ?? null), $id
        );
    });

    return Db::get('SELECT s.* FROM v_stock_lot s WHERE s.id = ?', $id);
});
```

- [ ] **Step 7: Rewrite `DELETE /api/stock/:id` — per-unit delete semantics**

Replace the entire `DELETE('/api/stock/:id', ...)` handler with (porting `lib/api.js:724-744` — deleting "one item" from a multi-unit lot decrements the lot rather than deleting it, and the `inventory_logs` row is inserted *before* the possible `DELETE`, per this plan's Global Constraint on FK-cascade ordering):

```php
DELETE('/api/stock/:id', function (array $req) {
    $id  = int_or($req['params']['id']);
    $lot = Db::get('SELECT * FROM stock_lots WHERE id = ?', $id);
    if (!$lot) {
        missing();
    }
    if (!(int) $lot['remaining_qty']) {
        bad('ลบไม่ได้ — สินค้าล็อตนี้ขายหมดแล้ว');
    }
    Db::tx(function (Tx $q) use ($id, $lot) {
        $q->run(
            "INSERT INTO inventory_logs (product_id, lot_id, action_type, quantity, notes)
             VALUES (?,?,'ADJUST',-1,'ลบออกจากหน้าคลัง')",
            (int) $lot['product_id'], $id
        );
        if ((int) $lot['initial_qty'] <= 1) {
            $q->run('DELETE FROM stock_lots WHERE id = ?', $id);
        } else {
            $q->run(
                'UPDATE stock_lots SET initial_qty = initial_qty - 1, remaining_qty = remaining_qty - 1
                   WHERE id = ?',
                $id
            );
        }
    });
    return ['ok' => true];
});
```

(Deliberately does not delete the `products` row even when the last lot under it is removed — harmless orphan, avoids any risk, matches the first draft's reasoning on this one point.)

- [ ] **Step 8: Verify against the real API — the full CRUD lifecycle, including multi-unit-lot behavior specifically**

With this repo's own PHP API running (verified, throwaway port):
- `POST /api/stock` with `amount=5`, tagged `product_name: "TEST-stock-task5"` — confirm the response is `{ok:true, ids:[<one id>], count:5}` (ONE id, not five), and confirm directly against the DB that exactly ONE `stock_lots` row was created with `initial_qty=5, remaining_qty=5`.
- `GET /api/stock?q=TEST-stock-task5` — confirm **5 separate rows** are returned (not 1), each with `sold:0`, proving `expandLots()` is working — this is the one check that most directly proves the fix's core design, verify it explicitly and paste the actual response.
- `GET /api/stock/names` — confirm it still returns without error.
- `PUT /api/stock/<the one lot id>` with an edited `product_price` — confirm the response reflects it, confirm `products.base_selling_price` actually changed in the DB, and confirm the response does NOT include a changed `sku` even if one was sent (proving the deliberate no-sku-edit behavior).
- `DELETE /api/stock/<the same lot id>` once (deleting "one unit" from a lot of 5) — confirm `{ok:true}`, then `GET /api/stock?q=TEST-stock-task5` again and confirm now only **4** rows are returned, and directly confirm `stock_lots.initial_qty=4, remaining_qty=4` (the row still exists, just decremented — not deleted).
- Repeatedly `DELETE` the same id 3 more times, confirming the row count drops to 3, 2, then 1 unit each time, then confirm the 5th `DELETE` (down to `initial_qty<=1`) actually removes the `stock_lots` row entirely — confirm via a direct `SELECT` that the row is gone.
- Confirm the orphaned `products` row (`TEST-stock-task5`) is deliberately still present.
- Attempt `POST /api/stock` again with the SAME `sku` as an earlier still-existing test product from this task (if one was given a sku) — confirm it creates a NEW `stock_lots` row under the SAME `products.id` rather than a duplicate product (proving `findOrCreateProduct`'s dedup behavior).
- Attempt `DELETE` on a lot whose `remaining_qty=0` (e.g. via Task 4's leftover sold-out test lot, if still present) — confirm it's rejected with the `ลบไม่ได้` error.
- **Data left behind**: state exactly which `products`/`stock_lots` rows remain after this task's verification.

- [ ] **Step 9: Commit**

```bash
git add api/routes/stock.php
git commit -m "Rewrite stock.php to the real batch-quantity model, porting lib/api.js's verified logic"
```

---

### Task 6: End-to-end verification against the real Vite frontend

**Files:** none (verification only — this task proves the fix works through the actual UI a real user would use, not just isolated `curl` calls).

- [ ] **Step 1: Start this repo's own PHP API + the Vite frontend dev server** (verified, throwaway ports — MySQL/XAMPP already running, shared, don't touch).

- [ ] **Step 2: Drive the full flow through the real browser UI** (headless Chrome via DevTools Protocol):
  - `/stock/new` — add a new stock item with `amount=3` (tag it `TEST-stock-task6`), confirm success toast and redirect to `/stock`.
  - `/stock` — confirm **3 separate rows** for the new item (not 1) — this is the user-facing proof that `expandLots()` preserves the old "amount=N creates N individually listed items" experience.
  - `/dashboard` (or `/`) — confirm `stock_on_hand` went up by exactly 3 (a real behavioral delta check, not a raw-number assertion — read the value before and after this step).
  - `/sales/new` — use the Picker to find and select one of the 3 `TEST-stock-task6` rows, fill in the sale form, submit — confirm success and redirect.
  - `/stock` — confirm exactly **2** of the 3 `TEST-stock-task6` rows remain in the default (`sold=0`) view.
  - `/dashboard` — confirm `stock_on_hand` went back down by exactly 1 from its post-add value.
  - `/sales` — confirm the new sale appears with the correct product name.
  - `/reports/daily` covering today — confirm the sale appears there too, with no console errors.
  - Check the browser console for errors throughout — zero tolerance, this exercises code that was fully broken at the start of this plan.

- [ ] **Step 3: Confirm no other previously-broken pages regressed**

Load `/reports` (`ReportIndex.jsx`), `/reports/checklist` (`Checklist.jsx`), `/reports/labels` (`Labels.jsx`), `/reports/unsold` (`Unsold.jsx`) directly — confirm each loads without a console error or a blank crash page.

- [ ] **Step 4: If Task 3 deferred its populated-join check, do it now**

Create a real lens job with `source=stock` and `left_lens_stock_id` pointing at a real, available `stock_lots` id (via the UI if a lens-job creation flow is reachable, or via a direct `POST /api/lens-jobs` call if the UI path is deep/complex) — confirm `GET /api/lens-jobs/:id` and the case-detail page both show the correct `left_lens_name`, proving `lens_jobs.php`/`cases.php`'s joins work with real populated data, not just the `NULL` case.

- [ ] **Step 5: Report data left behind**

Summarize every piece of test data created across Tasks 1-6 that remains in the live DB.

- [ ] **Step 6: No commit needed for this task** unless Step 2/3/4 finds a real regression, in which case fix it in the relevant Task's file, re-verify, and commit the fix with a message describing the actual bug found.

---

## Self-Review Notes

- **Spec coverage:** every file identified as broken has a corresponding task. This revision replaced an unverified "simplify to qty=1" design with a direct port of `lib/api.js`'s already-correct, already-production-tested logic — every task now cites the exact reference lines it ports, so an implementer or reviewer can cross-check against a working implementation rather than trusting this plan's prose alone.
- **Placeholder scan:** no TBDs; every step has exact before/after code or an exact command.
- **Type/name consistency:** `expandLots()`, `pickLot()`, `releaseLot()`, `findOrCreateProduct()` are each defined once (in `Helpers.php`, `sales.php`, and `stock.php` respectively) and referenced consistently by every task that uses them, matching PHP's global function scope (no import statements needed, consistent with how `str_or`/`nul`/`int_or`/`num`/`bad`/`missing` are already used unqualified throughout `api/routes/*.php`).
- **Scope:** this plan touches only `api/core/Helpers.php` and `api/routes/{dashboard,reports,lens_jobs,cases,sales,stock}.php`. No database schema changes anywhere. No `frontend/` or `frontend-next/` changes.
- **A note on `lib/api.js` itself:** this plan reads from it as a reference but does not modify, commit, or otherwise touch it — it remains the separate, still-uncommitted legacy Node.js app tracked outside this plan's scope. Porting its logic into PHP does not constitute "finishing" or validating that file's own review status.

---

### Task 7 (added after final review): fix `orders.php`'s remaining `stock` references, and `stock.php`'s Thai-text JSON encoding

**Why this task exists:** the final whole-branch review found `api/routes/orders.php` still queries the dropped `stock` table at 4 sites — a real scoping gap in this plan's original research (this file was never assigned a task). Confirmed live: `POST /api/orders/:id/fill|close|reopen` and `GET /api/orders/:id` (and `GET /api/reports/order/:id`, which calls the same `orderDetail()`) will 500 the moment they're exercised — this is a core money workflow (closing a sale), not a peripheral one. The review also found `stock.php`'s `json_encode()` calls store Thai text escaped (`\uXXXX`) unlike `lib/api.js`'s `JSON.stringify()`, which writes raw UTF-8 to the same shared `products.attributes` column — a genuine port divergence, not an inherited behavior.

**Files:**
- Modify: `api/core/Helpers.php` — relocate `pickLot()`/`releaseLot()` here from `sales.php` (both files need them; PHP has no per-file scoping — every route file loads into one global namespace via `api/index.php`, so two files defining the same function name would fatal-error)
- Modify: `api/routes/sales.php` — remove its now-relocated `pickLot()`/`releaseLot()` definitions (nothing else in this file changes)
- Modify: `api/routes/orders.php` — `orderDetail()`'s item lookup, `fill`'s stock-item pick, `close`'s sold-marking loop (→ `pickLot`), `reopen`'s sold-clearing loop (→ `releaseLot`)
- Modify: `api/routes/stock.php` — add `JSON_UNESCAPED_UNICODE` to both `json_encode()` calls in `stockAttributes()`

**Reference:** `lib/api.js:904-1002` (fill/close/reopen), `:597-621` (pickLot/releaseLot, already ported once for Task 4 — this task just relocates them, does not re-derive them).

**Frontend contract:** `frontend/src/pages/orders/*.jsx` reads `orderDetail()`'s response shape (`left_lens`, `right_lens`, `frame` objects, `payment_rows`, `balance`) — unchanged, only the `FROM`/mutation targets change internally.

- [ ] **Step 1: Move `pickLot()`/`releaseLot()` from `sales.php` to `api/core/Helpers.php`**

Cut the two functions (currently right after `declare(strict_types=1);` in `sales.php`) verbatim — their exact current committed text, doc comments included — and paste them into `api/core/Helpers.php`, near `expandLots()`. Delete them from `sales.php` (leave everything else in that file untouched — its `GET`/`POST`/`DELETE` handlers already call `pickLot`/`releaseLot` by name, and PHP resolves that against the global function table regardless of which file defined it, as long as `Helpers.php` loads before `sales.php` — confirmed via `api/index.php`: `core/Helpers.php` is required before any `routes/*.php` file).

- [ ] **Step 2: Fix `orderDetail()`'s item lookup**

In `api/routes/orders.php`, line 56:

```php
    $item = fn($sid) => $sid ? Db::get('SELECT * FROM stock WHERE id = ?', (int) $sid) : null;
```

to:

```php
    $item = fn($sid) => $sid ? Db::get('SELECT * FROM v_stock_lot WHERE id = ?', (int) $sid) : null;
```

- [ ] **Step 3: Fix `fill`'s stock-item pick**

Around line 205:

```php
        $s = Db::get('SELECT * FROM stock WHERE id = ?', $sid);
```

to:

```php
        $s = Db::get('SELECT * FROM v_stock_lot WHERE id = ?', $sid);
```

(The `(int) $s['sold']` check immediately below this, and everything else in the `fill` handler, is already correct against `v_stock_lot`'s computed `sold` column — no other change needed here.)

- [ ] **Step 4: Fix `close`'s sold-marking loop — now uses `pickLot`**

Replace:

```php
        foreach ([$o['lens_product_id'], $o['right_lens_product_id'], $o['frame_product_id']] as $sid) {
            if ($sid) {
                $q->run(
                    'UPDATE stock SET sold = 1, clear_date = ? WHERE id = ? AND sold = 0',
                    $stamp,
                    (int) $sid
                );
            }
        }
```

with (porting `lib/api.js:969-971`):

```php
        foreach ([$o['lens_product_id'], $o['right_lens_product_id'], $o['frame_product_id']] as $sid) {
            if ($sid) {
                pickLot($q, (int) $sid, 'ปิดการขายออเดอร์ ' . ($o['invoice_code'] ?? ''));
            }
        }
```

(This drops the `$stamp`/`clear_date` write — `v_stock_lot` reconstructs `clear_date` from `inventory_logs` now, exactly as `stock.php`'s Task 5 fix already established; `pickLot` writes the `inventory_logs` row itself. This intentionally does not check `pickLot`'s boolean return value — `lib/api.js:969-971` doesn't either; a lot that's already sold out at close-time silently no-ops here rather than blocking the close, matching the reference behavior exactly. If you believe this silent-no-op is itself a defect, do not fix it — it's a faithful port of already-shipped behavior; flag it as a concern in your report instead.)

- [ ] **Step 5: Fix `reopen`'s sold-clearing loop — now uses `releaseLot`**

Replace:

```php
        foreach ([$o['lens_product_id'], $o['right_lens_product_id'], $o['frame_product_id']] as $sid) {
            if ($sid) {
                $q->run('UPDATE stock SET sold = 0, clear_date = NULL WHERE id = ?', (int) $sid);
            }
        }
```

with (porting `lib/api.js:993-995`):

```php
        foreach ([$o['lens_product_id'], $o['right_lens_product_id'], $o['frame_product_id']] as $sid) {
            if ($sid) {
                releaseLot($q, (int) $sid, 'เปิดออเดอร์ ' . ($o['invoice_code'] ?? '') . ' กลับ');
            }
        }
```

- [ ] **Step 6: Fix `stock.php`'s Thai-text JSON encoding**

In `api/routes/stock.php`'s `stockAttributes()` function, change:

```php
    return json_encode($out);
```

to:

```php
    return json_encode($out, JSON_UNESCAPED_UNICODE);
```

(There are two `json_encode($out)` call sites inside `stockAttributes()` if the function has a POST-vs-PUT branch, or one if it's shared — check the current committed file directly rather than assuming; add the flag to every `json_encode()` call in this function.)

- [ ] **Step 7: Verify against the real API**

Start this repo's own PHP API (verified). With a real, existing open order (query one directly if needed — read-only), or a freshly created test order (tagged clearly):
- `GET /api/orders/:id` — confirm no 500, confirm `left_lens`/`right_lens`/`frame` resolve correctly (test with an order that has no stock items filled yet — all three should be `null`, not an error).
- `GET /api/reports/order/:id` for the same order — same check (this endpoint calls the same `orderDetail()`).
- Create a real stock item via `POST /api/stock` (tagged `TEST-orders-task7`), `POST /api/orders/:id/fill` with it as the frame — confirm success, confirm `stock_lots.remaining_qty` is unaffected by fill alone (fill doesn't decrement — matches `lib/api.js`, only `close` does).
- `POST /api/orders/:id/close` on that order — confirm success, confirm the filled stock item's `stock_lots.remaining_qty` decremented by 1, confirm a new `inventory_logs` row with `action_type='OUT'`, `quantity=-1`.
- `POST /api/orders/:id/reopen` on the same order — confirm the stock item's `remaining_qty` incremented back, confirm a new `inventory_logs` row with `action_type='RETURN'`, `quantity=1`.
- Create one product via `POST /api/stock` with a Thai `product_name`/`model` etc., then `GET` it back and confirm the raw DB value in `products.attributes` (direct `SELECT`) contains literal Thai UTF-8 characters, not `\u0e...`-escaped sequences.
- State exactly what test data (orders, stock items) remain afterward.

- [ ] **Step 8: Commit**

```bash
git add api/core/Helpers.php api/routes/sales.php api/routes/orders.php api/routes/stock.php
git commit -m "Fix orders.php's remaining stock references and stock.php's Thai-text JSON encoding"
```

---

## After This Plan

With the backend caught up to the live schema, the previously-deferred Next.js domains (`orders`' fill/close paths, `stock`, `sales`, the stock-touching parts of `reports`) become portable — but that is a separate decision for a future planning session, not something this plan initiates.
