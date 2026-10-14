<?php

declare(strict_types=1);

/**
 * Prescription Safety Alert — ตัวคำนวณฝั่ง PHP + เกณฑ์มีเวอร์ชัน
 *
 * รันกรณีทดสอบไฟล์เดียวกับฝั่งหน้าเว็บ (fixtures/rx-safety-cases.json) — สองตัวคำนวณ
 * ต้องตอบตรงกันทุกกรณี · spec: docs/superpowers/specs/2026-10-14-rx-safety-alert-design.md
 */

require_once __DIR__ . '/../services/RxSafety.php';

group('Rx Safety — ตัวคำนวณ');

/* DDL ใน MySQL commit ทรานแซกชันเอง — สร้างตารางก่อนเข้า rollback() เสมอ */
RxSafetyStore::ensure();

$rxsFixture = json_decode((string) file_get_contents(__DIR__ . '/fixtures/rx-safety-cases.json'), true);

function rxsFill(?array $set): ?array
{
    if ($set === null) {
        return null;
    }
    $d = ['sphere' => '-1.00', 'cylinder' => '', 'axis' => '', 'add' => '', 'va' => '1.0'];
    return ['r' => array_merge($d, $set['r'] ?? []), 'l' => array_merge($d, $set['l'] ?? [])];
}

function rxsKey(array $a): string
{
    return ($a[0] ?? '-') . '|' . $a[1] . '|' . $a[2];
}

foreach ($rxsFixture['cases'] as $c) {
    test($c['name'], function () use ($c) {
        $res = RxSafety::evaluate(
            rxsFill($c['old']),
            rxsFill($c['final']),
            $c['test_for'] ?? 'Distance',
            RxSafety::mergeRules($c['rules'] ?? null)
        );
        $got  = array_map(fn($a) => rxsKey([$a['eye'], $a['field'], $a['level']]), $res['alerts']);
        $want = array_map('rxsKey', $c['expect']['alerts']);
        sort($got);
        sort($want);
        eq($got, $want, 'alerts');
        foreach ($c['expect']['deltas'] ?? [] as $path => $v) {
            [$eye, $k] = explode('.', $path);
            $row = null;
            foreach ($res['compare'][$eye]['rows'] as $r) {
                if ($r['key'] === $k) {
                    $row = $r;
                }
            }
            $d = $row['delta'] ?? null;
            ok($v === null ? $d === null : ($d !== null && abs($d - $v) < 1e-9), "delta $path — ได้ " . render($d) . ' ควรเป็น ' . render($v));
        }
        if (array_key_exists('hasOld', $c['expect'])) {
            eq($res['hasOld'], $c['expect']['hasOld'], 'hasOld');
        }
        foreach ($c['expect']['comparable'] ?? [] as $eye => $v) {
            eq($res['compare'][$eye]['comparable'], $v, "comparable $eye");
        }
    });
}

test('fingerprint ตรงกับรูปแบบของหน้าเว็บ (สตริง canonical)', function () {
    $old = rxsFill(['r' => ['sphere' => '-2.00'], 'l' => ['sphere' => '-2.00']]);
    $res = RxSafety::evaluate($old, rxsFill(['r' => ['sphere' => '-1.00', 'cylinder' => '+2.00', 'axis' => '180']]), 'Distance', RxSafety::DEFAULT_RULES);
    eq(
        $res['fingerprint'],
        '[["-2.00","0.00",null,null,"-2.00","0.00",null,null],["1.00","-2.00","90",null,"-1.00","0.00",null,null],"Distance"]',
        'canonical'
    );
});

test('eyesOf: อ่านแถวฐานข้อมูล ทั้งคอลัมน์ปกติและ old_*', function () {
    $row = ['r_sphere' => '-1.00', 'l_sphere' => '-2.00', 'old_r_sphere' => '-3.00', 'old_l_add' => '1.00'];
    eq(RxSafety::eyesOf($row)['l']['sphere'], '-2.00', 'l_sphere');
    eq(RxSafety::eyesOf($row, 'old_')['r']['sphere'], '-3.00', 'old_r_sphere');
    eq(RxSafety::eyesOf($row, 'old_')['l']['add'], '1.00', 'old_l_add');
    eq(RxSafety::eyesOf($row)['r']['cylinder'], null, 'ไม่มีคอลัมน์ = null');
});

group('Rx Safety — เกณฑ์มีเวอร์ชัน');

test('มีเวอร์ชันเริ่มต้นเสมอ', function () {
    $cur = RxSafetyStore::current();
    ok($cur['version'] >= 1, 'version ≥ 1');
    ok(isset($cur['rules']['sph']['warn']), 'มีกฎ sph');
});

test('บันทึกเกณฑ์ = เวอร์ชันใหม่ · เวอร์ชันเก่าอยู่ครบ', function () {
    rollback(function (Tx $q) {
        $before = RxSafetyStore::current();
        $rules  = $before['rules'];
        $rules['sph']['warn'] = 1.0;
        $saved = RxSafetyStore::save($rules, 'ทดสอบ', ['id' => null, 'displayName' => 'tester']);
        eq($saved['version'], $before['version'] + 1, 'เวอร์ชันเพิ่ม');
        eq(RxSafetyStore::current()['rules']['sph']['warn'], 1.0, 'ค่าใหม่');
        $old = $q->get('SELECT rules FROM rx_alert_rule_versions WHERE version = ?', $before['version']);
        eq(json_decode($old['rules'], true)['sph']['warn'], $before['rules']['sph']['warn'], 'เวอร์ชันเก่าไม่ถูกแก้');
    });
});

test('เกณฑ์ผิดรูป → 422 rules_invalid', function () {
    rollback(function () {
        $rules = RxSafetyStore::current()['rules'];
        foreach ([
            ['sph', 'critical', 0.5],   // critical ≤ warn
            ['cyl', 'warn', -1],        // ติดลบ
            ['se', 'warn', 'abc'],      // ไม่ใช่ตัวเลข
        ] as [$k, $f, $v]) {
            $bad = $rules;
            $bad[$k][$f] = $v;
            $status = null;
            $reason = null;
            try {
                RxSafetyStore::save($bad, null, null);
            } catch (HttpError $e) {
                $status = $e->status;
                $reason = $e->payload['reason'] ?? null;
            }
            eq([$status, $reason], [422, 'rules_invalid'], "$k.$f = " . render($v));
        }
    });
});
