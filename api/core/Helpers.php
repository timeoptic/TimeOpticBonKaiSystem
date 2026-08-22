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

/** Next sequential code for a year-scoped series, e.g. CASE-2026-0008 */
function nextCode(string $prefix, string $table, string $column): string
{
    $year = (int) date('Y');
    $row  = Db::get(
        "SELECT MAX(CAST(SUBSTRING_INDEX(`$column`, '-', -1) AS UNSIGNED)) AS n
           FROM `$table` WHERE `$column` LIKE ?",
        "$prefix-$year-%"
    );
    $n = (int) ($row['n'] ?? 0) + 1;
    return sprintf('%s-%d-%04d', $prefix, $year, $n);
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
