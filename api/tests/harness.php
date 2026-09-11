<?php

declare(strict_types=1);

/**
 * A test harness small enough to read in one sitting.
 *
 * Same shape as `stock/api/tests/harness.php` — deliberately, so someone who
 * has read one suite can read the other without learning a second vocabulary.
 * There is no PHPUnit here for the same reason there is none there: no
 * Composer, and the whole runner is shorter than PHPUnit's config file.
 *
 * Each test file registers cases with test(); run.php executes them.
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

function failTest(string $message): never
{
    throw new AssertionFailed($message);
}

function ok(bool $cond, string $message): void
{
    if (!$cond) {
        failTest($message);
    }
}

function eq(mixed $actual, mixed $expected, string $what): void
{
    if ($actual !== $expected) {
        failTest(sprintf('%s — ได้ %s แต่ควรเป็น %s', $what, render($actual), render($expected)));
    }
}

function render(mixed $v): string
{
    return is_scalar($v) || $v === null
        ? var_export($v, true)
        : json_encode($v, JSON_UNESCAPED_UNICODE);
}

/**
 * Runs $fn inside a transaction that is always rolled back.
 *
 * Fixtures therefore live only for the length of one case, and the shop's real
 * catalogue is never touched — which matters because this suite runs against
 * the same database the shop uses.
 */
function rollback(callable $fn): void
{
    $pdo = Db::pdo();
    $pdo->beginTransaction();
    try {
        $fn(new Tx($pdo));
    } finally {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
    }
}
