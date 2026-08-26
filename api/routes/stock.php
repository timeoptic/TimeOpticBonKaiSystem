<?php
/**
 * Inventory. Real stock lives in `products` (SKU-level) + `stock_lots`
 * (each receiving batch, with initial_qty/remaining_qty) — see lib/migrate.js.
 * This route group's paths and response shapes stay identical to the old
 * `stock` table so the frontend needs no changes; expandLots() (Helpers.php)
 * turns lot rows back into per-unit rows wherever the frontend expects
 * "amount=N -> N separately listed items" (list endpoint only).
 */
declare(strict_types=1);

const STOCK_ATTR_FIELDS = ['model', 'color', 'size', 'lens_design', 'lens_index',
    'coating', 'tint', 'addons', 'product_line', 'vendor_name'];

function stockAttributes(array $b): string
{
    $out = [];
    foreach (STOCK_ATTR_FIELDS as $f) {
        $out[$f] = nul($b[$f] ?? null);
    }
    return json_encode($out);
}

/** Find an existing product by sku (adding stock for an existing SKU = a new lot
 *  under the same product), or create a new one — matches the old behavior where
 *  each "add to stock" submission was conceptually a new physical item, ported
 *  from lib/api.js's findOrCreateProduct (lib/api.js:623-642). */
function findOrCreateProduct(Tx $q, array $b): int
{
    $sku = nul($b['sku'] ?? null);
    if ($sku) {
        $existing = $q->get('SELECT id FROM products WHERE sku = ?', $sku);
        if ($existing) {
            return (int) $existing['id'];
        }
    }
    $productType = str_or($b['product_type'] ?? null, 'Frame') ?: 'Frame';
    $cat = $q->get('SELECT id FROM categories WHERE code = ?', $productType);
    if (!$cat) {
        bad("ไม่รู้จักประเภทสินค้า: $productType");
    }
    $finalSku = $sku ?: ('SKU-' . strtoupper(uniqid()));
    $r = $q->run(
        'INSERT INTO products (sku, category_id, product_type, name, brand,
           base_selling_price, is_custom_made, attributes)
         VALUES (?,?,?,?,?,?,0,?)',
        $finalSku, (int) $cat['id'], $productType, str_or($b['product_name'] ?? null),
        nul($b['brand'] ?? null), num($b['product_price'] ?? null), stockAttributes($b)
    );
    return $r['insertId'];
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
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $lots = Db::all(
        "SELECT s.*, l.location, sup.name AS supplier_name
           FROM v_stock_lot s
           LEFT JOIN product_locations l ON l.product_name = s.product_name
           LEFT JOIN suppliers sup       ON sup.id = s.supplier_id
           $sqlWhere
          ORDER BY s.id DESC",
        ...$args
    );

    $rows = expandLots($lots);
    $sold = str_or($q['sold'] ?? null);
    if ($sold === '0' || $sold === '1') {
        $target = (int) $sold;
        $rows = array_values(array_filter($rows, fn($r) => $r['sold'] === $target));
    }
    return array_slice($rows, 0, min(int_or($q['limit'] ?? null, 300), 2000));
});

GET('/api/stock/names', function (array $req) {
    $type = str_or($req['query']['type'] ?? null);
    $filter = $type !== '' ? 'WHERE p.product_type = ?' : '';
    $args   = $type !== '' ? [$type] : [];
    return Db::all(
        "SELECT p.name AS product_name, p.product_type, MAX(p.base_selling_price) product_price,
                COALESCE(SUM(sl.initial_qty),0) n
           FROM products p LEFT JOIN stock_lots sl ON sl.product_id = p.id
           $filter
          GROUP BY p.name, p.product_type ORDER BY p.name",
        ...$args
    );
});

GET('/api/stock/:id', function (array $req) {
    $s = Db::get(
        'SELECT s.*, l.location FROM v_stock_lot s
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

    $lotId = Db::tx(function (Tx $q) use ($body, $amount, $stockDate) {
        $productId = findOrCreateProduct($q, $body);
        $r = $q->run(
            'INSERT INTO stock_lots (lot_number, product_id, supplier_id, cost_per_unit,
               initial_qty, remaining_qty, received_date, notes)
             VALUES (?,?,?,?,?,?,DATE(?),?)',
            'LOT-' . strtoupper(uniqid()), $productId, int_or($body['supplier_id'] ?? null),
            num($body['product_expense'] ?? null), $amount, $amount, $stockDate,
            nul($body['notes'] ?? null)
        );
        $q->run(
            "INSERT INTO inventory_logs (product_id, lot_id, action_type, quantity, notes)
             VALUES (?,?,'IN',?,'รับเข้าคลัง')",
            $productId, $r['insertId'], $amount
        );
        return $r['insertId'];
    });

    // Old behavior returned one id per individual item; now every unit in this
    // batch shares the one lot id — StockForm.jsx's success toast
    // (`ids[0]${count>1 ? '–'+ids.at(-1) : ''}`) still renders sensibly with a
    // single-element ids array (it just won't show a range for amount>1 anymore,
    // a cosmetic difference StockForm.jsx doesn't need to change for).
    return ['ok' => true, 'ids' => [$lotId], 'count' => $amount];
});

PUT('/api/stock/:id', function (array $req) {
    $id  = int_or($req['params']['id']);
    $lot = Db::get('SELECT * FROM stock_lots WHERE id = ?', $id);
    if (!$lot) {
        missing();
    }
    $body = $req['body'];

    Db::tx(function (Tx $q) use ($id, $lot, $body) {
        $q->run(
            'UPDATE products SET product_type=?, name=?, brand=?, base_selling_price=?, attributes=?
               WHERE id = (SELECT product_id FROM stock_lots WHERE id = ?)',
            str_or($body['product_type'] ?? null, 'Frame') ?: 'Frame',
            str_or($body['product_name'] ?? null), nul($body['brand'] ?? null),
            num($body['product_price'] ?? null), stockAttributes($body), $id
        );
        $q->run(
            'UPDATE stock_lots SET supplier_id=?, cost_per_unit=?, notes=? WHERE id = ?',
            int_or($body['supplier_id'] ?? null), num($body['product_expense'] ?? null),
            nul($body['notes'] ?? null), $id
        );
    });

    return Db::get('SELECT s.* FROM v_stock_lot s WHERE s.id = ?', $id);
});

DELETE('/api/stock/:id', function (array $req) {
    $id  = int_or($req['params']['id']);
    $lot = Db::get('SELECT * FROM stock_lots WHERE id = ?', $id);
    if (!$lot) {
        missing();
    }
    if (!(int) $lot['remaining_qty']) {
        bad('ลบไม่ได้ — สินค้าล็อตนี้ขายหมดแล้ว');
    }
    Db::tx(function (Tx $q) use ($id, $lot) {
        $q->run(
            "INSERT INTO inventory_logs (product_id, lot_id, action_type, quantity, notes)
             VALUES (?,?,'ADJUST',-1,'ลบออกจากหน้าคลัง')",
            (int) $lot['product_id'], $id
        );
        if ((int) $lot['initial_qty'] <= 1) {
            $q->run('DELETE FROM stock_lots WHERE id = ?', $id);
        } else {
            $q->run(
                'UPDATE stock_lots SET initial_qty = initial_qty - 1, remaining_qty = remaining_qty - 1
                   WHERE id = ?',
                $id
            );
        }
    });
    return ['ok' => true];
});
