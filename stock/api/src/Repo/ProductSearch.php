<?php

declare(strict_types=1);

namespace Optic\Repo;

/**
 * ช่องค้นหาสินค้าของระบบคลัง — กติกาเดียวกับช่องค้นหาสินค้าของหน้าขายหน้าบ้าน
 *
 * ต้นฉบับอยู่ที่ `api/core/StockSearch.php` · ย้ายมาเป็นของคลังเอง ไม่ได้ require
 * ข้ามไป เพราะสองระบบไม่ใช้โค้ดร่วมกัน และหน้าบ้านค้นบนวิว `v_stock_lot` ส่วนคลังค้น
 * บนตาราง `products p` ตรง ๆ · **แก้กติกาฝั่งไหน ดูอีกฝั่งด้วย** คนใช้คาดว่าช่อง
 * ค้นหาสองระบบได้ผลเหมือนกัน
 *
 * เดิมคำที่พิมพ์ทั้งช่องถูกส่งไป `LIKE '%…%'` ก้อนเดียว "MC 1.6" จึงได้ศูนย์แถว
 * เพราะชื่อจริงคือ "Autograph MC Single Vision (1.60)" — MC กับ 1.60 ห่างกันสี่คำ
 *
 * กฎ:
 *   · **กรอง** (where) — ตัดเป็นคำ ๆ ต้องเจอครบทุกคำ (AND) แต่ละคำเจอที่คอลัมน์ไหน
 *     ก็ได้ (OR) · ตัวเลขทศนิยมเทียบเป็นค่า "1.6" เจอ 1.60 แต่ไม่เจอ 1.67
 *   · **เรียง** (rank) — SKU หรือชื่อตรงเป๊ะ > ครบทุกคำแบบเต็มคำและเรียงตามลำดับ
 *     ในชื่อ > ครบทุกคำแบบเต็มคำ > ครบทุกคำแต่บางคำเจอแค่บางส่วน > ตรงบางคำ
 *
 * ทดสอบที่ `tests/16-product-search.test.php`
 */
final class ProductSearch
{
    /**
     * แถวสูงสุดที่ดึงมาจัดอันดับก่อนแบ่งหน้า — เท่ากับหน้าบ้าน
     *
     * ต้องจัดอันดับก่อนตัดเป็นหน้า ไม่ใช่ตัดก่อน ไม่งั้นตัวที่ตรงที่สุดตกไปอยู่หน้าหลัง
     */
    public const RANK_POOL = 5000;

    /** พิมพ์ยาวเกินนี้ไม่ได้ช่วยให้เจอ มีแต่ทำให้ SQL ยาวขึ้น */
    private const MAX_TOKENS = 8;

    /** คำเรียกเดียวกันที่คนกรอกเขียนไม่เหมือนกัน — วงเดียวกับหน้าบ้าน */
    private const SYNONYMS = [
        ['mc', 'multicoat'],
    ];

    /** คุณสมบัติใน `attributes` ที่ค้นได้ นอกจากชื่อ แบรนด์ และ SKU */
    private const ATTRS = [
        'coating', 'lens_design', 'model', 'color', 'tint', 'addons', 'product_line', 'vendor_name',
    ];

    /** ช่องที่นับว่า "เจอเต็มคำ" ได้ตอนจัดอันดับ นอกจากชื่อกับ SKU ซึ่งมีกติกาของตัวเอง */
    private const RANK_FIELDS = [
        'brand', 'vendor_name', 'coating', 'lens_design', 'lens_index',
        'model', 'color', 'tint', 'addons', 'product_line',
    ];

    /**
     * ค่าหนึ่งตัวใน `attributes` — นิพจน์เดียวกับ `Inventory::attr`
     *
     * MariaDB 10.4 ไม่มี `->>` · NULLIF เพราะ JSON null ออกมาเป็นสตริง "null"
     */
    private static function attr(string $key): string
    {
        return "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes, '$.{$key}')), 'null')";
    }

    /** คอลัมน์ที่ rank() อ่าน สำหรับ SELECT บน `products p` */
    public static function rankColumns(): string
    {
        $cols = ['p.id', 'p.sku', 'p.name', 'p.brand', self::attr('lens_index') . ' AS lens_index'];
        foreach (self::ATTRS as $key) {
            $cols[] = self::attr($key) . " AS {$key}";
        }
        return implode(', ', $cols);
    }

    /**
     * คำที่พิมพ์มา ตัดเป็นคำ ๆ
     *
     * ตัดที่ `/` ด้วย เพราะค่าสายตาเขียนคู่กันเป็น "-0.25/-0.50" · วงเล็บรอบคำถูกลอก
     * ออก เพราะคนก๊อป "(1.50)" มาจากชื่อสินค้า · ขีดกลางไม่ตัด "LNS-0748" เป็นคำเดียว
     *
     * @return list<string>
     */
    public static function tokens(string $term): array
    {
        $tokens = [];
        // "Add+1.50" พิมพ์ติดกัน = "Add +1.50" ในชื่อสินค้า — ตัวอักษรที่ต่อด้วยเครื่องหมาย+เลขถูกแยกเป็นสองคำ
        $term = preg_replace('~(?<=\p{L})(?=[+\-]\d)~u', ' ', $term) ?? $term;
        foreach (preg_split('~[\s/]+~u', trim($term)) ?: [] as $tok) {
            $tok = trim($tok, '()[]{},;');
            if ($tok !== '') {
                $tokens[] = $tok;
            }
        }
        return array_slice($tokens, 0, self::MAX_TOKENS);
    }

    /**
     * เงื่อนไข WHERE บน `products p` สำหรับคำที่พิมพ์มาทั้งช่อง
     *
     * $any = ตรงคำใดคำหนึ่งก็พอ — ใช้ตอนที่ไม่มีสินค้าตัวไหนตรงครบทุกคำ
     *
     * @return array{0:string,1:list<mixed>} คืนสตริงว่างเมื่อไม่มีอะไรให้กรอง
     */
    public static function where(string $term, bool $any = false): array
    {
        [$rest, $pairs] = self::powers($term);
        $tokens = self::tokens($rest);
        if ($tokens === [] && $pairs === []) {
            return ['', []];
        }

        $groups = [];
        $args = [];
        foreach ($tokens as $tok) {
            [$sql, $a] = self::token($tok);
            $groups[] = $sql;
            array_push($args, ...$a);
        }
        $where = $groups === [] ? [] : ['(' . implode($any ? ' OR ' : ' AND ', $groups) . ')'];

        /* คู่ค่าสายตาต้องตรงเสมอ แม้ตอนถอยไปตรงบางคำ ($any) — คนพิมพ์ -1.25/-1.75 ต้องการเลนส์
           ค่านี้ ไม่ใช่เลนส์ยี่ห้อเดียวกันค่าไหนก็ได้ */
        $num = static fn(string $key): string =>
            'CAST(COALESCE(NULLIF(' . self::attr($key) . ", ''), '0') AS DECIMAL(6,2))";
        // สินค้าที่ไม่มีค่าสายตาในสเปก (คีย์ชื่อเอง) ยังหาเจอจากชื่อที่เขียนคู่ค่าเดียวกันไว้
        $fmt = static fn(float $v): string => $v > 0 ? sprintf('+%.2f', $v) : ($v < 0 ? sprintf('-%.2f', -$v) : '0.00');
        foreach ($pairs as [$sph, $cyl]) {
            $where[] = '((' . $num('sph') . ' = ? AND ' . $num('cyl') . ' = ?) OR ('
                . self::attr('sph') . ' IS NULL AND p.name LIKE ?))';
            array_push($args, $sph, $cyl, '%' . $fmt($sph) . '/' . $fmt($cyl) . '%');
        }

        return ['(' . implode(' AND ', $where) . ')', $args];
    }

    /**
     * คู่ค่าสายตาที่พิมพ์ในช่องค้นหา — "-1.25/-1.75" คือ SPH -1.25 กับ CYL -1.75 (ร้านขอ 18 ก.ย. 2026)
     *
     * เดิม "/" ตัดเป็นสองคำ แล้วแต่ละคำเจอที่ไหนก็ได้ในชื่อ เลนส์ -1.75/-1.25 (สลับกัน) จึงขึ้นมาด้วย ·
     * ตอนนี้คู่ไหนที่เป็นตัวเลขทั้งสองข้าง ถูกดึงออกมาเทียบกับ sph / cyl ในสเปกแบบตัวเลข
     * (-2 = -2.00) · CYL ของร้านเป็นลบเสมอ พิมพ์ไม่ใส่ลบก็ถือเป็นลบ · สินค้าที่ไม่มี CYL
     * (คอนแทคเลนส์ใส) นับเป็น 0.00 · คำที่เหลือค้นแบบเดิม
     *
     * @return array{0:string,1:list<array{0:float,1:float}>} [คำที่เหลือ, คู่ [sph, cyl]]
     */
    public static function powers(string $term): array
    {
        $pairs = [];
        $rest = preg_replace_callback(
            '~(?<![\w.])([+\-\x{2212}]?(?:\d{1,2}(?:\.\d{1,2})?|\d{3,4}))\s*/\s*([+\-\x{2212}]?(?:\d{1,2}(?:\.\d{1,2})?|\d{3,4}))(?![\w.])~u',
            static function (array $m) use (&$pairs): string {
                // "-350" พิมพ์ไม่ใส่จุด = -3.50 (ค่าสายตาไม่เคยเกิน ±20 เลขสามสี่หลักจึงเป็นหน่วยร้อย)
                $val = static function (string $t): float {
                    $t = str_replace("\u{2212}", '-', $t);
                    $v = (float) $t;
                    return !str_contains($t, '.') && abs($v) >= 100 ? $v / 100 : $v;
                };
                $sph = $val($m[1]);
                $cyl = -abs($val($m[2]));
                $pairs[] = [round($sph, 2), round($cyl, 2)];
                return ' ';
            },
            $term,
        );
        return [trim((string) $rest), $pairs];
    }

    /** @return list<string> */
    private static function columns(): array
    {
        $cols = ['p.name', 'p.brand', 'p.sku'];
        foreach (self::ATTRS as $key) {
            $cols[] = self::attr($key);
        }
        return $cols;
    }

    /**
     * เงื่อนไขของคำเดียว — คำนี้ต้องเจอที่ไหนสักที่
     *
     * @return array{0:string,1:list<mixed>}
     */
    private static function token(string $tok): array
    {
        $parts = [];
        $args = [];

        /* ตัวเลขทศนิยมคือค่าเลนส์ — "1.6" ต้องได้ 1.60 และต้องไม่ได้ 1.67 ซึ่งเป็นเลนส์
           คนละตัว · LIKE '%1.6%' ให้ทั้งสองอย่าง จึงเทียบเป็นตัวเลข */
        $num = self::number($tok);
        if ($num !== null) {
            // index ไม่มีเครื่องหมาย — "-2.50" คือค่าสายตา ไม่ต้องเทียบ index
            if ($num['sign'] === '' && strlen($num['int']) <= 2) {
                $index = self::attr('lens_index');
                $parts[] = "({$index} <> '' AND CAST({$index} AS DECIMAL(4,2)) = CAST(? AS DECIMAL(4,2)))";
                $args[] = $tok;
            }
            // ตัวเลขที่เขียนอยู่ในชื่อเอง เช่นค่าสายตาใน "... -0.25/-0.25"
            $pattern = self::numberPattern($tok);
            foreach (self::columns() as $col) {
                $parts[] = "{$col} REGEXP ?";
                $args[] = $pattern;
            }
            return ['(' . implode(' OR ', $parts) . ')', $args];
        }

        foreach (self::words($tok) as $word) {
            $like = self::like($word);
            foreach (self::columns() as $col) {
                $parts[] = "{$col} LIKE ?";
                $args[] = $like;
            }
        }
        return ['(' . implode(' OR ', $parts) . ')', $args];
    }

    /** `%คำ%` ที่ % _ และ \ ในคำที่พิมพ์ถูกอ่านเป็นตัวอักษร ไม่ใช่ wildcard */
    private static function like(string $word): string
    {
        return '%' . addcslashes($word, '\\%_') . '%';
    }

    /**
     * เลขทศนิยมแยกเป็นส่วน ๆ ที่เทียบกันได้ — "1.50" กับ "1.5" ได้ค่าเดียวกัน
     *
     * เฉพาะเลขที่มีจุด · เลขล้วน ("0748") ค้นแบบข้อความ เพราะเป็นส่วนของ SKU ได้
     *
     * @return array{sign:string,int:string,frac:string}|null
     */
    private static function number(string $tok): ?array
    {
        if (!preg_match('/^([+-]?)(\d+)\.(\d+)$/', $tok, $m)) {
            return null;
        }
        return ['sign' => $m[1], 'int' => ltrim($m[2], '0') ?: '0', 'frac' => rtrim($m[3], '0')];
    }

    /**
     * ตัวเลขนี้แบบเต็มจำนวน ไม่ใช่ส่วนหัวของเลขที่ยาวกว่า — ใช้ได้ทั้ง REGEXP และ preg_match
     *
     * ศูนย์ท้ายเติมได้: "1.5" เจอ "1.50" · ไม่พิมพ์เครื่องหมาย = เครื่องหมายไหนก็ได้
     * · พิมพ์ "-" ต้องเป็นลบ · "+" = บวกหรือไม่มี
     */
    private static function numberPattern(string $tok): string
    {
        $n = self::number($tok);
        if ($n === null) {
            return '(^|[^0-9.])' . str_replace('.', '[.]', $tok) . '($|[^0-9])';
        }
        // ศูนย์ไม่มีเครื่องหมาย — ชื่อสินค้าเขียน 0.00 เสมอ คนพิมพ์ "-0.00" หมายถึงตัวเดียวกัน
        if ($n['int'] === '0' && $n['frac'] === '') {
            $n['sign'] = '';
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

    /** @return list<string> คำนี้บวกคำพ้องของมัน */
    private static function words(string $tok): array
    {
        $low = mb_strtolower($tok);
        foreach (self::SYNONYMS as $ring) {
            if (in_array($low, $ring, true)) {
                return $ring;
            }
        }
        return [$tok];
    }

    /**
     * เรียงแถวจากตัวที่ใกล้คำที่พิมพ์ที่สุด — ไม่กรองอะไรออก แค่เรียง
     *
     * ลำดับชั้น (ชั้นเดียวกันเรียงด้วยตัวถัดไป):
     *   0 SKU หรือชื่อสินค้าตรงกับที่พิมพ์ทั้งช่อง
     *   1 ครบทุกคำแบบเต็มคำ และอยู่ในชื่อเรียงตามที่พิมพ์ — คำห่างกันน้อยขึ้นก่อน
     *     "G Blue 1.5": G Blue (ห่าง 2) มาก่อน G Auto-Blue (ห่าง 3)
     *   2 ครบทุกคำแบบเต็มคำ แต่บางคำเจอที่ช่องอื่น หรือสลับลำดับ
     *   3 ครบทุกคำ แต่บางคำเจอแค่เป็นส่วนของคำอื่น — "G" ใน "Single"
     *   4 ตรงแค่บางคำ (มีเฉพาะตอนค้นแบบ $any) — ตรงหลายคำขึ้นก่อน
     * เท่ากันหมดแล้วเรียงชื่อแบบตัวเลขธรรมชาติ ค่าสายตาในรุ่นเดียวกันจึงเรียงต่อกัน
     *
     * @param list<array<string,mixed>> $rows แถวจาก rankColumns()
     * @return list<array<string,mixed>>
     */
    public static function rank(array $rows, string $term): array
    {
        $tokens = self::tokens($term);
        if ($tokens === []) {
            return $rows;
        }

        $keyed = [];
        foreach ($rows as $i => $row) {
            $keyed[] = ['key' => self::score($row, $term, $tokens), 'i' => $i, 'row' => $row];
        }
        usort($keyed, static fn(array $a, array $b): int => ($a['key'] <=> $b['key'])
            ?: strnatcasecmp((string) ($a['row']['name'] ?? ''), (string) ($b['row']['name'] ?? ''))
            ?: $a['i'] <=> $b['i']);

        return array_column($keyed, 'row');
    }

    /**
     * คะแนนของแถวเดียว ยิ่งน้อยยิ่งขึ้นก่อน
     *
     * @param list<string> $tokens
     * @return list<int> [ชั้น, -คำที่เจอ, -คำที่เจอเต็มคำ, ช่องห่างระหว่างคำในชื่อ, ตำแหน่งคำแรกในชื่อ]
     */
    private static function score(array $row, string $term, array $tokens): array
    {
        $name = self::wordsOf((string) ($row['name'] ?? ''));
        $sku = mb_strtolower((string) ($row['sku'] ?? ''));
        $fields = [];
        $hay = [(string) ($row['name'] ?? ''), $sku];
        foreach (self::RANK_FIELDS as $f) {
            $fields[] = self::wordsOf((string) ($row[$f] ?? ''));
            $hay[] = (string) ($row[$f] ?? '');
        }
        $hay = mb_strtolower(implode(' ', $hay));

        $term = trim($term);
        $typed = self::wordsOf($term);
        $exact = $sku === mb_strtolower($term)
            || ($typed !== [] && count($typed) === count($name) && self::runAt($name, $typed, 0));

        $matched = 0;
        $whole = 0;
        $inOrder = true;
        $next = 0;   // คำถัดไปในชื่อต้องอยู่หลังตำแหน่งนี้ถึงจะนับว่าเรียงตามที่พิมพ์
        $gap = 0;
        $start = -1;
        foreach ($tokens as $tok) {
            $words = self::wordsOf($tok);
            $at = $words === [] ? -1 : self::find($name, $words, $next);
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
                || ($words !== [] && self::find($name, $words, 0) >= 0)
                || ($words !== [] && array_filter($fields, fn(array $fw): bool => self::find($fw, $words, 0) >= 0) !== []);
            $whole += $isWhole ? 1 : 0;
            $matched += ($isWhole || self::partial($hay, $tok)) ? 1 : 0;
        }

        $all = count($tokens);
        $tier = match (true) {
            $exact                      => 0,
            $whole === $all && $inOrder => 1,
            $whole === $all             => 2,
            $matched === $all           => 3,
            default                     => 4,
        };

        return [$tier, -$matched, -$whole, $start < 0 ? PHP_INT_MAX : $gap, $start < 0 ? PHP_INT_MAX : $start];
    }

    /**
     * ข้อความตัดเป็นคำตัวพิมพ์เล็ก — ตัวเลขเก็บเครื่องหมายไว้กับตัว ("-0.25") ส่วนขีด
     * ระหว่างตัวอักษรเป็นตัวคั่น ("Auto-Blue" = auto, blue)
     *
     * @return list<string>
     */
    private static function wordsOf(string $text): array
    {
        preg_match_all('/[+-]?\d+(?:\.\d+)?|[\p{L}\p{M}\p{N}]+/u', mb_strtolower($text), $m);
        return $m[0];
    }

    /** ตำแหน่งแรก (ตั้งแต่ $from) ที่คำชุด $needle เรียงติดกันอยู่ใน $hay · ไม่เจอ = -1 */
    private static function find(array $hay, array $needle, int $from): int
    {
        for ($i = $from, $last = count($hay) - count($needle); $i <= $last; $i++) {
            if (self::runAt($hay, $needle, $i)) {
                return $i;
            }
        }
        return -1;
    }

    /** คำชุด $needle อยู่ที่ตำแหน่ง $at ของ $hay พอดีไหม */
    private static function runAt(array $hay, array $needle, int $at): bool
    {
        foreach ($needle as $k => $w) {
            if (!isset($hay[$at + $k]) || !self::sameWord($w, $hay[$at + $k])) {
                return false;
            }
        }
        return true;
    }

    /** คำที่พิมพ์กับคำในข้อมูลคือคำเดียวกันไหม — ตัวเลขเทียบเป็นค่า กติกาเดียวกับ numberPattern() */
    private static function sameWord(string $typed, string $word): bool
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
        foreach (self::SYNONYMS as $ring) {
            if (in_array($typed, $ring, true) && in_array($word, $ring, true)) {
                return true;
            }
        }
        return false;
    }

    /** คำนี้อยู่ในข้อความรวมของแถวแบบบางส่วนไหม — กติกาเดียวกับ SQL ใน token() */
    private static function partial(string $hay, string $tok): bool
    {
        if (self::number($tok) !== null) {
            return preg_match('/' . self::numberPattern($tok) . '/', $hay) === 1;
        }
        foreach (self::words($tok) as $w) {
            if (str_contains($hay, mb_strtolower($w))) {
                return true;
            }
        }
        return false;
    }
}
