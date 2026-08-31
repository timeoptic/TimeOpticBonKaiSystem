<?php

declare(strict_types=1);

/**
 * A test harness small enough to read in one sitting.
 *
 * There is no PHPUnit because there is no Composer — and for a suite this size
 * the whole runner is shorter than the config file PHPUnit would need. Each
 * test file registers cases with test(); run.php executes them and reports.
 */

final class Harness
{
    /** @var list<array{group:string,name:string,fn:callable}> */
    public static array $cases = [];
    public static string $group = 'ทั่วไป';

    public static int $passed = 0;
    /** @var list<string> */
    public static array $failures = [];
}

function group(string $name): void
{
    Harness::$group = $name;
}

function test(string $name, callable $fn): void
{
    Harness::$cases[] = ['group' => Harness::$group, 'name' => $name, 'fn' => $fn];
}

final class AssertionFailed extends RuntimeException {}

function fail(string $message): never
{
    throw new AssertionFailed($message);
}

function ok(bool $cond, string $message): void
{
    if (!$cond) {
        fail($message);
    }
}

function eq(mixed $actual, mixed $expected, string $what): void
{
    if ($actual !== $expected) {
        fail(sprintf('%s — ได้ %s แต่ควรเป็น %s', $what, render($actual), render($expected)));
    }
}

function neq(mixed $actual, mixed $notExpected, string $what): void
{
    if ($actual === $notExpected) {
        fail(sprintf('%s — ไม่ควรเป็น %s แต่ได้ค่านั้น', $what, render($notExpected)));
    }
}

/** Asserts the callable throws an ApiError carrying exactly this reason. */
function throwsReason(string $reason, callable $fn, string $what): \Optic\ApiError
{
    try {
        $fn();
    } catch (\Optic\ApiError $e) {
        if ($e->reason !== $reason) {
            fail(sprintf('%s — โยน reason "%s" แต่ควรเป็น "%s"', $what, $e->reason, $reason));
        }
        return $e;
    } catch (\Throwable $e) {
        fail(sprintf('%s — โยน %s: %s แทนที่จะเป็น ApiError', $what, $e::class, $e->getMessage()));
    }
    fail(sprintf('%s — ไม่โยนอะไรเลย ทั้งที่ควรโยน "%s"', $what, $reason));
}

/**
 * Runs $fn inside a transaction that is always rolled back.
 *
 * Db::tx joins an open transaction instead of starting a second one, so the
 * service under test commits nothing and the tests can work against the real
 * database without leaving a mark on it.
 *
 * @template T
 * @param callable():T $fn
 * @return T
 */
function withRollback(callable $fn): mixed
{
    $pdo = \Optic\Db::conn();
    if ($pdo->inTransaction()) {
        fail('มีทรานแซกชันค้างอยู่ก่อนเริ่มเทสต์');
    }

    $pdo->beginTransaction();
    try {
        return $fn($pdo);
    } finally {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
    }
}

/**
 * A fresh idempotency key per case, so cases never collide with one another.
 *
 * Here rather than in one test file because more than one file needs to move
 * stock, and running a single file with `run.php <name>` loads only that file —
 * a helper defined in a sibling is simply not there.
 */
function idem(string $name): string
{
    return 'test:' . $name . ':' . bin2hex(random_bytes(4));
}

/**
 * The body of a stock movement, with the fields every case needs already
 * filled in. $extra is where a case says what makes it different.
 *
 * @param array<string,mixed> $extra
 * @return array<string,mixed>
 */
function issueReq(string $sku, int $qty, string $k, array $extra = []): array
{
    return [
        'source'   => 'test',
        'idem_key' => $k,
        'sku'      => $sku,
        'quantity' => $qty,
        'actor_id' => 1,
    ] + $extra;
}

/** Reads a lot's current remaining quantity. */
function lotRemaining(string $lotNumber): int
{
    return (int) \Optic\Db::value(
        'SELECT remaining_qty FROM stock_lots WHERE lot_number = ?',
        [$lotNumber],
    );
}

/** A SKU that has stock in more than one lot, so FIFO has something to order. */
function skuWithLots(int $minLots = 2): string
{
    $row = \Optic\Db::one(
        'SELECT p.sku FROM products p
         JOIN stock_lots l ON l.product_id = p.id AND l.remaining_qty > 0
         WHERE p.is_custom_made = 0
         GROUP BY p.id, p.sku
         HAVING COUNT(*) >= ?
         ORDER BY p.id LIMIT 1',
        [$minLots],
    );
    if ($row === null) {
        fail("ไม่พบสินค้าที่มีอย่างน้อย {$minLots} ล็อตที่ยังมีของ");
    }
    return (string) $row['sku'];
}

/**
 * A SKU whose stock all carries a cost, for cases that need a figure to test.
 *
 * Separate from `skuWithLots` because a lot with no cost yet is a normal thing
 * for the shop to hold — the receiving screen exists partly to show them — and
 * a case about money should not fail because FIFO happened to pick one. Which
 * SKU that is depends on what is seeded, so it is asked for rather than assumed.
 */
function skuWithCost(int $minLots = 1): string
{
    $row = \Optic\Db::one(
        'SELECT p.sku FROM products p
         JOIN stock_lots l ON l.product_id = p.id AND l.remaining_qty > 0
         WHERE p.is_custom_made = 0
         GROUP BY p.id, p.sku
         HAVING COUNT(*) >= ? AND SUM(l.cost_per_unit IS NULL) = 0
         ORDER BY p.id LIMIT 1',
        [$minLots],
    );
    if ($row === null) {
        fail("ไม่พบสินค้าที่มีอย่างน้อย {$minLots} ล็อตที่ยังมีของและรู้ต้นทุนครบ");
    }
    return (string) $row['sku'];
}

function render(mixed $v): string
{
    return match (true) {
        is_bool($v)  => $v ? 'true' : 'false',
        is_null($v)  => 'null',
        is_scalar($v) => (string) $v,
        default      => json_encode($v, JSON_UNESCAPED_UNICODE) ?: gettype($v),
    };
}
