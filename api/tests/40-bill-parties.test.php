<?php

declare(strict_types=1);

/**
 * ชื่อผู้รับใบเสร็จ — `bill_parties` และ snapshot บนแถว `receipts`
 *
 * โจทย์ที่ทำให้ต้องมีไฟล์นี้: เคสเป็นของพ่อ แต่ใบเสร็จออกในนามลูก ช่องสี่ช่อง
 * บนหน้า /print/receipt เป็น useState เฉย ๆ ปิดหน้าแล้วหาย ลูกค้ากลับมาตัดแว่น
 * อีกครั้งก็ต้องพิมพ์ชื่อ-ที่อยู่-เลขผู้เสียภาษีใหม่ทั้งชุด
 *
 * สองอย่างที่แยกกันโดยตั้งใจ และเทสต์ในไฟล์นี้คุมเส้นแบ่งนั้นไว้:
 *   bill_parties  รายชื่อไว้ "หยิบมาใช้" — แก้ได้ ที่อยู่ย้ายได้
 *   receipts.bill_*  สิ่งที่ "พิมพ์ลงใบนั้นจริง" — เป็นเอกสารภาษี ห้ามเปลี่ยนตาม
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 * เพราะชุดนี้รันบนฐานเดียวกับที่ร้านใช้อยู่จริง
 */

group('ชื่อผู้รับใบเสร็จที่จำไว้ใช้ครั้งหน้า');

/** ลูกค้าหนึ่งใบ — ในเรื่องนี้คือ "พ่อ" คนที่มาตัดแว่น */
function billCustomer(Tx $q, string $first = 'พ่อ', string $last = 'ทดสอบใบเสร็จ'): int
{
    return (int) $q->run(
        'INSERT INTO customers (first_name, last_name, phone) VALUES (?,?,?)',
        $first,
        $last,
        '0000000000'
    )['insertId'];
}

/** ใบขาย POS หนึ่งใบ + เลขใบเสร็จของมัน — ที่ที่ snapshot จะไปลง */
function billReceipt(Tx $q, ?int $customerId = null): int
{
    $tag  = bin2hex(random_bytes(4));
    $sale = (int) $q->run(
        'INSERT INTO pos_sales (pos_no, sale_date, customer_id, customer_name_snapshot,
           subtotal, discount_amount, total_amount, fulfillment_status)
         VALUES (?,NOW(),?,?,?,0,?,?)',
        'TEST-POS-' . $tag,
        $customerId,
        'ทดสอบ',
        '1000.00',
        '1000.00',
        'delivered'
    )['insertId'];

    return (int) $q->run(
        'INSERT INTO receipts (receipt_no, sale_id, total_amount) VALUES (?,?,?)',
        'TEST-Bill-' . $tag,
        $sale,
        '1000.00'
    )['insertId'];
}

/** บันทึกนามผู้รับใบเสร็จผ่านเส้นทางจริง ไม่ใช่ INSERT ตรง — จะได้ทดสอบตรรกะรวมซ้ำด้วย */
function saveParty(array $body): array
{
    return Router::dispatch('POST', '/api/bill-parties', [], $body);
}

function findParties(array $query): array
{
    return Router::dispatch('GET', '/api/bill-parties', $query);
}

/**
 * ค้นด้วยชื่อ — จุดประสงค์ทั้งหมดของฟีเจอร์นี้อยู่ในเทสต์ข้อนี้: พิมพ์ชื่อลูก
 * แล้วต้องเจอ ทั้งที่เคสเป็นชื่อพ่อ
 */
test('ค้นด้วยชื่อแล้วเจอนามที่บันทึกไว้', function () {
    rollback(function (Tx $q) {
        $cust = billCustomer($q);
        saveParty([
            'name'        => 'ลูกชาย ทดสอบใบเสร็จ',
            'tax_id'      => '1234567890123',
            'address'     => '99/9 ถ.เพชรเกษม หัวหิน',
            'phone'       => '0610313996',
            'customer_id' => $cust,
        ]);

        $found = findParties(['q' => 'ลูกชาย']);
        eq(count($found), 1, 'ค้นชื่อ "ลูกชาย" ควรเจอหนึ่งราย');
        eq($found[0]['name'], 'ลูกชาย ทดสอบใบเสร็จ', 'ชื่อที่คืนมา');
        eq($found[0]['address'], '99/9 ถ.เพชรเกษม หัวหิน', 'ที่อยู่ที่คืนมา');
    });
});

test('ค้นด้วยเลขผู้เสียภาษีก็เจอ', function () {
    rollback(function (Tx $q) {
        saveParty(['name' => 'บริษัท ทดสอบ จำกัด', 'tax_id' => '0105536000021']);

        $found = findParties(['q' => '0105536000021']);
        eq(count($found), 1, 'ค้นด้วยเลขภาษีเต็มควรเจอหนึ่งราย');
        eq($found[0]['name'], 'บริษัท ทดสอบ จำกัด', 'ชื่อที่คืนมา');
    });
});

/**
 * กด "จำไว้ใช้ครั้งหน้า" ซ้ำด้วยชุดเดิม — รายชื่อต้องไม่งอก ไม่งั้นเปิดกล่องค้น
 * มาเจอชื่อเดียวกันสิบบรรทัดแล้วเลือกไม่ถูกว่าอันไหนที่อยู่ล่าสุด
 */
test('บันทึกชื่อ+เลขเดิมซ้ำ ได้แถวเดิม ไม่งอกแถวใหม่', function () {
    rollback(function (Tx $q) {
        $first = saveParty([
            'name'    => 'ลูกชาย ทดสอบใบเสร็จ',
            'tax_id'  => '1234567890123',
            'address' => 'ที่อยู่เดิม',
        ]);
        $again = saveParty([
            'name'    => '  ลูกชาย   ทดสอบใบเสร็จ  ',
            'tax_id'  => '1-2345-67890-12-3',
            'address' => 'ที่อยู่ใหม่',
        ]);

        eq((int) $again['id'], (int) $first['id'], 'ต้องเป็นแถวเดิม (ชื่อเว้นวรรคต่าง เลขมีขีด ก็คือคนเดียวกัน)');
        eq($again['address'], 'ที่อยู่ใหม่', 'ที่อยู่ต้องถูกอัปเดตเป็นค่าล่าสุด');
        eq(count(findParties(['q' => 'ลูกชาย'])), 1, 'ในรายชื่อต้องมีบรรทัดเดียว');
    });
});

/** ชื่อพ้องกันมีจริง — คนละเลขภาษีคือคนละนิติบุคคล ห้ามยุบรวม */
test('ชื่อเดียวกันแต่คนละเลขภาษี เป็นคนละแถว', function () {
    rollback(function (Tx $q) {
        $a = saveParty(['name' => 'สมชาย ใจดี', 'tax_id' => '1111111111111']);
        $b = saveParty(['name' => 'สมชาย ใจดี', 'tax_id' => '2222222222222']);

        ok((int) $a['id'] !== (int) $b['id'], 'คนละเลขภาษีต้องเป็นคนละแถว');
        eq(count(findParties(['q' => 'สมชาย ใจดี'])), 2, 'ค้นแล้วต้องเห็นทั้งสอง');
    });
});

/**
 * เปิดใบเสร็จของเคสพ่อ นามที่เคยใช้กับพ่อต้องลอยขึ้นบนสุด — คนกดจะได้ไม่ต้อง
 * อ่านทั้งรายการเพื่อหาอันที่ใช่
 */
test('นามที่เคยออกให้ลูกค้าคนนี้ขึ้นก่อนในผลค้น', function () {
    rollback(function (Tx $q) {
        $dad = billCustomer($q);
        saveParty(['name' => 'ทดสอบลำดับ คนอื่น']);
        saveParty(['name' => 'ทดสอบลำดับ ลูกของพ่อ', 'customer_id' => $dad]);

        $found = findParties(['q' => 'ทดสอบลำดับ', 'customer_id' => $dad]);
        eq(count($found), 2, 'ต้องเห็นทั้งสองราย ไม่ใช่กรองทิ้ง');
        eq($found[0]['name'], 'ทดสอบลำดับ ลูกของพ่อ', 'นามของลูกค้าคนนี้ต้องอยู่บนสุด');
    });
});

/**
 * ไม่ได้พิมพ์คำค้น แต่ระบุลูกค้า = "เปิดใบเสร็จของคนนี้ เคยออกในนามใครบ้าง"
 * ต้องกรองทิ้งของคนอื่น ไม่ใช่แค่เรียงลำดับ — หน้าใบเสร็จเอาแถวแรกมาเติมให้
 * อัตโนมัติ ถ้าเผลอคืนของคนอื่นมาคือพิมพ์เลขบัตรคนอื่นลงใบลูกค้า
 */
test('ไม่มีคำค้นแต่ระบุลูกค้า เห็นเฉพาะนามของลูกค้าคนนั้น', function () {
    rollback(function (Tx $q) {
        $dad = billCustomer($q);
        saveParty(['name' => 'ทดสอบกรอง คนอื่น']);
        saveParty(['name' => 'ทดสอบกรอง ลูกของพ่อ', 'customer_id' => $dad]);

        $found = findParties(['customer_id' => $dad]);
        eq(count($found), 1, 'ต้องเหลือเฉพาะนามที่ผูกกับลูกค้าคนนี้');
        eq($found[0]['name'], 'ทดสอบกรอง ลูกของพ่อ', 'ชื่อที่คืนมา');
    });
});

/**
 * เลข 13 หลักของบุคคลธรรมดาคือเลขบัตรประชาชน — ผลค้นหนึ่งครั้งกวาดมาได้ทีละหลายราย
 * จึงคืนแบบปิดกลาง ค่าเต็มออกทีละรายตอนเลือกแล้วเท่านั้น
 */
test('ผลค้นปิดกลางเลขผู้เสียภาษี ไม่ส่งค่าเต็ม', function () {
    rollback(function (Tx $q) {
        saveParty(['name' => 'ทดสอบปิดเลข', 'tax_id' => '3101800278601']);

        $row = findParties(['q' => 'ทดสอบปิดเลข'])[0];
        eq($row['tax_id_masked'], '3101******601', 'รูปแบบที่ปิดกลาง');
        ok(!array_key_exists('tax_id', $row), 'ผลค้นต้องไม่มีช่อง tax_id ค่าเต็ม');
    });
});

test('เปิดดูรายตัวได้เลขผู้เสียภาษีเต็มไว้พิมพ์ลงใบ', function () {
    rollback(function (Tx $q) {
        $saved = saveParty(['name' => 'ทดสอบเลขเต็ม', 'tax_id' => '3101800278601']);

        $one = Router::dispatch('GET', '/api/bill-parties/' . (int) $saved['id']);
        eq($one['tax_id'], '3101800278601', 'เปิดรายตัวต้องได้ค่าเต็ม');
    });
});

/**
 * ใบที่พิมพ์ไปแล้วต้องบอกได้ว่าพิมพ์อะไรลงไป — ตอนนี้ตาราง receipts เก็บแค่เลขกับยอด
 * ลูกค้าทำใบหายมาขอพิมพ์ซ้ำจึงได้เลขเดิมแต่บล็อกลูกค้าว่างเปล่า
 */
test('ใบเสร็จเก็บสิ่งที่พิมพ์ลงบล็อกลูกค้าจริง', function () {
    rollback(function (Tx $q) {
        $receipt = billReceipt($q);
        $party   = saveParty(['name' => 'ลูกชาย ทดสอบใบเสร็จ', 'tax_id' => '1234567890123']);

        Router::dispatch('PUT', "/api/receipts/$receipt/bill", [], [
            'bill_name'     => 'ลูกชาย ทดสอบใบเสร็จ',
            'bill_tax_id'   => '1234567890123',
            'bill_address'  => '99/9 ถ.เพชรเกษม หัวหิน',
            'bill_phone'    => '0610313996',
            'bill_party_id' => (int) $party['id'],
        ]);

        $row = Db::get('SELECT * FROM receipts WHERE id = ?', $receipt);
        eq($row['bill_name'], 'ลูกชาย ทดสอบใบเสร็จ', 'ชื่อบนใบ');
        eq($row['bill_address'], '99/9 ถ.เพชรเกษม หัวหิน', 'ที่อยู่บนใบ');
        eq((int) $row['bill_party_id'], (int) $party['id'], 'โยงกลับไปนามที่หยิบมาใช้');
    });
});

/**
 * เส้นแบ่งของทั้งฟีเจอร์: รายชื่อเป็นของ "ครั้งหน้า" ใบเสร็จเป็นของ "ครั้งนั้น"
 * ลูกย้ายบ้านแล้วมาตัดแว่นใหม่ ใบเก่าต้องยังพิมพ์ที่อยู่เดิมออกมาได้
 */
test('แก้ที่อยู่ในรายชื่อแล้ว ใบเสร็จเก่าไม่เปลี่ยนตาม', function () {
    rollback(function (Tx $q) {
        $receipt = billReceipt($q);
        $party   = saveParty(['name' => 'ทดสอบย้ายบ้าน', 'tax_id' => '9999999999999', 'address' => 'บ้านเก่า']);

        Router::dispatch('PUT', "/api/receipts/$receipt/bill", [], [
            'bill_name'     => 'ทดสอบย้ายบ้าน',
            'bill_tax_id'   => '9999999999999',
            'bill_address'  => 'บ้านเก่า',
            'bill_party_id' => (int) $party['id'],
        ]);
        saveParty(['name' => 'ทดสอบย้ายบ้าน', 'tax_id' => '9999999999999', 'address' => 'บ้านใหม่']);

        $row = Db::get('SELECT bill_address FROM receipts WHERE id = ?', $receipt);
        eq($row['bill_address'], 'บ้านเก่า', 'ใบที่ออกไปแล้วต้องคงที่อยู่ ณ วันที่ออก');
    });
});

/** ใบเสร็จที่ไม่มีจริง ต้องเป็น 404 ไม่ใช่เขียนลงที่ว่าง */
test('บันทึกบล็อกลูกค้าลงใบเสร็จที่ไม่มีจริง ตอบ 404', function () {
    rollback(function (Tx $q) {
        /* ต้องเทียบข้อความด้วย ไม่ใช่แค่สถานะ — Router::dispatch โยน 404 "No route"
           ให้เส้นทางที่ยังไม่มีอยู่เหมือนกัน เทสต์ที่ดูแค่ 404 จึงเขียวได้ทั้งที่
           ยังไม่ได้เขียนอะไรเลย */
        $status = null;
        $msg    = '';
        try {
            Router::dispatch('PUT', '/api/receipts/999999999/bill', [], ['bill_name' => 'ผี']);
        } catch (HttpError $e) {
            $status = $e->status;
            $msg    = $e->getMessage();
        }
        eq($status, 404, 'ต้องโยน HttpError 404');
        ok(!str_contains($msg, 'No route'), 'ต้องเป็น 404 ของ "ไม่พบใบเสร็จ" ไม่ใช่ 404 ของ "ไม่มีเส้นทางนี้"');
    });
});

group('เลขผู้เสียภาษีต้องไม่ตกลงบันทึกการใช้งาน');

/**
 * `/api/bill-parties` กับ `/api/receipts` ไม่ได้อยู่ใน ActivityLog::ENTITIES จึงไม่มี
 * diff ก่อน-หลังให้เทียบ ตัวบันทึกเลยเก็บ body ที่ส่งมาทั้งก้อนแทน — ซึ่งมี
 * เลขบัตรประชาชนอยู่ในนั้น
 *
 * ป้องกันด้วย SECRET_HINTS ที่มีอยู่แล้ว ไม่ใช่ด้วยการจำว่าอย่าส่ง เทสต์ข้อนี้
 * ยิงเข้า isSecret() ตรง ๆ ผ่าน Reflection เพราะมันเป็นฟังก์ชันบริสุทธิ์ที่ตัดสิน
 * เรื่องนี้เรื่องเดียว — ส่วนที่เหลือของคลาสต้องมี session กับฝั่งคลังถึงจะเดินได้
 */
function isSecretField(string $field): bool
{
    $m = new ReflectionMethod(ActivityLog::class, 'isSecret');
    $m->setAccessible(true);
    return (bool) $m->invoke(null, $field);
}

test('ช่อง tax_id และ bill_tax_id ถูกปิดก่อนเก็บลงล็อก', function () {
    ok(isSecretField('tax_id'), 'tax_id ต้องถูกปิด');
    ok(isSecretField('bill_tax_id'), 'bill_tax_id ต้องถูกปิด');
});

/** กันปิดกว้างเกินจนล็อกอ่านไม่ออก — ช่องอื่นของนามผู้รับใบต้องยังเห็นได้ */
test('ชื่อกับที่อยู่ผู้รับใบเสร็จยังเห็นในล็อกตามเดิม', function () {
    ok(!isSecretField('bill_name'), 'bill_name ต้องไม่ถูกปิด');
    ok(!isSecretField('bill_address'), 'bill_address ต้องไม่ถูกปิด');
});
