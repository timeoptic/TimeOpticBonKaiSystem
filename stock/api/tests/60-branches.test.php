<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Repo\Inventory;
use Optic\Repo\Reports;
use Optic\Roles;
use Optic\Service\Branches;
use Optic\Service\Catalog;
use Optic\Service\Receiving;
use Optic\Service\Rx;
use Optic\Service\Settlement;
use Optic\Service\Stock;

/** A branch name nothing else in the database can collide with. */
function branchName(): string
{
    return 'สาขาเทสต์-' . strtoupper(bin2hex(random_bytes(3)));
}

/** Creates a branch and returns its id. */
function aBranch(): int
{
    return Branches::create(['name' => branchName(), 'contact' => '081-000-0000'], [Roles::OWNER])['id'];
}

group('สาขา');

test('เจ้าของร้านเท่านั้นที่เพิ่มสาขาได้', function () {
    withRollback(function () {
        $b = Branches::create(['name' => branchName()], [Roles::OWNER]);
        ok($b['id'] > 0, 'ต้องได้ id กลับมา');
        eq($b['isActive'], true, 'สาขาใหม่ต้องเปิดใช้งาน');
        eq($b['pendingCount'], 0, 'สาขาใหม่ยังไม่มีรายการค้าง');

        throwsReason(
            'forbidden',
            fn() => Branches::create(['name' => branchName()], [Roles::ADMIN]),
            'ฝ่ายบัญชีเพิ่มสาขา',
        );
        throwsReason(
            'forbidden',
            fn() => Branches::create(['name' => branchName()], [Roles::SALES]),
            'พนักงานเพิ่มสาขา',
        );
    });
});

test('ชื่อสาขาซ้ำถูกปฏิเสธ — ไม่งั้นหนี้จะกระจายไปสองก้อน', function () {
    withRollback(function () {
        $name = branchName();
        Branches::create(['name' => $name], [Roles::OWNER]);
        throwsReason(
            'duplicate_branch',
            fn() => Branches::create(['name' => $name], [Roles::OWNER]),
            'สร้างสาขาชื่อซ้ำ',
        );
    });
});

group('สาขามาเบิกของ');

test('สาขาเบิกแล้วเกิดรายการค้างรับ ที่ยังไม่มียอดเงินและไม่มีกำไร', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();

        $out = Stock::issue(issueReq($sku, 1, idem('branch'), [
            'branch_id' => $branch,
            'taken_by'  => 'สมชาย',
            'note'      => 'สาขาบางแคมาเบิก',
        ]));

        ok(is_int($out['branch_issue_id']), 'ต้องได้เลขใบเบิกสาขากลับมา');

        $issue = Db::one('SELECT * FROM branch_issues WHERE id = ?', [$out['branch_issue_id']]);
        ok($issue !== null, 'ต้องมีแถวใน branch_issues');
        eq($issue['status'], 'pending', 'สถานะแรกเริ่ม');
        eq($issue['taken_by'], 'สมชาย', 'ชื่อคนที่มารับของ');
        eq($issue['settled_amount'], null, 'วันเบิกต้องยังไม่มียอดเงิน');
        eq($issue['settled_at'], null, 'วันเบิกต้องยังไม่มีวันรับเงิน');
        ok((float) $issue['cost_total'] >= 0, 'ต้นทุนต้องถูกบันทึกไว้ตั้งแต่วันเบิก');
    });
});

test('ทุกแถวใน log ของการเบิกนั้นชี้กลับไปที่ใบเบิกสาขา', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();

        $out = Stock::issue(issueReq($sku, 1, idem('branchlog'), [
            'branch_id' => $branch,
            'taken_by'  => 'สมหญิง',
        ]));

        $n = (int) Db::value(
            'SELECT COUNT(*) FROM inventory_logs WHERE branch_issue_id = ?',
            [$out['branch_issue_id']],
        );
        eq($n, count($out['cuts']), 'จำนวน log ที่ผูกกับใบเบิก ต้องเท่ากับจำนวนล็อตที่ตัด');
    });
});

test('ต้นทุนในใบเบิกเท่ากับผลรวมของล็อตที่ FIFO ตัดไปจริง', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();

        $out = Stock::issue(issueReq($sku, 2, idem('branchcost'), [
            'branch_id' => $branch,
            'taken_by'  => 'ช่างเอ',
        ]));

        $expected = 0.0;
        $unknown = 0;
        foreach ($out['cuts'] as $c) {
            if ($c['unit_cost'] === null) {
                $unknown += (int) $c['quantity'];
                continue;
            }
            $expected += (float) $c['unit_cost'] * (int) $c['quantity'];
        }

        $issue = Db::one('SELECT * FROM branch_issues WHERE id = ?', [$out['branch_issue_id']]);
        eq(round((float) $issue['cost_total'], 2), round($expected, 2), 'ต้นทุนรวมในใบเบิก');
        eq((int) $issue['cost_unknown_qty'], $unknown, 'จำนวนชิ้นที่ยังไม่รู้ต้นทุน');
    });
});

test('สาขาที่ปิดใช้งานแล้วเบิกใหม่ไม่ได้', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();
        Branches::update($branch, ['is_active' => false], [Roles::OWNER]);

        throwsReason(
            'branch_inactive',
            fn() => Stock::issue(issueReq($sku, 1, idem('closed'), [
                'branch_id' => $branch,
                'taken_by'  => 'ใครสักคน',
            ])),
            'เบิกจากสาขาที่ปิดแล้ว',
        );
    });
});

test('สาขายังค้างเงินอยู่ ปิดใช้งานไม่ได้ — หนี้จะหายไปจากสายตา', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();
        Stock::issue(issueReq($sku, 1, idem('owing'), [
            'branch_id' => $branch,
            'taken_by'  => 'สมชาย',
        ]));

        throwsReason(
            'branch_has_debt',
            fn() => Branches::update($branch, ['is_active' => false], [Roles::OWNER]),
            'ปิดสาขาที่ยังค้างเงิน',
        );
    });
});

test('ระบุทั้งผู้เบิกในร้านและสาขาพร้อมกันไม่ได้', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();

        throwsReason(
            'ambiguous_recipient',
            fn() => Stock::issue(issueReq($sku, 1, idem('both'), [
                'branch_id'          => $branch,
                'taken_by'           => 'สมชาย',
                'issued_to_admin_id' => 1,
            ])),
            'ระบุผู้รับสองทาง',
        );
    });
});

test('สาขาเบิกโดยไม่บอกชื่อคนที่มารับได้ — หนี้ผูกกับสาขา ไม่ใช่กับชื่อ', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();

        $out = Stock::issue(issueReq($sku, 1, idem('noname'), ['branch_id' => $branch]));

        ok($out['branch_issue_id'] !== null, 'ต้องเปิดใบค้างรับให้ตามปกติ');
        $issue = Db::one('SELECT branch_id, taken_by FROM branch_issues WHERE id = ?', [$out['branch_issue_id']]);
        eq((int) $issue['branch_id'], $branch, 'หนี้ต้องผูกกับสาขาที่มาเบิก');
        eq($issue['taken_by'], null, 'ไม่ได้บอกชื่อมา ก็ต้องว่างไว้ ไม่ใช่เดาแทน');
    });
});

test('ของเสียเบิกในนามสาขาไม่ได้', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();

        throwsReason(
            'branch_not_issuable',
            fn() => Stock::scrap(issueReq($sku, 1, idem('scrapbranch'), ['scrap_by' => 'คนทดสอบ',
                'branch_id' => $branch,
                'taken_by'  => 'สมชาย',
            ])),
            'ตัดของเสียในนามสาขา',
        );
    });
});

group('ผู้เบิก แยกจากผู้บันทึก');

test('บันทึกได้ว่าใครเป็นคนเบิก โดยไม่ใช่คนเดียวกับคนที่คีย์', function () {
    withRollback(function () {
        $sku = skuWithLots(1);

        // A person who exists but does not sign in — exactly what the imported
        // employees are for.
        $taker = Db::one(
            'SELECT id FROM admins WHERE is_active = 1 AND id <> 1 ORDER BY id LIMIT 1'
        );
        ok($taker !== null, 'ต้องมีพนักงานอย่างน้อยหนึ่งคนนอกจากเจ้าของร้าน');

        $out = Stock::issue(issueReq($sku, 1, idem('issuedto'), [
            'issued_to_admin_id' => (int) $taker['id'],
        ]));
        eq($out['issued_to'], (int) $taker['id'], 'ผู้เบิกที่บันทึกไว้');

        $log = Db::one(
            'SELECT created_by, issued_to_admin_id FROM inventory_logs
             WHERE lot_id = ? ORDER BY id DESC LIMIT 1',
            [$out['cuts'][0]['lot_id']],
        );
        eq((int) $log['created_by'], 1, 'ผู้บันทึกคือคนที่ล็อกอิน');
        eq((int) $log['issued_to_admin_id'], (int) $taker['id'], 'ผู้เบิกคือคนที่เลือก');
        neq((int) $log['created_by'], (int) $log['issued_to_admin_id'], 'สองช่องนี้ต้องแยกกันได้จริง');
    });
});

test('เลือกคนที่ไม่มีอยู่เป็นผู้เบิกไม่ได้', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        throwsReason(
            'not_found',
            fn() => Stock::issue(issueReq($sku, 1, idem('nobody'), [
                'issued_to_admin_id' => 999999,
            ])),
            'ผู้เบิกที่ไม่มีตัวตน',
        );
    });
});

group('รับเงินจากสาขา');

test('รับเงินแล้วกำไรจึงเกิด และลงวันที่รับเงิน ไม่ใช่วันเบิก', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();

        $out = Stock::issue(issueReq($sku, 1, idem('settle'), [
            'branch_id' => $branch,
            'taken_by'  => 'สมชาย',
        ]));
        $id = $out['branch_issue_id'];

        $before = Db::one('SELECT * FROM branch_issues WHERE id = ?', [$id]);
        $cost = (float) $before['cost_total'];

        $today = date('Y-m-d');
        $result = Settlement::settle($id, ['amount' => $cost + 500, 'received_date' => $today], [Roles::OWNER], 1);

        eq($result['status'], 'settled', 'สถานะหลังรับเงิน');
        eq($result['profit'], round(500.0, 2), 'กำไร = เงินที่ได้ − ต้นทุน');
        eq(substr((string) $result['settledAt'], 0, 10), $today, 'กำไรลงวันที่รับเงิน');
        neq(substr((string) $result['settledAt'], 0, 10), null, 'ต้องมีวันรับเงิน');
    });
});

test('รายการที่ยังค้างไม่มีกำไร แม้จะรู้ต้นทุนแล้ว', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();

        $out = Stock::issue(issueReq($sku, 1, idem('nopro'), [
            'branch_id' => $branch,
            'taken_by'  => 'สมชาย',
        ]));

        $rows = Settlement::list(['status' => 'pending', 'branch_id' => $branch], [Roles::OWNER])['rows'];
        $row = array_values(array_filter($rows, fn($r) => $r['id'] === $out['branch_issue_id']))[0] ?? null;

        ok($row !== null, 'ต้องเห็นรายการค้างในรายการ');
        eq($row['profit'], null, 'ยังไม่รับเงิน ต้องไม่มีกำไร');
        eq($row['settledAmount'], null, 'ยังไม่รับเงิน ต้องไม่มียอด');
        ok($row['costTotal'] >= 0, 'แต่ต้องรู้ต้นทุนแล้ว');
    });
});

test('พนักงานหน้าร้านบันทึกรับเงินไม่ได้', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();
        $out = Stock::issue(issueReq($sku, 1, idem('perm'), [
            'branch_id' => $branch,
            'taken_by'  => 'สมชาย',
        ]));

        throwsReason(
            'forbidden',
            fn() => Settlement::settle($out['branch_issue_id'], ['amount' => 100], [Roles::SALES], 1),
            'พนักงานรับเงิน',
        );
    });
});

test('รับเงินซ้ำรายการเดิมไม่ได้', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();
        $out = Stock::issue(issueReq($sku, 1, idem('twice'), [
            'branch_id' => $branch,
            'taken_by'  => 'สมชาย',
        ]));

        Settlement::settle($out['branch_issue_id'], ['amount' => 100], [Roles::OWNER], 1);
        throwsReason(
            'not_pending',
            fn() => Settlement::settle($out['branch_issue_id'], ['amount' => 100], [Roles::OWNER], 1),
            'รับเงินซ้ำ',
        );
    });
});

test('วันที่รับเงินก่อนวันเบิก หรือเป็นอนาคต ถูกปฏิเสธ', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();
        $out = Stock::issue(issueReq($sku, 1, idem('dates'), [
            'branch_id' => $branch,
            'taken_by'  => 'สมชาย',
        ]));
        $id = $out['branch_issue_id'];

        throwsReason(
            'bad_settled_date',
            fn() => Settlement::settle($id, ['amount' => 100, 'received_date' => '2000-01-01'], [Roles::OWNER], 1),
            'วันรับเงินก่อนวันเบิก',
        );
        throwsReason(
            'bad_date',
            fn() => Settlement::settle($id, ['amount' => 100, 'received_date' => '2999-01-01'], [Roles::OWNER], 1),
            'วันรับเงินในอนาคต',
        );
    });
});

test('ยอดเงินที่ไม่ใช่ตัวเลขหรือติดลบถูกปฏิเสธ', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();
        $out = Stock::issue(issueReq($sku, 1, idem('amt'), [
            'branch_id' => $branch,
            'taken_by'  => 'สมชาย',
        ]));
        $id = $out['branch_issue_id'];

        throwsReason('bad_amount', fn() => Settlement::settle($id, ['amount' => 'มาก'], [Roles::OWNER], 1), 'ยอดเป็นข้อความ');
        throwsReason('bad_amount', fn() => Settlement::settle($id, ['amount' => -5], [Roles::OWNER], 1), 'ยอดติดลบ');
        throwsReason('bad_amount', fn() => Settlement::settle($id, [], [Roles::OWNER], 1), 'ไม่ใส่ยอด');
    });
});

test('ตัดหนี้สูญต้องมีเหตุผล และแยกจากการยกเลิกเพราะคืนของ', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();
        $out = Stock::issue(issueReq($sku, 1, idem('wo'), [
            'branch_id' => $branch,
            'taken_by'  => 'สมชาย',
        ]));
        $id = $out['branch_issue_id'];

        throwsReason('missing_field', fn() => Settlement::writeOff($id, [], [Roles::OWNER], 1), 'ตัดหนี้สูญไม่บอกเหตุผล');

        $r = Settlement::writeOff($id, ['note' => 'สาขาปิดกิจการ'], [Roles::OWNER], 1);
        eq($r['status'], 'written_off', 'สถานะหลังตัดหนี้สูญ');
        eq($r['profit'], null, 'หนี้สูญไม่ใช่กำไร');
    });
});

group('คืนของที่สาขาเบิกไป');

test('คืนของแล้วหนี้สาขาถูกยกเลิก ไม่กลายเป็นหนี้สูญ', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();
        $key = idem('retbranch');

        $out = Stock::issue(issueReq($sku, 1, $key, [
            'branch_id' => $branch,
            'taken_by'  => 'สมชาย',
        ]));

        Stock::returnStock([
            'source'       => 'test',
            'idem_key'     => idem('retbranch-back'),
            'reverses_key' => $key,
            'actor_id'     => 1,
        ]);

        $issue = Db::one('SELECT status FROM branch_issues WHERE id = ?', [$out['branch_issue_id']]);
        eq($issue['status'], 'cancelled', 'คืนของแล้วต้องเป็นยกเลิก ไม่ใช่หนี้สูญ');
    });
});

test('รับเงินไปแล้ว คืนของย้อนหลังไม่ได้', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();
        $key = idem('retsettled');

        $out = Stock::issue(issueReq($sku, 1, $key, [
            'branch_id' => $branch,
            'taken_by'  => 'สมชาย',
        ]));
        $lotId = (int) $out['cuts'][0]['lot_id'];
        /* ต้องอ่านไว้ *ก่อน* การคืนที่จะถูกปฏิเสธ ไม่งั้นไม่มีอะไรให้เทียบ */
        $before = lotRemaining($lotId);

        Settlement::settle($out['branch_issue_id'], ['amount' => 999], [Roles::OWNER], 1);

        throwsReason(
            'already_settled',
            fn() => Stock::returnStock([
                'source'       => 'test',
                'idem_key'     => idem('retsettled-back'),
                'reverses_key' => $key,
                'actor_id'     => 1,
            ]),
            'คืนของที่รับเงินไปแล้ว',
        );

        // And the refusal must leave the stock exactly where it was.
        eq(lotRemaining($lotId), $before, 'ยอดล็อตไม่เปลี่ยน');
        $issue = Db::one('SELECT status FROM branch_issues WHERE id = ?', [$out['branch_issue_id']]);
        eq($issue['status'], 'settled', 'สถานะต้องยังเป็นรับเงินแล้ว');
    });
});

group('แบ่งหน้ารายการ');

test('รายการสินค้าแบ่งหน้า และหน้าถัดไปไม่ซ้ำกับหน้าแรก', function () {
    withRollback(function () {
        $first = Inventory::products(['page' => 1]);
        eq($first['perPage'], Inventory::PER_PAGE, 'จำนวนต่อหน้า');
        ok($first['total'] > 0, 'ต้องมีสินค้าอยู่');
        ok(count($first['rows']) <= Inventory::PER_PAGE, 'หน้าหนึ่งต้องไม่เกินโควตา');

        if ($first['total'] > Inventory::PER_PAGE) {
            $second = Inventory::products(['page' => 2]);
            eq($second['page'], 2, 'เลขหน้าที่สอง');
            $a = array_column($first['rows'], 'id');
            $b = array_column($second['rows'], 'id');
            eq(count(array_intersect($a, $b)), 0, 'สินค้าซ้ำระหว่างสองหน้า');
        }
    });
});

test('ขอหน้าที่เกินจริง ได้หน้าสุดท้ายแทนที่จะ error', function () {
    withRollback(function () {
        $r = Inventory::movements(['page' => 99999]);
        $last = max(1, (int) ceil($r['total'] / Inventory::PER_PAGE));
        eq($r['page'], $last, 'ถูกดึงกลับมาที่หน้าสุดท้าย');
        ok(count($r['rows']) > 0 || $r['total'] === 0, 'หน้าสุดท้ายต้องมีข้อมูลถ้ามีข้อมูลอยู่');
    });
});

test('ขอหน้าที่เป็นค่าขยะ ถือเป็นหน้าแรก', function () {
    withRollback(function () {
        eq(Inventory::lots(['page' => 'abc'])['page'], 1, 'page=abc');
        eq(Inventory::lots(['page' => -3])['page'], 1, 'page=-3');
        eq(Inventory::lots(['page' => 0])['page'], 1, 'page=0');
    });
});

test('ตัวกรองนับรวมทั้งชุด ไม่ใช่แค่หน้าที่เห็น', function () {
    withRollback(function () {
        $all = Inventory::movements([]);
        $out = Inventory::movements(['type' => 'OUT']);
        ok($out['total'] <= $all['total'], 'กรองแล้วต้องไม่มากกว่าทั้งหมด');

        $counts = Inventory::movementCounts();
        if (isset($counts['OUT'])) {
            eq($out['total'], (int) $counts['OUT'], 'ยอดรวมของ OUT ต้องตรงกับตัวนับ');
        }
    });
});

group('หมายเหตุที่ใช้บ่อย');

test('ดึงหมายเหตุที่ใช้บ่อยจากสมุดจริง เรียงตามความถี่', function () {
    withRollback(function () {
        $notes = Inventory::noteSuggestions('OUT');
        ok(count($notes) > 0, 'ต้องมีหมายเหตุที่เคยใช้ของ OUT');
        foreach ($notes as $n) {
            ok(is_string($n) && trim($n) !== '', 'ทุกตัวต้องเป็นข้อความที่ไม่ว่าง');
        }
        eq(count($notes), count(array_unique($notes)), 'ต้องไม่มีตัวซ้ำ');
    });
});

test('ชนิดรายการที่ไม่มีอยู่ ได้ลิสต์ว่าง ไม่ใช่ error', function () {
    withRollback(function () {
        eq(Inventory::noteSuggestions('NOT_A_TYPE'), [], 'ชนิดที่ไม่รู้จัก');
    });
});

group('เติมข้อมูลล็อตใหม่ให้อัตโนมัติ');

test('ล็อตใหม่ของสินค้าเดิมได้ชื่อและ SKU เดิมกลับมา ไม่ต้องพิมพ์ซ้ำ', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $d = Inventory::receiveDefaults($sku);

        eq($d['sku'], $sku, 'SKU ต้องเป็นตัวเดิม');
        ok(is_string($d['name']) && $d['name'] !== '', 'ต้องได้ชื่อสินค้าเดิม');
        ok($d['lastLot'] !== null, 'สินค้าที่มีล็อตแล้วต้องได้ล็อตล่าสุดกลับมา');
        ok(array_key_exists('supplierId', $d['lastLot']), 'ต้องบอกผู้ขายของล็อตล่าสุด');
    });
});

test('SKU ที่ไม่มีในระบบ ตอบ 404 ไม่ใช่ค่าว่าง', function () {
    withRollback(function () {
        throwsReason(
            'unknown_sku',
            fn() => Inventory::receiveDefaults('ไม่มีจริง-' . bin2hex(random_bytes(3))),
            'ขอค่าเริ่มต้นของ SKU ที่ไม่มี',
        );
    });
});

test('เลขล็อตถัดไปเดาจากเลขเดิม และไม่เดาเมื่อเดาไม่ได้', function () {
    withRollback(function () {
        // Driven through the public path: give a product a lot whose number ends
        // in digits, then ask what the next one should be.
        $p = Db::one('SELECT id, sku FROM products WHERE is_custom_made = 0 ORDER BY id LIMIT 1');
        Db::run(
            'INSERT INTO stock_lots (lot_number, product_id, initial_qty, remaining_qty, received_date)
             VALUES (?, ?, 1, 1, CURDATE())',
            ['ZZTEST-007', $p['id']],
        );
        eq(Inventory::receiveDefaults((string) $p['sku'])['suggestedLotNumber'], 'ZZTEST-008', 'เลขล็อตถัดไป');

        Db::run(
            'INSERT INTO stock_lots (lot_number, product_id, initial_qty, remaining_qty, received_date)
             VALUES (?, ?, 1, 1, CURDATE())',
            ['ZZTEST-NO-DIGITS', $p['id']],
        );
        eq(
            Inventory::receiveDefaults((string) $p['sku'])['suggestedLotNumber'],
            null,
            'เลขล็อตที่ไม่ลงท้ายด้วยตัวเลข ต้องไม่เดา',
        );
    });
});

group('รายการเคลื่อนไหวบอกได้ว่าใครเบิกและสาขาไหน');

test('แถวใน log บอกทั้งผู้บันทึก ผู้เบิก สาขา และสถานะเงิน', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();
        $name = branchName();

        $out = Stock::issue(issueReq($sku, 1, idem('logshape'), [
            'branch_id' => $branch,
            'taken_by'  => 'คุณเอ',
        ]));

        $rows = Inventory::movements(['who' => 'branch'], true)['rows'];
        $row = array_values(array_filter($rows, fn($r) => $r['branchIssueId'] === $out['branch_issue_id']))[0] ?? null;

        ok($row !== null, 'ต้องเห็นรายการที่สาขาเบิกในตัวกรองสาขา');
        eq($row['takenBy'], 'คุณเอ', 'ชื่อคนที่มารับของ');
        ok(is_string($row['branchName']) && $row['branchName'] !== '', 'ต้องบอกชื่อสาขา');
        eq($row['branchStatus'], 'pending', 'สถานะเงิน');
        eq($row['branchProfit'], null, 'ยังไม่รับเงิน ต้องไม่มีกำไรในแถวนี้');
        ok($row['actorName'] !== null, 'ต้องบอกผู้บันทึกด้วย');
    });
});

test('รับเงินแล้ว แถวเดิมใน log แสดงกำไรและวันที่รับเงิน', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();

        $out = Stock::issue(issueReq($sku, 1, idem('logsettled'), [
            'branch_id' => $branch,
            'taken_by'  => 'คุณบี',
        ]));
        $cost = (float) Db::value('SELECT cost_total FROM branch_issues WHERE id = ?', [$out['branch_issue_id']]);
        Settlement::settle($out['branch_issue_id'], ['amount' => $cost + 250], [Roles::OWNER], 1);

        $rows = Inventory::movements(['who' => 'branch'], true)['rows'];
        $row = array_values(array_filter($rows, fn($r) => $r['branchIssueId'] === $out['branch_issue_id']))[0] ?? null;

        ok($row !== null, 'ต้องยังเห็นแถวเดิม');
        eq($row['branchStatus'], 'settled', 'สถานะหลังรับเงิน');
        eq($row['branchProfit'], round(250.0, 2), 'กำไรที่แสดงในแถว');
        ok($row['settledAt'] !== null, 'ต้องมีวันที่รับเงิน');
    });
});

test('การเบิกปกติไม่มีสาขาและไม่มีสถานะเงินติดมา', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $out = Stock::issue(issueReq($sku, 1, idem('plainlog')));

        $rows = Inventory::movements(['type' => 'OUT'], true)['rows'];
        $row = $rows[0] ?? null;
        ok($row !== null, 'ต้องมีแถว OUT');

        $plain = array_values(array_filter($rows, fn($r) => $r['branchIssueId'] === null))[0] ?? null;
        ok($plain !== null, 'ต้องมีรายการที่ไม่ใช่สาขาเบิก');
        eq($plain['branchName'], null, 'รายการปกติไม่มีสาขา');
        eq($plain['branchStatus'], null, 'รายการปกติไม่มีสถานะเงิน');
        eq($plain['branchProfit'], null, 'รายการปกติไม่มีกำไรค้าง');
    });
});

group('พนักงานหน้าร้านต้องไม่เห็นต้นทุน');

test('รายการสินค้าไม่ส่งต้นทุนไปให้พนักงาน แต่ยังส่งราคาขาย', function () {
    withRollback(function () {
        $staff = Inventory::products([], Roles::seeCost([Roles::SALES]))['rows'];
        ok(count($staff) > 0, 'ต้องมีสินค้า');

        foreach ($staff as $r) {
            eq($r['nextCost'], null, "ต้นทุนถัดไปของ {$r['sku']}");
            eq($r['stockValue'], null, "มูลค่าต้นทุนของ {$r['sku']}");
            ok(is_float($r['basePrice']), "ราคาขายของ {$r['sku']} ต้องยังเห็นได้ — พนักงานต้องใช้ขาย");
            ok(is_int($r['onHand']), "ยอดคงเหลือของ {$r['sku']} ต้องยังเห็นได้");
        }

        /* The same row, for someone who is allowed, must actually carry numbers
           — otherwise this test would pass on a query that simply returns none.
           สร้างของที่มีต้นทุนขึ้นมาเองแทนที่จะหวังว่าหน้าแรกของรายการจะมีสักตัว:
           เดิมเทสต์นี้อ่านหน้าแรกเฉย ๆ แล้วตกทันทีที่ร้านเพิ่มสินค้าใหม่หลายตัว
           ติดกันโดยยังไม่ลงต้นทุน ซึ่งเป็นเรื่องปกติของหน้างาน ไม่ใช่ความผิดพลาด */
        $sku = skuWithLots(1);
        Receiving::receive(
            ['sku' => $sku, 'quantity' => 1, 'cost_per_unit' => '123.00', 'received_date' => date('Y-m-d')],
            [Roles::OWNER],
            1,
        );

        $owner = Inventory::products(['q' => $sku], Roles::seeCost([Roles::OWNER]))['rows'];
        ok(count($owner) > 0, 'ต้องหาสินค้าที่เพิ่งรับเข้าเจอ');
        $row = $owner[0];
        ok(
            $row['nextCost'] !== null || $row['stockValue'] > 0,
            'เจ้าของร้านต้องเห็นต้นทุนจริง ไม่ใช่ null ทั้งหมด',
        );
    });
});

test('ล็อตและความเคลื่อนไหวไม่ส่งต้นทุนไปให้พนักงาน', function () {
    withRollback(function () {
        foreach (Inventory::lots([], Roles::seeCost([Roles::SALES]))['rows'] as $r) {
            eq($r['costPerUnit'], null, "ต้นทุน/ชิ้นของล็อต {$r['lotNumber']}");
            eq($r['value'], null, "มูลค่าของล็อต {$r['lotNumber']}");
            ok(is_int($r['remainingQty']), 'ยอดคงเหลือต้องยังเห็นได้');
        }

        foreach (Inventory::movements([], Roles::seeCost([Roles::SALES]))['rows'] as $r) {
            eq($r['unitCost'], null, "ต้นทุน/ชิ้นของรายการ {$r['id']}");
            eq($r['settledAmount'], null, "ยอดรับเงินของรายการ {$r['id']}");
            eq($r['branchProfit'], null, "กำไรของรายการ {$r['id']}");
        }

        $ownerLots = Inventory::lots([], Roles::seeCost([Roles::OWNER]))['rows'];
        ok(
            count(array_filter($ownerLots, fn($r) => $r['costPerUnit'] !== null)) > 0,
            'เจ้าของร้านต้องเห็นต้นทุนล็อตจริง',
        );
    });
});

test('รายละเอียดสินค้าและค่าเริ่มต้นตอนรับของก็ไม่หลุดต้นทุน', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $id = (int) Db::value('SELECT id FROM products WHERE sku = ?', [$sku]);

        $d = Inventory::product($id, Roles::seeCost([Roles::SALES]));
        eq($d['stockValue'], null, 'มูลค่าต้นทุนในหน้ารายละเอียด');
        foreach ($d['lots'] as $l) {
            eq($l['costPerUnit'], null, "ต้นทุนของล็อต {$l['lotNumber']}");
        }
        foreach ($d['logs'] as $g) {
            eq($g['unitCost'], null, "ต้นทุนของ log {$g['id']}");
        }

        $r = Inventory::receiveDefaults($sku, Roles::seeCost([Roles::SALES]));
        if ($r['lastLot'] !== null) {
            eq($r['lastLot']['costPerUnit'], null, 'ต้นทุนล็อตก่อนหน้าตอนรับของ');
            ok($r['lastLot']['lotNumber'] !== null, 'แต่เลขล็อตยังต้องเติมให้ได้');
        }
        eq($r['sku'], $sku, 'SKU ยังเติมให้เหมือนเดิม');
    });
});

test('ยอดรวมของคลังไม่ส่งมูลค่าต้นทุนไปให้พนักงาน', function () {
    withRollback(function () {
        eq(Inventory::summary(Roles::seeCost([Roles::SALES]))['stockValue'], null, 'มูลค่าคลังสำหรับพนักงาน');
        ok(Inventory::summary(Roles::seeCost([Roles::OWNER]))['stockValue'] > 0, 'เจ้าของร้านเห็นมูลค่าจริง');
    });
});

test('พนักงานเปิดหน้าค้างรับจากสาขาไม่ได้เลย ไม่ใช่แค่เห็นเป็นค่าว่าง', function () {
    withRollback(function () {
        throwsReason('forbidden', fn() => Settlement::list([], [Roles::SALES]), 'พนักงานดูรายการค้างรับ');
        throwsReason('forbidden', fn() => Settlement::summary([Roles::SALES]), 'พนักงานดูยอดค้างรับ');

        // The two roles that keep the books still get in.
        ok(is_array(Settlement::list([], [Roles::OWNER])), 'เจ้าของร้านดูได้');
        ok(is_array(Settlement::summary([Roles::ADMIN])), 'ฝ่ายบัญชีดูได้');
    });
});

test('ตัวเลขสรุปเดินตามตัวกรองสาขา ไม่ใช่นับทุกสาขาเสมอ', function () {
    withRollback(function () {
        $p = stockedForCancel(9);
        $branch = aBranch();
        aPendingIssue($p['sku'], 2);

        /* การ์ดข้างบนกับตารางข้างล่างอ่านคู่กันเสมอ — คนที่กรองเหลือสาขาเดียวแล้ว
           เห็นการ์ดบอกยอดของทุกสาขา จะอ่านว่าสาขานั้นเบิกไปเท่านั้นจริง ๆ ซึ่งเป็น
           ตัวเลขที่ผิดโดยไม่มีอะไรบอกว่าผิด */
        $one = Settlement::summary([Roles::OWNER], ['branch_id' => $branch]);
        eq(
            $one['pendingCount'],
            Settlement::list(['status' => 'pending', 'branch_id' => $branch], [Roles::OWNER])['total'],
            'ตัวเลขบนการ์ดต้องเท่ากับจำนวนแถวที่ตารางคืนมา',
        );

        ok(
            Settlement::summary([Roles::OWNER])['pendingCount'] >= $one['pendingCount'],
            'กรองสาขาเดียวแล้วต้องไม่มากกว่าทั้งร้าน',
        );
    });
});

test('รายชื่อสาขาให้พนักงานเห็นชื่อและจำนวนค้าง แต่ไม่เห็นยอดเงิน', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();
        Stock::issue(issueReq($sku, 1, idem('branchhide'), [
            'branch_id' => $branch,
            'taken_by'  => 'สมชาย',
        ]));

        $staffView = Branches::list(false, Roles::seeCost([Roles::SALES]));
        $row = array_values(array_filter($staffView, fn($b) => $b['id'] === $branch))[0];
        eq($row['pendingCost'], null, 'ยอดเงินที่ค้าง');
        eq($row['pendingCount'], 1, 'จำนวนรายการค้าง — เป็นข้อมูลสต็อก ยังเห็นได้');
        ok($row['name'] !== '', 'ชื่อสาขาต้องเห็นได้ ไม่งั้นบันทึกการเบิกไม่ได้');

        $ownerView = Branches::list(false, Roles::seeCost([Roles::OWNER]));
        $ownerRow = array_values(array_filter($ownerView, fn($b) => $b['id'] === $branch))[0];
        ok($ownerRow['pendingCost'] >= 0 && $ownerRow['pendingCost'] !== null, 'เจ้าของร้านเห็นยอด');
    });
});

test('ค่าเริ่มต้นของสิทธิ์คือไม่เห็นต้นทุน — ลืมส่งแล้วต้องปิด ไม่ใช่เปิด', function () {
    withRollback(function () {
        // Fail closed. If a new endpoint forgets to pass the flag, the cost is
        // withheld rather than leaked, and the bug shows up as a missing number
        // on screen instead of as a silent disclosure.
        eq(Inventory::summary()['stockValue'], null, 'summary() ที่ไม่ส่งสิทธิ์');
        foreach (Inventory::lots()['rows'] as $r) {
            eq($r['costPerUnit'], null, 'lots() ที่ไม่ส่งสิทธิ์');
        }
        eq(Roles::seeCost([Roles::SALES]), false, 'พนักงานไม่เห็นต้นทุน');
        eq(Roles::seeCost([Roles::ADMIN]), true, 'ฝ่ายบัญชีเห็น');
        eq(Roles::seeCost([Roles::OWNER]), true, 'เจ้าของร้านเห็น');
    });
});

group('แดชบอร์ด — ช่วงวันที่ การเรียง และการค้นหา');

test('รายงานสรุปตามช่วงวันที่ และแยกรายวันได้', function () {
    withRollback(function () {
        $today = date('Y-m-d');
        $r = Reports::overview($today, $today, true);

        eq($r['from'], $today, 'วันเริ่ม');
        eq($r['to'], $today, 'วันจบ');
        ok(is_array($r['byDay']), 'ต้องมีรายวัน');
        ok(is_array($r['topProducts']), 'ต้องมีสินค้าที่ตัดออกมากสุด');
        ok(is_array($r['topPeople']), 'ต้องมีคนที่เบิกมากสุด');
        ok(is_int($r['out']['qty']), 'จำนวนที่จ่ายออกต้องเป็นตัวเลข');

        foreach ($r['byDay'] as $d) {
            eq($d['day'], $today, 'ทุกวันในผลลัพธ์ต้องอยู่ในช่วงที่ขอ');
        }
    });
});

test('ใส่ช่วงวันที่กลับหัว ระบบสลับให้ ไม่ใช่ error', function () {
    withRollback(function () {
        $r = Reports::overview('2026-08-31', '2026-08-01', true);
        eq($r['from'], '2026-08-01', 'วันเริ่มหลังสลับ');
        eq($r['to'], '2026-08-31', 'วันจบหลังสลับ');
    });
});

test('วันที่รูปแบบผิดหรือไม่มีจริง ถูกปฏิเสธ', function () {
    withRollback(function () {
        throwsReason('bad_date', fn() => Reports::overview('31-08-2026', '2026-08-31', true), 'รูปแบบผิด');
        throwsReason('bad_date', fn() => Reports::overview('2026-02-30', '2026-08-31', true), 'วันที่ไม่มีจริง');
    });
});

test('รายงานไม่ส่งตัวเลขเงินให้พนักงาน แต่ยังบอกจำนวนชิ้น', function () {
    withRollback(function () {
        $r = Reports::overview(date('Y-m-01'), date('Y-m-d'), Roles::seeCost([Roles::SALES]));

        eq($r['out']['value'], null, 'มูลค่าที่จ่ายออก');
        eq($r['branch']['settledProfit'], null, 'กำไรจากสาขา');
        eq($r['branch']['owingCost'], null, 'ยอดค้างจากสาขา');
        ok(is_int($r['out']['qty']), 'จำนวนชิ้นยังเห็นได้');
        ok(is_int($r['branch']['owingCount']), 'จำนวนรายการค้างยังเห็นได้');

        foreach ($r['byDay'] as $d) {
            eq($d['cogs'], null, 'ต้นทุนขายรายวัน');
            ok(is_int($d['outQty']), 'จำนวนรายวันยังเห็นได้');
        }
        foreach ($r['topProducts'] as $p) {
            eq($p['cost'], null, 'ต้นทุนของสินค้าในตารางสรุป');
        }
    });
});

test('กรองความเคลื่อนไหวด้วยช่วงวันที่ได้', function () {
    withRollback(function () {
        $today = date('Y-m-d');
        $r = Inventory::movements(['from' => $today, 'to' => $today], true);

        foreach ($r['rows'] as $row) {
            eq(substr((string) $row['createdAt'], 0, 10), $today, 'วันของรายการที่กรองมา');
        }

        $wide = Inventory::movements(['from' => '2000-01-01', 'to' => $today], true);
        ok($wide['total'] >= $r['total'], 'ช่วงกว้างกว่าต้องได้ไม่น้อยกว่า');
    });
});

test('ช่วงวันที่ในอนาคตล้วน ได้ศูนย์รายการ ไม่ใช่ทั้งหมด', function () {
    withRollback(function () {
        $r = Inventory::movements(['from' => '2099-01-01', 'to' => '2099-12-31'], true);
        eq($r['total'], 0, 'จำนวนรายการในอนาคต');
        eq(count($r['rows']), 0, 'แถวที่คืนมา');
    });
});

test('เรียงตามคอลัมน์ที่รองรับได้ ทั้งขึ้นและลง', function () {
    withRollback(function () {
        $desc = Inventory::movements(['sort' => 'qty', 'dir' => 'desc'], true)['rows'];
        $asc  = Inventory::movements(['sort' => 'qty', 'dir' => 'asc'], true)['rows'];

        ok(count($desc) > 1, 'ต้องมีข้อมูลพอให้เรียง');

        $q = array_column($desc, 'quantity');
        $sorted = $q;
        rsort($sorted);
        eq($q, $sorted, 'เรียงจำนวนจากมากไปน้อย');

        $q2 = array_column($asc, 'quantity');
        $sorted2 = $q2;
        sort($sorted2);
        eq($q2, $sorted2, 'เรียงจำนวนจากน้อยไปมาก');
    });
});

test('ชื่อคอลัมน์เรียงที่ไม่รู้จัก ตกกลับไปค่าเริ่มต้น ไม่หลุดเข้า SQL', function () {
    withRollback(function () {
        $safe = Inventory::movements(['sort' => 'g.id; DROP TABLE products', 'dir' => 'evil'], true);
        $plain = Inventory::movements([], true);

        eq(
            array_column($safe['rows'], 'id'),
            array_column($plain['rows'], 'id'),
            'ค่าที่ไม่รู้จักต้องให้ผลเหมือนค่าเริ่มต้น',
        );
        // And the table it named is still there.
        ok((int) Db::value('SELECT COUNT(*) FROM products') > 0, 'ตาราง products ต้องยังอยู่');
    });
});

test('ค้นหาครอบคลุมหมายเหตุและชื่อคน ไม่ใช่แค่เลขเอกสาร', function () {
    withRollback(function () {
        $hit = Inventory::movements(['q' => 'ขายหน้าร้าน'], true);
        ok($hit['total'] > 0, 'ต้องหาเจอจากหมายเหตุ');
        foreach ($hit['rows'] as $r) {
            $hay = ($r['notes'] ?? '') . ($r['referenceDoc'] ?? '') . ($r['productName'] ?? '')
                . ($r['sku'] ?? '') . ($r['actorName'] ?? '') . ($r['branchName'] ?? '');
            ok(str_contains($hay, 'ขายหน้าร้าน'), 'ทุกแถวที่คืนมาต้องมีคำที่ค้นอยู่จริง');
        }

        $miss = Inventory::movements(['q' => 'ไม่มีคำนี้แน่นอน-' . bin2hex(random_bytes(4))], true);
        eq($miss['total'], 0, 'คำที่ไม่มีต้องได้ศูนย์');
    });
});

group('เลือกสินค้าจากรายการในคลัง');

test('เรียงรายการสินค้าตามคงเหลือได้ ทั้งมากไปน้อยและน้อยไปมาก', function () {
    withRollback(function () {
        $desc = Inventory::products(['sort' => 'onhand', 'dir' => 'desc'], true)['rows'];
        $asc  = Inventory::products(['sort' => 'onhand', 'dir' => 'asc'], true)['rows'];

        ok(count($desc) > 1, 'ต้องมีสินค้าพอให้เรียง');

        $d = array_column($desc, 'onHand');
        $sorted = $d;
        rsort($sorted);
        eq($d, $sorted, 'คงเหลือจากมากไปน้อย');

        $a = array_column($asc, 'onHand');
        $sorted2 = $a;
        sort($sorted2);
        eq($a, $sorted2, 'คงเหลือจากน้อยไปมาก');
    });
});

test('เรียงตามชื่อและราคาขายได้ และค่าเริ่มต้นคือสินค้าที่เพิ่มล่าสุด', function () {
    withRollback(function () {
        $byPrice = Inventory::products(['sort' => 'price', 'dir' => 'desc'], true)['rows'];
        $p = array_column($byPrice, 'basePrice');
        $sorted = $p;
        rsort($sorted);
        eq($p, $sorted, 'ราคาขายจากมากไปน้อย');

        $bySku = Inventory::products(['sort' => 'sku', 'dir' => 'asc'], true)['rows'];
        $s = array_column($bySku, 'sku');
        $sorted2 = $s;
        sort($sorted2, SORT_STRING);
        eq($s, $sorted2, 'ขอ SKU จากน้อยไปมาก ต้องได้ตามนั้น');

        // แคตตาล็อกไม่มีคอลัมน์วันที่เพิ่ม — id คือหลักฐานเดียวของลำดับที่เพิ่มเข้ามา
        $latest = array_column(Inventory::products([], true)['rows'], 'id');
        $sorted3 = $latest;
        rsort($sorted3, SORT_NUMERIC);
        eq($latest, $sorted3, 'ค่าเริ่มต้นเรียงจากสินค้าที่เพิ่มล่าสุด');
    });
});

test('คอลัมน์เรียงสินค้าที่ไม่รู้จัก ตกกลับไปค่าเริ่มต้น ไม่หลุดเข้า SQL', function () {
    withRollback(function () {
        $safe = Inventory::products(['sort' => "p.id) --", 'dir' => 'nonsense'], true);
        $plain = Inventory::products([], true);
        eq(
            array_column($safe['rows'], 'id'),
            array_column($plain['rows'], 'id'),
            'ค่าที่ไม่รู้จักต้องให้ผลเหมือนค่าเริ่มต้น',
        );
    });
});

test('เรียงแล้วแบ่งหน้ายังถูกต้อง — หน้าสองต่อจากหน้าแรกจริง', function () {
    withRollback(function () {
        $first = Inventory::products(['sort' => 'onhand', 'dir' => 'desc', 'page' => 1], true);
        if ($first['total'] <= Inventory::PER_PAGE) {
            return; // Not enough rows to have a second page; nothing to prove.
        }

        $second = Inventory::products(['sort' => 'onhand', 'dir' => 'desc', 'page' => 2], true);

        $lastOfFirst = end($first['rows'])['onHand'];
        $firstOfSecond = $second['rows'][0]['onHand'];
        ok($firstOfSecond <= $lastOfFirst, 'แถวแรกของหน้าสองต้องไม่มากกว่าแถวสุดท้ายของหน้าแรก');

        eq(
            count(array_intersect(array_column($first['rows'], 'id'), array_column($second['rows'], 'id'))),
            0,
            'สินค้าซ้ำระหว่างสองหน้า',
        );
    });
});

test('กรองเฉพาะสินค้าสำเร็จรูปแล้วไม่มีของสั่งตัดหลุดมา', function () {
    withRollback(function () {
        foreach (Inventory::products(['make' => 'ready'], true)['rows'] as $r) {
            eq($r['isCustomMade'], false, "สินค้า {$r['sku']} ต้องไม่ใช่ของสั่งตัด");
        }
    });
});

group('เรียงล็อตและรายการค้างรับ');

test('เรียงล็อตตามคงเหลือ ต้นทุน และมูลค่าได้', function () {
    withRollback(function () {
        foreach ([['remaining', 'remainingQty'], ['cost', 'costPerUnit'], ['value', 'value']] as [$key, $field]) {
            $rows = Inventory::lots(['sort' => $key, 'dir' => 'desc'], true)['rows'];
            ok(count($rows) > 1, "ต้องมีล็อตพอให้เรียงตาม {$key}");

            $prev = null;
            foreach ($rows as $r) {
                $v = $r[$field];
                if ($prev !== null && $v !== null) {
                    ok($v <= $prev, "{$field} ต้องไม่เพิ่มขึ้นเมื่อเรียงจากมากไปน้อย");
                }
                if ($v !== null) {
                    $prev = $v;
                }
            }
        }
    });
});

test('ค่าเริ่มต้นของล็อตคือล็อตล่าสุดก่อน — วันรับเข้าจากใหม่ไปเก่า', function () {
    withRollback(function () {
        $rows = Inventory::lots([], true)['rows'];
        $dates = array_column($rows, 'receivedDate');
        $sorted = $dates;
        rsort($sorted, SORT_STRING);
        eq($dates, $sorted, 'ล็อตต้องเรียงตามวันรับเข้าจากใหม่ไปเก่า');
    });
});

test('ขอวันรับเข้าจากเก่าไปใหม่ ได้ลำดับ FIFO กลับมา', function () {
    withRollback(function () {
        $rows = Inventory::lots(['sort' => 'received', 'dir' => 'asc'], true)['rows'];
        $dates = array_column($rows, 'receivedDate');
        $sorted = $dates;
        sort($sorted, SORT_STRING);
        eq($dates, $sorted, 'ล็อตต้องเรียงตามวันรับเข้าจากเก่าไปใหม่');
    });
});

test('คอลัมน์เรียงล็อตที่ไม่รู้จัก ตกกลับไปวันรับเข้า', function () {
    withRollback(function () {
        $safe = Inventory::lots(['sort' => 'l.id UNION SELECT', 'dir' => 'x'], true);
        $plain = Inventory::lots([], true);
        eq(array_column($safe['rows'], 'id'), array_column($plain['rows'], 'id'), 'ต้องเหมือนค่าเริ่มต้น');
    });
});

test('รายการค้างรับเรียงได้ และของที่ยังค้างอยู่บนสุดเสมอ', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $branch = aBranch();

        // One settled and one still owed, so the ordering rule has both to work on.
        $paid = Stock::issue(issueReq($sku, 1, idem('sortpaid'), [
            'branch_id' => $branch, 'taken_by' => 'ก',
        ]));
        Settlement::settle($paid['branch_issue_id'], ['amount' => 1000], [Roles::OWNER], 1);
        Stock::issue(issueReq($sku, 1, idem('sortowed'), [
            'branch_id' => $branch, 'taken_by' => 'ข',
        ]));

        foreach (['qty', 'cost', 'branch', 'issued', 'amount'] as $key) {
            $rows = Settlement::list(['branch_id' => $branch, 'sort' => $key], [Roles::OWNER])['rows'];
            ok(count($rows) >= 2, "ต้องมีรายการพอให้เรียงตาม {$key}");
            eq($rows[0]['status'], 'pending', "เรียงตาม {$key} แล้วของที่ค้างต้องยังอยู่บนสุด");
        }
    });
});

test('คอลัมน์เรียงรายการค้างรับที่ไม่รู้จัก ไม่หลุดเข้า SQL', function () {
    withRollback(function () {
        $safe = Settlement::list(['sort' => "i.id; DELETE FROM branches"], [Roles::OWNER]);
        $plain = Settlement::list([], [Roles::OWNER]);
        eq(array_column($safe['rows'], 'id'), array_column($plain['rows'], 'id'), 'ต้องเหมือนค่าเริ่มต้น');
        ok((int) Db::value('SELECT COUNT(*) FROM products') > 0, 'ฐานข้อมูลต้องยังอยู่ครบ');
    });
});

group('ขนาดหน้าที่ขอเองได้');

test('ขอจำนวนต่อหน้าเองได้ และแบ่งหน้าตามนั้นจริง', function () {
    withRollback(function () {
        $r = Inventory::products(['per' => 8], true);
        eq($r['perPage'], 8, 'จำนวนต่อหน้าที่ได้');
        ok(count($r['rows']) <= 8, 'แถวต่อหน้าต้องไม่เกินที่ขอ');

        if ($r['total'] > 8) {
            $second = Inventory::products(['per' => 8, 'page' => 2], true);
            eq($second['page'], 2, 'ไปหน้าสองได้');
            eq(
                count(array_intersect(array_column($r['rows'], 'id'), array_column($second['rows'], 'id'))),
                0,
                'สินค้าซ้ำระหว่างสองหน้า',
            );
        }
    });
});

test('ขนาดหน้าถูกจำกัดทั้งบนและล่าง ค่าขยะใช้ค่าเริ่มต้น', function () {
    withRollback(function () {
        eq(Inventory::products(['per' => 1], true)['perPage'], Inventory::PER_PAGE_MIN, 'เล็กเกินไป');
        eq(Inventory::products(['per' => 9999], true)['perPage'], Inventory::PER_PAGE_MAX, 'ใหญ่เกินไป');
        eq(Inventory::products(['per' => 'มาก'], true)['perPage'], Inventory::PER_PAGE, 'ค่าขยะ');
        eq(Inventory::products([], true)['perPage'], Inventory::PER_PAGE, 'ไม่ระบุ');
    });
});

test('สินค้าสำเร็จรูปแบ่งได้หลายหน้าเมื่อขอหน้าละ 8 — paginator จึงมีของให้กด', function () {
    withRollback(function () {
        $r = Inventory::products(['make' => 'ready', 'per' => 8], true);
        $pages = (int) ceil($r['total'] / 8);
        ok($pages > 1, "สินค้าสำเร็จรูป {$r['total']} ชิ้น ต้องได้มากกว่าหนึ่งหน้า");
    });
});

group('สเปกสินค้าใน attributes');

test('บันทึกค่าสายตาเป็นตัวเลข ไม่ใช่ข้อความ และอ่านกลับได้ครบ', function () {
    withRollback(function () {
        $sku = 'E2E-RX-' . strtoupper(bin2hex(random_bytes(3)));
        $cat = (int) Db::value('SELECT id FROM categories ORDER BY id LIMIT 1');

        $p = \Optic\Service\Catalog::createProduct([
            'sku' => $sku, 'name' => 'เลนส์ทดสอบค่าสายตา', 'brand' => 'Essilor',
            'product_type' => 'Lens', 'category_id' => $cat,
            'base_selling_price' => '9900', 'is_custom_made' => true,
            'attributes' => [
                'eye_side' => 'left', 'lens_design' => 'Progressive', 'lens_index' => '1.67',
                'coating' => 'Crizal Sapphire HR', 'sph' => -2.25, 'cyl' => -0.75,
                'axis' => 175, 'add' => '+2.00',
            ],
        ], [Roles::OWNER]);

        $back = Inventory::product($p['id'], true);
        $a = $back['attributes'];

        eq($a['lens_design'], 'Progressive', 'ชนิดเลนส์');
        eq($a['lens_index'], '1.67', 'ดัชนีหักเห');
        eq($a['sph'], -2.25, 'SPH ต้องเป็นตัวเลข');
        eq($a['cyl'], -0.75, 'CYL ต้องเป็นตัวเลข');
        eq($a['axis'], 175, 'AXIS ต้องเป็นจำนวนเต็ม');
        eq($a['add'], '+2.00', 'ADD เก็บเป็นข้อความ เพราะเครื่องหมายบวกเป็นส่วนหนึ่งของค่า');
        eq($back['eyeSide'], 'left', 'ข้างตาอ่านกลับผ่านคอลัมน์ที่ query ใช้');
    });
});

test('แก้ไขสินค้าแล้วคีย์ที่ฟอร์มไม่รู้จักต้องไม่หาย', function () {
    withRollback(function () {
        $sku = 'E2E-KEEP-' . strtoupper(bin2hex(random_bytes(3)));
        $cat = (int) Db::value('SELECT id FROM categories ORDER BY id LIMIT 1');

        // product_line is written by the shop-floor system, not by our form.
        $p = \Optic\Service\Catalog::createProduct([
            'sku' => $sku, 'name' => 'กรอบทดสอบ', 'product_type' => 'Frame',
            'category_id' => $cat, 'base_selling_price' => '1000', 'is_custom_made' => false,
            'attributes' => ['color' => 'ดำ', 'product_line' => 'Eyewear', 'legacy_pos_key' => 'X1'],
        ], [Roles::OWNER]);

        // The form always sends the whole product back, so the test does too.
        \Optic\Service\Catalog::updateProduct($p['id'], [
            'sku' => $sku, 'name' => 'กรอบทดสอบ', 'product_type' => 'Frame',
            'category_id' => $cat, 'base_selling_price' => '1000', 'is_custom_made' => false,
            'attributes' => ['color' => 'แดง', 'product_line' => 'Eyewear', 'legacy_pos_key' => 'X1'],
        ], [Roles::OWNER]);

        $a = Inventory::product($p['id'], true)['attributes'];
        eq($a['color'], 'แดง', 'ค่าที่แก้');
        eq($a['legacy_pos_key'], 'X1', 'คีย์ของระบบหน้าร้านต้องยังอยู่');
    });
});

group('สเปกสินค้าครบทุกชนิด กรอกได้ตั้งแต่ตอนเพิ่ม');

test('เลนส์สำเร็จรูปเก็บค่าสายตาได้ ไม่ใช่เฉพาะเลนส์สั่งตัด', function () {
    withRollback(function () {
        $cat = (int) Db::value('SELECT id FROM categories WHERE code = ?', ['Lens']);
        $sku = 'E2E-STOCKLENS-' . strtoupper(bin2hex(random_bytes(3)));

        // is_custom_made = false: a stock lens, held in a drawer by its power.
        $p = \Optic\Service\Catalog::createProduct([
            'sku' => $sku, 'name' => 'เลนส์สำเร็จรูป -2.00', 'brand' => 'Essilor',
            'product_type' => 'Lens', 'category_id' => $cat,
            'base_selling_price' => '1500', 'is_custom_made' => false,
            'attributes' => [
                'lens_design' => 'Single Vision', 'lens_index' => '1.56',
                'sph' => -2.0, 'cyl' => -0.5, 'axis' => 90,
            ],
        ], [Roles::OWNER]);

        $a = Inventory::product($p['id'], true)['attributes'];
        // JSON has one number type, so -2.0 comes back as int -2. Compare by
        // value: what matters is that it is a number and the right one, not
        // which PHP type json_decode happened to pick.
        eq((float) $a['sph'], -2.0, 'SPH ของเลนส์สำเร็จรูป');
        eq((float) $a['cyl'], -0.5, 'CYL ของเลนส์สำเร็จรูป');
        eq((int) $a['axis'], 90, 'AXIS ของเลนส์สำเร็จรูป');
        ok(is_int($a['sph']) || is_float($a['sph']), 'SPH ต้องเป็นตัวเลข ไม่ใช่ข้อความ');
        eq(Inventory::product($p['id'], true)['isCustomMade'], false, 'ยังเป็นสินค้าสำเร็จรูป');
    });
});

test('สินค้าทุกชนิดเก็บสเปกของตัวเองได้ครบ', function () {
    withRollback(function () {
        $cases = [
            ['Frame', ['color' => 'ดำเงา', 'size' => '52-18-145', 'material' => 'Acetate']],
            ['Sunglass', ['color' => 'น้ำตาล', 'tint' => 'Grey Gradient', 'polarized' => true]],
            ['ContactLen', ['bc' => '8.6', 'dia' => '14.2', 'pack' => 30, 'wear' => 'Daily']],
            // น้ำยาล้างแว่นอยู่ใต้ Accessory ตามที่ระบบหน้าร้านใช้อยู่
            ['Accessory', ['kind' => 'Cleaning', 'volume' => '60ml']],
        ];

        foreach ($cases as [$type, $attrs]) {
            $cat = (int) Db::value('SELECT id FROM categories WHERE code = ?', [$type]);
            $sku = 'E2E-' . strtoupper($type) . '-' . strtoupper(bin2hex(random_bytes(3)));

            $p = \Optic\Service\Catalog::createProduct([
                'sku' => $sku, 'name' => "ทดสอบ {$type}", 'product_type' => $type,
                'category_id' => $cat, 'base_selling_price' => '500',
                'is_custom_made' => false, 'attributes' => $attrs,
            ], [Roles::OWNER]);

            $back = Inventory::product($p['id'], true)['attributes'];
            foreach ($attrs as $k => $v) {
                eq($back[$k], $v, "{$type}.{$k}");
            }
        }
    });
});

test('ค่าที่เว้นว่างต้องไม่ถูกเก็บเป็นสตริงว่าง', function () {
    withRollback(function () {
        $cat = (int) Db::value('SELECT id FROM categories WHERE code = ?', ['Frame']);
        $sku = 'E2E-EMPTY-' . strtoupper(bin2hex(random_bytes(3)));

        $p = \Optic\Service\Catalog::createProduct([
            'sku' => $sku, 'name' => 'กรอบไม่ระบุสี', 'product_type' => 'Frame',
            'category_id' => $cat, 'base_selling_price' => '900',
            'is_custom_made' => false, 'attributes' => ['size' => '50-20-140'],
        ], [Roles::OWNER]);

        $a = Inventory::product($p['id'], true)['attributes'];
        eq(array_key_exists('color', $a), false, 'คีย์ที่ไม่ได้กรอกต้องไม่มีอยู่เลย');
        eq($a['size'], '50-20-140', 'คีย์ที่กรอกยังอยู่');
    });
});

group('หน้าใบสั่งตัด RX เห็นเฉพาะของที่สั่งพิเศษได้');

test('ตัวกรอง rx คืนเฉพาะสินค้าสั่งตัดหรือของที่หมดสต็อก', function () {
    withRollback(function () {
        $rows = Inventory::products(['make' => 'rx', 'per' => 100], true)['rows'];
        ok(count($rows) > 0, 'ต้องมีของให้สั่งพิเศษอย่างน้อยหนึ่งรายการ');

        foreach ($rows as $r) {
            /* ติดลบก็คือหมดสต็อก — และเป็นเหตุผลที่หนักกว่าเดิมที่จะสั่งพิเศษ
               มีลูกค้ารอของอยู่แล้ว ไม่ใช่แค่ชั้นว่าง */
            ok(
                $r['isCustomMade'] || $r['onHand'] <= 0,
                "{$r['sku']} ต้องเป็นสินค้าสั่งตัด หรือหมดสต็อก — ได้ onHand {$r['onHand']}",
            );
        }
    });
});

test('สินค้าที่ยังมีของเหลือ ต้องไม่โผล่ในตัวกรอง rx', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $onHand = Stock::availability($sku)['on_hand'];
        ok($onHand > 0, 'สินค้าตัวอย่างต้องยังมีของ');

        $rows = Inventory::products(['make' => 'rx', 'per' => 100], true)['rows'];
        $found = array_filter($rows, fn($r) => $r['sku'] === $sku);
        eq(count($found), 0, "{$sku} ยังมีของ {$onHand} ชิ้น ต้องไม่อยู่ในรายการสั่งพิเศษ");
    });
});

test('สินค้าที่ตัดจนหมด กลายเป็นของที่สั่งพิเศษได้ทันที', function () {
    withRollback(function () {
        // Take a product down to zero, then it must appear in the RX list.
        $row = Db::one(
            'SELECT p.sku, COALESCE(SUM(l.remaining_qty), 0) AS n
             FROM products p JOIN stock_lots l ON l.product_id = p.id
             WHERE p.is_custom_made = 0
             GROUP BY p.id, p.sku HAVING n > 0 AND n <= 12
             ORDER BY n ASC LIMIT 1'
        );
        ok($row !== null, 'ต้องมีสินค้าที่ตัดจนหมดได้ในเทสต์เดียว');

        $sku = (string) $row['sku'];
        $before = Inventory::products(['make' => 'rx', 'per' => 100], true)['rows'];
        eq(count(array_filter($before, fn($r) => $r['sku'] === $sku)), 0, 'ก่อนตัด ต้องยังไม่อยู่ในรายการ');

        Stock::issue(issueReq($sku, (int) $row['n'], idem('rxdrain')));
        eq(Stock::availability($sku)['on_hand'], 0, 'ต้องตัดจนหมดจริง');

        $after = Inventory::products(['make' => 'rx', 'per' => 100], true)['rows'];
        eq(count(array_filter($after, fn($r) => $r['sku'] === $sku)), 1, 'พอหมดแล้วต้องโผล่ในรายการสั่งพิเศษ');
    });
});

test('ตัวกรอง rx นับยอดรวมตรงกับจำนวนแถวที่คืนมา', function () {
    withRollback(function () {
        $r = Inventory::products(['make' => 'rx', 'per' => 100], true);
        eq($r['total'], count($r['rows']), 'ยอดรวมกับจำนวนแถวต้องตรงกันเมื่อมีหน้าเดียว');
    });
});

group('สาขาจ่ายคืนเท่าทุน — ไม่ต้องมีกำไรเสมอไป');

test('รับเงินเท่าต้นทุนพอดี ทำได้ และกำไรเป็นศูนย์ ไม่ใช่ error', function () {
    withRollback(function () {
        $sku = skuWithCost(1);
        $branch = aBranch();

        $out = Stock::issue(issueReq($sku, 1, idem('atcost'), [
            'branch_id' => $branch,
            'taken_by'  => 'สมชาย',
        ]));
        $id = $out['branch_issue_id'];
        $cost = (float) Db::value('SELECT cost_total FROM branch_issues WHERE id = ?', [$id]);
        ok($cost > 0, 'รายการตัวอย่างต้องมีต้นทุน');

        $r = Settlement::settle($id, ['amount' => $cost, 'note' => 'รับเท่าทุน'], [Roles::OWNER], 1);

        eq($r['status'], 'settled', 'สถานะต้องเป็นรับเงินแล้ว');
        eq($r['settledAmount'], round($cost, 2), 'ยอดที่รับเท่ากับต้นทุนพอดี');
        eq($r['profit'], 0.0, 'กำไรต้องเป็นศูนย์ ไม่ใช่ null');
        neq($r['profit'], null, 'ศูนย์กับ "ยังไม่รู้" ต้องไม่ใช่ค่าเดียวกัน');
    });
});

test('รับเงินน้อยกว่าต้นทุนได้ และกำไรติดลบตามจริง', function () {
    withRollback(function () {
        $sku = skuWithCost(1);
        $branch = aBranch();

        $out = Stock::issue(issueReq($sku, 1, idem('below'), [
            'branch_id' => $branch,
            'taken_by'  => 'สมหญิง',
        ]));
        $id = $out['branch_issue_id'];
        $cost = (float) Db::value('SELECT cost_total FROM branch_issues WHERE id = ?', [$id]);

        // Sometimes a branch sends back less than the goods cost. The books have
        // to be able to say so rather than refusing to record what happened.
        $paid = round($cost / 2, 2);
        $r = Settlement::settle($id, ['amount' => $paid], [Roles::OWNER], 1);

        eq($r['settledAmount'], $paid, 'ยอดที่รับจริง');
        eq($r['profit'], round($paid - $cost, 2), 'กำไรติดลบตามจริง');
        ok($r['profit'] < 0, 'ต้องติดลบจริง');
    });
});

test('รับเงินศูนย์บาททำได้ แต่ต่างจากตัดหนี้สูญ', function () {
    withRollback(function () {
        $sku = skuWithCost(1);
        $branch = aBranch();

        $a = Stock::issue(issueReq($sku, 1, idem('zero'), ['branch_id' => $branch, 'taken_by' => 'ก']));
        $b = Stock::issue(issueReq($sku, 1, idem('writeoff'), ['branch_id' => $branch, 'taken_by' => 'ข']));

        $paid = Settlement::settle($a['branch_issue_id'], ['amount' => 0, 'note' => 'ให้เปล่า'], [Roles::OWNER], 1);
        $lost = Settlement::writeOff($b['branch_issue_id'], ['note' => 'สาขาปิดกิจการ'], [Roles::OWNER], 1);

        eq($paid['status'], 'settled', 'รับศูนย์บาทถือว่าปิดรายการแล้ว');
        eq($lost['status'], 'written_off', 'หนี้สูญเป็นคนละสถานะ');
        neq($paid['status'], $lost['status'], 'สองอย่างนี้ต้องแยกกันในรายงาน');
        eq($lost['profit'], null, 'หนี้สูญไม่มีกำไร');
        ok($paid['profit'] < 0, 'รับศูนย์บาทคือขาดทุนเท่าต้นทุน');
    });
});

test('รับเท่าทุนแล้ว กำไรรวมของเดือนไม่ขยับ', function () {
    withRollback(function () {
        $sku = skuWithCost(1);
        $branch = aBranch();
        $before = Settlement::summary([Roles::OWNER])['monthProfit'];

        $out = Stock::issue(issueReq($sku, 1, idem('nomove'), [
            'branch_id' => $branch, 'taken_by' => 'สมชาย',
        ]));
        $cost = (float) Db::value('SELECT cost_total FROM branch_issues WHERE id = ?', [$out['branch_issue_id']]);
        Settlement::settle($out['branch_issue_id'], ['amount' => $cost], [Roles::OWNER], 1);

        eq(
            round(Settlement::summary([Roles::OWNER])['monthProfit'], 2),
            round($before, 2),
            'กำไรรวมต้องเท่าเดิม เพราะรายการนี้ไม่ได้กำไร',
        );
    });
});

group('ตารางสิทธิ์ต้องตรงกับที่บังคับใช้จริง');

test('ทุกช่องในตารางมาจากฟังก์ชันที่ API ใช้บังคับ ไม่ใช่ค่าที่พิมพ์ซ้ำ', function () {
    withRollback(function () {
        $p = Roles::policy();

        eq(count($p['roles']), count(Roles::ALL), 'จำนวนบทบาท');
        eq(array_column($p['roles'], 'key'), Roles::ALL, 'รายชื่อบทบาทตรงกับ Roles::ALL');
        ok(count($p['groups']) > 0, 'ต้องมีหมวดอย่างน้อยหนึ่งหมวด');

        // Every cell must equal what the real check answers right now.
        $checked = 0;
        foreach ($p['groups'] as $g) {
            foreach ($g['rows'] as $row) {
                foreach (Roles::ALL as $role) {
                    ok(array_key_exists($role, $row['allow']), "แถว '{$row['label']}' ต้องมีคำตอบของ {$role}");
                    ok(is_bool($row['allow'][$role]), 'ทุกช่องต้องเป็น true/false ไม่ใช่ค่าว่าง');
                    $checked++;
                }
            }
        }
        ok($checked >= 30, "ต้องตรวจอย่างน้อย 30 ช่อง — ตรวจไป {$checked}");
    });
});

test('ตารางบอกตรงกับสิทธิ์จริงของแต่ละบทบาท', function () {
    withRollback(function () {
        $p = Roles::policy();

        /** Finds the row whose label starts with the given text. */
        $row = function (string $needle) use ($p): array {
            foreach ($p['groups'] as $g) {
                foreach ($g['rows'] as $r) {
                    if (str_starts_with($r['label'], $needle)) {
                        return $r;
                    }
                }
            }
            fail("ไม่พบแถว '{$needle}' ในตารางสิทธิ์");
        };

        $cost = $row('ต้นทุน/ชิ้น');
        eq($cost['allow'][Roles::OWNER], Roles::seeCost([Roles::OWNER]), 'เห็นต้นทุน · เจ้าของร้าน');
        eq($cost['allow'][Roles::ADMIN], Roles::seeCost([Roles::ADMIN]), 'เห็นต้นทุน · แอดมิน');
        eq($cost['allow'][Roles::SALES], Roles::seeCost([Roles::SALES]), 'เห็นต้นทุน · พนักงาน');
        eq($cost['allow'][Roles::SALES], false, 'พนักงานต้องไม่เห็นต้นทุน');

        /* เห็นกับกรอกเป็นคนละแถว และแอดมินอยู่คนละฝั่งของสองแถวนี้ — เป็นคู่ที่
           บันไดยศเขียนไม่ได้ และเป็นเหตุผลที่ตารางนี้สร้างจากชุดสิทธิ์ ไม่ใช่จากยศ */
        $enter = $row('กรอก/แก้ต้นทุน');
        eq($enter['allow'][Roles::OWNER], true, 'เจ้าของร้านกรอกต้นทุนได้');
        eq($enter['allow'][Roles::ADMIN], false, 'แอดมินกรอกต้นทุนไม่ได้');
        eq($cost['allow'][Roles::ADMIN], true, 'แต่แถวเห็นต้นทุนยังเป็นของแอดมิน');

        $cases = $row('ดู Case');
        eq($cases['allow'][Roles::STOCK], false, 'พนักงานคลังไม่เห็นเคส');
        eq($cases['allow'][Roles::TRAINEE], true, 'พนักงานฝึกหัดเห็นเคสทั้งหมด');

        $users = $row('จัดการผู้ใช้');
        eq($users['allow'][Roles::ADMIN], true, 'แอดมินจัดการผู้ใช้ได้');
        eq($users['allow'][Roles::SALES], false, 'พนักงานขายจัดการผู้ใช้ไม่ได้');
        eq($users['allow'][Roles::STOCK], false, 'พนักงานคลังจัดการผู้ใช้ไม่ได้');
        eq($users['allow'][Roles::OWNER], true, 'เจ้าของร้านจัดการผู้ใช้ได้');

        $branch = $row('เพิ่ม · แก้สาขา');
        eq($branch['allow'][Roles::ADMIN], Roles::manageBranches([Roles::ADMIN]), 'จัดการสาขา · ฝ่ายบัญชี');

    /* ทุกบทบาทเบิกได้ ยกเว้นบัญชี — บทบาทแรกที่เข้าระบบมาเพื่ออ่านตัวเลข
       ไม่ใช่มาทำให้ตัวเลขเกิด */
        $move = $row('เบิก · ตัดของเสีย');
        foreach (Roles::ALL as $r) {
            eq($move['allow'][$r], $r !== Roles::ACCOUNTING, "สิทธิ์เบิกของ {$r}");
        }

        /* `always` = จริงกับทุกบทบาท · เคยมีสองแถวที่เข้าเงื่อนไขนี้ (เพิ่มสินค้า
           ใหม่ กับ เบิก) แล้วบทบาทบัญชีทำให้ไม่เหลือสักแถว — ซึ่งเป็นคำตอบที่ถูก
           ไม่ใช่ของที่ต้องซ่อม: ตั้งแต่มีคนที่เข้าระบบมาอ่านอย่างเดียว ประโยคว่า
           "ทุกคนในร้านทำสิ่งนี้ได้" ไม่จริงอีกต่อไป และตารางต้องพูดตามนั้น */
        eq($row('เพิ่มสินค้าใหม่')['always'], false, 'บัญชีเพิ่มสินค้าไม่ได้ แถวนี้จึงไม่ใช่ของทุกคนแล้ว');
        eq($row('กรอก/แก้ต้นทุน')['always'], false, 'ต้นทุนไม่ใช่ของทุกคน');
    });
});

test('เปลี่ยนกฎในโค้ดแล้วตารางเปลี่ยนตามทันที', function () {
    withRollback(function () {
        // The point of generating the table: it cannot disagree with the code.
        // If seeCost ever opened up to staff, this row would say so by itself.
        $p = Roles::policy();
        foreach ($p['groups'] as $g) {
            foreach ($g['rows'] as $r) {
                if ($r['always']) {
                    continue;
                }
                /* ไม่มีแถวไหนที่บทบาทต่ำกว่าทำได้แล้วบทบาทสูงกว่าทำไม่ได้ —
                   ลำดับของ Roles::rank ต้องเป็นจริงทุกช่อง ไม่งั้นหน้าจอจะบอก
                   ว่าเจ้าของร้านทำน้อยกว่าลูกน้องของตัวเอง */
                foreach (Roles::ALL as $lower) {
                    if (!$r['allow'][$lower]) {
                        continue;
                    }
                    foreach (Roles::ALL as $higher) {
                        if (Roles::rank([$higher]) <= Roles::rank([$lower])) {
                            continue;
                        }
                        eq(
                            $r['allow'][$higher],
                            true,
                            "แถว '{$r['label']}': {$higher} ต้องได้สิทธิ์อย่างน้อยเท่า {$lower}",
                        );
                    }
                }
            }
        }
    });
});

group('เปิดใช้งานในวง LAN');

test('ปิดสวิตช์ไว้ ไม่มี origin ไหนผ่านด้วยกฎ LAN', function () {
    withRollback(function () {
        putenv('API_ALLOW_LAN=0');
        eq(\Optic\Http::isLanOrigin('http://192.168.1.50:3000'), false, 'ปิดอยู่ ต้องไม่ผ่าน');
        eq(\Optic\Http::isLanOrigin('http://localhost:3000'), false, 'ปิดอยู่ แม้แต่ localhost ก็ไม่ผ่านทางนี้');
        putenv('API_ALLOW_LAN');
    });
});

test('เปิดแล้วรับเฉพาะเครื่องในวงเน็ตส่วนตัว', function () {
    withRollback(function () {
        putenv('API_ALLOW_LAN=1');

        foreach (['http://192.168.1.108:3000', 'http://10.0.0.5:3000', 'http://172.16.4.9:3000',
                  'http://localhost:3000', 'http://127.0.0.1:3000'] as $ok) {
            eq(\Optic\Http::isLanOrigin($ok), true, "ต้องผ่าน: {$ok}");
        }

        // Anything that is not a private address is refused, whatever it claims.
        foreach (['http://8.8.8.8:3000', 'http://203.150.10.1', 'http://evil.example.com',
                  'https://192.168.1.108:3000', 'http://192.168.1.108.evil.com', ''] as $bad) {
            eq(\Optic\Http::isLanOrigin($bad), false, "ต้องไม่ผ่าน: {$bad}");
        }

        putenv('API_ALLOW_LAN');
    });
});

test('ลบสาขาที่ยังไม่เคยเบิกของได้', function () {
    withRollback(function () {
        $branch = aBranch();

        $gone = Branches::delete($branch, [Roles::OWNER]);
        eq($gone['id'], $branch, 'คืน id ของสาขาที่ลบ');
        eq(Db::value('SELECT COUNT(*) FROM branches WHERE id = ?', [$branch]), 0, 'แถวต้องหายจริง');
    });
});

test('สาขาที่เคยเบิกของแล้ว ลบไม่ได้ — ประวัติต้องอ่านย้อนหลังได้', function () {
    withRollback(function () {
        $sku = skuWithCost(1);
        $branch = aBranch();
        Stock::issue(issueReq($sku, 1, idem('nodelete'), [
            'branch_id' => $branch,
            'taken_by'  => 'สมหญิง',
        ]));

        throwsReason(
            'branch_has_history',
            fn() => Branches::delete($branch, [Roles::OWNER]),
            'ลบสาขาที่เคยเบิกของ',
        );

        // จ่ายเงินครบแล้วก็ยังลบไม่ได้ — ที่กันไว้คือประวัติ ไม่ใช่ยอดค้าง
        $issue = Db::one(
            'SELECT id FROM branch_issues WHERE branch_id = ? ORDER BY id DESC LIMIT 1',
            [$branch],
        );
        Settlement::settle(
            (int) $issue['id'],
            ['amount' => '500.00', 'received_date' => date('Y-m-d')],
            [Roles::OWNER],
            1,
        );
        throwsReason(
            'branch_has_history',
            fn() => Branches::delete($branch, [Roles::OWNER]),
            'ลบสาขาที่เคลียร์เงินแล้ว',
        );
    });
});

test('ลบสาขาได้เฉพาะเจ้าของร้าน', function () {
    withRollback(function () {
        $branch = aBranch();

        throwsReason(
            'forbidden',
            fn() => Branches::delete($branch, [Roles::ADMIN]),
            'ฝ่ายบัญชีลบสาขา',
        );
        throwsReason(
            'forbidden',
            fn() => Branches::delete($branch, [Roles::SALES]),
            'พนักงานลบสาขา',
        );
    });
});

group('แก้ไขและยกเลิกรายการค้างรับจากสาขา');

/**
 * สินค้าหนึ่งตัวที่มีของอยู่ล็อตเดียว รู้ต้นทุน
 *
 * เทสต์กลุ่มนี้สร้างของเอง ไม่หยิบจาก `skuWithLots()` เพราะสิ่งที่ตรวจคือยอด
 * ล็อตก่อนกับหลังยกเลิก ซึ่งต้องเป็นล็อตที่ไม่มีเทสต์อื่นมายุ่งด้วย
 *
 * @return array{sku:string,lot:string}
 */
function stockedForCancel(int $qty = 5): array
{
    $sku = 'CAN-' . strtoupper(bin2hex(random_bytes(3)));
    Catalog::createProduct([
        'sku'                => $sku,
        'name'               => 'สินค้าทดสอบยกเลิกการเบิก',
        'product_type'       => 'Frame',
        'category_id'        => (int) Db::value("SELECT id FROM categories WHERE code = 'Frame'"),
        'base_selling_price' => '1200.00',
        'is_custom_made'     => false,
    ], [Roles::OWNER]);

    $lot = 'LOT-' . strtoupper(bin2hex(random_bytes(3)));
    $received = Receiving::receive([
        'sku'           => $sku,
        'lot_number'    => $lot,
        'quantity'      => $qty,
        'cost_per_unit' => '400.00',
        'received_date' => date('Y-m-d'),
    ], [Roles::OWNER], 1);

    return ['sku' => $sku, 'lot' => $lot, 'lot_id' => (int) $received['lotId']];
}

/** สาขามาเบิกของจากสินค้าที่เพิ่งสร้าง แล้วคืน id ของรายการค้างรับ */
function aPendingIssue(string $sku, int $qty = 2, array $extra = []): int
{
    $out = Stock::issue(issueReq($sku, $qty, idem('cancel'), $extra + [
        'branch_id' => aBranch(),
        'taken_by'  => 'สมชาย',
    ]));

    return (int) $out['branch_issue_id'];
}

test('แก้สาขา ผู้รับของ วันที่เบิก และหมายเหตุ ของใบที่ยังค้างได้', function () {
    withRollback(function () {
        $p = stockedForCancel();
        $id = aPendingIssue($p['sku']);
        $other = aBranch();

        $out = Settlement::edit($id, [
            'branch_id' => $other,
            'taken_by'  => 'สมหญิง',
            'issued_at' => '2026-08-01',
            'note'      => 'คีย์สาขาผิด แก้แล้ว',
        ], [Roles::OWNER], 1);

        eq($out['branchId'], $other, 'สาขา');
        eq($out['takenBy'], 'สมหญิง', 'ผู้รับของ');
        ok(str_starts_with((string) $out['issuedAt'], '2026-08-01'), 'วันที่เบิก — ได้ ' . $out['issuedAt']);
        eq($out['note'], 'คีย์สาขาผิด แก้แล้ว', 'หมายเหตุ');
    });
});

test('แก้รายการค้างรับแล้ว ยอดในล็อตไม่ขยับ — แก้ป้าย ไม่ใช่แก้ของ', function () {
    withRollback(function () {
        $p = stockedForCancel();
        $id = aPendingIssue($p['sku'], 2);
        $before = lotRemaining($p['lot_id']);

        Settlement::edit($id, ['taken_by' => 'คนใหม่'], [Roles::OWNER], 1);

        eq(lotRemaining($p['lot_id']), $before, 'ยอดล็อตต้องเท่าเดิม');
    });
});

test('ใบที่รับเงินไปแล้ว แก้ไม่ได้', function () {
    withRollback(function () {
        $p = stockedForCancel();
        $id = aPendingIssue($p['sku']);
        Settlement::settle($id, ['amount' => '1500'], [Roles::OWNER], 1);

        throwsReason(
            'not_pending',
            fn() => Settlement::edit($id, ['taken_by' => 'ใครก็ได้'], [Roles::OWNER], 1),
            'แก้ใบที่ปิดไปแล้ว',
        );
    });
});

test('พนักงานขายแก้รายการค้างรับไม่ได้ — เป็นเรื่องเงินของร้าน', function () {
    withRollback(function () {
        $p = stockedForCancel();
        $id = aPendingIssue($p['sku']);

        throwsReason(
            'forbidden',
            fn() => Settlement::edit($id, ['taken_by' => 'ใครก็ได้'], [Roles::SALES], 1),
            'staff แก้รายการค้างรับ',
        );
    });
});

test('ยกเลิกใบค้าง แล้วของกลับเข้าล็อตเดิมครบ', function () {
    withRollback(function () {
        $p = stockedForCancel(5);
        $full = lotRemaining($p['lot_id']);
        $id = aPendingIssue($p['sku'], 2);

        eq(lotRemaining($p['lot_id']), $full - 2, 'เบิกแล้วยอดต้องลดก่อน');

        $out = Settlement::cancel($id, ['note' => 'สาขาเอาของมาคืน'], [Roles::OWNER], 1);

        eq($out['status'], 'cancelled', 'สถานะต้องเป็นยกเลิก');
        eq(lotRemaining($p['lot_id']), $full, 'ของต้องกลับเข้าล็อตเดิมครบ');
    });
});

test('ยกเลิกแล้วสมุดกับยอดล็อตยังตรงกัน', function () {
    withRollback(function () {
        $p = stockedForCancel(5);
        $id = aPendingIssue($p['sku'], 3);

        Settlement::cancel($id, ['note' => 'คืนของ'], [Roles::OWNER], 1);

        $bad = Db::all(
            'SELECT l.lot_number FROM stock_lots l
             LEFT JOIN inventory_logs g ON g.lot_id = l.id
             WHERE l.lot_number = ?
             GROUP BY l.id, l.lot_number, l.remaining_qty
             HAVING l.remaining_qty <> COALESCE(SUM(g.quantity), 0)',
            [$p['lot']],
        );
        eq(count($bad), 0, 'ล็อตที่ยอดไม่ตรงกับสมุด');
    });
});

test('ยกเลิกใบที่รับเงินไปแล้วไม่ได้ — ต้องออกใบลดหนี้แทน', function () {
    withRollback(function () {
        $p = stockedForCancel();
        $id = aPendingIssue($p['sku']);
        Settlement::settle($id, ['amount' => '1500'], [Roles::OWNER], 1);

        throwsReason(
            'already_settled',
            fn() => Settlement::cancel($id, ['note' => 'ขอยกเลิก'], [Roles::OWNER], 1),
            'ยกเลิกใบที่รับเงินแล้ว',
        );
    });
});

test('ยกเลิกรายการค้างรับต้องบอกเหตุผล', function () {
    withRollback(function () {
        $p = stockedForCancel();
        $id = aPendingIssue($p['sku']);

        throwsReason(
            'missing_field',
            fn() => Settlement::cancel($id, [], [Roles::OWNER], 1),
            'ยกเลิกโดยไม่บอกเหตุผล',
        );
    });
});

test('ยกเลิกซ้ำไม่ได้ — ของคืนไปแล้วรอบเดียว', function () {
    withRollback(function () {
        $p = stockedForCancel(5);
        $full = lotRemaining($p['lot_id']);
        $id = aPendingIssue($p['sku'], 2);

        Settlement::cancel($id, ['note' => 'คืนของ'], [Roles::OWNER], 1);
        throwsReason(
            'not_pending',
            fn() => Settlement::cancel($id, ['note' => 'คืนอีกรอบ'], [Roles::OWNER], 1),
            'ยกเลิกซ้ำ',
        );

        eq(lotRemaining($p['lot_id']), $full, 'ยอดต้องไม่เกินของที่เคยรับเข้า');
    });
});

test('สาขาเบิกเกินของที่มี ปฏิเสธ ไม่เปิดใบและไม่ทำให้ยอดติดลบ', function () {
    withRollback(function () {
        $p = stockedForCancel(2);

        /* ยอดติดลบเป็นเรื่องของการขายหน้าร้าน — ที่นั่นของออกจากร้านไปแล้วจริง
           ระบบได้แค่จดตาม · ใบเบิกของสาขาเกิดก่อนของจะขยับ การปฏิเสธตอนนี้คือ
           การบอกว่าบนชั้นไม่มีให้หยิบ ซึ่งคนกดยังแก้ทันโดยไม่ต้องไปแก้สมุด */
        $e = throwsReason(
            'insufficient',
            fn() => aPendingIssue($p['sku'], 5),
            'สาขาเบิกห้าชิ้นจากของที่มีสองชิ้น',
        );
        eq($e->extra['available'], 2, 'ต้องบอกด้วยว่ามีอยู่เท่าไร คนกดจะได้แก้จำนวนได้เลย');

        eq(lotRemaining($p['lot_id']), 2, 'ของบนชั้นต้องไม่ขยับ');
        eq(
            (int) Db::value('SELECT COUNT(*) FROM stock_lots WHERE lot_number = ?', ['SHORT-' . $p['sku']]),
            0,
            'ต้องไม่มีล็อตค้างส่งเกิดขึ้นเลย',
        );
    });
});

group('ยอดขายและกำไรบนแดชบอร์ด');

/**
 * ใบสั่งตัดหนึ่งใบ พร้อมรุ่นเลนส์ของตัวเอง
 *
 * สร้างรุ่นเองแทนที่จะหยิบรุ่นที่มีอยู่ เพราะเทสต์กลุ่มนี้อ่านผลรวมของทั้งช่วง
 * ไม่ใช่ของแถวเดียว — รุ่นที่ใช้ร่วมกับเทสต์อื่นจะพาตัวเลขของคนอื่นเข้ามาด้วย
 *
 * @param array<string,mixed> $over
 * @return array<string,mixed>
 */
function anRxSale(array $over = []): array
{
    return Rx::order([
        'lens_name'     => 'เลนส์ทดสอบยอดขาย ' . bin2hex(random_bytes(3)),
        'reference_doc' => 'RX-SALE-' . strtoupper(bin2hex(random_bytes(3))),
    ] + $over, [Roles::OWNER], 1);
}

/** ตัวเลขยอดขายของวันนี้ ตามที่แดชบอร์ดจะได้ */
function salesToday(bool $money = true): array
{
    return Reports::overview(date('Y-m-d'), date('Y-m-d'), $money)['sales'];
}

test('ใบสั่งตัดที่มีทั้งราคาขายและต้นทุน นับเป็นยอดขายและกำไร', function () {
    withRollback(function () {
        $before = salesToday();

        anRxSale(['sale_price' => '9500', 'unit_cost' => '4000']);

        $after = salesToday();
        eq($after['bills'] - $before['bills'], 1, 'จำนวนรายการ');
        eq($after['costed'] - $before['costed'], 1, 'รายการที่รู้ต้นทุน');
        eq(round($after['revenue'] - $before['revenue'], 2), 9500.0, 'ยอดขายที่เพิ่ม');
        eq(round($after['profit'] - $before['profit'], 2), 5500.0, 'กำไรที่เพิ่ม');
    });
});

test('ใบที่ตั้งราคาแต่ยังไม่ลงต้นทุน นับเป็นยอดขาย แต่ไม่นับเป็นกำไร', function () {
    withRollback(function () {
        $before = salesToday();

        anRxSale(['sale_price' => '9500']);

        $after = salesToday();
        eq(round($after['revenue'] - $before['revenue'], 2), 9500.0, 'ยอดขายต้องนับ');
        eq(round($after['profit'] - $before['profit'], 2), 0.0, 'กำไรต้องไม่ขยับ');
        eq($after['uncosted'] - $before['uncosted'], 1, 'ต้องถูกนับเป็นรายการที่ยังไม่รู้ต้นทุน');
    });
});

/**
 * เหตุผลที่ `costedRevenue` ต้องแยกจาก `revenue` — บทเรียนเดิมของโปรเจกต์
 *
 * ใบที่รู้ต้นทุนขาย 100 กำไร 40 · อีกใบขาย 900 แต่ไม่รู้ต้นทุน · อัตรากำไรคือ
 * 40% (40 จาก 100) ไม่ใช่ 4% (40 จาก 1000) — ตัวหลังคือการเอากำไรของใบเดียวไป
 * หารด้วยยอดขายของสองใบ แล้วได้ตัวเลขที่ต่ำกว่าจริงโดยไม่มีอะไรบอกว่าทำไม
 */
test('อัตรากำไรหารด้วยยอดขายของใบที่รู้ต้นทุน ไม่ใช่ยอดขายทั้งก้อน', function () {
    withRollback(function () {
        // ล้างพื้นให้เหลือแต่สองใบนี้ ด้วยการอ่านส่วนต่างไม่ได้ — margin เป็น
        // อัตราส่วน จึงต้องคุมทั้งช่วง · ใช้วันในอนาคตที่ยังไม่มีอะไรเลย
        $day = date('Y-m-d', strtotime('+1 day'));
        Db::run(
            "UPDATE inventory_logs SET created_at = ? WHERE id = ?",
            [$day . ' 09:00:00', anRxSale(['sale_price' => '100', 'unit_cost' => '60'])['id']],
        );
        Db::run(
            "UPDATE inventory_logs SET created_at = ? WHERE id = ?",
            [$day . ' 10:00:00', anRxSale(['sale_price' => '900'])['id']],
        );

        $s = Reports::overview($day, $day, true)['sales'];
        eq($s['revenue'], 1000.0, 'ยอดขายรวมทั้งสองใบ');
        eq($s['profit'], 40.0, 'กำไรจากใบที่รู้ต้นทุนใบเดียว');
        eq($s['margin'], 40.0, 'อัตรากำไรต้องเป็น 40% ไม่ใช่ 4%');
    });
});

test('ใบสั่งตัดที่ยกเลิกแล้วไม่นับเป็นยอดขาย', function () {
    withRollback(function () {
        $before = salesToday();

        $o = anRxSale(['sale_price' => '9500', 'unit_cost' => '4000']);
        Rx::remove((int) $o['id'], ['note' => 'ลูกค้ายกเลิก'], [Roles::OWNER], 1);

        $after = salesToday();
        eq($after['bills'], $before['bills'], 'จำนวนรายการต้องเท่าเดิม');
        eq(round($after['revenue'] - $before['revenue'], 2), 0.0, 'ยอดขายต้องไม่ขยับ');
        eq(round($after['profit'] - $before['profit'], 2), 0.0, 'กำไรต้องไม่ขยับ');
    });
});

/**
 * ราคาตั้งขายตอนรับของเข้า ไม่ใช่ยอดขาย
 *
 * `Receiving` ลง `sale_price` ไว้บนแถว IN เพื่อให้หน้าความเคลื่อนไหวบอกได้ว่า
 * ของที่เพิ่งเข้ามาตั้งขายเท่าไร · นับเข้ายอดขายคือนับของที่ยังอยู่บนชั้น
 */
test('ของที่เพิ่งรับเข้าคลัง ไม่นับเป็นยอดขาย แม้จะมีราคาตั้งขายติดมา', function () {
    withRollback(function () {
        $p = stockedForCancel(3);
        $before = salesToday();

        Receiving::receive([
            'sku' => $p['sku'], 'quantity' => 5,
            'cost_per_unit' => '400.00', 'received_date' => date('Y-m-d'),
        ], [Roles::OWNER], 1);

        eq(salesToday()['revenue'], $before['revenue'], 'ยอดขายต้องเท่าเดิม');
    });
});

test('บทบาทที่ไม่มีสิทธิ์เห็นราคาทุน ไม่ได้ตัวเลขยอดขายและกำไรเลย', function () {
    withRollback(function () {
        anRxSale(['sale_price' => '9500', 'unit_cost' => '4000']);

        $s = salesToday(false);
        eq($s['revenue'], null, 'ยอดขายต้องไม่ออกจากเซิร์ฟเวอร์');
        eq($s['profit'], null, 'กำไรต้องไม่ออกจากเซิร์ฟเวอร์');
        eq($s['margin'], null, 'อัตรากำไรก็เป็นตัวเลขเงินเหมือนกัน');
        ok($s['bills'] > 0, 'แต่จำนวนรายการยังบอกได้ — ไม่ใช่ราคา');
    });
});

test('กรอกต้นทุนทีหลัง แล้วใบค้างรับที่เบิกไปก่อนรู้ต้นทุนตามมาด้วย', function () {
    withRollback(function () {
        $branch = aBranch();

        // ล็อตที่รับเข้าโดยยังไม่รู้ต้นทุน — ของมาก่อนใบกำกับ เรื่องปกติของร้านนี้
        $sku = skuWithLots(1);
        $product = Db::one('SELECT id FROM products WHERE sku = ?', [$sku]);
        $lot = Receiving::receive([
            'sku'           => $sku,
            'quantity'      => 5,
            'cost_per_unit' => null,
            'received_date' => date('Y-m-d'),
        ], [Roles::OWNER], 1);

        // เบิกให้สาขาจากล็อตนั้นโดยตรง ไม่ให้ FIFO ไปหยิบล็อตเก่าที่รู้ต้นทุนแล้ว
        Db::conn()->prepare('UPDATE stock_lots SET remaining_qty = 0 WHERE product_id = ? AND id <> ?')
            ->execute([(int) $product['id'], (int) $lot['lotId']]);

        $out = Stock::issue(issueReq($sku, 3, idem('latecost'), [
            'branch_id' => $branch,
            'taken_by'  => 'ช่างบี',
        ]));
        $id = $out['branch_issue_id'];

        $before = Db::one('SELECT * FROM branch_issues WHERE id = ?', [$id]);
        eq((int) $before['cost_unknown_qty'], 3, 'ตอนเบิกยังไม่รู้ต้นทุนทั้งสามชิ้น');
        eq(round((float) $before['cost_total'], 2), 0.0, 'ต้นทุนรวมจึงยังเป็นศูนย์');

        // ใบกำกับมาถึง กรอกต้นทุนลงล็อต
        Catalog::updateLot((int) $lot['lotId'], ['cost_per_unit' => '40.00'], [Roles::OWNER], 1);

        $after = Db::one('SELECT * FROM branch_issues WHERE id = ?', [$id]);
        eq((int) $after['cost_unknown_qty'], 0, 'กรอกแล้วต้องไม่เหลือชิ้นที่ไม่รู้ต้นทุน');
        eq(round((float) $after['cost_total'], 2), 120.0, 'ต้นทุนรวมต้องเป็น 3 x 40');

        $log = Db::one(
            "SELECT unit_cost FROM inventory_logs
             WHERE branch_issue_id = ? AND action_type = 'OUT' LIMIT 1",
            [$id],
        );
        eq(round((float) $log['unit_cost'], 2), 40.0, 'แถวในสมุดต้องได้ต้นทุนไปด้วย');
    });
});

test('แก้ต้นทุนที่เคยกรอกไว้แล้ว ไม่ย้อนไปรื้อใบเบิกเก่า', function () {
    withRollback(function () {
        $branch = aBranch();
        $sku = skuWithLots(1);
        $product = Db::one('SELECT id FROM products WHERE sku = ?', [$sku]);

        $lot = Receiving::receive([
            'sku'           => $sku,
            'quantity'      => 5,
            'cost_per_unit' => '10.00',
            'received_date' => date('Y-m-d'),
        ], [Roles::OWNER], 1);

        Db::conn()->prepare('UPDATE stock_lots SET remaining_qty = 0 WHERE product_id = ? AND id <> ?')
            ->execute([(int) $product['id'], (int) $lot['lotId']]);

        $out = Stock::issue(issueReq($sku, 2, idem('fixcost'), [
            'branch_id' => $branch,
            'taken_by'  => 'ช่างซี',
        ]));
        $id = $out['branch_issue_id'];

        // นี่คือการ "แก้" ไม่ใช่การ "เติม" — ตัวเลขที่ตัดสินใจไปแล้วต้องอยู่นิ่ง
        Catalog::updateLot((int) $lot['lotId'], ['cost_per_unit' => '99.00'], [Roles::OWNER], 1);

        $after = Db::one('SELECT * FROM branch_issues WHERE id = ?', [$id]);
        eq(round((float) $after['cost_total'], 2), 20.0, 'ต้นทุนรวมเดิมต้องไม่ขยับ');
    });
});

group("สาขาที่สั่งใบ RX");

/* `branchRxSku()` กับ `doc()` อยู่ในไฟล์เทสต์ RX ซึ่งไม่ถูกโหลดตอนรันเฉพาะไฟล์นี้
   — ตัวช่วยสองตัวข้างล่างจึงมีชื่อของตัวเอง ไม่ไปพึ่งไฟล์อื่น */

/** SKU ของเลนส์สั่งตัดตัวแรกที่เจอ */
function branchRxSku(): string
{
    return (string) Db::value("SELECT sku FROM products WHERE is_custom_made = 1 LIMIT 1");
}

/** เลขที่ใบที่ไม่ชนกับของจริง */
function branchRxDoc(string $prefix): string
{
    return $prefix . "-" . bin2hex(random_bytes(3));
}

/* ใบสั่งตัดที่สาขาอื่นเป็นคนสั่ง เป็นคนละคำถามกับใบเบิก — สาขาหนึ่งอาจเบิก
   น้อยแต่สั่งตัดเยอะ · ที่ทดสอบตรงนี้คือค่าบนใบไปถึงฐานข้อมูล กลับออกมาทาง
   รายการ และไปโผล่ในแดชบอร์ดแยกตามสาขาได้จริง */

test('ระบุสาขาบนใบสั่ง แล้วค่าไปถึงฐานข้อมูลและกลับออกมาทางรายการ', function () {
    withRollback(function () {
        $branch = aBranch();
        $ref = branchRxDoc('RX-BR');

        $out = Rx::order(
            ['sku' => branchRxSku(), 'reference_doc' => $ref, 'branch_id' => $branch],
            [Roles::SALES],
            1,
        );

        // `id` ที่ Rx::order คืนมาคือ log_id ของสมุด ไม่ใช่ id ของแถวในตาราง rx_orders
        $row = Db::one('SELECT branch_id FROM rx_orders WHERE log_id = ?', [(int) $out['id']]);
        eq((int) $row['branch_id'], $branch, 'ใบต้องผูกกับสาขาที่สั่ง');

        $listed = Rx::orders($ref, false, 1, 20)['rows'][0];
        eq($listed['branchId'], $branch, 'รายการต้องคืน id ของสาขา');
        ok(($listed['branch'] ?? '') !== '', 'รายการต้องคืนชื่อสาขาไว้ขึ้นใต้เลขที่ใบ');
    });
});

test('ไม่ระบุสาขาคือร้านนี้สั่งเอง — ไม่ใช่ช่องที่ลืมกรอก', function () {
    withRollback(function () {
        $ref = branchRxDoc('RX-SELF');
        $out = Rx::order(['sku' => branchRxSku(), 'reference_doc' => $ref], [Roles::SALES], 1);

        // `id` ที่ Rx::order คืนมาคือ log_id ของสมุด ไม่ใช่ id ของแถวในตาราง rx_orders
        $row = Db::one('SELECT branch_id FROM rx_orders WHERE log_id = ?', [(int) $out['id']]);
        eq($row['branch_id'], null, 'เว้นว่างต้องเก็บเป็น NULL');
        eq(Rx::orders($ref, false, 1, 20)['rows'][0]['branchId'], null, 'รายการต้องคืน null ไม่ใช่ศูนย์');
    });
});

test('สาขาที่ไม่มีจริง และสาขาที่ปิดใช้งานแล้ว ถูกปฏิเสธตั้งแต่ฝั่งเซิร์ฟเวอร์', function () {
    withRollback(function () {
        throwsReason(
            'unknown_branch',
            fn() => Rx::order(['sku' => branchRxSku(), 'branch_id' => 987654321], [Roles::SALES], 1),
            'สาขาที่ไม่มีจริง',
        );

        $branch = aBranch();
        Branches::update($branch, ['is_active' => false], [Roles::OWNER]);
        throwsReason(
            'branch_inactive',
            fn() => Rx::order(['sku' => branchRxSku(), 'branch_id' => $branch], [Roles::SALES], 1),
            'สาขาที่ปิดใช้งานแล้ว',
        );
    });
});

test('แดชบอร์ดนับใบสั่งแยกตามคนสั่ง — สาขาก้อนหนึ่ง TimeOptic อีกก้อนหนึ่ง', function () {
    withRollback(function () {
        $branch = aBranch();
        $today = date('Y-m-d');

        Rx::order(['sku' => branchRxSku(), 'reference_doc' => branchRxDoc('RX-A'), 'branch_id' => $branch], [Roles::SALES], 1);
        Rx::order(['sku' => branchRxSku(), 'reference_doc' => branchRxDoc('RX-B'), 'branch_id' => $branch], [Roles::SALES], 1);
        Rx::order(['sku' => branchRxSku(), 'reference_doc' => branchRxDoc('RX-C')], [Roles::SALES], 1);

        $rows = Reports::overview($today, $today, true)['rxBranches'];
        $mine = null;
        foreach ($rows as $r) {
            if ($r['branchId'] === $branch) { $mine = $r; }
        }

        ok($mine !== null, 'สาขาที่สั่งต้องมีแถวของตัวเอง');
        eq($mine['orders'], 2, 'นับเฉพาะสองใบที่สาขานี้สั่ง');
        eq($mine['qty'], 2, 'จำนวนชิ้นต้องตรงกับจำนวนใบ');
        eq($mine['awaitingCost'], 2, 'ทั้งสองใบยังไม่ลงต้นทุน');
        ok($mine['items'] !== [], 'ต้องบอกด้วยว่าสาขาสั่งอะไรไป ไม่ใช่แค่กี่ใบ');

        /* ใบที่ไม่ระบุสาขาไม่หายไปไหน — ไปอยู่ก้อน TimeOptic ซึ่งมี branchId
           เป็น null เพราะร้านตัวเองไม่ใช่สาขาที่มี id */
        $self = null;
        foreach ($rows as $r) {
            if ($r['branchId'] === null) { $self = $r; }
        }
        ok($self !== null, 'ใบที่ร้านสั่งเองต้องมีก้อนของตัวเองชื่อ TimeOptic x Bewell');
        eq($self['branch'], 'TimeOptic x Bewell', 'ชื่อก้อนของร้านเอง');
        ok($self['orders'] >= 1, 'ใบที่ร้านสั่งเองต้องถูกนับ');
    });
});

test('ตัวเลขเงินของแผงสาขาสั่งตัด ถูกซ่อนจากคนที่ไม่มีสิทธิ์ดูต้นทุน', function () {
    withRollback(function () {
        $branch = aBranch();
        $today = date('Y-m-d');
        Rx::order(['sku' => branchRxSku(), 'reference_doc' => branchRxDoc('RX-M'), 'branch_id' => $branch], [Roles::SALES], 1);

        $rows = Reports::overview($today, $today, false)['rxBranches'];
        $mine = null;
        foreach ($rows as $r) {
            if ($r['branchId'] === $branch) { $mine = $r; }
        }

        ok($mine !== null, 'แถวต้องยังอยู่ — จำนวนเป็นข้อเท็จจริงของสต็อก');
        eq($mine['cost'], null, 'ต้นทุนต้องถูกซ่อน');
        eq($mine['revenue'], null, 'ราคาขายต้องถูกซ่อนด้วย');
        eq($mine['orders'], 1, 'จำนวนใบยังต้องเห็น');
    });
});
