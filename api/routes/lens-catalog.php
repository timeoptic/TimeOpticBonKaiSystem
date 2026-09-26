<?php

declare(strict_types=1);

require_once __DIR__ . '/../services/LensRequisition.php';
require_once __DIR__ . '/../services/LensUsage.php';

/**
 * Bewell: รายการเลนส์ (Lens Catalog) และรายการใช้เลนส์ (Lens Usage)
 *
 * รายการเลนส์ = ตัวเลือกตอนขาย ไม่ใช่คลัง (ไม่มีจำนวน) · ทุกคนอ่านได้ แก้ได้เฉพาะ system.zone
 * ไม่มีการลบ มีแต่ปิดใช้งาน — ใบที่ขายไปแล้วคัดลอกค่าไว้เอง แต่ lens_catalog_id ยังชี้กลับมาได้
 */

function lensCatalogAdmin(): ?int
{
    $actor = StockModule::actor();
    if (!$actor || !\Optic\Roles::systemZone($actor['roles'] ?? [])) {
        throw new HttpError(403, 'แก้รายการเลนส์ได้เฉพาะแอดมิน เจ้าของร้าน หรือผู้ดูแลระบบ', ['reason' => 'forbidden']);
    }
    return LensRequisition::actorEmployee();
}

function lensSeeCost(): bool
{
    $actor = StockModule::actor();
    return $actor !== null && \Optic\Roles::seeCost($actor['roles'] ?? []);
}

/** body → ค่าที่เขียนได้ · ตรวจครบก่อนแตะฐาน */
function lensCatalogClean(array $b): array
{
    $text = static fn(string $k, int $max) => mb_substr(trim((string) ($b[$k] ?? '')), 0, $max);
    $code = strtoupper($text('code', 40));
    $name = $text('lens_name', 160);
    $type = $text('lens_type', 60);
    if ($code === '' || $name === '' || $type === '') {
        bad('กรอก รหัส ชื่อเลนส์ และชนิดเลนส์ ให้ครบ');
    }
    if (!preg_match('/^[A-Z0-9][A-Z0-9._-]*$/', $code)) {
        bad('รหัสเลนส์ใช้ได้เฉพาะ A-Z 0-9 . _ -');
    }
    $money = static function (string $k, bool $required) use ($b): ?float {
        $v = $b[$k] ?? null;
        if ($v === null || $v === '') {
            if ($required) {
                bad('กรอกราคาขาย');
            }
            return null;
        }
        if (!is_numeric($v) || (float) $v < 0) {
            bad('ราคาต้องเป็นตัวเลขไม่ติดลบ');
        }
        return round((float) $v, 2);
    };
    return [
        'code'          => $code,
        'lens_name'     => $name,
        'lens_type'     => $type,
        'lens_index'    => $text('lens_index', 10) ?: null,
        'coating'       => $text('coating', 80) ?: null,
        'brand'         => $text('brand', 80) ?: null,
        /* ค่าสายตาของรุ่น (ถ้ามี) — ไว้กรองในหน้าขาย ว่าง = ใช้ได้ทุกค่า */
        'sph'           => $text('sph', 10) ?: null,
        'cyl'           => $text('cyl', 10) ?: null,
        'add_power'     => $text('add_power', 10) ?: null,
        'cost_price'    => $money('cost_price', false),
        'selling_price' => $money('selling_price', true),
        'sort_order'    => (int) ($b['sort_order'] ?? 0),
    ];
}

function lensCatalogRow(array $r, bool $seeCost): array
{
    $r['id']            = (int) $r['id'];
    $r['active']        = (bool) $r['active'];
    $r['sort_order']    = (int) $r['sort_order'];
    $r['selling_price'] = (float) $r['selling_price'];
    $r['cost_price']    = $seeCost && $r['cost_price'] !== null ? (float) $r['cost_price'] : null;
    return $r;
}

/** ?active=1 = เฉพาะที่เปิดใช้ (หน้าขาย) · ไม่ส่ง = ทั้งหมด (หน้าจัดการ) */
GET('/api/lens-catalog', function (array $req) {
    $where = [];
    $args  = [];
    if ((string) ($req['query']['active'] ?? '') === '1') {
        $where[] = 'active = 1';
    }
    $term = trim((string) ($req['query']['q'] ?? ''));
    if ($term !== '') {
        foreach (preg_split('/\s+/', $term) as $w) {
            $where[] = "CONCAT_WS(' ', code, lens_name, lens_type, lens_index, coating, brand) LIKE ?";
            $args[]  = "%$w%";
        }
    }
    $rows = Db::all(
        'SELECT * FROM lens_catalog' . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
            . ' ORDER BY active DESC, sort_order, lens_name',
        ...$args
    );
    $see = lensSeeCost();
    return array_map(static fn(array $r) => lensCatalogRow($r, $see), $rows);
});

POST('/api/lens-catalog', function (array $req) {
    $emp = lensCatalogAdmin();
    $v   = lensCatalogClean($req['body']);
    if (Db::get('SELECT id FROM lens_catalog WHERE code = ?', $v['code'])) {
        bad('รหัสเลนส์นี้มีอยู่แล้ว');
    }
    $id = (int) Db::run(
        'INSERT INTO lens_catalog (code, lens_name, lens_type, lens_index, coating, brand, sph, cyl, add_power,
           cost_price, selling_price, sort_order, created_by, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ...[...array_values($v), $emp, $emp]
    )['insertId'];
    return lensCatalogRow(Db::get('SELECT * FROM lens_catalog WHERE id = ?', $id), lensSeeCost());
});

PUT('/api/lens-catalog/:id', function (array $req) {
    $emp = lensCatalogAdmin();
    $id  = int_or($req['params']['id']);
    $old = Db::get('SELECT * FROM lens_catalog WHERE id = ?', $id);
    if (!$old) {
        missing('ไม่พบเลนส์นี้');
    }
    $v = lensCatalogClean($req['body']);
    /* คนที่ไม่เห็นต้นทุนส่งช่องนี้มาเป็นว่างเสมอ — อย่าให้การแก้ชื่อลบต้นทุนทิ้ง */
    if (!lensSeeCost()) {
        $v['cost_price'] = $old['cost_price'];
    }
    if (Db::get('SELECT id FROM lens_catalog WHERE code = ? AND id <> ?', $v['code'], $id)) {
        bad('รหัสเลนส์นี้มีอยู่แล้ว');
    }
    Db::run(
        'UPDATE lens_catalog SET code = ?, lens_name = ?, lens_type = ?, lens_index = ?, coating = ?, brand = ?,
           sph = ?, cyl = ?, add_power = ?, cost_price = ?, selling_price = ?, sort_order = ?, updated_by = ? WHERE id = ?',
        ...[...array_values($v), $emp, $id]
    );
    return lensCatalogRow(Db::get('SELECT * FROM lens_catalog WHERE id = ?', $id), lensSeeCost());
});

/** เปิด/ปิดใช้งาน — ปิดแล้วหน้าขายเลือกไม่ได้ แต่ใบเก่ายังอ่านออกครบ */
POST('/api/lens-catalog/:id/active', function (array $req) {
    $emp = lensCatalogAdmin();
    $id  = int_or($req['params']['id']);
    if (!Db::get('SELECT id FROM lens_catalog WHERE id = ?', $id)) {
        missing('ไม่พบเลนส์นี้');
    }
    Db::run(
        'UPDATE lens_catalog SET active = ?, updated_by = ? WHERE id = ?',
        !empty($req['body']['active']) ? 1 : 0,
        $emp,
        $id
    );
    return lensCatalogRow(Db::get('SELECT * FROM lens_catalog WHERE id = ?', $id), lensSeeCost());
});

/* ---- การใช้เลนส์ (หน้าสต็อก > ความเคลื่อนไหว) ---------------------------- */

/** ?from&to&q&who&lens_type&lens_name&index&coating&status&page */
GET('/api/lens-usage', function (array $req) {
    return LensUsage::page($req['query'], lensSeeCost());
});

/** จำนวนตามตัวกรอง — การ์ด "ใช้เลนส์" ที่อยู่คู่กับการ์ดของคลัง */
GET('/api/lens-usage/count', fn(array $req) => ['count' => LensUsage::count($req['query'])]);

GET('/api/lens-usage/options', fn() => LensUsage::options());

/** ไฟล์ Excel ตามตัวกรองบนหน้าจอ — ต้นทุนเป็นช่องว่างถ้าไม่มีสิทธิ์ cost.view */
GET('/api/lens-usage/export.xlsx', function (array $req) {
    sendXlsx(
        LensUsage::workbook($req['query'], lensSeeCost())->toBytes(),
        LensUsage::fileName($req['query']),
        'lens-usage-bewell.xlsx'
    );
});
