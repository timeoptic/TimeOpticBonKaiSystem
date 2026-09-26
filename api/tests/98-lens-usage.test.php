<?php

declare(strict_types=1);

/**
 * Bewell: รายการเลนส์ (lens_catalog) → ขาย → การใช้เลนส์ (Lens Usage) → Export
 * และการยกเลิกที่ต้องเหลือร่องรอย · ทุกข้อ roll back
 * ใช้ lrFixture() / lrSync() / lrStatusCode() จาก 98-lens-requisition (โหลดก่อนไฟล์นี้)
 */

group('รายการเลนส์และการใช้เลนส์ (Bewell)');

/** เลนส์ทดสอบในรายการ — คืน id */
function luCatalog(Tx $q): int
{
    return (int) $q->run(
        'INSERT INTO lens_catalog (code, lens_name, lens_type, lens_index, coating, cost_price, selling_price) VALUES (?,?,?,?,?,?,?)',
        'TEST-' . strtoupper(bin2hex(random_bytes(3))),
        'Single Vision 1.56 Blue Cut (ทดสอบ)',
        'Single Vision',
        '1.56',
        'Blue',
        500,
        1500
    )['insertId'];
}

function luPair(int $catalogId, float $price = 1500): array
{
    return [['eye' => 'pair', 'lens_catalog_id' => $catalogId, 'quantity' => 1, 'unit_price' => $price, 'brand' => 'ค่าจากหน้าเว็บ']];
}

/** ตัวกรองที่เห็นแค่เคสทดสอบนี้ */
function luCase(Tx $q, int $caseId): array
{
    return ['q' => $q->get('SELECT case_code FROM cases WHERE id = ?', $caseId)['case_code']];
}

test('sync จากรายการเลนส์: คัดลอกชื่อ ชนิด และต้นทุนจากฐาน ไม่เชื่อค่าจากหน้าเว็บ', function () {
    rollback(function (Tx $q) {
        $f   = lrFixture($q);
        $cat = luCatalog($q);
        $r   = lrSync($f['order'], luPair($cat));
        $it  = $r['items'][0];
        eq($it['eye'], 'pair', 'ข้าง');
        eq($it['source'], 'CATALOG', 'แหล่ง');
        eq($it['lens_name'], 'Single Vision 1.56 Blue Cut (ทดสอบ)', 'ชื่อเลนส์');
        eq($it['brand'], '', 'ยี่ห้อมาจากฐาน (ว่าง) ไม่ใช่ค่าที่หน้าเว็บส่ง');
        eq((float) $it['cost_price'], 500.0, 'ต้นทุนต่อคู่');
        eq((float) $it['line_total'], 1500.0, 'ราคาขาย');
    });
});

test('แก้ชื่อหรือราคาในรายการเลนส์ทีหลัง ใบที่ขายไปแล้วไม่เปลี่ยน', function () {
    rollback(function (Tx $q) {
        $f   = lrFixture($q);
        $cat = luCatalog($q);
        $r   = lrSync($f['order'], luPair($cat));
        $q->run("UPDATE lens_catalog SET lens_name = 'ชื่อใหม่', cost_price = 999 WHERE id = ?", $cat);
        $it = $q->get('SELECT lens_name, cost_price FROM lens_requisition_items WHERE requisition_id = ?', (int) $r['id']);
        eq($it['lens_name'], 'Single Vision 1.56 Blue Cut (ทดสอบ)', 'ชื่อในใบ');
        eq((float) $it['cost_price'], 500.0, 'ต้นทุนในใบ');
    });
});

test('ข้างเดียวคิดต้นทุนครึ่งคู่ มีค่าสายตาเฉพาะข้างนั้น', function () {
    rollback(function (Tx $q) {
        $f   = lrFixture($q);
        $cat = luCatalog($q);
        $r   = lrSync($f['order'], [['eye' => 'R', 'lens_catalog_id' => $cat, 'unit_price' => 750]]);
        eq((float) $r['items'][0]['cost_price'], 250.0, 'ต้นทุนข้างเดียว');
        LensRequisition::markUsed($q, $f['case'], null);
        $row = LensUsage::page(luCase($q, $f['case']), true)['rows'][0];
        eq($row['unit'], 'ข้าง', 'หน่วย');
        eq($row['od']['sph'], '-1.25', 'OD SPH');
        eq($row['os'], null, 'ไม่มี OS');
    });
});

test('ยังไม่ยืนยันขั้นขาย = ยังไม่ใช่การใช้เลนส์ · ยืนยันแล้วขึ้นพร้อมค่าสายตา ณ วันขาย', function () {
    rollback(function (Tx $q) {
        $f   = lrFixture($q);
        $cat = luCatalog($q);
        lrSync($f['order'], luPair($cat));
        eq(LensUsage::count(luCase($q, $f['case'])), 0, 'ก่อนขาย');
        eq(LensRequisition::markUsed($q, $f['case'], null), 1, 'ประทับ 1 ใบ');
        eq(LensRequisition::markUsed($q, $f['case'], null), 0, 'กดซ้ำไม่ประทับทับ');
        $page = LensUsage::page(luCase($q, $f['case']), true);
        eq($page['total'], 1, 'หลังขาย');
        $row = $page['rows'][0];
        eq($row['od'], ['sph' => '-1.25', 'cyl' => '-0.50', 'axis' => '180', 'add' => null], 'OD');
        eq($row['os']['sph'], '-1.00', 'OS SPH');
        eq($row['statusCode'], 'PENDING', 'สถานะ');
        eq($row['unit'], 'คู่', 'หน่วย');
        eq(LensUsage::page(luCase($q, $f['case']), false)['rows'][0]['costPrice'], null, 'ไม่มีสิทธิ์ต้นทุน = ไม่เห็น');
    });
});

/* ร้านขอ 26 ก.ย. 2026: ยืนยันขายแล้วยังเปลี่ยนเลนส์ได้โดยไม่ต้องเปิดขั้นขายกลับ — ใบยังนับเป็น
   "ใช้เลนส์" (used_at เดิม) แต่รายการเป็นตัวใหม่ และไทม์ไลน์จำว่าเปลี่ยนจากอะไรเป็นอะไร */
test('ขายแล้ว sync เปลี่ยนเลนส์ได้: ยังนับเป็นใช้เลนส์ รายการเป็นตัวใหม่ ลงไทม์ไลน์', function () {
    rollback(function (Tx $q) {
        $f    = lrFixture($q);
        $cat  = luCatalog($q);
        $cat2 = luCatalog($q);
        $q->run("UPDATE lens_catalog SET lens_name = 'Progressive (ทดสอบ)' WHERE id = ?", $cat2);
        $r = lrSync($f['order'], luPair($cat));
        LensRequisition::markUsed($q, $f['case'], null);
        $usedAt = $q->get('SELECT used_at FROM lens_requisitions WHERE id = ?', (int) $r['id'])['used_at'];

        $r2 = lrSync($f['order'], luPair($cat2, 2000));
        eq((int) $r2['id'], (int) $r['id'], 'ใบเดิม ไม่ออกใบใหม่');
        eq($r2['items'][0]['lens_name'], 'Progressive (ทดสอบ)', 'รายการเป็นเลนส์ตัวใหม่');
        eq($q->get('SELECT used_at FROM lens_requisitions WHERE id = ?', (int) $r['id'])['used_at'], $usedAt, 'ยังนับเป็นใช้เลนส์ วันที่ขายเดิม');
        eq(LensUsage::count(luCase($q, $f['case'])), 1, 'ประวัติเลนส์ยังมี 1 รายการ');
        $ev = $q->get("SELECT note FROM case_events WHERE case_id = ? AND action = 'lens_usage_changed'", $f['case']);
        ok(str_contains((string) ($ev['note'] ?? ''), 'Progressive (ทดสอบ)'), 'ไทม์ไลน์บอกเลนส์ตัวใหม่');
        ok(str_contains((string) ($ev['note'] ?? ''), 'Single Vision 1.56 Blue Cut'), 'ไทม์ไลน์บอกเลนส์ตัวเดิม');
    });
});

test('เปิดขั้นขายกลับมา: ใบกลับเป็นร่าง หายจากประวัติเลนส์ ลงไทม์ไลน์', function () {
    rollback(function (Tx $q) {
        $f   = lrFixture($q);
        $cat = luCatalog($q);
        lrSync($f['order'], luPair($cat));
        LensRequisition::markUsed($q, $f['case'], null);
        eq(LensRequisition::unmarkUsed($q, $f['case'], null), 1, 'ถอน 1 ใบ');
        eq(LensUsage::count(luCase($q, $f['case'])), 0, 'หายจากรายการใช้เลนส์');
        $ev = $q->get("SELECT COUNT(*) n FROM case_events WHERE case_id = ? AND action = 'lens_usage_reverted'", $f['case']);
        eq((int) $ev['n'], 1, 'ลงไทม์ไลน์');
    });
});

test('ลบออเดอร์: ใบเบิกถูกยกเลิกไม่ถูกลบ จำเลขออเดอร์ เวลา และที่มา', function () {
    rollback(function (Tx $q) {
        $f = lrFixture($q);
        $q->run("UPDATE custom_orders SET invoice_code = 'INV-TEST-LU' WHERE id = ?", $f['order']);
        $cat = luCatalog($q);
        $r   = lrSync($f['order'], luPair($cat));
        LensRequisition::markUsed($q, $f['case'], null);
        Router::dispatch('DELETE', '/api/orders/' . $f['order']);
        $lr = $q->get('SELECT * FROM lens_requisitions WHERE id = ?', (int) $r['id']);
        ok($lr !== null, 'ใบยังอยู่');
        eq($lr['status'], 'cancelled', 'สถานะ');
        eq($lr['cancel_source'], 'order_deleted', 'ที่มา');
        eq($lr['order_ref'], 'INV-TEST-LU', 'เลขออเดอร์');
        ok($lr['cancelled_at'] !== null, 'เวลา');
        $row = LensUsage::page(luCase($q, $f['case']) + ['status' => 'cancelled'], true)['rows'][0];
        eq($row['invoiceCode'], 'INV-TEST-LU', 'ยังเห็นเลขออเดอร์ในรายการ');
        ok(str_contains($row['note'], 'ลบออเดอร์'), 'หมายเหตุ ' . $row['note']);
    });
});

test('ยกเลิกเคส: ใบเบิกของเคสถูกยกเลิก · ใบที่ประกอบแล้วไม่แตะ', function () {
    rollback(function (Tx $q) {
        $f   = lrFixture($q);
        $cat = luCatalog($q);
        $r   = lrSync($f['order'], luPair($cat));
        Router::dispatch('POST', '/api/cases/' . $f['case'] . '/status', [], ['status' => 'cancelled', 'note' => 'ลูกค้ายกเลิก']);
        $lr = $q->get('SELECT status, cancel_source, cancel_reason FROM lens_requisitions WHERE id = ?', (int) $r['id']);
        eq($lr['status'], 'cancelled', 'สถานะ');
        eq($lr['cancel_source'], 'case_cancelled', 'ที่มา');
        ok(str_contains((string) $lr['cancel_reason'], 'ลูกค้ายกเลิก'), 'เหตุผล');

        $g = lrFixture($q);
        $s = lrSync($g['order'], luPair($cat));
        $q->run("UPDATE lens_requisitions SET status = 'assembled' WHERE id = ?", (int) $s['id']);
        eq(LensRequisition::cancelFor($q, 'case', $g['case'], 'case_cancelled', 'ทดสอบ', null), 0, 'ไม่ยกเลิกใบประกอบแล้ว');
    });
});

test('ตัวกรอง: ชนิด ชื่อ Index Coating สถานะ ช่วงวัน', function () {
    rollback(function (Tx $q) {
        $f   = lrFixture($q);
        $cat = luCatalog($q);
        lrSync($f['order'], luPair($cat));
        LensRequisition::markUsed($q, $f['case'], null);
        $base = luCase($q, $f['case']);
        eq(LensUsage::count($base + ['lens_type' => 'Single Vision', 'index' => '1.56', 'coating' => 'Blue']), 1, 'ตรง');
        eq(LensUsage::count($base + ['lens_name' => 'Single Vision 1.56 Blue Cut (ทดสอบ)']), 1, 'ชื่อตรงตัว');
        eq(LensUsage::count($base + ['lens_name' => 'Single Vision 1.56']), 0, 'ชื่อบางส่วนไม่นับ');
        eq(LensUsage::count($base + ['lens_type' => 'Progressive']), 0, 'ชนิดไม่ตรง');
        eq(LensUsage::count($base + ['status' => 'issued']), 0, 'สถานะไม่ตรง');
        eq(LensUsage::count($base + ['from' => '2000-01-01', 'to' => '2000-01-02']), 0, 'นอกช่วงวัน');
    });
});

test('Export: ไฟล์ xlsx ชีต "Lens Usage - Be Well" มีแถวตามตัวกรอง', function () {
    rollback(function (Tx $q) {
        $f   = lrFixture($q);
        $cat = luCatalog($q);
        lrSync($f['order'], luPair($cat));
        LensRequisition::markUsed($q, $f['case'], null);
        $bytes = LensUsage::workbook(luCase($q, $f['case']), true)->toBytes();
        eq(substr($bytes, 0, 2), 'PK', 'เป็นไฟล์ zip');
        $tmp = tempnam(sys_get_temp_dir(), 'lu');
        file_put_contents($tmp, $bytes);
        $zip = new ZipArchive();
        ok($zip->open($tmp) === true, 'เปิดได้');
        ok(str_contains((string) $zip->getFromName('xl/workbook.xml'), 'Lens Usage - Be Well'), 'ชื่อชีต');
        $all = '';
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $all .= (string) $zip->getFromIndex($i);
        }
        ok(str_contains($all, 'Single Vision 1.56 Blue Cut'), 'มีชื่อเลนส์');
        ok(str_contains($all, 'PENDING'), 'มีสถานะ');
        $zip->close();
        unlink($tmp);
    });
});

test('แก้รายการเลนส์ต้องเป็นแอดมิน · ไม่ล็อกอินตอบ 403', function () {
    eq(lrStatusCode(fn() => Router::dispatch('POST', '/api/lens-catalog', [], [
        'code' => 'X', 'lens_name' => 'X', 'lens_type' => 'X', 'selling_price' => 1,
    ])), 403, 'รหัสตอบ');
});

test('ตรวจค่ารายการเลนส์: รหัส ชื่อ ชนิด และราคาขายต้องมี', function () {
    eq(lrStatusCode(fn() => lensCatalogClean(['code' => 'A', 'lens_name' => 'B', 'lens_type' => 'C'])), 400, 'ไม่มีราคา');
    eq(lrStatusCode(fn() => lensCatalogClean([
        'code' => 'a b', 'lens_name' => 'B', 'lens_type' => 'C', 'selling_price' => 1,
    ])), 400, 'รหัสมีช่องว่าง');
    $v = lensCatalogClean(['code' => 'lens-x', 'lens_name' => 'B', 'lens_type' => 'C', 'selling_price' => '1500', 'cost_price' => '']);
    eq($v['code'], 'LENS-X', 'รหัสเป็นตัวใหญ่');
    eq($v['cost_price'], null, 'ต้นทุนว่างได้');
});

/* ออเดอร์ที่เลือกเลนส์จากรายการไม่มี lens_product_id (ไม่ผูกล็อต) — left_lens/right_lens
   จึงว่างเสมอ เปิดออเดอร์กลับมาแก้แล้วช่องเลือกเลนส์ว่างเปล่าเหมือนยังไม่ได้เลือก
   (ร้านเจอ 26 ก.ย. 2026 เคส 002–004) · ต้องหาเลนส์ในรายการจาก SKU ที่ออเดอร์เก็บไว้ */
test('เปิดออเดอร์: เลนส์ที่เลือกจากรายการกลับมาตาม SKU ของแต่ละข้าง', function () {
    rollback(function (Tx $q) {
        $f    = lrFixture($q);
        $cat  = luCatalog($q);
        $code = $q->get('SELECT code FROM lens_catalog WHERE id = ?', $cat)['code'];
        $q->run('UPDATE custom_orders SET lens_r_sku = ?, lens_l_sku = NULL WHERE id = ?', $code, $f['order']);
        $o = Router::dispatch('GET', '/api/orders/' . $f['order']);
        eq((int) ($o['lens_catalog_r']['id'] ?? 0), $cat, 'ข้างขวาได้เลนส์จากรายการ');
        eq($o['lens_catalog_l'], null, 'ข้างซ้ายไม่มี SKU จึงว่าง');
    });
});

/* ใบที่ส่งรายการเบิกไปแล้ว /sync ปฏิเสธ (lens_req_locked) — หน้าแก้ออเดอร์ต้องรู้ก่อนให้เลือก
   ไม่งั้นชื่อเลนส์ในออเดอร์เปลี่ยนแต่ใบเบิกยังเป็นตัวเดิม · ยืนยันขายแล้วยังเปลี่ยนได้ ไม่ล็อก */
test('เปิดออเดอร์: ใบที่ส่งเบิกแล้วล็อกเลนส์ · ร่างหรือยืนยันขายแล้วไม่ล็อก', function () {
    rollback(function (Tx $q) {
        $f   = lrFixture($q);
        $cat = luCatalog($q);
        $r   = lrSync($f['order'], luPair($cat));
        $o   = Router::dispatch('GET', '/api/orders/' . $f['order']);
        eq($o['lens_locked'], null, 'ร่าง แก้ได้');
        $q->run('UPDATE lens_requisitions SET used_at = NOW() WHERE id = ?', (int) $r['id']);
        $o = Router::dispatch('GET', '/api/orders/' . $f['order']);
        eq($o['lens_locked'], null, 'ยืนยันขายแล้ว ยังแก้ได้');
        $q->run("UPDATE lens_requisitions SET status = 'issued' WHERE id = ?", (int) $r['id']);
        $o = Router::dispatch('GET', '/api/orders/' . $f['order']);
        ok(is_string($o['lens_locked']) && $o['lens_locked'] !== '', 'ส่งเบิกแล้ว ล็อก');
    });
});

/* กด "ล้าง" เลนส์ทั้งสองข้างแล้วบันทึก — หน้าขายส่ง items ว่าง · ใบเดิมต้องถูกยกเลิก (ไม่ลบ)
   ประวัติเลนส์ขึ้นเป็น "ยกเลิก" ไม่ใช่ยังนับว่าใช้เลนส์ที่ไม่ได้อยู่ในออเดอร์แล้ว */
test('ล้างเลนส์ (sync ว่าง): ใบเดิมถูกยกเลิก ยังอยู่ให้ตรวจย้อนหลัง', function () {
    rollback(function (Tx $q) {
        $f   = lrFixture($q);
        $cat = luCatalog($q);
        $r   = lrSync($f['order'], luPair($cat));
        LensRequisition::markUsed($q, $f['case'], null);
        lrSync($f['order'], []);
        $row = $q->get('SELECT status, cancel_reason, used_at FROM lens_requisitions WHERE id = ?', (int) $r['id']);
        eq($row['status'], 'cancelled', 'ใบเดิมยกเลิก');
        ok($row['used_at'] !== null, 'ยังจำว่าเคยขายเมื่อไร');
        ok(str_contains((string) $row['cancel_reason'], 'ล้าง'), 'เหตุผลบอกว่าล้างเลนส์');
    });
});

test('ล้างเลนส์ตอนยังไม่มีใบ: ไม่มีอะไรเกิดขึ้น ไม่ error', function () {
    rollback(function (Tx $q) {
        $f = lrFixture($q);
        lrSync($f['order'], []);
        $n = $q->get('SELECT COUNT(*) n FROM lens_requisitions WHERE order_id = ?', $f['order']);
        eq((int) $n['n'], 0, 'ไม่ออกใบว่าง');
    });
});

/* ยืนยันขายไปแล้ว ล้างเลนส์ แล้วเลือกใหม่ — ใบใหม่ต้องนับเป็นใช้เลนส์ทันที เพราะจะไม่มีการ
   ยืนยันขั้นขายรอบใหม่มาเรียก markUsed ให้อีก */
test('ยืนยันขายแล้ว ล้างแล้วเลือกใหม่: ใบใหม่นับเป็นใช้เลนส์ทันที', function () {
    rollback(function (Tx $q) {
        $f   = lrFixture($q);
        $cat = luCatalog($q);
        $q->run("INSERT INTO case_processes (case_id, process, status, completed_at) VALUES (?, 'sales', 'completed', NOW())", $f['case']);
        lrSync($f['order'], luPair($cat));
        LensRequisition::markUsed($q, $f['case'], null);
        lrSync($f['order'], []);
        $r = lrSync($f['order'], luPair($cat, 1800));
        $row = $q->get('SELECT used_at FROM lens_requisitions WHERE id = ?', (int) $r['id']);
        ok($row['used_at'] !== null, 'ใบใหม่มีวันที่ใช้เลนส์');
    });
});

test('บันทึกซ้ำโดยเลนส์เดิม: ไม่ลงไทม์ไลน์ว่าเปลี่ยนเลนส์', function () {
    rollback(function (Tx $q) {
        $f   = lrFixture($q);
        $cat = luCatalog($q);
        lrSync($f['order'], luPair($cat));
        LensRequisition::markUsed($q, $f['case'], null);
        lrSync($f['order'], luPair($cat));
        $n = $q->get("SELECT COUNT(*) n FROM case_events WHERE case_id = ? AND action = 'lens_usage_changed'", $f['case']);
        eq((int) $n['n'], 0, 'ไม่มีการเปลี่ยน');
    });
});
