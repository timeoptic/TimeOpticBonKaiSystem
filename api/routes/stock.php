<?php
/**
 * Inventory. One row is one physical item, so "add 10 frames" writes 10 rows
 * and selling one flips that row's `sold` flag.
 */
declare(strict_types=1);

const STOCK_COLS = ['product_type', 'product_name', 'brand', 'brand_name', 'model', 'color',
    'size', 'sku', 'lens_design', 'lens_index', 'coating', 'tint', 'addons',
    'product_line', 'product_price', 'product_expense', 'vendor_name', 'supplier_id', 'notes'];

function stockVals(array $b): array
{
    $out = [];
    foreach (STOCK_COLS as $c) {
        if ($c === 'product_type') {
            $out[] = str_or($b['product_type'] ?? null, 'Frame') ?: 'Frame';
        } elseif ($c === 'product_name') {
            $out[] = str_or($b['product_name'] ?? null);
        } elseif ($c === 'product_price' || $c === 'product_expense') {
            $out[] = num($b[$c] ?? null);
        } elseif ($c === 'supplier_id') {
            $out[] = int_or($b['supplier_id'] ?? null);
        } elseif ($c === 'brand_name') {
            $out[] = nul($b['brand_name'] ?? null) ?? nul($b['brand'] ?? null);
        } else {
            $out[] = nul($b[$c] ?? null);
        }
    }
    return $out;
}

GET('/api/stock', function (array $req) {
    $q     = $req['query'];
    $where = [];
    $args  = [];

    if ($term = str_or($q['q'] ?? null)) {
        $p = like($term);
        $where[] = '(s.product_name LIKE ? OR s.brand LIKE ? OR s.brand_name LIKE ?
                     OR s.vendor_name LIKE ? OR s.sku LIKE ? OR CAST(s.id AS CHAR) = ?)';
        array_push($args, $p, $p, $p, $p, $p, $term);
    }
    if ($type = str_or($q['type'] ?? null)) {
        $where[] = 's.product_type = ?';
        $args[]  = $type;
    }
    $sold = str_or($q['sold'] ?? null);
    if ($sold === '0' || $sold === '1') {
        $where[] = 's.sold = ?';
        $args[]  = (int) $sold;
    }
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $args[] = min(int_or($q['limit'] ?? null, 300), 2000);

    return Db::all(
        "SELECT s.*, l.location, sup.name AS supplier_name
           FROM stock s
           LEFT JOIN product_locations l ON l.product_name = s.product_name
           LEFT JOIN suppliers sup       ON sup.id = s.supplier_id
           $sqlWhere
          GROUP BY s.id
          ORDER BY s.id DESC LIMIT ?",
        ...$args
    );
});

GET('/api/stock/names', function (array $req) {
    $type = str_or($req['query']['type'] ?? null);
    $filter = $type !== '' ? 'WHERE product_type = ?' : '';
    $args   = $type !== '' ? [$type] : [];
    return Db::all(
        "SELECT product_name, product_type, MAX(product_price) product_price, COUNT(*) n
           FROM stock $filter
          GROUP BY product_name, product_type ORDER BY product_name",
        ...$args
    );
});

GET('/api/stock/:id', function (array $req) {
    $s = Db::get(
        'SELECT s.*, l.location FROM stock s
           LEFT JOIN product_locations l ON l.product_name = s.product_name
          WHERE s.id = ? LIMIT 1',
        int_or($req['params']['id'])
    );
    if (!$s) {
        missing();
    }
    return $s;
});

POST('/api/stock', function (array $req) {
    $body = $req['body'];
    if (str_or($body['product_name'] ?? null) === '') {
        bad('กรุณากรอกชื่อสินค้า');
    }
    $amount    = min(max(int_or($body['amount'] ?? null, 1) ?? 1, 1), 500);
    $stockDate = str_or($body['stock_date'] ?? null) ?: nowStamp();
    $vals      = stockVals($body);

    $ids = Db::tx(function (Tx $q) use ($amount, $vals, $stockDate) {
        $names = implode(',', STOCK_COLS);
        $marks = implode(',', array_fill(0, count(STOCK_COLS), '?'));
        $out = [];
        for ($i = 0; $i < $amount; $i++) {
            $r = $q->run(
                "INSERT INTO stock ($names, stock_date) VALUES ($marks, ?)",
                ...[...$vals, $stockDate]
            );
            $out[] = $r['insertId'];
        }
        return $out;
    });

    return ['ok' => true, 'ids' => $ids, 'count' => count($ids)];
});

PUT('/api/stock/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    if (!Db::get('SELECT id FROM stock WHERE id = ?', $id)) {
        missing();
    }
    $set = implode(',', array_map(fn($c) => "$c=?", STOCK_COLS));
    Db::run("UPDATE stock SET $set WHERE id=?", ...[...stockVals($req['body']), $id]);
    return Db::get('SELECT * FROM stock WHERE id = ?', $id);
});

DELETE('/api/stock/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    $s  = Db::get('SELECT * FROM stock WHERE id = ?', $id);
    if (!$s) {
        missing();
    }
    if ((int) $s['sold']) {
        bad('ลบไม่ได้ — สินค้าชิ้นนี้ขายไปแล้ว');
    }
    Db::run('DELETE FROM stock WHERE id = ?', $id);
    return ['ok' => true];
});
