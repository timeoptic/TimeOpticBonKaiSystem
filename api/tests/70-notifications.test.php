<?php

declare(strict_types=1);

/**
 * การแจ้งเตือนทุกชนิด — ของที่พังแล้วไม่มีใครมาบ่น
 *
 * หน้าจอที่พังมีคนโทรมาภายในห้านาที แต่การแจ้งเตือนที่เงียบไปเฉย ๆ ไม่มีใครรู้
 * จนกว่าจะมีลูกค้าไม่มาตามนัดแล้วไล่ย้อนกลับมา ไฟล์นี้จึงเฝ้าเกณฑ์ทุกข้อที่
 * ตัดสินว่า "ส่ง" หรือ "ไม่ส่ง"
 *
 * ปลายทางที่ยิงออกจริงมีหกที่ในระบบ:
 *
 *   1. จองคิวใหม่                → routes/bookings.php  (bookingCreatedPing)
 *   2. กดปุ่มเตือนเอง             → routes/bookings.php  POST /api/bookings/:id/remind
 *   3. ปุ่มทดสอบในหน้าตั้งค่า      → routes/settings.php  POST /api/settings/telegram/test
 *   4. สรุปคิวส่งมอบวันละครั้ง    → services/DeliveryDigest.php  (ดู 50-delivery-digest)
 *   5. รอบกวาดเตือนคิวรายคน      → services/Scheduler.php  ← ไฟล์นี้
 *   6. ของใกล้หมดในคลัง          → stock/api/src/Service/LowStock.php (ดู 71-low-stock-alert)
 *
 * ทั้งหกตัวลงมาที่ `Telegram::send()` จุดเดียว ด่านสุดท้ายจึงทดสอบครั้งเดียวได้
 *
 * **ไม่มีเทสต์ตัวไหนในไฟล์นี้ยิงข้อความเข้ากลุ่มจริง** — ทุกตัวหยุดที่ฟังก์ชัน
 * ตัดสินใจหรือหยุดที่ด่านที่ปฏิเสธก่อนถึง HTTP ถ้าเผลอเขียนเทสต์ที่ทำให้
 * `Telegram::send()` ผ่านด่านครบ มันจะยิงเข้ากลุ่มพนักงานจริงทุกครั้งที่รันชุดนี้
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('รอบกวาด — ใครถึงคิวเตือนบ้าง');

/**
 * คิวจองหนึ่งใบ ตั้งเวลานัดห่างจากตอนนี้กี่นาทีก็ได้ (ติดลบ = เลยเวลามาแล้ว)
 *
 * ผูกเวลากับ NOW() ของ MySQL ไม่ใช่นาฬิกาของ PHP — เกณฑ์ใน dueBookings()
 * เทียบกับ NOW() ถ้าสองนาฬิกาเหลื่อมกันแม้วินาทีเดียว เทสต์ขอบจะกะพริบ
 */
function bookingIn(Tx $q, int $minutesAway, array $extra = []): int
{
    $f = $extra + [
        'status'           => 'booked',
        'reminder_minutes' => 30,
        'reminder_sent_at' => null,
        'first_name'       => 'ทดสอบ',
        'last_name'        => 'แจ้งเตือน',
    ];

    return (int) $q->run(
        'INSERT INTO bookings
           (booking_code, first_name, last_name, phone, booking_date, booking_time,
            service_type, status, reminder_minutes, reminder_sent_at)
         VALUES (?,?,?,?,
                 DATE(NOW() + INTERVAL ? MINUTE), TIME(NOW() + INTERVAL ? MINUTE),
                 ?,?,?,?)',
        'TEST-BK-' . bin2hex(random_bytes(4)),
        $f['first_name'],
        $f['last_name'],
        '0891112222',
        $minutesAway,
        $minutesAway,
        'eye_exam',
        $f['status'],
        $f['reminder_minutes'],
        $f['reminder_sent_at']
    )['insertId'];
}

/** คิวใบนี้อยู่ในรายการที่ถึงเวลาเตือนไหม */
function isDue(int $bookingId): bool
{
    foreach (Scheduler::dueBookings() as $b) {
        if ((int) $b['id'] === $bookingId) {
            return true;
        }
    }
    return false;
}

test('นัดอีก 10 นาที ตั้งเตือนไว้ 30 นาที — ถึงคิวเตือนแล้ว', function () {
    rollback(function (Tx $q) {
        $id = bookingIn($q, 10, ['reminder_minutes' => 30]);
        eq(isDue($id), true, 'ต้องอยู่ในคิวเตือน');
    });
});

test('นัดอีก 90 นาที ตั้งเตือนไว้ 30 นาที — ยังไม่ถึงคิว', function () {
    rollback(function (Tx $q) {
        $id = bookingIn($q, 90, ['reminder_minutes' => 30]);
        eq(isDue($id), false, 'ยังไม่ถึงกรอบเตือนของตัวเอง');
    });
});

/* รอบกวาดรันทุกนาที ถ้าไม่ดูธงนี้ ลูกค้าคนเดียวจะโดนเตือนสามสิบครั้ง */
test('เตือนไปแล้ว ต้องไม่เข้าคิวซ้ำ', function () {
    rollback(function (Tx $q) {
        $id = bookingIn($q, 10, ['reminder_sent_at' => date('Y-m-d H:i:s')]);
        eq(isDue($id), false, 'ใบที่ปักธงว่าเตือนแล้วต้องหลุดออกจากคิว');
    });
});

test('ปิดการเตือนของใบนั้น (0 นาที) ต้องไม่เข้าคิว', function () {
    rollback(function (Tx $q) {
        $id = bookingIn($q, 0, ['reminder_minutes' => 0]);
        eq(isDue($id), false, 'ตั้ง 0 = ไม่ต้องเตือน');
    });
});

test('คิวที่ยกเลิกไปแล้ว ต้องไม่เตือน', function () {
    rollback(function (Tx $q) {
        $id = bookingIn($q, 10, ['status' => 'cancelled']);
        eq(isDue($id), false, 'ยกเลิกแล้วยังเตือนอยู่ = โทรตามลูกค้าที่ไม่ได้จะมา');
    });
});

test('คิวที่ยืนยันแล้ว ต้องเตือนเหมือนคิวที่เพิ่งจอง', function () {
    rollback(function (Tx $q) {
        $id = bookingIn($q, 10, ['status' => 'confirmed']);
        eq(isDue($id), true, 'confirmed ต้องอยู่ในคิวด้วย');
    });
});

/* เปิดเครื่องสายหรือรอบกวาดล่ม — ยังต้องเตือนคิวที่เพิ่งเลยเวลามา
   แต่ไม่ใช่คิวเมื่อวาน (GRACE_MINUTES = 45) */
test('เลยเวลานัดมา 20 นาที ยังเตือนอยู่', function () {
    rollback(function (Tx $q) {
        $id = bookingIn($q, -20);
        eq(isDue($id), true, 'ยังอยู่ในช่วงผ่อนผัน');
    });
});

test('เลยเวลานัดมา 3 ชั่วโมง ต้องเลิกเตือนแล้ว', function () {
    rollback(function (Tx $q) {
        $id = bookingIn($q, -180);
        eq(isDue($id), false, 'เลยช่วงผ่อนผัน 45 นาทีไปแล้ว');
    });
});

group('ข้อความที่ส่งออกไป');

/** คิวจองหนึ่งใบในรูปที่ Scheduler ส่งต่อให้ตัวประกอบข้อความ */
function msgFixture(array $extra = []): array
{
    return $extra + [
        'booking_code'  => 'BK-2026-00042',
        'first_name'    => 'สมชาย',
        'last_name'     => 'ใจดี',
        'phone'         => '0812345678',
        'booking_date'  => '2026-09-10',
        'booking_time'  => '14:30:00',
        'service_label' => 'ตรวจวัดสายตา',
    ];
}

test('ข้อความเตือนคิว มีเวลา ชื่อ และรหัสจอง', function () {
    $m = Telegram::reminderMessage(msgFixture(), 15);

    ok(str_contains($m, 'อีก 15 นาที'), 'ต้องบอกว่าอีกกี่นาที');
    ok(str_contains($m, '14:30'), 'ต้องมีเวลานัด — ตัดวินาทีออกแล้ว');
    ok(!str_contains($m, '14:30:00'), 'ต้องไม่โชว์วินาที');
    ok(str_contains($m, 'สมชาย ใจดี'), 'ต้องมีชื่อลูกค้า');
    ok(str_contains($m, '0812345678'), 'ต้องมีเบอร์โทรให้กดโทรออกได้');
    ok(str_contains($m, 'BK-2026-00042'), 'ต้องมีรหัสจองไว้ค้นย้อนกลับ');
});

test('ข้อความจองใหม่ มีวันเวลาและรหัสจอง', function () {
    $m = Telegram::bookingCreatedMessage(msgFixture());

    ok(str_contains($m, 'มีการจองคิวใหม่'), 'หัวข้อ');
    ok(str_contains($m, '2026-09-10'), 'วันที่นัด');
    ok(str_contains($m, '14:30'), 'เวลานัด');
    ok(str_contains($m, 'BK-2026-00042'), 'รหัสจอง');
});

test('ไม่รู้ชื่อลูกค้า ต้องไม่ได้ข้อความที่มีช่องว่างเปล่า', function () {
    $m = Telegram::reminderMessage(msgFixture(['first_name' => null, 'last_name' => null]), 5);
    ok(str_contains($m, 'ลูกค้า (ไม่ระบุชื่อ)'), 'ต้องมีคำแทนชื่อ');
});

/**
 * ข้อความส่งแบบ HTML — ชื่อที่มี `<` หรือ `&` ต้องถูก escape
 *
 * ถ้าไม่ escape Telegram จะปฏิเสธทั้งข้อความด้วย "can't parse entities" แปลว่า
 * **ไม่ได้รับอะไรเลย** ไม่ใช่ได้ข้อความที่หน้าตาเพี้ยน · ชื่อร้านที่มี & อย่าง
 * "แว่นตา A&B" พอเข้ามาอยู่ในช่องหมายเหตุก็ทำให้เงียบได้ทั้งใบ
 */
test('ชื่อที่มีอักขระ HTML ต้องถูก escape ไม่ใช่ทำให้ข้อความส่งไม่ออก', function () {
    $m = Telegram::reminderMessage(msgFixture([
        'first_name' => 'A&B',
        'last_name'  => '<script>',
    ]), 5);

    ok(str_contains($m, '&amp;'), 'เครื่องหมาย & ต้องถูก escape');
    ok(str_contains($m, '&lt;script&gt;'), 'วงเล็บมุมต้องถูก escape');
    ok(!str_contains($m, '<script>'), 'ต้องไม่มีแท็กดิบหลุดออกไป');
});

group('ด่านสุดท้ายก่อนส่งจริง');

/**
 * ปิดสวิตช์แจ้งเตือนไว้ = ต้องไม่ส่ง แต่ต้อง **บันทึกไว้ว่าทำไมไม่ส่ง**
 *
 * ถ้าเงียบโดยไม่ทิ้งร่องรอย คนที่มาถามว่า "ทำไมแจ้งเตือนไม่มา" จะไม่มีที่ให้ดู
 * แล้วต้องไปไล่โค้ดแทนที่จะเปิดหน้าบันทึกการแจ้งเตือน
 */
test('ปิดสวิตช์อยู่ ต้องไม่ส่ง และต้องบันทึกเหตุผลไว้', function () {
    rollback(function (Tx $q) {
        Telegram::saveSettings([
            'telegram_enabled'   => '0',
            'telegram_bot_token' => 'FAKE-TOKEN-ไม่ได้ใช้จริง',
            'telegram_chat_id'   => '-100999',
        ]);

        eq(Telegram::isEnabled(), false, 'สวิตช์ต้องอ่านว่าปิด');

        $res = Telegram::send('ข้อความทดสอบ', ['kind' => 'test_disabled']);

        eq($res['ok'], false, 'ต้องไม่ส่ง');
        ok(str_contains((string) $res['error'], 'ปิดการแจ้งเตือน'), 'เหตุผลที่คนอ่านเข้าใจ — ได้ ' . $res['error']);

        $log = $q->get(
            "SELECT ok, error FROM notification_log WHERE kind = 'test_disabled' ORDER BY id DESC LIMIT 1"
        );
        ok($log !== null, 'ต้องมีบรรทัดในบันทึกการแจ้งเตือน');
        eq((int) $log['ok'], 0, 'ต้องบันทึกว่าส่งไม่สำเร็จ');
        ok(str_contains((string) $log['error'], 'ปิดการแจ้งเตือน'), 'เหตุผลต้องถูกเก็บไว้ด้วย');
    });
});

test('ยังไม่ได้ตั้ง bot token ต้องไม่ส่ง และบอกว่ายังไม่ได้ตั้งค่า', function () {
    rollback(function (Tx $q) {
        Telegram::saveSettings([
            'telegram_enabled'   => '1',
            'telegram_bot_token' => '',
            'telegram_chat_id'   => '',
        ]);

        eq(Telegram::isConfigured(), false, 'ต้องอ่านว่ายังไม่ได้ตั้งค่า');

        $res = Telegram::send('ข้อความทดสอบ', ['kind' => 'test_unconfigured']);

        eq($res['ok'], false, 'ต้องไม่ส่ง');
        ok(str_contains((string) $res['error'], 'ยังไม่ได้ตั้งค่า'), 'เหตุผล — ได้ ' . $res['error']);
    });
});

/* รอบกวาดต้องหยุดตั้งแต่ต้นถ้าสวิตช์ปิด ไม่ใช่ไปไล่ยิงทีละใบแล้วโดนปฏิเสธทีละใบ
   — ทุกใบที่โดนปฏิเสธเขียนหนึ่งบรรทัดลงบันทึก คิวยี่สิบใบทุกนาทีคือขยะวันละสามหมื่นบรรทัด */
test('สวิตช์ปิด รอบกวาดต้องหยุดตั้งแต่ต้น ไม่ไล่ยิงทีละใบ', function () {
    rollback(function (Tx $q) {
        Telegram::saveSettings(['telegram_enabled' => '0']);
        bookingIn($q, 10);

        $res = Scheduler::runOnce();

        eq($res['sent'], 0, 'ต้องไม่ส่งอะไรเลย');
        ok(isset($res['skipped']), 'ต้องบอกว่าข้ามเพราะอะไร');
        ok(!isset($res['checked']), 'ต้องไม่ไปถึงขั้นไล่ดูทีละใบ');
    });
});

group('หน้าบันทึกการแจ้งเตือน');

test('บรรทัดที่เพิ่งเกิด ต้องเห็นในหน้าบันทึกการแจ้งเตือน', function () {
    rollback(function (Tx $q) {
        Telegram::saveSettings(['telegram_enabled' => '0']);
        Telegram::send('ข้อความทดสอบ', ['kind' => 'test_visible']);

        $rows = Router::dispatch('GET', '/api/notifications', ['limit' => '20']);

        $found = false;
        foreach ($rows as $r) {
            if (($r['kind'] ?? '') === 'test_visible') {
                $found = true;
            }
        }
        eq($found, true, 'ต้องหาบรรทัดที่เพิ่งเขียนเจอ');
    });
});

test('ขอเกิน 500 บรรทัด ต้องถูกจำกัดไว้ที่ 500', function () {
    rollback(function (Tx $q) {
        $rows = Router::dispatch('GET', '/api/notifications', ['limit' => '99999']);
        ok(count($rows) <= 500, 'ต้องไม่เกิน 500 — ได้ ' . count($rows));
    });
});

/**
 * ค่าที่ตั้งไว้จริงของร้านต้องกลับมาเหมือนเดิมหลังชุดนี้จบ
 *
 * `Telegram::settings()` แคชไว้ในตัวแปร static ซึ่ง roll back ของฐานข้อมูล
 * ตามไปล้างให้ไม่ได้ — ถ้าไม่ล้างเอง เทสต์ไฟล์ถัดไป (และ `POST /api/reminders/run`
 * ถ้ามีใครรันในโปรเซสเดียวกัน) จะอ่านค่า 'FAKE-TOKEN' ที่ถูก roll back ไปแล้ว
 */
test('ค่าตั้งค่าจริงของร้านต้องไม่ถูกทิ้งไว้ในแคช', function () {
    Telegram::invalidate();
    $s = Telegram::settings(true);

    eq(($s['telegram_bot_token'] ?? ''), (string) Db::get(
        "SELECT `value` FROM app_settings WHERE `key` = 'telegram_bot_token'"
    )['value'] ?? '', 'token ที่อ่านได้ต้องตรงกับที่อยู่ในฐานจริง');
});
