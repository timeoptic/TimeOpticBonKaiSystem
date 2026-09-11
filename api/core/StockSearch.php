<?php
/**
 * ช่องค้นหาสินค้าของหน้าขาย — แปลคำที่คนพิมพ์เป็นเงื่อนไข WHERE.
 *
 * คนขายไม่ได้พิมพ์ชื่อสินค้า เขาพิมพ์วิธีที่ร้านเรียกของ: "MC 1.6" "blue 1.6"
 * "ray-ban black" — คำสองสามคำที่อยู่คนละคอลัมน์กัน ก่อนหน้านี้ทั้งก้อนถูกส่งไป
 * `LIKE '%MC 1.6%'` ทีเดียว ซึ่งได้ศูนย์แถวเสมอ เพราะชื่อจริงในฐานคือ
 * "Hitop Autograph MC Single Vision (1.60)" — "MC" กับ "1.60" ห่างกันหกคำ
 *
 * กฎที่ใช้: **ตัดเป็นคำ ๆ ต้องเจอครบทุกคำ (AND) แต่ละคำเจอที่คอลัมน์ไหนก็ได้ (OR)**
 *
 * ทดสอบที่ `api/tests/10-stock-search.test.php`
 */
declare(strict_types=1);

/**
 * คอลัมน์ที่คำหนึ่งคำมีสิทธิ์ไปเจอ — ทั้งหมดมาจาก `v_stock_lot`
 *
 * coating / lens_design / model / color เป็นของใหม่ในชุดนี้ เดิมค้นแต่ชื่อ ยี่ห้อ
 * ผู้ขาย และ SKU · ทั้งสี่ตัวอยู่ในวิวอยู่แล้ว (แตกมาจาก products.attributes)
 * แค่ไม่เคยถูกค้น
 */
const STOCK_SEARCH_COLUMNS = [
    's.product_name', 's.brand', 's.brand_name', 's.vendor_name', 's.sku',
    's.coating', 's.lens_design', 's.model', 's.color',
];

/**
 * คำเรียกเดียวกันที่คนกรอกเขียนไม่เหมือนกัน — พิมพ์ทางไหนก็เจอทั้งวง
 *
 * ในฐานตอนนี้มีทั้ง coating="MC" และ coating="MultiCoat" ซึ่งคือของอย่างเดียวกัน
 * คนละคนกรอกคนละครั้ง · **เติมวงใหม่ที่นี่** เวลาร้านเริ่มใช้คำเรียกใหม่
 */
const STOCK_SEARCH_SYNONYMS = [
    ['mc', 'multicoat'],
];

/** พิมพ์ยาวเกินนี้ไม่ได้ช่วยให้เจอ มีแต่ทำให้ SQL ยาวขึ้น */
const STOCK_SEARCH_MAX_TOKENS = 6;

/**
 * เงื่อนไขค้นหาสำหรับคำที่พิมพ์มาทั้งช่อง
 *
 * @return array{0:string,1:list<mixed>} [เงื่อนไข WHERE บนตารางนามแฝง s, ค่าที่ผูก]
 *                                       คืนสตริงว่างเมื่อไม่มีอะไรให้กรอง
 */
function stockSearch(string $term): array
{
    $term = trim($term);
    if ($term === '') {
        return ['', []];
    }

    $tokens = array_slice(preg_split('/\s+/', $term) ?: [], 0, STOCK_SEARCH_MAX_TOKENS);

    $groups = [];
    $args   = [];
    foreach ($tokens as $tok) {
        [$sql, $a] = stockSearchToken($tok);
        $groups[]  = $sql;
        $args      = [...$args, ...$a];
    }
    $where = '(' . implode(' AND ', $groups) . ')';

    /* เลขที่โชว์ท้ายบรรทัดในหน้าขาย (#65341) — พิมพ์เลขนั้นแล้วต้องได้แถวนั้น
       ตรง ๆ ไม่ใช่ทุกแถวที่มีเลขนี้อยู่ในชื่อ จึงเทียบเท่ากันทั้งก้อน ไม่ตัดคำ */
    if (ctype_digit($term)) {
        $where  = "($where OR CAST(s.id AS CHAR) = ?)";
        $args[] = $term;
    }

    return [$where, $args];
}

/** เงื่อนไขของคำเดียว — คำนี้ต้องเจอที่ไหนสักที่ */
function stockSearchToken(string $tok): array
{
    /* ตัวเลขทศนิยมคือค่าเลนส์ ไม่ใช่ข้อความที่บังเอิญมีตัวเลข — "1.6" ต้องได้ 1.60
       และต้อง **ไม่ได้** 1.67 ซึ่งเป็นเลนส์คนละตัวราคาคนละชั้น · LIKE '%1.6%'
       ให้ทั้งสองอย่าง จึงต้องเทียบเป็นตัวเลขกับ lens_index แทน */
    if (preg_match('/^\d+\.\d+$/', $tok)) {
        $parts = ['CAST(s.lens_index AS DECIMAL(4,2)) = CAST(? AS DECIMAL(4,2))'];
        $args  = [$tok];
        /* ตัวเลขที่เขียนอยู่ในชื่อสินค้าเอง เช่นค่าสายตาใน "... -0.25/-0.25" ซึ่ง
           ไม่ใช่ index และไม่มีคอลัมน์ของตัวเอง */
        $pat = stockSearchNumberPattern($tok);
        foreach (STOCK_SEARCH_COLUMNS as $c) {
            $parts[] = "$c REGEXP ?";
            $args[]  = $pat;
        }
        return ['(' . implode(' OR ', $parts) . ')', $args];
    }

    $parts = [];
    $args  = [];
    foreach (stockSearchWords($tok) as $w) {
        $p = like($w);
        foreach (STOCK_SEARCH_COLUMNS as $c) {
            $parts[] = "$c LIKE ?";
            $args[]  = $p;
        }
    }
    return ['(' . implode(' OR ', $parts) . ')', $args];
}

/**
 * ตัวเลขนี้แบบเต็มจำนวน ไม่ใช่เป็นส่วนหัวของเลขที่ยาวกว่า
 *
 * ใช้ REGEXP ไม่ใช่ LIKE เพราะต้องการขอบของตัวเลข — "1.6" ไม่ควรไปโดน "1.67"
 * ส่วน "(1.60)" ในชื่อสินค้าปล่อยให้ lens_index เป็นคนจับ ไม่ใช่ข้อความในชื่อ
 */
function stockSearchNumberPattern(string $tok): string
{
    return '(^|[^0-9.])' . str_replace('.', '[.]', $tok) . '($|[^0-9])';
}

/** คำนี้บวกคำพ้องของมัน */
function stockSearchWords(string $tok): array
{
    $low = mb_strtolower($tok);
    foreach (STOCK_SEARCH_SYNONYMS as $ring) {
        if (in_array($low, $ring, true)) {
            return $ring;
        }
    }
    return [$tok];
}

/**
 * สินค้าที่ยังไม่เคยรับของเข้าเลย (ไม่มีล็อตสักใบ) ในรูปเดียวกับแถวของ `v_stock_lot`
 *
 * `v_stock_lot` เริ่มที่ล็อต สินค้าที่มีแต่ชื่อในแคตตาล็อกจึงไม่เคยโผล่ในช่องค้นหาของ
 * หน้าขาย ทั้งที่ขายหน้าร้านตัดติดลบได้ · แถวจากที่นี่ `id` เป็น null — ยังไม่มีล็อต
 * ให้ออเดอร์ชี้ หน้าเว็บต้องขอให้ฝั่งคลังเปิดล็อตค้างส่งก่อน (POST /api/stock/backorder-lot)
 *
 * สินค้าสั่งตัดไม่อยู่ในนี้ — ไม่มีสต็อกตามนิยาม เลือกผ่านปุ่มสั่งตัด RX
 * คอลัมน์ตั้งชื่อตาม `v_stock_lot` ทุกตัว คำค้นจาก stockSearch() จึงใช้ได้ตรง ๆ
 *
 * ทดสอบที่ `api/tests/11-stock-no-lot-search.test.php`
 */
function stockProductsWithoutLots(string $term, ?string $type, int $limit = 300): array
{
    $attr = static fn(string $k) => "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes, '$.$k')), 'null')";
    $inner = 'SELECT NULL AS id, p.id AS product_id, p.product_type, p.name AS product_name,
                     p.brand, p.brand AS brand_name, p.sku,
                     ' . $attr('model') . ' AS model, ' . $attr('color') . ' AS color, ' . $attr('size') . ' AS size,
                     ' . $attr('lens_design') . ' AS lens_design, ' . $attr('lens_index') . ' AS lens_index,
                     ' . $attr('coating') . ' AS coating, ' . $attr('tint') . ' AS tint,
                     ' . $attr('addons') . ' AS addons, ' . $attr('product_line') . ' AS product_line,
                     ' . $attr('vendor_name') . ' AS vendor_name,
                     p.base_selling_price AS product_price, NULL AS product_expense, NULL AS supplier_id,
                     NULL AS stock_date, NULL AS notes, 0 AS initial_qty, 0 AS remaining_qty, 0 AS sold
                FROM products p
               WHERE p.is_custom_made = 0
                 AND NOT EXISTS (SELECT 1 FROM stock_lots l WHERE l.product_id = p.id)';

    $where = [];
    $args  = [];
    [$search, $searchArgs] = stockSearch($term);
    if ($search !== '') {
        $where[] = $search;
        $args    = [...$args, ...$searchArgs];
    }
    if ($type !== null && $type !== '') {
        $where[] = 's.product_type = ?';
        $args[]  = $type;
    }
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $args[]   = max(1, min($limit, 2000));

    return Db::all("SELECT s.* FROM ($inner) s $sqlWhere ORDER BY s.product_name LIMIT ?", ...$args);
}
