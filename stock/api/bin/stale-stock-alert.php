<?php

declare(strict_types=1);

/**
 * เตือนของที่ค้างอยู่บนชั้นนานเกินไป เข้ากลุ่ม Telegram ของคลัง
 *
 *   php stock/api/bin/stale-stock-alert.php          ส่งจริง
 *   php stock/api/bin/stale-stock-alert.php --dry    พิมพ์ข้อความออกจอ ไม่ส่ง
 *
 * ตั้งใน Task Scheduler ของ Windows ให้เรียก **เดือนละครั้ง** เช่นวันที่ 1 เก้าโมง:
 *   C:\xampp\php\php.exe C:\...\stock\api\bin\stale-stock-alert.php
 *
 * คนละจังหวะกับ `low-stock-alert.php` ตั้งใจ — ของใกล้หมดเปลี่ยนได้ทุกวันและรู้ช้า
 * แล้วเสียลูกค้า ส่วนของค้างสต๊อกเปลี่ยนเป็นเดือน · รายการเดิมสี่สิบบรรทัดที่ส่งซ้ำ
 * ทุกเช้าคือสิ่งที่สอนให้คนเลิกอ่านกลุ่ม แล้ววันที่ของใกล้หมดจริงจะจมไปด้วย
 *
 * ไม่มีของเข้าเงื่อนไข = ไม่ส่งอะไรเลย เหมือนอีกตัว
 */

require __DIR__ . '/../src/bootstrap.php';

use Optic\Db;
use Optic\Telegram;

/**
 * นานแค่ไหนถึงเรียกว่าค้าง
 *
 * หนึ่งปีเพราะกรอบแว่นหมุนตามฤดูกาล ของที่ข้ามฤดูของตัวเองไปแล้วยังไม่ขยับคือ
 * สัญญาณจริง ส่วนสามเดือนที่เงียบเป็นเรื่องปกติของรุ่นที่ขายช้าตามปกติอยู่แล้ว
 *
 * ตัวเลขนี้ใช้ทั้งสองเงื่อนไขข้างล่าง จงใจให้เป็นค่าเดียว — สองเกณฑ์ที่ตอบคำถาม
 * เดียวกันแต่ใช้เส้นคนละเส้น อธิบายให้คนที่อ่านข้อความเข้าใจไม่ได้
 */
const STALE_DAYS = 365;

/**
 * ช่วงที่ใช้วัดว่า "ตอนนี้ขายเร็วแค่ไหน"
 *
 * สั้นกว่า STALE_DAYS มากโดยตั้งใจ: อัตราขายที่เฉลี่ยจากทั้งปีจะถูกถ่วงด้วยช่วงที่
 * ของยังขายดีเมื่อสิบเดือนก่อน ซึ่งเป็นช่วงที่คำถามนี้ไม่ได้ถามถึง
 */
const RATE_WINDOW_DAYS = 90;

$dry = in_array('--dry', $argv, true);

/**
 * ของที่ค้าง — สองเงื่อนไข ต่อกันด้วย OR
 *
 * 1. **ล็อตเก่าสุดที่ยังมีของ รับเข้ามาเกิน STALE_DAYS แล้ว** · การตัดสต็อกเลือก
 *    ล็อตแบบ FIFO เสมอ ล็อตเก่าที่ยังไม่หมดจึงแปลว่าตลอดช่วงนั้นขายไม่ทันของที่
 *    รับเข้ามา ไม่ต้องไปไล่อ่านสมุดก็รู้
 *
 * 2. **ที่อัตราขายของช่วงหลังสุด ต้องใช้เกิน STALE_DAYS ถึงจะหมด** · จับตัวที่ยัง
 *    ขยับอยู่แต่ขยับช้ามาก ซึ่งข้อแรกมองไม่เห็นถ้าเพิ่งรับล็อตใหม่เข้ามาทับ
 *
 * นับเฉพาะ `OUT` (ขายและเบิก) ไม่นับ SCRAP ADJUST RETURN — ของที่ค้างจนต้องตัด
 * ทิ้งไม่ควรกลายเป็น "ขยับแล้ว" เพราะการทิ้งมันนับเป็นความเคลื่อนไหว
 *
 * ยอดคงเหลือรวมทุกล็อต แต่ "ล็อตเก่าสุด" นับเฉพาะล็อตที่ยังมีของจริง — ล็อตที่
 * ใช้หมดแล้วและล็อตค้างส่ง (`SHORT-<sku>` ยอดศูนย์หรือติดลบ) ไม่ใช่ของบนชั้น
 */
$rows = Db::all(
    "SELECT p.sku, p.name,
            s.on_hand,
            DATEDIFF(CURDATE(), s.oldest)                AS lot_age,
            DATEDIFF(CURDATE(), DATE(o.last_out))        AS since_out,
            COALESCE(o.sold_recent, 0)                   AS sold_recent
     FROM products p
     JOIN (
         SELECT product_id,
                SUM(remaining_qty) AS on_hand,
                MIN(CASE WHEN remaining_qty > 0 THEN received_date END) AS oldest
         FROM stock_lots
         GROUP BY product_id
     ) s ON s.product_id = p.id
     LEFT JOIN (
         SELECT product_id,
                MAX(created_at) AS last_out,
                SUM(CASE WHEN created_at >= CURDATE() - INTERVAL ? DAY
                         THEN -quantity ELSE 0 END) AS sold_recent
         FROM inventory_logs
         WHERE action_type = 'OUT'
         GROUP BY product_id
     ) o ON o.product_id = p.id
     WHERE p.is_custom_made = 0
       AND s.on_hand > 0
       AND s.oldest IS NOT NULL
       AND (
             s.oldest <= CURDATE() - INTERVAL ? DAY
             OR (COALESCE(o.sold_recent, 0) > 0
                 AND s.on_hand * ? / o.sold_recent > ?)
           )
     ORDER BY s.oldest ASC, p.name ASC",
    [RATE_WINDOW_DAYS, STALE_DAYS, RATE_WINDOW_DAYS, STALE_DAYS],
);

if ($rows === []) {
    echo "ไม่มีของค้างสต๊อกเกิน " . STALE_DAYS . " วัน — ไม่ส่งอะไร\n";
    exit(0);
}

$esc = static fn(string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

/**
 * ค้างแบบไหน — บอกให้ตรงกับสิ่งที่คนอ่านจะไปทำต่อ
 *
 * "ไม่เคยขายเลย" กับ "ขายอยู่แต่ช้ามาก" นำไปสู่คนละการตัดสินใจ อันแรกคือลดราคา
 * ล้างออกไป อันหลังคือแค่หยุดสั่งเพิ่ม · บรรทัดที่บอกแค่ว่า "ค้าง" ทำให้ต้องเปิด
 * หน้าเว็บดูอยู่ดีว่าอันไหนเป็นอันไหน ซึ่งแปลว่าข้อความนั้นไม่ได้ช่วยอะไร
 *
 * @param array<string,mixed> $r
 */
$why = static function (array $r): string {
    $age = (int) $r['lot_age'];
    $since = $r['since_out'] === null ? null : (int) $r['since_out'];
    $sold = (int) $r['sold_recent'];

    if ($since === null) {
        return sprintf('ยังไม่เคยขายเลย ตั้งแต่รับเข้ามา %d วันก่อน', $age);
    }
    if ($sold === 0) {
        return sprintf('ไม่ขยับมา %d วัน · ล็อตเก่าสุด %d วัน', $since, $age);
    }

    /* ยังขายอยู่ — บอกว่าที่ความเร็วนี้อีกนานแค่ไหนถึงจะหมด ซึ่งตอบคำถาม "สั่ง
       เพิ่มดีไหม" ได้ตรงกว่าจำนวนที่เหลือเฉย ๆ · อายุล็อตพูดถึงเฉพาะตอนที่มันเกิน
       เกณฑ์จริง ไม่งั้นบรรทัดจะขึ้นต้นด้วย "ล็อตเก่าสุด 35 วัน" ซึ่งไม่ใช่เหตุผล
       ที่แถวนี้มาอยู่ตรงนี้ แล้วคนอ่านจะเถียงกับข้อความแทนที่จะอ่านมัน */
    $days = (int) round((int) $r['on_hand'] * RATE_WINDOW_DAYS / $sold);
    $rate = sprintf('ที่อัตราขายตอนนี้ อีก %d วันถึงหมด', $days);

    return $age >= STALE_DAYS
        ? sprintf('ล็อตเก่าสุด %d วัน · %s', $age, $rate)
        : $rate;
};

/* ยาวสุดยี่สิบบรรทัด — Telegram ตัดข้อความที่เกิน 4096 ตัวอักษรทิ้งไปเฉย ๆ และ
   รายการสี่สิบบรรทัดในแชทคือรายการที่ต้องเปิดหน้าเว็บดูอยู่ดี */
$show = array_slice($rows, 0, 20);

$lines = [
    '<b>ของค้างสต๊อกนาน</b> — เกิน ' . STALE_DAYS . ' วัน ' . count($rows) . ' รายการ',
    '',
];
foreach ($show as $r) {
    $lines[] = sprintf(
        '• %s (%s) — เหลือ %d ชิ้น · %s',
        $esc((string) $r['name']),
        $esc((string) $r['sku']),
        (int) $r['on_hand'],
        $why($r),
    );
}
if (count($rows) > count($show)) {
    $lines[] = '';
    $lines[] = 'และอีก ' . (count($rows) - count($show)) . ' รายการ — ดูทั้งหมดที่หน้าสินค้าและสต็อก';
}

$text = implode("\n", $lines);

if ($dry) {
    echo $text, "\n";
    exit(0);
}

exit(Telegram::send($text) ? 0 : 1);
