<?php

declare(strict_types=1);

/**
 * เตือนของที่เหลือน้อยกว่าขั้นต่ำ เข้ากลุ่ม Telegram ของร้าน
 *
 *   php stock/api/bin/low-stock-alert.php          ส่งจริง
 *   php stock/api/bin/low-stock-alert.php --dry    พิมพ์ข้อความออกจอ ไม่ส่ง
 *
 * ตั้งใน Task Scheduler ของ Windows ให้เรียกวันละครั้ง เช่นเก้าโมงเช้า:
 *   C:\xampp\php\php.exe C:\...\stock\api\bin\low-stock-alert.php
 *
 * **วันละครั้ง ไม่ใช่ทุกครั้งที่ตัดสต็อก** — ของชิ้นเดียวที่ตัดสิบรอบในเช้าวัน
 * เดียวจะได้สิบข้อความที่บอกเรื่องเดิม แล้วกลุ่มจะกลายเป็นที่ที่ไม่มีใครอ่าน
 * และวันที่มีเรื่องสำคัญจริง ๆ ข้อความนั้นจะจมอยู่ในนั้น
 *
 * ── ตอนนี้มีตัวเตือนทันทีแล้ว ไฟล์นี้กลายเป็นตาข่าย ────────────────────────
 * `Service\LowStock` เตือนทันทีที่ยอดข้ามเส้นลงมา ซึ่งเป็นข้อความที่คนทำงาน
 * ต้องการจริง · ไฟล์นี้ยังอยู่เพราะตัวนั้นส่งครั้งเดียวแล้วไม่ลองใหม่ — วันที่
 * Telegram ล่มพอดีตอนของหมด ไม่มีอะไรบอกใครเลยจนกว่าจะมีคนเปิดหน้าสินค้า
 * รอบเช้าของไฟล์นี้คือคำตอบของวันนั้น
 *
 * สองตัวใช้เงื่อนไขเดียวกัน (`Inventory::LOW_STOCK`) แต่คนละหัวข้อ — "ของใกล้หมด"
 * คือรายการประจำวัน ส่วน "ของเพิ่งลดต่ำกว่าขั้นต่ำ" คือเหตุการณ์ที่เพิ่งเกิด ·
 * คนอ่านต้องแยกออกว่าอันไหนคืออันไหน ไม่งั้นจะอ่านว่าระบบส่งซ้ำ
 *
 * ไม่มีของต่ำกว่าขั้นต่ำ = ไม่ส่งอะไรเลย · "วันนี้ทุกอย่างปกติ" ทุกเช้าคือ
 * ข้อความที่สอนให้คนเลิกอ่าน
 */

require __DIR__ . '/../src/bootstrap.php';

use Optic\Db;
use Optic\Repo\Inventory;
use Optic\Telegram;

$dry = in_array('--dry', $argv, true);

/**
 * เงื่อนไขเดียวกับชิป "ต่ำกว่าขั้นต่ำ" บนหน้าสินค้า — `Inventory::LOW_STOCK` ตัวเดียวกัน
 *
 * ไม่เรียก `Inventory::products()` เพราะนั่นเป็นคำถามของหน้าจอ — แบ่งหน้า เรียงตาม
 * ที่หน้าจอขอ และตัดตัวเลขเงินตามสิทธิ์ของคนที่เปิด · งานตามเวลาไม่มีคนเปิดและ
 * ต้องการทั้งหมดเรียงตามความขาด ไม่ใช่หน้าแรกยี่สิบแถว
 *
 * แต่ตัวเงื่อนไขต้องเป็นก้อนเดียวกัน — เดิมเขียน SQL ซ้ำไว้ที่นี่ แล้ววันที่กฎเปลี่ยน
 * เป็น "เหลือ ≤ ขั้นต่ำ และ 0 = เตือนเมื่อหมด" (2026-09-10) สำเนานี้คือที่ที่จะถูกลืมแก้
 */
$rows = Db::all(
    "SELECT p.sku, p.name, p.min_stock,
            COALESCE((SELECT SUM(l.remaining_qty) FROM stock_lots l WHERE l.product_id = p.id), 0) AS on_hand
     FROM products p
     WHERE " . Inventory::LOW_STOCK . "
     ORDER BY (COALESCE((SELECT SUM(l.remaining_qty) FROM stock_lots l WHERE l.product_id = p.id), 0) - p.min_stock) ASC,
              p.name ASC"
);

if ($rows === []) {
    echo "ไม่มีสินค้าที่ต่ำกว่าขั้นต่ำ — ไม่ส่งอะไร\n";
    exit(0);
}

$esc = static fn(string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

/* ยาวสุดยี่สิบบรรทัด — Telegram ตัดข้อความที่เกิน 4096 ตัวอักษรทิ้งไปเฉย ๆ และ
   รายการสี่สิบบรรทัดในแชทคือรายการที่ต้องเปิดหน้าเว็บดูอยู่ดี */
$show = array_slice($rows, 0, 20);

$lines = ['<b>ของใกล้หมด</b> — ต่ำกว่าขั้นต่ำ ' . count($rows) . ' รายการ', ''];
foreach ($show as $r) {
    $onHand = (int) $r['on_hand'];
    $min = (int) $r['min_stock'];
    $lines[] = sprintf(
        '• %s (%s) — เหลือ %d จากขั้นต่ำ %d%s',
        $esc((string) $r['name']),
        $esc((string) $r['sku']),
        $onHand,
        $min,
        $onHand < 0 ? ' · ติดลบ ขายไปแล้วยังไม่มีของ' : '',
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
