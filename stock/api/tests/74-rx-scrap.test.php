<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Roles;
use Optic\Service\Rx;

/**
 * เลนส์สั่งตัด RX เจียร์เสีย และการเปิดใบใหม่แทน — ร้านขอไว้ 30 ก.ย. 2026
 *
 * เจียร์เสีย = ปิดใบเดิม (ไม่นับเป็นงานที่เดินอยู่อีก) + แถว SCRAP ในสมุดพร้อมชื่อคนทำเสีย
 * และต้นทุนของเลนส์ · เปิดใบใหม่แทนเป็นทางเลือกของคนกด ทำพร้อมกันหรือทำทีหลังก็ได้ ·
 * ใบใหม่รับช่องเลนส์ของเคสหน้าร้านต่อจากใบเดิม
 *
 * ของทดสอบสร้างเองในทรานแซกชันที่ roll back · ใช้ตัวช่วยของ 73- (`arrivalCase`,
 * `arrivalLensSku`, `arrivalRow`) จึงรันคู่กัน: `run.php rx-`
 */

group('ใบสั่งตัด RX · เจียร์เสีย และเปิดใบใหม่แทน');

/** แถว SCRAP ของใบสั่งตัดใบนี้ · null ถ้าไม่มี */
function scrapRowOf(int $rxId): ?array
{
    return Db::one(
        'SELECT g.* FROM rx_orders r JOIN inventory_logs g ON g.id = r.scrap_log_id WHERE r.log_id = ?',
        [$rxId],
    );
}

test('เจียร์เสีย: ใบเดิมปิด · แถว SCRAP ไม่ผูกล็อต มีชื่อคนทำและต้นทุนของเลนส์ · ใบยังอยู่ในสมุด', function () {
    withRollback(function () {
        $c = arrivalCase();
        Rx::setCost($c['right'], '850', [Roles::OWNER], 1);

        $out = Rx::scrap($c['right'], ['scrap_by' => ' น้องฝึกงาน ', 'note' => 'เจียร์เกินขนาด'], [Roles::OWNER], 1);
        eq($out['replacement'], null, 'ไม่ได้เลือกเปิดใบใหม่');
        ok(is_string($out['order']['scrappedAt']), 'ใบบอกเวลาที่เสีย');
        eq([$out['order']['scrapBy'], $out['order']['scrapNote']], ['น้องฝึกงาน', 'เจียร์เกินขนาด'], 'คนทำเสียและเหตุผล');

        $s = scrapRowOf($c['right']);
        ok($s !== null, 'ต้องมีแถว SCRAP');
        eq(
            [$s['action_type'], (int) $s['quantity'], $s['lot_id'], (float) $s['unit_cost'], $s['scrap_by'], $s['reference_doc']],
            ['SCRAP', -1, null, 850.0, 'น้องฝึกงาน', "RXA-R-{$c['tag']}"],
            'แถว SCRAP',
        );

        $r = arrivalRow($c['right'], "RXA-R-{$c['tag']}");
        ok($r !== null && $r['scrappedAt'] !== null, 'ใบที่เสียยังอยู่ในสมุดใบสั่ง');
        ok(arrivalRow($c['right'], "RXA-R-{$c['tag']}", ['lens' => 'scrapped']) !== null, 'อยู่ในตัวกรองเจียร์เสีย');
        eq(arrivalRow($c['right'], "RXA-R-{$c['tag']}", ['lens' => 'waiting']), null, 'ไม่อยู่ในรอเลนส์');

        throwsReason('already_cancelled', fn() => Rx::scrap($c['right'], ['scrap_by' => 'ก', 'note' => 'ข'], [Roles::OWNER], 1), 'เสียซ้ำไม่ได้');
        throwsReason('already_cancelled', fn() => Rx::setArrived($c['right'], true, [Roles::OWNER], 1), 'ติ๊กมาถึงไม่ได้');
    });
});

test('ต้องกรอกชื่อคนทำเสีย · พนักงานขายล้วนกดไม่ได้', function () {
    withRollback(function () {
        $c = arrivalCase();
        throwsReason('missing_scrap_by', fn() => Rx::scrap($c['right'], ['scrap_by' => '  ', 'note' => 'ข'], [Roles::OWNER], 1), 'ชื่อว่าง');
        throwsReason('bad_scrap_by', fn() => Rx::scrap($c['right'], ['scrap_by' => str_repeat('ก', 121), 'note' => 'ข'], [Roles::OWNER], 1), 'ชื่อยาวเกิน');
        throwsReason('forbidden', fn() => Rx::scrap($c['right'], ['scrap_by' => 'ก', 'note' => 'ข'], [Roles::SALES], 1), 'พนักงานขายล้วน');
        eq(scrapRowOf($c['right']), null, 'ยังไม่มีอะไรถูกบันทึก');
    });
});

test('ใบที่เสียก่อนลงต้นทุน: ยังค้างต้นทุน · ลงทีหลังแล้วแถว SCRAP ได้ต้นทุนตาม', function () {
    withRollback(function () {
        $c = arrivalCase();
        Rx::scrap($c['right'], ['scrap_by' => 'ช่างเอ', 'note' => 'เลนส์แตก'], [Roles::OWNER], 1);
        eq(scrapRowOf($c['right'])['unit_cost'], null, 'ยังไม่มีต้นทุน');
        ok(in_array($c['right'], array_column(Rx::awaitingCost(), 'id'), true), 'ยังอยู่ในคิวรอลงต้นทุน');

        Rx::setCost($c['right'], '1200', [Roles::OWNER], 1);
        eq((float) scrapRowOf($c['right'])['unit_cost'], 1200.0, 'แถว SCRAP ได้ต้นทุนตาม');
        ok(!in_array($c['right'], array_column(Rx::awaitingCost(), 'id'), true), 'ออกจากคิวแล้ว');
    });
});

test('เจียร์เสียพร้อมเปิดใบใหม่: คัดลอกค่าสายตาและราคาขาย · ช่องเลนส์ของเคสย้ายไปใบใหม่ · ข้อความแจ้ง', function () {
    withRollback(function () {
        $c = arrivalCase();
        Rx::edit($c['right'], ['sph' => '-2.25', 'cyl' => '-0.50', 'axis' => '90', 'sale_price' => '3500'], [Roles::OWNER], 1);
        Rx::setArrived($c['right'], true, [Roles::STOCK], 1, 'LAB-1');

        $out = Rx::scrap(
            $c['right'],
            ['scrap_by' => 'ช่างเอ', 'note' => 'เลนส์หลวม', 'reorder' => true, 'reorder_note' => 'เคลมจากซัพพลาย'],
            [Roles::OWNER],
            1,
        );
        $new = $out['replacement'];
        ok($new !== null && $new['id'] !== $c['right'], 'ได้ใบใหม่');
        eq($out['order']['replacedBy'], $new, 'ใบเดิมชี้ใบใหม่');

        $n = arrivalRow($new['id'], $new['referenceDoc']);
        ok($n !== null, 'ใบใหม่อยู่ในสมุด');
        eq(
            [$n['sph'], $n['cyl'], $n['axis'], $n['salePrice'], $n['awaitingCost'], $n['arrivedAt'], $n['scrappedAt']],
            [-2.25, -0.5, 90, 3500.0, true, null, null],
            'ใบใหม่: ค่าเดิม ยังไม่มา ยังไม่มีต้นทุน',
        );
        eq($n['replaces']['id'] ?? null, $c['right'], 'ใบใหม่บอกว่าแทนใบไหน');

        // ใบที่เสียไม่หายไปไหน: ยังค้นด้วยเลขเคสเจอ ยังบอกเคสและข้างตา และยังอยู่ในตัวกรองเลนส์มาถึงแล้ว
        $old = arrivalRow($c['right'], $c['code']);
        ok($old !== null, 'ค้นด้วยเลขเคสต้องเจอใบที่เสีย');
        eq([$old['caseId'], $old['eyeSide'], $old['scrappedAt'] !== null], [$c['case'], 'right', true], 'ใบที่เสียยังบอกเคสและข้างตา');
        ok(arrivalRow($c['right'], $c['code'], ['lens' => 'arrived']) !== null, 'ใบที่เสียยังอยู่ในเลนส์มาถึงแล้ว');
        ok(str_contains((string) $n['note'], "RXA-R-{$c['tag']}") && str_contains((string) $n['note'], 'เคลมจากซัพพลาย'), 'หมายเหตุใบใหม่ — ได้ ' . render($n['note']));
        eq([$n['caseId'], $n['eyeSide']], [$c['case'], 'right'], 'ใบใหม่รับช่องขวาของเคส');

        $o = Db::one('SELECT lens_r_rx_id, lens_r_rx_doc, lens_l_rx_id FROM custom_orders WHERE case_id = ?', [$c['case']]);
        eq([(int) $o['lens_r_rx_id'], $o['lens_r_rx_doc'], (int) $o['lens_l_rx_id']], [$new['id'], $new['referenceDoc'], $c['left']], 'ออเดอร์หน้าร้าน');

        ok(is_string($out['notice']) && str_contains($out['notice'], $c['code']) && str_contains($out['notice'], $new['referenceDoc']), 'ข้อความมีเลขเคสและเลขใบใหม่ — ได้ ' . render($out['notice']));

        // เลนส์ของเคสยังมาไม่ครบ — ข้างขวาคือใบใหม่ที่ยังไม่มา
        eq(Rx::setArrived($c['left'], true, [Roles::STOCK], 1)['notice'], null, 'ข้างซ้ายมา ยังไม่ครบ');
        ok(is_string(Rx::setArrived($new['id'], true, [Roles::STOCK], 1)['notice']), 'ใบใหม่มา ครบแล้ว');
    });
});

test('เปิดใบใหม่ทีหลัง: ได้ครั้งเดียว · เฉพาะใบที่เสีย', function () {
    withRollback(function () {
        $c = arrivalCase();
        throwsReason('not_scrapped', fn() => Rx::reorder($c['right'], [], [Roles::OWNER], 1), 'ใบที่ยังไม่เสีย');

        $out = Rx::scrap($c['right'], ['scrap_by' => 'ช่างเอ', 'note' => 'เลนส์แตก'], [Roles::OWNER], 1);
        ok(is_string($out['notice']) && str_contains($out['notice'], 'ยังไม่ได้สั่งเลนส์ใหม่'), 'ข้อความบอกว่ายังไม่ได้สั่งใหม่');
        $o = Db::one('SELECT lens_r_rx_id FROM custom_orders WHERE case_id = ?', [$c['case']]);
        eq((int) $o['lens_r_rx_id'], $c['right'], 'ยังไม่สั่งใหม่ ช่องของเคสยังชี้ใบที่เสีย');

        $new = Rx::reorder($c['right'], ['note' => 'เคลมจากซัพพลาย'], [Roles::OWNER], 1)['replacement'];
        $o = Db::one('SELECT lens_r_rx_id FROM custom_orders WHERE case_id = ?', [$c['case']]);
        eq((int) $o['lens_r_rx_id'], $new['id'], 'สั่งใหม่แล้ว ช่องย้าย');

        throwsReason('already_replaced', fn() => Rx::reorder($c['right'], [], [Roles::OWNER], 1), 'สั่งแทนซ้ำไม่ได้');

        // ใบแทนที่ยังไม่มีตัวเลขเงินถูกลบ — ช่องของเคสกลับไปชี้ใบที่เสีย และสั่งแทนได้อีก
        eq(Rx::remove($new['id'], [], [Roles::OWNER], 1)['mode'], 'deleted', 'ลบใบแทน');
        $o = Db::one('SELECT lens_r_rx_id FROM custom_orders WHERE case_id = ?', [$c['case']]);
        eq((int) $o['lens_r_rx_id'], $c['right'], 'ช่องกลับไปชี้ใบที่เสีย');
        ok(Rx::reorder($c['right'], [], [Roles::OWNER], 1)['replacement']['id'] > 0, 'สั่งแทนได้อีก');
    });
});

test('ใบที่ไม่ได้ผูกเคส เจียร์เสียได้ ไม่มีข้อความแจ้ง', function () {
    withRollback(function () {
        $tag = strtoupper(bin2hex(random_bytes(3)));
        $id = (int) Rx::order(['sku' => arrivalLensSku(), 'reference_doc' => "RXA-Z-$tag"], [Roles::OWNER], 1)['id'];
        $out = Rx::scrap($id, ['scrap_by' => 'ช่างเอ', 'note' => 'เลนส์หลวม', 'reorder' => true], [Roles::OWNER], 1);
        eq($out['notice'], null, 'ไม่มีเคสให้แจ้ง');
        ok($out['replacement'] !== null, 'เปิดใบใหม่ได้');
    });
});
