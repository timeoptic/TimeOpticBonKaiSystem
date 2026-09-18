<?php
/**
 * Data layer — MariaDB / MySQL via PDO.
 * Mirrors the query surface the old Node data layer exposed: all/get/run/tx.
 */
declare(strict_types=1);

final class Db
{
    private static ?PDO $pdo = null;
    private static array $cfg = [];

    public static function configure(array $dbConfig): void
    {
        self::$cfg = $dbConfig;
    }

    public static function pdo(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }
        $c = self::$cfg;
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=%s',
            $c['host'],
            $c['port'],
            $c['database'],
            $c['charset']
        );
        self::$pdo = new PDO($dsn, $c['user'], $c['password'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // real prepared statements, and let MySQL's own types through
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_STRINGIFY_FETCHES  => false,
        ]);
        /* ฐานเก็บเวลาไทย — NOW() กับ DEFAULT CURRENT_TIMESTAMP ต้องเป็นนาฬิกาเดียวกับ
           date() ของ PHP (Asia/Bangkok ใน index.php) · ห้ามพึ่งเวลาของเครื่องฐานข้อมูล:
           MariaDB บน Hostinger เป็น UTC ทุกค่าที่ฐานเขียนเองจึงเคยช้า 7 ชั่วโมง ขณะที่
           เครื่องพัฒนาเป็นเวลาไทยจึงไม่มีใครเห็น (12 ก.ย. 2026) · ระบบคลังยืมคอนเนกชัน
           นี้ผ่าน StockModule ด้วย คำสั่งเดียวกันใน stock/api/src/Db.php จึงไม่ได้ทำงาน
           บนเว็บจริง ที่นี่คือที่เดียวที่มีผล (api/tests/01-db-timezone.test.php) */
        self::$pdo->exec("SET SESSION time_zone = '+07:00'");
        return self::$pdo;
    }

    /**
     * Prepare + execute. Integer parameters are bound as integers because
     * native prepares reject a quoted value in `LIMIT ?`.
     */
    private static function exec(string $sql, array $params, ?PDO $conn = null): PDOStatement
    {
        $st = ($conn ?? self::pdo())->prepare($sql);
        foreach (array_values($params) as $i => $v) {
            $type = PDO::PARAM_STR;
            if (is_int($v)) {
                $type = PDO::PARAM_INT;
            } elseif (is_bool($v)) {
                $type = PDO::PARAM_INT;
                $v = $v ? 1 : 0;
            } elseif ($v === null) {
                $type = PDO::PARAM_NULL;
            }
            $st->bindValue($i + 1, $v, $type);
        }
        $st->execute();
        return $st;
    }

    /** All matching rows. */
    public static function all(string $sql, mixed ...$params): array
    {
        return self::exec($sql, $params)->fetchAll();
    }

    /** First row, or null. */
    public static function get(string $sql, mixed ...$params): ?array
    {
        $row = self::exec($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    /** Write. Returns ['insertId' => int, 'affected' => int]. */
    public static function run(string $sql, mixed ...$params): array
    {
        $st = self::exec($sql, $params);
        return [
            'insertId' => (int) self::pdo()->lastInsertId(),
            'affected' => $st->rowCount(),
        ];
    }

    /**
     * Run $fn inside a transaction. $fn receives a Tx object whose
     * all/get/run go through the same connection — always use those.
     */
    public static function tx(callable $fn): mixed
    {
        $pdo = self::pdo();
        // nested tx() calls join the outer transaction instead of failing
        if ($pdo->inTransaction()) {
            return $fn(new Tx($pdo));
        }
        $pdo->beginTransaction();
        try {
            $out = $fn(new Tx($pdo));
            $pdo->commit();
            return $out;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /** Startup check — mirrors the banner the Node server printed. */
    public static function verifyConnection(): array
    {
        $v = self::get('SELECT VERSION() AS version, DATABASE() AS db');
        $t = self::get(
            'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?',
            self::$cfg['database']
        );
        return [
            'version' => $v['version'] ?? '?',
            'db'      => $v['db'] ?? '?',
            'tables'  => (int) ($t['n'] ?? 0),
        ];
    }
}

/** Transaction-scoped query helpers handed to Db::tx() callbacks. */
final class Tx
{
    public function __construct(private PDO $conn)
    {
    }

    private function exec(string $sql, array $params): PDOStatement
    {
        $st = $this->conn->prepare($sql);
        foreach (array_values($params) as $i => $v) {
            $type = PDO::PARAM_STR;
            if (is_int($v)) {
                $type = PDO::PARAM_INT;
            } elseif (is_bool($v)) {
                $type = PDO::PARAM_INT;
                $v = $v ? 1 : 0;
            } elseif ($v === null) {
                $type = PDO::PARAM_NULL;
            }
            $st->bindValue($i + 1, $v, $type);
        }
        $st->execute();
        return $st;
    }

    public function all(string $sql, mixed ...$params): array
    {
        return $this->exec($sql, $params)->fetchAll();
    }

    public function get(string $sql, mixed ...$params): ?array
    {
        $row = $this->exec($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    public function run(string $sql, mixed ...$params): array
    {
        $st = $this->exec($sql, $params);
        return [
            'insertId' => (int) $this->conn->lastInsertId(),
            'affected' => $st->rowCount(),
        ];
    }
}
