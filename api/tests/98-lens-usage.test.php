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

test('ขายแล้ว sync เปลี่ยนเลนส์ไม่ได้ (409) · เปิดขั้นขายกลับมา ใบกลับเป็นร่างแล้วแก้ได้', function () {
    rollback(function (Tx $q) {
        $f   = lrFixture($q);
        $cat = luCatalog($q);
        lrSync($f['order'], luPair($cat));
        LensRequisition::markUsed($q, $f['case'], null);
        eq(lrStatusCode(fn() => lrSync($f['order'], luPair($cat, 2000))), 409, 'หลังขาย');
        eq(LensRequisition::unmarkUsed($q, $f['case'], null), 1, 'ถอน 1 ใบ');
        eq(LensUsage::count(luCase($q, $f['case'])), 0, 'หายจากรายการใช้เลนส์');
        eq((float) lrSync($f['order'], luPair($cat, 2000))['total'], 2000.0, 'แก้ได้อีกครั้ง');
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
