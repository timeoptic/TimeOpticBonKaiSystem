<?php

declare(strict_types=1);

/**
 * สรุปคิวส่งมอบรอบหนึ่งทุ่ม — สองข้อความ: "คิวพรุ่งนี้" กับ "เลยกำหนดส่งมอบ"
 *
 * สามเรื่องที่ไฟล์นี้เฝ้าไว้ เพราะพังแล้วไม่มีใครรู้ (แจ้งเตือนที่เงียบไปเฉย ๆ
 * ไม่มีใครมาบ่น ต่างจากหน้าจอที่พัง):
 *
 *   1. เกณฑ์คิว ต้องเป็นชุดเดียวกับกระดานส่งมอบ (api/routes/workflow.php) —
 *      เคสยังไม่ปิด + อยู่ขั้น delivery + ยังไม่มี delivered_at ถ้าสองที่นี้
 *      ตอบไม่ตรงกัน พนักงานจะเจอเลขขัดกันระหว่างจอกับข้อความในกลุ่ม
 *   2. ตัวกันส่งซ้ำ รอบกวาดรันทุกนาที ถ้ากันพลาดกลุ่มจะโดนสรุปเดิม 300 ครั้ง
 *   3. ลิมิต 4,096 ตัวอักษรของ Telegram คิวเลยกำหนดมีพันกว่าราย ถ้าไม่ตัด
 *      ข้อความจะถูกปฏิเสธทั้งก้อน = ไม่ได้รับอะไรเลย
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('สรุปคิวส่งมอบรอบหนึ่งทุ่ม');

/**
 * เคสหนึ่งใบที่ค้างอยู่ขั้นส่งมอบ พร้อมออเดอร์ที่มีวันนัดรับ
 *
 * @param string|null $deliveredAt ใส่เวลาลง case_deliveries = ส่งมอบไปแล้ว
 */
function digestFixture(
    Tx $q,
    string $apptDate,
    string $status = 'waiting_pickup',
    ?string $deliveredAt = null,
    string $firstName = 'ทดสอบ'
): array {
    $cust = $q->run(
        'INSERT INTO customers (first_name, last_name, phone) VALUES (?,?,?)',
        $firstName,
        'คิวส่งมอบ',
        '0812345678'
    )['insertId'];

    $code = 'TEST-DIG-' . bin2hex(random_bytes(4));
    $case = $q->run(
        'INSERT INTO cases (case_code, customer_id, status, case_type) VALUES (?,?,?,?)',
        $code,
        $cust,
        $status,
        'new_glasses'
    )['insertId'];

    $inv   = 'TESTINV-' . bin2hex(random_bytes(4));
    $order = $q->run(
        'INSERT INTO custom_orders (invoice_code, case_id, customer_id, order_date, appointment_date)
         VALUES (?,?,?,?,?)',
        $inv,
        $case,
        $cust,
        today(),
        $apptDate
    )['insertId'];

    if ($deliveredAt !== null) {
        $q->run(
            'INSERT INTO case_deliveries (case_id, order_id, delivered_at) VALUES (?,?,?)',
            $case,
            $order,
            $deliveredAt
        );
    }

    return ['case_id' => $case, 'code' => $code, 'invoice' => $inv, 'order_id' => $order];
}

/** เลขออเดอร์ทุกใบที่อยู่ในผลลัพธ์ */
function invoicesOf(array $rows): array
{
    return array_column($rows, 'invoice_code');
}

function plusDays(int $n): string
{
    return date('Y-m-d', strtotime(today() . " $n day"));
}

/* ------------------------------------------------------------------ *
 * คิวของวันที่กำหนด
 * ------------------------------------------------------------------ */

test('คิวพรุ่งนี้ ต้องมีเคสที่นัดรับพรุ่งนี้และยังไม่ได้ส่งมอบ', function (): void {
    rollback(function (Tx $q): void {
        $f = digestFixture($q, plusDays(1));

        ok(
            in_array($f['invoice'], invoicesOf(DeliveryDigest::queue(plusDays(1))), true),
            'ออเดอร์ ' . $f['invoice'] . ' นัดรับพรุ่งนี้ ต้องอยู่ในคิว แต่ไม่อยู่'
        );
    });
});

test('เคสที่ส่งมอบไปแล้ว ต้องหลุดออกจากคิว', function (): void {
    rollback(function (Tx $q): void {
        $f = digestFixture($q, plusDays(1), 'pickup', nowStamp());

        ok(
            !in_array($f['invoice'], invoicesOf(DeliveryDigest::queue(plusDays(1))), true),
            'ออเดอร์ ' . $f['invoice'] . ' ส่งมอบไปแล้ว ต้องไม่อยู่ในคิว'
        );
    });
});

test('เคสที่นัดวันอื่น ต้องไม่ปนเข้ามาในคิวของวันที่ถาม', function (): void {
    rollback(function (Tx $q): void {
        $f = digestFixture($q, plusDays(3));

        ok(
            !in_array($f['invoice'], invoicesOf(DeliveryDigest::queue(plusDays(1))), true),
            'ออเดอร์ ' . $f['invoice'] . ' นัดอีกสามวัน ต้องไม่อยู่ในคิวของพรุ่งนี้'
        );
    });
});

test('เคสที่ปิดไปแล้ว ต้องไม่อยู่ในคิว', function (): void {
    rollback(function (Tx $q): void {
        $f = digestFixture($q, plusDays(1), 'completed');

        ok(
            !in_array($f['invoice'], invoicesOf(DeliveryDigest::queue(plusDays(1))), true),
            'เคสปิดแล้ว ต้องไม่อยู่ในคิว'
        );
    });
});

/* ------------------------------------------------------------------ *
 * เลยกำหนดส่งมอบ
 * ------------------------------------------------------------------ */

test('เคสที่เลยวันนัดมาแล้วและอยู่ในกรอบวันที่ตั้งไว้ ต้องขึ้นรายการเลยกำหนด', function (): void {
    rollback(function (Tx $q): void {
        $f = digestFixture($q, plusDays(-5));

        ok(
            in_array($f['invoice'], invoicesOf(DeliveryDigest::overdue(30)), true),
            'ออเดอร์ ' . $f['invoice'] . ' เลยมาห้าวัน ต้องขึ้นรายการเลยกำหนด'
        );
    });
});

test('เคสที่เลยกำหนดนานกว่ากรอบที่ตั้งไว้ ต้องไม่ขึ้น', function (): void {
    rollback(function (Tx $q): void {
        $f = digestFixture($q, plusDays(-40));

        ok(
            !in_array($f['invoice'], invoicesOf(DeliveryDigest::overdue(30)), true),
            'ออเดอร์ ' . $f['invoice'] . ' เลยมาสี่สิบวัน เกินกรอบสามสิบวัน ต้องไม่ขึ้น'
        );
    });
});

test('เคสที่นัดวันนี้ ยังไม่ถือว่าเลยกำหนด', function (): void {
    rollback(function (Tx $q): void {
        $f = digestFixture($q, today());

        ok(
            !in_array($f['invoice'], invoicesOf(DeliveryDigest::overdue(30)), true),
            'นัดวันนี้ ยังไม่เลยกำหนด'
        );
    });
});

/**
 * จำนวนวันที่เลยมาต้องนับจากวันเดียวกับที่ queue() ใช้
 *
 * ฐานข้อมูลอยู่คนละเครื่องกับ API (ดู start-all.ps1) ถ้าตัวหนึ่งถามนาฬิกา PHP
 * อีกตัวถาม CURDATE() ของ MySQL สองรายการในข้อความเดียวกันจะคนละวันได้
 */
test('เลขจำนวนวันที่เลยมา ต้องนับจากวันที่ส่งเข้าไป ไม่ใช่นาฬิกาของ MySQL', function (): void {
    rollback(function (Tx $q): void {
        $f = digestFixture($q, plusDays(-5));

        /* ถามโดยอ้างวันพรุ่งนี้เป็นวันนี้ — ใบที่นัดเมื่อห้าวันก่อนต้องกลายเป็นเลยมาหกวัน
           ถ้ายังนับด้วย CURDATE() อยู่จะได้ห้าเท่าเดิม ซึ่งคือสิ่งที่เทสนี้จับ */
        $rows = array_values(array_filter(
            DeliveryDigest::overdue(30, plusDays(1)),
            fn($r) => $r['invoice_code'] === $f['invoice']
        ));

        ok($rows !== [], 'ต้องเจอออเดอร์ ' . $f['invoice'] . ' ในรายการ');
        eq((int) $rows[0]['days_late'], 6, 'นัดเมื่อห้าวันก่อน เมื่อนับจากพรุ่งนี้');
    });
});

test('รายการเลยกำหนด เรียงจากเลยนานสุดขึ้นก่อน', function (): void {
    rollback(function (Tx $q): void {
        $recent = digestFixture($q, plusDays(-2));
        $old    = digestFixture($q, plusDays(-20));

        $order = invoicesOf(DeliveryDigest::overdue(30));
        $iOld    = array_search($old['invoice'], $order, true);
        $iRecent = array_search($recent['invoice'], $order, true);

        ok($iOld !== false && $iRecent !== false, 'ต้องเจอทั้งสองใบในรายการ');
        ok($iOld < $iRecent, 'ใบที่เลยมายี่สิบวัน ต้องอยู่เหนือใบที่เลยมาสองวัน');
    });
});

/* ------------------------------------------------------------------ *
 * ตัวกันส่งซ้ำ — รอบกวาดรันทุกนาที
 * ------------------------------------------------------------------ */

test('ยังไม่ถึงเวลาที่ตั้งไว้ ต้องยังไม่ส่ง', function (): void {
    eq(DeliveryDigest::isDue('18:59', '19:00', null, '2026-09-09'), false, 'หกโมงห้าสิบเก้า');
});

test('ถึงเวลาแล้วและวันนี้ยังไม่ได้ส่ง ต้องส่ง', function (): void {
    eq(DeliveryDigest::isDue('19:00', '19:00', null, '2026-09-09'), true, 'หนึ่งทุ่มตรง');
});

test('ส่งไปแล้ววันนี้ ต้องไม่ส่งซ้ำ', function (): void {
    eq(
        DeliveryDigest::isDue('19:30', '19:00', '2026-09-09', '2026-09-09'),
        false,
        'รอบกวาดนาทีถัดมาต้องเงียบ'
    );
});

test('เปิดเครื่องช้าถึงสามทุ่ม ยังได้รับสรุปของวันนั้น', function (): void {
    eq(
        DeliveryDigest::isDue('21:00', '19:00', '2026-09-08', '2026-09-09'),
        true,
        'ส่งล่าสุดคือเมื่อวาน วันนี้ยังไม่ได้ส่ง'
    );
});

/**
 * "9:00" ที่ไม่มีศูนย์นำหน้าเทียบสตริงแล้วมากกว่า "19:00" เสมอ — ตั้งค่าพลาด
 * ตัวเดียวแปลว่าสรุปเงียบไปตลอดกาลโดยไม่มีข้อความแจ้งว่าตั้งค่าผิด
 */
test('เวลาที่ตั้งไว้แบบไม่มีศูนย์นำหน้า ต้องอ่านได้เหมือนกัน', function (): void {
    eq(DeliveryDigest::isDue('09:00', '9:00', null, '2026-09-09'), true, 'เก้าโมงตรง');
    eq(DeliveryDigest::isDue('08:59', '9:00', null, '2026-09-09'), false, 'ก่อนเก้าโมงหนึ่งนาที');
});

test('เช้าวันถัดมา ต้องไม่เด้งสรุปของเมื่อวานย้อนหลัง', function (): void {
    eq(
        DeliveryDigest::isDue('09:00', '19:00', '2026-09-08', '2026-09-09'),
        false,
        'ยังไม่ถึงหนึ่งทุ่มของวันใหม่'
    );
});

/* ------------------------------------------------------------------ *
 * สองปลายทาง — "TimeOptic คิวลูกค้า" กับ "TimeOptic รายงานการส่งมอบ"
 * ------------------------------------------------------------------ */

/** ตั้งค่าปลายทางทั้งสองแบบครบ ๆ ในทรานแซกชันที่จะถูก roll back */
function seedTargets(array $patch): void
{
    Telegram::saveSettings($patch + [
        'telegram_bot_token'        => 'MAIN-TOKEN',
        'telegram_chat_id'          => '-100111',
        'digest_telegram_bot_token' => 'DIGEST-TOKEN',
        'digest_telegram_chat_id'   => '-100222',
    ]);
}

test('ปลายทางคิวลูกค้า ต้องได้ token กับ chat ของตัวเอง', function (): void {
    rollback(function (): void {
        seedTargets([]);
        $c = Telegram::credentials('main');

        eq($c['token'], 'MAIN-TOKEN', 'token ของคิวลูกค้า');
        eq($c['chat'], '-100111', 'chat ของคิวลูกค้า');
        eq($c['fell_back'], false, 'ตั้งค่าไว้ครบ ไม่ต้องตกกลับไปไหน');
    });
});

test('ปลายทางรายงานการส่งมอบ ต้องได้ token กับ chat ของกลุ่มตัวเอง ไม่ใช่ของคิวลูกค้า', function (): void {
    rollback(function (): void {
        seedTargets([]);
        $c = Telegram::credentials('digest');

        eq($c['token'], 'DIGEST-TOKEN', 'token ของกลุ่มส่งมอบ');
        eq($c['chat'], '-100222', 'chat ของกลุ่มส่งมอบ');
    });
});

/**
 * ยังไม่ได้ตั้งกลุ่มที่สอง ต้องไปโผล่ที่กลุ่มคิวลูกค้า ไม่ใช่เงียบหาย
 * — ปลายทางที่ว่างแล้วส่งไม่ออกคือการแจ้งเตือนที่ตายเงียบ ซึ่งไม่มีใครมาบ่นให้รู้
 */
test('ยังไม่ได้ตั้งกลุ่มส่งมอบ ต้องตกกลับไปใช้กลุ่มคิวลูกค้า', function (): void {
    rollback(function (): void {
        seedTargets(['digest_telegram_bot_token' => '', 'digest_telegram_chat_id' => '']);
        $c = Telegram::credentials('digest');

        eq($c['token'], 'MAIN-TOKEN', 'ต้องยืม token ของคิวลูกค้ามาใช้');
        eq($c['chat'], '-100111', 'ต้องยืม chat ของคิวลูกค้ามาใช้');
        eq($c['fell_back'], true, 'ต้องบอกได้ว่านี่คือการตกกลับ ไม่ใช่ตั้งใจตั้งมาแบบนี้');
    });
});

test('ตั้งไว้ครึ่งเดียว (มี token ไม่มี chat) ก็ต้องตกกลับทั้งคู่', function (): void {
    rollback(function (): void {
        seedTargets(['digest_telegram_chat_id' => '']);
        $c = Telegram::credentials('digest');

        eq($c['chat'], '-100111', 'คู่ที่ไม่ครบใช้ไม่ได้ ต้องตกกลับทั้งคู่');
        eq($c['token'], 'MAIN-TOKEN', 'ห้ามเอา token ใหม่ไปคู่กับ chat เก่า');
    });
});

test('ชื่อปลายทางที่ไม่รู้จัก ต้องกลับไปใช้คิวลูกค้า ไม่ใช่ส่งไม่ออก', function (): void {
    rollback(function (): void {
        seedTargets([]);
        eq(Telegram::credentials('mystery')['chat'], '-100111', 'ค่าเพี้ยนต้องไม่ทำให้เงียบ');
    });
});

/* ------------------------------------------------------------------ *
 * สรุปส่งมอบเลือกปลายทางได้
 * ------------------------------------------------------------------ */

test('ยังไม่เคยตั้ง สรุปส่งมอบต้องไปเข้ากลุ่มรายงานการส่งมอบ', function (): void {
    rollback(function (): void {
        Telegram::saveSettings(['delivery_digest_target' => '']);
        eq(DeliveryDigest::target(), 'digest', 'ค่าเริ่มต้นคือกลุ่มของตัวเอง');
    });
});

test('เลือกให้ไปเข้ากลุ่มคิวลูกค้าได้', function (): void {
    rollback(function (): void {
        Telegram::saveSettings(['delivery_digest_target' => 'main']);
        eq(DeliveryDigest::target(), 'main', 'ต้องเคารพค่าที่เลือกไว้');
    });
});

test('ค่าปลายทางที่เพี้ยน ต้องกลับไปใช้ค่าเริ่มต้น', function (): void {
    rollback(function (): void {
        Telegram::saveSettings(['delivery_digest_target' => 'ลบทิ้ง']);
        eq(DeliveryDigest::target(), 'digest', 'ค่าที่ไม่รู้จักต้องไม่ทำให้ส่งไม่ออก');
    });
});

/* ------------------------------------------------------------------ *
 * ข้อความ
 * ------------------------------------------------------------------ */

/** แถวหลอกที่มีหน้าตาเหมือนผลลัพธ์ของ queue() */
function fakeRow(string $invoice, string $date, string $first = 'สมชาย'): array
{
    return [
        'invoice_code'    => $invoice,
        'case_code'       => 'CASE-X',
        'first_name'      => $first,
        'mid_name'        => null,
        'last_name'       => 'ใจดี',
        'phone'           => '0812345678',
        'appointment_date' => $date,
        'appointment_time' => null,
        'status_label_th' => 'รอลูกค้ามารับ',
        'is_rush'         => 0,
        'days_late'       => 0,
    ];
}

/** สร้างแถวปลอม $n ใบ ชื่อยาวพอให้ข้อความเกินลิมิตแน่ ๆ */
function fakeRows(int $n, string $date = '2026-09-10'): array
{
    $rows = [];
    for ($i = 1; $i <= $n; $i++) {
        $r = fakeRow('INV-' . $i, $date, 'ลูกค้าชื่อยาวพอสมควรคนที่ ' . $i);
        $r['days_late'] = $i;
        $rows[] = $r;
    }
    return $rows;
}

test('ข้อความคิว มีเลขออเดอร์ ชื่อลูกค้า และวันนัด', function (): void {
    $msgs = Telegram::deliveryQueueMessages([fakeRow('INV-777', '2026-09-10')], '2026-09-10');

    eq(count($msgs), 1, 'รายการเดียวต้องได้ข้อความเดียว');
    ok(str_contains($msgs[0], 'INV-777'), 'ต้องมีเลขออเดอร์');
    ok(str_contains($msgs[0], 'สมชาย'), 'ต้องมีชื่อลูกค้า');
    ok(str_contains($msgs[0], '10 ก.ย.'), 'ต้องมีวันนัด');
    ok(!str_contains($msgs[0], '(1/1)'), 'ข้อความเดียวไม่ต้องติดเลขตอน');
});

test('ไม่มีคิว ก็ยังต้องส่งข้อความบอกว่าไม่มี', function (): void {
    $msgs = Telegram::deliveryQueueMessages([], '2026-09-10');

    eq(count($msgs), 1, 'ต้องมีข้อความหนึ่งใบ — เงียบหายไปเฉย ๆ แยกไม่ออกว่าระบบตาย');
    ok(str_contains($msgs[0], 'ไม่มีคิว'), 'ต้องบอกตรง ๆ ว่าไม่มีคิว');
});

/* ------------------------------------------------------------------ *
 * ยาวเกินลิมิต — แบ่งเป็นหลายข้อความ ไม่ใช่ตัดทิ้ง
 * ------------------------------------------------------------------ */

test('รายการยาวเกินลิมิต ต้องแบ่งเป็นหลายข้อความ ไม่ตัดทิ้ง', function (): void {
    $msgs = Telegram::deliveryOverdueMessages(fakeRows(57), 30);

    ok(count($msgs) > 1, 'ห้าสิบเจ็ดรายการใส่ข้อความเดียวไม่พอ ต้องแบ่ง');
    foreach ($msgs as $i => $m) {
        ok(
            mb_strlen($m) <= Telegram::DIGEST_LIMIT,
            'ก้อนที่ ' . ($i + 1) . ' ยาว ' . mb_strlen($m) . ' เกินลิมิต ' . Telegram::DIGEST_LIMIT
        );
    }
});

test('แบ่งข้อความแล้ว ต้องไม่มีรายการไหนหาย', function (): void {
    $rows = fakeRows(57);
    $all  = implode("\n", Telegram::deliveryOverdueMessages($rows, 30));

    foreach ($rows as $r) {
        ok(
            str_contains($all, $r['invoice_code'] . '</b>'),
            'ออเดอร์ ' . $r['invoice_code'] . ' หายไปจากข้อความที่แบ่งแล้ว'
        );
    }
    ok(!str_contains($all, 'และอีก'), 'ครบทุกรายการแล้ว ต้องไม่มีคำว่า "และอีก" หลงเหลือ');
});

test('เลขลำดับต้องเดินต่อข้ามข้อความ ไม่รีเซ็ตเป็นหนึ่งใหม่', function (): void {
    $msgs = Telegram::deliveryOverdueMessages(fakeRows(57), 30);

    ok(str_contains($msgs[0], '1. '), 'ก้อนแรกต้องเริ่มที่ 1');
    ok(!str_contains($msgs[1], "\n1. "), 'ก้อนที่สองต้องไม่เริ่มนับหนึ่งใหม่');
    ok(str_contains(end($msgs), '57. '), 'รายการสุดท้ายต้องเป็นเลข 57');
});

test('ทุกก้อนต้องบอกว่าเป็นตอนที่เท่าไหร่จากกี่ตอน', function (): void {
    $msgs = Telegram::deliveryOverdueMessages(fakeRows(57), 30);
    $n    = count($msgs);

    foreach ($msgs as $i => $m) {
        ok(
            str_contains($m, '(' . ($i + 1) . '/' . $n . ')'),
            'ก้อนที่ ' . ($i + 1) . ' ต้องมี (' . ($i + 1) . '/' . $n . ') ไม่งั้นคนอ่านไม่รู้ว่ามีต่อ'
        );
    }
});

/**
 * ไม่มีเพดาน — ยาวแค่ไหนก็ต้องได้ครบ
 *
 * หกร้อยรายการคือคิวค้างที่ตั้งกรอบย้อนหลังกว้าง ๆ จะเจอจริง ถ้าเผลอใส่เพดาน
 * กลับเข้ามาวันหน้า เทสนี้จะจับได้ทันที
 */
test('ต่อให้หกร้อยรายการก็ต้องได้ครบ ไม่มีการตัดทิ้ง', function (): void {
    $rows = fakeRows(600);
    $msgs = Telegram::deliveryOverdueMessages($rows, 30);
    $all  = implode("\n", $msgs);

    ok(!str_contains($all, 'และอีก'), 'ต้องไม่มีการตัดแล้วสรุปว่า "และอีก N ราย"');
    ok(str_contains($all, 'INV-600</b>'), 'รายการสุดท้ายต้องอยู่ครบ');
    eq(substr_count($all, 'INV-'), 600, 'ต้องมีครบหกร้อยรายการ');
    foreach ($msgs as $i => $m) {
        ok(
            mb_strlen($m) <= Telegram::DIGEST_LIMIT,
            'ก้อนที่ ' . ($i + 1) . ' ยาว ' . mb_strlen($m) . ' เกินลิมิต'
        );
    }
});

test('ข้อความเลยกำหนด บอกจำนวนวันที่เลยมาของแต่ละราย', function (): void {
    $row = fakeRow('INV-888', '2026-08-20');
    $row['days_late'] = 20;

    $msgs = Telegram::deliveryOverdueMessages([$row], 30);

    eq(count($msgs), 1, 'รายการเดียวต้องได้ข้อความเดียว');
    ok(str_contains($msgs[0], 'INV-888'), 'ต้องมีเลขออเดอร์');
    ok(str_contains($msgs[0], '20 วัน'), 'ต้องบอกว่าเลยมา 20 วัน');
    ok(str_contains($msgs[0], '0812345678'), 'ต้องมีเบอร์โทร เพราะรายการนี้จบด้วยการโทรตาม');
});

test('ไม่มีรายการเลยกำหนด ต้องไม่มีข้อความให้ส่ง', function (): void {
    eq(
        Telegram::deliveryOverdueMessages([], 30),
        [],
        'ไม่มีของค้าง = ไม่ต้องรบกวนกลุ่ม (ต่างจากคิวพรุ่งนี้ที่ต้องยืนยันว่าระบบยังทำงาน)'
    );
});
