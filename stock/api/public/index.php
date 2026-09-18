<?php

declare(strict_types=1);

/**
 * Every route the API answers.
 *
 * Handlers stay one-liners that hand off to a service or a repo. Anything with
 * real logic in it here would be logic the frontend can reach but a direct PHP
 * caller cannot — and the shop-floor system is going to be a direct caller.
 */

require_once __DIR__ . '/../src/bootstrap.php';

use Optic\ApiError;
use Optic\Auth;
use Optic\Http;
use Optic\Repo\Inventory;
use Optic\Repo\Reports;
use Optic\Roles;
use Optic\Service\Branches;
use Optic\Service\Catalog;
use Optic\Service\Receiving;
use Optic\Service\Rx;
use Optic\Service\Settlement;
use Optic\Service\StockGate;
use Optic\Service\Users;
use Optic\Telegram;

/* ------------------------------------------------------------------- auth */

Http::post('/api/auth/login', static function (): array {
    $body = Http::body();
    return ['actor' => Auth::login(
        is_string($body['username'] ?? null) ? $body['username'] : '',
        is_string($body['password'] ?? null) ? $body['password'] : '',
    )];
});

Http::post('/api/auth/logout', static function (): array {
    Auth::logout();
    return ['ok' => true];
});

Http::get('/api/auth/me', static fn(): array => ['actor' => Auth::actor()]);

/**
 * เจ้าตัวเปลี่ยนรหัสผ่านของตัวเอง
 *
 * อยู่ใต้ `/auth` ไม่ใช่ `/users` เพราะไม่ต้องมีสิทธิ์จัดการผู้ใช้ก็ทำได้ — และ
 * ต้องเรียกได้ตอนที่ธง `must_change_password` ขึ้นอยู่ ซึ่งเป็นตอนที่เส้นอื่น
 * ทั้งหมดถูกด่านปฏิเสธ (ดู `api/index.php`)
 */
Http::post('/api/auth/change-password', static function (): array {
    $actor = Auth::require();
    return ['user' => Users::changeOwnPassword($actor['id'], Http::body())];
});

/* ------------------------------------------------------------------- read */

Http::get('/api/summary', static function (): array {
    $actor = Auth::require();
    return Inventory::summary(Roles::seeCost($actor['roles']));
});

/**
 * Buying prices are a permission, not a display preference.
 *
 * Every read below takes this and leaves the cost fields empty when it is false,
 * so a shop-floor account is never sent a number it is not allowed to see —
 * whether or not any screen would have drawn it.
 */
$maySeeCost = static fn(array $actor): bool => Roles::seeCost($actor['roles']);

Http::get('/api/products', static function () use ($maySeeCost): array {
    $actor = Auth::require();
    $filter = [
        'q'           => Http::query('q'),
        'eye'         => Http::query('eye'),
        'make'        => Http::query('make'),
        'type'        => Http::query('type'),
        'index'       => Http::query('index'),
        'design'      => Http::query('design'),
        'coating'     => Http::query('coating'),
        'sph_from'    => Http::query('sph_from'),
        'sph_to'      => Http::query('sph_to'),
        'cyl_from'    => Http::query('cyl_from'),
        'cyl_to'      => Http::query('cyl_to'),
        'add_from'    => Http::query('add_from'),
        'add_to'      => Http::query('add_to'),
        'received_from' => Http::query('from'),
        'received_to'   => Http::query('to'),
        'category_id' => Http::query('cat') === null ? null : (int) Http::query('cat'),
        'state'       => Http::query('state'),
        'sort'        => Http::query('sort'),
        'dir'         => Http::query('dir'),
        'per'         => Http::query('per'),
        'page'        => Http::query('page'),
    ];

    $out = Inventory::products($filter, $maySeeCost($actor));

    // Only when a screen draws the state chips: four extra counts are cheap but
    // pointless for the pickers, which ask this endpoint on every keystroke.
    if (Http::query('counts') === '1') {
        $out['stateCounts'] = Inventory::stockStateCounts($filter);
    }

    return $out;
});

/**
 * The code a new product would be given, so the form can show it before the
 * save rather than after. Registered above /api/products/{id} on purpose —
 * that route takes anything and would answer this one first.
 */
Http::get('/api/products/next-sku', static function (): array {
    Auth::require();
    return ['sku' => Catalog::nextSku(
        (string) Http::query('type'),
        Http::query('custom') === '1',
    )];
});

/**
 * The name a product would be given, composed from the spec being typed.
 *
 * An endpoint rather than a copy of the rule in the browser: the form draws
 * this into the name box as the spec is filled in, and the same function names
 * the product on save. Two implementations would let the preview promise one
 * name and the database keep another — and the name is what the shop-floor
 * system reads. Above /api/products/{id}, like the two routes around it.
 */
Http::get('/api/products/compose-name', static function (): array {
    Auth::require();

    // A whitelist, not everything in the query string. This builds the object a
    // product is named from, and it is not a place for a caller to invent keys.
    $attrs = [];
    foreach ([
        'model', 'coating', 'lens_index', 'lens_design', 'sph', 'cyl', 'axis', 'add',
        'color', 'size', 'material', 'tint', 'bc', 'dia', 'pack', 'wear', 'kind', 'volume',
        'cl_type', 'add_level',
    ] as $key) {
        $v = Http::query($key);
        if ($v !== null && $v !== '') {
            $attrs[$key] = $v;
        }
    }

    return ['name' => Catalog::composeName(
        (string) Http::query('type'),
        Http::query('brand'),
        $attrs,
        Http::query('custom') === '1',
    )];
});

/**
 * What the catalogue already calls things of this type, so the add form can
 * offer them back instead of letting the same frame be typed three ways.
 * Above /api/products/{id} for the same reason as the route above it.
 */
Http::get('/api/products/hints', static function (): array {
    Auth::require();
    $type = (string) Http::query('type');
    if (!Catalog::isType($type)) {
        throw ApiError::badRequest('ชนิดสินค้าไม่ถูกต้อง', 'bad_type');
    }
    return Inventory::productHints($type);
});

Http::get('/api/products/{id}', static function (array $p) use ($maySeeCost): array {
    $actor = Auth::require();
    if (!ctype_digit($p['id'])) {
        throw ApiError::badRequest('id ต้องเป็นตัวเลข');
    }
    return ['product' => Inventory::product((int) $p['id'], $maySeeCost($actor))];
});

Http::get('/api/lots', static function () use ($maySeeCost): array {
    $actor = Auth::require();
    return Inventory::lots([
        'state' => Http::query('state'),
        'q'     => Http::query('q'),
        'from'  => Http::query('from'),
        'to'    => Http::query('to'),
        'sort'  => Http::query('sort'),
        'dir'   => Http::query('dir'),
        'page'  => Http::query('page'),
    ], $maySeeCost($actor)) + ['counts' => Inventory::lotCounts()];
});

Http::get('/api/movements', static function () use ($maySeeCost): array {
    $actor = Auth::require();
    return Inventory::movements([
        'type' => Http::query('type'),
        'q'    => Http::query('q'),
        'who'  => Http::query('who'),
        'from' => Http::query('from'),
        'to'   => Http::query('to'),
        'sort' => Http::query('sort'),
        'dir'  => Http::query('dir'),
        'page' => Http::query('page'),
    ], $maySeeCost($actor)) + ['counts' => Inventory::movementCounts()];
});

/**
 * The dashboard: the ledger added up over a chosen stretch of days.
 *
 * สาขากับชนิดสินค้าเป็นตัวกรองของทั้งหน้า ไม่ใช่ของไฟล์ Excel อย่างเดียวเหมือนเดิม
 * — หน้าจอกับไฟล์ต้องตอบคำถามเดียวกัน ไม่งั้นคนเอาไฟล์ไปเทียบกับจอแล้วเลขไม่ตรง
 */
Http::get('/api/report', static function () use ($maySeeCost): array {
    $actor = Auth::require();
    return Reports::overview(
        Http::query('from') ?? date('Y-m-01'),
        Http::query('to') ?? date('Y-m-d'),
        $maySeeCost($actor),
        ['branch' => Http::query('branch'), 'type' => Http::query('type')],
    );
});

/** รับเข้า / จ่ายออก / ของเสีย ทีละบรรทัด — ชีต "ตัดออกแยกตามออเดอร์" กับ "รับเข้ารายวัน" ของไฟล์ Excel */
Http::get('/api/report/lines', static function () use ($maySeeCost): array {
    $actor = Auth::require();
    return Reports::lines(
        Http::query('from') ?? date('Y-m-01'),
        Http::query('to') ?? date('Y-m-d'),
        $maySeeCost($actor),
        ['branch' => Http::query('branch'), 'type' => Http::query('type')],
    );
});

/** What sells and what sits — the buying decision, from both ends. */
Http::get('/api/movers', static function () use ($maySeeCost): array {
    $actor = Auth::require();
    return Reports::movers(
        Http::query('from') ?? date('Y-m-d', strtotime('-89 days')),
        Http::query('to') ?? date('Y-m-d'),
        (int) (Http::query('idle') ?? Reports::IDLE_DAYS),
        $maySeeCost($actor),
        ['branch' => Http::query('branch'), 'type' => Http::query('type')],
    );
});

/** The shop's own words for why stock moved, most-used first. */
Http::get('/api/notes', static function (): array {
    Auth::require();
    return ['notes' => Inventory::noteSuggestions(Http::query('action') ?? 'OUT')];
});

/** What a new lot of an already-known product should start out saying. */
Http::get('/api/receive-defaults/{sku}', static function (array $p) use ($maySeeCost): array {
    $actor = Auth::require();
    return Inventory::receiveDefaults($p['sku'], $maySeeCost($actor));
});

Http::get('/api/categories', static function (): array {
    Auth::require();
    return ['categories' => Inventory::categories()];
});

/**
 * The lens specs the catalogue actually holds, so a picker offers only what can
 * be found. Cheap enough to read on demand and never worth caching stale.
 */
Http::get('/api/lens-options', static function (): array {
    Auth::require();
    // Same narrowing as the list it sits above, so a chip never advertises rows
    // that screen could not show.
    return Inventory::lensOptions([
        'q'    => Http::query('q'),
        'eye'  => Http::query('eye'),
        'make' => Http::query('make'),
        'index'   => Http::query('index'),
        'design'  => Http::query('design'),
        'coating' => Http::query('coating'),
        'sph_from' => Http::query('sph_from'),
        'sph_to'   => Http::query('sph_to'),
        'cyl_from' => Http::query('cyl_from'),
        'cyl_to'   => Http::query('cyl_to'),
        'add_from' => Http::query('add_from'),
        'add_to'   => Http::query('add_to'),
        'received_from' => Http::query('from'),
        'received_to'   => Http::query('to'),
    ]);
});

/** เพิ่มผู้ขายจากชื่อที่พิมพ์ในช่องผู้ขาย — มีชื่อนี้อยู่แล้วใช้ตัวเดิม (ดู Inventory::supplierByName) */
Http::post('/api/suppliers', static function (): array {
    $actor = Auth::require();
    Roles::require(Roles::moveStock($actor['roles']), 'เพิ่มผู้ขาย');
    return ['supplier' => Inventory::supplierByName((string) (Http::body()['name'] ?? ''))];
});

Http::get('/api/suppliers', static function (): array {
    Auth::require();
    return ['suppliers' => Inventory::suppliers()];
});

/* ------------------------------------------------------------------ stock */

Http::get('/api/stock/{sku}', static function (array $p): array {
    return StockGate::availability($p['sku']);
});

/**
 * The write path, for callers that arrive over HTTP.
 *
 * The rules about who may move stock and whose name goes on it live in
 * StockGate, not here — the shop-floor code calls the same gate directly, in
 * this same process, and two copies of those rules would be two places for them
 * to drift. All that is left here is the part that is genuinely about HTTP:
 * trimming the answer to what this caller may see.
 */
$move = static function (string $action): callable {
    return static function () use ($action): array {
        $actor = Auth::require();
        $body = Http::body();

        /* `source` ตัดสินว่าคำขอนี้ยอมให้ยอดคงเหลือติดลบไหม (ดู
           `Stock::MAY_GO_SHORT`) จึงเชื่อค่าที่ผู้เรียกส่งมาไม่ได้ — ทับด้วย
           ความจริงข้อเดียวที่รู้ได้จากตรงนี้ คือคำขอนี้มาจากเบราว์เซอร์ · โค้ด
           หน้าร้านไม่ได้ผ่านทางนี้ มันเรียก StockGate ตรงในโปรเซสเดียวกัน */
        $body['source'] = 'web';

        $result = match ($action) {
            'issue'  => StockGate::issue($body),
            'scrap'  => StockGate::scrap($body),
            'return' => StockGate::returnStock($body),
        };

        // The service records the true cost of the cut and stores it for replay;
        // what leaves here is trimmed to what this caller may see. Redacting at
        // the boundary rather than in the service keeps the stored answer honest
        // for whoever replays it later.
        if (!Roles::seeCost($actor['roles'])) {
            unset($result['total_cost']);
            if (isset($result['cuts']) && is_array($result['cuts'])) {
                $result['cuts'] = array_map(static function (array $c): array {
                    unset($c['unit_cost']);
                    return $c;
                }, $result['cuts']);
            }
        }

        return $result;
    };
};

Http::post('/api/stock/issue',  $move('issue'));
Http::post('/api/stock/scrap',  $move('scrap'));
Http::post('/api/stock/return', $move('return'));

/**
 * The same two writes, for a basket of several products at once.
 *
 * Separate routes rather than a flag on the ones above, because the answer has
 * a different shape — lines, not one set of cuts — and a caller that asked for
 * one product should never have to find out which shape it got back.
 */
$moveMany = static function (string $action): callable {
    return static function () use ($action): array {
        $actor = Auth::require();
        $body = Http::body();
        /* เหตุผลเดียวกับ `$move` ข้างบน — เบราว์เซอร์ตั้ง source เองไม่ได้ */
        $body['source'] = 'web';

        $result = $action === 'issue'
            ? StockGate::issueMany($body)
            : StockGate::scrapMany($body);

        if (!Roles::seeCost($actor['roles'])) {
            unset($result['total_cost']);
            $result['lines'] = array_map(static function (array $line): array {
                unset($line['total_cost']);
                $line['cuts'] = array_map(static function (array $c): array {
                    unset($c['unit_cost']);
                    return $c;
                }, $line['cuts'] ?? []);
                return $line;
            }, $result['lines'] ?? []);
        }

        return $result;
    };
};

Http::post('/api/stock/issue-many', $moveMany('issue'));
Http::post('/api/stock/scrap-many', $moveMany('scrap'));

/* -------------------------------------------------------------- RX orders */

Http::post('/api/rx', static function (): array {
    $actor = Auth::require();
    Roles::require(Roles::moveStock($actor['roles']), 'เปิดใบสั่งตัด RX');
    return ['order' => Rx::order(Http::body(), $actor['roles'], $actor['id'])];
});

/**
 * The number the next order would be given, so the form can show it before the
 * save rather than after. Read only — the number is claimed by POST /api/rx.
 */
Http::get('/api/rx/next-doc', static function (): array {
    Auth::require();
    return ['referenceDoc' => Rx::nextDoc()];
});

/**
 * The order book — every RX line, with the prescription and both figures.
 */
Http::get('/api/rx/orders', static function () use ($maySeeCost): array {
    $actor = Auth::require();
    return Rx::orders(
        Http::query('q'),
        Http::query('pending') === '1',
        (int) (Http::query('page') ?? 1),
        (int) (Http::query('per') ?? 20),
        $maySeeCost($actor),
        [
            'from' => Http::query('from'),
            'to'   => Http::query('to'),
            'lens' => Http::query('lens'),
        ],
    );
});

/**
 * ติ๊กว่าเลนส์ของใบสั่งตัดมาถึงร้านแล้ว หรือเอาติ๊กออก — ร้านขอไว้ 14 ก.ย. 2026
 *
 * ครั้งที่ทำให้เลนส์ของเคสมาครบทุกข้าง ส่งข้อความเข้า Telegram หนึ่งใบ · ส่งไม่ออกไม่ทำให้
 * การติ๊กพัง — ติ๊กบันทึกแล้ว ข้อความหายดีกว่าบอกคนกดว่าไม่สำเร็จทั้งที่สำเร็จ
 */
Http::post('/api/rx/{id}/arrived', static function (array $p): array {
    $actor = Auth::require();
    if (!ctype_digit($p['id'])) {
        throw ApiError::badRequest('id ต้องเป็นตัวเลข');
    }
    $body = Http::body();
    $arrived = filter_var($body['arrived'] ?? true, FILTER_VALIDATE_BOOLEAN);
    $ref = isset($body['ref']) && is_scalar($body['ref']) ? (string) $body['ref'] : null;
    $out = Rx::setArrived((int) $p['id'], $arrived, $actor['roles'], (int) $actor['id'], $ref);
    if ($out['notice'] !== null) {
        try {
            Telegram::send($out['notice']);
        } catch (\Throwable $e) {
            error_log('แจ้งเลนส์มาครบไม่สำเร็จ: ' . $e->getMessage());
        }
    }
    unset($out['notice']);
    return ['order' => $out];
});

Http::get('/api/rx/awaiting-cost', static function (): array {
    Auth::require();
    return ['rows' => Rx::awaitingCost()];
});

Http::post('/api/rx/{id}/cost', static function (array $p): array {
    $actor = Auth::require();
    if (!ctype_digit($p['id'])) {
        throw ApiError::badRequest('id ต้องเป็นตัวเลข');
    }
    $body = Http::body();
    return ['order' => Rx::setCost((int) $p['id'], $body['unit_cost'] ?? null, $actor['roles'], (int) $actor['id'])];
});

/**
 * แก้ราคาขายของใบสั่งตัดที่เปิดไปแล้ว
 *
 * แยกเส้นจาก /cost เพราะเป็นคนละสิทธิ์: ต้นทุนเป็นของแอดมิน ส่วนราคาขายตกลงกัน
 * เป็นบิล ๆ คนขายแก้เองได้ · ทั้งคู่แก้ซ้ำได้ และทั้งคู่ลงสมุดทุกครั้งที่แก้
 */
Http::post('/api/rx/{id}/price', static function (array $p): array {
    $actor = Auth::require();
    if (!ctype_digit($p['id'])) {
        throw ApiError::badRequest('id ต้องเป็นตัวเลข');
    }
    $body = Http::body();
    return ['order' => Rx::setPrice((int) $p['id'], $body['sale_price'] ?? null, $actor['roles'], (int) $actor['id'])];
});

/**
 * แก้รายละเอียดของใบสั่งตัดที่เปิดไปแล้ว — ค่าสายตา เลขใบ หมายเหตุ ราคาขาย
 *
 * ต้นทุนไม่อยู่ในนี้ มันมีเส้นของตัวเองที่ /cost ด้วยเหตุผลเดิม: เป็นสิทธิ์ของ
 * ฝ่ายบัญชี และลงสมุดเป็นบรรทัด COST ของตัวเอง
 */
Http::post('/api/rx/{id}/update', static function (array $p): array {
    $actor = Auth::require();
    if (!ctype_digit($p['id'])) {
        throw ApiError::badRequest('id ต้องเป็นตัวเลข');
    }
    return ['order' => Rx::edit((int) $p['id'], Http::body(), $actor['roles'], (int) $actor['id'])];
});

/**
 * เอาใบสั่งตัดออก — ลบจริงถ้ายังไม่มีตัวเลขเงินผูก ยกเลิกถ้ามีแล้ว
 *
 * เส้นเดียวสองพฤติกรรม เพราะคนกดถามคำถามเดียว ("เอาใบนี้ออก") และคำตอบว่า
 * ทำได้แค่ไหนเป็นเรื่องของสถานะใบ ไม่ใช่เรื่องที่หน้าจอต้องตัดสินใจก่อนยิง
 * `mode` ในคำตอบบอกว่าเกิดอะไรขึ้นจริง
 */
Http::post('/api/rx/{id}/delete', static function (array $p): array {
    $actor = Auth::require();
    if (!ctype_digit($p['id'])) {
        throw ApiError::badRequest('id ต้องเป็นตัวเลข');
    }
    return Rx::remove((int) $p['id'], Http::body(), $actor['roles'], (int) $actor['id']);
});

/* -------------------------------------------------------------- receiving */

/** รับเข้าทั้งบิล — หัวบิลเดียว หลายสินค้า ทรานแซกชันเดียว (ดู Receiving::receiveMany) */
Http::post('/api/lots/many', static function (): array {
    $actor = Auth::require();
    return ['lots' => Receiving::receiveMany(Http::body(), $actor['roles'], (int) $actor['id'])];
});

Http::post('/api/lots', static function (): array {
    $actor = Auth::require();
    return ['lot' => Receiving::receive(Http::body(), $actor['roles'], $actor['id'])];
});

/* ---------------------------------------------------------------- catalog */

$numericId = static function (array $p): int {
    if (!ctype_digit($p['id'])) {
        throw ApiError::badRequest('id ต้องเป็นตัวเลข');
    }
    return (int) $p['id'];
};

Http::post('/api/products', static function (): array {
    $actor = Auth::require();
    return ['product' => Catalog::createProduct(Http::body(), $actor['roles'])];
});

Http::post('/api/products/{id}/update', static function (array $p) use ($numericId): array {
    $actor = Auth::require();
    return ['product' => Catalog::updateProduct($numericId($p), Http::body(), $actor['roles'], (int) $actor['id'])];
});

Http::post('/api/products/{id}/delete', static function (array $p) use ($numericId): array {
    $actor = Auth::require();
    return ['deleted' => Catalog::deleteProduct($numericId($p), $actor['roles'])];
});

Http::post('/api/lots/{id}/update', static function (array $p) use ($numericId): array {
    $actor = Auth::require();
    return ['lot' => Catalog::updateLot($numericId($p), Http::body(), $actor['roles'], $actor['id'])];
});

Http::post('/api/lots/{id}/delete', static function (array $p) use ($numericId): array {
    $actor = Auth::require();
    return ['deleted' => Catalog::deleteLot($numericId($p), $actor['roles'], (int) $actor['id'])];
});

/* ------------------------------------------------------------------ users */

/* --------------------------------------------------------------- branches */

Http::get('/api/branches', static function () use ($maySeeCost): array {
    $actor = Auth::require();
    // Staff need the names to record a branch withdrawal; the amounts owed are
    // not part of that job.
    return ['branches' => Branches::list(Http::query('active') === '1', $maySeeCost($actor))];
});

Http::post('/api/branches', static function (): array {
    $actor = Auth::require();
    return ['branch' => Branches::create(Http::body(), $actor['roles'])];
});

Http::post('/api/branches/{id}/update', static function (array $p): array {
    $actor = Auth::require();
    if (!ctype_digit($p['id'])) {
        throw ApiError::badRequest('id ต้องเป็นตัวเลข');
    }
    return ['branch' => Branches::update((int) $p['id'], Http::body(), $actor['roles'])];
});

Http::post('/api/branches/{id}/delete', static function (array $p): array {
    $actor = Auth::require();
    if (!ctype_digit($p['id'])) {
        throw ApiError::badRequest('id ต้องเป็นตัวเลข');
    }
    return Branches::delete((int) $p['id'], $actor['roles']);
});

/* ------------------------------------------------------ branch settlements */

Http::get('/api/settlements', static function (): array {
    $actor = Auth::require();

    /* ตัวกรองชุดเดียว ใช้ทั้งกับตารางและกับตัวเลขสรุปบนการ์ด — การ์ดที่นับของ
       ก้อนอื่นกับตารางที่อยู่ใต้มัน คือการ์ดที่อ่านผิดโดยไม่มีอะไรเตือน */
    $filter = [
        'status'    => Http::query('status'),
        'branch_id' => Http::query('branch') === null ? null : (int) Http::query('branch'),
        'q'         => Http::query('q'),
        'from'      => Http::query('from'),
        'to'        => Http::query('to'),
        'sort'      => Http::query('sort'),
        'dir'       => Http::query('dir'),
        'page'      => Http::query('page'),
        // ปุ่ม Excel ขอทุกใบที่ตรงกับตัวกรองในครั้งเดียว ไม่ใช่ทีละ 25 แถว
        'all'       => Http::query('all') === '1',
    ];

    return Settlement::list($filter, $actor['roles'])
        + ['summary' => Settlement::summary($actor['roles'], $filter)];
});

Http::post('/api/settlements/{id}/settle', static function (array $p): array {
    $actor = Auth::require();
    if (!ctype_digit($p['id'])) {
        throw ApiError::badRequest('id ต้องเป็นตัวเลข');
    }
    return ['issue' => Settlement::settle((int) $p['id'], Http::body(), $actor['roles'], $actor['id'])];
});

Http::post('/api/settlements/{id}/write-off', static function (array $p): array {
    $actor = Auth::require();
    if (!ctype_digit($p['id'])) {
        throw ApiError::badRequest('id ต้องเป็นตัวเลข');
    }
    return ['issue' => Settlement::writeOff((int) $p['id'], Http::body(), $actor['roles'], $actor['id'])];
});

/**
 * แก้ป้ายบนรายการค้างรับ — สาขา ผู้รับของ วันที่เบิก หมายเหตุ
 *
 * สินค้ากับจำนวนไม่อยู่ในนี้ สองอย่างนั้นคือของที่ตัดออกจากล็อตไปแล้ว
 * คีย์ผิดต้องยกเลิกแล้วเบิกใหม่ ซึ่งพาของกลับเข้าล็อตถูกใบ
 */
Http::post('/api/settlements/{id}/update', static function (array $p): array {
    $actor = Auth::require();
    if (!ctype_digit($p['id'])) {
        throw ApiError::badRequest('id ต้องเป็นตัวเลข');
    }
    return ['issue' => Settlement::edit((int) $p['id'], Http::body(), $actor['roles'], $actor['id'])];
});

/**
 * สาขาเอาของมาคืน — ปิดใบ และคืนของกลับเข้าล็อตเดิมในจังหวะเดียวกัน
 */
Http::post('/api/settlements/{id}/cancel', static function (array $p): array {
    $actor = Auth::require();
    if (!ctype_digit($p['id'])) {
        throw ApiError::badRequest('id ต้องเป็นตัวเลข');
    }
    return ['issue' => Settlement::cancel((int) $p['id'], Http::body(), $actor['roles'], $actor['id'])];
});

/* ------------------------------------------------------ shop's own issues */

/**
 * แก้การเบิกของร้านเอง (TimeOptic) — เลขเอกสาร หมายเหตุ ผู้เบิก · ของไม่ขยับ
 *
 * แถวของสาขาและแถวที่ตัดตามเคสถูกปฏิเสธ แต่ละอย่างมีที่แก้ของตัวเอง (ดู `ShopIssue`)
 */
Http::post('/api/movements/{id}/update', static function (array $p): array {
    $actor = Auth::require();
    if (!ctype_digit($p['id'])) {
        throw ApiError::badRequest('id ต้องเป็นตัวเลข');
    }
    return ['log' => \Optic\Service\ShopIssue::edit((int) $p['id'], Http::body(), $actor['roles'], $actor['id'])];
});

/** รายการรับเข้าหนึ่งแถวกับล็อตของมัน — กล่องแก้การรับเข้าในหน้าความเคลื่อนไหว */
Http::get('/api/movements/{id}/receipt', static function (array $p) use ($maySeeCost): array {
    $actor = Auth::require();
    if (!ctype_digit($p['id'])) {
        throw ApiError::badRequest('id ต้องเป็นตัวเลข');
    }
    return ['receipt' => \Optic\Service\Receiving::receipt((int) $p['id'], $maySeeCost($actor))];
});

/** แก้การรับเข้าที่คีย์ผิด — จำนวน วันที่ ผู้ขาย วันหมดอายุ ต้นทุน หมายเหตุ (ดู Receiving::editReceipt) */
Http::post('/api/movements/{id}/receipt', static function (array $p): array {
    $actor = Auth::require();
    if (!ctype_digit($p['id'])) {
        throw ApiError::badRequest('id ต้องเป็นตัวเลข');
    }
    return ['receipt' => \Optic\Service\Receiving::editReceipt((int) $p['id'], Http::body(), $actor['roles'], (int) $actor['id'])];
});

/**
 * ยกเลิกการเบิกของร้านเอง — ต้องมีเหตุผล ของกลับเข้าล็อตเดิม ยกเลิกซ้ำไม่ได้
 */
Http::post('/api/movements/{id}/cancel', static function (array $p): array {
    $actor = Auth::require();
    if (!ctype_digit($p['id'])) {
        throw ApiError::badRequest('id ต้องเป็นตัวเลข');
    }
    return \Optic\Service\ShopIssue::cancel((int) $p['id'], Http::body(), $actor['roles'], $actor['id']);
});

/* ------------------------------------------------------------------ users */

/**
 * รายชื่อผู้ใช้ + พนักงานที่ยังไม่มีบัญชี
 *
 * คืนสองก้อนจากคำขอเดียว เพราะหน้าจอเดียวถามทั้งสองคำถามพร้อมกัน — ตารางกับ
 * ช่องเลือกของฟอร์มเพิ่มผู้ใช้เปิดมาด้วยกันเสมอ สองคำขอจึงได้แค่ความช้าเพิ่ม
 */
Http::get('/api/users', static function (): array {
    $actor = Auth::require();
    return Users::list($actor['roles']);
});

/**
 * The permission table itself.
 *
 * Readable by anyone signed in: it is the rules, not the data they protect, and
 * a staff member who wonders why a cost column is missing deserves an answer
 * better than a blank cell.
 */
Http::get('/api/policy', static function (): array {
    Auth::require();
    return Roles::policy();
});

/** Names only, for the "who took this" picker. Any signed-in role may read it. */
Http::get('/api/people', static function (): array {
    Auth::require();
    return ['people' => Users::pickable()];
});

/**
 * ให้พนักงานที่มีอยู่แล้วเข้าใช้งานระบบได้
 *
 * `employee_id` ในบอดี้ ไม่ใช่ชื่อคน — คนถูกสร้างที่หน้าพนักงานไปแล้ว ที่นี่คือ
 * การเติมชื่อผู้ใช้ รหัสผ่าน และบทบาทลงในแถวที่รออยู่ (`Users::grantAccount`)
 */
Http::post('/api/users', static function (): array {
    $actor = Auth::require();
    $body  = Http::body();
    return ['user' => Users::grantAccount(
        (int) ($body['employee_id'] ?? 0),
        $body,
        $actor['roles'],
        $actor['id'],
    )];
});

Http::post('/api/users/{id}/update', static function (array $p) use ($numericId): array {
    $actor = Auth::require();
    return ['user' => Users::update($numericId($p), Http::body(), $actor['roles'], $actor['id'])];
});

Http::post('/api/users/{id}/password', static function (array $p) use ($numericId): array {
    $actor = Auth::require();
    return ['user' => Users::setPassword($numericId($p), Http::body(), $actor['roles'])];
});

/**
 * ปุ่มรีเซ็ต — ระบบสุ่มรหัสให้ แล้วคืนออกไปครั้งเดียว
 *
 * รหัสดิบอยู่ในคำตอบของคำขอนี้ที่เดียวและไม่ได้ถูกเก็บที่ไหนอีก · `ActivityLog`
 * ปิดทุกช่องที่ชื่อมีคำว่า password ก่อนบันทึกอยู่แล้ว บันทึกจึงเห็นแค่ว่ามีการรีเซ็ต
 */
Http::post('/api/users/{id}/reset-password', static function (array $p) use ($numericId): array {
    $actor = Auth::require();
    return ['user' => Users::resetPassword($numericId($p), $actor['roles'])];
});

/**
 * ยกเลิกบัญชีเข้าใช้งาน — คนยังอยู่ในระบบ
 *
 * แทนเส้น `/delete` เดิมที่หายไปพร้อม `Users::delete()` · แถวใน `admins` ลบไม่ได้
 * เพราะ ledger เขียนชื่อจากมัน สิ่งที่ยกเลิกได้คือชื่อผู้ใช้ รหัสผ่าน และบทบาท
 */
Http::post('/api/users/{id}/revoke', static function (array $p) use ($numericId): array {
    $actor = Auth::require();
    return Users::revokeAccount($numericId($p), $actor['roles'], $actor['id']);
});

/* ----------------------------------------------------------------- health */

Http::get('/api/health', static fn(): array => [
    'ok'   => true,
    'time' => date('c'),
]);

Http::dispatch();
