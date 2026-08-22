<?php
/** Where a product sits in the shop — keyed by product_name, not stock id. */
declare(strict_types=1);

GET('/api/locations', function (array $req) {
    $term = str_or($req['query']['q'] ?? null);
    if ($term !== '') {
        $p = like($term);
        return Db::all(
            'SELECT * FROM product_locations
              WHERE product_name LIKE ? OR location LIKE ?
              ORDER BY product_name LIMIT 500',
            $p, $p
        );
    }
    return Db::all('SELECT * FROM product_locations ORDER BY product_name LIMIT 500');
});

POST('/api/locations', function (array $req) {
    $body = $req['body'];
    if (str_or($body['product_name'] ?? null) === '') {
        bad('กรุณากรอกชื่อสินค้า');
    }
    if (str_or($body['location'] ?? null) === '') {
        bad('กรุณากรอกตำแหน่ง');
    }
    $r = Db::run(
        'INSERT INTO product_locations (product_name, location) VALUES (?,?)',
        str_or($body['product_name']),
        str_or($body['location'])
    );
    return Db::get('SELECT * FROM product_locations WHERE id = ?', $r['insertId']);
});

PUT('/api/locations/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    Db::run(
        'UPDATE product_locations SET product_name=?, location=? WHERE id=?',
        str_or($req['body']['product_name'] ?? null),
        str_or($req['body']['location'] ?? null),
        $id
    );
    return Db::get('SELECT * FROM product_locations WHERE id = ?', $id);
});

DELETE('/api/locations/:id', function (array $req) {
    Db::run('DELETE FROM product_locations WHERE id = ?', int_or($req['params']['id']));
    return ['ok' => true];
});
