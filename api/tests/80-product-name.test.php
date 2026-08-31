<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Repo\Inventory;
use Optic\Roles;
use Optic\Service\Catalog;

/** @param array<string,mixed> $attrs */
function composed(string $type, ?string $brand, array $attrs, bool $custom = false): string
{
    return Catalog::composeName($type, $brand, $attrs, $custom);
}

group('ชื่อสินค้าที่ประกอบจากสเปก');

test('เลนส์ได้ชื่อตามรูปแบบ แบรนด์ รุ่น Coating (Index) SPH/CYL Add', function () {
    eq(
        composed('Lens', 'Hoya', [
            'model'      => 'HiVision',
            'coating'    => 'MultiCoat',
            'lens_index' => '1.60',
            'sph'        => -2.25,
            'cyl'        => -0.75,
        ]),
        'Hoya HiVision MultiCoat (1.60) -2.25/-0.75',
        'ชื่อเลนส์เต็มรูป',
    );
});

test('Index อยู่ในวงเล็บ ค่าสายตาคั่นด้วย / และ ADD มีคำว่า Add นำหน้า', function () {
    eq(
        composed('Lens', 'Zeiss', [
            'model' => 'SmartLife', 'coating' => 'Transition-Blue', 'lens_index' => '1.67',
            'sph' => 0, 'cyl' => 0, 'add' => '+2.50',
        ]),
        'Zeiss SmartLife Transition-Blue (1.67) 0.00/0.00 Add +2.50',
        'ครบทุกส่วนของรูปแบบ',
    );
    // มีค่าเดียวก็ไม่มีเครื่องหมาย / ค้างไว้
    eq(composed('Lens', null, ['sph' => -1.0]), '-1.00', 'มีแต่ SPH');
    eq(composed('Lens', null, ['cyl' => -1.0]), '-1.00', 'มีแต่ CYL');
});

test('ในชื่อไม่มีคำว่า SPH หรือ CYL — มีแต่ค่า', function () {
    $name = composed('Lens', 'Hoya', ['model' => 'HiVision', 'sph' => -2.25, 'cyl' => -0.75]);
    ok(!str_contains($name, 'SPH'), "ชื่อ \"{$name}\" ต้องไม่มีคำว่า SPH");
    ok(!str_contains($name, 'CYL'), "ชื่อ \"{$name}\" ต้องไม่มีคำว่า CYL");
});

test('ค่าสายตาเซ็นเสมอ สองตำแหน่ง และใช้ขีดธรรมดาไม่ใช่เครื่องหมายลบยูนิโค้ด', function () {
    eq(composed('Lens', null, ['sph' => 2]), '+2.00', 'ค่าบวก');
    eq(composed('Lens', null, ['sph' => -2]), '-2.00', 'ค่าลบ');
    // ศูนย์ไม่ติดเครื่องหมาย — "+0.00" กับ "-0.00" คือเลนส์ตัวเดียวกัน
    eq(composed('Lens', null, ['sph' => 0]), '0.00', 'ศูนย์');
    ok(!str_contains(composed('Lens', null, ['sph' => -1.5]), "\u{2212}"), 'ต้องเป็น ASCII "-"');
});

test('เลนส์ที่ต่างกันแค่ Coating ต้องได้คนละชื่อ', function () {
    $base = ['model' => 'HiVision', 'lens_index' => '1.60', 'sph' => -2.25, 'cyl' => -0.50];
    $hard = composed('Lens', 'Hoya', $base + ['coating' => 'Hard']);
    $multi = composed('Lens', 'Hoya', $base + ['coating' => 'MultiCoat']);

    eq($hard, 'Hoya HiVision Hard (1.60) -2.25/-0.50', 'Coating อยู่ต่อจากรุ่น');
    ok($hard !== $multi, 'ต่างกันแค่ Coating ก็ต้องได้คนละชื่อ');
});

test('ADD ต่อท้ายเมื่อสินค้ามีค่า ADD — เลนส์ Bifocal สองตัวจึงไม่ชื่อซ้ำกัน', function () {
    $base = ['model' => 'FT28', 'lens_index' => '1.60', 'sph' => -1.0];
    $a = composed('Lens', 'Hoya', $base + ['add' => '+2.00']);
    $b = composed('Lens', 'Hoya', $base + ['add' => '+2.50']);

    eq($a, 'Hoya FT28 (1.60) -1.00 Add +2.00', 'ADD อยู่ท้ายชื่อ พร้อมคำกำกับ');
    ok($a !== $b, 'ต่างกันแค่ ADD ก็ต้องได้คนละชื่อ');
});

test('ช่องที่ไม่ได้กรอกหายไปทั้งช่อง ไม่เหลือช่องว่างหรือขีด', function () {
    eq(composed('Lens', 'Hoya', ['model' => 'HiVision', 'lens_index' => '1.60']), 'Hoya HiVision (1.60)', 'ไม่มีค่าสายตา');
    eq(composed('Lens', null, ['model' => 'HiVision']), 'HiVision', 'มีแต่รุ่น');
    eq(composed('Lens', null, []), '', 'ไม่มีอะไรเลย');
});

test('สินค้าชนิดอื่นใช้สเปกของชนิดตัวเอง', function () {
    eq(
        composed('Frame', 'Hitop', ['model' => 'TS2088', 'color' => 'ดำเงา', 'size' => '50-22-150']),
        'Hitop TS2088 ดำเงา 50-22-150',
        'กรอบแว่น',
    );
    eq(
        composed('Sunglass', 'Hitop', ['model' => 'HB01', 'color' => 'ดำ', 'tint' => 'Grey', 'size' => '54-16-145']),
        'Hitop HB01 ดำ Grey 54-16-145',
        'แว่นกันแดด',
    );
    eq(
        composed('ContactLen', 'Hoya', ['model' => 'Daily', 'bc' => '8.6', 'dia' => '14.2', 'pack' => 30]),
        'Hoya Daily 8.6 14.2 30',
        'คอนแทคเลนส์',
    );
    eq(
        composed('Accessory', 'Lens G', ['model' => 'Cleaning Kit', 'volume' => '60ml']),
        'Lens G Cleaning Kit 60ml',
        'อุปกรณ์เสริม',
    );
});

test('สเปกที่เก็บเป็น JSON null ไม่กลายเป็นคำว่า null ในชื่อ', function () {
    $name = composed('Lens', 'Hoya', ['model' => 'HiVision', 'coating' => null, 'cyl' => 'null']);
    eq($name, 'Hoya HiVision', 'ชื่อต้องไม่มีคำว่า null');
});

group('บันทึกสินค้าโดยไม่พิมพ์ชื่อ');

test('ไม่ส่งชื่อมา ระบบตั้งชื่อให้จากสเปก และเก็บลงฐานข้อมูลจริง', function () {
    withRollback(function () {
        $out = Catalog::createProduct([
            'sku'                => 'NAM-' . strtoupper(bin2hex(random_bytes(3))),
            'product_type'       => 'Lens',
            'category_id'        => (int) Db::value("SELECT id FROM categories WHERE code = 'Lens'"),
            'base_selling_price' => '3500.00',
            'brand'              => 'Hoya',
            'is_custom_made'     => false,
            'attributes'         => [
                'model' => 'HiVision', 'coating' => 'MultiCoat',
                'lens_index' => '1.60', 'sph' => -2.25, 'cyl' => -0.75,
            ],
        ], Roles::OWNER);

        eq($out['name'], 'Hoya HiVision MultiCoat (1.60) -2.25/-0.75', 'ชื่อที่คืนกลับมา');
        eq(
            Db::value('SELECT name FROM products WHERE id = ?', [$out['id']]),
            'Hoya HiVision MultiCoat (1.60) -2.25/-0.75',
            'ชื่อที่เก็บลงฐานข้อมูล',
        );
    });
});

test('พิมพ์ชื่อมาเอง ระบบไม่เขียนทับ', function () {
    withRollback(function () {
        $out = Catalog::createProduct([
            'sku'                => 'NAM-' . strtoupper(bin2hex(random_bytes(3))),
            'name'               => 'ชื่อที่ร้านเรียกเอง',
            'product_type'       => 'Lens',
            'category_id'        => (int) Db::value("SELECT id FROM categories WHERE code = 'Lens'"),
            'base_selling_price' => '3500.00',
            'brand'              => 'Hoya',
            'is_custom_made'     => false,
            'attributes'         => ['model' => 'HiVision', 'lens_index' => '1.60'],
        ], Roles::OWNER);

        eq($out['name'], 'ชื่อที่ร้านเรียกเอง', 'ชื่อที่พิมพ์เองต้องชนะ');
    });
});

test('แก้สเปทแล้วล้างชื่อ ได้ชื่อของสเปกใหม่ ไม่ใช่ของเก่า', function () {
    withRollback(function () {
        $sku = 'NAM-' . strtoupper(bin2hex(random_bytes(3)));
        $lens = (int) Db::value("SELECT id FROM categories WHERE code = 'Lens'");
        $base = [
            'sku'                => $sku,
            'product_type'       => 'Lens',
            'category_id'        => $lens,
            'base_selling_price' => '3500.00',
            'brand'              => 'Hoya',
            'is_custom_made'     => false,
        ];

        $out = Catalog::createProduct(
            $base + ['attributes' => ['model' => 'HiVision', 'lens_index' => '1.60']],
            Roles::OWNER,
        );
        eq($out['name'], 'Hoya HiVision (1.60)', 'ชื่อตอนสร้าง');

        // The index changes and the name is cleared: the composition has to read
        // what is being written, not what is stored.
        $again = Catalog::updateProduct(
            $out['id'],
            $base + ['name' => '', 'attributes' => ['model' => 'HiVision', 'lens_index' => '1.67']],
            Roles::OWNER,
        );
        eq($again['name'], 'Hoya HiVision (1.67)', 'ชื่อหลังแก้ Index');
    });
});

group('ช่องที่เว้นว่างได้');

test('ไม่ใส่ราคาขาย บันทึกได้ และเก็บเป็น 0 แปลว่ายังไม่ตั้งราคา', function () {
    withRollback(function () {
        $out = Catalog::createProduct([
            'sku'            => 'OPT-' . strtoupper(bin2hex(random_bytes(3))),
            'product_type'   => 'Frame',
            'category_id'    => (int) Db::value("SELECT id FROM categories WHERE code = 'Frame'"),
            'brand'          => 'Hitop',
            'is_custom_made' => false,
            'attributes'     => ['model' => 'TS2088', 'color' => 'ดำเงา'],
            // ราคาไม่ได้ส่งมาเลย
        ], Roles::OWNER);

        eq($out['name'], 'Hitop TS2088 ดำเงา', 'ยังตั้งชื่อให้ตามปกติ');
        eq(
            (string) Db::value('SELECT base_selling_price FROM products WHERE id = ?', [$out['id']]),
            '0.00',
            'ราคาที่เก็บเมื่อไม่ได้ตั้ง',
        );
    });
});

test('ส่งราคามาเป็นสตริงว่าง ก็เหมือนไม่ตั้งราคา ไม่ใช่ error', function () {
    withRollback(function () {
        $out = Catalog::createProduct([
            'sku'                => 'OPT-' . strtoupper(bin2hex(random_bytes(3))),
            'product_type'       => 'Frame',
            'category_id'        => (int) Db::value("SELECT id FROM categories WHERE code = 'Frame'"),
            'base_selling_price' => '',
            'brand'              => 'Hitop',
            'is_custom_made'     => false,
            'attributes'         => ['model' => 'TS1042'],
        ], Roles::OWNER);

        eq(Inventory::product($out['id'], true)['basePrice'], 0.0, 'ราคาที่อ่านกลับมา');
    });
});

test('ราคาที่ผิดรูปยังถูกปฏิเสธเหมือนเดิม — เว้นว่างกับพิมพ์มั่วคนละเรื่อง', function () {
    withRollback(function () {
        $args = static fn(string $v): array => [
            'sku'                => 'OPT-' . strtoupper(bin2hex(random_bytes(3))),
            'product_type'       => 'Frame',
            'category_id'        => (int) Db::value("SELECT id FROM categories WHERE code = 'Frame'"),
            'base_selling_price' => $v,
            'brand'              => 'Hitop',
            'is_custom_made'     => false,
            'attributes'         => ['model' => 'TS1042'],
        ];

        throwsReason('bad_price', fn() => Catalog::createProduct($args('-50'), Roles::OWNER), 'ราคาติดลบ');
        throwsReason('bad_price', fn() => Catalog::createProduct($args('ถูกมาก'), Roles::OWNER), 'ราคาเป็นตัวอักษร');
    });
});

test('ไม่ใส่รุ่น ชื่อก็ยังตั้งให้ได้ แค่สั้นลงหนึ่งคำ', function () {
    eq(
        composed('Frame', 'Hitop', ['color' => 'ดำเงา', 'size' => '50-22-150']),
        'Hitop ดำเงา 50-22-150',
        'ชื่อที่ไม่มีรุ่น',
    );
    eq(
        composed('Lens', 'Hoya', ['lens_index' => '1.60', 'sph' => -2.25]),
        'Hoya (1.60) -2.25',
        'เลนส์ที่ไม่มีรุ่น',
    );
});

test('ไม่ใส่ทั้งรุ่นและราคา ก็ยังบันทึกได้', function () {
    withRollback(function () {
        $out = Catalog::createProduct([
            'sku'            => 'OPT-' . strtoupper(bin2hex(random_bytes(3))),
            'product_type'   => 'Accessory',
            'category_id'    => (int) Db::value("SELECT id FROM categories WHERE code = 'Accessory'"),
            'brand'          => 'Lens G',
            'is_custom_made' => false,
            'attributes'     => ['kind' => 'Cloth', 'color' => 'เทา'],
        ], Roles::OWNER);

        eq($out['name'], 'Lens G เทา', 'ชื่อจากแบรนด์กับสี');
        eq(Inventory::product($out['id'], true)['basePrice'], 0.0, 'ยังไม่ตั้งราคา');
    });
});

group('ตัวช่วยเติมช่องในฟอร์ม');

test('ค่าที่แคตตาล็อกมีอยู่แล้ว ถูกส่งกลับไปให้ฟอร์มเลือก แยกตามชนิดสินค้า', function () {
    withRollback(function () {
        $hints = Inventory::productHints('Lens');

        ok(isset($hints['values']['coating']), 'ต้องมีรายการ Coating');
        ok(isset($hints['values']['lens_index']), 'ต้องมีรายการ Index');
        ok(isset($hints['values']['model']), 'ต้องมีรายการรุ่น');

        foreach ($hints['values'] as $key => $list) {
            foreach ($list as $v) {
                ok($v !== '' && $v !== 'null', "ค่าของ {$key} ต้องไม่ว่างและไม่ใช่คำว่า null");
            }
        }

        // Scoped to the type: a frame's colours are not a lens's coatings.
        ok(!isset(Inventory::productHints('Lens')['values']['color']), 'เลนส์ไม่ควรมีรายการสี');
        ok(isset(Inventory::productHints('Frame')['values']['color']), 'กรอบแว่นควรมีรายการสี');
    });
});

group('ใบสั่ง RX เขียนเลนส์ไว้บนใบ');

test('กรอกแบรนด์ รุ่น Coating Index บนใบ แล้วระบบตั้งชื่อรุ่นให้เอง', function () {
    withRollback(function () {
        $out = \Optic\Service\Rx::order([
            'brand'        => 'Nikon',
            'lens_model'   => 'Presio',
            'lens_coating' => 'MultiCoat',
            'lens_index'   => '1.60',
            'sph'          => '-2.25',
            'cyl'          => '-0.50',
            'sale_price'   => '7900',
        ], Roles::OWNER, 1);

        eq($out['name'], 'Nikon Presio MultiCoat (1.60)', 'ชื่อรุ่นที่ระบบตั้งให้');
        ok(str_starts_with($out['sku'], 'RX-'), 'ต้องเป็นรุ่นสั่งตัด');

        // ค่าสายตาอยู่บนใบ ไม่ใช่บนตัวรุ่น — นี่คือเหตุผลของ migration 011
        $product = Db::one('SELECT attributes FROM products WHERE sku = ?', [$out['sku']]);
        $attrs = json_decode((string) $product['attributes'], true);
        ok(!isset($attrs['sph']), 'รุ่นต้องไม่มี SPH');
        ok(!isset($attrs['cyl']), 'รุ่นต้องไม่มี CYL');
        eq($attrs['coating'], 'MultiCoat', 'แต่ Coating เป็นของรุ่น');

        $rx = Db::one('SELECT sph, cyl, sale_price FROM rx_orders WHERE log_id = ?', [$out['id']]);
        eq((string) $rx['sph'], '-2.25', 'SPH อยู่บนใบสั่ง');
        eq((string) $rx['sale_price'], '7900.00', 'ราคาต่อใบอยู่บนใบสั่ง');
    });
});

test('สั่งเลนส์เดียวกันอีกใบ ใช้รุ่นเดิม ไม่สร้างซ้ำ — แต่ค่าบนใบต่างกันได้', function () {
    withRollback(function () {
        $lens = [
            'brand'        => 'Nikon',
            'lens_model'   => 'Presio',
            'lens_coating' => 'MultiCoat',
            'lens_index'   => '1.60',
        ];

        $first = \Optic\Service\Rx::order($lens + ['sph' => '-1.00', 'sale_price' => '7900'], Roles::OWNER, 1);
        $second = \Optic\Service\Rx::order($lens + ['sph' => '-4.50', 'sale_price' => '8400'], Roles::OWNER, 1);

        eq($second['sku'], $first['sku'], 'สองใบต้องชี้รุ่นเดียวกัน');
        eq(
            (int) Db::value('SELECT COUNT(*) FROM products WHERE name = ?', [$first['name']]),
            1,
            'แคตตาล็อกต้องมีรุ่นนี้แถวเดียว',
        );

        $a = Db::one('SELECT sph, sale_price FROM rx_orders WHERE log_id = ?', [$first['id']]);
        $b = Db::one('SELECT sph, sale_price FROM rx_orders WHERE log_id = ?', [$second['id']]);
        ok($a['sph'] !== $b['sph'], 'ค่าสายตาของสองใบต่างกัน');
        ok($a['sale_price'] !== $b['sale_price'], 'ราคาของสองใบต่างกัน');
    });
});

test('ไม่บอกเลนส์เลย ถูกปฏิเสธ', function () {
    withRollback(function () {
        throwsReason(
            'missing_field',
            fn() => \Optic\Service\Rx::order(['sale_price' => '7900'], Roles::OWNER, 1),
            'เปิดใบสั่งโดยไม่บอกว่าสั่งเลนส์อะไร',
        );
    });
});
