<?php
/**
 * ช่องค้นหาสินค้าของหน้าขาย — แปลคำที่คนพิมพ์เป็นเงื่อนไข WHERE แล้วจัดอันดับผล
 *
 * คนขายไม่ได้พิมพ์ชื่อสินค้า เขาพิมพ์วิธีที่ร้านเรียกของ: "MC 1.6" "G Blue 1.5"
 * "ray-ban black" — คำสองสามคำที่อยู่คนละคอลัมน์กัน ก่อนหน้านี้ทั้งก้อนถูกส่งไป
 * `LIKE '%MC 1.6%'` ทีเดียว ซึ่งได้ศูนย์แถวเสมอ เพราะชื่อจริงในฐานคือ
 * "Hitop Autograph MC Single Vision (1.60)" — "MC" กับ "1.60" ห่างกันหกคำ
 *
 * กฎที่ใช้:
 *   · **กรอง** — ตัดเป็นคำ ๆ ต้องเจอครบทุกคำ (AND) แต่ละคำเจอที่คอลัมน์ไหนก็ได้ (OR)
 *     คำที่ไม่ได้พิมพ์ไม่ถูกบังคับ: "G Blue" ได้ทั้ง G Blue และ G Auto-Blue
 *     ส่วน "G Auto Blue" ต้องมี Auto เพราะคนพิมพ์มาเอง
 *   · **เรียง** (stockSearchRank) — ชื่อหรือ SKU ตรงเป๊ะ > ครบทุกคำแบบเต็มคำและเรียง
 *     ตามลำดับในชื่อ > ครบทุกคำแบบเต็มคำ > ครบทุกคำแต่บางคำเจอแค่บางส่วน > ตรงบางคำ
 *
 * ทดสอบที่ `api/tests/10-stock-search.test.php` กับ `12-stock-search-rank.test.php`
 */
declare(strict_types=1);

/**
 * คอลัมน์ที่คำหนึ่งคำมีสิทธิ์ไปเจอ — ทั้งหมดมาจาก `v_stock_lot`
 *
 * coating / lens_design / model / color เป็นของใหม่ในชุดนี้ เดิมค้นแต่ชื่อ ยี่ห้อ
 * ผู้ขาย และ SKU · ทั้งสี่ตัวอยู่ในวิวอยู่แล้ว (แตกมาจาก products.attributes)
 * แค่ไม่เคยถูกค้น · tint / addons / product_line คือคุณสมบัติเลนส์ที่ยังว่างทั้ง
 * แคตตาล็อก แต่ฟอร์มฝั่งคลังกรอกได้ วันที่เริ่มกรอกจะค้นเจอเลยไม่ต้องกลับมาแก้
 */
const STOCK_SEARCH_COLUMNS = [
    's.product_name', 's.brand', 's.brand_name', 's.vendor_name', 's.sku',
    's.coating', 's.lens_design', 's.model', 's.color',
    's.tint', 's.addons', 's.product_line',
];

/** คอลัมน์ที่นับว่า "เจอเต็มคำ" ได้ นอกจากชื่อสินค้ากับ SKU ซึ่งมีกติกาของตัวเอง */
const STOCK_SEARCH_RANK_FIELDS = [
    'brand', 'brand_name', 'vendor_name', 'coating', 'lens_design', 'lens_index',
    'model', 'color', 'tint', 'addons', 'product_line',
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

/** พิมพ์ยาวเกินนี้ไม่ได้ช่วยให้เจอ มีแต่ทำให้ SQL ยาวขึ้น — 8 พอให้วางชื่อเต็มพร้อมค่าสายตาคู่ */
const STOCK_SEARCH_MAX_TOKENS = 8;

/**
 * แถวสูงสุดที่ดึงมาจัดอันดับ ก่อนตัดเหลือเท่าที่หน้าเว็บขอ
 *
 * ต้องจัดอันดับก่อนตัด ไม่ใช่ตัดก่อน — เดิมเรียงตามชื่อแล้วตัดเหลือ 30 แถว คำค้น
 * "G Blue 1.5" จึงได้ G Auto-Blue ทั้งจอ ("Auto" มาก่อน "Blue") ส่วน G Blue 540 รุ่น
 * ที่ตรงที่สุดตกขอบหมด · เลนส์ทั้งแคตตาล็อกบนโฮสต์ตอนนี้ 3,386 รุ่น
 */
const STOCK_SEARCH_RANK_POOL = 5000;

/**
 * คำที่พิมพ์มา ตัดเป็นคำ ๆ
 *
 * ตัดที่ `/` ด้วย เพราะค่าสายตาเขียนคู่กันเป็น "-0.25/-0.50" ซึ่งคือสองค่า
 * วงเล็บรอบคำถูกลอกออก — คนก๊อป "(1.50)" มาจากชื่อสินค้าตรง ๆ
 * ขีดกลางไม่ถูกตัด: "LNS-0748" กับ "Auto-Blue" เป็นคำเดียว
 *
 * @return list<string>
 */
function stockSearchTokens(string $term): array
{
    $tokens = [];
    foreach (preg_split('~[\s/]+~u', trim($term)) ?: [] as $tok) {
        $tok = trim($tok, '()[]{},;');
        if ($tok !== '') {
            $tokens[] = $tok;
        }
    }
    return array_slice($tokens, 0, STOCK_SEARCH_MAX_TOKENS);
}

/**
 * เงื่อนไขค้นหาสำหรับคำที่พิมพ์มาทั้งช่อง
 *
 * $any = ตรงคำใดคำหนึ่งก็พอ — ใช้ตอนที่ไม่มีสินค้าตัวไหนตรงครบทุกคำเลย
 * (หน้าขายถอยไปโชว์ตัวที่ตรงบางคำแทนกล่องว่าง ดู GET /api/stock)
 *
 * @return array{0:string,1:list<mixed>} [เงื่อนไข WHERE บนตารางนามแฝง s, ค่าที่ผูก]
 *                                       คืนสตริงว่างเมื่อไม่มีอะไรให้กรอง
 */
function stockSearch(string $term, bool $any = false): array
{
    $tokens = stockSearchTokens($term);
    if ($tokens === []) {
        return ['', []];
    }

    $groups = [];
    $args   = [];
    foreach ($tokens as $tok) {
        [$sql, $a] = stockSearchToken($tok);
        $groups[]  = $sql;
        $args      = [...$args, ...$a];
    }
    $where = '(' . implode($any ? ' OR ' : ' AND ', $groups) . ')';

    /* เลขที่โชว์ท้ายบรรทัดในหน้าขาย (#65341) — พิมพ์เลขนั้นแล้วต้องได้แถวนั้น
       ตรง ๆ ไม่ใช่ทุกแถวที่มีเลขนี้อยู่ในชื่อ จึงเทียบเท่ากันทั้งก้อน ไม่ตัดคำ */
    $term = trim($term);
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
       ให้ทั้งสองอย่าง จึงต้องเทียบเป็นตัวเลข */
    $num = stockSearchNumber($tok);
    if ($num !== null) {
        $parts = [];
        $args  = [];
        /* index ไม่มีเครื่องหมาย — "-2.50" คือค่าสายตา ไม่ต้องไปเทียบ index
           lens_index ว่างต้องไม่ถูกแปลงเป็น 0.00 แล้วไปเท่ากับคำค้น "0.00" */
        if ($num['sign'] === '' && strlen($num['int']) <= 2) {
            $parts[] = "(s.lens_index <> '' AND CAST(s.lens_index AS DECIMAL(4,2)) = CAST(? AS DECIMAL(4,2)))";
            $args[]  = $tok;
        }
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
 * แยกเลขทศนิยมเป็นส่วน ๆ ที่เทียบกันได้ — "1.50" กับ "1.5" ได้ค่าเดียวกัน
 *
 * เฉพาะเลขที่มีจุดทศนิยม เลขล้วน ("0748" "2") ยังค้นแบบข้อความ เพราะเป็นส่วนของ
 * SKU หรือเลข id ได้พอ ๆ กับเป็นค่าเลนส์
 *
 * @return array{sign:string,int:string,frac:string}|null
 */
function stockSearchNumber(string $tok): ?array
{
    if (!preg_match('/^([+-]?)(\d+)\.(\d+)$/', $tok, $m)) {
        return null;
    }
    return ['sign' => $m[1], 'int' => ltrim($m[2], '0') ?: '0', 'frac' => rtrim($m[3], '0')];
}

/**
 * ตัวเลขนี้แบบเต็มจำนวน ไม่ใช่เป็นส่วนหัวของเลขที่ยาวกว่า
 *
 * ใช้ REGEXP ไม่ใช่ LIKE เพราะต้องการขอบของตัวเลข — "1.6" ไม่ควรไปโดน "1.67"
 * ศูนย์ท้ายทศนิยมเติมได้: "1.5" เจอ "1.50" · "2.00" เจอ "2" แต่ไม่เจอ "2.25"
 * เครื่องหมาย: ไม่พิมพ์ = เครื่องหมายไหนก็ได้ · พิมพ์ "-" ต้องเป็นลบ · "+" = บวกหรือไม่มี
 *
 * รูปแบบเดียวกันใช้ได้ทั้ง MySQL REGEXP และ preg_match ใน stockSearchRank()
 */
function stockSearchNumberPattern(string $tok): string
{
    $n = stockSearchNumber($tok);
    if ($n === null) {
        return '(^|[^0-9.])' . str_replace('.', '[.]', $tok) . '($|[^0-9])';
    }
    $head = match ($n['sign']) {
        '-'     => '(^|[^0-9.+-])-',
        '+'     => '(^|[^0-9.+-])[+]?',
        default => '(^|[^0-9.])[+-]?',
    };
    return $n['frac'] === ''
        ? $head . $n['int'] . '([.]0+)?($|[^0-9.])'
        : $head . $n['int'] . '[.]' . $n['frac'] . '0*($|[^0-9])';
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
 * เรียงผลค้นหาจากตัวที่ใกล้คำที่พิมพ์ที่สุด — ไม่กรองอะไรออก แค่เรียง
 *
 * ลำดับชั้น (ชั้นเดียวกันเรียงด้วยตัวถัดไป):
 *   0 SKU / ชื่อสินค้า / เลข id ตรงกับที่พิมพ์ทั้งช่อง
 *   1 ครบทุกคำแบบเต็มคำ และอยู่ในชื่อเรียงตามที่พิมพ์ — คำห่างกันน้อยขึ้นก่อน
 *     "G Blue 1.5": G Blue (ห่าง 2) มาก่อน G Auto-Blue (ห่าง 3)
 *   2 ครบทุกคำแบบเต็มคำ แต่บางคำเจอที่ช่องอื่น (coating, index …) หรือสลับลำดับ
 *   3 ครบทุกคำ แต่บางคำเจอแค่เป็นส่วนของคำอื่น — "G" ใน "Single"
 *   4 ตรงแค่บางคำ (มีเฉพาะตอนค้นแบบ $any) — ตรงหลายคำขึ้นก่อน
 * เท่ากันหมดแล้วเรียงชื่อแบบตัวเลขธรรมชาติ ค่าสายตาในรุ่นเดียวกันจึงเรียงต่อกัน
 *
 * @param list<array<string,mixed>> $rows แถวรูปเดียวกับ v_stock_lot
 */
function stockSearchRank(array $rows, string $term): array
{
    $tokens = stockSearchTokens($term);
    if ($tokens === []) {
        return $rows;
    }

    $keyed = [];
    foreach ($rows as $i => $row) {
        $keyed[] = ['key' => stockSearchScore($row, $term, $tokens), 'i' => $i, 'row' => $row];
    }
    usort($keyed, static fn(array $a, array $b): int => ($a['key'] <=> $b['key'])
        ?: strnatcasecmp((string) ($a['row']['product_name'] ?? ''), (string) ($b['row']['product_name'] ?? ''))
        ?: $a['i'] <=> $b['i']);

    return array_column($keyed, 'row');
}

/**
 * คะแนนของแถวเดียว ยิ่งน้อยยิ่งขึ้นก่อน
 *
 * @return list<int> [ชั้น, -คำที่เจอ, -คำที่เจอเต็มคำ, ช่องห่างระหว่างคำในชื่อ, ตำแหน่งคำแรกในชื่อ]
 */
function stockSearchScore(array $row, string $term, array $tokens): array
{
    $name   = stockSearchWordsOf((string) ($row['product_name'] ?? ''));
    $sku    = mb_strtolower((string) ($row['sku'] ?? ''));
    $fields = [];
    $hay    = [(string) ($row['product_name'] ?? ''), $sku];
    foreach (STOCK_SEARCH_RANK_FIELDS as $f) {
        $fields[] = stockSearchWordsOf((string) ($row[$f] ?? ''));
        $hay[]    = (string) ($row[$f] ?? '');
    }
    $hay = mb_strtolower(implode(' ', $hay));

    $term  = trim($term);
    $typed = stockSearchWordsOf($term);
    $exact = $sku === mb_strtolower($term)
        || ($typed !== [] && count($typed) === count($name) && stockSearchRunAt($name, $typed, 0))
        || (ctype_digit($term) && (string) ($row['id'] ?? '') === $term);

    $matched = 0;
    $whole   = 0;
    $inOrder = true;
    $next    = 0;   // คำถัดไปในชื่อต้องอยู่หลังตำแหน่งนี้ถึงจะนับว่าเรียงตามที่พิมพ์
    $gap     = 0;
    $start   = -1;
    foreach ($tokens as $tok) {
        $words = stockSearchWordsOf($tok);
        $at    = $words === [] ? -1 : stockSearchFind($name, $words, $next);
        if ($at >= 0) {
            if ($start < 0) {
                $start = $at;
            } else {
                $gap += $at - $next;
            }
            $next = $at + count($words);
        } else {
            $inOrder = false;
        }

        $isWhole = $at >= 0
            || mb_strtolower($tok) === $sku
            || ($words !== [] && stockSearchFind($name, $words, 0) >= 0)
            || ($words !== [] && array_filter($fields, fn($fw) => stockSearchFind($fw, $words, 0) >= 0) !== []);
        $whole   += $isWhole ? 1 : 0;
        $matched += ($isWhole || stockSearchPartial($hay, $tok)) ? 1 : 0;
    }

    $all  = count($tokens);
    $tier = match (true) {
        $exact                          => 0,
        $whole === $all && $inOrder     => 1,
        $whole === $all                 => 2,
        $matched === $all               => 3,
        default                         => 4,
    };

    return [$tier, -$matched, -$whole, $start < 0 ? PHP_INT_MAX : $gap, $start < 0 ? PHP_INT_MAX : $start];
}

/**
 * ข้อความตัดเป็นคำตัวพิมพ์เล็ก — ตัวเลขเก็บเครื่องหมายไว้กับตัว ("-0.25") ส่วนขีด
 * ระหว่างตัวอักษรเป็นตัวคั่น ("Auto-Blue" = auto, blue)
 *
 * @return list<string>
 */
function stockSearchWordsOf(string $text): array
{
    preg_match_all('/[+-]?\d+(?:\.\d+)?|[\p{L}\p{M}\p{N}]+/u', mb_strtolower($text), $m);
    return $m[0];
}

/** ตำแหน่งแรก (ตั้งแต่ $from) ที่คำชุด $needle เรียงติดกันอยู่ใน $hay · ไม่เจอ = -1 */
function stockSearchFind(array $hay, array $needle, int $from): int
{
    for ($i = $from, $last = count($hay) - count($needle); $i <= $last; $i++) {
        if (stockSearchRunAt($hay, $needle, $i)) {
            return $i;
        }
    }
    return -1;
}

/** คำชุด $needle อยู่ที่ตำแหน่ง $at ของ $hay พอดีไหม */
function stockSearchRunAt(array $hay, array $needle, int $at): bool
{
    foreach ($needle as $k => $w) {
        if (!isset($hay[$at + $k]) || !stockSearchSameWord($w, $hay[$at + $k])) {
            return false;
        }
    }
    return true;
}

/**
 * คำที่พิมพ์ ($typed) กับคำในข้อมูล ($word) คือคำเดียวกันไหม — ทั้งคู่ตัวพิมพ์เล็กแล้ว
 *
 * ตัวเลขเทียบเป็นค่า: 1.5 = 1.50 · ไม่พิมพ์เครื่องหมาย = เครื่องหมายไหนก็ได้
 * กติกาเดียวกับ stockSearchNumberPattern() ที่ใช้กรองใน SQL
 */
function stockSearchSameWord(string $typed, string $word): bool
{
    if ($typed === $word) {
        return true;
    }
    $num = '/^([+-]?)(\d+(?:\.\d+)?)$/';
    if (preg_match($num, $typed, $a) && preg_match($num, $word, $b)) {
        if ((float) $a[2] !== (float) $b[2]) {
            return false;
        }
        return $a[1] === '' || ($a[1] === '-') === ($b[1] === '-');
    }
    foreach (STOCK_SEARCH_SYNONYMS as $ring) {
        if (in_array($typed, $ring, true) && in_array($word, $ring, true)) {
            return true;
        }
    }
    return false;
}

/** คำนี้อยู่ในข้อความรวมของแถวแบบบางส่วนไหม — กติกาเดียวกับ SQL ใน stockSearchToken() */
function stockSearchPartial(string $hay, string $tok): bool
{
    if (stockSearchNumber($tok) !== null) {
        return preg_match('/' . stockSearchNumberPattern($tok) . '/', $hay) === 1;
    }
    foreach (stockSearchWords($tok) as $w) {
        if (str_contains($hay, mb_strtolower($w))) {
            return true;
        }
    }
    return false;
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
 * $lens = ตัวกรองเลนส์จาก stockLensFilter() — กติกาเดียวกับแถวที่มีล็อต
 *
 * ทดสอบที่ `api/tests/11-stock-no-lot-search.test.php`
 */
function stockProductsWithoutLots(string $term, ?string $type, int $limit = 300, bool $any = false, array $lens = ['', []]): array
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
    [$search, $searchArgs] = stockSearch($term, $any);
    if ($search !== '') {
        $where[] = $search;
        $args    = [...$args, ...$searchArgs];
    }
    if ($type !== null && $type !== '') {
        $where[] = 's.product_type = ?';
        $args[]  = $type;
    }
    if ($lens[0] !== '') {
        $where[] = $lens[0];
        $args    = [...$args, ...$lens[1]];
    }
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $args[]   = max(1, min($limit, STOCK_SEARCH_RANK_POOL));

    return Db::all("SELECT s.* FROM ($inner) s $sqlWhere ORDER BY s.product_name LIMIT ?", ...$args);
}

/**
 * ตัวกรองเลนส์ของหน้าขาย — Coating / SPH / CYL ต้องตรงทุกค่าที่กรอก (AND)
 *
 * ต่างจากช่องค้นหาข้างบนโดยตั้งใจ: ช่องค้นหาช่วยคนที่พิมพ์ไม่ครบ ("G Blue" ได้ G Auto-Blue
 * ด้วย และถอยไปโชว์ตัวที่ตรงบางคำได้) แต่ตัวกรองนี้คือพนักงานถือค่าสายตาที่วัดได้แล้วมาหา
 * ของในลิ้นชัก — เลนส์ที่ต่างกัน 0.25 คือของคนละชิ้น โผล่ในรายการเมื่อไหร่ก็หยิบผิดได้
 *
 *   · coating — ตรงทั้งคำ ไม่สนตัวพิมพ์ · Auto-Blue ไม่ใช่ Auto และไม่ใช่ Blue
 *     คำพ้องใน STOCK_SEARCH_SYNONYMS นับเป็นคำเดียวกัน (MC กับ MultiCoat คือของอย่างเดียวกัน)
 *     ว่างหรือ "all" = ไม่กรอง
 *   · sph / cyl — เทียบเป็นตัวเลข -2 = -2.00 · 0.25 = +0.25 · ว่าง = ไม่กรอง
 *     ค่าในแคตตาล็อกเขียนปนกัน ("-2.00" "-2" และ 1.5 ที่เป็นตัวเลข JSON) เทียบเป็นข้อความจึงพลาด
 *
 * ค่าสายตาอยู่ใน products.attributes ไม่มีใน v_stock_lot — จึงอ่านผ่าน s.product_id
 * ซึ่งมีทั้งในวิวและในแถวสินค้าที่ยังไม่มีล็อต (stockProductsWithoutLots)
 *
 * ทดสอบที่ `api/tests/13-stock-lens-filter.test.php`
 *
 * @param array<string,mixed> $q query ของ GET /api/stock
 * @return array{0:string,1:list<mixed>} [เงื่อนไข WHERE บนตารางนามแฝง s, ค่าที่ผูก]
 *                                       คืนสตริงว่างเมื่อไม่ได้กรอกอะไร
 */
function stockLensFilter(array $q): array
{
    $want  = stockLensWant($q);
    $where = [];
    $args  = [];

    if ($want['coating'] !== []) {
        $where[] = 'LOWER(s.coating) IN (' . implode(',', array_fill(0, count($want['coating']), '?')) . ')';
        $args    = [...$args, ...$want['coating']];
    }
    if ($want['design'] !== []) {
        $where[] = 'LOWER(s.lens_design) IN (' . implode(',', array_fill(0, count($want['design']), '?')) . ')';
        $args    = [...$args, ...$want['design']];
    }
    /* index เทียบเป็นตัวเลข "1.5" = "1.50" · ว่างต้องไม่ถูก CAST เป็น 0 */
    if ($want['index'] !== []) {
        $where[] = "(s.lens_index <> '' AND CAST(s.lens_index AS DECIMAL(4,2)) IN ("
            . implode(',', array_fill(0, count($want['index']), 'CAST(? AS DECIMAL(4,2))')) . '))';
        $args    = [...$args, ...$want['index']];
    }

    foreach (['sph', 'cyl'] as $k) {
        [$from, $to] = $want[$k];
        if ($from === null && $to === null) {
            continue;
        }
        /* ตรวจว่าเป็นตัวเลขก่อน CAST — ค่าว่างหรือ "null" ถูก CAST เป็น 0 แล้วไปเท่ากับ 0.00 */
        $attr = "JSON_UNQUOTE(JSON_EXTRACT(fp.attributes, '$.$k'))";
        $cond = ["$attr REGEXP '^[+-]?[0-9]+([.][0-9]+)?$'"];
        if ($from !== null) {
            $cond[] = "CAST($attr AS DECIMAL(6,2)) >= CAST(? AS DECIMAL(6,2))";
            $args[] = $from;
        }
        if ($to !== null) {
            $cond[] = "CAST($attr AS DECIMAL(6,2)) <= CAST(? AS DECIMAL(6,2))";
            $args[] = $to;
        }
        $where[] = 'EXISTS (SELECT 1 FROM products fp WHERE fp.id = s.product_id AND ' . implode(' AND ', $cond) . ')';
    }

    return [$where ? '(' . implode(' AND ', $where) . ')' : '', $args];
}

/**
 * ตัวกรองเลนส์ที่ขอมา อ่านเป็นค่าที่เทียบได้ — ใช้ร่วมกันระหว่าง SQL (stockLensFilter)
 * กับตัวนับชิป (stockLensFacets) กติกาสองที่จึงไม่มีทางเพี้ยนจากกัน
 *
 *   · coating / design / index — หลายค่าคั่นด้วย `|` = ตัวไหนก็ได้ (OR) · ช่องต่างกันยัง AND
 *     coating ขยายคำพ้องด้วย (MC = MultiCoat) · "all" = ไม่กรอง
 *   · sph / cyl — ค่าเดียวเป๊ะ (แบบเดิม) หรือช่วง sph_from / sph_to · หัวท้ายกลับด้านสลับให้
 *
 * @return array{coating:list<string>,design:list<string>,index:list<string>,sph:array{0:?string,1:?string},cyl:array{0:?string,1:?string}}
 */
function stockLensWant(array $q): array
{
    $list = static function (mixed $v): array {
        $s = is_scalar($v) ? trim((string) $v) : '';
        if ($s === '' || mb_strtolower($s) === 'all') {
            return [];
        }
        return array_values(array_unique(array_filter(
            array_map('trim', explode('|', $s)),
            static fn(string $x): bool => $x !== '',
        )));
    };

    $coating = [];
    foreach ($list($q['coating'] ?? null) as $c) {
        $coating = [...$coating, ...array_map('mb_strtolower', stockSearchWords($c))];
    }

    $index = [];
    foreach ($list($q['index'] ?? null) as $i) {
        if (is_numeric($i)) {
            $index[] = sprintf('%.2F', (float) $i);
        }
    }

    $want = [
        'coating' => array_values(array_unique($coating)),
        'design'  => array_map('mb_strtolower', $list($q['design'] ?? null)),
        'index'   => array_values(array_unique($index)),
    ];

    foreach (['sph' => 'SPH', 'cyl' => 'CYL'] as $k => $label) {
        $exact = stockPowerValue($q[$k] ?? null, $label);
        $from  = $exact ?? stockPowerValue($q["{$k}_from"] ?? null, $label);
        $to    = $exact ?? stockPowerValue($q["{$k}_to"] ?? null, $label);
        if ($from !== null && $to !== null && (float) $from > (float) $to) {
            [$from, $to] = [$to, $from];
        }
        $want[$k] = [$from, $to];
    }

    return $want;
}

/**
 * ชิปกับช่วงค่าสายตาของ LensPicker พร้อมจำนวน — นับจากเลนส์ที่รายการจะโชว์ได้จริง
 *
 * แต่ละช่องนับภายใต้ตัวกรองของช่องอื่น แต่ไม่ใช่ของตัวเอง — ถ้านับรวมของตัวเอง
 * พอเลือก 1.60 ชิป Index ตัวอื่นจะเป็นศูนย์หมด แล้วเลือกเพิ่มหรือเปลี่ยนไม่ได้
 *
 * $products = แถว attrs ดิบ (lens_index, lens_design, coating, sph, cyl) หนึ่งแถวต่อสินค้า
 * ของเลนส์ที่ตรงคำค้น — ยังไม่กรองเลนส์ ตัวกรองทำที่นี่ด้วยกติกาเดียวกับ SQL
 *
 * ทดสอบที่ `api/tests/13-stock-lens-filter.test.php`
 *
 * @return array<string,list<array{value:string,count:int}>> indexes / designs / coatings / sphs / cyls
 */
function stockLensFacets(array $products, array $q): array
{
    $want = stockLensWant($q);
    $num  = static fn(mixed $v): ?float =>
        is_scalar($v) && preg_match('/^[+-]?[0-9]+([.][0-9]+)?$/', trim((string) $v)) ? round((float) $v, 2) : null;
    $text = static fn(mixed $v): ?string => is_scalar($v) && trim((string) $v) !== '' ? trim((string) $v) : null;

    $lenses = [];
    foreach ($products as $p) {
        $i = $num($p['lens_index'] ?? null);
        $lenses[] = [
            'index'   => $i === null ? null : sprintf('%.2F', $i),
            'design'  => $text($p['lens_design'] ?? null),
            'coating' => $text($p['coating'] ?? null),
            'sph'     => $num($p['sph'] ?? null),
            'cyl'     => $num($p['cyl'] ?? null),
        ];
    }

    /* กติกาเดียวกับ stockLensFilter ทุกข้อ ข้ามเฉพาะช่อง $skip */
    $fits = static function (array $l, string $skip) use ($want): bool {
        foreach (['coating', 'design'] as $k) {
            if ($k !== $skip && $want[$k] !== [] && !in_array(mb_strtolower((string) $l[$k]), $want[$k], true)) {
                return false;
            }
        }
        if ($skip !== 'index' && $want['index'] !== [] && !in_array($l['index'], $want['index'], true)) {
            return false;
        }
        foreach (['sph', 'cyl'] as $k) {
            [$from, $to] = $want[$k];
            if ($k === $skip || ($from === null && $to === null)) {
                continue;
            }
            if ($l[$k] === null
                || ($from !== null && $l[$k] < (float) $from)
                || ($to !== null && $l[$k] > (float) $to)) {
                return false;
            }
        }
        return true;
    };

    $tally = static function (string $k) use ($lenses, $fits): array {
        $n = [];
        foreach ($lenses as $l) {
            if ($l[$k] !== null && $fits($l, $k)) {
                $key = is_float($l[$k]) ? sprintf('%.2F', $l[$k]) : $l[$k];
                $n[$key] = ($n[$key] ?? 0) + 1;
            }
        }
        return $n;
    };
    $shape = static fn(array $n): array => array_map(
        static fn($v, $c) => ['value' => (string) $v, 'count' => $c],
        array_keys($n),
        array_values($n),
    );
    $byNumber = static function (array $n) use ($shape): array {
        uksort($n, static fn($a, $b) => (float) $a <=> (float) $b);
        return $shape($n);
    };

    $designs = $tally('design');
    uksort($designs, 'strnatcasecmp');
    /* coating ที่มีของมากสุดขึ้นก่อน — แบบเดียวกับหน้าคลัง */
    $coatings = $tally('coating');
    uksort($coatings, static fn($a, $b) => [$coatings[$b], (string) $a] <=> [$coatings[$a], (string) $b]);

    return [
        'indexes'  => $byNumber($tally('index')),
        'designs'  => $shape($designs),
        'coatings' => $shape($coatings),
        'sphs'     => $byNumber($tally('sph')),
        'cyls'     => $byNumber($tally('cyl')),
    ];
}

/**
 * ค่าสายตาในตัวกรอง อ่านเป็นทศนิยมสองตำแหน่ง — "-2" → "-2.00" · "+0.25" → "0.25"
 *
 * ว่าง = null (ไม่ใช้เป็นเงื่อนไข) · ไม่ใช่ตัวเลข = 400 ไม่ใช่มองข้ามเงียบ ๆ เพราะผลที่ได้
 * จะเป็นเลนส์ทุกค่าสายตาที่อ่านเหมือนกรองแล้ว · ลบแบบ iPad (U+2212) กับจุลภาคทศนิยมอ่านได้
 * กติกาเดียวกับหน้าเว็บ (frontend-next/lib/lensFilter.js)
 */
function stockPowerValue(mixed $v, string $label): ?string
{
    if ($v !== null && !is_scalar($v)) {
        bad("$label ต้องเป็นตัวเลข เช่น -0.25 หรือ +1.50");
    }
    $s = str_replace(['−', ','], ['-', '.'], trim((string) ($v ?? '')));
    if ($s === '') {
        return null;
    }
    if (!preg_match('/^[+-]?(\d{1,2}(\.\d{0,2})?|\.\d{1,2})$/', $s)) {
        bad("$label ต้องเป็นตัวเลข เช่น -0.25 หรือ +1.50");
    }
    $n = (float) $s;
    return sprintf('%.2F', abs($n) < 0.005 ? 0.0 : $n);
}
