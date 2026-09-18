<?php
/**
 * คลังสินค้า — ฝั่งหน้าร้าน.
 *
 * ของจริงอยู่ใน `products` (ระดับ SKU) กับ `stock_lots` (ล็อตที่รับเข้าแต่ละครั้ง
 * มี initial_qty/remaining_qty) และ `inventory_logs` (สมุดการเคลื่อนไหว)
 *
 * **อ่านทำที่นี่ได้ เขียนไม่ได้** — ทุกเส้นที่เขียนส่งต่อให้บริการฝั่งคลังใน
 * `stock/api/src/Service/` ทั้งหมด เพราะการเขียนหนึ่งครั้งไม่ใช่ SQL หนึ่งประโยค:
 * รับของเข้าต้องออกเลขล็อต ลงสมุดคู่กัน และเคารพกฎว่า remaining_qty ของล็อตต้อง
 * เท่ากับผลรวม inventory_logs ของล็อตนั้นเสมอ เขียนเองจะได้ยอดที่ถูกแต่สมุดที่
 * กระทบยอดไม่ได้ แล้วรู้ตัวตอนปิดเดือน
 *
 * ก่อนหน้านี้ไฟล์นี้เขียนสามตารางนั้นเองจริง ๆ และพังไปแล้วสามแบบ:
 *   · ลบล็อตทั้งที่มีแถวในสมุดชี้อยู่ — FK เป็น RESTRICT จึงขึ้น error 1451
 *   · แก้ล็อตแล้วเขียน `attributes` ทับทั้งก้อนจากรายชื่อช่องที่ไม่มีค่าสายตา
 *     ทำให้ sph/cyl/axis/add ของเลนส์หายทุกครั้งที่กดบันทึก
 *   · ลด `initial_qty` ซึ่งคือจำนวนที่รับเข้ามาจริง ย้อนหลังไม่ได้ตามนิยาม
 *
 * path กับรูปร่างคำตอบยังเหมือนเดิมทุกอย่าง หน้าเว็บไม่ต้องแก้
 * expandLots() (Helpers.php) ยังแตกล็อตกลับเป็นรายชิ้นให้หน้าคลังเหมือนเดิม
 */
declare(strict_types=1);

const STOCK_ATTR_FIELDS = ['model', 'color', 'size', 'lens_design', 'lens_index',
    'coating', 'tint', 'addons', 'product_line', 'vendor_name'];

/**
 * รายละเอียดสินค้าที่ฟอร์มนี้ส่งมา ทับลงบนของเดิม
 *
 * ทับเฉพาะช่องที่ส่งมาจริง ๆ — ฝั่งคลังเก็บค่าสายตา (sph/cyl/axis/add) ไว้ในก้อน
 * เดียวกัน ฟอร์มนี้ไม่มีช่องพวกนั้น ถ้าประกอบก้อนใหม่จากรายชื่อข้างบน ค่าสายตา
 * ของเลนส์จะหายทุกครั้งที่มีคนมาแก้สีกรอบ
 */
function stockAttrs(array $b, array $current = []): array
{
    $out = $current;
    foreach (STOCK_ATTR_FIELDS as $f) {
        if (array_key_exists($f, $b)) {
            $out[$f] = nul($b[$f] ?? null);
        }
    }
    return $out;
}

/** คนที่ล็อกอินอยู่ ในรูปที่บริการฝั่งคลังรับ — [roles, id] */
function stockActor(): array
{
    $a = StockModule::actor();
    if ($a === null) {
        throw new HttpError(401, 'ต้องเข้าสู่ระบบก่อน');
    }
    return [$a['roles'], (int) $a['id']];
}

/**
 * ตัวเลขเงินที่ยังไม่ได้กรอก ต้องเป็น null ไม่ใช่ 0
 *
 * `num()` คืน 0.0 เมื่อช่องว่าง ซึ่งใช้ไม่ได้กับสองเรื่องนี้:
 *   · ต้นทุนที่ยังไม่มา ฝั่งคลังเก็บเป็น null แปลว่า "รอใบกำกับจากผู้ขาย"
 *     ถ้าส่ง 0 ไป จะกลายเป็นของที่ได้มาฟรี แล้วกำไรทั้งเดือนจะพองขึ้นเงียบ ๆ
 *   · และเพราะ 0 เป็นตัวเลข ฝั่งคลังจะถือว่ามีการกรอกต้นทุน ซึ่งเป็นสิทธิ์คนละใบ
 *     พนักงานหน้าร้านจะรับของไม่ได้เลย ทั้งที่ไม่ได้ตั้งใจกรอกอะไร
 *
 * คืนเป็นข้อความ เพราะฝั่งคลังตรวจรูปแบบทศนิยมด้วย regex ไม่ได้แปลงเป็น float ก่อน
 */
function stockMoney(mixed $v): ?string
{
    $s = str_or($v);
    return ($s === '' || !is_numeric($s)) ? null : $s;
}

/** ฝั่งคลังรับ category_id ไม่ใช่ชื่อชนิดสินค้า */
function stockCategoryId(string $type): int
{
    $cat = Db::get('SELECT id FROM categories WHERE code = ?', $type);
    if (!$cat) {
        bad("ไม่รู้จักประเภทสินค้า: $type");
    }
    return (int) $cat['id'];
}

/**
 * ล็อตที่คำค้นนี้เจอ พร้อมที่วางของกับชื่อผู้ขาย
 *
 * คำค้นถูกตัดเป็นคำ ๆ แล้วต้องเจอครบทุกคำ — คนขายพิมพ์ "MC 1.6" ไม่ได้พิมพ์
 * ชื่อสินค้า · $any = ตรงคำใดคำหนึ่งก็พอ · กฎทั้งหมดกับเหตุผลอยู่ที่ core/StockSearch.php
 * $lens = ตัวกรองเลนส์ Coating/SPH/CYL จาก stockLensFilter() — AND กับคำค้นเสมอ
 */
function stockLotRows(string $term, string $type, bool $any = false, array $lens = ['', []]): array
{
    $where = [];
    $args  = [];
    [$search, $searchArgs] = stockSearch($term, $any);
    if ($search !== '') {
        $where[] = $search;
        $args    = [...$args, ...$searchArgs];
    }
    if ($type !== '') {
        $where[] = 's.product_type = ?';
        $args[]  = $type;
    }
    if ($lens[0] !== '') {
        $where[] = $lens[0];
        $args    = [...$args, ...$lens[1]];
    }
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    return Db::all(
        "SELECT s.*, l.location, sup.name AS supplier_name
           FROM v_stock_lot s
           LEFT JOIN product_locations l ON l.product_name = s.product_name
           LEFT JOIN suppliers sup       ON sup.id = s.supplier_id
           $sqlWhere
          ORDER BY s.id DESC",
        ...$args
    );
}

/**
 * group=product: the product named ONCE, with everything left across all of
 * its batches. Picking one returns the oldest batch that still has stock
 * (FIFO), which is the lot the shop should be selling anyway — staff should
 * not have to choose between two identical lines to do that.
 *
 * ของหมดแล้วก็ยังต้องเลือกได้
 *
 * เดิมข้ามล็อตที่ยอดไม่เป็นบวก สินค้าที่ขายหมดจึงหายไปจากรายการทั้งตัว
 * คนขายที่ลูกค้าสั่งเลนส์รุ่นเดิมซ้ำจึงหาไม่เจอ แล้วต้องสร้างสินค้าใหม่
 * ชื่อซ้ำกับของเดิม · ตอนนี้ขายเกินของที่มีได้ (ยอดติดลบเป็นค้างส่ง)
 * รายการจึงต้องแสดงต่อ พร้อมยอดจริงซึ่งอาจเป็นศูนย์หรือติดลบ
 *
 * ล็อตค้างส่ง (`SHORT-`) นับรวมในยอด แต่ไม่ถูกเลือกเป็นตัวแทน — มันไม่ใช่
 * กล่องที่หยิบได้ · ตัวแทนคือล็อตเก่าสุดที่ยังมีของ ถ้าไม่มีเลยก็ใช้ล็อต
 * จริงใบใดใบหนึ่ง เพื่อให้ออเดอร์มีอะไรให้ชี้
 *
 * สินค้าที่ยังไม่เคยรับของเข้าสักล็อตต่อท้าย ต้องเลือกได้เหมือนของที่ขายหมด — แถวพวกนี้
 * id เป็น null หน้าเว็บขอเปิดล็อตค้างส่งก่อน (POST /api/stock/backorder-lot)
 * ที่วางของของแถวพวกนี้ยังไม่เติม — stockFillLocations() เติมหลังตัดเหลือแถวที่จะส่งจริง
 */
function stockProductRows(array $lots, string $term, string $type, int $noLotLimit, bool $any, array $lens = ['', []]): array
{
    $byProduct = [];
    foreach ($lots as $l) {
        $left = (int) $l['remaining_qty'];
        $isShort = str_starts_with((string) ($l['lot_number'] ?? ''), 'SHORT-');
        $key = $l['product_id'] ?? ('name:' . $l['product_name']);

        if (!isset($byProduct[$key])) {
            if ($isShort) {
                continue; // รอเจอล็อตจริงก่อน ค่อยเอายอดค้างไปรวม
            }
            $byProduct[$key] = $l + ['lot_count' => 0, 'sold' => 0];
            $byProduct[$key]['remaining_qty'] = 0;
            $byProduct[$key]['pick_id'] = null;
        }

        $byProduct[$key]['remaining_qty'] += $left;
        if ($isShort) {
            continue;
        }
        if ($left > 0) {
            $byProduct[$key]['lot_count'] += 1;
            /* oldest lot still holding stock wins — smaller id = received earlier */
            if ($byProduct[$key]['pick_id'] === null || (int) $l['id'] < (int) $byProduct[$key]['pick_id']) {
                $byProduct[$key]['pick_id'] = $l['id'];
            }
        }
        /* ไม่มีล็อตไหนเหลือของเลย — ชี้ไปที่ล็อตจริงใบล่าสุดไว้ก่อน */
        if ($byProduct[$key]['pick_id'] === null) {
            $byProduct[$key]['id'] = $l['id'];
        }
    }
    foreach ($byProduct as &$row) {
        if ($row['pick_id'] !== null) {
            $row['id'] = $row['pick_id'];
        }
        unset($row['pick_id']);
    }
    unset($row);
    $rows = array_values($byProduct);

    foreach (stockProductsWithoutLots($term, $type ?: null, $noLotLimit, $any, $lens) as $p) {
        $rows[] = $p + ['location' => null, 'supplier_name' => null, 'lot_count' => 0];
    }
    return $rows;
}

/**
 * ที่วางของของสินค้าที่ยังไม่มีล็อต — ถามทีเดียวเฉพาะแถวที่จะส่งกลับจริง
 *
 * เดิมถามทีละชื่อก่อนตัดแถว ซึ่งพอต้องดึงทั้งกองมาจัดอันดับ (หลายพันแถว) จะกลาย
 * เป็นหลายพันคำถามต่อการพิมพ์หนึ่งครั้ง
 */
function stockFillLocations(array $rows): array
{
    $names = array_values(array_unique(array_map(
        fn($r) => (string) $r['product_name'],
        array_filter($rows, fn($r) => $r['id'] === null)
    )));
    if ($names === []) {
        return $rows;
    }
    $found = array_column(
        Db::all(
            'SELECT product_name, location FROM product_locations WHERE product_name IN ('
                . implode(',', array_fill(0, count($names), '?')) . ')',
            ...$names
        ),
        'location',
        'product_name'
    );
    foreach ($rows as &$r) {
        if ($r['id'] === null) {
            $r['location'] = $found[(string) $r['product_name']] ?? null;
        }
    }
    unset($r);
    return $rows;
}

GET('/api/stock', function (array $req) {
    $q    = $req['query'];
    $term = str_or($q['q'] ?? null);
    $type = str_or($q['type'] ?? null);

    /* ตัวกรองเลนส์ Coating/SPH/CYL — ตรงทุกค่าที่กรอก AND กับคำค้น · กติกาอยู่ที่ stockLensFilter() */
    $lens = stockLensFilter($q);
    $lots = stockLotRows($term, $type, false, $lens);

    $sold = str_or($q['sold'] ?? null);

    $group = str_or($q['group'] ?? null);

    /* group=lot keeps one row per receiving batch, for when the batch matters.
       group=product — ดู stockProductRows() */
    if ($group === 'product') {
        $limit = min(int_or($q['limit'] ?? null, 300), 2000);

        if ($term === '') {
            $rows = stockProductRows($lots, '', $type, $limit, false, $lens);
            usort($rows, fn($a, $b) => strcmp((string) $a['product_name'], (string) $b['product_name']));
            return stockFillLocations(array_slice($rows, 0, $limit));
        }

        /* มีคำค้น: ดึงทุกตัวที่ตรงมาจัดอันดับก่อน แล้วค่อยตัดเหลือ $limit — ตัดก่อน
           เรียงคือที่มาของ "G Blue 1.5" ได้ G Auto-Blue ทั้งจอ (ดู STOCK_SEARCH_RANK_POOL) */
        $rows = stockProductRows($lots, $term, $type, STOCK_SEARCH_RANK_POOL, false, $lens);

        /* ไม่มีตัวไหนตรงครบทุกคำ — ถอยไปโชว์ตัวที่ตรงบางคำ ดีกว่ากล่อง "ไม่พบข้อมูล"
           ที่ทำให้คนขายไปกดสร้างสินค้าซ้ำ · มีคำเดียวไม่ต้องถอย ผลก็เหมือนเดิม
           ตัวที่ตรงครบยังชนะเสมอ — "G Auto Blue" ที่มี Auto อยู่จะไม่เห็นตัวที่ไม่มี Auto
           มีตัวกรองเลนส์อยู่ไม่ถอย — พนักงานต้องการของที่ตรงทุกเงื่อนไข ไม่ใช่ตรงบางคำ */
        if ($rows === [] && $lens[0] === '' && count(stockSearchTokens($term)) > 1) {
            $rows = stockProductRows(stockLotRows($term, $type, true), $term, $type, STOCK_SEARCH_RANK_POOL, true);
        }

        return stockFillLocations(array_slice(stockSearchRank($rows, $term), 0, $limit));
    }

    /* group=lot: one row per received batch, carrying how many are left.
       The default (per-unit) shape is what the stock screen still expects — a
       lot of 7 as 7 lines. */
    if ($group === 'lot') {
        $rows = array_values(array_filter($lots, function ($l) use ($sold) {
            $left = (int) $l['remaining_qty'];
            if ($sold === '0') {
                return $left > 0;
            }
            if ($sold === '1') {
                return $left <= 0;
            }
            return true;
        }));
        foreach ($rows as &$r) {
            $r['sold'] = (int) $r['remaining_qty'] > 0 ? 0 : 1;
        }
        unset($r);
        return array_slice($rows, 0, min(int_or($q['limit'] ?? null, 300), 2000));
    }

    $rows = expandLots($lots);
    if ($sold === '0' || $sold === '1') {
        $target = (int) $sold;
        $rows = array_values(array_filter($rows, fn($r) => $r['sold'] === $target));
    }
    return array_slice($rows, 0, min(int_or($q['limit'] ?? null, 300), 2000));
});

/**
 * เลือกสินค้าที่ยังไม่เคยรับของเข้าในหน้าขาย — ขอให้ฝั่งคลังเปิดล็อตค้างส่ง (ยอดศูนย์)
 * แล้วตอบเป็นแถวรูปเดียวกับ GET /api/stock?group=product ให้หน้าเว็บใช้ต่อได้เลย
 * ออเดอร์จึงมี id ของล็อตให้ชี้ ตอนยืนยันการขายยอดติดลบลงบนล็อตใบนี้
 */
POST('/api/stock/backorder-lot', function (array $req) {
    $sku = str_or($req['body']['sku'] ?? null);
    if ($sku === '') {
        bad('ต้องระบุ SKU ของสินค้า');
    }
    $r   = StockClient::post('/stock/backorder-lot', ['sku' => $sku]);
    $row = Db::get('SELECT s.* FROM v_stock_lot s WHERE s.id = ?', (int) $r['lot_id']);
    if (!$row) {
        missing();
    }
    $left = Db::get(
        'SELECT COALESCE(SUM(remaining_qty), 0) n FROM stock_lots WHERE product_id = ?',
        (int) $row['product_id']
    );
    $row['remaining_qty'] = (int) ($left['n'] ?? 0);
    $row['lot_count']     = 0;
    $row['supplier_name'] = null;
    $row['location']      = Db::get(
        'SELECT location FROM product_locations WHERE product_name = ?',
        $row['product_name']
    )['location'] ?? null;
    return $row;
});

/**
 * ชิป Index / ชนิดเลนส์ / Coating และช่วง SPH / CYL ของ LensPicker พร้อมจำนวน
 *
 * นับจากแถวชุดเดียวกับที่ GET /api/stock?group=product&type=Lens จะโชว์ (ตรงคำค้น
 * ก่อนกรองเลนส์) แล้วกรองต่อใน stockLensFacets() ด้วยกติกาเดียวกับ SQL ·
 * ชิปจึงไม่มีทางบอกว่ามีของ แล้วกดไปเจอรายการว่าง
 */
GET('/api/stock/lens-options', function (array $req) {
    $q    = $req['query'];
    $term = str_or($q['q'] ?? null);
    stockLensWant($q); // ค่าสายตาพิมพ์ผิด = 400 ตั้งแต่ตรงนี้ เหมือน GET /api/stock

    $rows = stockProductRows(stockLotRows($term, 'Lens'), $term, 'Lens', STOCK_SEARCH_RANK_POOL, false);
    /* ถอยไปตรงบางคำพร้อมกับรายการ ไม่งั้นชิปหายทั้งแถวเหนือรายการที่มีเลนส์ */
    if ($rows === [] && count(stockSearchTokens($term)) > 1) {
        $rows = stockProductRows(stockLotRows($term, 'Lens', true), $term, 'Lens', STOCK_SEARCH_RANK_POOL, true);
    }
    $ids  = array_values(array_unique(array_filter(array_map(
        static fn(array $r) => $r['product_id'] ?? null,
        $rows,
    ))));
    if ($ids === []) {
        return stockLensFacets([], $q);
    }

    $attr = static fn(string $k) => "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(attributes, '$.$k')), 'null')";
    $products = Db::all(
        'SELECT ' . $attr('lens_index') . ' AS lens_index, ' . $attr('lens_design') . ' AS lens_design,
                ' . $attr('coating') . ' AS coating, ' . $attr('sph') . ' AS sph, ' . $attr('cyl') . ' AS cyl
           FROM products WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')',
        ...$ids
    );
    return stockLensFacets($products, $q);
});

GET('/api/stock/names', function (array $req) {
    $type = str_or($req['query']['type'] ?? null);
    $filter = $type !== '' ? 'WHERE p.product_type = ?' : '';
    $args   = $type !== '' ? [$type] : [];
    return Db::all(
        "SELECT p.name AS product_name, p.product_type, MAX(p.base_selling_price) product_price,
                COALESCE(SUM(sl.initial_qty),0) n
           FROM products p LEFT JOIN stock_lots sl ON sl.product_id = p.id
           $filter
          GROUP BY p.name, p.product_type ORDER BY p.name",
        ...$args
    );
});

/**
 * ล็อตหนึ่งใบ — แต่ "เหลือกี่ชิ้น" ตอบเป็นยอดของสินค้าทั้งตัว
 *
 * ออเดอร์เก็บ id ของล็อต หน้าจอจึงอ่านแถวนี้มาแสดงของที่เลือกไว้ · ถ้าตอบยอดของ
 * ล็อตนั้นตรง ๆ คนขายจะเห็น "เหลือ 2 ชิ้น" ทั้งที่สินค้าตัวนั้นมีอยู่ 14 ชิ้นใน
 * อีกล็อต แล้วไปบอกลูกค้าว่าของใกล้หมด · ตอนตัดจริงฝั่งคลังก็รับ SKU แล้วเลือก
 * ล็อตเองตาม FIFO ไม่ได้ตัดจากล็อตที่ออเดอร์ชี้อยู่ดี ตัวเลขที่ตรงกับสิ่งที่
 * ระบบจะทำจึงเป็นยอดรวมของ SKU ไม่ใช่ยอดของกล่องใดกล่องหนึ่ง
 *
 * `lot_remaining_qty` กับ `lot_count` ยังส่งไปด้วย สำหรับหน้าจอที่สนใจกล่อง
 */
GET('/api/stock/:id', function (array $req) {
    $s = Db::get(
        'SELECT s.*, l.location FROM v_stock_lot s
           LEFT JOIN product_locations l ON l.product_name = s.product_name
          WHERE s.id = ? LIMIT 1',
        int_or($req['params']['id'])
    );
    if (!$s) {
        missing();
    }

    $total = Db::get(
        'SELECT COALESCE(SUM(remaining_qty), 0) AS on_hand,
                SUM(CASE WHEN remaining_qty > 0 THEN 1 ELSE 0 END) AS lots
           FROM stock_lots WHERE product_id = ?',
        (int) $s['product_id']
    );

    $s['lot_remaining_qty'] = (int) $s['remaining_qty'];
    $s['remaining_qty']     = (int) ($total['on_hand'] ?? 0);
    $s['lot_count']         = (int) ($total['lots'] ?? 0);

    return $s;
});

/**
 * เปิดใบสั่งตัดเลนส์ (RX) จากหน้าร้าน
 *
 * เลนส์สั่งตัดไม่มีของบนชั้นให้เลือก — มันถูกสั่งทำเฉพาะราย ค่าสายตาอยู่บนใบสั่ง
 * ไม่ใช่บนตัวสินค้า · เดิมหน้าร้านเปิดใบสั่งเองไม่ได้เลย ต้องรอให้ระบบเปิดให้ตอน
 * ยืนยันการขาย ซึ่งช้ากว่าความจริงหนึ่งขั้น: คนที่วัดสายตาเสร็จรู้ค่าตั้งแต่ตอน
 * นั้นแล้ว และร้านอยากสั่งของทันที ไม่ใช่รอปิดการขายก่อน
 *
 * ตัวงานทั้งหมดเป็นของฝั่งคลัง (`Optic\Service\Rx`) ที่นี่แค่ส่งต่อ — สิทธิ์
 * ต้นทุน การออกเลขใบสั่ง และการสร้างรุ่นเลนส์ที่ยังไม่มีในแคตตาล็อก อยู่ที่นั่น
 * ที่เดียว ไม่มีสำเนากฎมาไว้ฝั่งนี้
 */
POST('/api/rx', function (array $req) {
    return StockClient::post('/rx', $req['body']);
});

POST('/api/stock', function (array $req) {
    $body = $req['body'];
    [$role, $actorId] = stockActor();

    /* 0 ได้ = ลงชื่อสินค้าไว้ก่อน ของยังไม่มา · ขายต่อได้เลย ยอดจะเป็นค้างส่ง */
    $amount = min(max(int_or($body['amount'] ?? null, 1) ?? 1, 0), 500);
    /* ฟอร์มส่งมาเป็น datetime ส่วนวันที่รับเข้าเป็นวัน ไม่ใช่เวลา */
    $date   = substr((string) (str_or($body['stock_date'] ?? null) ?: nowStamp()), 0, 10);

    /* SKU เดิม = ล็อตใหม่ของสินค้าตัวเดิม ไม่ใช่สินค้าตัวใหม่ */
    $sku      = trim((string) ($body['sku'] ?? ''));
    $existing = $sku !== '' ? Db::get('SELECT sku FROM products WHERE sku = ?', $sku) : null;

    if ($existing === null) {
        if (str_or($body['product_name'] ?? null) === '') {
            bad('กรุณากรอกชื่อสินค้า');
        }
        $type = str_or($body['product_type'] ?? null, 'Frame') ?: 'Frame';
        $made = \Optic\Service\Catalog::createProduct([
            'sku'                => $sku,
            'product_type'       => $type,
            'category_id'        => stockCategoryId($type),
            'name'               => str_or($body['product_name'] ?? null),
            'brand'              => nul($body['brand'] ?? null),
            'base_selling_price' => stockMoney($body['product_price'] ?? null) ?? '',
            'attributes'         => stockAttrs($body),
            'is_custom_made'     => false,
        ], $role);
        $sku = (string) $made['sku'];
    } else {
        $sku = (string) $existing['sku'];
    }

    $lot = \Optic\Service\Receiving::receive([
        'sku'           => $sku,
        'quantity'      => $amount,
        'cost_per_unit' => stockMoney($body['product_expense'] ?? null),
        'received_date' => $date,
        'supplier_id'   => int_or($body['supplier_id'] ?? null),
        'note'          => nul($body['notes'] ?? null),
    ], $role, $actorId);

    /* เดิมคืน id ทีละชิ้น ตอนนี้ทั้งล็อตใช้ id เดียว — StockForm.jsx แสดงผลได้อยู่ */
    return ['ok' => true, 'ids' => [$lot['lotId']], 'count' => $amount];
});

PUT('/api/stock/:id', function (array $req) {
    $id  = int_or($req['params']['id']);
    $lot = Db::get(
        'SELECT l.id, l.product_id, p.sku, p.attributes, p.is_custom_made
           FROM stock_lots l JOIN products p ON p.id = l.product_id WHERE l.id = ?',
        $id
    );
    if (!$lot) {
        missing();
    }
    $body = $req['body'];
    [$role, $actorId] = stockActor();

    $type    = str_or($body['product_type'] ?? null, 'Frame') ?: 'Frame';
    $current = json_decode((string) $lot['attributes'], true);

    \Optic\Service\Catalog::updateProduct((int) $lot['product_id'], [
        'sku'                => $lot['sku'],
        'product_type'       => $type,
        'category_id'        => stockCategoryId($type),
        'name'               => str_or($body['product_name'] ?? null),
        'brand'              => nul($body['brand'] ?? null),
        'base_selling_price' => stockMoney($body['product_price'] ?? null) ?? '',
        'attributes'         => stockAttrs($body, is_array($current) ? $current : []),
        'is_custom_made'     => (bool) $lot['is_custom_made'],
    ], $role);

    /* ต้นทุนกับผู้ขายอยู่ที่ล็อต ไม่ใช่ที่สินค้า และต้นทุนเป็นสิทธิ์คนละใบ —
       ฝั่งคลังเช็กให้เอง ที่นี่ส่งต่อเฉพาะช่องที่ฟอร์มส่งมาจริง */
    $patch = [];
    if (array_key_exists('product_expense', $body)) {
        $patch['cost_per_unit'] = stockMoney($body['product_expense']);
    }
    if (array_key_exists('supplier_id', $body)) {
        $patch['supplier_id'] = int_or($body['supplier_id']);
    }
    if (array_key_exists('notes', $body)) {
        $patch['note'] = nul($body['notes']);
    }
    if ($patch) {
        \Optic\Service\Catalog::updateLot($id, $patch, $role, $actorId);
    }

    return Db::get('SELECT s.* FROM v_stock_lot s WHERE s.id = ?', $id);
});

DELETE('/api/stock/:id', function (array $req) {
    $id  = int_or($req['params']['id']);
    $lot = Db::get('SELECT * FROM stock_lots WHERE id = ?', $id);
    if (!$lot) {
        missing();
    }
    if (!(int) $lot['remaining_qty']) {
        bad('ลบไม่ได้ — สินค้าล็อตนี้ขายหมดแล้ว');
    }
    [$role, $actorId] = stockActor();

    /* ล็อตที่ยังไม่มีใครแตะและมีชิ้นเดียว = คีย์ผิด ลบทิ้งได้ทั้งใบ
       ที่เหลือคือของหายไปหนึ่งชิ้นจากล็อตที่ยังมีของ = การปรับยอด ซึ่งต้องมีแถวใน
       สมุดกำกับ ไม่ใช่ลด remaining_qty เงียบ ๆ (และห้ามลด initial_qty เพราะนั่น
       คือจำนวนที่รับเข้ามาจริง) */
    if ((int) $lot['initial_qty'] <= 1 && (int) $lot['remaining_qty'] === (int) $lot['initial_qty']) {
        \Optic\Service\Catalog::deleteLot($id, $role);
        return ['ok' => true];
    }

    \Optic\Service\Catalog::updateLot(
        $id,
        ['remaining_qty' => (int) $lot['remaining_qty'] - 1],
        $role,
        $actorId
    );
    return ['ok' => true];
});
