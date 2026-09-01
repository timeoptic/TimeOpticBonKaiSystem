<?php

declare(strict_types=1);

namespace Optic\Service;

use Optic\ApiError;
use Optic\Db;
use Optic\Roles;
use PDO;

/**
 * Lenses ordered from a supplier instead of taken from stock.
 *
 * Two situations lead here, and they look the same to the shop:
 *
 *  - The product is made to order — a prescription lens that never exists as
 *    stock, so there is nothing to cut and never will be.
 *  - The product is normally stocked but has run out, and the customer is not
 *    waiting for the next delivery. The shop orders that one specially.
 *
 * Either way no lot is involved, so `lot_id` stays null and the quantity is -1:
 * one lens left the shop's obligations, none left its shelves.
 */
final class Rx
{
    /**
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function order(array $req, string $role, int $actorId): array
    {
        // Either the model is already in the catalogue, or its name is enough
        // to put it there. Making someone leave a half-written order to go and
        // create a product first is two jobs where the shop only has one.
        $sku = trim((string) ($req['sku'] ?? '')) === ''
            ? self::modelByName($req, $role)
            : self::str($req, 'sku', 100);

        // No number sent means "issue one". The shop's own numbering is still
        // honoured when it sends one — a job sheet that already carries a number
        // should be filed under that number, not under a second one.
        $doc = trim((string) ($req['reference_doc'] ?? '')) === ''
            ? self::nextDoc()
            : self::str($req, 'reference_doc', 100);
        $note = self::optional($req, 'note', 500);
        $cost = self::cost($req);
        $spec = self::spec($req);

        /**
         * Two prices on one sheet, and they are not the same permission.
         *
         * What the shop pays the supplier is accounting: it is the figure the
         * margin is worked out from, and it stays behind `enterRxCost` with
         * every other buying price in this system.
         *
         * What the customer pays is not. It is quoted at the counter by whoever
         * is standing with the customer — the optometrist writing the order —
         * and a system that makes them fetch someone with a wider account to
         * type a number they have just said out loud is a system that gets a
         * blank left in the field instead.
         */
        if ($cost !== null) {
            Roles::require(Roles::enterRxCost($role), 'กรอกต้นทุนจากผู้ขาย');
        }

        $p = Db::one('SELECT id, sku, name, is_custom_made FROM products WHERE sku = ?', [$sku]);
        if ($p === null) {
            throw ApiError::unknownSku($sku);
        }

        if (!(bool) $p['is_custom_made']) {
            // A stocked product may only be special-ordered once it has actually
            // run out. Allowing it while stock remains would quietly bypass FIFO
            // and leave the shop paying twice for something it already owns.
            $onHand = (int) Db::value(
                'SELECT COALESCE(SUM(remaining_qty), 0) FROM stock_lots WHERE product_id = ?',
                [$p['id']],
            );
            if ($onHand > 0) {
                throw ApiError::conflict(
                    'still_in_stock',
                    "สินค้านี้ยังมีสต็อกอยู่ {$onHand} ชิ้น ให้ตัดตามล็อต FIFO ก่อน — เปิดใบสั่งพิเศษได้เมื่อของหมด",
                    ['sku' => $sku, 'available' => $onHand],
                );
            }
        }

        $id = Db::tx(static function (PDO $pdo) use ($p, $doc, $note, $cost, $spec, $actorId): int {
            $pdo->prepare(
                'INSERT INTO inventory_logs
                   (product_id, lot_id, action_type, quantity, unit_cost,
                    reference_doc, notes, created_by, created_by_kind, created_at)
                 VALUES (?, NULL, \'RX_ORDER\', -1, ?, ?, ?, ?, \'user\', NOW())'
            )->execute([$p['id'], $cost, $doc, $note, $actorId]);

            $logId = (int) $pdo->lastInsertId();

            // The prescription belongs to this job, not to the lens model it was
            // cut from — see the note on the migration that made this table.
            $pdo->prepare(
                'INSERT INTO rx_orders (log_id, eye_side, sph, cyl, axis, add_power, sale_price)
                 VALUES (?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $logId, $spec['eye_side'], $spec['sph'], $spec['cyl'],
                $spec['axis'], $spec['add_power'], $spec['sale_price'],
            ]);

            return $logId;
        });

        return [
            'id'            => $id,
            'sku'           => $p['sku'],
            'name'          => $p['name'],
            'referenceDoc'  => $doc,
            'unitCost'      => $cost,
            'salePrice'     => $spec['sale_price'],
            'awaitingCost'  => $cost === null,
            'wasOutOfStock' => !(bool) $p['is_custom_made'],
        ];
    }

    /**
     * Fills in the cost an RX line was opened without.
     *
     * Only a line still waiting can be costed. Rewriting a figure that has
     * already been entered is a correction, not a completion, and it should
     * leave a trail rather than silently replace history.
     *
     * @return array<string,mixed>
     */
    public static function setCost(int $logId, mixed $rawCost, string $role, ?int $actorId = null): array
    {
        Roles::require(Roles::enterRxCost($role), 'กรอกต้นทุน');

        $cost = self::cost(['unit_cost' => $rawCost]);
        if ($cost === null) {
            throw ApiError::badRequest('ต้องระบุต้นทุน', 'missing_field');
        }

        $log = Db::one(
            'SELECT g.id, g.product_id, g.quantity, g.unit_cost, g.reference_doc, p.sku, p.name
             FROM inventory_logs g JOIN products p ON p.id = g.product_id
             WHERE g.id = ? AND g.action_type = \'RX_ORDER\'',
            [$logId],
        );
        if ($log === null) {
            throw ApiError::notFound('ไม่พบรายการสั่งตัด RX นี้');
        }
        if ($log['unit_cost'] !== null) {
            throw ApiError::conflict(
                'already_costed',
                "รายการนี้ลงต้นทุนไว้แล้วที่ {$log['unit_cost']} บาท",
                ['unitCost' => (float) $log['unit_cost']],
            );
        }

        /**
         * ต้นทุนไปอยู่สองที่: บนใบสั่งเดิม และเป็นรายการของวันที่กรอก
         *
         * บนใบสั่งเดิม เพราะทุกที่ที่คิดกำไรของงานนั้นอ่านต้นทุนจากแถวนั้น และงาน
         * นั้นเกิดวันที่สั่ง ไม่ใช่วันที่ใบกำกับมาถึง
         *
         * และเป็นแถวใหม่ลงวันนี้ เพราะการกรอกตัวเลขเงินคือเหตุการณ์ที่เกิดวันนี้
         * — เดิมมันเงียบสนิท: ตัวเลขไปโผล่กลางเดือนที่ปิดไปแล้ว โดยไม่มีบรรทัด
         * ไหนบอกว่าใครกรอกเมื่อไร ตรวจย้อนหลังไม่ได้เลยว่าเดือนที่ปิดไปแล้ว
         * เปลี่ยนตัวเลขเพราะอะไร
         *
         * แถวใหม่มี `quantity` เป็นศูนย์ — ไม่มีของเคลื่อนที่ตอนกรอกราคา กฎที่ว่า
         * ยอดคงเหลือของล็อตเท่ากับผลรวมในสมุดจึงไม่กระทบ และทุกที่ที่คิดมูลค่า
         * เป็น `quantity * unit_cost` ก็ได้ศูนย์ ไม่นับซ้ำกับใบสั่งที่มันอ้างถึง
         */
        Db::tx(static function (\PDO $pdo) use ($cost, $logId, $log, $actorId): void {
            $pdo->prepare('UPDATE inventory_logs SET unit_cost = ? WHERE id = ? AND unit_cost IS NULL')
                ->execute([$cost, $logId]);

            $pdo->prepare(
                'INSERT INTO inventory_logs
                   (product_id, lot_id, action_type, quantity, unit_cost,
                    reference_doc, notes, created_by, created_by_kind, created_at)
                 VALUES (?, NULL, \'COST\', 0, ?, ?, ?, ?, \'user\', NOW())'
            )->execute([
                (int) $log['product_id'],
                $cost,
                $log['reference_doc'],
                'ลงต้นทุนใบสั่งตัด RX ' . ($log['reference_doc'] ?? '') . " — {$cost} บาท/ชิ้น",
                $actorId,
            ]);
        });

        return [
            'id'           => (int) $log['id'],
            'sku'          => $log['sku'],
            'name'         => $log['name'],
            'referenceDoc' => $log['reference_doc'],
            'unitCost'     => $cost,
        ];
    }

    /**
     * The lens an order names, described on the order and filed once.
     *
     * Every order is different — a different customer, a different power, a
     * different price — so the shop writes the lens out on the order sheet
     * rather than picking a catalogue row and hoping it is the right one. This
     * takes what was written and finds the catalogue row it means, filing one
     * the first time a lens is written out and reusing it every time after.
     *
     * Matched on the composed name, which is the whole reason names are
     * composed: two lenses read alike only when they are the same lens. A
     * second "Zeiss SmartLife Transition-Blue (1.67)" would otherwise appear
     * beside the first every time one was ordered, and the reports would count
     * one lens as several.
     *
     * What stays on the order and never on the model: the power, the customer's
     * price and the supplier's cost. Those are what make each sheet different,
     * and filing them on the lens is what migration 011 was written to undo.
     *
     * @param array<string,mixed> $req
     */
    private static function modelByName(array $req, string $role): string
    {
        /**
         * Either shape is accepted: the four spec boxes the order form asks
         * with, or a plain name from a caller that has one — the shop-floor
         * system posts here too, and it knows lenses by name.
         */
        $attrs = [];
        foreach (['model', 'coating', 'lens_index', 'lens_design'] as $key) {
            $v = trim((string) ($req['lens_' . $key] ?? $req[$key] ?? ''));
            if ($v !== '') {
                $attrs[$key] = $v;
            }
        }
        $brand = trim((string) ($req['brand'] ?? '')) === ''
            ? null
            : trim((string) $req['brand']);

        $name = trim((string) ($req['lens_name'] ?? ''));
        if ($name === '' && ($attrs !== [] || $brand !== null)) {
            $name = Catalog::composeName('Lens', $brand, $attrs, true);
        }

        if ($name === '') {
            throw ApiError::badRequest('ต้องระบุรุ่นเลนส์ที่จะสั่ง', 'missing_field');
        }
        if (mb_strlen($name) > 255) {
            throw ApiError::badRequest('ชื่อรุ่นเลนส์ยาวเกิน 255 ตัวอักษร', 'field_too_long');
        }

        $existing = Db::value(
            'SELECT sku FROM products WHERE is_custom_made = 1 AND name = ? ORDER BY id LIMIT 1',
            [$name],
        );
        if ($existing !== null) {
            return (string) $existing;
        }

        // Filing a new model is a catalogue write, and it is gated as one: a
        // shop-floor account may order what the catalogue holds, not add to it.
        Roles::require(Roles::editCatalog($role), 'เพิ่มรุ่นเลนส์ใหม่');

        $categoryId = Db::value("SELECT id FROM categories WHERE code = 'Lens'");
        if ($categoryId === null) {
            throw ApiError::conflict('no_lens_category', 'ยังไม่มีหมวดหมู่เลนส์ในระบบ');
        }

        return (string) Catalog::createProduct([
            'name'               => $name,
            'product_type'       => 'Lens',
            'category_id'        => (int) $categoryId,
            // The model's list price, not this job's: what this customer pays is
            // `sale_price` on the order, because that is what varies.
            'base_selling_price' => trim((string) ($req['sale_price'] ?? '')) === ''
                ? '0'
                : trim((string) $req['sale_price']),
            'is_custom_made'     => true,
            'brand'              => $brand,
            'attributes'         => $attrs,
        ], $role)['sku'];
    }

    /**
     * The next order number going spare: "RX-2026-0133".
     *
     * Counted per year, from the numbers already in the ledger — the shop was
     * writing RX-2026-0121 and up by hand, so the sequence it already keeps is
     * the sequence that continues. Anything written in another shape is skipped
     * rather than fought with: a number somebody typed as "JOB-88" is still a
     * valid reference, it just does not hold the counter.
     *
     * Read, not reserved. Two people opening a form at the same moment are
     * offered the same number and the second one to save is refused as a
     * duplicate — which is the same trade the SKU makes, for the same reason:
     * reserving numbers that are usually abandoned leaves gaps nobody can
     * explain later.
     */
    public static function nextDoc(): string
    {
        $year = date('Y');
        $prefix = 'RX-' . $year . '-';

        $highest = (int) Db::value(
            "SELECT MAX(CAST(SUBSTRING(reference_doc, ?) AS UNSIGNED))
             FROM inventory_logs
             WHERE action_type = 'RX_ORDER' AND reference_doc REGEXP ?",
            [strlen($prefix) + 1, '^' . $prefix . '[0-9]{4}$'],
        );

        return sprintf('%s%04d', $prefix, $highest + 1);
    }

    /**
     * The order book: every RX line ever opened, newest first.
     *
     * Read here rather than from the movements list because an RX order is more
     * than its ledger row — the prescription and the quoted price live beside
     * it, and a screen that had to stitch two endpoints together to show one
     * order would be one refresh away from showing half of it.
     *
     * @return array{rows:list<array<string,mixed>>,total:int}
     */
    public static function orders(
        ?string $q,
        bool $pendingOnly,
        int $page,
        int $per,
        bool $money = false,
    ): array
    {
        $where = ["g.action_type = 'RX_ORDER'"];
        $args = [];

        if ($pendingOnly) {
            $where[] = 'g.unit_cost IS NULL';
        }
        if ($q !== null && trim($q) !== '') {
            $like = '%' . trim($q) . '%';
            $where[] = '(g.reference_doc LIKE ? OR p.sku LIKE ? OR p.name LIKE ? OR g.notes LIKE ?)';
            array_push($args, $like, $like, $like, $like);
        }
        $sql = ' FROM inventory_logs g
                 JOIN products p ON p.id = g.product_id
                 LEFT JOIN rx_orders r ON r.log_id = g.id
                 LEFT JOIN admins a ON a.id = g.created_by
                 WHERE ' . implode(' AND ', $where);

        $total = (int) Db::value('SELECT COUNT(*)' . $sql, $args);

        $per = max(1, min($per, 100));
        $page = max(1, $page);
        $rows = Db::all(
            'SELECT g.id, g.reference_doc, g.created_at, g.unit_cost, g.notes,
                    p.sku, p.name, a.display_name AS actor_name,
                    r.eye_side, r.sph, r.cyl, r.axis, r.add_power, r.sale_price' . $sql .
            ' ORDER BY g.created_at DESC, g.id DESC LIMIT ' . $per . ' OFFSET ' . (($page - 1) * $per),
            $args,
        );

        return [
            'rows' => array_map(static fn(array $r): array => self::shape($r, $money), $rows),
            'total' => $total,
            'page' => $page,
            'perPage' => $per,
        ];
    }

    /** @param array<string,mixed> $r @return array<string,mixed> */
    private static function shape(array $r, bool $money = false): array
    {
        return [
            'id'           => (int) $r['id'],
            'sku'          => $r['sku'],
            'name'         => $r['name'],
            'referenceDoc' => $r['reference_doc'],
            'createdAt'    => $r['created_at'],
            'actorName'    => $r['actor_name'] ?? null,
            'note'         => $r['notes'] ?? null,
            // What the shop paid the supplier leaves the server only for the
            // accounts that may see a buying price. A screen that declines to
            // draw a number it was sent has not kept it: the RX book is read on
            // the shop floor, and the answer was in the response all along.
            'unitCost'     => $money && isset($r['unit_cost']) && $r['unit_cost'] !== null
                ? (float) $r['unit_cost']
                : null,
            'salePrice'    => isset($r['sale_price']) && $r['sale_price'] !== null ? (float) $r['sale_price'] : null,
            'eyeSide'      => $r['eye_side'] ?? null,
            'sph'          => isset($r['sph']) && $r['sph'] !== null ? (float) $r['sph'] : null,
            'cyl'          => isset($r['cyl']) && $r['cyl'] !== null ? (float) $r['cyl'] : null,
            'axis'         => isset($r['axis']) && $r['axis'] !== null ? (int) $r['axis'] : null,
            'add'          => $r['add_power'] ?? null,
        ];
    }

    /**
     * Every RX line still waiting on accounting.
     *
     * Newest first, like every other list on the site — the invoice for the order
     * opened this morning is the one that turns up next.
     *
     * @return list<array<string,mixed>>
     */
    public static function awaitingCost(): array
    {
        return array_map(
            static fn($r) => [
                'id'           => (int) $r['id'],
                'sku'          => $r['sku'],
                'name'         => $r['name'],
                'referenceDoc' => $r['reference_doc'],
                'createdAt'    => $r['created_at'],
                'actorName'    => $r['actor_name'],
            ],
            Db::all(
                'SELECT g.id, g.reference_doc, g.created_at, p.sku, p.name, a.display_name AS actor_name
                 FROM inventory_logs g
                 JOIN products p ON p.id = g.product_id
                 LEFT JOIN admins a ON a.id = g.created_by
                 WHERE g.action_type = \'RX_ORDER\' AND g.unit_cost IS NULL
                 ORDER BY g.created_at DESC, g.id DESC'
            ),
        );
    }

    /* -------------------------------------------------------------- helpers */

    /**
     * The job's own prescription and quoted price.
     *
     * All of it optional: an order is routinely keyed from a phone call and the
     * sheet follows. A blank column reads as "not recorded", which is the truth;
     * a zero would read as a plano lens sold for nothing.
     *
     * @param array<string,mixed> $req
     * @return array{eye_side:?string,sph:?string,cyl:?string,axis:?int,add_power:?string,sale_price:?string}
     */
    private static function spec(array $req): array
    {
        $eye = self::optional($req, 'eye_side', 10);
        if ($eye !== null && !in_array($eye, ['left', 'right'], true)) {
            throw ApiError::badRequest('ข้างตาต้องเป็น left หรือ right', 'bad_eye_side');
        }

        $signed = static function (mixed $v, string $field): ?string {
            if ($v === null || $v === '') {
                return null;
            }
            $s = str_replace(['−', '+'], ['-', ''], trim((string) $v));
            if (!preg_match('/^-?\d{1,3}(\.\d{1,2})?$/', $s)) {
                throw ApiError::badRequest("{$field} ต้องเป็นตัวเลข ทศนิยมไม่เกินสองตำแหน่ง", 'bad_rx');
            }
            return $s;
        };

        $axis = $req['axis'] ?? null;
        if ($axis !== null && $axis !== '') {
            if (!preg_match('/^\d{1,3}$/', trim((string) $axis)) || (int) $axis > 180) {
                throw ApiError::badRequest('AXIS ต้องเป็นจำนวนเต็ม 0–180', 'bad_axis');
            }
            $axis = (int) $axis;
        } else {
            $axis = null;
        }

        $price = $req['sale_price'] ?? null;
        if ($price !== null && $price !== '') {
            $price = trim((string) $price);
            if (!preg_match('/^\d{1,10}(\.\d{1,2})?$/', $price)) {
                throw ApiError::badRequest('ราคาขายต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกินสองตำแหน่ง', 'bad_price');
            }
        } else {
            $price = null;
        }

        return [
            'eye_side'   => $eye,
            'sph'        => $signed($req['sph'] ?? null, 'SPH'),
            'cyl'        => $signed($req['cyl'] ?? null, 'CYL'),
            'axis'       => $axis,
            'add_power'  => self::optional($req, 'add', 10),
            'sale_price' => $price,
        ];
    }

    /** @param array<string,mixed> $req */
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

    /**
     * Money arrives as a string and stays one. Casting to float here is how a
     * costing module ends up a satang out with nobody able to say where.
     *
     * @param array<string,mixed> $req
     */
    private static function cost(array $req): ?string
    {
        $v = $req['unit_cost'] ?? null;
        if ($v === null || $v === '') {
            return null;
        }

        $s = trim((string) $v);
        if (!preg_match('/^\d{1,10}(\.\d{1,2})?$/', $s)) {
            throw ApiError::badRequest('ต้นทุนต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกินสองตำแหน่ง', 'bad_cost');
        }
        return $s;
    }
}
