<?php
/**
 * Value coercion + date/code helpers.
 * These are ports of the small helpers the Node API used everywhere, so the
 * route code below reads the same as the original.
 */
declare(strict_types=1);

/** number with a fallback, '' and non-numeric become $d */
function num(mixed $v, float $d = 0.0): float
{
    if ($v === '' || $v === null || !is_numeric($v)) {
        return $d;
    }
    return (float) $v;
}

/** integer or $d (default null) */
function int_or(mixed $v, ?int $d = null): ?int
{
    if (is_int($v)) {
        return $v;
    }
    if ($v === null || $v === '' || is_array($v)) {
        return $d;
    }
    if (is_bool($v)) {
        return $v ? 1 : 0;
    }
    $n = filter_var($v, FILTER_VALIDATE_INT);
    if ($n !== false) {
        return $n;
    }
    // '12abc' -> 12, matching JS parseInt
    if (preg_match('/^\s*[-+]?\d+/', (string) $v, $m)) {
        return (int) $m[0];
    }
    return $d;
}

/** trimmed string with a fallback */
function str_or(mixed $v, string $d = ''): string
{
    if ($v === null || is_array($v)) {
        return $d;
    }
    if (is_bool($v)) {
        return $v ? '1' : '0';
    }
    return trim((string) $v);
}

/** '' -> null, for nullable text/date columns */
function nul(mixed $v): ?string
{
    $s = str_or($v);
    return $s === '' ? null : $s;
}

/** truthy -> 1, everything else -> 0 */
function boolInt(mixed $v): int
{
    return ($v === true || $v === 1 || $v === '1' || $v === 'true' || $v === 'on') ? 1 : 0;
}

/**
 * Wrap a term for LIKE, escaping the wildcards.
 * The backslash itself must be escaped first or it would double-escape the
 * wildcards added after it.
 */
function like(mixed $q): string
{
    $bs = chr(92);
    $s  = trim((string) $q);
    $s  = str_replace($bs, $bs . $bs, $s);
    $s  = str_replace(['%', '_'], [$bs . '%', $bs . '_'], $s);
    return '%' . $s . '%';
}

/** round to 2dp the way money should be */
function round2(mixed $n): float
{
    return round((float) ($n ?: 0), 2);
}

/** 'YYYY-MM-DD HH:mm:ss' for right now */
function nowStamp(?DateTimeInterface $d = null): string
{
    return ($d ?? new DateTime())->format('Y-m-d H:i:s');
}

function today(): string
{
    return substr(nowStamp(), 0, 10);
}

/** Invoice code in the shop's Access format: C + yyMMddHHmmss */
function invoiceCode(?DateTimeInterface $d = null): string
{
    return 'C' . ($d ?? new DateTime())->format('ymdHis');
}

/**
 * จำนวนหลักของเลขท้ายรหัสทุกชุด — CASE / INV / POS / BK ใช้ 5 หลักเท่ากันหมด
 * เคยมีแค่ CASE ที่เป็น 5 ส่วนชุดอื่นเป็น 4 ทำให้รหัสบนใบเสร็จใบเดียวกัน
 * (เลขเคส vs เลขที่ใบ) ยาวไม่เท่ากันและอ่านเทียบกันไม่ได้
 */
const CODE_PAD = 5;

/**
 * Next sequential code for a year-scoped series, e.g. CASE-2026-00008
 *
 * $withMonth คั่นเดือนไว้ระหว่างปีกับเลขลำดับ (Bill-2026-09-00042) — ใช้กับชุด
 * เลขใบเสร็จ เดือนเป็น "ป้ายบอกช่วงเวลา" เฉย ๆ เลขลำดับยังเดินยาวทั้งปีไม่รีเซ็ต
 * รายเดือน เงื่อนไข LIKE จึงกวาดทั้งปีเหมือนชุดอื่น ไม่ใช่กวาดเฉพาะเดือนนี้
 */
function nextCode(string $prefix, string $table, string $column, bool $withMonth = false): string
{
    $year = (int) date('Y');
    /* อ่านเลขท้ายเป็นตัวเลข ไม่ใช่สตริง — แถวเก่าที่ยังเป็น 4 หลัก (INV-2026-0006)
       กับแถวใหม่ 5 หลักจึงเรียงลำดับต่อกันได้ถูกต้อง ไม่ต้องรอให้แปลงครบก่อน
       LIKE ผูกกับ "$prefix-" ตรงตัว ชุด Bill กับ BillP จึงไม่กวาดเจอกันเอง */
    $row = Db::get(
        "SELECT MAX(CAST(SUBSTRING_INDEX(`$column`, '-', -1) AS UNSIGNED)) AS n
           FROM `$table` WHERE `$column` LIKE ?",
        "$prefix-$year-%"
    );
    $n     = (int) ($row['n'] ?? 0) + 1;
    $month = $withMonth ? '-' . date('m') : '';
    return sprintf('%s-%d%s-%0' . CODE_PAD . 'd', $prefix, $year, $month, $n);
}

/** sum a column across rows */
function sumCol(array $rows, string $key): float
{
    $t = 0.0;
    foreach ($rows as $r) {
        $t += (float) ($r[$key] ?? 0);
    }
    return $t;
}

/** group rows into [key => summed amount], '-' for a blank key */
function sumBy(array $rows, string $key, callable $amount): array
{
    $m = [];
    foreach ($rows as $r) {
        $k = ($r[$key] ?? '') !== '' && ($r[$key] ?? null) !== null ? (string) $r[$key] : '-';
        $m[$k] = round2(($m[$k] ?? 0) + (float) $amount($r));
    }
    return $m;
}

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
