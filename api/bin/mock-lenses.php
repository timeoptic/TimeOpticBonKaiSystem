<?php

declare(strict_types=1);

/**
 * Puts a few bifocal and progressive lenses into the catalogue, with stock.
 *
 * The catalogue had progressives only as made-to-order and no bifocals at all,
 * so two of the three lens designs could never be seen on the screens that list
 * stock. That is fine as a fact about the shop and useless as a way to try the
 * lens filters out.
 *
 * Written against the services rather than as INSERTs, because a lot is not a
 * row: receiving one writes the ledger entry that the stock book is checked
 * against, and a hand-written lot would show up as a lot whose history does not
 * add up. `Receiving::receive` does that properly, so this asks it to.
 *
 * Safe to run twice — a SKU that already exists is skipped, not duplicated.
 *
 * Removing what this made:
 *   DELETE FROM inventory_logs WHERE reference_doc LIKE 'MOCK-%';
 *   DELETE FROM stock_lots  WHERE lot_number  LIKE 'MOCK-%';
 *   DELETE FROM products    WHERE sku         LIKE 'LNS-BIF%' OR sku LIKE 'LNS-PRG%';
 *
 * Usage:  .\run.ps1 php api/bin/mock-lenses.php
 */

require __DIR__ . '/../src/bootstrap.php';

use Optic\Db;
use Optic\Service\Catalog;
use Optic\Service\Receiving;

$categoryId = Db::value("SELECT id FROM categories WHERE code = 'Lens'");
if ($categoryId === null) {
    fwrite(STDERR, "ไม่พบหมวดหมู่ Lens\n");
    exit(1);
}

$actorId = (int) Db::value('SELECT id FROM admins ORDER BY id ASC LIMIT 1');
$supplierId = Db::value('SELECT id FROM suppliers ORDER BY id ASC LIMIT 1');

/**
 * Four lenses: two designs the shop could not otherwise show, each in two
 * indexes, all of them stock rather than made-to-order — the point is to fill
 * the screens that only list what is on a shelf.
 */
$lenses = [
    [
        'sku' => 'LNS-BIF156-KD', 'name' => 'Kodak Bifocal FT28 1.56', 'brand' => 'Kodak',
        'price' => '2200.00', 'qty' => 6, 'cost' => '980.00',
        'attributes' => ['lens_design' => 'Bifocal', 'lens_index' => '1.56', 'coating' => 'SeeCoat Blue', 'add' => '+2.00'],
    ],
    [
        'sku' => 'LNS-BIF160-HY', 'name' => 'Hoya Bifocal FT28 1.60', 'brand' => 'Hoya',
        'price' => '3400.00', 'qty' => 4, 'cost' => '1620.00',
        'attributes' => ['lens_design' => 'Bifocal', 'lens_index' => '1.60', 'coating' => 'BlueControl', 'add' => '+2.50'],
    ],
    [
        'sku' => 'LNS-PRG160-ES', 'name' => 'Essilor Adaptar Progressive 1.60', 'brand' => 'Essilor',
        'price' => '6900.00', 'qty' => 5, 'cost' => '3450.00',
        'attributes' => ['lens_design' => 'Progressive', 'lens_index' => '1.60', 'coating' => 'Crizal Easy Pro', 'add' => '+1.75'],
    ],
    [
        'sku' => 'LNS-PRG167-ZS', 'name' => 'Zeiss SmartLife Progressive 1.67', 'brand' => 'Zeiss',
        'price' => '9500.00', 'qty' => 3, 'cost' => '4780.00',
        'attributes' => ['lens_design' => 'Progressive', 'lens_index' => '1.67', 'coating' => 'DuraVision BlueProtect', 'add' => '+2.25'],
    ],
];

$made = 0;
$skipped = 0;

foreach ($lenses as $l) {
    if (Db::value('SELECT id FROM products WHERE sku = ?', [$l['sku']]) !== null) {
        printf("  ข้าม  %-16s มีอยู่แล้ว\n", $l['sku']);
        $skipped++;
        continue;
    }

    Catalog::createProduct([
        'sku'                => $l['sku'],
        'name'               => $l['name'],
        'brand'              => $l['brand'],
        'product_type'       => 'Lens',
        'category_id'        => $categoryId,
        'base_selling_price' => $l['price'],
        'is_custom_made'     => false,
        'attributes'         => $l['attributes'],
    ], 'owner');

    $lot = Receiving::receive([
        'sku'           => $l['sku'],
        'lot_number'    => 'MOCK-' . substr($l['sku'], 4),
        'quantity'      => $l['qty'],
        'cost_per_unit' => $l['cost'],
        'supplier_id'   => $supplierId,
        'received_date' => date('Y-m-d'),
        'note'          => 'ข้อมูลตัวอย่างจาก mock-lenses.php',
    ], 'owner', $actorId);

    printf(
        "  เพิ่ม %-16s %-34s %-12s %s · %d ชิ้น\n",
        $l['sku'],
        $l['name'],
        $l['attributes']['lens_design'],
        $l['attributes']['lens_index'],
        $lot['quantity'],
    );
    $made++;
}

printf("\nเพิ่ม %d รายการ · ข้าม %d รายการ\n", $made, $skipped);
