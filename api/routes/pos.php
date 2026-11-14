<?php
/**
 * POS ขายหน้าร้าน — ขายของเบ็ดเตล็ดที่ไม่มีเคส ไม่มีใบสายตา ไม่มีวันนัดรับ
 *
 * แยกจาก Main Process 6 ขั้นโดยสิ้นเชิง · ไม่แตะ cases / custom_orders /
 * prescriptions และไม่เขียนลงตาราง `payments` ของเคส (เงิน POS มีรางของตัวเอง
 * ที่ `pos_payments` เหตุผลอยู่ในหัวไฟล์ migration 016)
 *
 * กฎที่ยึดทั้งไฟล์:
 *
 *   1. **ยอดเงินทุกตัวคำนวณที่นี่ ไม่เชื่อค่าที่หน้าเว็บส่งมา** — หน้าเว็บส่งมาได้แค่
 *      จำนวนกับราคาต่อชิ้นของแต่ละรายการ ที่เหลือ (line_total, subtotal, total,
 *      paid, balance, payment_status) เป็นของ server ล้วน · หน้าเว็บคำนวณเองด้วย
 *      เพื่อโชว์สด ๆ แต่ค่าที่ถูกบันทึกคือค่าที่นี่เสมอ
 *
 *   2. **รับเงินเพิ่ม = INSERT แถวใหม่** ไม่มีที่ไหนในไฟล์นี้ UPDATE pos_payments
 *      ที่มีอยู่แล้ว · ยกเลิกงวดใช้ cancelled_at
 *
 *   3. **สถานะจ่ายเงินกับสถานะส่งมอบไม่รู้จักกัน** ไม่มีบรรทัดไหนที่อ่านค่าหนึ่ง
 *      แล้วไปตัดสินอีกค่าหนึ่ง — ร้านนี้ปล่อยของทั้งที่ค้างเงินได้
 */
declare(strict_types=1);

/** ช่องทางชำระที่รับ — ค่าอื่นถูกปฏิเสธ ไม่ใช่บันทึกลงไปเงียบ ๆ */
const POS_METHODS = ['cash', 'transfer', 'credit', 'thungngern'];

/** คนที่กำลังกดอยู่ — ผ่านประตู session ของ index.php มาแล้ว จึงไม่มีทางเป็น null */
function posActor(): array
{
    $a = StockModule::actor();
    if ($a === null) {
        bad('ต้องเข้าสู่ระบบก่อน');
    }
    return $a;
}

/**
 * งานของแอดมิน — แก้วันที่ย้อนหลัง และยกเลิกใบ
 *
 * ผูกกับ `system.zone` ไม่ใช่ `money.zone` ทั้งที่เป็นเรื่องเงิน — สองอย่างนี้คือ
 * การกลับสิ่งที่บันทึกไปแล้ว ซึ่งเป็นอำนาจของคนที่ดูแลร้าน ไม่ใช่ของคนที่ตรวจ
 * ตัวเลข · วันที่มีใครให้บทบาทบัญชีบวกหน้าร้านกับใครสักคน เขาไม่ควรได้ปุ่มยกเลิก
 * ใบเสร็จติดมาด้วยโดยไม่มีใครตั้งใจ
 */
function posIsAdminUp(array $actor): bool
{
    return \Optic\Roles::systemZone($actor['roles']);
}

/**
 * ฝั่งคลังทำงานคนละงาน ไม่มีอะไรให้ทำที่ POS — กันที่ API ด้วย ไม่ใช่แค่ซ่อนเมนู
 * (หน้าจอที่ซ่อนปุ่มแต่ API ยอมรับ คือ API ที่ไม่ได้กันอะไรเลย)
 */
function posRequireSeller(array $actor): void
{
    if (!\Optic\Roles::useFrontdesk($actor['roles'])) {
        bad('สิทธิ์ของคุณใช้งาน POS ไม่ได้');
    }
}

/**
 * สรุปยอดของใบหนึ่งใหม่จากของจริงในฐาน แล้วเขียนกลับ
 *
 * อ่านจาก pos_sale_items กับ pos_payments เสมอ ไม่รับตัวเลขจากใครมาเชื่อ —
 * เรียกทุกครั้งที่มีอะไรเปลี่ยนกับใบ (สร้างใหม่ / รับเงินเพิ่ม / ยกเลิกงวด)
 * จึงเป็นที่เดียวในระบบที่ตัดสินว่าใบนี้จ่ายครบหรือยัง
 */
function posRecalc(Tx $q, int $saleId): array
{
    $sale = $q->get('SELECT * FROM pos_sales WHERE id = ?', $saleId);
    if (!$sale) {
        missing();
    }

    $sub = round2($q->get(
        'SELECT COALESCE(SUM(line_total), 0) AS s FROM pos_sale_items WHERE sale_id = ?',
        $saleId
    )['s']);

    $discount = round2($sale['discount_amount']);
    /* ส่วนลดยังไม่เปิดใช้ใน Phase นี้ (คอลัมน์เป็น 0 เสมอ) แต่คิดรวมไว้แล้ว
       เพื่อให้วันที่เปิดใช้ ไม่ต้องมาไล่แก้สูตรที่กระจายอยู่หลายที่ */
    $total = round2(max(0, $sub - $discount));

    $paid = round2($q->get(
        'SELECT COALESCE(SUM(amount), 0) AS s FROM pos_payments
          WHERE sale_id = ? AND cancelled_at IS NULL',
        $saleId
    )['s']);

    $balance = round2($total - $paid);

    /* จ่ายครบ = ไม่เหลือค้าง · ใบยอด 0 บาท (เช่นแถมล้วน) นับว่าจ่ายครบทันที
       ไม่ใช่ค้างอยู่ตลอดกาล */
    if ($balance <= 0.001) {
        $status = 'paid';
    } elseif ($paid > 0.001) {
        $status = 'partial';
    } else {
        $status = 'unpaid';
    }

    $q->run(
        'UPDATE pos_sales
            SET subtotal = ?, total_amount = ?, paid_amount = ?, balance_amount = ?,
                payment_status = ?
          WHERE id = ?',
        $sub, $total, $paid, max(0, $balance), $status, $saleId
    );

    return $q->get('SELECT * FROM pos_sales WHERE id = ?', $saleId);
}

/** ใบหนึ่งใบพร้อมรายการและประวัติการรับเงิน — รูปเดียวกันทุกที่ที่คืนใบ */
function posSaleFull(int $id): ?array
{
    $sale = Db::get(
        'SELECT s.*, a.display_name AS created_by_name, v.display_name AS void_by_name,
                c.first_name, c.mid_name, c.last_name
           FROM pos_sales s
           LEFT JOIN admins a    ON a.id = s.created_by
           LEFT JOIN admins v    ON v.id = s.void_by
           LEFT JOIN customers c ON c.id = s.customer_id
          WHERE s.id = ?',
        $id
    );
    if (!$sale) {
        return null;
    }
    $sale['items'] = Db::all(
        'SELECT * FROM pos_sale_items WHERE sale_id = ? ORDER BY sort_order, id',
        $id
    );
    $sale['payments'] = Db::all(
        'SELECT p.*, a.display_name AS created_by_name
           FROM pos_payments p
           LEFT JOIN admins a ON a.id = p.created_by
          WHERE p.sale_id = ? ORDER BY p.paid_at, p.id',
        $id
    );
    return $sale;
}


/* ---------------------------------------------------------------------------
   รายการสินค้าหน้าร้าน
   --------------------------------------------------------------------------- */

/** นิยามช่องกรอกเพิ่มของรายการหนึ่ง (ค่าสายตา / สี / รหัสแว่น) — เก็บเป็น JSON */
function posFieldsOf(array $item): array
{
    $f = json_decode((string) ($item['pos_fields'] ?? ''), true);
    return is_array($f) ? $f : [];
}

/**
 * สินค้าทั้งหมดที่หน้าร้านขายได้ เรียงตามใบที่ร้านให้มา
 *
 * อ่านจาก `pos_items` (migration 033) ซึ่งเป็นของหน้าร้านล้วน ไม่ใช่ `products`
 * ของคลัง · เดิมรายการนี้อยู่ในหมวด `Pos*` ของ products แล้วการล้างข้อมูลคลัง
 * ลบทิ้งไปด้วยทั้ง 41 ตัว ขณะที่คลังก็นับของหน้าร้านเป็นของต่ำกว่าขั้นต่ำ ทั้งที่
 * ค่าประกอบแว่นไม่ใช่ของที่ต้องสั่ง — สองระบบจึงแยกตารางกัน
 *
 * คืนคีย์ชุดเดิมที่หน้าเว็บใช้ (ProductPicker / cart.js) หน้าเว็บจึงไม่ต้องแก้ ·
 * `category_*` คือกลุ่มของหน้าร้าน · `brand` / `product_type` ไม่มีในรายการนี้
 */
GET('/api/pos/products', function (array $req) {
    posRequireSeller(posActor());

    $where = ['is_active = 1'];
    $args  = [];
    if ($term = str_or($req['query']['q'] ?? null)) {
        $p = like($term);
        $where[] = '(name LIKE ? OR sku LIKE ?)';
        array_push($args, $p, $p);
    }
    $rows = Db::all(
        'SELECT id, sku, name, base_price, group_code, group_name, pos_fields, is_custom
           FROM pos_items
          WHERE ' . implode(' AND ', $where) . '
          ORDER BY sort_order, sku',
        ...$args
    );

    return array_map(static fn(array $r): array => [
        'id'                 => (int) $r['id'],
        'sku'                => $r['sku'],
        'name'               => $r['name'],
        'brand'              => null,
        'product_type'       => null,
        'base_selling_price' => $r['base_price'],
        'category_code'      => $r['group_code'],
        'category_name'      => $r['group_name'],
        'pos_fields'         => posFieldsOf($r),
        'pos_custom'         => (bool) $r['is_custom'],
    ], $rows);
});


/**
 * ของที่ POS ขายจากคลังแล้วตัดสต็อกจริง — ร้านตัดสินใจ 18 ก.ย. 2026
 *
 * แค่กรอบแว่นกับคอนแทคเลนส์ · แว่นกันแดด อุปกรณ์ น้ำยา บริการ ยังขายจาก
 * `pos_items` ไม่ตัดสต็อก (สเปก 2026-09-18-pos-sell-from-stock-design.md)
 */
const POS_STOCK_TYPES = ['Frame', 'ContactLen'];

/**
 * `source` ของการตัดจาก POS — ต้องไม่ใช่ `frontdesk` เพราะฝั่งคลังยอมให้
 * `frontdesk` ตัดติดลบได้ (งานเคสขายของก่อนรับเข้า) · หน้าร้านขายของที่อยู่บนชั้น
 * ของไม่พอต้องขายไม่ได้ และฝั่งคลังเป็นคนตัดสินตอนล็อกล็อตแล้ว ไม่ใช่เราเช็กเอง
 */
const POS_STOCK_SOURCE = 'pos';

/**
 * ช่องกรอกเพิ่มของสินค้าคลัง — คอนแทคเลนส์ถาม "ข้าง" นิยามเดียวกับ `PosCtl%`
 * ใน pos_items แต่ไม่ถามค่าสายตา เพราะในคลังแยกสินค้าตามค่าสายตาอยู่แล้ว
 */
function posStockFields(string $type): array
{
    return $type === 'ContactLen'
        ? [['key' => 'eye', 'label' => 'ข้าง', 'type' => 'choice', 'required' => true,
            'options' => [['R', 'ขวา (R)'], ['L', 'ซ้าย (L)'], ['RL', 'ทั้งสองข้าง']]]]
        : [];
}

/** ตรวจช่องกรอกเพิ่มของรายการหนึ่ง — ใช้ทั้งกับ pos_items และสินค้าคลัง */
function posCheckFields(array $fields, array $meta, int $n, string $name): void
{
    foreach ($fields as $f) {
        $key = str_or($f['key'] ?? null);
        if ($key !== '' && !empty($f['required']) && str_or($meta[$key] ?? null) === '') {
            bad("รายการที่ $n ($name): ต้องระบุ" . str_or($f['label'] ?? null, $key));
        }
        /* ช่องแบบตัวเลือก (เช่น "ข้าง" ของคอนแทคเลนส์) รับได้แค่ค่าที่อยู่ใน options
           หน้าเว็บวาดเป็นปุ่มอยู่แล้ว ด่านนี้กันการยิงตรงหรือหน้าเว็บรุ่นเก่า */
        $val = str_or($meta[$key] ?? null);
        if ($key !== '' && ($f['type'] ?? null) === 'choice' && $val !== ''
            && !in_array($val, array_map(fn($o) => (string) ($o[0] ?? ''), $f['options'] ?? []), true)) {
            bad("รายการที่ $n ($name): " . str_or($f['label'] ?? null, $key) . " ไม่ถูกต้อง");
        }
    }
}

/**
 * กรอบแว่น / คอนแทคเลนส์ในคลัง พร้อมคงเหลือ — อ่านอย่างเดียว
 *
 * ของหมดยังคืนมาด้วย (คงเหลือ 0) หน้าเว็บโชว์ว่า "หมด" แทนการหายไปเฉย ๆ ซึ่งทำให้
 * พนักงานคิดว่าพิมพ์ชื่อผิด · สินค้าสั่งตัดไม่มีของบนชั้น จึงไม่อยู่ในรายการ
 */
GET('/api/pos/stock-products', function (array $req) {
    posRequireSeller(posActor());
    $type = str_or($req['query']['type'] ?? null);
    if (!in_array($type, POS_STOCK_TYPES, true)) {
        bad('ประเภทสินค้าไม่ถูกต้อง');
    }

    $rows = Db::all(
        'SELECT p.id, p.sku, p.name, p.brand, p.product_type, p.base_selling_price, p.attributes,
                c.code AS category_code, c.name AS category_name,
                COALESCE((SELECT SUM(l.remaining_qty) FROM stock_lots l
                           WHERE l.product_id = p.id AND l.remaining_qty > 0), 0) AS on_hand
           FROM products p
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.product_type = ? AND p.is_custom_made = 0
          ORDER BY (on_hand > 0) DESC, p.brand, p.name',
        $type
    );

    return array_map(static function (array $r): array {
        $attrs = json_decode((string) ($r['attributes'] ?? ''), true);
        return [
            'id'                 => (int) $r['id'],
            'sku'                => $r['sku'],
            'name'               => $r['name'],
            'brand'              => $r['brand'],
            'product_type'       => $r['product_type'],
            'base_selling_price' => $r['base_selling_price'],
            'category_code'      => $r['category_code'],
            'category_name'      => $r['category_name'],
            'attributes'         => is_array($attrs) ? $attrs : [],
            'on_hand'            => (int) $r['on_hand'],
            'pos_fields'         => posStockFields((string) $r['product_type']),
            'pos_custom'         => false,
            'stock'              => true,
        ];
    }, $rows);
});


/* ---------------------------------------------------------------------------
   ประวัติการขาย
   --------------------------------------------------------------------------- */

GET('/api/pos/sales', function (array $req) {
    posRequireSeller(posActor());
    $q     = $req['query'];
    $where = [];
    $args  = [];

    if ($from = str_or($q['from'] ?? null)) {
        $where[] = 'DATE(s.sale_date) >= ?';
        $args[]  = $from;
    }
    if ($to = str_or($q['to'] ?? null)) {
        $where[] = 'DATE(s.sale_date) <= ?';
        $args[]  = $to;
    }
    if ($ps = str_or($q['payment_status'] ?? null)) {
        $where[] = 's.payment_status = ?';
        $args[]  = $ps;
    }
    if ($fs = str_or($q['fulfillment_status'] ?? null)) {
        $where[] = 's.fulfillment_status = ?';
        $args[]  = $fs;
    }
    if ($st = str_or($q['status'] ?? null)) {
        $where[] = 's.status = ?';
        $args[]  = $st;
    }
    if ($by = int_or($q['created_by'] ?? null)) {
        $where[] = 's.created_by = ?';
        $args[]  = $by;
    }
    /* กรองด้วยช่องทางชำระ = ใบที่ "เคยรับเงินด้วยวิธีนี้" ไม่ใช่ช่องทางเดียวของใบ
       เพราะใบหนึ่งรับได้หลายงวดหลายวิธี */
    if ($method = str_or($q['method'] ?? null)) {
        $where[] = 'EXISTS (SELECT 1 FROM pos_payments pm
                             WHERE pm.sale_id = s.id AND pm.cancelled_at IS NULL
                               AND pm.payment_method = ?)';
        $args[]  = $method;
    }
    if ($term = str_or($q['q'] ?? null)) {
        $p = like($term);
        $where[] = '(s.pos_no LIKE ? OR s.customer_name_snapshot LIKE ?
                     OR s.customer_phone_snapshot LIKE ?
                     OR EXISTS (SELECT 1 FROM pos_sale_items pi
                                 WHERE pi.sale_id = s.id AND pi.product_name_snapshot LIKE ?))';
        array_push($args, $p, $p, $p, $p);
    }

    $args[] = min(int_or($q['limit'] ?? null, 200), 2000);

    return Db::all(
        'SELECT s.*, a.display_name AS created_by_name,
                (SELECT COUNT(*) FROM pos_sale_items pi WHERE pi.sale_id = s.id) AS item_count,
                (SELECT COALESCE(SUM(pi.quantity), 0) FROM pos_sale_items pi WHERE pi.sale_id = s.id) AS unit_count
           FROM pos_sales s
           LEFT JOIN admins a ON a.id = s.created_by'
         . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
         . ' ORDER BY s.sale_date DESC, s.id DESC LIMIT ?',
        ...$args
    );
});

GET('/api/pos/sales/:id', function (array $req) {
    posRequireSeller(posActor());
    $sale = posSaleFull(int_or($req['params']['id']) ?? 0);
    if (!$sale) {
        missing();
    }
    return $sale;
});


/* ---------------------------------------------------------------------------
   บันทึกการขาย
   --------------------------------------------------------------------------- */

/**
 * ตรวจรายการขายหนึ่งแถวจากคำขอ แล้วคืนรูปที่พร้อมเขียนลงใบ — ใช้ทั้งตอนเปิดใบ
 * และตอนผู้ดูแลระบบเพิ่มแถวเข้าใบเดิม กฎจึงมีชุดเดียว · `$n` คือลำดับแถวที่โชว์ในข้อความ
 */
function posCleanItem(array $it, int $n): array
{
    $pid  = int_or($it['product_id'] ?? null);
    $spid = int_or($it['stock_product_id'] ?? null);
    $name = str_or($it['product_name'] ?? null);
    $qty  = int_or($it['quantity'] ?? null, 0) ?? 0;
    $price = num($it['unit_price'] ?? null);
    $meta = is_array($it['item_meta'] ?? null) ? $it['item_meta'] : [];

    /* ของจากคลัง (กรอบ / คอนแทคเลนส์) — ตัดสต็อกจริงตอนเขียนใบข้างล่าง */
    if ($spid !== null) {
        $sp = Db::get(
            'SELECT id, sku, name, product_type FROM products WHERE id = ? AND is_custom_made = 0',
            $spid
        );
        if (!$sp || !in_array($sp['product_type'], POS_STOCK_TYPES, true)) {
            bad("รายการที่ $n: ไม่พบสินค้ารหัส $spid ในคลัง (ขายได้เฉพาะกรอบแว่นกับคอนแทคเลนส์)");
        }
        $name = $name !== '' ? $name : (string) $sp['name'];
        if ($qty < 1) {
            bad("รายการที่ $n ($name): จำนวนต้องอย่างน้อย 1");
        }
        if ($price < 0) {
            bad("รายการที่ $n ($name): ราคาติดลบไม่ได้");
        }
        posCheckFields(posStockFields((string) $sp['product_type']), $meta, $n, $name);
        return [
            'pos_item_id'      => null,
            'stock_product_id' => (int) $sp['id'],
            'name'             => $name,
            'sku'              => (string) $sp['sku'],
            'qty'              => $qty,
            'price'            => round2($price),
            'line'             => round2($qty * $price),
            'meta_arr'         => $meta,
        ];
    }

    $item = null;
    if ($pid !== null) {
        /* `product_id` ในคำขอคือ id ของ pos_items ตั้งแต่ migration 033 — คงชื่อคีย์
           เดิมไว้ หน้าเว็บ (cart.js) จึงไม่ต้องแก้ · id ของสินค้าในคลังที่ไคลเอนต์เก่า
           จำไว้ต้องไม่ผ่าน และรายการที่เลิกขายแล้วก็ไม่ผ่าน */
        $item = Db::get(
            'SELECT id, sku, name, pos_fields, is_custom
               FROM pos_items WHERE id = ? AND is_active = 1',
            $pid
        );
        if (!$item) {
            bad("รายการที่ $n: ไม่พบสินค้ารหัส $pid ในรายการของหน้าร้าน");
        }
    }

    /* สินค้า Custom ("อื่นๆ") ต้องมีชื่อที่พิมพ์เอง — ชื่อในรายการคือ
       "อื่นๆ (พิมพ์เอง)" ซึ่งพิมพ์ลงใบเสร็จแล้วลูกค้าอ่านไม่รู้เรื่อง */
    if ($item === null || $item['is_custom']) {
        $typed = str_or($it['custom_name'] ?? null) ?: $name;
        if ($typed === '') {
            bad("รายการที่ $n: สินค้าพิมพ์เองต้องระบุชื่อสินค้า");
        }
        $name = $typed;
    } elseif ($name === '') {
        $name = (string) $item['name'];
    }

    if ($qty < 1) {
        bad("รายการที่ $n ($name): จำนวนต้องอย่างน้อย 1");
    }
    if ($price < 0) {
        bad("รายการที่ $n ($name): ราคาติดลบไม่ได้");
    }

    /* ช่องกรอกเพิ่มที่สินค้าตัวนั้นบังคับ ต้องมีค่ามาจริง */
    posCheckFields($item ? posFieldsOf($item) : [], $meta, $n, $name);

    return [
        'pos_item_id'      => $item ? (int) $item['id'] : null,
        'stock_product_id' => null,
        'name'             => $name,
        'sku'              => $item ? (string) $item['sku'] : null,
        'qty'              => $qty,
        'price'            => round2($price),
        'line'             => round2($qty * $price),
        'meta_arr'         => $meta,
    ];
}

/**
 * ทั้งใบอยู่ใน transaction เดียว — ใบขายที่มีแต่หัวไม่มีรายการ หรือมีรายการแต่
 * เงินไม่เข้า คือสิ่งที่ต้องไม่มีทางเกิด
 */
POST('/api/pos/sales', function (array $req) {
    $actor = posActor();
    posRequireSeller($actor);
    $body  = $req['body'];

    /* กดซ้ำ / เน็ตหลุดแล้วกดใหม่ — คืนใบเดิม ไม่สร้างใบที่สอง
       เช็คนอก transaction ก่อนเพื่อตอบเร็ว และมี UNIQUE บนคอลัมน์กันอีกชั้น */
    $ref = nul($body['client_ref'] ?? null);
    if ($ref !== null) {
        $dup = Db::get('SELECT id FROM pos_sales WHERE client_ref = ?', $ref);
        if ($dup) {
            return posSaleFull((int) $dup['id']);
        }
    }

    $items = $body['items'] ?? null;
    if (!is_array($items) || $items === []) {
        bad('ต้องมีสินค้าอย่างน้อย 1 รายการ');
    }

    /* ตรวจรายการให้ครบก่อนแตะฐาน — ล้มกลางทางแล้ว rollback ก็ถูกต้องอยู่ดี
       แต่การตอบว่าผิดตรงไหนตั้งแต่ยังไม่เขียนอะไร อ่านง่ายกว่าสำหรับคนหน้าร้าน */
    $clean = [];
    foreach ($items as $i => $it) {
        $clean[] = posCleanItem(is_array($it) ? $it : [], $i + 1);
    }

    /* มีของจากคลังแต่ตัดของจริงไม่ได้ (โหมดคลังปิด / ทดลอง) — ไม่รับบิล ดีกว่าออกบิล
       ที่บอกลูกค้าว่าขายแล้วแต่ยอดในคลังยังนับของชิ้นนั้นอยู่ */
    if (array_filter(array_column($clean, 'stock_product_id')) !== []
        && ($why = StockClient::unavailableReason()) !== null) {
        bad('ขายของจากคลังไม่ได้ตอนนี้ — ' . $why);
    }

    $total = round2(array_sum(array_column($clean, 'line')));

    /* งวดแรก (ถ้ารับเงินเลย) — ยอด 0 แปลว่าเปิดใบไว้ก่อนยังไม่รับเงิน */
    $payAmount   = round2(num($body['payment']['amount'] ?? null));
    $payMethod   = str_or($body['payment']['method'] ?? null, 'cash') ?: 'cash';
    $payReceived = isset($body['payment']['amount_received'])
        ? round2(num($body['payment']['amount_received'])) : null;

    if ($payAmount < 0) {
        bad('ยอดชำระติดลบไม่ได้');
    }
    if ($payAmount > $total + 0.001) {
        bad('ยอดชำระเกินยอดขาย');
    }
    if ($payAmount > 0 && !in_array($payMethod, POS_METHODS, true)) {
        bad('ช่องทางชำระเงินไม่ถูกต้อง');
    }
    /* เงินสด: รับมาต้องไม่น้อยกว่าที่จ่าย ไม่งั้นเงินทอนติดลบ ซึ่งแปลว่ายอดผิด
       ไม่ใช่แปลว่าลูกค้าต้องจ่ายเพิ่ม */
    if ($payAmount > 0 && $payMethod === 'cash' && $payReceived !== null
        && $payReceived < $payAmount - 0.001) {
        bad('เงินที่รับมาน้อยกว่ายอดที่ต้องชำระ');
    }

    $delivered = boolInt($body['delivered'] ?? null) === 1;

    /* ค้างเงิน หรือของยังไม่ออกจากร้าน = ต้องตามลูกค้าได้ทีหลัง
       ชื่อหรือเบอร์อย่างใดอย่างหนึ่งก็พอ — บังคับทั้งคู่คือการไล่ลูกค้ากลับ */
    $custName  = nul($body['customer_name'] ?? null);
    $custPhone = nul($body['customer_phone'] ?? null);
    if (($payAmount < $total - 0.001 || !$delivered)
        && $custName === null && $custPhone === null) {
        bad('มัดจำหรือยังไม่ส่งมอบ ต้องระบุชื่อหรือเบอร์โทรลูกค้าอย่างน้อยหนึ่งอย่าง');
    }

    $customerId = int_or($body['customer_id'] ?? null);
    if ($customerId !== null && !Db::get('SELECT id FROM customers WHERE id = ?', $customerId)) {
        bad('ไม่พบลูกค้ารายนี้');
    }

    /* วันที่ขาย: พนักงานขายล็อกเป็นวันนี้ ตั้งแต่แอดมินขึ้นไปแก้ย้อนหลังได้
       (ยอดขายย้อนหลังเปลี่ยนตัวเลขปิดยอดของวันที่ปิดไปแล้ว) */
    $stamp = nowStamp();
    if (($d = nul($body['sale_date'] ?? null)) !== null && posIsAdminUp($actor)) {
        $stamp = strlen($d) <= 10 ? $d . ' ' . date('H:i:s') : $d;
    }

    $id = Db::tx(function (Tx $q) use (
        $clean, $total, $payAmount, $payMethod, $payReceived, $delivered,
        $custName, $custPhone, $customerId, $stamp, $actor, $body, $ref
    ) {
        $posNo = nextCode('POS', 'pos_sales', 'pos_no');

        /* ตัดสต็อกก่อนเขียนอะไรของใบ — ในนามคนที่กด ผ่านฝั่งคลัง (FIFO + ล็อกล็อต +
           ต้นทุน + สมุด) · PDO ตัวเดียวกัน transaction ของคลังจึงซ้อนอยู่ใน transaction
           นี้ ตัดไม่ผ่านรายการเดียว ทั้งใบ rollback · และเพราะตัดก่อน ต่อให้ถูกเรียกซ้อน
           ใน transaction ที่ใหญ่กว่า ของที่ไม่พอก็ไม่ทิ้งหัวใบค้างไว้
           คีย์กันตัดซ้ำคงที่ต่อใบ+แถว ห้ามสุ่ม (เหตุผลเดียวกับ CaseStock) */
        $metas = [];
        foreach ($clean as $n => $c) {
            $meta = $c['meta_arr'];
            if ($c['stock_product_id'] !== null) {
                $idem = posStockKey('pos-' . ($ref ?? $posNo) . '-' . ($n + 1) . '-' . $c['sku']);
                $meta = posIssue($c, $idem, $posNo, $n + 1) + $meta;
            }
            $metas[$n] = $meta;
        }

        $r = $q->run(
            'INSERT INTO pos_sales (pos_no, client_ref, sale_date, customer_id,
               customer_name_snapshot, customer_phone_snapshot,
               subtotal, discount_amount, total_amount,
               fulfillment_status, delivered_at, note, created_by)
             VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?)',
            $posNo,
            $ref,
            $stamp,
            $customerId,
            $custName,
            $custPhone,
            $total,
            $total,
            $delivered ? 'delivered' : 'waiting',
            $delivered ? $stamp : null,
            nul($body['note'] ?? null),
            int_or($actor['id'] ?? null)
        );
        $saleId = (int) $r['insertId'];

        /* ไม่ออกเลขใบเสร็จ BillP ตรงนี้แล้ว (ตั้งแต่ 13 ต.ค. 2026) — เลขเกิดเมื่อกด
           "ออกใบเสร็จ" เท่านั้น ดู routes/receipts.php */

        foreach ($clean as $n => $c) {
            $q->run(
                'INSERT INTO pos_sale_items (sale_id, product_id, pos_item_id, product_name_snapshot,
                   sku_snapshot, quantity, unit_price, line_total, item_meta, sort_order)
                 VALUES (?,?,?,?,?,?,?,?,?,?)',
                $saleId, $c['stock_product_id'], $c['pos_item_id'], $c['name'], $c['sku'],
                $c['qty'], $c['price'], $c['line'],
                $metas[$n] === [] ? null : json_encode($metas[$n], JSON_UNESCAPED_UNICODE), $n
            );
        }

        if ($payAmount > 0) {
            $q->run(
                'INSERT INTO pos_payments (sale_id, payment_method, amount,
                   amount_received, change_amount, paid_at, created_by, note)
                 VALUES (?,?,?,?,?,?,?,?)',
                $saleId, $payMethod, $payAmount,
                $payReceived,
                $payReceived !== null ? round2(max(0, $payReceived - $payAmount)) : null,
                $stamp, int_or($actor['id'] ?? null),
                nul($body['payment']['note'] ?? null)
            );
        }

        posRecalc($q, $saleId);
        return $saleId;
    });

    return posSaleFull($id);
});


/* ---------------------------------------------------------------------------
   รับชำระเพิ่ม · ส่งมอบ · ยกเลิก
   --------------------------------------------------------------------------- */

/** เก็บยอดค้าง — แถวใหม่เสมอ ไม่แตะงวดเดิม */
POST('/api/pos/sales/:id/payments', function (array $req) {
    $actor = posActor();
    posRequireSeller($actor);
    $id   = int_or($req['params']['id']) ?? 0;
    $body = $req['body'];

    $sale = Db::get('SELECT * FROM pos_sales WHERE id = ?', $id);
    if (!$sale) {
        missing();
    }
    if ($sale['status'] === 'void') {
        bad('ใบขายนี้ถูกยกเลิกแล้ว');
    }

    $amount   = round2(num($body['amount'] ?? null));
    $method   = str_or($body['method'] ?? null, 'cash') ?: 'cash';
    $received = isset($body['amount_received']) ? round2(num($body['amount_received'])) : null;

    if ($amount <= 0) {
        bad('ยอดชำระต้องมากกว่า 0');
    }
    if (!in_array($method, POS_METHODS, true)) {
        bad('ช่องทางชำระเงินไม่ถูกต้อง');
    }
    if ($amount > round2($sale['balance_amount']) + 0.001) {
        bad('ยอดชำระเกินยอดค้าง');
    }
    if ($method === 'cash' && $received !== null && $received < $amount - 0.001) {
        bad('เงินที่รับมาน้อยกว่ายอดที่ต้องชำระ');
    }

    Db::tx(function (Tx $q) use ($id, $amount, $method, $received, $actor, $body) {
        $q->run(
            'INSERT INTO pos_payments (sale_id, payment_method, amount,
               amount_received, change_amount, paid_at, created_by, note)
             VALUES (?,?,?,?,?,?,?,?)',
            $id, $method, $amount, $received,
            $received !== null ? round2(max(0, $received - $amount)) : null,
            nowStamp(), int_or($actor['id'] ?? null), nul($body['note'] ?? null)
        );
        posRecalc($q, $id);
    });

    return posSaleFull($id);
});

/**
 * แก้งวดเงินที่บันทึกผิด — วันเวลารับ จำนวนเงิน ช่องทาง (ร้านขอ 29 ก.ย. 2026)
 *
 * ข้อยกเว้นเดียวของกฎข้อ 2 ในหัวไฟล์ · เกิดจากบิลที่ลูกค้าจ่ายวันหนึ่งแต่พนักงานมา
 * กดรับเงินอีกวัน (POS-2026-00033) รายงานการรับเงินจึงนับผิดวัน · ด่านเดียวกับ
 * แก้รายการรับเงินของเคส (PUT /api/payments/:id): แอดมินขึ้นไป · บังคับเหตุผล ·
 * งวดที่ยกเลิกแล้วแก้ไม่ได้ · ยอดรวมทุกงวดเกินยอดสุทธิไม่ได้ · ห้ามวันในอนาคต ·
 * ค่าก่อน → หลังกับเหตุผลลง activity_log (หน้า "บันทึกการใช้งาน")
 */
PUT('/api/pos/sales/:id/payments/:pid', function (array $req) {
    $actor = posActor();
    if (!posIsAdminUp($actor)) {
        throw new HttpError(403, 'แก้ไขการรับเงินได้เฉพาะแอดมินหรือเจ้าของร้าน', ['reason' => 'forbidden']);
    }
    $id   = int_or($req['params']['id']) ?? 0;
    $pid  = int_or($req['params']['pid']) ?? 0;
    $body = $req['body'];

    $reason = trim((string) ($body['reason'] ?? ''));
    if ($reason === '') {
        bad('กรุณาใส่เหตุผลที่แก้ไข');
    }
    if (!is_numeric(trim((string) ($body['amount'] ?? '')))) {
        bad('กรุณาใส่จำนวนเงิน');
    }
    $amount = round2(num($body['amount']));
    if ($amount <= 0) {
        bad('จำนวนเงินต้องมากกว่า 0');
    }
    $method = str_or($body['method'] ?? null);
    if (!in_array($method, POS_METHODS, true)) {
        bad('ช่องทางชำระเงินไม่ถูกต้อง');
    }
    $paidAt = str_or($body['paid_at'] ?? null);
    if (!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/', $paidAt)
        || !DateTime::createFromFormat('Y-m-d H:i', substr($paidAt, 0, 16))) {
        bad('วันเวลาที่รับเงินไม่ถูกต้อง');
    }
    if (strlen($paidAt) === 16) {
        $paidAt .= ':00';
    }
    /* เผื่อนาฬิกาเครื่องหน้าร้านเร็วกว่าเซิร์ฟเวอร์นิดหน่อย — เกินห้านาทีคือพิมพ์ผิดแน่ */
    if ($paidAt > nowStamp(new DateTime('+5 minutes'))) {
        bad('วันเวลาที่รับเงินต้องไม่เป็นเวลาในอนาคต');
    }

    Db::tx(function (Tx $q) use ($id, $pid, $amount, $method, $paidAt, $reason, $actor) {
        $sale = $q->get('SELECT * FROM pos_sales WHERE id = ? FOR UPDATE', $id);
        if (!$sale) {
            missing();
        }
        if ($sale['status'] === 'void') {
            bad('ใบขายนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้');
        }
        $p = $q->get('SELECT * FROM pos_payments WHERE id = ? AND sale_id = ? FOR UPDATE', $pid, $id);
        if (!$p) {
            missing();
        }
        if ($p['cancelled_at']) {
            bad('รายการนี้ถูกยกเลิกไปแล้ว แก้ไขไม่ได้');
        }

        /* ยอดคงเหลือไม่นับงวดนี้ — แก้ 300 เป็น 400 บนใบที่ค้าง 100 ขยับได้อีก 100 */
        $others = round2($q->get(
            'SELECT COALESCE(SUM(amount), 0) s FROM pos_payments
              WHERE sale_id = ? AND cancelled_at IS NULL AND id <> ?',
            $id, $pid
        )['s']);
        $max = round2(max(0, (float) $sale['total_amount'] - $others));
        if ($amount > $max + 0.001) {
            throw new HttpError(
                400,
                'แก้เกินยอดของใบไม่ได้ — รายการนี้แก้ได้ไม่เกิน ' . number_format($max, 2) . ' บาท',
                ['reason' => 'over_balance', 'balance' => $max]
            );
        }

        /* เงินทอนผูกกับเงินสด · เปลี่ยนเป็นโอน/บัตรแล้ว "รับมา/ทอน" ไม่มีความหมาย ·
           ยอดใหม่เกินเงินที่รับมา แปลว่าตัวเลขรับมาเดิมใช้ไม่ได้แล้ว ล้างทิ้ง */
        $received = $p['amount_received'] !== null ? round2($p['amount_received']) : null;
        if ($method !== 'cash' || ($received !== null && $received < $amount - 0.001)) {
            $received = null;
        }
        $change = $received !== null ? round2(max(0, $received - $amount)) : null;

        $before = [
            'amount'         => round2($p['amount']),
            'payment_method' => (string) $p['payment_method'],
            'paid_at'        => (string) $p['paid_at'],
        ];
        $after = ['amount' => $amount, 'payment_method' => $method, 'paid_at' => $paidAt];
        $changed = array_keys(array_filter(
            $before,
            fn($v, $k) => (string) $v !== (string) $after[$k],
            ARRAY_FILTER_USE_BOTH
        ));
        if (!$changed) {
            bad('ไม่มีอะไรเปลี่ยน');
        }

        $q->run(
            'UPDATE pos_payments
                SET amount = ?, payment_method = ?, paid_at = ?, amount_received = ?, change_amount = ?
              WHERE id = ?',
            $amount, $method, $paidAt, $received, $change, $pid
        );
        posRecalc($q, $id);

        ActivityLog::record(
            array_map(fn($k) => [
                'field'  => "pos_payments.$k",
                'before' => (string) $before[$k],
                'after'  => (string) $after[$k],
            ], $changed),
            [
                'pos_no'     => $sale['pos_no'],
                'payment_id' => $pid,
                'before'     => $before,
                'after'      => $after,
                'reason'     => $reason,
                'by'         => (string) ($actor['displayName'] ?? $actor['username'] ?? ''),
            ],
            'payment_edit'
        );
    });

    return posSaleFull($id);
});

/**
 * ส่งมอบ / ยกเลิกการส่งมอบ
 *
 * ไม่มีการตรวจยอดค้างตรงนี้โดยตั้งใจ — ปล่อยของทั้งที่ยังค้างเงินเป็นเรื่องปกติ
 * ของร้านนี้ ถ้าจะห้าม ต้องเป็นนโยบายที่เจ้าของสั่ง ไม่ใช่กฎที่โผล่มาจากโค้ด
 */
POST('/api/pos/sales/:id/deliver', function (array $req) {
    $actor = posActor();
    posRequireSeller($actor);
    $id = int_or($req['params']['id']) ?? 0;

    $sale = Db::get('SELECT * FROM pos_sales WHERE id = ?', $id);
    if (!$sale) {
        missing();
    }
    if ($sale['status'] === 'void') {
        bad('ใบขายนี้ถูกยกเลิกแล้ว');
    }

    $on = !array_key_exists('delivered', $req['body']) || boolInt($req['body']['delivered']) === 1;
    Db::run(
        'UPDATE pos_sales SET fulfillment_status = ?, delivered_at = ? WHERE id = ?',
        $on ? 'delivered' : 'waiting',
        $on ? nowStamp() : null,
        $id
    );
    return posSaleFull($id);
});

/**
 * ยกเลิกใบ — เปลี่ยนสถานะ ไม่ลบแถว
 *
 * ใบขายที่หายไปเฉย ๆ คือเงินที่อธิบายไม่ได้ตอนปิดยอด · รายการกับงวดเงินยังอยู่ครบ
 * เพื่อให้ตอบได้ว่ายกเลิกอะไรไป
 */
POST('/api/pos/sales/:id/void', function (array $req) {
    $actor = posActor();
    if (!posIsAdminUp($actor)) {
        bad('ยกเลิกใบขายได้เฉพาะแอดมินขึ้นไป');
    }
    $id     = int_or($req['params']['id']) ?? 0;
    $reason = str_or($req['body']['reason'] ?? null);
    if ($reason === '') {
        bad('ต้องระบุเหตุผลที่ยกเลิก');
    }

    $sale = Db::get('SELECT * FROM pos_sales WHERE id = ?', $id);
    if (!$sale) {
        missing();
    }
    if ($sale['status'] === 'void') {
        bad('ใบขายนี้ถูกยกเลิกไปแล้ว');
    }

    /* ของจากคลังกลับเข้าล็อตเดิม อ้างคีย์การตัดครั้งแรก · อยู่ใน transaction เดียวกับ
       การเปลี่ยนสถานะ — คืนไม่ผ่าน ใบก็ยังไม่ถูกยกเลิก ไม่มีใบ void ที่ของยังหายอยู่ */
    Db::tx(function (Tx $q) use ($id, $sale, $reason, $actor) {
        $rows = $q->all('SELECT id, item_meta FROM pos_sale_items WHERE sale_id = ?', $id);
        foreach ($rows as $row) {
            $meta = json_decode((string) ($row['item_meta'] ?? ''), true);
            $key  = is_array($meta) ? str_or($meta['stock_idem_key'] ?? null) : '';
            if ($key === '' || str_or($meta['stock_return_key'] ?? null) !== '') {
                continue;
            }
            $meta['stock_return_key'] = posReturn($key, "ยกเลิกบิล {$sale['pos_no']} — $reason", 'ยังไม่ได้ยกเลิกใบ');
            $q->run(
                'UPDATE pos_sale_items SET item_meta = ? WHERE id = ?',
                json_encode($meta, JSON_UNESCAPED_UNICODE),
                (int) $row['id']
            );
        }

        $q->run(
            'UPDATE pos_sales SET status = ?, void_reason = ?, void_by = ?, void_at = ? WHERE id = ?',
            'void', $reason, int_or($actor['id'] ?? null), nowStamp(), $id
        );
        voidReceiptIn($q, 'sale', $id, "ยกเลิกใบขาย {$sale['pos_no']} — $reason");
    });
    return posSaleFull($id);
});

/**
 * ตัดสต็อกของแถวหนึ่งในนามคนที่กด ผ่านฝั่งคลัง (FIFO + ล็อกล็อต + ต้นทุน + สมุด)
 * คืนคีย์ที่ต้องจำไว้ใน item_meta — คีย์นี้คือสิ่งที่การคืนของอ้างถึงทีหลัง
 */
function posIssue(array $c, string $idem, string $posNo, int $n): array
{
    try {
        $res = StockClient::post('/stock/issue', [
            'source'        => POS_STOCK_SOURCE,
            'idem_key'      => $idem,
            'sku'           => $c['sku'],
            'quantity'      => $c['qty'],
            'reference_doc' => $posNo,
            'note'          => "ขายหน้าร้าน $posNo",
        ]);
    } catch (StockApiError $e) {
        bad("รายการที่ $n ({$c['name']}): " . $e->getMessage());
    }
    return [
        'stock_idem_key' => $idem,
        'stock_lots'     => array_values(array_filter(array_map(
            static fn($cut) => is_array($cut) ? int_or($cut['lot_id'] ?? null) : null,
            is_array($res['cuts'] ?? null) ? $res['cuts'] : []
        ))),
    ];
}

/** คืนของที่ตัดไปด้วยคีย์ `$key` กลับเข้าล็อตเดิมทั้งก้อน — คืนคีย์ของการคืน */
function posReturn(string $key, string $note, string $notDone): string
{
    $rev = posStockKey('rev-' . $key);
    try {
        StockClient::post('/stock/return', [
            'source'       => POS_STOCK_SOURCE,
            'idem_key'     => $rev,
            'reverses_key' => $key,
            'note'         => $note,
        ]);
    } catch (StockApiError $e) {
        bad("คืนของเข้าคลังไม่สำเร็จ $notDone — " . $e->getMessage());
    }
    return $rev;
}

/** ข้อความหนึ่งบรรทัดของแถวสินค้า สำหรับค่าก่อน → หลังในบันทึกการใช้งาน */
function posLineText(string $name, int $qty, float $price): string
{
    return "$name × $qty @ " . number_format($price, 2);
}

/**
 * แก้ใบขายที่บันทึกไปแล้ว — ผู้ดูแลระบบเท่านั้น (ร้านขอ 28 ต.ค. 2026)
 *
 * คำขอส่ง "รายการทั้งใบที่ต้องการ" มา ไม่ใช่ทีละแถว:
 *
 *   · แถวที่มี `id` = แถวเดิม แก้ชื่อ / จำนวน / ราคาต่อชิ้นได้ · สินค้าของแถวเปลี่ยน
 *     ไม่ได้ (เปลี่ยนสินค้า = ลบแถวแล้วเพิ่มแถวใหม่ สต็อกจึงเดินถูกตัว)
 *   · แถวเดิมที่ไม่อยู่ในคำขอ = ลบ · ของจากคลังคืนเข้าล็อตเดิม
 *   · แถวที่ไม่มี `id` = เพิ่มใหม่ ตรวจด้วยกฎเดียวกับตอนเปิดใบ ของจากคลังตัดสต็อกให้
 *   · ของจากคลังที่จำนวนเปลี่ยน คืนการตัดเดิมทั้งก้อนแล้วตัดจำนวนใหม่ — ฝั่งคลัง
 *     คืนได้แค่ทั้งรายการ (อ่านล็อตจากคำขอเดิม) ไม่มีคืนบางส่วน
 *   · `customer_name` / `customer_phone` / `note` แก้ได้ถ้าส่งมา
 *
 * ด่าน: ใบที่ยกเลิกแล้วแก้ไม่ได้ · บังคับเหตุผล · ยอดใหม่ต่ำกว่าเงินที่รับแล้วไม่ได้
 * (ให้ไปแก้งวดเงินก่อน ตัวเลขเงินกับใบจึงไม่ขัดกันเลยสักขณะ) · ทั้งหมดอยู่ใน
 * transaction เดียว ตัด/คืนสต็อกไม่ผ่านแถวเดียว ใบไม่เปลี่ยนเลย · ค่าก่อน → หลัง
 * กับเหตุผลลง activity_log
 */
PUT('/api/pos/sales/:id/items', function (array $req) {
    $actor = posActor();
    if (!\Optic\Roles::manageSystem($actor['roles'])) {
        throw new HttpError(403, 'แก้ไขรายการขายได้เฉพาะผู้ดูแลระบบ', ['reason' => 'forbidden']);
    }
    $id   = int_or($req['params']['id']) ?? 0;
    $body = $req['body'];

    $reason = trim((string) ($body['reason'] ?? ''));
    if ($reason === '') {
        bad('กรุณาใส่เหตุผลที่แก้ไข');
    }
    $items = $body['items'] ?? null;
    if (!is_array($items) || $items === []) {
        bad('ต้องมีสินค้าอย่างน้อย 1 รายการ');
    }
    /* คีย์ของการแก้ครั้งนี้ — หน้าเว็บสร้างใหม่ทุกครั้งที่เปิดหน้าต่าง กดบันทึกซ้ำจึงไม่ตัดสต็อกสองรอบ */
    $editRef = substr(preg_replace('/[^A-Za-z0-9-]/', '', (string) ($body['edit_ref'] ?? '')), 0, 40)
        ?: bin2hex(random_bytes(8));

    $sale = Db::get('SELECT * FROM pos_sales WHERE id = ?', $id);
    if (!$sale) {
        missing();
    }
    if ($sale['status'] === 'void') {
        bad('ใบขายนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้');
    }
    $old = array_column(
        Db::all('SELECT * FROM pos_sale_items WHERE sale_id = ? ORDER BY sort_order, id', $id),
        null,
        'id'
    );

    /* ตรวจทุกแถวให้ครบก่อนแตะฐาน — ตอบได้ว่าผิดแถวไหนตั้งแต่ยังไม่เขียนอะไร */
    $keep = [];   // id แถวเดิม => ค่าใหม่
    $add  = [];   // แถวใหม่ที่ผ่าน posCleanItem
    foreach ($items as $i => $it) {
        $n   = $i + 1;
        $it  = is_array($it) ? $it : [];
        $rid = int_or($it['id'] ?? null);
        if ($rid === null) {
            $add[] = posCleanItem($it, $n) + ['n' => $n];
            continue;
        }
        if (!isset($old[$rid])) {
            bad("รายการที่ $n: ไม่ใช่รายการของใบนี้");
        }
        if (isset($keep[$rid])) {
            bad("รายการที่ $n: ส่งแถวเดิมซ้ำ");
        }
        $name  = str_or($it['product_name'] ?? null) ?: (string) $old[$rid]['product_name_snapshot'];
        $qty   = int_or($it['quantity'] ?? null, 0) ?? 0;
        $price = num($it['unit_price'] ?? null);
        if ($qty < 1) {
            bad("รายการที่ $n ($name): จำนวนต้องอย่างน้อย 1");
        }
        if ($price < 0) {
            bad("รายการที่ $n ($name): ราคาติดลบไม่ได้");
        }
        $keep[$rid] = ['n' => $n, 'name' => $name, 'qty' => $qty, 'price' => round2($price)];
    }
    $drop    = array_diff_key($old, $keep);
    $changed = array_filter(
        $keep,
        static fn(array $k, int $rid): bool => $k['name'] !== (string) $old[$rid]['product_name_snapshot']
            || $k['qty'] !== (int) $old[$rid]['quantity']
            || abs($k['price'] - (float) $old[$rid]['unit_price']) > 0.001,
        ARRAY_FILTER_USE_BOTH
    );

    /* หัวใบ — แก้เฉพาะช่องที่ส่งมา */
    $head = [];
    foreach (['customer_name' => 'customer_name_snapshot', 'customer_phone' => 'customer_phone_snapshot', 'note' => 'note'] as $in => $col) {
        if (array_key_exists($in, $body) && nul($body[$in]) !== nul($sale[$col])) {
            $head[$col] = nul($body[$in]);
        }
    }

    if (!$changed && !$drop && !$add && !$head) {
        bad('ไม่มีอะไรเปลี่ยน');
    }

    $total = round2(
        array_sum(array_map(static fn(array $k) => $k['qty'] * $k['price'], $keep))
        + array_sum(array_column($add, 'line'))
    );
    $total = round2(max(0, $total - round2($sale['discount_amount'])));
    $paid  = round2($sale['paid_amount']);
    if ($total < $paid - 0.001) {
        throw new HttpError(
            400,
            'ยอดใหม่ ' . number_format($total, 2) . ' บาท ต่ำกว่าเงินที่รับแล้ว ' . number_format($paid, 2)
                . ' บาท — แก้ยอดในประวัติการรับเงินก่อน',
            ['reason' => 'below_paid', 'total' => $total, 'paid' => $paid]
        );
    }

    /* ใบที่ยังค้างเงินหรือของยังไม่ออกจากร้าน ต้องตามลูกค้าได้ — กฎเดียวกับตอนเปิดใบ */
    $custName  = array_key_exists('customer_name_snapshot', $head) ? $head['customer_name_snapshot'] : nul($sale['customer_name_snapshot']);
    $custPhone = array_key_exists('customer_phone_snapshot', $head) ? $head['customer_phone_snapshot'] : nul($sale['customer_phone_snapshot']);
    if (($total > $paid + 0.001 || $sale['fulfillment_status'] !== 'delivered')
        && $custName === null && $custPhone === null) {
        bad('ใบที่ยังค้างเงินหรือยังไม่ส่งมอบ ต้องมีชื่อหรือเบอร์โทรลูกค้าอย่างน้อยหนึ่งอย่าง');
    }

    $restock = static fn(array $row, ?int $qty = null): bool => $row['product_id'] !== null
        && ($qty === null || $qty !== (int) $row['quantity']);
    $touchStock = array_filter(array_column($add, 'stock_product_id'))
        || array_filter($drop, static fn(array $row) => $restock($row))
        || array_filter($changed, static fn(array $k, int $rid) => $restock($old[$rid], $k['qty']), ARRAY_FILTER_USE_BOTH);
    if ($touchStock && ($why = StockClient::unavailableReason()) !== null) {
        bad('ปรับสต็อกไม่ได้ตอนนี้ — ' . $why);
    }

    $posNo = (string) $sale['pos_no'];
    $note  = "แก้ไขบิล $posNo — $reason";

    Db::tx(function (Tx $q) use ($id, $sale, $old, $drop, $add, $changed, $head, $posNo, $note, $editRef, $restock, $reason, $actor) {
        $q->get('SELECT id FROM pos_sales WHERE id = ? FOR UPDATE', $id);
        $log = [];

        foreach ($drop as $rid => $row) {
            $meta = json_decode((string) ($row['item_meta'] ?? ''), true);
            $key  = is_array($meta) ? str_or($meta['stock_idem_key'] ?? null) : '';
            if ($key !== '' && str_or($meta['stock_return_key'] ?? null) === '') {
                posReturn($key, $note, 'ยังไม่ได้แก้ใบ');
            }
            $q->run('DELETE FROM pos_sale_items WHERE id = ?', $rid);
            $log[] = [
                'field'  => "pos_sale_items.$rid",
                'before' => posLineText($row['product_name_snapshot'], (int) $row['quantity'], (float) $row['unit_price']),
                'after'  => '(ลบ)',
            ];
        }

        foreach ($changed as $rid => $k) {
            $row  = $old[$rid];
            $meta = json_decode((string) ($row['item_meta'] ?? ''), true);
            $meta = is_array($meta) ? $meta : [];
            $key  = str_or($meta['stock_idem_key'] ?? null);
            if ($key !== '' && $restock($row, $k['qty'])) {
                posReturn($key, $note, 'ยังไม่ได้แก้ใบ');
                $meta = posIssue(
                    ['sku' => (string) $row['sku_snapshot'], 'qty' => $k['qty'], 'name' => $k['name']],
                    posStockKey("pos-edit-$editRef-$rid-{$row['sku_snapshot']}"),
                    $posNo,
                    $k['n']
                ) + $meta;
            }
            $q->run(
                'UPDATE pos_sale_items
                    SET product_name_snapshot = ?, quantity = ?, unit_price = ?, line_total = ?, item_meta = ?
                  WHERE id = ?',
                $k['name'], $k['qty'], $k['price'], round2($k['qty'] * $k['price']),
                $meta === [] ? null : json_encode($meta, JSON_UNESCAPED_UNICODE),
                $rid
            );
            $log[] = [
                'field'  => "pos_sale_items.$rid",
                'before' => posLineText($row['product_name_snapshot'], (int) $row['quantity'], (float) $row['unit_price']),
                'after'  => posLineText($k['name'], $k['qty'], $k['price']),
            ];
        }

        $sort = (int) $q->get(
            'SELECT COALESCE(MAX(sort_order), -1) AS m FROM pos_sale_items WHERE sale_id = ?',
            $id
        )['m'];
        foreach ($add as $c) {
            $meta = $c['meta_arr'];
            if ($c['stock_product_id'] !== null) {
                $idem = posStockKey("pos-edit-$editRef-new{$c['n']}-{$c['sku']}");
                $meta = posIssue($c, $idem, $posNo, $c['n']) + $meta;
            }
            $q->run(
                'INSERT INTO pos_sale_items (sale_id, product_id, pos_item_id, product_name_snapshot,
                   sku_snapshot, quantity, unit_price, line_total, item_meta, sort_order)
                 VALUES (?,?,?,?,?,?,?,?,?,?)',
                $id, $c['stock_product_id'], $c['pos_item_id'], $c['name'], $c['sku'],
                $c['qty'], $c['price'], $c['line'],
                $meta === [] ? null : json_encode($meta, JSON_UNESCAPED_UNICODE), ++$sort
            );
            $log[] = [
                'field'  => 'pos_sale_items.new',
                'before' => '',
                'after'  => posLineText($c['name'], $c['qty'], $c['price']),
            ];
        }

        foreach ($head as $col => $val) {
            $q->run("UPDATE pos_sales SET $col = ? WHERE id = ?", $val, $id);
            $log[] = ['field' => "pos_sales.$col", 'before' => (string) $sale[$col], 'after' => (string) $val];
        }

        $after = posRecalc($q, $id);
        if (round2($after['total_amount']) !== round2($sale['total_amount'])) {
            $log[] = [
                'field'  => 'pos_sales.total_amount',
                'before' => (string) $sale['total_amount'],
                'after'  => (string) $after['total_amount'],
            ];
        }

        ActivityLog::record($log, [
            'pos_no' => $posNo,
            'reason' => $reason,
            'by'     => (string) ($actor['displayName'] ?? $actor['username'] ?? ''),
        ], 'item_edit');
    });

    return posSaleFull($id);
});

/** `idem_key` ยาวได้ไม่เกิน 120 — ตัดตรงกลางด้วย hash ไม่ใช่ตัดหางทิ้ง (แบบเดียวกับ CaseStock) */
function posStockKey(string $s): string
{
    return strlen($s) <= 120 ? $s : substr($s, 0, 80) . '-' . substr(sha1($s), 0, 39);
}
