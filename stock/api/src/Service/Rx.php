<?php

declare(strict_types=1);

namespace Optic\Service;

use Optic\ApiError;
use Optic\Db;
use Optic\Optics;
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
    public static function order(array $req, array $roles, int $actorId): array
    {
        // Either the model is already in the catalogue, or its name is enough
        // to put it there. Making someone leave a half-written order to go and
        // create a product first is two jobs where the shop only has one.
        $sku = trim((string) ($req['sku'] ?? '')) === ''
            ? self::modelByName($req, $roles)
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
        $branchId = self::branch($req);

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
            Roles::require(Roles::enterRxCost($roles), 'กรอกต้นทุนจากผู้ขาย');
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

        $id = Db::tx(static function (PDO $pdo) use ($p, $doc, $note, $cost, $spec, $actorId, $branchId): int {
            /* ราคาขายลงสมุดด้วย ไม่ใช่อยู่แต่บน rx_orders — หน้าความเคลื่อนไหวอ่าน
               จากสมุดอย่างเดียว ถ้าไม่ลงไว้ ใบสั่งตัดจะเป็นแถวที่ไม่มีราคาขายเลย */
            $pdo->prepare(
                'INSERT INTO inventory_logs
                   (product_id, lot_id, action_type, quantity, unit_cost, sale_price,
                    reference_doc, notes, created_by, created_by_kind, created_at)
                 VALUES (?, NULL, \'RX_ORDER\', -1, ?, ?, ?, ?, ?, \'user\', NOW())'
            )->execute([$p['id'], $cost, $spec['sale_price'], $doc, $note, $actorId]);

            $logId = (int) $pdo->lastInsertId();

            // The prescription belongs to this job, not to the lens model it was
            // cut from — see the note on the migration that made this table.
            $pdo->prepare(
                'INSERT INTO rx_orders (log_id, branch_id, eye_side, sph, cyl, axis, add_power, sale_price)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $logId, $branchId, $spec['eye_side'], $spec['sph'], $spec['cyl'],
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
    /**
     * แก้ราคาขายของใบสั่งตัดที่เปิดไปแล้ว
     *
     * ต่างจาก setCost() ตรงที่แก้ซ้ำได้ไม่จำกัด และไม่ใช่สิทธิ์ของฝ่ายบัญชี:
     * ราคาขายของงานสั่งตัดตกลงกันเป็นบิล ๆ ไป คนขายเป็นคนตัดสินว่าบิลนี้คิดเท่าไร
     * และพิมพ์ผิดก็ต้องแก้ได้ทันทีโดยไม่ต้องรอใคร · ต้นทุนตรงกันข้าม — ลงได้ครั้ง
     * เดียวและเป็นของแอดมิน เพราะมันมาจากใบกำกับของผู้ขาย ไม่ใช่ข้อตกลงหน้าร้าน
     *
     * ราคาไปอยู่สองที่เหมือนที่ setCost ทำกับต้นทุน: ทับบนใบสั่งเดิม เพราะทุกที่
     * ที่คิดกำไรของงานนั้นอ่านจากแถวนั้น · และเป็นแถว PRICE ลงวันนี้ เพราะการแก้
     * ตัวเลขเงินคือเหตุการณ์ที่เกิดวันนี้ ต้องตรวจย้อนหลังได้ว่าใครแก้ จากเท่าไร
     * เป็นเท่าไร — ไม่งั้นราคาที่เปลี่ยนได้ตลอดจะกลายเป็นตัวเลขที่ไม่มีใครรับผิดชอบ
     */
    public static function setPrice(int $logId, mixed $rawPrice, array $roles, ?int $actorId = null): array
    {
        Roles::require(Roles::moveStock($roles), 'แก้ราคาขาย');

        $raw = trim((string) ($rawPrice ?? ''));
        $price = $raw === '' ? null : $raw;
        if ($price !== null && !preg_match('/^\d{1,10}(\.\d{1,2})?$/', $price)) {
            throw ApiError::badRequest('ราคาขายต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกินสองตำแหน่ง', 'bad_price');
        }

        $log = Db::one(
            'SELECT g.id, g.product_id, g.reference_doc, r.sale_price AS old_price, p.sku, p.name
             FROM inventory_logs g
             JOIN products p ON p.id = g.product_id
             LEFT JOIN rx_orders r ON r.log_id = g.id
             WHERE g.id = ? AND g.action_type = \'RX_ORDER\'',
            [$logId],
        );
        if ($log === null) {
            throw ApiError::notFound('ไม่พบรายการสั่งตัด RX นี้');
        }

        $old = $log['old_price'] === null ? null : (string) $log['old_price'];
        if ($old === $price || ($old !== null && $price !== null && (float) $old === (float) $price)) {
            return [
                'id'           => (int) $log['id'],
                'sku'          => $log['sku'],
                'name'         => $log['name'],
                'referenceDoc' => $log['reference_doc'],
                'salePrice'    => $price === null ? null : (float) $price,
                'changed'      => false,
            ];
        }

        $was = $old === null ? 'ยังไม่ได้ตั้ง' : $old . ' บาท';
        $now = $price === null ? 'ยังไม่ได้ตั้ง' : $price . ' บาท';

        Db::tx(static function (\PDO $pdo) use ($price, $logId, $log, $actorId, $was, $now): void {
            $pdo->prepare('UPDATE rx_orders SET sale_price = ? WHERE log_id = ?')
                ->execute([$price, $logId]);
            $pdo->prepare('UPDATE inventory_logs SET sale_price = ? WHERE id = ?')
                ->execute([$price, $logId]);

            $pdo->prepare(
                'INSERT INTO inventory_logs
                   (product_id, lot_id, action_type, quantity, unit_cost, sale_price,
                    reference_doc, notes, created_by, created_by_kind, created_at)
                 VALUES (?, NULL, \'PRICE\', 0, NULL, ?, ?, ?, ?, \'user\', NOW())'
            )->execute([
                (int) $log['product_id'],
                $price,
                $log['reference_doc'],
                'แก้ราคาขายใบสั่งตัด RX ' . ($log['reference_doc'] ?? '') . " — จาก {$was} เป็น {$now}",
                $actorId,
            ]);
        });

        return [
            'id'           => (int) $log['id'],
            'sku'          => $log['sku'],
            'name'         => $log['name'],
            'referenceDoc' => $log['reference_doc'],
            'salePrice'    => $price === null ? null : (float) $price,
            'changed'      => true,
        ];
    }

    public static function setCost(int $logId, mixed $rawCost, array $roles, ?int $actorId = null): array
    {
        Roles::require(Roles::enterRxCost($roles), 'กรอกต้นทุน');

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

        /**
         * ตัวเลขเดิม — แก้ทับได้ ไม่ใช่ลงได้ครั้งเดียวอีกต่อไป
         *
         * เดิมที่นี่ปฏิเสธการลงซ้ำ ด้วยเหตุผลว่าต้นทุนที่แก้ได้ตลอดคือต้นทุนที่ไม่มี
         * ใครรับผิดชอบ · แต่สิ่งที่ได้จริงคือใบที่พิมพ์ผิดหนึ่งตัวแล้วค้างผิดตลอดไป
         * แล้วกำไรของงานนั้นผิดตามไปทุกที่ที่อ่านมัน — ทางแก้ที่เหลืออยู่คือลบใบ
         * ทิ้งแล้วเปิดใหม่ ซึ่งทำลายร่องรอยมากกว่าการแก้ตัวเลขเสียอีก
         *
         * สิ่งที่กันการแก้มั่วไม่ใช่การห้ามแก้ แต่คือทุกการแก้ลงสมุดว่าใครแก้ จาก
         * เท่าไรเป็นเท่าไร ซึ่งเป็นกติกาเดียวกับราคาขายใน `setPrice` ข้างบน
         */
        $old = $log['unit_cost'] === null ? null : (string) $log['unit_cost'];
        if ($old !== null && (float) $old === (float) $cost) {
            return [
                'id'           => (int) $log['id'],
                'sku'          => $log['sku'],
                'name'         => $log['name'],
                'referenceDoc' => $log['reference_doc'],
                'unitCost'     => $cost,
                'changed'      => false,
            ];
        }

        /* ทศนิยมสองตำแหน่งทั้งสองข้าง — ตัวเก่ามาจากคอลัมน์ decimal(12,2) ส่วนตัว
           ใหม่มาจากช่องกรอก บรรทัดที่เขียนว่า "จาก 500.00 เป็น 999" อ่านเหมือน
           คนละหน่วย ทั้งที่เป็นตัวเลขแบบเดียวกัน */
        $money = static fn(string $v): string => number_format((float) $v, 2, '.', '');

        $note = 'ลงต้นทุนใบสั่งตัด RX ' . ($log['reference_doc'] ?? '')
            . ($old === null
                ? ' — ' . $money($cost) . ' บาท/ชิ้น'
                : ' — แก้จาก ' . $money($old) . ' บาท เป็น ' . $money($cost) . ' บาท/ชิ้น');

        /**
         * ต้นทุนไปอยู่สองที่: บนใบสั่งเดิม และเป็นรายการของวันที่กรอก
         *
         * บนใบสั่งเดิม เพราะทุกที่ที่คิดกำไรของงานนั้นอ่านต้นทุนจากแถวนั้น และงาน
         * นั้นเกิดวันที่สั่ง ไม่ใช่วันที่ใบกำกับมาถึง
         *
         * และเป็นแถวใหม่ลงวันนี้ เพราะการกรอกตัวเลขเงินคือเหตุการณ์ที่เกิดวันนี้
         * — เดิมมันเงียบสนิท: ตัวเลขไปโผล่กลางเดือนที่ปิดไปแล้ว โดยไม่มีบรรทัด
         * ไหนบอกว่าใครกรอกเมื่อไร ตรวจย้อนหลังไม่ได้เลยว่าเดือนที่ปิดไปแล้ว
         * เปลี่ยนตัวเลขเพราะอะไร · ตอนที่แก้ทับได้แล้ว บรรทัดนี้ยิ่งเป็นของจำเป็น
         * ไม่ใช่ของแถม — มันคือที่เดียวที่บอกว่าตัวเลขเก่าคือเท่าไร
         *
         * แถวใหม่มี `quantity` เป็นศูนย์ — ไม่มีของเคลื่อนที่ตอนกรอกราคา กฎที่ว่า
         * ยอดคงเหลือของล็อตเท่ากับผลรวมในสมุดจึงไม่กระทบ และทุกที่ที่คิดมูลค่า
         * เป็น `quantity * unit_cost` ก็ได้ศูนย์ ไม่นับซ้ำกับใบสั่งที่มันอ้างถึง
         */
        Db::tx(static function (\PDO $pdo) use ($cost, $logId, $log, $actorId, $note): void {
            $pdo->prepare('UPDATE inventory_logs SET unit_cost = ? WHERE id = ?')
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
                $note,
                $actorId,
            ]);
        });

        return [
            'id'           => (int) $log['id'],
            'sku'          => $log['sku'],
            'name'         => $log['name'],
            'referenceDoc' => $log['reference_doc'],
            'unitCost'     => $cost,
            'changed'      => true,
        ];
    }

    /**
     * แก้รายละเอียดของใบสั่งตัดที่เปิดไปแล้ว
     *
     * ใบสั่งตัดเปิดง่ายและเปิดผิดง่ายพอกัน — ค่าสายตาสลับข้าง เลขใบพิมพ์ตก
     * ชื่อคนไข้ผิดคน · สิ่งเหล่านี้ถูกอ่านออกมาจากใบสั่งกระดาษด้วยตาคน แล้วพิมพ์
     * ซ้ำอีกครั้ง จุดที่ผิดจึงไม่ใช่ข้อยกเว้น มันคือเรื่องปกติของงานคีย์ข้อมูล
     *
     * สิ่งที่แก้ที่นี่คือ "ใบสั่งใบนี้บอกอะไร" ไม่ใช่ "ใบสั่งใบนี้คือของอะไร":
     *
     *   แก้ได้     เลขใบสั่ง · ค่าสายตาทั้งชุด · หมายเหตุ · ราคาขาย
     *   แก้ไม่ได้  รุ่นเลนส์ — เปลี่ยนรุ่นคือคนละใบ ไม่ใช่ใบเดิมที่พิมพ์ผิด และ
     *              `product_id` ของแถวนี้เป็นตัวที่รายงานทุกตัวรวมยอดตาม
     *              เปลี่ยนมันเงียบ ๆ = ย้ายยอดของเดือนที่ปิดไปแล้วข้ามรุ่น
     *   แก้ไม่ได้  ต้นทุน — แก้ได้ แต่ไม่ใช่ที่นี่ มันมีเส้นของตัวเองที่ setCost
     *              เพราะเป็นคนละสิทธิ์ (ฝ่ายบัญชี) และลงสมุดคนละบรรทัด · ส่งมาก็
     *              ไม่รับ ไม่ต้องโยน error: ฟอร์มไม่มีช่องนี้ให้กรอกอยู่แล้ว
     *
     * ราคาขายเดินผ่าน setPrice() ตัวเดิม ไม่ได้เขียนซ้ำที่นี่ — บรรทัด PRICE ที่
     * บอกว่าใครแก้ จากเท่าไรเป็นเท่าไร ต้องลงสมุดเหมือนกันไม่ว่าจะแก้จากช่องใน
     * ตารางหรือจากหน้าต่างแก้ไข ราคาที่แก้ได้ตลอดโดยไม่มีร่องรอยคือราคาที่ไม่มี
     * ใครรับผิดชอบ
     *
     * @param array<string,mixed> $body
     * @return array<string,mixed>
     */
    public static function edit(int $logId, array $body, array $roles, ?int $actorId = null): array
    {
        Roles::require(Roles::moveStock($roles), 'แก้ใบสั่งตัด RX');

        $log = self::liveOrder($logId);
        $spec = self::spec($body);

        /* เลขใบสั่งที่ส่งมาว่าง = ไม่ได้ตั้งใจแก้ ไม่ใช่ตั้งใจล้าง — ใบสั่งที่ไม่มี
           เลขคือใบที่หาไม่เจอ ต่างจากค่าสายตาที่ว่างได้จริงเมื่อยังไม่ได้วัด */
        $doc = trim((string) ($body['reference_doc'] ?? ''));
        $doc = $doc === '' ? $log['reference_doc'] : self::str($body, 'reference_doc', 100);
        $note = self::optional($body, 'note', 500);

        Db::tx(static function (PDO $pdo) use ($logId, $doc, $note, $spec): void {
            $pdo->prepare('UPDATE inventory_logs SET reference_doc = ?, notes = ? WHERE id = ?')
                ->execute([$doc, $note, $logId]);

            self::ensureDetail($pdo, $logId);
            $pdo->prepare(
                'UPDATE rx_orders SET eye_side = ?, sph = ?, cyl = ?, axis = ?, add_power = ?
                 WHERE log_id = ?'
            )->execute([
                $spec['eye_side'], $spec['sph'], $spec['cyl'],
                $spec['axis'], $spec['add_power'], $logId,
            ]);
        });

        /* ราคาขายทีหลัง และอยู่นอกทรานแซกชันข้างบนโดยตั้งใจ — setPrice เปิด
           ทรานแซกชันของตัวเอง และตัดสินใจเองว่าจะลงบรรทัด PRICE ไหม ซึ่งเป็น
           สองอย่างที่ไม่ควรมีสำเนาที่สองไว้ตรงนี้ให้คอยตามแก้ให้ตรงกัน */
        if (array_key_exists('sale_price', $body)) {
            self::setPrice($logId, $body['sale_price'], $roles, $actorId);
        }

        return self::byId($logId);
    }

    /**
     * เอาใบสั่งตัดใบนี้ออก — ด้วยวิธีที่ตรงกับว่ามีตัวเลขเงินผูกอยู่แล้วหรือยัง
     *
     * สองแบบ ไม่ใช่แบบเดียวที่มีเงื่อนไข:
     *
     *   ยังไม่ลงต้นทุน และยังไม่ตั้งราคาขาย → **ลบจริง**
     *     ไม่มีตัวเลขไหนที่ใครเคยอ่านหรือเคยถูกรวมในรายงาน แถวนี้จึงไม่ใช่ประวัติ
     *     มันคือการพิมพ์ผิดที่ยังไม่มีใครเห็น · RX_ORDER ไม่เคยผูกกับล็อต
     *     (`lot_id` NULL) ยอดคงเหลือของล็อตไหนจึงไม่ขยับ
     *     ลบ `rx_orders` ก่อนแล้วค่อยลบแถวในสมุด — foreign key เป็น RESTRICT
     *     ตามกฎของ 012 ซึ่งห้ามลูกหายตามพ่อไปเงียบ ๆ ไม่ได้ห้ามการเก็บลูกเองก่อน
     *
     *   ลงต้นทุนหรือตั้งราคาไปแล้ว → **ยกเลิก**
     *     ตัวเลขนั้นเคยถูกอ่าน เคยถูกรวม ลบทิ้งคือแก้ประวัติ · แถวเดิมอยู่ที่เดิม
     *     ปั๊มว่ายกเลิกเมื่อไหร่โดยใคร แล้วลงบรรทัด RETURN คู่กันในสมุด — สมุด
     *     บอกว่าเคยสั่งแล้วยกเลิก ไม่ใช่บอกว่าไม่เคยสั่ง
     *
     * @param array<string,mixed> $body
     * @return array<string,mixed>
     */
    public static function remove(int $logId, array $body, array $roles, ?int $actorId = null): array
    {
        Roles::require(Roles::moveStock($roles), 'ลบใบสั่งตัด RX');

        $log = self::liveOrder($logId);
        $bound = $log['unit_cost'] !== null || $log['sale_price'] !== null;

        if (!$bound) {
            Db::tx(static function (PDO $pdo) use ($logId): void {
                $pdo->prepare('DELETE FROM rx_orders WHERE log_id = ?')->execute([$logId]);
                $pdo->prepare('DELETE FROM inventory_logs WHERE id = ?')->execute([$logId]);
            });

            return [
                'mode'         => 'deleted',
                'id'           => $logId,
                'sku'          => $log['sku'],
                'name'         => $log['name'],
                'referenceDoc' => $log['reference_doc'],
            ];
        }

        // ใบที่มีตัวเลขเงินผูกอยู่ ยกเลิกโดยไม่บอกเหตุผลคือใบที่อธิบายไม่ได้ทีหลัง
        $note = self::optional($body, 'note', 500);
        if ($note === null) {
            throw ApiError::badRequest('ยกเลิกใบสั่งตัดต้องบอกเหตุผลไว้ด้วย', 'missing_field');
        }

        Roles::require(Roles::enterRxCost($roles), 'ยกเลิกใบสั่งตัดที่มีตัวเลขเงินแล้ว');

        Db::tx(static function (PDO $pdo) use ($logId, $log, $note, $actorId): void {
            self::ensureDetail($pdo, $logId);

            $changed = $pdo->prepare(
                'UPDATE rx_orders SET cancelled_at = NOW(), cancelled_by = ?, cancelled_note = ?
                 WHERE log_id = ? AND cancelled_at IS NULL'
            );
            $changed->execute([$actorId, $note, $logId]);
            if ($changed->rowCount() !== 1) {
                throw ApiError::conflict('race', 'มีคนยกเลิกใบนี้พร้อมกัน ลองใหม่อีกครั้ง');
            }

            /* กลับทิศกับ RX_ORDER ที่เป็น -1 · lot_id ยังเป็น NULL เพราะใบสั่งตัด
               ไม่เคยผูกกับล็อตตั้งแต่แรก การยกเลิกจึงไม่มีล็อตไหนให้คืนของเข้า */
            $pdo->prepare(
                'INSERT INTO inventory_logs
                   (product_id, lot_id, action_type, quantity, unit_cost, sale_price,
                    reference_doc, notes, created_by, created_by_kind, created_at)
                 VALUES (?, NULL, \'RETURN\', 1, NULL, NULL, ?, ?, ?, \'user\', NOW())'
            )->execute([
                (int) $log['product_id'],
                $log['reference_doc'],
                'ยกเลิกใบสั่งตัด RX ' . ($log['reference_doc'] ?? '') . ' — ' . $note,
                $actorId,
            ]);
        });

        return [
            'mode'         => 'cancelled',
            'id'           => $logId,
            'sku'          => $log['sku'],
            'name'         => $log['name'],
            'referenceDoc' => $log['reference_doc'],
            'note'         => $note,
        ];
    }

    /**
     * ใบสั่งตัดใบนี้ต้องมีแถวรายละเอียดของตัวเองก่อน จะแก้หรือจะยกเลิกก็ตาม
     *
     * ใบที่เปิดก่อน migration 011 มีแต่แถวในสมุด ไม่มีแถวใน `rx_orders` — 011
     * สร้างตารางไว้เฉย ๆ ไม่ได้เติมย้อนหลังให้ใบเก่า · ถ้าไม่เติมตรงนี้ การแก้
     * ค่าสายตาของใบเก่าจะเงียบสนิท (UPDATE ไม่โดนแถวไหน) และการยกเลิกจะเด้ง
     * "มีคนยกเลิกพร้อมกัน" ทั้งที่ไม่มีใครแตะเลย
     *
     * `uq_rx_log` เป็นคีย์เดี่ยวบน log_id — INSERT IGNORE จึงเงียบเมื่อมีอยู่แล้ว
     * ซึ่งเป็นกรณีปกติของใบที่เปิดหลัง 011
     */
    private static function ensureDetail(PDO $pdo, int $logId): void
    {
        $pdo->prepare('INSERT IGNORE INTO rx_orders (log_id) VALUES (?)')->execute([$logId]);
    }

    /**
     * ใบสั่งตัดใบนี้ ถ้ามันยังเดินอยู่
     *
     * ใบที่ยกเลิกแล้วถูกปฏิเสธที่นี่ที่เดียว ทั้งการแก้และการลบจึงตอบเหมือนกัน
     * โดยไม่ต้องมีเงื่อนไขสองชุด — ใบที่ปิดไปแล้วไม่มีอะไรให้ทำต่อ
     *
     * @return array<string,mixed>
     */
    private static function liveOrder(int $logId): array
    {
        $log = Db::one(
            'SELECT g.id, g.product_id, g.unit_cost, g.reference_doc, p.sku, p.name,
                    r.sale_price, r.cancelled_at
             FROM inventory_logs g
             JOIN products p ON p.id = g.product_id
             LEFT JOIN rx_orders r ON r.log_id = g.id
             WHERE g.id = ? AND g.action_type = \'RX_ORDER\'',
            [$logId],
        );
        if ($log === null) {
            throw ApiError::notFound('ไม่พบรายการสั่งตัด RX นี้');
        }
        if ($log['cancelled_at'] !== null) {
            throw ApiError::conflict(
                'already_cancelled',
                'ใบสั่งตัดใบนี้ถูกยกเลิกไปแล้วเมื่อ ' . $log['cancelled_at'],
                ['cancelledAt' => $log['cancelled_at']],
            );
        }
        return $log;
    }

    /**
     * ใบเดียวตามที่สมุดใบสั่งรายงาน — รูปเดียวกับแถวใน orders()
     *
     * @return array<string,mixed>
     */
    private static function byId(int $logId): array
    {
        $row = Db::one(
            'SELECT g.id, g.reference_doc, g.created_at, g.unit_cost, g.notes,
                    p.sku, p.name, a.display_name AS actor_name,
                    r.eye_side, r.sph, r.cyl, r.axis, r.add_power, r.sale_price,
                    r.branch_id, b.name AS branch_name
             FROM inventory_logs g
             JOIN products p ON p.id = g.product_id
             LEFT JOIN rx_orders r ON r.log_id = g.id
             LEFT JOIN admins a ON a.id = g.created_by
                 LEFT JOIN branches b ON b.id = r.branch_id
             WHERE g.id = ?',
            [$logId],
        );
        if ($row === null) {
            throw ApiError::notFound('ไม่พบรายการสั่งตัด RX นี้');
        }
        return self::shape($row, true);
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
    private static function modelByName(array $req, array $roles): string
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

        /* เปิดรุ่นเลนส์ใหม่คือการเพิ่มของ ไม่ใช่การแก้ของที่มีอยู่ — และมันเกิด
           ตรงที่คนขายกำลังเขียนใบสั่งให้ลูกค้าที่ยืนรออยู่ ถ้าห้ามไว้ พนักงานจะ
           เลือกรุ่นที่ใกล้เคียงที่สุดแทน แล้วใบสั่งจะบอกรุ่นผิดตลอดไป */
        Roles::require(Roles::addProduct($roles), 'เพิ่มรุ่นเลนส์ใหม่');

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
        ], $roles)['sku'];
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
        /* ใบที่ยกเลิกแล้วไม่อยู่ในสมุด — สมุดใบสั่งตอบคำถาม "มีงานอะไรเดินอยู่"
           ไม่ใช่ "เคยมีอะไรบ้าง" · แถวยังอยู่ในฐานข้อมูลและอ่านย้อนหลังได้จาก
           หน้าความเคลื่อนไหว ซึ่งเป็นที่ของประวัติ */
        $where = ["g.action_type = 'RX_ORDER'", 'r.cancelled_at IS NULL'];
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
                 LEFT JOIN branches b ON b.id = r.branch_id
                 WHERE ' . implode(' AND ', $where);

        $total = (int) Db::value('SELECT COUNT(*)' . $sql, $args);

        $per = max(1, min($per, 100));
        $page = max(1, $page);
        $rows = Db::all(
            'SELECT g.id, g.reference_doc, g.created_at, g.unit_cost, g.notes,
                    p.sku, p.name, a.display_name AS actor_name,
                    r.eye_side, r.sph, r.cyl, r.axis, r.add_power, r.sale_price,
                    r.branch_id, b.name AS branch_name' . $sql .
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
            /**
             * ยังไม่มีใครลงต้นทุนหรือยัง — ตอบตามความจริงเสมอ ไม่ขึ้นกับ $money
             *
             * ต้องมีเพราะ `unitCost` เป็น null ได้สองความหมาย: "ยังไม่ได้ลง" กับ
             * "ลงแล้วแต่คุณไม่มีสิทธิ์เห็น" · หน้าจอที่แยกสองอย่างนี้ไม่ออกจะขึ้น
             * ป้าย "รอฝ่ายบัญชี" ให้พนักงานคลังทุกแถว ทั้งที่บัญชีลงครบไปแล้ว
             *
             * ค่านี้ไม่ใช่ราคา — มันบอกแค่ว่าขั้นตอนเดินไปถึงไหน ซึ่งเป็นสิ่งที่คน
             * เปิดใบสั่งต้องรู้อยู่แล้วเพื่อจะได้ไม่ต้องตามถามฝ่ายบัญชีซ้ำ
             */
            'awaitingCost' => !isset($r['unit_cost']) || $r['unit_cost'] === null,
            'salePrice'    => isset($r['sale_price']) && $r['sale_price'] !== null ? (float) $r['sale_price'] : null,
            'eyeSide'      => $r['eye_side'] ?? null,
            'sph'          => isset($r['sph']) && $r['sph'] !== null ? (float) $r['sph'] : null,
            'cyl'          => isset($r['cyl']) && $r['cyl'] !== null ? (float) $r['cyl'] : null,
            'axis'         => isset($r['axis']) && $r['axis'] !== null ? (int) $r['axis'] : null,
            'add'          => $r['add_power'] ?? null,
            // สาขาที่สั่ง — null คือร้านนี้สั่งเอง ไม่ใช่ "ยังไม่ได้กรอก"
            'branchId'     => isset($r['branch_id']) && $r['branch_id'] !== null ? (int) $r['branch_id'] : null,
            'branch'       => $r['branch_name'] ?? null,
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
                 LEFT JOIN rx_orders r ON r.log_id = g.id
                 LEFT JOIN admins a ON a.id = g.created_by
                 LEFT JOIN branches b ON b.id = r.branch_id
                 WHERE g.action_type = \'RX_ORDER\' AND g.unit_cost IS NULL
                   AND r.cancelled_at IS NULL
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

        /* The powers, measured against the same ladders the pickers offer.
           A figure off the ends of the run, or between two quarter steps, is
           refused rather than stored — Optics carries the runs and the why. */
        $sph  = Optics::power($req['sph'] ?? null, 'sph', 'SPH');
        $cyl  = Optics::power($req['cyl'] ?? null, 'cyl', 'CYL');
        $add  = Optics::power($req['add'] ?? null, 'add', 'ADD');
        $axis = Optics::axis($req['axis'] ?? null);

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
            // SPH and CYL land in DECIMAL columns, which keep the number and
            // not the way it was written, so the leading plus is dropped. ADD
            // is a VARCHAR that keeps its plus — that plus is how an addition
            // is read on the job sheet.
            'sph'        => $sph === null ? null : ltrim($sph, '+'),
            'cyl'        => $cyl === null ? null : ltrim($cyl, '+'),
            'axis'       => $axis,
            'add_power'  => $add,
            'sale_price' => $price,
        ];
    }

    /**
     * สาขาที่สั่งใบนี้ — หรือ null เมื่อร้านนี้สั่งเอง
     *
     * ว่างได้ และเป็นค่าปกติ: ใบสั่งส่วนใหญ่เป็นงานของร้านนี้ · ถ้าบังคับให้
     * เลือกทุกใบ คนหน้าร้านต้องเลือก "ร้านตัวเอง" วันละสิบครั้งเพื่อบอกสิ่งที่
     * ระบบรู้อยู่แล้ว
     *
     * ตรวจว่าสาขามีจริงและยังเปิดใช้งาน — สาขาที่ปิดไปแล้วสั่งของใหม่ไม่ได้
     * ด้วยเหตุผลเดียวกับที่มันเบิกของไม่ได้ (ดู `Stock::draw`)
     *
     * @param array<string,mixed> $req
     */
    private static function branch(array $req): ?int
    {
        $v = $req['branch_id'] ?? null;
        if ($v === null || $v === '' || (int) $v === 0) {
            return null;
        }

        $id = (int) $v;
        $row = Db::one('SELECT id, is_active FROM branches WHERE id = ?', [$id]);
        if ($row === null) {
            throw ApiError::badRequest('ไม่พบสาขานี้', 'unknown_branch');
        }
        if (!(bool) $row['is_active']) {
            throw ApiError::badRequest('สาขานี้ปิดใช้งานแล้ว', 'branch_inactive');
        }

        return $id;
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
