<?php
/**
 * ยิงเส้นที่เขียนใหม่ของ api/routes/stock.php จริง ๆ แล้ว rollback ทิ้ง
 *
 * ไม่ใช่การอ่านโค้ดแล้วเดา — dispatch ผ่าน Router ตัวจริง ด้วย body หน้าตา
 * เดียวกับที่ StockForm.jsx ส่งมา ทุกอย่างอยู่ใน transaction เดียวที่ถูกถอนทิ้ง
 * ตอนจบ ฐานข้อมูลจึงกลับไปเหมือนเดิมทุกแถว
 */
declare(strict_types=1);

$root = dirname(__DIR__, 2);
chdir($root);

$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REQUEST_URI'] = '/api/health';

$config = require "$root/api/config.php";

require "$root/api/core/Http.php";
require "$root/api/core/Db.php";
require "$root/api/core/Helpers.php";
require "$root/api/core/Router.php";
require "$root/api/core/Sql.php";
require "$root/api/core/Lookups.php";
require "$root/api/core/StockModule.php";
require "$root/api/services/Booking.php";
require "$root/api/services/Telegram.php";
require "$root/api/services/StockClient.php";
require "$root/api/services/CaseStock.php";

Db::configure($config['db']);
StockModule::boot();
StockClient::configure($config['stock_api']);

require "$root/api/routes/stock.php";

$pass = 0;
$fail = 0;

function check(string $what, callable $fn): void
{
    global $pass, $fail;
    try {
        $fn();
        $pass++;
        echo "  ok   $what\n";
    } catch (Throwable $e) {
        $fail++;
        echo "  FAIL $what\n       " . get_class($e) . ': ' . $e->getMessage() . "\n";
    }
}

function expect(bool $ok, string $msg): void
{
    if (!$ok) {
        throw new RuntimeException($msg);
    }
}

/** ผู้ใช้จริงจากตาราง admins ที่ถือบทบาทที่ขอ (บทบาทอยู่ที่ `admin_roles`) */
function actorWithRole(string $role): array
{
    $r = Db::get(
        'SELECT a.id, a.username, a.display_name, a.job_title, a.employee_id
           FROM admins a JOIN admin_roles r ON r.admin_id = a.id
          WHERE r.role = ? AND a.is_active = 1 LIMIT 1',
        $role,
    );
    if (!$r) {
        throw new RuntimeException("ไม่มีบัญชี role=$role ในฐานข้อมูล");
    }
    $roles = \Optic\Auth::rolesOf((int) $r['id']);
    return [
        'id'          => (int) $r['id'],
        'username'    => $r['username'],
        'displayName' => $r['display_name'],
        'jobTitle'    => $r['job_title'],
        'roles'       => $roles,
        'roleNames'   => \Optic\Roles::namesOf($roles),
        'roleText'    => \Optic\Roles::text($roles),
        'perms'       => \Optic\Roles::permsOf($roles),
        'home'        => \Optic\Roles::home($roles),
        'employeeId'  => $r['employee_id'] === null ? null : (int) $r['employee_id'],
        'mustChangePassword' => false,
    ];
}

$owner = actorWithRole('owner');
$staff = actorWithRole('sales');

$pdo = Db::pdo();
$pdo->beginTransaction();

try {
    echo "\nPOST /api/stock — รับของเข้าใหม่\n";

    $lotId = null;
    $sku = 'CHK-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));

    check('สร้างสินค้าใหม่พร้อมล็อตแรก', function () use ($owner, $sku, &$lotId) {
        $res = \Optic\Auth::as($owner, fn() => Router::dispatch('POST', '/api/stock', [], [
            'sku' => $sku,
            'product_type' => 'Frame',
            'product_name' => 'ตรวจสอบ กรอบทดสอบ',
            'brand' => 'CheckBrand',
            'product_price' => 1990,
            'product_expense' => 700,
            'amount' => 3,
            'color' => 'ดำ',
            'size' => '52-18-140',
        ]));
        expect(($res['ok'] ?? false) === true, 'ไม่ได้ ok');
        expect(($res['count'] ?? 0) === 3, 'count ไม่ใช่ 3');
        $lotId = (int) $res['ids'][0];
        expect($lotId > 0, 'ไม่ได้ lot id');
    });

    check('ล็อตใหม่ลงสมุดครบ และยอดตรงกับสมุด', function () use (&$lotId) {
        $lot = Db::get('SELECT * FROM stock_lots WHERE id = ?', $lotId);
        expect($lot !== null, 'ไม่พบล็อต');
        expect((int) $lot['initial_qty'] === 3, 'initial_qty ไม่ใช่ 3');
        $sum = (int) Db::get('SELECT COALESCE(SUM(quantity),0) n FROM inventory_logs WHERE lot_id = ?', $lotId)['n'];
        expect($sum === (int) $lot['remaining_qty'], "สมุดรวม $sum แต่คงเหลือ {$lot['remaining_qty']}");
    });

    check('ค่าสายตาบนสินค้าไม่ถูกลบเมื่อแก้ล็อต (บั๊กเดิม)', function () use (&$lotId, $owner) {
        $lot = Db::get('SELECT product_id FROM stock_lots WHERE id = ?', $lotId);
        Db::run(
            "UPDATE products SET attributes = ? WHERE id = ?",
            json_encode(['sph' => '-2.25', 'cyl' => '-0.50', 'color' => 'ดำ'], JSON_UNESCAPED_UNICODE),
            (int) $lot['product_id']
        );
        \Optic\Auth::as($owner, fn() => Router::dispatch('PUT', "/api/stock/$lotId", [], [
            'product_type' => 'Frame',
            'product_name' => 'ตรวจสอบ กรอบทดสอบ',
            'brand' => 'CheckBrand',
            'product_price' => 1990,
            'color' => 'น้ำเงิน',
        ]));
        $attrs = json_decode((string) Db::get('SELECT attributes FROM products WHERE id = ?', (int) $lot['product_id'])['attributes'], true);
        expect(($attrs['sph'] ?? null) === '-2.25', 'sph หายไป: ' . json_encode($attrs, JSON_UNESCAPED_UNICODE));
        expect(($attrs['cyl'] ?? null) === '-0.50', 'cyl หายไป');
        expect(($attrs['color'] ?? null) === 'น้ำเงิน', 'สีไม่ถูกอัปเดต');
    });

    check('ลบหนึ่งชิ้นจากล็อตที่มีของ = ปรับยอด มีแถวในสมุด', function () use (&$lotId, $owner) {
        $before = (int) Db::get('SELECT remaining_qty FROM stock_lots WHERE id = ?', $lotId)['remaining_qty'];
        $initialBefore = (int) Db::get('SELECT initial_qty FROM stock_lots WHERE id = ?', $lotId)['initial_qty'];
        \Optic\Auth::as($owner, fn() => Router::dispatch('DELETE', "/api/stock/$lotId", [], []));
        $lot = Db::get('SELECT * FROM stock_lots WHERE id = ?', $lotId);
        expect((int) $lot['remaining_qty'] === $before - 1, 'คงเหลือไม่ลด 1');
        expect((int) $lot['initial_qty'] === $initialBefore, 'initial_qty ถูกแก้ ซึ่งห้ามแก้');
        $sum = (int) Db::get('SELECT COALESCE(SUM(quantity),0) n FROM inventory_logs WHERE lot_id = ?', $lotId)['n'];
        expect($sum === (int) $lot['remaining_qty'], "สมุดรวม $sum แต่คงเหลือ {$lot['remaining_qty']}");
    });

    check('ล็อตชิ้นเดียวที่ยังไม่มีใครแตะ ลบได้ ไม่ติด FK', function () use ($owner, $sku) {
        $res = \Optic\Auth::as($owner, fn() => Router::dispatch('POST', '/api/stock', [], [
            'sku' => $sku,
            'amount' => 1,
            'product_expense' => 500,
        ]));
        $one = (int) $res['ids'][0];
        \Optic\Auth::as($owner, fn() => Router::dispatch('DELETE', "/api/stock/$one", [], []));
        expect(Db::get('SELECT id FROM stock_lots WHERE id = ?', $one) === null, 'ล็อตยังอยู่');
        expect(Db::get('SELECT id FROM inventory_logs WHERE lot_id = ?', $one) === null, 'แถวในสมุดยังค้าง');
    });

    check('ไม่กรอกต้นทุน = รอใบกำกับ ไม่ใช่ต้นทุน 0 (ของฟรี)', function () use ($owner, $sku) {
        $res = \Optic\Auth::as($owner, fn() => Router::dispatch('POST', '/api/stock', [], [
            'sku' => $sku,
            'amount' => 2,
            'product_expense' => '',
        ]));
        $lot = Db::get('SELECT cost_per_unit, notes FROM stock_lots WHERE id = ?', (int) $res['ids'][0]);
        expect($lot['cost_per_unit'] === null, 'ต้นทุนเป็น ' . var_export($lot['cost_per_unit'], true) . ' ควรเป็น null');
    });

    check('ไม่กรอกราคาขาย = ยังไม่ตั้งราคา ไม่ใช่ขาย 0 บาท', function () use ($owner) {
        $s2 = 'CHK2-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
        \Optic\Auth::as($owner, fn() => Router::dispatch('POST', '/api/stock', [], [
            'sku' => $s2,
            'product_type' => 'Frame',
            'product_name' => 'ตรวจสอบ ยังไม่ตั้งราคา',
            'amount' => 1,
        ]));
        $p = Db::get('SELECT base_selling_price FROM products WHERE sku = ?', $s2);
        expect($p !== null, 'ไม่พบสินค้าที่เพิ่งสร้าง');
        expect((float) $p['base_selling_price'] === 0.0, 'ราคาควรเป็น 0.00 = ยังไม่ตั้งราคา');
    });

    echo "\nสิทธิ์\n";

    check('พนักงานหน้าร้านรับของเข้า SKU เดิมได้ ถ้าไม่กรอกต้นทุน', function () use ($staff, $sku) {
        $res = \Optic\Auth::as($staff, fn() => Router::dispatch('POST', '/api/stock', [], [
            'sku' => $sku,
            'amount' => 1,
        ]));
        expect(($res['ok'] ?? false) === true, 'รับของไม่สำเร็จ');
    });

    check('พนักงานหน้าร้านกรอกต้นทุนไม่ได้ (403)', function () use ($staff, $sku) {
        try {
            \Optic\Auth::as($staff, fn() => Router::dispatch('POST', '/api/stock', [], [
                'sku' => $sku,
                'amount' => 1,
                'product_expense' => 900,
            ]));
            throw new RuntimeException('ไม่ถูกปฏิเสธ — staff กรอกต้นทุนได้');
        } catch (\Optic\ApiError $e) {
            expect($e->status === 403, "ได้ {$e->status} {$e->reason} แทน 403");
        }
    });

    check('พนักงานหน้าร้านสร้างสินค้าใหม่ไม่ได้ (403)', function () use ($staff) {
        try {
            \Optic\Auth::as($staff, fn() => Router::dispatch('POST', '/api/stock', [], [
                'sku' => 'CHK-STAFF-' . random_int(1000, 9999),
                'product_type' => 'Frame',
                'product_name' => 'พนักงานลองสร้าง',
                'amount' => 1,
            ]));
            throw new RuntimeException('ไม่ถูกปฏิเสธ — staff สร้างสินค้าใหม่ได้');
        } catch (\Optic\ApiError $e) {
            expect($e->status === 403, "ได้ {$e->status} {$e->reason} แทน 403");
        }
    });

    check('ไม่ได้ล็อกอิน = 401 ไม่ใช่ 500', function () {
        try {
            \Optic\Auth::as(null, fn() => Router::dispatch('POST', '/api/stock', [], ['amount' => 1]));
            throw new RuntimeException('ไม่ถูกปฏิเสธ');
        } catch (HttpError $e) {
            expect($e->status === 401, "ได้ {$e->status} แทน 401");
        }
    });

    echo "\nCaseStock — ตัดสต็อกตอนขาย (เรียกในโปรเซสเดียวกัน)\n";

    check('StockClient ตัดสต็อกได้จริง และคืนของได้', function () use ($owner, $sku) {
        $key = 'chk-' . bin2hex(random_bytes(6));
        $before = (int) Db::get(
            'SELECT COALESCE(SUM(l.remaining_qty),0) n FROM stock_lots l JOIN products p ON p.id=l.product_id WHERE p.sku = ?',
            $sku
        )['n'];

        $res = \Optic\Auth::as($owner, fn() => StockClient::post('/stock/issue', [
            'source' => 'frontdesk',
            'idem_key' => $key,
            'sku' => $sku,
            'quantity' => 1,
            'reference_doc' => 'CHK-CASE',
            'note' => 'ตรวจสอบระบบ',
        ]));
        expect(!empty($res), 'ไม่มีคำตอบกลับมา');

        $after = (int) Db::get(
            'SELECT COALESCE(SUM(l.remaining_qty),0) n FROM stock_lots l JOIN products p ON p.id=l.product_id WHERE p.sku = ?',
            $sku
        )['n'];
        expect($after === $before - 1, "คงเหลือ $before -> $after ควรลด 1");

        \Optic\Auth::as($owner, fn() => StockClient::post('/stock/return', [
            'source' => 'frontdesk',
            'idem_key' => 'rev-' . $key,
            'reverses_key' => $key,
            'note' => 'ตรวจสอบ คืนของ',
        ]));
        $back = (int) Db::get(
            'SELECT COALESCE(SUM(l.remaining_qty),0) n FROM stock_lots l JOIN products p ON p.id=l.product_id WHERE p.sku = ?',
            $sku
        )['n'];
        expect($back === $before, "คืนแล้วควรกลับเป็น $before แต่ได้ $back");
    });

    check('ยิงซ้ำด้วย idem_key เดิม ไม่ตัดสองรอบ', function () use ($owner, $sku) {
        $key = 'chk-dup-' . bin2hex(random_bytes(6));
        $body = ['source' => 'frontdesk', 'idem_key' => $key, 'sku' => $sku, 'quantity' => 1];
        \Optic\Auth::as($owner, fn() => StockClient::post('/stock/issue', $body));
        $mid = (int) Db::get('SELECT COALESCE(SUM(l.remaining_qty),0) n FROM stock_lots l JOIN products p ON p.id=l.product_id WHERE p.sku = ?', $sku)['n'];
        \Optic\Auth::as($owner, fn() => StockClient::post('/stock/issue', $body));
        $end = (int) Db::get('SELECT COALESCE(SUM(l.remaining_qty),0) n FROM stock_lots l JOIN products p ON p.id=l.product_id WHERE p.sku = ?', $sku)['n'];
        expect($mid === $end, "ยิงซ้ำแล้วลดอีก: $mid -> $end");
    });

    check('สินค้าสั่งตัดตอบ custom_made ให้ไปเปิดใบสั่ง', function () use ($owner) {
        $rx = Db::get('SELECT sku FROM products WHERE is_custom_made = 1 LIMIT 1');
        if (!$rx) {
            throw new RuntimeException('ไม่มีสินค้าสั่งตัดในฐานข้อมูลให้ทดสอบ');
        }
        try {
            \Optic\Auth::as($owner, fn() => StockClient::post('/stock/issue', [
                'source' => 'frontdesk',
                'idem_key' => 'chk-rx-' . bin2hex(random_bytes(6)),
                'sku' => $rx['sku'],
                'quantity' => 1,
            ]));
            throw new RuntimeException('ไม่ถูกปฏิเสธ');
        } catch (StockApiError $e) {
            expect($e->reason === 'custom_made', "reason = {$e->reason} ควรเป็น custom_made");
        }
    });

    echo "\nต้นทุนต้องไม่หลุดถึงพนักงานหน้าร้าน\n";

    /** ทุกค่าที่เป็นต้นทุนในคำตอบ ไม่ว่าซ้อนลึกแค่ไหน */
    $costLeaks = function (mixed $v, string $path = '') use (&$costLeaks): array {
        if (!is_array($v)) {
            return [];
        }
        $out = [];
        foreach ($v as $k => $x) {
            $at = $path . '/' . $k;
            if (is_string($k) && in_array($k, ['product_expense', 'cost_per_unit', 'unit_cost', 'unitCost', 'total_cost', 'totalCost'], true)) {
                if ($x !== null) {
                    $out[] = "$at=" . json_encode($x, JSON_UNESCAPED_UNICODE);
                }
                continue;
            }
            $out = array_merge($out, $costLeaks($x, $at));
        }
        return $out;
    };

    check('staff ตัดสต็อกได้ แต่คำตอบที่ออกจาก API ไม่มีต้นทุน', function () use ($staff, $sku, $costLeaks) {
        $res = \Optic\Auth::as($staff, fn() => StockClient::post('/stock/issue', [
            'source' => 'frontdesk',
            'idem_key' => 'chk-staff-' . bin2hex(random_bytes(6)),
            'sku' => $sku,
            'quantity' => 1,
        ]));
        /* ตัวบริการยังคืนต้นทุนมาให้ CaseStock บันทึกลง case_stock_issues ได้ครบ
           สิ่งที่ห้ามหลุดคือคำตอบที่ index.php ส่งออกไปหาเบราว์เซอร์ */
        $sent = StockModule::redactCost($res, $staff);
        $leaks = $costLeaks($sent);
        expect($leaks === [], 'ต้นทุนหลุด: ' . implode(', ', $leaks));
    });

    check('เจ้าของร้านยังเห็นต้นทุนตามเดิม', function () use ($owner, $costLeaks) {
        /* SKU ใหม่ล้วน — FIFO ตัดล็อตเก่าสุดก่อน ถ้าใช้ SKU เดิมจะไปโดนล็อตที่
           เทสต์ก่อนหน้าตั้งใจไม่ใส่ต้นทุน แล้วอ่านผลผิดว่าโดนตัดสิทธิ์ */
        $sku = 'CHK3-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
        \Optic\Auth::as($owner, fn() => Router::dispatch('POST', '/api/stock', [], [
            'sku' => $sku,
            'product_type' => 'Frame',
            'product_name' => 'ตรวจสอบ ต้นทุนของเจ้าของร้าน',
            'amount' => 2,
            'product_expense' => 700,
        ]));
        $res = \Optic\Auth::as($owner, fn() => StockClient::post('/stock/issue', [
            'source' => 'frontdesk',
            'idem_key' => 'chk-owner-' . bin2hex(random_bytes(6)),
            'sku' => $sku,
            'quantity' => 1,
        ]));
        $sent = StockModule::redactCost($res, $owner);
        expect($costLeaks($sent) !== [], 'เจ้าของร้านควรเห็นต้นทุน แต่ถูกตัดไปด้วย');
    });

    echo "\nกวาดทุกเส้น GET ที่กดได้จากหน้าเว็บ\n";

    $ids = [
        'case' => Db::get('SELECT id FROM cases ORDER BY id DESC LIMIT 1')['id'] ?? null,
        'customer' => Db::get('SELECT id FROM customers ORDER BY id DESC LIMIT 1')['id'] ?? null,
        'order' => Db::get('SELECT id FROM custom_orders ORDER BY id DESC LIMIT 1')['id'] ?? null,
        'lot' => Db::get('SELECT id FROM v_stock_lot ORDER BY id DESC LIMIT 1')['id'] ?? null,
        'booking' => Db::get('SELECT id FROM bookings ORDER BY id DESC LIMIT 1')['id'] ?? null,
        'rx' => Db::get('SELECT id FROM prescriptions ORDER BY id DESC LIMIT 1')['id'] ?? null,
    ];

    $paths = [
        ['/api/meta', []],
        ['/api/dashboard', []],
        ['/api/employees', []],
        ['/api/suppliers', []],
        ['/api/locations', []],
        ['/api/settings', []],
        ['/api/customers', ['limit' => 5]],
        ['/api/cases', ['limit' => 5]],
        ['/api/orders', ['limit' => 5]],
        ['/api/prescriptions', ['limit' => 5]],
        ['/api/bookings', []],
        ['/api/payments', ['limit' => 5]],
        ['/api/sales', ['limit' => 5]],
        ['/api/cashflow', []],
        ['/api/reports/summary', []],
        ['/api/stock', ['limit' => 5]],
        ['/api/stock', ['group' => 'product', 'limit' => 5]],
        ['/api/stock', ['group' => 'lot', 'limit' => 5]],
        ['/api/stock/names', []],
        ['/api/uploads', []],
        ['/api/workflow', []],
    ];
    foreach ([['case', '/api/cases/%d'], ['customer', '/api/customers/%d'], ['order', '/api/orders/%d'],
              ['lot', '/api/stock/%d'], ['booking', '/api/bookings/%d'], ['rx', '/api/prescriptions/%d']] as [$k, $tpl]) {
        if ($ids[$k] !== null) {
            $paths[] = [sprintf($tpl, (int) $ids[$k]), []];
        }
    }

    $broken = [];
    $leaked = [];
    foreach ($paths as [$path, $query]) {
        $label = $path . ($query ? '?' . http_build_query($query) : '');
        foreach (['owner' => $owner, 'staff' => $staff] as $who => $actor) {
            try {
                $res = \Optic\Auth::as($actor, fn() => Router::dispatch('GET', $path, $query, []));
                if ($who === 'staff') {
                    $l = $costLeaks(StockModule::redactCost($res, $actor));
                    if ($l !== []) {
                        $leaked[] = "$label -> " . implode(', ', array_slice($l, 0, 3));
                    }
                }
            } catch (HttpError $e) {
                if ($e->status >= 500) {
                    $broken[] = "$label [$who] {$e->status} {$e->getMessage()}";
                }
            } catch (Throwable $e) {
                $broken[] = "$label [$who] " . get_class($e) . ': ' . $e->getMessage();
            }
        }
    }

    check(count($paths) . ' เส้น ไม่มีเส้นไหนพัง', function () use ($broken) {
        expect($broken === [], "\n       " . implode("\n       ", $broken));
    });
    check('ไม่มีเส้นไหนส่งต้นทุนให้พนักงานหน้าร้าน', function () use ($leaked) {
        expect($leaked === [], "\n       " . implode("\n       ", $leaked));
    });
} finally {
    $pdo->rollBack();
    echo "\n(ถอน transaction แล้ว ฐานข้อมูลไม่เปลี่ยน)\n";
}

echo "\n" . str_repeat('-', 56) . "\n";
echo "ผ่าน $pass / " . ($pass + $fail) . "\n";
exit($fail === 0 ? 0 : 1);
