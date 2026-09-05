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
 * ไม่มีของต่ำกว่าขั้นต่ำ = ไม่ส่งอะไรเลย · "วันนี้ทุกอย่างปกติ" ทุกเช้าคือ
 * ข้อความที่สอนให้คนเลิกอ่าน
 */

require __DIR__ . '/../src/bootstrap.php';

use Optic\Db;
use Optic\Telegram;

$dry = in_array('--dry', $argv, true);

/**
 * เงื่อนไขเดียวกับชิป "ต่ำกว่าขั้นต่ำ" บนหน้าสินค้า
 *
 * เขียนซ้ำที่นี่แทนที่จะเรียก `Inventory` เพราะที่นั่นเป็นคำถามของหน้าจอ — มัน
 * แบ่งหน้า เรียงตามที่หน้าจอขอ และตัดตัวเลขเงินตามสิทธิ์ของคนที่เปิด · งานตาม
 * เวลาไม่มีคนเปิดและต้องการทั้งหมดเรียงตามความขาด ไม่ใช่หน้าแรกยี่สิบแถว
 *
 * `min_stock = 0` แปลว่าไม่ได้ตั้งขั้นต่ำไว้ ไม่ใช่ตั้งไว้ที่ศูนย์ · ของสั่งตัด
 * ไม่มีสต็อกโดยธรรมชาติ ถ้านับด้วยจะขึ้นเตือนทุกตัวทุกวัน
 */
$rows = Db::all(
    "SELECT p.sku, p.name, p.min_stock,
            COALESCE((SELECT SUM(l.remaining_qty) FROM stock_lots l WHERE l.product_id = p.id), 0) AS on_hand
     FROM products p
     WHERE p.is_custom_made = 0
       AND p.min_stock > 0
       AND COALESCE((SELECT SUM(l.remaining_qty) FROM stock_lots l WHERE l.product_id = p.id), 0) < p.min_stock
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
