<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Roles;
use Optic\Service\LowStock;
use Optic\Service\Receiving;
use Optic\Service\Stock;

/**
 * เตือนทันทีตอนของข้ามเส้นขั้นต่ำ
 *
 * `productAtLevel()` อยู่ใน `harness.php` — ย้ายมาจาก `70-min-stock.test.php`
 * ตอนที่ไฟล์นี้ต้องใช้ด้วย เพราะตัวช่วยที่อยู่ในไฟล์ทดสอบอีกไฟล์จะหาไม่เจอเวลา
 * รันด้วยตัวกรอง (`run.php 71-low`)
 *
 * ทุกข้อเรียก `collect()` ไม่ใช่ `flush()` — `collect()` คือการตัดสินใจว่าใครข้าม
 * เส้น ส่วน `flush()` คือการยิง Telegram ซึ่งไม่ใช่สิ่งที่เทสต์ควรทำ
 *
 * และไม่มีข้อไหนเรียก `watch()` เองเลย — บริการที่ตัดของจดให้แล้ว การเรียกเองใน
 * เทสต์จะทำให้เทสต์ผ่านต่อไปในวันที่ฮุกหลุดหายไปจาก `Stock::issue()`
 */
group('เตือนของใกล้หมดทันทีที่ข้ามเส้น');

/** ชื่อ SKU ของแถวที่ collect() คืนมา — เทียบง่ายกว่าอาร์เรย์ทั้งก้อน */
function crossedSkus(): array
{
    return array_map(static fn(array $r): string => (string) $r['sku'], LowStock::collect());
}

test('ตัดจนต่ำกว่าขั้นต่ำ ได้เตือนหนึ่งครั้ง', function () {
    withRollback(function () {
        $p = productAtLevel(10, 5);

        // ยังไม่ข้ามเส้น — เหลือ 6 จากขั้นต่ำ 5
        Stock::issue(issueReq($p['sku'], 4, idem('low-a1')));
        eq(crossedSkus(), [], 'เหลือ 6 จากขั้นต่ำ 5 ยังไม่ต้องเตือน');

        // ข้ามเส้น — เหลือ 4 จากขั้นต่ำ 5
        Stock::issue(issueReq($p['sku'], 2, idem('low-a2')));
        eq(crossedSkus(), [$p['sku']], 'ข้ามเส้นแล้วต้องเตือน');

        neq(Db::value('SELECT low_stock_notified_at FROM products WHERE id = ?', [$p['id']]), null, 'ธงถูกตั้ง');
    });
});

test('ตัดซ้ำตอนที่ต่ำกว่าเส้นอยู่แล้ว ไม่เตือนอีก', function () {
    withRollback(function () {
        $p = productAtLevel(10, 5);

        Stock::issue(issueReq($p['sku'], 6, idem('low-b1')));
        eq(crossedSkus(), [$p['sku']], 'ครั้งแรกเตือน');

        /* ของชิ้นเดียวที่ถูกตัดสิบรอบในเช้าวันเดียวต้องไม่กลายเป็นสิบข้อความ —
           นี่คือเหตุผลทั้งหมดที่ธง `low_stock_notified_at` มีอยู่ */
        foreach ([1, 1, 1] as $i => $n) {
            Stock::issue(issueReq($p['sku'], $n, idem("low-b-again-{$i}")));
            eq(crossedSkus(), [], 'ตัดซ้ำครั้งที่ ' . ($i + 2) . ' ต้องเงียบ');
        }
    });
});

test('ของกลับเข้ามาจนพ้นเส้น แล้วตกอีกรอบ เตือนใหม่', function () {
    withRollback(function () {
        $p = productAtLevel(10, 5);

        Stock::issue(issueReq($p['sku'], 6, idem('low-c1')));
        eq(crossedSkus(), [$p['sku']], 'ตกครั้งแรก');

        // ของมาถึง — พ้นเส้นแล้ว ธงต้องถูกล้าง ไม่งั้นรอบหน้าจะเงียบตลอดไป
        Receiving::receive([
            'sku'           => $p['sku'],
            'quantity'      => 10,
            'cost_per_unit' => '100.00',
            'received_date' => date('Y-m-d'),
        ], [Roles::OWNER], 1);
        eq(crossedSkus(), [], 'พ้นเส้นแล้วไม่ใช่การเตือน');
        eq(Db::value('SELECT low_stock_notified_at FROM products WHERE id = ?', [$p['id']]), null, 'ธงถูกล้าง');

        Stock::issue(issueReq($p['sku'], 10, idem('low-c2')));
        eq(crossedSkus(), [$p['sku']], 'ตกอีกรอบต้องเตือนใหม่');
    });
});

test('ขั้นต่ำ 0 = เตือนตอนของหมด ไม่ใช่เงียบ', function () {
    withRollback(function () {
        /* ช่องขั้นต่ำเปิดมาเป็น 0 เพราะคนชอบลืมกรอก — 0 จึงต้องแปลว่า "เตือนเมื่อหมด"
           เงื่อนไขเดียวกับชิปบนหน้าสินค้าและสคริปต์รายวัน (`Inventory::LOW_STOCK`) */
        $p = productAtLevel(6, 0);

        Stock::issue(issueReq($p['sku'], 5, idem('low-d1')));
        eq(crossedSkus(), [], 'เหลือ 1 ยังไม่ต้องเตือน');

        Stock::issue(issueReq($p['sku'], 1, idem('low-d2')));
        eq(crossedSkus(), [$p['sku']], 'ตัดจนหมดต้องเตือน');
    });
});

test('ของสั่งตัดไม่เข้าเงื่อนไข', function () {
    withRollback(function () {
        $p = productAtLevel(10, 5);

        /* ตัดตอนที่ยังเป็นสินค้าปกติ แล้วค่อยเปลี่ยนเป็นของสั่งตัด — ของสั่งตัด
           ตัดสต็อกไม่ได้ตั้งแต่ต้นทาง จึงสร้างสถานะ "เหลือ 2 จากขั้นต่ำ 5 และเป็น
           ของสั่งตัด" ด้วยวิธีอื่นไม่ได้ · สิ่งที่ข้อนี้ถามคือเงื่อนไขของการเตือน
           ไม่ใช่ว่ามาถึงสถานะนี้ได้ยังไง */
        Stock::issue(issueReq($p['sku'], 8, idem('low-e1')));
        Db::run('UPDATE products SET is_custom_made = 1 WHERE id = ?', [$p['id']]);

        eq(crossedSkus(), [], 'ของสั่งตัดไม่มีสต็อกโดยธรรมชาติ ไม่ใช่ของที่ใกล้หมด');
    });
});

test('หลายตัวข้ามเส้นในคำขอเดียว ได้ข้อความเดียว', function () {
    withRollback(function () {
        $a = productAtLevel(10, 5);
        $b = productAtLevel(10, 5);

        Stock::issue(issueReq($a['sku'], 6, idem('low-f1')));
        Stock::issue(issueReq($b['sku'], 7, idem('low-f2')));

        $rows = LowStock::collect();
        eq(count($rows), 2, 'สองตัวข้ามเส้นพร้อมกัน');

        $text = LowStock::message($rows);
        eq(substr_count($text, '•'), 2, 'สองบรรทัดในข้อความเดียว');
        ok(str_contains($text, $a['sku']) && str_contains($text, $b['sku']), 'มีทั้งสอง SKU');
        ok(str_contains($text, 'ต่ำกว่าขั้นต่ำ'), 'บอกว่าเรื่องอะไร');
    });
});

test('ไม่มีใครข้ามเส้น = ไม่มีข้อความ', function () {
    withRollback(function () {
        $p = productAtLevel(10, 5);
        eq(LowStock::collect(), [], 'ของยังเต็มอยู่');
        eq(LowStock::message([]), '', 'ไม่มีแถว = ไม่มีข้อความ · ตัวส่งจะได้ไม่ยิงห้องเปล่า');
    });
});

test('collect() ล้างรายการที่เฝ้าอยู่ เรียกซ้ำไม่ได้ของเดิม', function () {
    withRollback(function () {
        $p = productAtLevel(10, 5);
        Stock::issue(issueReq($p['sku'], 6, idem('low-g1')));

        eq(count(LowStock::collect()), 1, 'ครั้งแรกได้');
        eq(LowStock::collect(), [], 'เรียกซ้ำต้องว่าง — ไม่งั้น shutdown ที่ทำงานสองรอบจะส่งซ้ำ');
    });
});

test('ตัดผ่าน Stock::issue แล้วระบบจดเอง ไม่ต้องมีใครเรียก watch()', function () {
    withRollback(function () {
        LowStock::reset();
        $p = productAtLevel(10, 5);
        LowStock::reset(); // ลืมสิ่งที่การรับของเข้าจดไว้ ให้เหลือแค่ผลของการตัด

        Stock::issue(issueReq($p['sku'], 6, idem('low-h1')));
        eq(crossedSkus(), [$p['sku']], 'ฮุกใน Stock::issue จดสินค้าให้แล้ว');
    });
});

test('รับของเข้าแล้วระบบจดเอง — ธงถูกล้างโดยไม่ต้องมีใครเรียก', function () {
    withRollback(function () {
        $p = productAtLevel(10, 5);
        Stock::issue(issueReq($p['sku'], 6, idem('low-i1')));
        eq(crossedSkus(), [$p['sku']], 'ตกก่อน');

        LowStock::reset();
        Receiving::receive([
            'sku'           => $p['sku'],
            'quantity'      => 10,
            'cost_per_unit' => '100.00',
            'received_date' => date('Y-m-d'),
        ], [Roles::OWNER], 1);

        eq(crossedSkus(), [], 'การรับของเข้าไม่ใช่การเตือน');
        eq(Db::value('SELECT low_stock_notified_at FROM products WHERE id = ?', [$p['id']]), null, 'ธงถูกล้างจากฮุกใน Receiving');
    });
});
