<?php

declare(strict_types=1);

namespace Optic\Service;

use Optic\ApiError;
use Optic\Db;
use Optic\Optics;
use Optic\Roles;
use PDO;

/**
 * Product master data and corrections to lots.
 *
 * Two different kinds of write live here and they are deliberately not the same
 * permission: editing what a product *is* needs `editCatalog`, while anything
 * that names a price or a cost needs `enterRxCost` on top. A technician can
 * count stock; only accounting decides what it is worth.
 */
final class Catalog
{
    private const TYPES = ['Frame', 'Lens', 'Sunglass', 'ContactLen', 'Accessory'];

    /**
     * The three letters a machine-issued SKU starts with.
     *
     * They match the ones the shop already types by hand — LNS-BIF156-KD,
     * FRM-GG0396-BG — so an issued code and a written one read as the same kind
     * of thing and sort together.
     */
    private const SKU_PREFIX = [
        'Frame'      => 'FRM',
        'Lens'       => 'LNS',
        'Sunglass'   => 'SUN',
        'ContactLen' => 'CTL',
        'Accessory'  => 'ACC',
    ];

    /**
     * Made-to-order goods number in their own series, whatever type they are.
     *
     * The shop was already doing this by hand — every made-to-order lens in the
     * catalogue is RX-VRX167-L and the like, never LNS-something — because the
     * two are different kinds of thing: one sits in a drawer and is counted, the
     * other is ordered against a job and never arrives as a lot. Filing them in
     * one number series made a code stop saying which kind it was.
     */
    private const SKU_PREFIX_CUSTOM = 'RX';

    /* -------------------------------------------------------------- product */

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function createProduct(array $req, string $role): array
    {
        // เพิ่มของใหม่ ไม่ใช่แก้ของที่มีอยู่ — คนละสิทธิ์ ดูเหตุผลใน Roles::addProduct
        Roles::require(Roles::addProduct($role), 'เพิ่มสินค้า');

        $data = self::productFields($req);

        // No SKU sent means "issue one" — the type is known by now, and a code
        // nobody has to invent is a code nobody mistypes. Anything sent is still
        // honoured: a shop that prices by the supplier's own code keeps using it.
        $sku = trim((string) ($req['sku'] ?? '')) === ''
            ? self::nextSku($data['productType'], $data['isCustomMade'])
            : self::sku($req);

        if (Db::value('SELECT id FROM products WHERE sku = ?', [$sku]) !== null) {
            throw ApiError::conflict('duplicate_sku', "มีสินค้ารหัส {$sku} อยู่แล้ว", ['sku' => $sku]);
        }

        $id = Db::tx(static function (PDO $pdo) use ($sku, $data): int {
            $pdo->prepare(
                'INSERT INTO products
                   (sku, category_id, product_type, name, brand, base_selling_price,
                    min_stock, is_custom_made, attributes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $sku, $data['categoryId'], $data['productType'], $data['name'],
                $data['brand'], $data['price'], $data['minStock'],
                $data['isCustomMade'] ? 1 : 0, $data['attributes'],
            ]);
            return (int) $pdo->lastInsertId();
        });

        return ['id' => $id, 'sku' => $sku, 'name' => $data['name']];
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function updateProduct(int $id, array $req, string $role, ?int $actorId = null): array
    {
        Roles::require(Roles::editCatalog($role), 'แก้ไขสินค้า');

        $current = Db::one('SELECT * FROM products WHERE id = ?', [$id]);
        if ($current === null) {
            throw ApiError::notFound('ไม่พบสินค้า');
        }

        $sku = self::sku($req);
        $clash = Db::one('SELECT id FROM products WHERE sku = ? AND id <> ?', [$sku, $id]);
        if ($clash !== null) {
            throw ApiError::conflict('duplicate_sku', "มีสินค้ารหัส {$sku} อยู่แล้ว", ['sku' => $sku]);
        }

        $data = self::productFields($req, $current);

        // Flipping a stocked product to made-to-order would strand its lots:
        // the stock exists but nothing would ever be allowed to draw it down.
        if ($data['isCustomMade'] && !(bool) $current['is_custom_made']) {
            $lots = (int) Db::value(
                'SELECT COUNT(*) FROM stock_lots WHERE product_id = ? AND remaining_qty > 0',
                [$id],
            );
            if ($lots > 0) {
                throw ApiError::conflict(
                    'has_stock',
                    "สินค้านี้ยังมีสต็อกอยู่ {$lots} ล็อต เปลี่ยนเป็นสินค้าสั่งตัดไม่ได้",
                    ['lots' => $lots],
                );
            }
        }

        /**
         * ราคาขายที่เปลี่ยน ต้องมีบรรทัดในสมุด
         *
         * เดิมการแก้สินค้าไม่เขียน log อะไรเลย — ราคาขายจึงเปลี่ยนได้เงียบ ๆ จากหน้า
         * สินค้า หน้าสินค้ารอสั่ง หรือที่ไหนก็ได้ แล้วไม่มีทางรู้ย้อนหลังว่าใครเปลี่ยน
         * เมื่อไร จากเท่าไรเป็นเท่าไร · ราคาขายเป็นตัวเลขที่ตกลงกับลูกค้า การเปลี่ยน
         * โดยไม่มีร่องรอยคือช่องที่ตรวจสอบไม่ได้
         *
         * เขียนเฉพาะตอนตัวเลขเปลี่ยนจริง — แก้ชื่อหรือหมวดหมู่ไม่ควรได้แถวราคาแถมมา
         * รูปแบบเดียวกับ COST/PRICE ของใบสั่งตัด: จำนวนเป็นศูนย์ ไม่มีของเคลื่อน
         */
        $oldPrice = $current['base_selling_price'] ?? null;
        $priceChanged = $oldPrice === null || (float) $oldPrice !== (float) $data['price'];

        Db::tx(static function (PDO $pdo) use ($sku, $data, $id, $priceChanged, $oldPrice, $actorId): void {
            $pdo->prepare(
                'UPDATE products
                 SET sku = ?, category_id = ?, product_type = ?, name = ?, brand = ?,
                     base_selling_price = ?, min_stock = ?, is_custom_made = ?, attributes = ?
                 WHERE id = ?'
            )->execute([
                $sku, $data['categoryId'], $data['productType'], $data['name'], $data['brand'],
                $data['price'], $data['minStock'], $data['isCustomMade'] ? 1 : 0,
                $data['attributes'], $id,
            ]);

            if (!$priceChanged) {
                return;
            }

            $was = $oldPrice === null || (float) $oldPrice <= 0 ? 'ยังไม่ได้ตั้ง' : $oldPrice . ' บาท';
            $now = (float) $data['price'] <= 0 ? 'ยังไม่ได้ตั้ง' : $data['price'] . ' บาท';

            $pdo->prepare(
                'INSERT INTO inventory_logs
                   (product_id, lot_id, action_type, quantity, unit_cost, sale_price,
                    reference_doc, notes, created_by, created_by_kind, created_at)
                 VALUES (?, NULL, \'PRICE\', 0, NULL, ?, NULL, ?, ?, \'user\', NOW())'
            )->execute([
                $id,
                (float) $data['price'] > 0 ? $data['price'] : null,
                "แก้ราคาขายสินค้า {$sku} — จาก {$was} เป็น {$now}",
                $actorId,
            ]);
        });

        return ['id' => $id, 'sku' => $sku, 'name' => $data['name']];
    }

    /** @return array<string,mixed> */
    public static function deleteProduct(int $id, string $role): array
    {
        Roles::require(Roles::editCatalog($role), 'ลบสินค้า');

        $p = Db::one('SELECT id, sku, name FROM products WHERE id = ?', [$id]);
        if ($p === null) {
            throw ApiError::notFound('ไม่พบสินค้า');
        }

        // A product that has ever moved is part of the shop's history. Refusing
        // here says so plainly rather than letting the foreign key throw a
        // message nobody outside the database would understand.
        $lots = (int) Db::value('SELECT COUNT(*) FROM stock_lots WHERE product_id = ?', [$id]);
        $logs = (int) Db::value('SELECT COUNT(*) FROM inventory_logs WHERE product_id = ?', [$id]);

        if ($lots > 0 || $logs > 0) {
            throw ApiError::conflict(
                'has_history',
                "ลบไม่ได้ — สินค้านี้มีล็อต {$lots} ล็อตและประวัติ {$logs} รายการ ประวัติต้องอ่านย้อนหลังได้",
                ['lots' => $lots, 'logs' => $logs],
            );
        }

        Db::run('DELETE FROM products WHERE id = ?', [$id]);

        return ['id' => $id, 'sku' => $p['sku'], 'name' => $p['name']];
    }

    /* ------------------------------------------------------------------ lot */

    /**
     * Corrects a lot. Changing the remaining quantity writes an ADJUST movement
     * rather than editing the number quietly — a stock count that disagrees with
     * the ledger is itself a fact worth recording.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function updateLot(int $lotId, array $req, string $role, int $actorId): array
    {
        Roles::require(Roles::moveStock($role), 'แก้ไขล็อต');

        $lot = Db::one(
            'SELECT l.*, p.sku FROM stock_lots l JOIN products p ON p.id = l.product_id WHERE l.id = ?',
            [$lotId],
        );
        if ($lot === null) {
            throw ApiError::notFound('ไม่พบล็อตนี้');
        }

        $remaining = self::intOrNull($req, 'remaining_qty');
        $cost = self::costOrKeep($req, 'cost_per_unit');
        $expiry = array_key_exists('expiry_date', $req) ? self::date($req['expiry_date']) : false;
        $note = array_key_exists('note', $req) ? self::optional($req['note'], 500) : false;
        /* ผู้ขายเป็นป้ายกำกับ ไม่ใช่ตัวเลขในสมุด — แก้ได้โดยไม่ต้องลงรายการเคลื่อนไหว
           แต่ยังต้องเข้าประตูเดียวกับที่เหลือ ไม่งั้นจะมีคนเขียน stock_lots ตรง ๆ อีกที */
        $supplier = array_key_exists('supplier_id', $req) ? self::supplierOrNull($req['supplier_id']) : false;

        if ($cost !== false) {
            Roles::require(Roles::enterRxCost($role), 'แก้ต้นทุน');
        }

        $newRemaining = $remaining ?? (int) $lot['remaining_qty'];
        if ($newRemaining < 0) {
            throw ApiError::badRequest('คงเหลือติดลบไม่ได้', 'bad_quantity');
        }

        /**
         * A count can legitimately find more than the paperwork says.
         *
         * This used to be refused outright, which was wrong: goods get
         * mis-picked, returned without a slip, or over-shipped, and the shop's
         * own ledger already contains such a case. Refusing it did not make the
         * extra stock go away — it only stopped anyone recording where it went.
         *
         * It still is not waved through, because the same keystroke that records
         * a genuine surplus also types 100 where 10 was meant. So going above
         * what was received costs a sentence explaining why, and that sentence
         * lands in the ledger next to the adjustment rather than in a field
         * nobody reads.
         */
        $initial = (int) $lot['initial_qty'];
        $reason = $note === false ? null : $note;

        if ($newRemaining > $initial && ($reason === null || trim($reason) === '')) {
            throw ApiError::badRequest(
                "คงเหลือ ({$newRemaining}) มากกว่าจำนวนที่รับเข้า ({$initial}) — "
                . 'ถ้าตรวจนับแล้วเจอของเกินจริง ให้กรอกเหตุผลกำกับไว้ด้วย',
                'over_initial_needs_note',
            );
        }

        $delta = $newRemaining - (int) $lot['remaining_qty'];

        Db::tx(static function (PDO $pdo) use ($lotId, $lot, $newRemaining, $cost, $expiry, $note, $supplier, $delta, $actorId, $initial, $reason): void {
            $sets = ['remaining_qty = ?'];
            $args = [$newRemaining];

            if ($cost !== false) {
                $sets[] = 'cost_per_unit = ?';
                $args[] = $cost;
            }
            if ($expiry !== false) {
                $sets[] = 'expiry_date = ?';
                $args[] = $expiry;
            }
            if ($note !== false) {
                $sets[] = 'notes = ?';
                $args[] = $note;
            }
            if ($supplier !== false) {
                $sets[] = 'supplier_id = ?';
                $args[] = $supplier;
            }
            $args[] = $lotId;

            $pdo->prepare('UPDATE stock_lots SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($args);

            /* ต้นทุนที่เพิ่งรู้ ไล่ไปเติมทุกที่ที่รอมันอยู่ — สมุดคลัง ใบเบิก
               สาขา และสำเนาต้นทุนฝั่งขาย · เหตุผลเต็มอยู่ที่ Costing */
            if ($cost !== false && $cost !== null) {
                Costing::fill($pdo, $lotId, (string) $cost);
            }

            if ($delta !== 0) {
                $pdo->prepare(
                    'INSERT INTO inventory_logs
                       (product_id, lot_id, action_type, quantity, unit_cost,
                        reference_doc, notes, created_by, created_by_kind, created_at)
                     VALUES (?, ?, \'ADJUST\', ?, ?, ?, ?, ?, \'user\', NOW())'
                )->execute([
                    $lot['product_id'], $lotId, $delta,
                    $cost !== false ? $cost : $lot['cost_per_unit'],
                    'ADJ-' . $lot['lot_number'],
                    // The ledger has to explain the number afterwards. A surplus
                    // above what was received carries its reason here, where
                    // anyone reading the movement will see it.
                    $newRemaining > $initial
                        ? sprintf(
                            'แก้คงเหลือจาก %d เป็น %d (มากกว่าที่รับเข้า %d) — %s',
                            (int) $lot['remaining_qty'],
                            $newRemaining,
                            $initial,
                            trim((string) $reason),
                        )
                        : sprintf('แก้คงเหลือจาก %d เป็น %d', (int) $lot['remaining_qty'], $newRemaining),
                    $actorId,
                ]);
            }
        });

        return [
            'id'        => $lotId,
            'lotNumber' => $lot['lot_number'],
            'remaining' => $newRemaining,
            'adjusted'  => $delta,
        ];
    }

    /**
     * Removes a lot entered by mistake.
     *
     * Only a lot nothing has been drawn from can go: once stock has moved, the
     * lot is the only record of what that stock cost, and deleting it would
     * leave sales that can never be costed. Correcting an untouched entry is a
     * different thing from erasing history, and only the first is allowed.
     *
     * @return array<string,mixed>
     */
    public static function deleteLot(int $lotId, string $role): array
    {
        Roles::require(Roles::editCatalog($role), 'ลบล็อต');

        $lot = Db::one('SELECT * FROM stock_lots WHERE id = ?', [$lotId]);
        if ($lot === null) {
            throw ApiError::notFound('ไม่พบล็อตนี้');
        }

        $moves = (int) Db::value(
            "SELECT COUNT(*) FROM inventory_logs WHERE lot_id = ? AND action_type <> 'IN'",
            [$lotId],
        );
        if ($moves > 0 || (int) $lot['remaining_qty'] !== (int) $lot['initial_qty']) {
            throw ApiError::conflict(
                'lot_in_use',
                "ล็อตนี้มีการเคลื่อนไหวไปแล้ว {$moves} รายการ ลบไม่ได้ — ถ้าของหายให้ปรับยอดแทน",
                ['movements' => $moves],
            );
        }

        Db::tx(static function (PDO $pdo) use ($lotId): void {
            // The goods-received line goes with it; keeping an IN for a lot that
            // no longer exists would leave the ledger unbalanceable.
            $pdo->prepare('DELETE FROM inventory_logs WHERE lot_id = ?')->execute([$lotId]);
            $pdo->prepare('DELETE FROM stock_lots WHERE id = ?')->execute([$lotId]);
        });

        return ['id' => $lotId, 'lotNumber' => $lot['lot_number']];
    }

    /** null clears the supplier; anything else has to be a supplier that exists. */
    private static function supplierOrNull(mixed $v): ?int
    {
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_numeric($v)) {
            throw ApiError::badRequest('supplier_id ต้องเป็นตัวเลข', 'bad_supplier');
        }
        $id = (int) $v;
        if (Db::value('SELECT id FROM suppliers WHERE id = ?', [$id]) === null) {
            throw ApiError::badRequest('ไม่พบผู้ขายรายนี้', 'unknown_supplier');
        }
        return $id;
    }

    /** Whether a string is one of the five product types this system knows. */
    public static function isType(string $type): bool
    {
        return in_array($type, self::TYPES, true);
    }

    /**
     * The next SKU going spare for a product type: "LNS-0007".
     *
     * Only the codes already in that numbered form hold the counter — the
     * descriptive ones somebody typed (ACC-CASEHD) are not numbers and are
     * skipped, so hand-written and issued codes can share a prefix without
     * either blocking the other.
     */
    public static function nextSku(string $type, bool $custom = false): string
    {
        if (!self::isType($type)) {
            throw ApiError::badRequest('ชนิดสินค้าต้องเป็นหนึ่งใน ' . implode(', ', self::TYPES), 'bad_type');
        }

        $prefix = $custom ? self::SKU_PREFIX_CUSTOM : self::SKU_PREFIX[$type];
        $highest = (int) Db::value(
            'SELECT MAX(CAST(SUBSTRING(sku, ?) AS UNSIGNED)) FROM products WHERE sku REGEXP ?',
            [strlen($prefix) + 2, '^' . $prefix . '-[0-9]+$']
        );

        return sprintf('%s-%04d', $prefix, $highest + 1);
    }

    /* -------------------------------------------------------------- helpers */

    /** @param array<string,mixed> $req */
    private static function sku(array $req): string
    {
        $v = trim((string) ($req['sku'] ?? ''));
        if ($v === '') {
            throw ApiError::badRequest('ต้องระบุ SKU', 'missing_field');
        }
        if (!preg_match('/^[A-Za-z0-9._\-]{2,100}$/', $v)) {
            throw ApiError::badRequest('SKU ใช้ได้เฉพาะ A–Z 0–9 . - _ และยาว 2–100 ตัว', 'bad_sku');
        }
        return $v;
    }

    /**
     * @param array<string,mixed> $req
     * @param array<string,mixed>|null $current The stored row, on an update — what
     *        a field the caller left out falls back to. Null when creating.
     * @return array{categoryId:int,productType:string,name:string,brand:?string,price:string,isCustomMade:bool,minStock:int,attributes:string}
     */
    private static function productFields(array $req, ?array $current = null): array
    {
        $type = (string) ($req['product_type'] ?? '');
        if (!in_array($type, self::TYPES, true)) {
            throw ApiError::badRequest('ชนิดสินค้าต้องเป็นหนึ่งใน ' . implode(', ', self::TYPES), 'bad_type');
        }

        $categoryId = (int) ($req['category_id'] ?? 0);
        if (Db::value('SELECT id FROM categories WHERE id = ?', [$categoryId]) === null) {
            throw ApiError::badRequest('ไม่พบหมวดหมู่นี้', 'unknown_category');
        }

        /**
         * A blank price is a product that has not been priced yet.
         *
         * Stock arrives before the price list does — a rep leaves a new frame,
         * the shop counts it in and works out what to charge later. Refusing to
         * record the frame until someone has invented a number is how a box
         * ends up on a shelf that the system does not know about, which is the
         * one thing the stock module exists to prevent.
         *
         * Stored as 0.00 because the column is NOT NULL, and read back as "not
         * priced" everywhere it is shown. That leaves a genuinely free giveaway
         * indistinguishable from an unpriced one — which is the cheaper of the
         * two mistakes, and the one the shop can correct in a click.
         */
        $price = trim((string) ($req['base_selling_price'] ?? ''));
        if ($price === '') {
            $price = '0.00';
        } elseif (!preg_match('/^\d{1,10}(\.\d{1,2})?$/', $price)) {
            throw ApiError::badRequest('ราคาขายต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกินสองตำแหน่ง', 'bad_price');
        }

        $attributes = $req['attributes'] ?? null;
        if ($attributes !== null && !is_array($attributes)) {
            throw ApiError::badRequest('attributes ต้องเป็นอ็อบเจกต์', 'bad_attributes');
        }

        /**
         * The powers are checked, even though the rest of `attributes` is open.
         *
         * A stock lens is stocked *by power* — a drawer of -2.00 is a different
         * SKU from a drawer of -2.25 — so the power is half of what the product
         * is, and it is composed straight into the product's name. A typo there
         * does not sit in a spare column: it makes a lens the shop does not
         * sell, under a name that reads like one it does.
         *
         * Only these four. A coating nobody has heard of is still enterable the
         * day the rep brings it in, which is the whole reason `attributes` is
         * open in the first place.
         */
        if (is_array($attributes)) {
            foreach (['sph' => 'SPH', 'cyl' => 'CYL', 'add' => 'ADD'] as $key => $label) {
                if (array_key_exists($key, $attributes)) {
                    Optics::power($attributes[$key], $key, $label);
                }
            }
            if (array_key_exists('axis', $attributes)) {
                Optics::axis($attributes['axis']);
            }
        }

        /**
         * A caller that never mentioned `attributes` keeps what is stored.
         *
         * Not a convenience: the price is corrected straight from the product
         * list, and that write sends the six fields the row has to hand and no
         * spec at all. Rebuilding the column from what arrived would answer
         * "what is this lens" with `{}` — every power, index and coating gone,
         * because someone fixed a price by fifty baht.
         *
         * An explicit `attributes: null` still clears it. That is a caller
         * saying the product has no spec, which is a different sentence from
         * not raising the subject.
         */
        $attrJson = !array_key_exists('attributes', $req) && $current !== null
            ? (string) $current['attributes']
            // MariaDB 10.4 stores this as LONGTEXT, so it is written as a JSON
            // string and read back with JSON_UNQUOTE(JSON_EXTRACT(...)).
            : json_encode($attributes ?? new \stdClass(), JSON_UNESCAPED_UNICODE);

        $brand = self::optional($req['brand'] ?? null, 120);
        $custom = (bool) ($req['is_custom_made'] ?? false);

        /**
         * A name that was typed wins; an empty one is composed from the spec.
         *
         * Not "compose always": the shop keeps the right to call a thing what
         * its supplier calls it, and a composed name that could not be
         * overridden would be a rule the first odd product broke. The form
         * fills the box from this same function as the spec is filled in, so
         * leaving it alone and typing over it are the same gesture.
         *
         * On an update the composition reads the attributes *being written*,
         * not the ones stored — changing a lens's index and clearing the name
         * must give the new index's name, not the old one's.
         */
        $name = trim((string) ($req['name'] ?? ''));
        if ($name === '') {
            $forName = is_array($attributes) ? $attributes : (
                $current === null
                    ? []
                    : (is_array($d = json_decode((string) $current['attributes'], true)) ? $d : [])
            );
            $name = self::composeName($type, $brand, $forName, $custom);
        }
        if ($name === '' || mb_strlen($name) > 255) {
            throw ApiError::badRequest(
                'ชื่อสินค้าต้องมี และยาวไม่เกิน 255 ตัวอักษร — เว้นว่างได้ถ้ากรอกแบรนด์ รุ่น และสเปกไว้แล้ว',
                'bad_name',
            );
        }

        return [
            'categoryId'   => $categoryId,
            'productType'  => $type,
            'name'         => $name,
            'brand'        => $brand,
            'price'        => $price,
            'isCustomMade' => $custom,
            'minStock'     => self::minStock($req, $current),
            'attributes'   => $attrJson,
        ];
    }

    /**
     * The name a product gets when nobody types one.
     *
     * A shop stocks one lens model in a dozen powers, three indexes and half a
     * dozen coatings, and every one of those is a different thing on a
     * different shelf with its own cost. Left to be typed, they came out as
     * three spellings of the same model and two products that read identically
     * on screen — which is how stock ends up split across rows nobody can tell
     * apart. Composed from the spec, two products can only share a name if they
     * really are the same product.
     *
     * Values, not labels: "Hoya HiVision Crizal 1.60 -2.25 -0.75", never
     * "… SPH -2.25 CYL -0.75". The name sits in tables, on order lines and in
     * the shop-floor system beside its own columns, and a name that repeats the
     * word SPH in every row is a name that costs width to say nothing.
     *
     * ASCII "-" rather than the true minus the screens draw powers with. This
     * string is stored, searched and typed at; a U+2212 in the column is a row
     * nobody can find by typing "-2.25".
     *
     * Empty parts fall out entirely rather than leaving a gap or a dash. A lens
     * whose coating was never recorded is not a lens with a blank coating.
     *
     * @param array<string,mixed> $attrs `products.attributes`, decoded
     */
    public static function composeName(
        string $type,
        ?string $brand,
        array $attrs,
        bool $isCustomMade = false,
    ): string {
        $text = static function (mixed $v): ?string {
            if ($v === null || is_array($v) || is_bool($v)) {
                return null;
            }
            $s = trim((string) $v);
            return $s === '' || $s === 'null' ? null : $s;
        };

        /** A power as it is written on a job sheet: always signed, two places. */
        $power = static function (mixed $v) use ($text): ?string {
            $s = $text($v);
            if ($s === null || !is_numeric($s)) {
                return $s;
            }
            $n = (float) $s;
            // Zero takes no sign — "+0.00" and "-0.00" are the same plano lens
            // and a sign on it only invites the question of which one is right.
            return ($n > 0 ? '+' : ($n < 0 ? '-' : '')) . number_format(abs($n), 2, '.', '');
        };

        $at = static fn(string $key): ?string => $text($attrs[$key] ?? null);

        // Every type starts the same way: who makes it, and which of theirs it
        // is. What follows is whatever tells two of that model apart.
        $parts = [$text($brand), $at('model')];

        switch ($type) {
            case 'Lens':
                // "Hoya HiVision MultiCoat (1.60) -2.25/-0.50 Add +2.00" — the
                // shop's own shorthand, punctuation and all. The brackets keep
                // the index from reading as another power, the slash pairs the
                // two powers the way a job sheet writes them, and ADD is the
                // one figure that is labelled because it is the one that is
                // optional: a bare "+2.00" at the end of a name says nothing.
                //
                // The coating sits with the model rather than with the figures
                // because that is what it is — part of which lens this is, not
                // a measurement of it. Without it two lenses that agree on
                // everything but their coating are two rows reading alike, and
                // telling those apart is the whole job of a composed name.
                $parts[] = $at('coating');

                /* ชนิดเลนส์อยู่ในชื่อด้วย ไม่ใช่แค่ในสเปก — Single กับ Progressive
                   ของรุ่นเดียวกัน index เดียวกัน coating เดียวกัน คือของคนละตัว
                   ราคาต่างกันหลายเท่า · ถ้าชื่อไม่ต่าง ใบสั่ง Progressive จะไปเจอ
                   รุ่น Single ที่ชื่อตรงกันแล้วใช้ตัวนั้นแทน แล้วสเปกบนใบจะผิดโดย
                   ไม่มีใครเห็น — ดู `Rx::modelByName` ซึ่งจับคู่รุ่นด้วยชื่อ */
                $parts[] = $at('lens_design');

                $index = $at('lens_index');
                if ($index !== null) {
                    $parts[] = "({$index})";
                }

                $pair = array_values(array_filter(
                    [$power($attrs['sph'] ?? null), $power($attrs['cyl'] ?? null)],
                    static fn(?string $v): bool => $v !== null && $v !== '',
                ));
                if ($pair !== []) {
                    $parts[] = implode('/', $pair);
                }

                // ADD belongs to a Progressive or a Bifocal, and it is the only
                // thing separating two of them that agree on everything else.
                // Appended whenever the product carries one rather than only on
                // made-to-order lenses: a stocked bifocal has an ADD too, and
                // leaving it out would give two of them the same name.
                $add = $at('add');
                if ($add !== null) {
                    $parts[] = "Add {$add}";
                }
                break;

            case 'Frame':
                $parts[] = $at('color');
                $parts[] = $at('size');
                break;

            case 'Sunglass':
                $parts[] = $at('color');
                $parts[] = $at('tint');
                $parts[] = $at('size');
                break;

            case 'ContactLen':
                $parts[] = $at('bc');
                $parts[] = $at('dia');
                $parts[] = $at('pack');
                break;

            case 'Accessory':
                $parts[] = $at('volume');
                $parts[] = $at('color');
                $parts[] = $at('size');
                break;
        }

        // `is_custom_made` earns no word of its own. It is already visible as a
        // tag on every screen that lists the product, and a name ending in "RX"
        // would sort a shop's made-to-order lenses apart from the stocked ones
        // that are otherwise identical.
        unset($isCustomMade);

        $name = trim(implode(' ', array_filter(
            $parts,
            static fn(?string $p): bool => $p !== null && $p !== '',
        )));

        // The column is VARCHAR(255). A name that long is a spec sheet rather
        // than a name, but truncating beats a write that fails at the database.
        return mb_substr($name, 0, 255);
    }

    /**
     * How few of something the shop is willing to be down to.
     *
     * Zero is the default and means "never mention this one" rather than "the
     * minimum is zero": a shop stocks a few dozen things and cares about a
     * handful of them, so silence has to be what you get for saying nothing.
     *
     * Left out of the request entirely, an update keeps the stored figure — the
     * same rule `attributes` follows above, and for the same reason: the inline
     * price edit does not carry it either.
     *
     * @param array<string,mixed> $req
     * @param array<string,mixed>|null $current
     */
    private static function minStock(array $req, ?array $current): int
    {
        if (!array_key_exists('min_stock', $req)) {
            return $current === null ? 0 : (int) $current['min_stock'];
        }

        $v = $req['min_stock'];
        if ($v === null || $v === '') {
            return 0;
        }
        if (!is_int($v) && !(is_string($v) && ctype_digit($v))) {
            throw ApiError::badRequest('จำนวนขั้นต่ำต้องเป็นจำนวนเต็มไม่ติดลบ', 'bad_min_stock');
        }
        $n = (int) $v;
        // A four-digit minimum on a shop that stocks two of everything is a
        // typo, and a typo here shouts at its owner on every screen until it is
        // found. The cap is generous enough that a real answer never meets it.
        if ($n > 99999) {
            throw ApiError::badRequest('จำนวนขั้นต่ำสูงเกินไป', 'bad_min_stock');
        }
        return $n;
    }

    private static function optional(mixed $v, int $max): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        $s = trim((string) $v);
        return $s === '' ? null : mb_substr($s, 0, $max);
    }

    /** @param array<string,mixed> $req */
    private static function intOrNull(array $req, string $field): ?int
    {
        $v = $req[$field] ?? null;
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_int($v) && !(is_string($v) && ctype_digit($v))) {
            throw ApiError::badRequest("{$field} ต้องเป็นจำนวนเต็ม", 'bad_quantity');
        }
        return (int) $v;
    }

    /**
     * Returns false when the caller did not mention the field at all, so an
     * absent key and an explicit null stay distinguishable.
     *
     * @param array<string,mixed> $req
     */
    private static function costOrKeep(array $req, string $field): string|null|false
    {
        if (!array_key_exists($field, $req)) {
            return false;
        }
        $v = $req[$field];
        if ($v === null || $v === '') {
            return null;
        }
        $s = trim((string) $v);
        if (!preg_match('/^\d{1,10}(\.\d{1,2})?$/', $s)) {
            throw ApiError::badRequest('ต้นทุนต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกินสองตำแหน่ง', 'bad_cost');
        }
        return $s;
    }

    private static function date(mixed $v): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        $s = trim((string) $v);
        $d = \DateTimeImmutable::createFromFormat('!Y-m-d', $s);
        if ($d === false || $d->format('Y-m-d') !== $s) {
            throw ApiError::badRequest('วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD', 'bad_date');
        }
        return $s;
    }
}
