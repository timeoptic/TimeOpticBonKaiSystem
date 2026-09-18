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
    public static function receive(array $req, array $roles, int $actorId, bool $allowExpired = false): array
    {
        Roles::require(Roles::moveStock($roles), 'รับของเข้าคลัง');

        $sku = self::str($req, 'sku', 100);
        $qty = self::qty($req);
        $cost = self::cost($req);
        $received = self::date($req, 'received_date', required: true);
        $expiry = self::date($req, 'expiry_date', required: false);
        $note = self::optional($req, 'note', 500);
        $supplierId = self::supplier($req);

        // A cost is money, and money is a narrower permission than moving stock.
        if ($cost !== null) {
            Roles::require(Roles::enterRxCost($roles), 'กรอกต้นทุน');
        }

        /* ดึง base_selling_price มาด้วย เพื่อบันทึก "ราคาขาย ณ ตอนรับเข้า" ลงสมุด
           — เพิ่มเลนส์ใหม่จากหน้าขายแล้วเปิดหน้าความเคลื่อนไหวดู เดิมเห็นแต่ของเข้า
           ไม่เห็นว่าตั้งขายเท่าไร ทั้งที่คนขายเพิ่งพิมพ์ตัวเลขนั้นไปเมื่อกี้ */
        $p = Db::one('SELECT id, sku, name, is_custom_made, base_selling_price FROM products WHERE sku = ?', [$sku]);
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

        /* $allowExpired มาจากสคริปต์นำเข้ายอดนับ (bin/import-contactlens.php) เท่านั้น ไม่มีเส้น API
           ไหนส่ง — ของหมดอายุที่ยังวางอยู่บนชั้นวันนับต้องเข้าระบบพร้อมวันจริง จะได้ขึ้นเตือน
           แล้วตัดเป็นของเสีย ไม่ใช่หายไปจากยอดเงียบ ๆ */
        if ($expiry !== null && $expiry < $received && !$allowExpired) {
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

        /* 0.00 ในคอลัมน์แปลว่า "ยังไม่ได้ตั้งราคา" ไม่ใช่ "ขายฟรี" — เก็บ NULL
           ลงสมุดแทน ไม่งั้นแถวจะอ่านว่าตั้งขายศูนย์บาทซึ่งไม่จริง */
        $salePrice = ($p['base_selling_price'] ?? null) !== null && (float) $p['base_selling_price'] > 0
            ? (string) $p['base_selling_price']
            : null;

        $lotId = Db::tx(static function (PDO $pdo) use ($p, $lotNumber, $supplierId, $cost, $salePrice, $qty, $received, $expiry, $note, $actorId): int {
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
                   (product_id, lot_id, action_type, quantity, unit_cost, sale_price,
                    reference_doc, notes, created_by, created_by_kind, created_at)
                 VALUES (?, ?, \'IN\', ?, ?, ?, ?, ?, ?, \'user\', NOW())'
            )->execute([
                $p['id'], $id, $qty, $cost, $salePrice, 'GRN-' . $lotNumber,
                "รับเข้าคลัง {$lotNumber}", $actorId,
            ]);

            /* ของเข้าก็ต้องจด ไม่ใช่เฉพาะของออก — นี่คือจังหวะที่ธง "เตือนไปแล้ว"
               ถูกล้าง ถ้าไม่ล้าง รอบหน้าที่ของตกลงมาอีกจะเงียบตลอดไป */
            LowStock::watch((int) $p['id']);

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

    /* ---------------------------------------------------------- แก้การรับเข้า */

    /**
     * รายการรับเข้าหนึ่งแถว พร้อมรายละเอียดของล็อตที่มันเปิด — สำหรับกล่องแก้การรับเข้า
     *
     * @return array<string,mixed>
     */
    public static function receipt(int $logId, bool $money): array
    {
        $r = self::receiptRow($logId);

        return [
            'id'           => (int) $r['id'],
            'lotId'        => (int) $r['lot_id'],
            'lotNumber'    => $r['lot_number'],
            'sku'          => $r['sku'],
            'name'         => $r['name'],
            'quantity'     => (int) $r['initial_qty'],
            'remaining'    => (int) $r['remaining_qty'],
            // ของที่ออกจากล็อตไปแล้ว — จำนวนรับเข้าแก้ให้ต่ำกว่านี้ไม่ได้
            'used'         => max(0, (int) $r['initial_qty'] - (int) $r['remaining_qty']),
            'receivedDate' => $r['received_date'],
            'expiryDate'   => $r['expiry_date'],
            'supplierId'   => $r['supplier_id'] === null ? null : (int) $r['supplier_id'],
            'costPerUnit'  => $money && $r['cost_per_unit'] !== null ? (float) $r['cost_per_unit'] : null,
            'note'         => $r['lot_notes'],
        ];
    }

    /**
     * แก้การรับเข้าที่คีย์ผิด — ร้านขอ 18 ก.ย. 2026 ("มีแก้การเบิกแล้ว อยากได้แก้การรับเข้าด้วย")
     *
     * แก้ได้: จำนวนที่รับ · วันที่รับ · ผู้ขาย · วันหมดอายุ · ต้นทุน/ชิ้น · หมายเหตุของล็อต
     *
     * จำนวนแก้ที่ตัวรายการรับเข้าเอง ไม่ใช่ลงแถวปรับยอด — ที่ผิดคือตัวเลขตอนรับ ไม่ใช่ของหาย ·
     * แถว IN กับยอดล็อตขยับเท่ากันในทรานแซกชันเดียว ยอดล็อตจึงยังเท่ากับผลรวมในสมุดเสมอ ·
     * แก้ให้ต่ำกว่าของที่ออกจากล็อตไปแล้วไม่ได้ (ของที่ขายไปแล้วต้องมีที่มา)
     *
     * แก้จำนวนหรือวันที่ต้องมีเหตุผล · ต่อท้ายหมายเหตุของแถวรับเข้าว่าแก้อะไรจากเท่าไร โดยใคร
     * คนที่อ่านหน้าความเคลื่อนไหวทีหลังจึงเห็นว่าตัวเลขนี้ถูกแก้ ไม่ใช่เห็นตัวเลขใหม่เฉย ๆ
     *
     * ที่เหลือ (ผู้ขาย วันหมดอายุ ต้นทุน หมายเหตุ) ส่งต่อให้ Catalog::updateLot ตัวเดิม —
     * สิทธิ์ต้นทุน (cost.edit) และการเติมต้นทุนย้อนหลังไปทุกที่ (Costing::fill) อยู่ที่นั่นแล้ว
     *
     * สิทธิ์ชุดเดียวกับแก้การเบิกของร้าน (ShopIssue::edit) — แก้ย้อนหลังเป็นงานของเจ้าของร้าน
     *
     * @param array<string,mixed> $body
     * @param list<string> $roles
     * @return array<string,mixed>
     */
    public static function editReceipt(int $logId, array $body, array $roles, int $actorId): array
    {
        Roles::require(Roles::settleBranch($roles), 'แก้การรับเข้า');

        $r = self::receiptRow($logId);
        $initial = (int) $r['initial_qty'];
        $used = max(0, $initial - (int) $r['remaining_qty']);

        $qty = array_key_exists('quantity', $body) ? self::qty($body) : $initial;
        $received = array_key_exists('received_date', $body)
            ? self::date($body, 'received_date', required: true)
            : $r['received_date'];
        $reason = trim((string) ($body['reason'] ?? ''));

        $changes = [];
        if ($qty !== $initial) {
            if ($qty < $used) {
                throw ApiError::conflict(
                    'below_used',
                    "ล็อตนี้ออกไปแล้ว {$used} ชิ้น แก้จำนวนรับเข้าให้น้อยกว่านั้นไม่ได้ — ต้องยกเลิกการเบิกก่อน",
                    ['used' => $used],
                );
            }
            $changes[] = "จำนวน {$initial} → {$qty}";
        }
        if ($received !== $r['received_date']) {
            $changes[] = "วันที่รับ {$r['received_date']} → {$received}";
        }
        if ($changes !== [] && $reason === '') {
            throw ApiError::badRequest('แก้จำนวนหรือวันที่รับต้องบอกเหตุผลด้วย', 'reason_required');
        }
        if (mb_strlen($reason) > 300) {
            throw ApiError::badRequest('เหตุผลยาวเกิน 300 ตัวอักษร', 'field_too_long');
        }

        if ($changes !== []) {
            $who = (string) (Db::value('SELECT display_name FROM admins WHERE id = ?', [$actorId]) ?? '');
            $trail = sprintf(
                ' · แก้การรับเข้า %s: %s — %s%s',
                date('Y-m-d H:i'),
                implode(', ', $changes),
                $reason,
                $who !== '' ? " ({$who})" : '',
            );
            $delta = $qty - $initial;

            Db::tx(static function (PDO $pdo) use ($r, $qty, $received, $delta, $trail): void {
                $pdo->prepare(
                    'UPDATE stock_lots SET initial_qty = ?, remaining_qty = remaining_qty + ?, received_date = ? WHERE id = ?'
                )->execute([$qty, $delta, $received, $r['lot_id']]);
                $pdo->prepare(
                    'UPDATE inventory_logs SET quantity = ?, notes = CONCAT(COALESCE(notes, \'\'), ?) WHERE id = ?'
                )->execute([$qty, $trail, $r['id']]);
            });
        }

        // ที่เหลือส่งต่อ — ยอดคงเหลือส่งค่าปัจจุบันไป updateLot จึงไม่ลงแถวปรับยอดซ้ำ
        $rest = [];
        foreach (['supplier_id', 'expiry_date', 'cost_per_unit', 'note'] as $k) {
            if (array_key_exists($k, $body)) {
                $rest[$k] = $body[$k];
            }
        }
        if ($rest !== []) {
            $rest['remaining_qty'] = (int) Db::value('SELECT remaining_qty FROM stock_lots WHERE id = ?', [$r['lot_id']]);
            Catalog::updateLot((int) $r['lot_id'], $rest, $roles, $actorId);
        }

        return self::receipt($logId, Roles::seeCost($roles));
    }

    /** @return array<string,mixed> */
    private static function receiptRow(int $logId): array
    {
        $r = Db::one(
            "SELECT g.id, g.lot_id, g.quantity, l.lot_number, l.initial_qty, l.remaining_qty,
                    l.received_date, l.expiry_date, l.supplier_id, l.cost_per_unit, l.notes AS lot_notes,
                    p.sku, p.name
               FROM inventory_logs g
               JOIN stock_lots l ON l.id = g.lot_id
               JOIN products p ON p.id = g.product_id
              WHERE g.id = ? AND g.action_type = 'IN'",
            [$logId],
        );
        if ($r === null) {
            throw ApiError::notFound('ไม่พบรายการรับเข้านี้');
        }
        return $r;
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

        /**
         * ของที่ขายไปก่อนของมาถึง เพิ่งรู้ต้นทุนเดี๋ยวนี้
         *
         * ล็อตค้างส่งเกิดตอนขายของที่ยังไม่มี มันจึงไม่เคยมีต้นทุน และแถวขาออก
         * ที่ตัดจากมันถูกประทับว่าไม่รู้ต้นทุนไว้ · ของกล่องนี้คือของที่ไปจ่าย
         * หนี้ก้อนนั้นจริง ๆ ต้นทุนของมันจึงเป็นต้นทุนของการขายครั้งนั้น
         *
         * เดิมสองแถวข้างบนถือต้นทุนไว้เฉย ๆ ส่วนตัวล็อตค้างส่งกับการขายที่ค้าง
         * อยู่ไม่เคยได้ไป — และกรอกต้นทุนจากหน้าไหนก็ไม่ช่วย เพราะหน้าพวกนั้น
         * กรอกให้ล็อตใหม่ ไม่ใช่ล็อตค้างส่ง การขายนั้นจึงไม่รู้ต้นทุนไปตลอด
         *
         * เติมเฉพาะตอนล็อตค้างส่งยังไม่มีต้นทุน · ถ้ามีแล้วแปลว่ามีคนกรอกไว้
         * ก่อนหน้านี้ และของกล่องนี้ไม่ใช่คนที่จะมาเขียนทับ
         */
        if ($cost !== null) {
            $pdo->prepare(
                'UPDATE stock_lots SET cost_per_unit = ? WHERE id = ? AND cost_per_unit IS NULL'
            )->execute([$cost, (int) $short['id']]);

            Costing::fill($pdo, (int) $short['id'], (string) $cost);
        }
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
    /**
     * จำนวนที่รับเข้า — 0 ได้ แปลว่า "ลงชื่อไว้ก่อน ของยังไม่มา"
     *
     * คนขายเจอเลนส์รุ่นที่ร้านยังไม่เคยลงระบบ ลูกค้ายืนอยู่ตรงหน้า ของจะมา
     * สัปดาห์หน้า · เดิมต้องใส่อย่างน้อย 1 ซึ่งเป็นการโกหกว่ามีของอยู่บนชั้น
     * ลงเป็น 0 แล้วขายต่อได้เลย ยอดจะติดลบเป็นค้างส่ง ซึ่งตรงกับความจริง
     */
    private static function qty(array $req): int
    {
        $v = $req['quantity'] ?? null;
        if (!is_int($v) && !(is_string($v) && ctype_digit($v))) {
            throw ApiError::badRequest('จำนวนต้องเป็นจำนวนเต็ม', 'bad_quantity');
        }
        $n = (int) $v;
        if ($n < 0 || $n > 999999) {
            throw ApiError::badRequest('จำนวนต้องอยู่ระหว่าง 0 ถึง 999999', 'bad_quantity');
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
