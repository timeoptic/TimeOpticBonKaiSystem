<?php

declare(strict_types=1);

namespace Optic\Repo;

use Optic\ApiError;
use Optic\Db;

/**
 * Everything the screens read.
 *
 * Writes live in Service\Stock; this file only answers questions. Keeping the
 * two apart means a reader can tell at a glance whether a function can change
 * the ledger.
 */
final class Inventory
{
    /**
     * One page of a list.
     *
     * This replaced a flat cap of a few hundred rows plus a "showing part of the
     * list" note. The note was honest but useless: it told someone their row
     * might be missing without giving them any way to reach it. A page number
     * can always reach every row.
     */
    public const PER_PAGE = 25;

    /**
     * How small and how large a caller may ask a page to be.
     *
     * The picker on the task pages wants short pages — it sits above a form, and
     * a screen of stock pushes the work off the bottom. A report wants long ones.
     * Bounded at both ends so a caller cannot ask for one row at a time, or for
     * the whole table under the guise of paging.
     */
    public const PER_PAGE_MIN = 5;
    public const PER_PAGE_MAX = 100;

    /** A lot expiring inside this window needs selling or writing off. */
    public const EXPIRY_WARN_DAYS = 120;

    /**
     * A product the shop has let run down past the level its owner set.
     *
     * Written once and used three times — the filter, the chip's tally, and the
     * figure on the stock screen — because three copies of a condition are
     * three chances for a chip to count rows the list underneath it will not
     * show. Every use joins nothing, so it fits the paging `COUNT(*)` as well
     * as the page itself.
     *
     * คงเหลือ **≤** ขั้นต่ำ ไม่ใช่ < · และ `min_stock = 0` แปลว่า "เตือนเมื่อหมด"
     * ไม่ใช่เงียบ — เจ้าของร้านกำหนด 2026-09-10 เพราะช่องขั้นต่ำเปิดมาเป็น 0 และคน
     * ชอบลืมกรอก · เดิม 0 คือเงียบ สินค้าที่ไม่มีใครตั้งขั้นต่ำหมดจนติดลบจึงไม่มี
     * อะไรบอกใคร · ของสั่งตัดยังไม่นับเหมือนเดิม เพราะมันไม่มีสต็อกให้หมด
     *
     * `SUM(remaining_qty)` rather than a count of lots that still have some:
     * on-hand is allowed to go below zero here, and a shortfall is exactly the
     * state this is meant to catch.
     */
    /* public เพราะ `Service\LowStock` ถามคำถามเดียวกันตอนปิดคำขอ — สำเนาที่สาม
       ของเงื่อนไขนี้คือโอกาสที่สามที่ข้อความเตือนจะไม่ตรงกับชิปบนหน้าจอ */
    public const LOW_STOCK = "p.is_custom_made = 0
        AND (SELECT COALESCE(SUM(l2.remaining_qty), 0)
             FROM stock_lots l2 WHERE l2.product_id = p.id) <= p.min_stock";

    /**
     * ของที่ต้องสั่ง — ยอดติดลบ หรือ เหลือน้อยกว่าขั้นต่ำ
     *
     * สองเรื่องนี้อยู่รายการเดียวกันเพราะคนที่เปิดหน้านี้ถามคำถามเดียว: "วันนี้
     * ต้องสั่งอะไรบ้าง" · แยกกันอยู่คนละหน้าแปลว่าต้องเปิดสองที่แล้วรวมเองในหัว
     * ก่อนโทรหาตัวแทน ซึ่งเป็นขั้นตอนที่ลืมได้ และของที่ลืมสั่งคือของที่ลูกค้ามา
     * ถามหาอาทิตย์หน้า
     *
     * **ยอดติดลบ** — ขายไปแล้วแต่ของยังไม่เข้า ยอดลบไปกองอยู่บนล็อตค้างส่ง
     * (`SHORT-<sku>`) ใบเดียวต่อสินค้า แต่เงื่อนไขถามที่ยอดรวม ไม่ใช่ที่ชื่อล็อต:
     * ล็อตจริงอาจยังเหลือของอยู่บ้างพร้อมกับยอดค้าง แล้วรวมกันแล้วไม่ติดลบ —
     * แบบนั้นไม่ต้องสั่ง · ผูกกับชื่อล็อตจะได้รายการที่สั่งซ้ำกับของบนชั้น
     *
     * **ต่ำกว่าขั้นต่ำ** — `LOW_STOCK` ทั้งดุ้น ไม่ได้เขียนเงื่อนไขใหม่ให้คล้าย
     * กัน สองชุดที่แปลว่า "ต่ำกว่าขั้นต่ำ" เหมือนกันคือสองชุดที่เพี้ยนจากกันได้
     * ในวันที่มีใครแก้ข้างเดียว · ที่นั่นอธิบายไว้แล้วว่าทำไมเส้นคือ ≤ และทำไม
     * `min_stock = 0` แปลว่าเตือนเมื่อหมด (ซึ่งครอบยอดติดลบไปด้วยในตัว)
     *
     * วงเล็บครอบทั้งก้อนเพราะข้างในมี OR และตัวเรียกเอาไปต่อด้วย AND — เงื่อนไข
     * อื่นทุกข้อในไฟล์นี้เป็น AND ล้วน จึงไม่เคยต้องมีวงเล็บมาก่อน
     *
     * ไม่มี join เหมือนเงื่อนไขอื่นในนี้ จึงใช้กับ `COUNT(*)` ที่แบ่งหน้าได้ด้วย
     */
    private const BACKORDER = "(
        (p.is_custom_made = 0
         AND (SELECT COALESCE(SUM(l2.remaining_qty), 0)
              FROM stock_lots l2 WHERE l2.product_id = p.id) < 0)
        OR (" . self::LOW_STOCK . ")
    )";

    /**
     * สินค้ารอสั่ง · มุม "แจ้งเตือนล่าสุด" — ร้านขอไว้ 14 ก.ย. 2026
     *
     * ของที่ `LowStock` เตือนเข้า Telegram ไปแล้ว (`low_stock_notified_at`) และยังเป็นของที่
     * ต้องสั่งอยู่ · ธงถูกล้างตอนของกลับขึ้นพ้นขั้นต่ำ แต่ล้างเฉพาะตอนสินค้าถูกแตะ — ร้านแก้
     * ขั้นต่ำลงโดยไม่มีของเคลื่อน ธงจะค้าง · ต่อ `BACKORDER` ไว้ด้วยจึงไม่โชว์ของที่พ้นเส้นแล้ว
     */
    private const ALERTED = "(p.low_stock_notified_at IS NOT NULL AND " . self::BACKORDER . ")";

    /**
     * สินค้ารอสั่ง · มุม "ต่ำกว่าขั้นต่ำทั้งหมด" — ร้านขอไว้ 14 ก.ย. 2026
     *
     * `BACKORDER` ลบของที่ไม่ได้ตั้งขั้นต่ำและแค่เหลือศูนย์ · ขั้นต่ำ 0 แปลว่า "เตือนเมื่อหมด"
     * ซึ่งยังถูกสำหรับการเตือน แต่บนรายการที่ต้องสั่ง มันคือเลนส์ทุกค่าสายตาที่ร้านไม่เคย
     * สต็อก — บนเครื่องจริงพันกว่าแถวที่กลบของที่ต้องสั่งจริง · ยอดติดลบยังนับเสมอ เพราะคือ
     * ของที่ขายไปแล้ว
     */
    private const ORDERING = "(
        (p.is_custom_made = 0
         AND (SELECT COALESCE(SUM(l2.remaining_qty), 0)
              FROM stock_lots l2 WHERE l2.product_id = p.id) < 0)
        OR (p.min_stock > 0 AND " . self::LOW_STOCK . ")
    )";

    /**
     * ธงเตือนก่อน 2026-09-12 06:36:14 UTC ลงเป็น UTC — ดู `thaiStamp()`
     */
    private const TZ_PINNED_AT = '2026-09-12 06:36:14';

    public const ACTION_LABEL = [
        'IN'       => 'รับเข้า',
        'OUT'      => 'จ่ายออก',
        'ADJUST'   => 'ปรับยอด',
        'RX_ORDER' => 'สั่งตัด RX',
        'RETURN'   => 'รับคืน',
        'SCRAP'    => 'ตัดเสีย',
        /* ตัวเลขเงินที่กรอกทีหลัง ไม่ใช่ของที่เคลื่อน — จำนวนเป็นศูนย์เสมอ */
        'COST'     => 'ลงต้นทุน',
        'PRICE'    => 'แก้ราคาขาย',
        'SETTLE'   => 'รับเงินจากสาขา',
        /* ร่องรอยของล็อตที่ถูกลบ (038) — จำนวนศูนย์ รายละเอียดอยู่ในหมายเหตุ */
        'LOT_DELETE' => 'ลบล็อต',
    ];

    /* ------------------------------------------------------------- products */

    /**
     * MariaDB 10.4 has no real JSON type — `attributes` is LONGTEXT — and it
     * rejects the `->>` operator outright with error 1064. Every read of a key
     * inside that column has to go through JSON_UNQUOTE(JSON_EXTRACT(...)).
     */
    private const EYE_SIDE = "JSON_UNQUOTE(JSON_EXTRACT(p.attributes, '$.eye_side'))";

    /**
     * What makes one lens a different lens from the next.
     *
     * A shop stocks the same model in a dozen powers and two or three indexes,
     * so "Essilor Crizal Sapphire 1.60" names a family, not a thing on a shelf.
     * Reading these out of `attributes` is what lets a list of lenses be told
     * apart at a glance, sorted by index, and filtered down to the one drawer
     * worth walking to.
     *
     * Written as a helper rather than a dozen constants because every one of
     * them is the same expression with a different key — MariaDB 10.4 has no
     * real JSON type and rejects `->>`, so each read goes the long way round.
     */
    private static function attr(string $key): string
    {
        // NULLIF, because JSON_UNQUOTE turns a JSON null into the four-letter
        // string "null" rather than into SQL NULL. Without it a frame whose
        // `attributes` names a lens key and leaves it empty comes back reading
        // "null · null" on screen, sorts in among the real values, and turns up
        // in the filter as a spec someone could choose.
        return "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes, '$.{$key}')), 'null')";
    }

    /**
     * Several choices of one filter, sent as `1.56|1.60`.
     *
     * A pipe rather than a comma: coatings are free text typed off a rep's
     * sheet, and a comma inside one is less unlikely than a pipe.
     *
     * @return list<string>
     */
    private static function many(mixed $v): array
    {
        if (!is_string($v)) {
            return [];
        }
        return array_values(array_unique(array_filter(
            array_map('trim', explode('|', $v)),
            static fn(string $s): bool => $s !== '',
        )));
    }

    /** One end of a power range, or null when absent or not a number. */
    private static function power(mixed $v): ?float
    {
        return is_string($v) && is_numeric(trim($v)) ? round((float) trim($v), 2) : null;
    }

    /** The numeric reading of an attribute, for sorting powers and indexes. */
    private static function attrNum(string $key): string
    {
        return 'CAST(' . self::attr($key) . ' AS DECIMAL(8,2))';
    }

    /**
     * The five kinds of thing the shop stocks.
     *
     * Repeated from `Catalog::TYPES` on purpose: that one is what a *write* is
     * validated against, this one is what a *filter* is whitelisted against, and
     * they answer to different callers. A read filter is a list of values that
     * may reach the query — nothing else, whatever the query string says.
     */
    private const TYPES = ['Lens', 'Frame', 'Sunglass', 'ContactLen', 'Accessory'];

    /**
     * @param array{q?:?string,eye?:?string,make?:?string,type?:?string,category_id?:?int,page?:mixed} $filter
     * @return array{rows:list<array<string,mixed>>,total:int,page:int,perPage:int}
     */
    public static function products(array $filter = [], bool $money = false): array
    {
        $filter = self::searchScope($filter);
        [$clause, $args] = self::productWhere($filter);
        return self::productPage($clause, $args, $filter, $money);
    }

    /**
     * คำค้นแสดงเฉพาะสินค้าที่ตรงครบทุกคำ — ไม่ถอยไปขึ้นตัวที่ตรงบางคำแล้ว (ร้านขอ 18 ก.ย. 2026:
     * "ให้แสดงแค่ตามค่าที่ค้นเท่านั้น อันใกล้เคียงไม่ต้องแสดง")
     *
     * เดิมคำค้นหลายคำที่ไม่มีตัวไหนตรงครบ ถอยไปแสดงตัวที่ตรงบางคำ ซึ่งกับเลนส์คือของผิดค่าสายตา
     * ที่ดูเหมือนผลค้นหา · ตอนนี้ไม่ตรงก็ว่าง แล้วหน้าจอบอกว่าไม่เจอ · `any` ไม่ได้มาจาก query string
     * ถูกล้างทิ้งที่นี่ที่เดียว (หน้าขายฝั่งหน้าร้าน GET /api/stock ยังถอยแบบเดิม — ไม่ได้แตะ)
     *
     * @param array<string,mixed> $filter
     * @return array<string,mixed>
     */
    private static function searchScope(array $filter): array
    {
        unset($filter['any']);
        return $filter;
    }

    /**
     * The WHERE every product query is narrowed by, built once.
     *
     * Extracted so the facet counts on the lens chips are computed against the
     * very same conditions as the list under them. Counting the whole catalogue
     * while the list showed only stocked items is what made "Progressive 4"
     * appear above a page that could never show one: all four are made-to-order,
     * and the receive screen only ever lists stock.
     *
     * @param array<string,mixed> $filter
     * @return array{0:string,1:list<mixed>}
     */
    private static function productWhere(array $filter): array
    {
        $where = ['1=1'];
        $args = [];

        // ค้นแบบหน้าขาย: ตัดเป็นคำ ต้องเจอครบทุกคำ แต่ละคำเจอที่ชื่อ แบรนด์ SKU หรือ
        // สเปกใน `attributes` ก็ได้ — กติกาทั้งหมดกับเหตุผลอยู่ที่ ProductSearch
        [$search, $searchArgs] = ProductSearch::where((string) ($filter['q'] ?? ''), !empty($filter['any']));
        if ($search !== '') {
            $where[] = $search;
            array_push($args, ...$searchArgs);
        }
        if (($filter['eye'] ?? null) === 'left' || ($filter['eye'] ?? null) === 'right') {
            $where[] = self::EYE_SIDE . ' = ?';
            $args[] = $filter['eye'];
        }
        if (($filter['make'] ?? null) === 'ready') {
            $where[] = 'p.is_custom_made = 0';
        } elseif (($filter['make'] ?? null) === 'custom') {
            $where[] = 'p.is_custom_made = 1';
        } elseif (($filter['make'] ?? null) === 'rx') {
            // What may actually be special-ordered: something made to order, or
            // something normally stocked that has run out. Ordering specially
            // while stock remains would jump the FIFO queue, so those are not
            // offered — the same rule the RX screen enforces on submit.
            //
            // Written as a correlated subquery rather than against the joined
            // on-hand alias because the COUNT(*) that pages this list does not
            // carry that join.
            $where[] = '(p.is_custom_made = 1 OR NOT EXISTS (
                            SELECT 1 FROM stock_lots l2
                            WHERE l2.product_id = p.id AND l2.remaining_qty > 0))';
        }
        // "เลนส์ / กรอบแว่น / แว่นกันแดด / คอนแทคเลนส์ / อุปกรณ์" as a filter of its
        // own. There is a category per type and `cat` would reach the same rows,
        // but that makes every caller look an id up first; the type is the name
        // the screens already hold.
        if (in_array($filter['type'] ?? null, self::TYPES, true)) {
            $where[] = 'p.product_type = ?';
            $args[] = $filter['type'];
        }
        if (!empty($filter['category_id'])) {
            $where[] = 'p.category_id = ?';
            $args[] = (int) $filter['category_id'];
        }

        // Narrowing a wall of lenses down to the drawer worth walking to. Each
        // is matched as the exact stored string — the form writes them from a
        // fixed list, so there is nothing to normalise and nothing to guess.
        //
        // Several values of one facet are OR'd, the facets themselves AND'd:
        // "1.56 or 1.60, Blue" is the question a shop asks when either index
        // will do for the customer, and two separate searches answer it badly.
        foreach (['index' => 'lens_index', 'design' => 'lens_design', 'coating' => 'coating'] as $key => $attr) {
            $values = self::many($filter[$key] ?? null);
            if ($values !== []) {
                $where[] = self::attr($attr) . ' IN (' . implode(',', array_fill(0, count($values), '?')) . ')';
                array_push($args, ...$values);
            }
        }

        /* สินค้าที่มีล็อตรับเข้าในช่วงวันนี้ — ปฏิทินของหน้าสินค้าและสต็อก (ร้านขอ 18 ก.ย. 2026)
           ถามเป็นเรื่องของล็อต คำตอบเป็นสินค้า แบบเดียวกับตัวกรองสถานะข้างล่าง */
        $recv = [];
        if (self::isDate($filter['received_from'] ?? null)) {
            $recv[] = 'l3.received_date >= ?';
            $args[] = $filter['received_from'];
        }
        if (self::isDate($filter['received_to'] ?? null)) {
            $recv[] = 'l3.received_date <= ?';
            $args[] = $filter['received_to'];
        }
        if ($recv !== []) {
            $where[] = 'EXISTS (SELECT 1 FROM stock_lots l3 WHERE l3.product_id = p.id AND ' . implode(' AND ', $recv) . ')';
        }

        // SPH / CYL as a range, compared as numbers so "-2" meets "-2.00".
        // Either end may be open; ends given the wrong way round are swapped
        // rather than returning nothing, since that is never what was meant.
        // ADD เข้ากติกาเดียวกัน (ร้านขอ 18 ก.ย. 2026) — เก็บเป็นข้อความ "+2.00" แต่ CAST เป็นตัวเลขได้
        foreach (['sph', 'cyl', 'add'] as $key) {
            $from = self::power($filter["{$key}_from"] ?? null);
            $to   = self::power($filter["{$key}_to"] ?? null);
            if ($from !== null && $to !== null && $from > $to) {
                [$from, $to] = [$to, $from];
            }
            if ($from !== null) {
                $where[] = self::attrNum($key) . ' >= ?';
                $args[] = $from;
            }
            if ($to !== null) {
                $where[] = self::attrNum($key) . ' <= ?';
                $args[] = $to;
            }
        }

        /**
         * The state of a product's stock, asked as a question about its lots.
         *
         * These used to be chips on a separate lot list, where the answer was a
         * lot. Here the answer is a product — "which products have a lot still
         * waiting on an invoice" — because that is the row someone opens to do
         * something about it. Correlated subqueries rather than a join: the
         * COUNT(*) that pages this list carries no lot join, and a product with
         * four lots must still count once.
         */
        $state = $filter['state'] ?? null;
        if ($state === 'awaiting-cost') {
            $where[] = 'EXISTS (SELECT 1 FROM stock_lots l2
                                WHERE l2.product_id = p.id AND l2.cost_per_unit IS NULL)';
        } elseif ($state === 'expiring') {
            $where[] = 'EXISTS (SELECT 1 FROM stock_lots l2
                                WHERE l2.product_id = p.id AND l2.remaining_qty > 0
                                  AND l2.expiry_date IS NOT NULL
                                  AND l2.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 90 DAY))';
        } elseif ($state === 'out') {
            // Made-to-order products hold no stock by design; calling them "out"
            // would fill this list with things that were never in.
            $where[] = 'p.is_custom_made = 0 AND NOT EXISTS (
                            SELECT 1 FROM stock_lots l2
                            WHERE l2.product_id = p.id AND l2.remaining_qty > 0)';
        } elseif ($state === 'in') {
            $where[] = 'EXISTS (SELECT 1 FROM stock_lots l2
                                WHERE l2.product_id = p.id AND l2.remaining_qty > 0)';
        } elseif ($state === 'low') {
            // Deliberately not narrowed to products that still have some: a
            // minimum of five is missed just as badly at zero as at four, and
            // the whole point of the figure is to be told before the shelf is
            // empty rather than after.
            $where[] = self::LOW_STOCK;
        } elseif ($state === 'backorder') {
            $where[] = self::BACKORDER;
        } elseif ($state === 'alerted') {
            $where[] = self::ALERTED;
        } elseif ($state === 'ordering') {
            $where[] = self::ORDERING;
        }

        return [implode(' AND ', $where), $args];
    }

    /**
     * One page of products under an already-built WHERE.
     *
     * @param list<mixed> $args
     * @param array<string,mixed> $filter
     * @return array{rows:list<array<string,mixed>>,total:int,page:int,perPage:int}
     */
    private static function productPage(string $clause, array $args, array $filter, bool $money): array
    {
        $per = self::perPage($filter['per'] ?? null);
        $term = trim((string) ($filter['q'] ?? ''));

        if ($term !== '' && in_array($filter['sort'] ?? null, [null, '', 'match'], true)) {
            // มีคำค้นและไม่ได้กดเรียงตามคอลัมน์ไหน — ตัวที่ตรงที่สุดขึ้นก่อน
            // จัดอันดับทั้งชุดก่อนแล้วค่อยตัดเป็นหน้า ตัดก่อนแล้วตัวที่ตรงที่สุดตกไปหน้าหลัง
            $pool = Db::all(
                'SELECT ' . ProductSearch::rankColumns() . " FROM products p WHERE {$clause}
                 ORDER BY p.id DESC LIMIT " . ProductSearch::RANK_POOL,
                $args,
            );
            $ids = array_map('intval', array_column(ProductSearch::rank($pool, $term), 'id'));
            $total = count($ids);
            [$page, $offset] = self::pageOf($filter['page'] ?? 1, $total, $per);
            // id มาจากฐานเป็นเลขล้วน ต่อเข้า SQL ตรง ๆ ได้ · หน้าว่างใช้ 0 ซึ่งไม่มีสินค้า
            $list = implode(',', array_slice($ids, $offset, $per) ?: [0]);
            $where = "p.id IN ({$list})";
            $tail = "FIELD(p.id, {$list})";
            $args = [];
        } else {
            $total = (int) Db::value("SELECT COUNT(*) FROM products p WHERE {$clause}", $args);
            [$page, $offset] = self::pageOf($filter['page'] ?? 1, $total, $per);
            $where = $clause;
            $tail = self::productOrder($filter['sort'] ?? null, $filter['dir'] ?? null) . ' LIMIT ? OFFSET ?';
            array_push($args, $per, $offset);
        }

        $rows = Db::all(
            'SELECT p.id, p.sku, p.name, p.brand, p.product_type, p.category_id,
                    p.base_selling_price, p.min_stock, p.is_custom_made, p.low_stock_notified_at,
                    ' . self::EYE_SIDE . ' AS eye_side,
                    ' . self::attr('model') . '       AS model,
                    ' . self::attr('lens_design') . ' AS lens_design,
                    ' . self::attr('lens_index') . '  AS lens_index,
                    ' . self::attr('coating') . '     AS coating,
                    ' . self::attr('sph') . '         AS sph,
                    ' . self::attr('cyl') . '         AS cyl,
                    ' . self::attr('axis') . '        AS axis,
                    ' . self::attr('add') . '         AS `add`,
                    COALESCE(s.on_hand, 0)          AS on_hand,
                    COALESCE(s.stock_value, 0)      AS stock_value,
                    COALESCE(s.lots_missing_cost, 0) AS lots_missing_cost,
                    s.next_cost
             FROM products p
             LEFT JOIN (
               SELECT l.product_id,
                      SUM(l.remaining_qty) AS on_hand,
                      SUM(CASE WHEN l.cost_per_unit IS NULL THEN 0
                               ELSE l.remaining_qty * l.cost_per_unit END) AS stock_value,
                      SUM(CASE WHEN l.cost_per_unit IS NULL AND l.remaining_qty > 0
                               THEN 1 ELSE 0 END) AS lots_missing_cost,
                      -- ต้นทุนของล็อตถัดไปที่จะถูกตัดตาม FIFO
                      SUBSTRING_INDEX(
                        GROUP_CONCAT(
                          CASE WHEN l.remaining_qty > 0 THEN l.cost_per_unit END
                          ORDER BY l.received_date ASC, l.id ASC SEPARATOR \',\'
                        ), \',\', 1
                      ) AS next_cost
               FROM stock_lots l
               GROUP BY l.product_id
             ) s ON s.product_id = p.id
             WHERE ' . $where . '
             ORDER BY ' . $tail,
            $args,
        );

        return [
            'rows'    => array_map(static fn(array $r): array => self::shapeProduct($r, $money), $rows),
            'total'   => $total,
            'page'    => $page,
            'perPage' => $per,
        ];
    }

    /** @return array<string,mixed> */
    public static function product(int $id, bool $money = false): array
    {
        $p = Db::one(
            'SELECT p.*, ' . self::EYE_SIDE . ' AS eye_side FROM products p WHERE p.id = ?',
            [$id],
        );
        if ($p === null) {
            throw ApiError::notFound('ไม่พบสินค้า');
        }

        $lots = Db::all(
            'SELECT l.id, l.lot_number, l.supplier_id, sup.name AS supplier_name,
                    l.cost_per_unit, l.initial_qty, l.remaining_qty,
                    l.received_date, l.expiry_date, l.notes
             FROM stock_lots l
             LEFT JOIN suppliers sup ON sup.id = l.supplier_id
             WHERE l.product_id = ?
             ORDER BY l.received_date DESC, l.id DESC',
            [$id],
        );

        $logs = Db::all(
            'SELECT g.id, g.action_type, g.quantity, g.unit_cost, g.reference_doc,
                    g.notes, g.created_at, g.created_by, g.created_by_kind,
                    l.lot_number, a.display_name AS actor_name,
                    g.issued_to_admin_id, who.display_name AS issued_to_name, g.scrap_by,
                    EXISTS (SELECT 1 FROM inventory_logs rv WHERE rv.reverses_log_id = g.id) AS returned,
                    /* ยอดคงเหลือของสินค้านี้หลังรายการนี้ (ร้านขอ 18 ก.ย. 2026) — ผลรวมสมุดที่ผูกล็อต
                       ถึงแถวนี้ตามลำดับที่ลงสมุด · ยอดล็อต = ผลรวมสมุดของล็อตเสมอ จึงเป็นยอดจริง ณ ตอนนั้น
                       แถวที่ไม่ผูกล็อต (สั่งตัด RX · แก้ราคา) ไม่ขยับของบนชั้น จึงไม่มียอดให้แสดง */
                    CASE WHEN g.lot_id IS NULL THEN NULL ELSE
                      (SELECT COALESCE(SUM(b.quantity), 0) FROM inventory_logs b
                        WHERE b.product_id = g.product_id AND b.lot_id IS NOT NULL AND b.id <= g.id)
                    END AS balance_after,
                    (SELECT cs.case_id FROM case_stock_issues cs
                      WHERE g.reference_doc IS NOT NULL AND cs.reference_doc = g.reference_doc
                      ORDER BY cs.id DESC LIMIT 1) AS case_id,
                    g.branch_issue_id, bi.taken_by, bi.status AS branch_status,
                    bi.settled_amount, bi.settled_at, bi.cost_total, br.name AS branch_name
             FROM inventory_logs g
             LEFT JOIN stock_lots l ON l.id = g.lot_id
             LEFT JOIN admins a ON a.id = g.created_by
             LEFT JOIN admins who ON who.id = g.issued_to_admin_id
             LEFT JOIN branch_issues bi ON bi.id = g.branch_issue_id
             LEFT JOIN branches br ON br.id = bi.branch_id
             WHERE g.product_id = ?
             ORDER BY g.created_at DESC, g.id DESC
             LIMIT 40',
            [$id],
        );

        $onHand = 0;
        $value = 0.0;
        foreach ($lots as $l) {
            $onHand += (int) $l['remaining_qty'];
            if ($l['cost_per_unit'] !== null) {
                $value += (int) $l['remaining_qty'] * (float) $l['cost_per_unit'];
            }
        }

        $attributes = json_decode((string) $p['attributes'], true);
        $attributes = is_array($attributes) ? $attributes : [];

        return [
            'id'           => (int) $p['id'],
            'sku'          => $p['sku'],
            'name'         => $p['name'],
            'brand'        => $p['brand'],
            'productType'  => $p['product_type'],
            'categoryId'   => (int) $p['category_id'],
            'basePrice'    => (float) $p['base_selling_price'],
            'minStock'     => (int) $p['min_stock'],
            'isCustomMade' => (bool) $p['is_custom_made'],
            'eyeSide'      => $p['eye_side'],
            // The same seven lens keys the list rows carry, so a screen that has
            // one product open can show its spec without a second shape to learn.
            ...self::lensKeys($attributes),
            'attributes'   => $attributes,
            'onHand'       => $onHand,
            'lowStockNotifiedAt' => self::thaiStamp($p['low_stock_notified_at'] ?? null),
            'stockValue'   => $money ? round($value, 2) : null,
            'lots'         => array_map(static fn(array $r): array => self::shapeLot($r, $money), $lots),
            'logs'         => array_map(static fn(array $r): array => self::shapeLog($r, $money), $logs),
        ];
    }

    /* ----------------------------------------------------------------- lots */

    /**
     * @param array{state?:?string,q?:?string,page?:mixed} $filter
     * @return array{rows:list<array<string,mixed>>,total:int,page:int,perPage:int}
     */
    public static function lots(array $filter = [], bool $money = false): array
    {
        $where = ['1=1'];
        $args = [];

        switch ($filter['state'] ?? 'all') {
            case 'onhand':   $where[] = 'l.remaining_qty > 0'; break;
            case 'empty':    $where[] = 'l.remaining_qty = 0'; break;
            case 'nocost':   $where[] = 'l.cost_per_unit IS NULL'; break;
            case 'expiring':
                $where[] = 'l.expiry_date IS NOT NULL AND l.remaining_qty > 0
                            AND l.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)';
                $args[] = self::EXPIRY_WARN_DAYS;
                break;
        }

        if (!empty($filter['q'])) {
            // หมายเหตุของล็อตด้วย — ร้านขอ 3 ต.ค. 2026
            $where[] = '(l.lot_number LIKE ? OR p.sku LIKE ? OR p.name LIKE ? OR l.notes LIKE ?)';
            $like = '%' . $filter['q'] . '%';
            array_push($args, $like, $like, $like, $like);
        }
        // ช่วงวันรับเข้า — ปฏิทินเดียวกับทุกหน้า (ร้านขอ 18 ก.ย. 2026)
        if (self::isDate($filter['from'] ?? null)) {
            $where[] = 'l.received_date >= ?';
            $args[] = $filter['from'];
        }
        if (self::isDate($filter['to'] ?? null)) {
            $where[] = 'l.received_date <= ?';
            $args[] = $filter['to'];
        }

        $clause = implode(' AND ', $where);
        $total = (int) Db::value(
            "SELECT COUNT(*) FROM stock_lots l
             JOIN products p ON p.id = l.product_id
             WHERE {$clause}",
            $args,
        );
        [$page, $offset] = self::pageOf($filter['page'] ?? 1, $total);
        array_push($args, self::PER_PAGE, $offset);

        $rows = Db::all(
            'SELECT l.id, l.lot_number, l.product_id, p.sku, p.name AS product_name,
                    p.product_type, sup.name AS supplier_name,
                    l.cost_per_unit, l.initial_qty, l.remaining_qty,
                    l.received_date, l.expiry_date,
                    (l.expiry_date IS NOT NULL AND l.remaining_qty > 0
                     AND l.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ' . self::EXPIRY_WARN_DAYS . ' DAY)) AS expiring_soon
             FROM stock_lots l
             JOIN products p ON p.id = l.product_id
             LEFT JOIN suppliers sup ON sup.id = l.supplier_id
             WHERE ' . $clause . '
             ORDER BY ' . self::lotOrder($filter['sort'] ?? null, $filter['dir'] ?? null) . '
             LIMIT ? OFFSET ?',
            $args,
        );

        return [
            'rows'    => array_map(static fn(array $r): array => self::shapeLotRow($r, $money), $rows),
            'total'   => $total,
            'page'    => $page,
            'perPage' => self::PER_PAGE,
        ];
    }

    /** @return array<string,int> */
    public static function lotCounts(): array
    {
        $r = Db::one(
            'SELECT COUNT(*) AS all_lots,
                    SUM(remaining_qty > 0) AS onhand,
                    SUM(remaining_qty = 0) AS empty_lots,
                    SUM(cost_per_unit IS NULL) AS nocost,
                    SUM(expiry_date IS NOT NULL AND remaining_qty > 0
                        AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)) AS expiring
             FROM stock_lots',
            [self::EXPIRY_WARN_DAYS],
        );

        return [
            'all'      => (int) $r['all_lots'],
            'onhand'   => (int) $r['onhand'],
            'empty'    => (int) $r['empty_lots'],
            'nocost'   => (int) $r['nocost'],
            'expiring' => (int) $r['expiring'],
        ];
    }

    /* ------------------------------------------------------------ movements */

    /**
     * The ledger, which is also the list of transactions the books are built
     * from — so every row has to be able to say who took the goods, not only who
     * typed the entry, and whether the money for it has arrived yet.
     *
     * @param array{type?:?string,q?:?string,who?:?string,page?:mixed} $filter
     * @return array{rows:list<array<string,mixed>>,total:int,page:int,perPage:int}
     */
    public static function movements(array $filter = [], bool $money = false): array
    {
        $where = ['1=1'];
        $args = [];

        $type = $filter['type'] ?? null;
        if ($type !== null && isset(self::ACTION_LABEL[$type])) {
            $where[] = 'g.action_type = ?';
            $args[] = $type;
        }

        // "branch" is not an action type — it cuts across OUT rows — so it gets
        // its own filter rather than being wedged into the type chips.
        if (($filter['who'] ?? null) === 'branch') {
            $where[] = 'g.branch_issue_id IS NOT NULL';
        } elseif (($filter['who'] ?? null) === 'owed') {
            $where[] = "bi.status = 'pending'";
        }

        if (!empty($filter['q'])) {
            $where[] = '(g.reference_doc LIKE ? OR p.sku LIKE ? OR p.name LIKE ? OR l.lot_number LIKE ?
                         OR g.notes LIKE ? OR who.display_name LIKE ? OR bi.taken_by LIKE ? OR br.name LIKE ?
                         OR g.scrap_by LIKE ?)';
            $like = '%' . $filter['q'] . '%';
            array_push($args, $like, $like, $like, $like, $like, $like, $like, $like, $like);
        }

        // `< to + 1 day` rather than `<= to 23:59:59` — the latter drops anything
        // stamped in the final second of the day.
        if (self::isDate($filter['from'] ?? null)) {
            $where[] = 'g.created_at >= ?';
            $args[] = $filter['from'];
        }
        if (self::isDate($filter['to'] ?? null)) {
            $where[] = 'g.created_at < DATE_ADD(?, INTERVAL 1 DAY)';
            $args[] = $filter['to'];
        }

        $joins =
            'FROM inventory_logs g
             LEFT JOIN products p ON p.id = g.product_id
             LEFT JOIN stock_lots l ON l.id = g.lot_id
             LEFT JOIN admins a ON a.id = g.created_by
             LEFT JOIN admins who ON who.id = g.issued_to_admin_id
             LEFT JOIN branch_issues bi ON bi.id = g.branch_issue_id
             LEFT JOIN branches br ON br.id = bi.branch_id';

        $clause = implode(' AND ', $where);
        $total = (int) Db::value("SELECT COUNT(*) {$joins} WHERE {$clause}", $args);
        [$page, $offset] = self::pageOf($filter['page'] ?? 1, $total);
        array_push($args, self::PER_PAGE, $offset);

        $rows = Db::all(
            "SELECT g.id, g.action_type, g.quantity, g.unit_cost, g.sale_price, g.reference_doc, g.notes,
                    g.created_at, g.created_by, g.created_by_kind,
                    g.product_id,
                    /* แถวร่องรอยการลบล็อตของสินค้าที่ถูกลบตามไปแล้ว (038) ไม่มีสินค้าให้ join */
                    COALESCE(p.sku, '—') AS sku, COALESCE(p.name, 'สินค้าที่ถูกลบแล้ว') AS product_name,
                    p.base_selling_price,
                    l.lot_number, a.display_name AS actor_name, a.job_title AS actor_job,
                    g.issued_to_admin_id, who.display_name AS issued_to_name, g.scrap_by,
                    EXISTS (SELECT 1 FROM inventory_logs rv WHERE rv.reverses_log_id = g.id) AS returned,
                    /* ยอดคงเหลือของสินค้านี้หลังรายการนี้ (ร้านขอ 18 ก.ย. 2026) — ผลรวมสมุดที่ผูกล็อต
                       ถึงแถวนี้ตามลำดับที่ลงสมุด · ยอดล็อต = ผลรวมสมุดของล็อตเสมอ จึงเป็นยอดจริง ณ ตอนนั้น
                       แถวที่ไม่ผูกล็อต (สั่งตัด RX · แก้ราคา) ไม่ขยับของบนชั้น จึงไม่มียอดให้แสดง */
                    CASE WHEN g.lot_id IS NULL THEN NULL ELSE
                      (SELECT COALESCE(SUM(b.quantity), 0) FROM inventory_logs b
                        WHERE b.product_id = g.product_id AND b.lot_id IS NOT NULL AND b.id <= g.id)
                    END AS balance_after,
                    (SELECT cs.case_id FROM case_stock_issues cs
                      WHERE g.reference_doc IS NOT NULL AND cs.reference_doc = g.reference_doc
                      ORDER BY cs.id DESC LIMIT 1) AS case_id,
                    g.branch_issue_id, bi.taken_by, bi.status AS branch_status,
                    bi.settled_amount, bi.settled_at, bi.cost_total, br.name AS branch_name
             {$joins}
             WHERE {$clause}
             ORDER BY " . self::movementOrder($filter['sort'] ?? null, $filter['dir'] ?? null) . "
             LIMIT ? OFFSET ?",
            $args,
        );

        return [
            'rows'    => array_map(static fn(array $r): array => self::shapeLog($r, $money), $rows),
            'total'   => $total,
            'page'    => $page,
            'perPage' => self::PER_PAGE,
        ];
    }

    /**
     * The ORDER BY for a sortable lot column.
     *
     * Received date descending is the default: the newest lot first, the way
     * every list on the site reads. FIFO — the order stock is actually cut in —
     * is not this screen's job; the picking queries do that for themselves, and
     * asking for วันที่ ascending here brings FIFO back. Every other sort is
     * someone looking for an outlier — the biggest, the dearest, the one about
     * to expire.
     */
    private static function lotOrder(mixed $sort, mixed $dir): string
    {
        $column = match ($sort) {
            'lot'       => 'l.lot_number',
            'product'   => 'p.name',
            'supplier'  => 'sup.name',
            'initial'   => 'l.initial_qty',
            'remaining' => 'l.remaining_qty',
            'cost'      => 'l.cost_per_unit',
            'value'     => 'l.remaining_qty * COALESCE(l.cost_per_unit, 0)',
            'expiry'    => 'l.expiry_date',
            default     => 'l.received_date',
        };

        $natural = in_array($column, ['l.lot_number', 'p.name', 'sup.name', 'l.expiry_date'], true)
            ? 'ASC'
            : 'DESC';
        $order = match ($dir) {
            'asc'   => 'ASC',
            'desc'  => 'DESC',
            default => $natural,
        };

        return "{$column} {$order}, l.id {$order}";
    }

    /**
     * The ORDER BY for a sortable catalogue column.
     *
     * A whitelist for the same reason as the ledger's below: this string is
     * interpolated into the SQL, so anything unrecognised has to fall back to the
     * default rather than reach the database. `p.id` is the tiebreaker so paging
     * through equal values cannot repeat or skip a row.
     *
     * "เพิ่มล่าสุด" sorts on `p.id` alone — the catalogue keeps no added-on date,
     * and the id is the only record of the order rows arrived in. It is what the
     * screen opens on, so the newest product is the first one seen.
     *
     * "คงเหลือ" sorts on the joined subquery's alias, which is NULL for a product
     * with no lots at all — COALESCE puts those with the zeros rather than in a
     * clump of their own at one end.
     *
     * "ข้าง" sorts on the same JSON expression the eye filter matches against, so
     * ordering by it and filtering on it can never disagree. Most products have
     * no side at all and come back NULL; those gather at one end rather than
     * being spread through the list, which is what makes the sort useful — it
     * brings the left/right pairs together. "แบรนด์" is nullable for the same
     * reason and behaves the same way — the unbranded clump together instead of
     * being scattered through the brands.
     */
    private static function productOrder(mixed $sort, mixed $dir): string
    {
        $column = match ($sort) {
            'sku'    => 'p.sku',
            'name'   => 'p.name',
            'onhand' => 'COALESCE(s.on_hand, 0)',
            'price'  => 'p.base_selling_price',
            'type'   => 'p.product_type',
            'eye'    => self::EYE_SIDE,
            'brand'  => 'p.brand',
            // The lens columns. Index and power sort as numbers or 1.6 lands
            // between 1.50 and 1.56, and −2.25 lands after −10.00.
            'index'  => self::attrNum('lens_index'),
            'design' => self::attr('lens_design'),
            'coating' => self::attr('coating'),
            'sph'    => self::attrNum('sph'),
            'cyl'    => self::attrNum('cyl'),
            // มุม "แจ้งเตือนล่าสุด" ของหน้าสินค้ารอสั่ง — ไม่อยู่ในรายการเรียงตามธรรมชาติ
            // จึงเปิดมาเป็นล่าสุดก่อน
            'alerted' => 'p.low_stock_notified_at',
            // "เพิ่มล่าสุด" is the default, so an unrecognised sort lands on the same
            // order the screens open in rather than on a column nobody asked for.
            default  => 'p.id',
        };

        // SKU and name read naturally ascending; the numbers are asked for when
        // looking for the largest of something. Anything that is not exactly
        // "asc" or "desc" counts as unspecified rather than as descending —
        // otherwise a typo in the query string silently reverses the list.
        $natural = in_array(
            $column,
            [
                'p.sku', 'p.name', 'p.product_type', 'p.brand', self::EYE_SIDE,
                // Words, and the two lens figures that are read as a scale
                // rather than as "find me the biggest" — an optician looks for
                // 1.50 upward and for the weakest power first.
                self::attr('lens_design'), self::attr('coating'),
                self::attrNum('lens_index'), self::attrNum('sph'), self::attrNum('cyl'),
            ],
            true,
        ) ? 'ASC' : 'DESC';
        $order = match ($dir) {
            'asc'   => 'ASC',
            'desc'  => 'DESC',
            default => $natural,
        };

        // "เพิ่มล่าสุด" already sorts on the tiebreaker itself; naming it twice
        // would be harmless but reads as a mistake.
        return $column === 'p.id' ? "p.id {$order}" : "{$column} {$order}, p.id {$order}";
    }

    /**
     * The ORDER BY for a sortable ledger column.
     *
     * A whitelist, never interpolation of what the caller sent: this string goes
     * into the SQL verbatim, so an unrecognised name has to become the default
     * rather than reaching the database. `g.id` is always the tiebreaker so that
     * paging through equal values cannot show the same row twice or skip one.
     */
    private static function movementOrder(mixed $sort, mixed $dir): string
    {
        $column = match ($sort) {
            'qty'     => 'g.quantity',
            'cost'    => 'g.unit_cost',
            'product' => 'p.name',
            'type'    => 'g.action_type',
            'doc'     => 'g.reference_doc',
            default   => 'g.created_at',
        };

        $order = $dir === 'asc' ? 'ASC' : 'DESC';

        return "{$column} {$order}, g.id {$order}";
    }

    private static function isDate(mixed $v): bool
    {
        return is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) === 1;
    }

    /**
     * The notes people actually write, most-used first.
     *
     * Derived from the ledger rather than kept in a list somebody maintains: the
     * shop's real vocabulary is already in there — "ขายหน้าร้าน" many times over,
     * "เบิกไปประกอบงานเลนส์", "ตรวจนับประจำเดือน ของเกิน" — and a list that learns
     * from use never goes stale the way a hand-kept one does.
     *
     * @return list<string>
     */
    public static function noteSuggestions(string $actionType, int $limit = 8): array
    {
        if (!isset(self::ACTION_LABEL[$actionType])) {
            return [];
        }

        $rows = Db::all(
            'SELECT notes, COUNT(*) AS n
             FROM inventory_logs
             WHERE action_type = ? AND notes IS NOT NULL AND TRIM(notes) <> \'\'
               AND CHAR_LENGTH(notes) <= 60
             GROUP BY notes
             ORDER BY n DESC, MAX(created_at) DESC
             LIMIT ?',
            [$actionType, $limit],
        );

        return array_map(static fn(array $r): string => (string) $r['notes'], $rows);
    }

    /** @return array<string,int> */
    public static function movementCounts(): array
    {
        $rows = Db::all('SELECT action_type, COUNT(*) AS n FROM inventory_logs GROUP BY action_type');

        $out = ['all' => 0];
        foreach (array_keys(self::ACTION_LABEL) as $t) {
            $out[$t] = 0;
        }
        foreach ($rows as $r) {
            $out[$r['action_type']] = (int) $r['n'];
            $out['all'] += (int) $r['n'];
        }
        return $out;
    }

    /* ------------------------------------------------------------ reference */

    /** @return list<array<string,mixed>> */
    /** The three ways a lens can correct, in the order the form offers them. */
    private const LENS_DESIGNS = ['Single Vision', 'Bifocal', 'Progressive'];

    /**
     * The lens specs the pickers offer, each with how many products carry it.
     *
     * Counts are the whole point of sending them. A chip reading "Bifocal 0" is
     * an answer — the shop does not stock bifocals — where a chip that is simply
     * absent leaves someone wondering whether they are looking in the wrong
     * place, and a chip with no count is a dead end they have to tap to find.
     *
     * The three designs are always listed even at zero, because they are a
     * closed set that the catalogue either has or has not. Indexes are not: they
     * are a scale with no fixed membership, so only the ones actually stocked
     * appear, and a value the data holds but the form no longer offers still
     * shows up rather than becoming unreachable.
     *
     * @return array{indexes:list<array{value:string,count:int}>,designs:list<array{value:string,count:int}>}
     */
    public static function lensOptions(array $filter = []): array
    {
        // ถอยไปตรงบางคำพร้อมกับรายการ ไม่งั้นตัวเลือก index ว่างเหนือรายการที่มีเลนส์
        $filter = self::searchScope($filter);

        /**
         * A facet is counted under the list's own conditions, minus its own
         * choice. Keeping its own choice would leave every other chip on that
         * row reading 0 the moment one was picked, and switching from 1.60 to
         * 1.67 would look impossible.
         */
        $tally = static function (string $key, string|array $drop, string $order, ?string $expr = null) use ($filter): array {
            $scope = $filter;
            foreach ((array) $drop as $d) {
                unset($scope[$d]);
            }
            $scope['type'] = 'Lens';

            [$clause, $args] = self::productWhere($scope);
            // Emptiness is judged on the stored text even when the value read
            // is numeric: a DECIMAL compared with '' is compared with 0, and
            // CYL 0.00 is the commonest power there is.
            $raw = self::attr($key);
            $expr ??= $raw;

            return Db::all(
                "SELECT {$expr} AS value, COUNT(*) AS n FROM products p
                 WHERE {$clause} AND {$raw} IS NOT NULL AND {$raw} <> ''
                 GROUP BY value
                 ORDER BY {$order}",
                $args,
            );
        };

        $indexes = array_map(
            static fn(array $r): array => ['value' => (string) $r['value'], 'count' => (int) $r['n']],
            $tally('lens_index', 'index', self::attrNum('lens_index') . ' ASC'),
        );

        $found = [];
        foreach ($tally('lens_design', 'design', 'value ASC') as $r) {
            $found[(string) $r['value']] = (int) $r['n'];
        }

        // The canonical three first, then anything the data holds that is not
        // one of them — old values keep working instead of disappearing.
        $designs = [];
        foreach (self::LENS_DESIGNS as $d) {
            $designs[] = ['value' => $d, 'count' => $found[$d] ?? 0];
            unset($found[$d]);
        }
        foreach ($found as $value => $n) {
            $designs[] = ['value' => (string) $value, 'count' => $n];
        }

        /**
         * The coatings, most-stocked first.
         *
         * Alphabetical would put "Blue" above "Transition-Blue" and tell nobody
         * anything; a shop reaches for the coating it sells most of, and that is
         * the order the chips are read in. Unlike the designs there is no
         * canonical list to lead with — a coating is whatever the rep is selling
         * this year, so the catalogue is the only authority on which exist.
         */
        $coatings = array_map(
            static fn(array $r): array => ['value' => (string) $r['value'], 'count' => (int) $r['n']],
            $tally('coating', 'coating', 'n DESC, value ASC'),
        );

        /**
         * The powers stocked, low to high, for the ends of the SPH / CYL range.
         *
         * Read as numbers so "-2" and "-2.00" land on one line, and a range's
         * own ends are dropped before counting it for the same reason a chip
         * row drops its own choice — otherwise narrowing to -2.00..-1.00 would
         * leave every other power offered at 0 and the range could only shrink.
         */
        $powers = static fn(string $key): array => array_map(
            static fn(array $r): array => ['value' => number_format((float) $r['value'], 2, '.', ''), 'count' => (int) $r['n']],
            $tally($key, ["{$key}_from", "{$key}_to"], 'value ASC', self::attrNum($key)),
        );

        return [
            'indexes'  => $indexes,
            'designs'  => $designs,
            'coatings' => $coatings,
            'sphs'     => $powers('sph'),
            'cyls'     => $powers('cyl'),
            // ค่า ADD ที่มีของ — ว่างเมื่อรายการไม่มีเลนส์ที่มี ADD เลย หน้าจอไม่วาดช่องนี้
            'adds'     => $powers('add'),
        ];
    }

    /** @return list<array<string,mixed>> */
    public static function categories(): array
    {
        return array_map(
            static fn($c) => ['id' => (int) $c['id'], 'code' => $c['code'], 'name' => $c['name']],
            Db::all('SELECT id, code, name FROM categories ORDER BY code ASC'),
        );
    }

    /**
     * The names and brands already in the catalogue, for a form to offer back.
     *
     * Scoped to one product type because that is the only scope in which they
     * mean anything: the brands that make lenses are not the brands that make
     * cases, and offering all of them at once is how "Hoya" ends up on a cloth.
     *
     * Suggestions, never a closed list — the form still takes anything typed.
     * A shop's first Zeiss frame has to be enterable on the day it arrives, and
     * a picker that refuses it teaches people to put the brand in the name.
     *
     * @return array{names:list<string>,brands:list<string>,values:array<string,list<string>>}
     */
    /**
     * Every spec value this type has ever been given, keyed by attribute.
     *
     * The form offers these back so the same coating is not entered as
     * "MultiCoat", "Multi Coat" and "multicoat" across three weeks — three
     * spellings that make three unsearchable products out of one. The seeded
     * lists in the form cover the day the catalogue is empty; this covers every
     * day after it, and it grows on its own as things are added.
     *
     * Scoped to one type for the same reason the names and brands are: the
     * sizes a frame comes in are not the sizes a cloth comes in.
     *
     * A whitelist of keys rather than everything found in `attributes`: that
     * column is written by two systems and holds whatever either put there, and
     * a picker is not the place to discover what the other one has been storing.
     *
     * @return array<string,list<string>>
     */
    private static function attributeHints(string $type): array
    {
        $keys = match ($type) {
            'Lens'       => ['model', 'coating', 'lens_index', 'lens_design'],
            'Frame'      => ['model', 'color', 'size', 'material', 'product_line'],
            'Sunglass'   => ['model', 'color', 'size', 'material', 'tint', 'product_line'],
            'ContactLen' => ['model', 'bc', 'dia', 'pack', 'wear'],
            'Accessory'  => ['model', 'kind', 'color', 'size', 'volume'],
            default      => ['model'],
        };

        $out = [];
        foreach ($keys as $key) {
            $rows = Db::all(
                'SELECT DISTINCT ' . self::attr($key) . ' AS v
                 FROM products p
                 WHERE p.product_type = ? AND ' . self::attr($key) . " IS NOT NULL
                   AND " . self::attr($key) . " <> ''
                 ORDER BY v ASC",
                [$type],
            );
            $out[$key] = array_map(static fn($r): string => (string) $r['v'], $rows);
        }

        return $out;
    }

    public static function productHints(string $type): array
    {
        $column = static fn(string $col): array => array_map(
            static fn($r) => (string) $r[$col],
            Db::all(
                "SELECT DISTINCT {$col} FROM products
                 WHERE product_type = ? AND {$col} IS NOT NULL AND {$col} <> ''
                 ORDER BY {$col} ASC",
                [$type],
            ),
        );

        return [
            'names'  => $column('name'),
            'brands' => $column('brand'),
            // Keyed by attribute, so the form can offer each spec box back what
            // that box has held before without knowing which keys exist.
            'values' => self::attributeHints($type),
        ];
    }

    /**
     * How many products sit in each stock state, for the chips above the list.
     *
     * Counted over the same conditions the list is filtered by — minus the
     * state itself, so each chip says how many rows it would show rather than
     * how many are showing now. A chip that reported the current filter would
     * read zero for every state but the one already chosen.
     *
     * @param array<string,mixed> $filter
     * @return array<string,int>
     */
    public static function stockStateCounts(array $filter): array
    {
        // ถอยไปตรงบางคำหรือไม่ ตัดสินจากตัวกรองชุดเดียวกับรายการ — ก่อนทิ้งสถานะ
        $filter = self::searchScope($filter);
        unset($filter['state']);
        [$clause, $args] = self::productWhere($filter);

        $of = static function (string $extra) use ($clause, $args): int {
            return (int) Db::value(
                "SELECT COUNT(*) FROM products p WHERE {$clause} AND {$extra}",
                $args,
            );
        };

        return [
            'all' => (int) Db::value("SELECT COUNT(*) FROM products p WHERE {$clause}", $args),
            'in' => $of('EXISTS (SELECT 1 FROM stock_lots l2
                                 WHERE l2.product_id = p.id AND l2.remaining_qty > 0)'),
            'awaiting-cost' => $of('EXISTS (SELECT 1 FROM stock_lots l2
                                            WHERE l2.product_id = p.id AND l2.cost_per_unit IS NULL)'),
            'expiring' => $of('EXISTS (SELECT 1 FROM stock_lots l2
                                       WHERE l2.product_id = p.id AND l2.remaining_qty > 0
                                         AND l2.expiry_date IS NOT NULL
                                         AND l2.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 90 DAY))'),
            'out' => $of('p.is_custom_made = 0 AND NOT EXISTS (
                              SELECT 1 FROM stock_lots l2
                              WHERE l2.product_id = p.id AND l2.remaining_qty > 0)'),
            'low' => $of(self::LOW_STOCK),
            'backorder' => $of(self::BACKORDER),
            'alerted' => $of(self::ALERTED),
            'ordering' => $of(self::ORDERING),
        ];
    }

    /** @return list<array<string,mixed>> */
    public static function suppliers(): array
    {
        return array_map(
            static fn($s) => ['id' => (int) $s['id'], 'name' => $s['name']],
            Db::all('SELECT id, name FROM suppliers WHERE active = 1 ORDER BY name ASC'),
        );
    }

    /**
     * ผู้ขายจากชื่อที่พิมพ์ในช่องผู้ขาย — มีอยู่แล้ว (ไม่สนตัวพิมพ์/ช่องว่างหัวท้าย) ใช้ตัวเดิม ไม่มีก็เพิ่ม
     *
     * ร้านขอ 18 ก.ย. 2026: ดรอปดาวน์ผู้ขายพิมพ์เพิ่มไม่ได้ และตารางผู้ขายยังว่างทั้งตาราง · คนรับของ
     * รู้ชื่อผู้ขายจากใบส่งของที่ถืออยู่ ให้พิมพ์ลงไปเลย ไม่ต้องไปเพิ่มที่หน้าซัพพลายเออร์ของฝั่งการเงินก่อน
     * รายละเอียดอื่น (คนติดต่อ เบอร์) ยังแก้ที่หน้านั้น
     *
     * @return array{id:int,name:string,created:bool}
     */
    public static function supplierByName(string $name): array
    {
        $name = trim(preg_replace('/\s+/u', ' ', $name) ?? '');
        if ($name === '') {
            throw \Optic\ApiError::badRequest('ต้องระบุชื่อผู้ขาย', 'missing_field');
        }
        if (mb_strlen($name) > 120) {
            throw \Optic\ApiError::badRequest('ชื่อผู้ขายยาวเกิน 120 ตัวอักษร', 'field_too_long');
        }
        $found = Db::one('SELECT id, name, active FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(?)', [$name]);
        if ($found !== null) {
            if (!(int) $found['active']) {
                Db::run('UPDATE suppliers SET active = 1 WHERE id = ?', [$found['id']]);
            }
            return ['id' => (int) $found['id'], 'name' => $found['name'], 'created' => false];
        }
        Db::run('INSERT INTO suppliers (name) VALUES (?)', [$name]);
        return ['id' => (int) Db::value('SELECT id FROM suppliers WHERE name = ?', [$name]), 'name' => $name, 'created' => true];
    }

    /** Numbers the dashboard shows above the list. @return array<string,mixed> */
    public static function summary(bool $money = false): array
    {
        $eye = Db::one(
            'SELECT SUM(' . self::EYE_SIDE . " = 'left')  AS l,
                    SUM(" . self::EYE_SIDE . " = 'right') AS r,
                    SUM(" . self::EYE_SIDE . ' IS NULL)   AS u
             FROM products p'
        );

        return [
            'products'       => (int) Db::value('SELECT COUNT(*) FROM products'),
            'lots'           => (int) Db::value('SELECT COUNT(*) FROM stock_lots'),
            'onHand'         => (int) Db::value('SELECT COALESCE(SUM(remaining_qty), 0) FROM stock_lots'),
            'stockValue'     => $money ? (float) Db::value(
                'SELECT COALESCE(SUM(CASE WHEN cost_per_unit IS NULL THEN 0
                                          ELSE remaining_qty * cost_per_unit END), 0) FROM stock_lots'
            ) : null,
            'lotsMissingCost' => (int) Db::value(
                'SELECT COUNT(*) FROM stock_lots WHERE cost_per_unit IS NULL AND remaining_qty > 0'
            ),
            'rxAwaitingCost' => (int) Db::value(
                "SELECT COUNT(*) FROM inventory_logs WHERE action_type = 'RX_ORDER' AND unit_cost IS NULL"
            ),
            // Not windowed by anything: what is below its minimum is below it
            // today, whatever dates are on screen.
            'lowStock' => (int) Db::value(
                'SELECT COUNT(*) FROM products p WHERE ' . self::LOW_STOCK
            ),
            'eyeSide'        => [
                'left'  => (int) ($eye['l'] ?? 0),
                'right' => (int) ($eye['r'] ?? 0),
                'unset' => (int) ($eye['u'] ?? 0),
            ],
        ];
    }

    /* --------------------------------------------------------------- shapes */

    /** @param array<string,mixed> $r @return array<string,mixed> */
    private static function shapeProduct(array $r, bool $money): array
    {
        return [
            'id'              => (int) $r['id'],
            'sku'             => $r['sku'],
            'name'            => $r['name'],
            'brand'           => $r['brand'],
            'productType'     => $r['product_type'],
            'categoryId'      => (int) $r['category_id'],
            'basePrice'       => (float) $r['base_selling_price'],
            // 0 means nobody set one. The screens read it as "no alert", never
            // as a minimum that is already met.
            'minStock'        => (int) $r['min_stock'],
            'isCustomMade'    => (bool) $r['is_custom_made'],
            'eyeSide'         => $r['eye_side'],
            // Lens spec, so a list of lenses can be told apart without opening
            // each one. Null for everything that is not a lens, and for a lens
            // whose spec was never filled in.
            ...self::lensKeys($r),
            'onHand'          => (int) $r['on_hand'],
            // Buying prices only travel to people allowed to see them. The key
            // stays present and set to null so the shape never changes; the
            // screens ask the signed-in role, not this null, what to draw.
            'stockValue'      => $money ? round((float) $r['stock_value'], 2) : null,
            'lotsMissingCost' => (int) $r['lots_missing_cost'],
            // null means the next lot out has no invoice yet — not that it is free.
            'nextCost'        => $money && $r['next_cost'] !== null ? (float) $r['next_cost'] : null,
            'lowStockNotifiedAt' => self::thaiStamp($r['low_stock_notified_at'] ?? null),
        ];
    }

    /**
     * เวลาที่เตือนของใกล้หมด เป็นเวลาไทยเสมอ
     *
     * ก่อน 2026-09-12 06:36:14 UTC (13:36 น.) PDO ของเว็บยังไม่ได้ตั้งเขตเวลา `NOW()` บน
     * เซิร์ฟเวอร์จริงจึงลงเป็น UTC · ธงนี้ตั้งจากคำขอบนเว็บเท่านั้น (`LowStock::flush`) ค่าที่เก่า
     * กว่าเส้นนั้นจึงเป็น UTC ทั้งหมด บวกเจ็ดชั่วโมง · ค่าหลังจากนั้นเป็นเวลาไทยซึ่งเร็วที่สุดคือ
     * 13:36 น. ของวันเดียวกัน จึงไม่มีทางปนกับค่า UTC ที่ช้าที่สุด (06:36)
     */
    private static function thaiStamp(?string $at): ?string
    {
        if ($at === null || $at === '') {
            return null;
        }
        if ($at >= self::TZ_PINNED_AT) {
            return $at;
        }
        return (new \DateTimeImmutable($at, new \DateTimeZone('UTC')))
            ->setTimezone(new \DateTimeZone('Asia/Bangkok'))
            ->format('Y-m-d H:i:s');
    }

    /**
     * The seven lens keys, shaped the same way wherever they are read from.
     *
     * Two places produce them and they must not drift: the list query pulls them
     * out of `attributes` in SQL, and the single-product query has the whole
     * object decoded already and reads them straight from it. Both hand this the
     * same key names, so both get the same shape — a drawer that says "SPH 0.00"
     * where the row behind it says "—" is worse than one that says nothing, and
     * that is exactly what happened while these were written out twice.
     *
     * @param array<string,mixed> $a `attributes`, or the aliased row from the list query
     * @return array<string,mixed>
     */
    private static function lensKeys(array $a): array
    {
        return [
            // Which of the maker's products this is — half of every composed
            // name, and the first thing an order sheet copies from a lens.
            'model'      => self::text($a['model'] ?? null),
            'lensDesign' => self::text($a['lens_design'] ?? null),
            'lensIndex'  => self::text($a['lens_index'] ?? null),
            'coating'    => self::text($a['coating'] ?? null),
            'sph'        => self::num($a['sph'] ?? null),
            'cyl'        => self::num($a['cyl'] ?? null),
            'axis'       => self::num($a['axis'] ?? null),
            // Kept as written — "+2.00" reads as an ADD, "2" does not.
            'add'        => self::text($a['add'] ?? null),
        ];
    }

    /**
     * An attribute as text, or null.
     *
     * `attributes` is free-form JSON written by two systems, so a key that holds
     * a string on one row can hold a number on the next, and a JSON null decodes
     * to PHP null here but to the four-letter string "null" through SQL. Both
     * become null, so the screens never draw the word "null" as a coating.
     */
    private static function text(mixed $v): ?string
    {
        if ($v === null || $v === '' || $v === 'null' || !is_scalar($v)) {
            return null;
        }

        return (string) $v;
    }

    /**
     * A power that a screen can do arithmetic on, or null.
     *
     * `attributes` is free-form JSON written by two systems, so a key that
     * should hold −2.25 can arrive as the string "−2.25", as "" or missing.
     * Anything that is not a number becomes null rather than 0 — a lens with no
     * recorded SPH is not a plano lens.
     */
    private static function num(mixed $v): ?float
    {
        return is_numeric($v) ? (float) $v : null;
    }

    /** @param array<string,mixed> $r @return array<string,mixed> */
    private static function shapeLot(array $r, bool $money): array
    {
        return [
            'id'           => (int) $r['id'],
            'lotNumber'    => $r['lot_number'],
            'supplierId'   => $r['supplier_id'] === null ? null : (int) $r['supplier_id'],
            'supplierName' => $r['supplier_name'],
            'costPerUnit'  => $money && $r['cost_per_unit'] !== null ? (float) $r['cost_per_unit'] : null,
            'initialQty'   => (int) $r['initial_qty'],
            'remainingQty' => (int) $r['remaining_qty'],
            'receivedDate' => $r['received_date'],
            'expiryDate'   => $r['expiry_date'],
            'notes'        => $r['notes'],
        ];
    }

    /** @param array<string,mixed> $r @return array<string,mixed> */
    private static function shapeLotRow(array $r, bool $money): array
    {
        $cost = $money && $r['cost_per_unit'] !== null ? (float) $r['cost_per_unit'] : null;

        return [
            'id'           => (int) $r['id'],
            'lotNumber'    => $r['lot_number'],
            'productId'    => (int) $r['product_id'],
            'sku'          => $r['sku'],
            'productName'  => $r['product_name'],
            'productType'  => $r['product_type'],
            'supplierName' => $r['supplier_name'],
            'costPerUnit'  => $cost,
            'initialQty'   => (int) $r['initial_qty'],
            'remainingQty' => (int) $r['remaining_qty'],
            'receivedDate' => $r['received_date'],
            'expiryDate'   => $r['expiry_date'],
            'expiringSoon' => (bool) $r['expiring_soon'],
            'value'        => $cost === null ? null : round($cost * (int) $r['remaining_qty'], 2),
        ];
    }

    /** @param array<string,mixed> $r @return array<string,mixed> */
    private static function shapeLog(array $r, bool $money): array
    {
        return [
            'id'            => (int) $r['id'],
            'actionType'    => $r['action_type'],
            'actionLabel'   => self::ACTION_LABEL[$r['action_type']] ?? $r['action_type'],
            'quantity'      => (int) $r['quantity'],
            'balanceAfter'  => isset($r['balance_after']) ? (int) $r['balance_after'] : null,
            'unitCost'      => $money && $r['unit_cost'] !== null ? (float) $r['unit_cost'] : null,
            /* ราคาขายไม่ถูกกั้นด้วย $money ต่างจากต้นทุน — คนขายต้องเห็นราคาขาย
               เพราะการบอกราคาคือหน้าที่ของเขา ส่วนราคาที่ซื้อมาไม่ใช่ */
            'salePrice'     => isset($r['sale_price']) && $r['sale_price'] !== null
                ? (float) $r['sale_price']
                : null,
            'referenceDoc'  => $r['reference_doc'],
            'notes'         => $r['notes'],
            'createdAt'     => $r['created_at'],
            'createdBy'     => $r['created_by'] === null ? null : (int) $r['created_by'],
            'createdByKind' => $r['created_by_kind'] ?? null,
            // Who keyed it in. Kept distinct from `issuedTo` below, because the
            // person at the keyboard is regularly not the person taking stock.
            'actorName'     => $r['actor_name'] ?? null,
            'issuedToId'    => isset($r['issued_to_admin_id']) && $r['issued_to_admin_id'] !== null
                ? (int) $r['issued_to_admin_id']
                : null,
            'issuedToName'  => $r['issued_to_name'] ?? null,
            // ชื่อคนที่ทำของเสียที่พิมพ์ไว้ตอนตัด (034) — คนละคนกับ actorName ที่คีย์
            'scrapBy'       => $r['scrap_by'] ?? null,
            // แถวจ่ายออกนี้ถูกยกเลิก (คืนของ) ไปแล้วหรือยัง — 035 · ShopIssue::cancel
            'returned'      => (bool) ($r['returned'] ?? false),
            // เคสหน้าร้านที่ตัดของรายการนี้ — แถวแบบนี้แก้ที่หน้าเคส ไม่ใช่ที่คลัง
            'caseId'        => isset($r['case_id']) && $r['case_id'] !== null ? (int) $r['case_id'] : null,
            'branchIssueId' => isset($r['branch_issue_id']) && $r['branch_issue_id'] !== null
                ? (int) $r['branch_issue_id']
                : null,
            'branchName'    => $r['branch_name'] ?? null,
            'takenBy'       => $r['taken_by'] ?? null,
            'branchStatus'  => $r['branch_status'] ?? null,
            'branchStatusLabel' => match ($r['branch_status'] ?? null) {
                'pending'     => 'ค้างรับเงิน',
                'settled'     => 'รับเงินแล้ว',
                'written_off' => 'ตัดหนี้สูญ',
                'cancelled'   => 'ยกเลิก (คืนของ)',
                default       => null,
            },
            'settledAmount' => $money && isset($r['settled_amount']) && $r['settled_amount'] !== null
                ? (float) $r['settled_amount']
                : null,
            'settledAt'     => $r['settled_at'] ?? null,
            // Profit exists only once the branch has paid, and it belongs to the
            // day it was paid — never to the day the goods left.
            'branchProfit'  => $money && ($r['branch_status'] ?? null) === 'settled' && isset($r['settled_amount'])
                ? round((float) $r['settled_amount'] - (float) ($r['cost_total'] ?? 0), 2)
                : null,
            'productId'     => isset($r['product_id']) ? (int) $r['product_id'] : null,
            'sku'           => $r['sku'] ?? null,
            'productName'   => $r['product_name'] ?? null,
            // The catalogue price as it stands now, not what the goods sold for
            // — this ledger records what moved, and a sale gets its price in the
            // shop-floor system. Sent to every role: the permission table makes
            // ราคาขาย readable by all, unlike cost.
            'basePrice'     => isset($r['base_selling_price']) ? (float) $r['base_selling_price'] : null,
            'lotNumber'     => $r['lot_number'],
        ];
    }

    /**
     * What a new lot of an existing product should start out saying.
     *
     * The product's own identity — SKU, name, brand — is never retyped: it is
     * read from the product record, because a second lot of the same thing is
     * the same thing. What varies between deliveries (supplier, cost, lot
     * number) is offered as the last known answer rather than imposed, since
     * those genuinely do change.
     *
     * @return array<string,mixed>
     */
    public static function receiveDefaults(string $sku, bool $money = false): array
    {
        $p = Db::one(
            'SELECT id, sku, name, brand, is_custom_made FROM products WHERE sku = ?',
            [$sku],
        );
        if ($p === null) {
            throw ApiError::unknownSku($sku);
        }

        $last = Db::one(
            'SELECT l.id, l.lot_number, l.supplier_id, sup.name AS supplier_name,
                    l.cost_per_unit, l.initial_qty, l.remaining_qty, l.expiry_date, l.received_date
             FROM stock_lots l
             LEFT JOIN suppliers sup ON sup.id = l.supplier_id
             WHERE l.product_id = ?
             ORDER BY l.received_date DESC, l.id DESC
             LIMIT 1',
            [$p['id']],
        );

        return [
            'sku'          => $p['sku'],
            'name'         => $p['name'],
            'brand'        => $p['brand'],
            'isCustomMade' => (bool) $p['is_custom_made'],
            'lastLot'      => $last === null ? null : [
                'id'           => (int) $last['id'],
                'lotNumber'    => $last['lot_number'],
                'supplierId'   => $last['supplier_id'] === null ? null : (int) $last['supplier_id'],
                'supplierName' => $last['supplier_name'],
                'costPerUnit'  => $money && $last['cost_per_unit'] !== null ? (float) $last['cost_per_unit'] : null,
                'quantity'     => (int) $last['initial_qty'],
                'remainingQty' => (int) $last['remaining_qty'],
                'expiryDate'   => $last['expiry_date'],
                'receivedDate' => $last['received_date'],
            ],
            'suggestedLotNumber' => $last === null
                ? null
                : self::nextLotNumber((string) $last['lot_number']),
        ];
    }

    /**
     * "LOT-2026-014" becomes "LOT-2026-015"; anything without a number on the
     * end gets no suggestion at all rather than a wrong one, because a lot
     * number is the supplier's word and guessing it invents a document.
     */
    private static function nextLotNumber(string $previous): ?string
    {
        if (!preg_match('/^(.*?)(\d+)$/', $previous, $m)) {
            return null;
        }

        $next = (string) ((int) $m[2] + 1);

        return $m[1] . str_pad($next, strlen($m[2]), '0', STR_PAD_LEFT);
    }

    /**
     * Clamps a requested page into the range that actually exists.
     *
     * Out of range is corrected rather than refused: a page number can go stale
     * simply because someone else added a row, and answering an error to that is
     * no help to the person looking at the screen.
     *
     * @return array{0:int,1:int} page number and its row offset
     */
    private static function pageOf(mixed $raw, int $total, int $per = self::PER_PAGE): array
    {
        $last = max(1, (int) ceil($total / $per));
        $page = max(1, min(is_numeric($raw) ? (int) $raw : 1, $last));

        return [$page, ($page - 1) * $per];
    }

    /** Clamps a requested page size, falling back to the default for junk. */
    private static function perPage(mixed $raw): int
    {
        if (!is_numeric($raw)) {
            return self::PER_PAGE;
        }
        return max(self::PER_PAGE_MIN, min((int) $raw, self::PER_PAGE_MAX));
    }
}
