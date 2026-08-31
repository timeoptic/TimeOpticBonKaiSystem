<?php

declare(strict_types=1);

namespace Optic;

use PDO;

/**
 * One PDO connection per process, configured so mistakes fail loudly.
 *
 * Two settings here are not decoration:
 *
 *  - STRICT_TRANS_TABLES is forced on the session. The server runs without it,
 *    and its absence means an UNSIGNED column driven below zero is clamped to 0
 *    with a warning instead of raising an error — a stock ledger would go wrong
 *    silently. It is set per session on purpose: the shop-floor system shares
 *    this server and may rely on the looser behaviour, so changing it globally
 *    is not ours to do.
 *
 *  - ERRMODE_EXCEPTION, so a failed statement can never be mistaken for an
 *    empty result.
 */
final class Db
{
    private static ?PDO $pdo = null;

    /** @var (callable(): PDO)|null */
    private static $factory = null;

    public static function conn(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        // A host application's own connection, asked for only when it is needed.
        if (self::$factory !== null) {
            return self::$pdo = (self::$factory)();
        }

        $c = Env::database();
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $c['host'],
            $c['port'],
            $c['name'],
        );

        $pdo = new PDO($dsn, $c['user'], $c['pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // Real prepared statements — the driver must not fake them, or the
            // FOR UPDATE locking below would not behave the way we expect.
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_STRINGIFY_FETCHES  => false,
        ]);

        $pdo->exec("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,NO_ENGINE_SUBSTITUTION'");
        $pdo->exec("SET SESSION time_zone = '+07:00'");

        return self::$pdo = $pdo;
    }

    /** Test seam — lets a test swap in its own connection. */
    public static function setConn(?PDO $pdo): void
    {
        self::$pdo = $pdo;
    }

    /**
     * How a host application hands this module its connection.
     *
     * A callable rather than the connection itself, because the handover
     * happens while the request is being set up and most requests never reach
     * the database at all — asking for it eagerly turns "is anyone signed in?"
     * into a database round trip, and turns a database that is merely switched
     * off into a twenty-three second wait ending in 500 where the honest answer
     * was "nobody is signed in", available instantly from the session.
     *
     * @param (callable(): PDO)|null $factory
     */
    public static function setConnFactory(?callable $factory): void
    {
        self::$factory = $factory;
        self::$pdo = null;
    }

    /**
     * Runs $fn inside a transaction, committing on return and rolling back on
     * any throw. Nested calls join the outer transaction rather than opening a
     * second one, which MySQL does not support anyway.
     *
     * @template T
     * @param callable(PDO):T $fn
     * @return T
     */
    public static function tx(callable $fn): mixed
    {
        $pdo = self::conn();

        if ($pdo->inTransaction()) {
            return $fn($pdo);
        }

        $pdo->beginTransaction();
        try {
            $out = $fn($pdo);
            $pdo->commit();
            return $out;
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /** @param array<string|int,mixed> $args */
    public static function all(string $sql, array $args = []): array
    {
        $st = self::conn()->prepare($sql);
        $st->execute($args);
        return $st->fetchAll();
    }

    /** @param array<string|int,mixed> $args */
    public static function one(string $sql, array $args = []): ?array
    {
        $st = self::conn()->prepare($sql);
        $st->execute($args);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    /** @param array<string|int,mixed> $args */
    public static function value(string $sql, array $args = []): mixed
    {
        $row = self::one($sql, $args);
        return $row === null ? null : reset($row);
    }

    /**
     * Runs a write and returns the number of rows it actually changed.
     * Callers check this — an UPDATE guarded by a WHERE clause reporting 0 rows
     * is how we detect a race, not an exception.
     *
     * @param array<string|int,mixed> $args
     */
    public static function run(string $sql, array $args = []): int
    {
        $st = self::conn()->prepare($sql);
        $st->execute($args);
        return $st->rowCount();
    }
}
