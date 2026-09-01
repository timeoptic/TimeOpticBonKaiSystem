<?php

declare(strict_types=1);

namespace Optic\Service;

use Optic\ApiError;
use Optic\Db;
use Optic\Roles;
use PDO;

/**
 * Goods arriving from a supplier.
 *
 * A lot is created and an IN movement recorded in the same transaction, because
 * a lot without its movement is a quantity nobody can explain, and a movement
 * without its lot is stock nobody can cost.
 *
 * `cost_per_unit` is nullable on purpose: goods routinely arrive before the
 * invoice does. Recording the arrival as zero-cost to avoid a null would put a
 * lie in the ledger and quietly inflate the shop's margin, so the column stays
 * empty and the screens count those lots separately.
 */
final class Receiving
{
    /**
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function receive(array $req, string $role, int $actorId): array
    {
        Roles::require(Roles::moveStock($role), 'รับของเข้าคลัง');

        $sku = self::str($req, 'sku', 100);
        $qty = self::qty($req);
        $cost = self::cost($req);
        $received = self::date($req, 'received_date', required: true);
        $expiry = self::date($req, 'expiry_date', required: false);
        $note = self::optional($req, 'note', 500);
        $supplierId = self::supplier($req);

        // A cost is money, and money is a narrower permission than moving stock.
        if ($cost !== null) {
            Roles::require(Roles::enterRxCost($role), 'กรอกต้นทุน');
        }

        $p = Db::one('SELECT id, sku, name, is_custom_made FROM products WHERE sku = ?', [$sku]);
        if ($p === null) {
            throw ApiError::unknownSku($sku);
        }
        if ((bool) $p['is_custom_made']) {
            throw ApiError::conflict(
                'custom_made',
                "{$sku} เป็นสินค้าสั่งตัด ไม่เก็บเป็นล็อตในคลัง",
                ['sku' => $sku],
            );
        }

        if ($expiry !== null && $expiry < $received) {
            throw ApiError::badRequest('วันหมดอายุต้องไม่มาก่อนวันที่รับเข้า', 'bad_expiry');
        }

        // The lot number is the system's own bookkeeping, not something anyone
        // is asked for: what arrives in a box is a quantity and a date, and the
        // number only exists so the ledger can point at one delivery rather than
        // at a running total. A supplier's own number is still accepted when one
        // is sent — it is a better label than an issued one when it exists.
        $lotNumber = trim((string) ($req['lot_number'] ?? '')) === ''
            ? self::issueLotNumber((int) $p['id'], $received)
            : self::str($req, 'lot_number', 100);

        $dup = Db::one(
            'SELECT id FROM stock_lots WHERE lot_number = ? AND product_id = ?',
            [$lotNumber, $p['id']],
        );
        if ($dup !== null) {
            throw ApiError::conflict(
                'duplicate_lot',
                "ล็อต {$lotNumber} ของสินค้านี้มีอยู่แล้ว",
                ['lotNumber' => $lotNumber],
            );
        }

        $lotId = Db::tx(static function (PDO $pdo) use ($p, $lotNumber, $supplierId, $cost, $qty, $received, $expiry, $note, $actorId): int {
            $pdo->prepare(
                'INSERT INTO stock_lots
                   (lot_number, product_id, supplier_id, cost_per_unit, initial_qty,
                    remaining_qty, received_date, expiry_date, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $lotNumber, $p['id'], $supplierId, $cost, $qty, $qty, $received, $expiry,
                $note ?? ($cost === null ? 'รอใบกำกับภาษีจากผู้ขาย' : null),
            ]);

            $id = (int) $pdo->lastInsertId();

            $pdo->prepare(
                'INSERT INTO inventory_logs
                   (product_id, lot_id, action_type, quantity, unit_cost,
                    reference_doc, notes, created_by, created_by_kind, created_at)
                 VALUES (?, ?, \'IN\', ?, ?, ?, ?, ?, \'user\', NOW())'
            )->execute([
                $p['id'], $id, $qty, $cost, 'GRN-' . $lotNumber,
                "รับเข้าคลัง {$lotNumber}", $actorId,
            ]);

            self::settleShortfall($pdo, (int) $p['id'], $id, $lotNumber, $qty, $cost, $actorId);

            return $id;
        });

        return [
            'lotId'        => $lotId,
            'lotNumber'    => $lotNumber,
            'sku'          => $p['sku'],
            'name'         => $p['name'],
            'quantity'     => $qty,
            'unitCost'     => $cost,
            'awaitingCost' => $cost === null,
        ];
    }

    /* -------------------------------------------------------------- helpers */

    /**
     * ของที่เพิ่งมาถึง หักกลบกับที่ขายค้างไว้ก่อนหน้า
     *
     * ขายของที่ยังไม่มีได้ (ดู `Stock::plan`) ส่วนที่เกินไปกองอยู่บนล็อตค้างส่ง
     * เป็นยอดติดลบ · พอของมาถึง ของกล่องใหม่ต้องถูกกันไว้จ่ายหนี้ก้อนนั้นก่อน
     * ไม่งั้นมันจะถูกขายซ้ำอีกรอบ แล้วยอดติดลบก็จะค้างอยู่ตลอดไป
     *
     * ย้ายด้วยสองแถวในสมุด ไม่ใช่แก้ตัวเลขเงียบ ๆ — ออกจากล็อตใหม่หนึ่งแถว เข้า
     * ล็อตค้างส่งหนึ่งแถว · ยอดคงเหลือของทุกล็อตจึงยังเท่ากับผลรวมในสมุด ซึ่งเป็น
     * ข้อที่ `doctor` ตรวจ · แถวขาออกถือต้นทุนของล็อตใหม่ไปด้วย การขายที่ตอนนั้น
     * ยังไม่รู้ต้นทุนจึงได้ต้นทุนของมันที่นี่ ในวันที่รู้จริง
     */
    private static function settleShortfall(
        PDO $pdo,
        int $productId,
        int $newLotId,
        string $newLotNumber,
        int $qty,
        /* ต้นทุนเดินทางมาเป็นสตริงจากฟอร์ม (decimal ไม่ใช่ float ในฐานข้อมูล)
           ที่นี่แค่ส่งต่อลงสมุด จึงรับตามที่มันเป็น ไม่แปลงให้เสียความละเอียด */
        float|string|null $cost,
        ?int $actorId,
    ): void {
        $st = $pdo->prepare(
            'SELECT id, lot_number, remaining_qty FROM stock_lots
             WHERE product_id = ? AND remaining_qty < 0 FOR UPDATE'
        );
        $st->execute([$productId]);
        $short = $st->fetch();
        if ($short === false) {
            return;
        }

        $owed = -(int) $short['remaining_qty'];
        $pay  = min($owed, $qty);
        if ($pay <= 0) {
            return;
        }

        $pdo->prepare('UPDATE stock_lots SET remaining_qty = remaining_qty - ? WHERE id = ?')
            ->execute([$pay, $newLotId]);
        $pdo->prepare('UPDATE stock_lots SET remaining_qty = remaining_qty + ? WHERE id = ?')
            ->execute([$pay, $short['id']]);

        $log = $pdo->prepare(
            'INSERT INTO inventory_logs
               (product_id, lot_id, action_type, quantity, unit_cost,
                reference_doc, notes, created_by, created_by_kind, created_at)
             VALUES (?, ?, \'ADJUST\', ?, ?, ?, ?, ?, \'user\', NOW())'
        );
        $doc = 'GRN-' . $newLotNumber;

        $log->execute([
            $productId, $newLotId, -$pay, $cost, $doc,
            "กันไว้จ่ายของที่ขายค้างไว้ {$pay} ชิ้น", $actorId,
        ]);
        $log->execute([
            $productId, (int) $short['id'], $pay, $cost, $doc,
            "หักกลบค้างส่งด้วยของจากล็อต {$newLotNumber} {$pay} ชิ้น", $actorId,
        ]);
    }

    /** @param array<string,mixed> $req */
    /**
     * A lot number nobody had to think of: "L260829-01".
     *
     * Scoped to the product and the day it arrived, which is how a delivery is
     * actually referred to on the floor — "the ones that came in on Friday".
     * The suffix walks until it finds a free number, so two deliveries of the
     * same product on the same day stay separate lots with separate costs.
     */
    private static function issueLotNumber(int $productId, string $received): string
    {
        $stamp = 'L' . date('ymd', (int) strtotime($received));

        for ($n = 1; $n <= 99; $n++) {
            $candidate = sprintf('%s-%02d', $stamp, $n);
            $taken = Db::value(
                'SELECT id FROM stock_lots WHERE lot_number = ? AND product_id = ?',
                [$candidate, $productId],
            );
            if ($taken === null) {
                return $candidate;
            }
        }

        throw ApiError::conflict(
            'lot_exhausted',
            'สินค้านี้รับเข้าวันเดียวกันเกิน 99 ล็อตแล้ว — ใส่เลขล็อตเองสักครั้ง',
        );
    }

    private static function str(array $req, string $field, int $max): string
    {
        $v = $req[$field] ?? null;
        if (!is_string($v) || trim($v) === '') {
            throw ApiError::badRequest("ต้องระบุ {$field}", 'missing_field');
        }
        $v = trim($v);
        if (mb_strlen($v) > $max) {
            throw ApiError::badRequest("{$field} ยาวเกิน {$max} ตัวอักษร", 'field_too_long');
        }
        return $v;
    }

    /** @param array<string,mixed> $req */
    private static function optional(array $req, string $field, int $max): ?string
    {
        $v = $req[$field] ?? null;
        if ($v === null || $v === '') {
            return null;
        }
        return mb_substr(trim((string) $v), 0, $max);
    }

    /** @param array<string,mixed> $req */
    private static function qty(array $req): int
    {
        $v = $req['quantity'] ?? null;
        if (!is_int($v) && !(is_string($v) && ctype_digit($v))) {
            throw ApiError::badRequest('จำนวนต้องเป็นจำนวนเต็ม', 'bad_quantity');
        }
        $n = (int) $v;
        if ($n < 1 || $n > 999999) {
            throw ApiError::badRequest('จำนวนต้องอยู่ระหว่าง 1 ถึง 999999', 'bad_quantity');
        }
        return $n;
    }

    /** @param array<string,mixed> $req */
    private static function cost(array $req): ?string
    {
        $v = $req['cost_per_unit'] ?? null;
        if ($v === null || $v === '') {
            return null;
        }
        $s = trim((string) $v);
        if (!preg_match('/^\d{1,10}(\.\d{1,2})?$/', $s)) {
            throw ApiError::badRequest('ต้นทุนต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกินสองตำแหน่ง', 'bad_cost');
        }
        return $s;
    }

    /** @param array<string,mixed> $req */
    private static function date(array $req, string $field, bool $required): ?string
    {
        $v = $req[$field] ?? null;
        if ($v === null || $v === '') {
            if ($required) {
                throw ApiError::badRequest("ต้องระบุ {$field}", 'missing_field');
            }
            return null;
        }

        $s = trim((string) $v);
        $d = \DateTimeImmutable::createFromFormat('!Y-m-d', $s);
        if ($d === false || $d->format('Y-m-d') !== $s) {
            throw ApiError::badRequest("{$field} ต้องอยู่ในรูปแบบ YYYY-MM-DD", 'bad_date');
        }
        return $s;
    }

    /** @param array<string,mixed> $req */
    private static function supplier(array $req): ?int
    {
        $v = $req['supplier_id'] ?? null;
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_int($v) && !(is_string($v) && ctype_digit($v))) {
            throw ApiError::badRequest('supplier_id ต้องเป็นตัวเลข', 'bad_supplier');
        }
        $id = (int) $v;
        if (Db::value('SELECT id FROM suppliers WHERE id = ?', [$id]) === null) {
            throw ApiError::badRequest('ไม่พบผู้ขายรายนี้', 'unknown_supplier');
        }
        return $id;
    }
}
