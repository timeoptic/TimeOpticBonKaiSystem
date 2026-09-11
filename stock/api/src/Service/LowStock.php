<?php

declare(strict_types=1);

namespace Optic\Service;

use Optic\Db;
use Optic\Repo\Inventory;
use Optic\Telegram;

/**
 * เตือนของใกล้หมด ทันทีที่ยอดข้ามเส้นขั้นต่ำลงมา
 *
 * คู่กับ `bin/low-stock-alert.php` ไม่ใช่แทนกัน — ตัวนั้นถามวันละครั้งว่า "ตอนนี้
 * มีอะไรต่ำกว่าขั้นต่ำบ้าง" และเป็นตาข่ายกันข้อความที่ส่งไม่ออก ส่วนตัวนี้ตอบ
 * คำถามที่คนทำงานถามจริง: "เพิ่งตัดไปแล้วของหมดหรือยัง"
 *
 * ── เตือนตอนข้ามเส้น ไม่ใช่ตอนอยู่ต่ำกว่าเส้น ──────────────────────────────
 * ของชิ้นที่ต่ำกว่าขั้นต่ำอยู่แล้วและถูกตัดอีกสิบรอบในเช้าวันเดียว ต้องได้ข้อความ
 * ใบเดียว ไม่ใช่สิบใบ · ความจำอยู่ที่ `products.low_stock_notified_at` (031):
 * ตั้งตอนส่ง ล้างตอนของกลับขึ้นถึงขั้นต่ำ — ของเข้ามาแล้วตกอีกรอบจึงเตือนใหม่
 * ซึ่งเป็นข่าวจริง ไม่ใช่ข่าวซ้ำ
 *
 * ── ทำไมประเมินตอนจบคำขอ ไม่ใช่ตรงที่ตัด ──────────────────────────────────
 * `watch()` แค่จดชื่อไว้ ของจริงเกิดที่ `flush()` ซึ่งวิ่งตอน shutdown — หลังจาก
 * response ออกไปแล้ว และหลังธุรกรรมจบแล้ว · ได้สามอย่างพร้อมกัน:
 *
 *   · คนกดบันทึกไม่ต้องรอ Telegram ตอบ (curl ตั้ง timeout ไว้ 15 วินาที)
 *   · Telegram ล่มไม่ทำให้การตัดสต็อกพัง — ข้อความหายดีกว่าของหายจากระบบ
 *   · คำขอที่ถูก rollback จะไม่ส่งอะไร เพราะยอดที่อ่านตอน flush คือยอดที่ commit
 *     แล้วจริง ๆ ไม่ใช่ยอดระหว่างทาง
 *
 * ── ไม่ใช้ transaction ของตัวเอง ──────────────────────────────────────────
 * `flush()` อ่านยอดแล้วเขียนธงทีละแถว ไม่ได้ครอบด้วยธุรกรรม — สองคำขอที่ตัดของ
 * ชิ้นเดียวกันพร้อมกันอาจส่งซ้ำได้หนึ่งใบในกรณีที่ชนกันพอดี · ยอมได้ เพราะราคา
 * ของการชนคือข้อความซ้ำหนึ่งใบ ส่วนราคาของการล็อกแถว `products` ตอนปิดคำขอคือ
 * การตัดสต็อกของคนอื่นรอ
 */
final class LowStock
{
    /** @var array<int,true> สินค้าที่ถูกแตะในคำขอนี้ — คีย์เป็น id จึงไม่ซ้ำเอง */
    private static array $watching = [];

    /** @var array<int,true> ล็อตที่ถูกแตะ · แปลงเป็นสินค้าตอน `collect()` */
    private static array $watchingLots = [];

    /** ลงทะเบียน shutdown ไว้แล้วหรือยัง — ครั้งเดียวต่อโปรเซส */
    private static bool $armed = false;

    /**
     * จดว่าสินค้าชิ้นนี้เพิ่งถูกแตะ
     *
     * เรียกข้างทุกที่ที่เขียน `inventory_logs` · ราคาของมันคือการเขียนลงอาร์เรย์
     * หนึ่งช่อง จึงเรียกซ้ำในลูปได้โดยไม่ต้องกลัว และเรียกตอนของ "เพิ่มขึ้น" ก็ควร
     * เรียกด้วย — การรับของเข้าคือจังหวะที่ธงต้องถูกล้าง
     */
    public static function watch(int $productId): void
    {
        if ($productId <= 0) {
            return;
        }
        self::$watching[$productId] = true;
        self::arm();
    }

    /**
     * ลงทะเบียนให้ `flush()` วิ่งตอนจบคำขอ — ครั้งเดียวต่อโปรเซส
     *
     * แยกออกมาเป็นเมธอดของตัวเอง ไม่ได้ฝังอยู่ใน `watch()` เพราะ `watchLot()`
     * ต้องปลุกมันด้วยโดยไม่มีสินค้าให้จด · เคยเรียก `watch(0)` แทน แล้วมันคืนค่า
     * ตั้งแต่บรรทัดแรกเพราะ id ไม่ใช่ค่าบวก — คำขอที่คืนของอย่างเดียวจึงไม่เคย
     * ถูกประเมินเลย
     */
    private static function arm(): void
    {
        if (self::$armed) {
            return;
        }
        self::$armed = true;
        register_shutdown_function(static fn() => self::flush());
    }

    /**
     * จดจากล็อต สำหรับที่ที่รู้จักแต่ล็อต
     *
     * สองจุดที่คืนของเข้าล็อตเขียนสมุดด้วย `SELECT product_id ... FROM stock_lots`
     * — ตัวสินค้าไม่เคยถูกอ่านขึ้นมาเป็นตัวแปรเลย · แปลงทีเดียวตอน `collect()`
     * ถูกกว่าการยิงคำถามหาสินค้าทุกครั้งที่คืนของหนึ่งล็อต
     */
    public static function watchLot(int $lotId): void
    {
        if ($lotId <= 0) {
            return;
        }
        self::$watchingLots[$lotId] = true;
        self::arm();
    }

    /**
     * ใครเพิ่งข้ามเส้นลงมาบ้าง — พร้อมอัปเดตความจำไปในตัว
     *
     * แยกจาก `flush()` เพื่อให้เทสต์ถามคำถาม "ใครข้ามเส้น" ได้โดยไม่ต้องยิง
     * Telegram · ล้างรายการที่เฝ้าอยู่เสมอ เรียกซ้ำจึงไม่ได้ของเดิมกลับมาอีก
     *
     * @return list<array{sku:string,name:string,on_hand:int,min_stock:int}>
     */
    public static function collect(): array
    {
        $ids  = array_keys(self::$watching);
        $lots = array_keys(self::$watchingLots);
        self::$watching = [];
        self::$watchingLots = [];

        if ($lots !== []) {
            $inLots = implode(',', array_fill(0, count($lots), '?'));
            foreach (Db::all("SELECT DISTINCT product_id FROM stock_lots WHERE id IN ({$inLots})", $lots) as $r) {
                $ids[] = (int) $r['product_id'];
            }
            $ids = array_values(array_unique($ids));
        }

        if ($ids === []) {
            return [];
        }

        $in = implode(',', array_fill(0, count($ids), '?'));

        /* เงื่อนไข "ต่ำกว่าขั้นต่ำ" มาจาก `Inventory::LOW_STOCK` ทั้งดุ้น ไม่ได้
           เขียนใหม่ให้คล้ายกัน — ชิปบนหน้าสินค้า สคริปต์รายวัน และข้อความใบนี้
           ต้องหมายถึงสิ่งเดียวกันตลอดไป */
        $rows = Db::all(
            "SELECT p.id, p.sku, p.name, p.min_stock, p.low_stock_notified_at,
                    COALESCE((SELECT SUM(l.remaining_qty) FROM stock_lots l
                               WHERE l.product_id = p.id), 0) AS on_hand,
                    (" . Inventory::LOW_STOCK . ") AS is_low
               FROM products p
              WHERE p.id IN ({$in})",
            $ids,
        );

        $crossed = [];
        foreach ($rows as $r) {
            $low     = (int) $r['is_low'] === 1;
            $noticed = $r['low_stock_notified_at'] !== null;

            if ($low && !$noticed) {
                Db::run('UPDATE products SET low_stock_notified_at = NOW() WHERE id = ?', [(int) $r['id']]);
                $crossed[] = [
                    'sku'       => (string) $r['sku'],
                    'name'      => (string) $r['name'],
                    'on_hand'   => (int) $r['on_hand'],
                    'min_stock' => (int) $r['min_stock'],
                ];
                continue;
            }

            /* ของกลับขึ้นพ้นขั้นต่ำแล้ว — ล้างความจำ ไม่งั้นรอบหน้าที่มันตกลงมา
               อีกจะเงียบตลอดไป และนั่นคือรอบที่คนอยากรู้ที่สุด */
            if (!$low && $noticed) {
                Db::run('UPDATE products SET low_stock_notified_at = NULL WHERE id = ?', [(int) $r['id']]);
            }
        }

        return $crossed;
    }

    /**
     * ข้อความที่จะส่ง — ว่างเปล่าแปลว่าไม่มีอะไรต้องบอก
     *
     * รูปเดียวกับสคริปต์รายวันโดยตั้งใจ: คนที่อ่านกลุ่มนี้ทุกวันไม่ควรต้องเรียนรู้
     * สองรูปแบบ · ต่างกันที่หัวข้อ ซึ่งบอกว่าข้อความนี้มาจากเหตุการณ์ ไม่ใช่จากรอบ
     * ประจำวัน — สองอย่างนี้ต้องแยกออกจากกันในสายตาคนอ่าน ไม่งั้นจะอ่านว่าส่งซ้ำ
     *
     * @param list<array{sku:string,name:string,on_hand:int,min_stock:int}> $rows
     */
    public static function message(array $rows): string
    {
        if ($rows === []) {
            return '';
        }

        $esc = static fn(string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

        $lines = [
            '<b>ของเพิ่งลดต่ำกว่าขั้นต่ำ</b> — ' . count($rows) . ' รายการ',
            '',
        ];
        foreach ($rows as $r) {
            $lines[] = sprintf(
                '• %s (%s) — เหลือ %d จากขั้นต่ำ %d%s',
                $esc($r['name']),
                $esc($r['sku']),
                $r['on_hand'],
                $r['min_stock'],
                $r['on_hand'] < 0 ? ' · ติดลบ ขายไปแล้วยังไม่มีของ' : '',
            );
        }

        return implode("\n", $lines);
    }

    /**
     * ประเมินแล้วส่ง — จุดที่ shutdown เรียก
     *
     * กลืนทุก exception ทิ้ง · ตรงนี้วิ่งหลัง response ออกไปแล้ว การโยนต่อไม่มีใคร
     * รับ และสิ่งเดียวที่จะเกิดคือ fatal ใน error log ที่ทำให้คนไล่หาอาการผิดที่
     * ทั้งที่การตัดสต็อกสำเร็จไปเรียบร้อยแล้ว
     */
    public static function flush(): void
    {
        try {
            $text = self::message(self::collect());
            if ($text !== '') {
                Telegram::send($text);
            }
        } catch (\Throwable $e) {
            error_log('เตือนของใกล้หมดไม่สำเร็จ: ' . $e->getMessage());
        }
    }

    /** ล้างสถานะทั้งหมด — สำหรับเทสต์ที่รันหลายเคสในโปรเซสเดียว */
    public static function reset(): void
    {
        self::$watching = [];
        self::$watchingLots = [];
    }
}
