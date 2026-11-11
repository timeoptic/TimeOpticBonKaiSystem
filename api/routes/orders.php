<?php
/**
 * Custom (prescription) orders — the shop's main money document.
 *
 * An order moves through: created → filled with real stock items → closed.
 * Closing marks its lens/frame rows sold and books the remaining balance.
 */
declare(strict_types=1);

/* Bewell: ใบเบิกเลนส์ — บันทึกการใช้เลนส์ / ยกเลิกเมื่อออเดอร์หรือเคสถูกยกเลิก (ไม่พึ่งลำดับโหลด routes/lens.php) */
require_once __DIR__ . '/../services/LensRequisition.php';

const ORDER_COLS = ['case_id', 'customer_id', 'employee_id', 'recorded_by',
    'final_prescription_id', 'order_date', 'appointment_date', 'appointment_time',
    'lens_type', 'frame_product_id', 'frame_name', 'frame_brand', 'frame_model',
    'frame_color', 'frame_size', 'frame_sku', 'frame_type', 'lens_product_id', 'right_lens_product_id',
    'lens_name', 'lens_brand', 'lens_design', 'lens_index', 'lens_coating', 'lens_tint',
    'lens_addons', 'lens_r_name', 'lens_r_sku', 'lens_l_name', 'lens_l_sku',
    'lens_r_rx_id', 'lens_r_rx_doc', 'lens_l_rx_id', 'lens_l_rx_doc',
    'frame_price', 'lens_od_price', 'lens_os_price', 'options_price',
    'total_price', 'discount', 'deposit', 'deposit_pay_type',
    'marketing', 'notes', 'frame_remote'];

const INT_ORDER_COLS = ['frame_remote', 'case_id', 'customer_id', 'employee_id', 'recorded_by',
    'final_prescription_id', 'frame_product_id', 'lens_product_id', 'right_lens_product_id',
    'lens_r_rx_id', 'lens_l_rx_id'];

const MONEY_ORDER_COLS = ['frame_price', 'lens_od_price', 'lens_os_price', 'options_price',
    'total_price', 'discount', 'deposit'];

/**
 * เลนส์สั่งตัด RX — ยี่ห้อ/ดีไซน์/index/โค้ตติ้ง ของออเดอร์เอามาจากรุ่นในคลัง
 *
 * เลนส์สต็อกได้สี่ช่องนี้จากชิ้นที่เลือกในฟอร์ม แต่การ์ดสั่งตัด RX ได้กลับมาแค่ชื่อกับ SKU
 * ออเดอร์ RX จึงเคยบันทึกสี่ช่องนี้ว่าง แล้วใบสั่งซื้อพิมพ์ Type กับ Lens ไม่ขึ้น
 * (ออเดอร์ 10467, 14 ก.ย. 2026)
 *
 * รุ่นในคลังเป็นตัวจริง เขียนทับค่าที่ส่งมา เพราะตอนแก้ออเดอร์ฟอร์มส่งสเปกเดิมกลับมาทุกครั้ง
 * เปลี่ยนรุ่น RX แล้วของเก่าจะได้ไม่ค้าง · ยึดข้างขวาเป็นตัวแทนเหมือนเลนส์สต็อก
 * ออเดอร์ที่มีล็อตเลนส์สต็อกอยู่ด้วยไม่แตะ ฟอร์มเติมจากชิ้นสต็อกไปแล้ว
 */
function rxLensSpec(array $b): array
{
    $p = rxLensProduct($b);
    if (!$p) {
        return $b;
    }
    $b['lens_brand']   = $p['brand'];
    $b['lens_design']  = (string) ($p['attrs']['lens_design'] ?? '');
    $b['lens_index']   = (string) ($p['attrs']['lens_index'] ?? '');
    $b['lens_coating'] = (string) ($p['attrs']['coating'] ?? '');
    return $b;
}

/**
 * รุ่นในคลังของเลนส์สั่งตัด RX ที่ออเดอร์ใช้ — ข้างขวาก่อน ไม่มีค่อยข้างซ้าย
 *
 * null เมื่อออเดอร์มีล็อตเลนส์สต็อก ไม่มีใบสั่งตัด หรือหา SKU ในคลังไม่เจอ
 * ใช้ทั้งตอนบันทึก (rxLensSpec) และตอนอ่าน (orderDetail ส่งรุ่นให้ใบสั่งซื้อ)
 *
 * @return array{brand:string, attrs:array<string,mixed>}|null
 */
function rxLensProduct(array $o): ?array
{
    if (int_or($o['lens_product_id'] ?? null) || int_or($o['right_lens_product_id'] ?? null)) {
        return null;
    }
    foreach (['r', 'l'] as $side) {
        $sku = trim((string) ($o["lens_{$side}_sku"] ?? ''));
        if (!int_or($o["lens_{$side}_rx_id"] ?? null) || $sku === '') {
            continue;
        }
        $p = Db::get('SELECT brand, attributes FROM products WHERE sku = ?', $sku);
        if (!$p) {
            continue;
        }
        $attrs = json_decode((string) ($p['attributes'] ?? ''), true);
        return ['brand' => (string) ($p['brand'] ?? ''), 'attrs' => is_array($attrs) ? $attrs : []];
    }
    return null;
}

/**
 * ใบสั่งตัด RX ที่ฟอร์มส่งมา ถ้าถูกแทนด้วยใบใหม่ไปแล้ว ให้ตามไปใบล่าสุด
 *
 * คลังกด "เจียร์เสีย" แล้วเปิดใบใหม่แทน ช่องเลนส์ของออเดอร์ย้ายไปชี้ใบใหม่ (ร้านขอ 30 ก.ย. 2026)
 * แต่ฟอร์มออเดอร์ที่เปิดค้างไว้ก่อนหน้านั้นยังถือเลขใบเดิม กดบันทึกแล้วจะเขียนทับกลับไปชี้ใบ
 * ที่เสีย · ใบที่มีใบแทนจึงไม่ถูกเก็บลงออเดอร์ เก็บใบที่มาแทนมันแทน
 */
function rxFollow(array $b): array
{
    foreach (['r', 'l'] as $side) {
        $id = int_or($b["lens_{$side}_rx_id"] ?? null);
        for ($hop = 0; $id && $hop < 10; $hop++) {
            $next = Db::get(
                'SELECT nx.log_id, g.reference_doc
                   FROM rx_orders nx JOIN inventory_logs g ON g.id = nx.log_id
                  WHERE nx.replaces_log_id = ?',
                $id
            );
            if (!$next) {
                break;
            }
            $id = (int) $next['log_id'];
            $b["lens_{$side}_rx_id"]  = $id;
            $b["lens_{$side}_rx_doc"] = $next['reference_doc'];
        }
    }
    return $b;
}

/**
 * เลนส์สั่งตัดของช่องนี้: มาถึงหรือยัง เจียร์เสียไหม และเคยเสียมาแล้วกี่ใบ
 *
 * `scraps` คือใบที่เจียร์เสียของช่องนี้ ใหม่ไปเก่า — ใบที่ผูกอยู่ตอนนี้ถ้ามันเสีย (คลังยังไม่ได้
 * สั่งใหม่) ตามด้วยใบก่อนหน้าที่ใบนี้เปิดมาแทน · ไม่ส่งชื่อคนทำเสียออกมา หน้าร้านต้องรู้ว่า
 * เลนส์เสีย ไม่ใช่ว่าใครทำ
 *
 * @return array{arrived_at:?string, scrapped_at:?string, scraps:list<array{doc:?string,scrapped_at:string,note:?string}>}
 */
function rxLensState(int $rxId): array
{
    $out = ['arrived_at' => null, 'scrapped_at' => null, 'scraps' => [], 'gone' => false];
    $id = $rxId;
    for ($hop = 0; $id && $hop < 10; $hop++) {
        $r = Db::get(
            'SELECT r.arrived_at, r.scrapped_at, r.cancelled_at, r.cancelled_note, r.replaces_log_id,
                    g.reference_doc
               FROM rx_orders r JOIN inventory_logs g ON g.id = r.log_id
              WHERE r.log_id = ?',
            $id
        );
        if (!$r) {
            /* ใบที่ออเดอร์ผูกไว้ถูกลบที่หน้าคลังไปแล้ว (เคส 13 ต.ค. 2026: CASE-2026-00001 ข้างซ้าย
               ค้าง RX-2026-0044 ใบ #6517 ที่ไม่มีแล้ว ส่วนเลข 0044 ไปเป็นของลูกค้าอีกคน) */
            $out['gone'] = $hop === 0;
            break;
        }
        /* ใบเจียร์เสียก็มี cancelled_at แต่ยังเป็นใบของข้างนี้ — ยกเลิกเฉย ๆ ถึงนับว่าไม่มีแล้ว */
        if ($hop === 0 && $r['cancelled_at'] !== null && $r['scrapped_at'] === null) {
            $out['gone'] = true;
            break;
        }
        if ($hop === 0) {
            $out['arrived_at']  = $r['arrived_at'];
            $out['scrapped_at'] = $r['scrapped_at'];
        }
        if ($r['scrapped_at'] !== null) {
            $out['scraps'][] = [
                'doc'         => $r['reference_doc'],
                'scrapped_at' => $r['scrapped_at'],
                'note'        => $r['cancelled_note'],
            ];
        }
        $id = (int) ($r['replaces_log_id'] ?? 0);
    }
    return $out;
}

function orderVals(array $b): array
{
    $b = rxFollow(rxLensSpec($b));
    $hasBreakdown = array_key_exists('frame_price', $b) || array_key_exists('lens_od_price', $b)
        || array_key_exists('lens_os_price', $b) || array_key_exists('options_price', $b);
    if ($hasBreakdown) {
        $b['total_price'] = num($b['frame_price'] ?? null) + num($b['lens_od_price'] ?? null)
            + num($b['lens_os_price'] ?? null) + num($b['options_price'] ?? null);
    }
    $total    = num($b['total_price'] ?? null);
    $discount = num($b['discount'] ?? null);
    if ($discount > $total) {
        bad('ส่วนลดห้ามมากกว่ายอดรวม');
    }

    /* ช่องบนหน้าจอเป็นตัวเลือกล็อก แต่ API กันเองด้วย — ไม่งั้นยิงตรงเข้ามาได้คำสิบแบบ
       ในสิบใบ แล้วนับทีหลังไม่ได้ว่าใบไหนกรอบเจาะ · ไม่เลือก = NULL (ผ่าน nul() ข้างล่าง) */
    $b['frame_type'] = trim((string) ($b['frame_type'] ?? ''));
    /* บังคับเลือกตั้งแต่ 11 พ.ย. 2026 (ร้านขอ) — ค่าคอมงานเจียใน HRMS คิดจากประเภทกรอบ
       ใช้ทั้งสร้างและแก้ออเดอร์ · ใบเก่าที่ยังว่างต้องเลือกก่อนบันทึกแก้ครั้งถัดไป */
    if ($b['frame_type'] === '') {
        bad('กรุณาเลือกประเภทกรอบ');
    }
    if (!in_array($b['frame_type'], Lookups::FRAME_TYPES, true)) {
        bad('ประเภทกรอบไม่อยู่ในรายการ');
    }

    /* กรอบจากคลังอีกสาขา (FrameRemote) — id ที่หน้าเว็บส่งมาเป็นล็อตของ *อีกระบบ*
       เก็บลง frame_product_id ไม่ได้ (ชี้ไปล็อตอื่นของที่นี่) · จำแค่ SKU แล้วตัดด้วย SKU */
    if ((int) ($b['frame_remote'] ?? 0) === 1 && trim((string) ($b['frame_sku'] ?? '')) !== '') {
        $b['frame_remote']     = 1;
        $b['frame_product_id'] = null;
    } else {
        $b['frame_remote'] = null;
    }

    $out = [];
    foreach (ORDER_COLS as $c) {
        if (in_array($c, INT_ORDER_COLS, true)) {
            $out[] = int_or($b[$c] ?? null);
        } elseif (in_array($c, MONEY_ORDER_COLS, true)) {
            $out[] = num($b[$c] ?? null);
        } elseif ($c === 'order_date') {
            $out[] = str_or($b['order_date'] ?? null) ?: nowStamp();
        } else {
            $out[] = nul($b[$c] ?? null);
        }
    }
    return $out;
}

/** the three slots an order can hold a stock unit in */
const ORDER_STOCK_SLOTS = ['lens_product_id', 'right_lens_product_id', 'frame_product_id'];

/**
 * Move the order's hold on stock from whatever it was pointing at to what it
 * points at now, one slot at a time.
 *
 * เลือกสินค้าเข้าออเดอร์ = ตัดสต็อกทันที ซึ่งแปลว่า /fill เรียกซ้ำได้ต้องไม่ทำให้
 * ของหายทีละชิ้น: ช่องไหนเลขเปลี่ยน คืนชิ้นเดิมเข้าคลังก่อน แล้วค่อยตัดชิ้นใหม่
 * ช่องไหนเลขเดิมไม่ต้องแตะ — คืนแล้วตัดซ้ำจะได้ inventory_logs สองแถวที่ไม่มีอะไรเกิดขึ้นจริง
 *
 * @param array<string,?int> $before  slot => stock_lot id the order held
 * @param array<string,?int> $after   slot => stock_lot id the order should hold
 */
function moveOrderStock(Tx $q, array $before, array $after, string $note): void
{
    $release = [];
    $take    = [];
    foreach (ORDER_STOCK_SLOTS as $slot) {
        $old = $before[$slot] ? (int) $before[$slot] : null;
        $new = $after[$slot] ? (int) $after[$slot] : null;
        if ($old === $new) {
            continue;
        }
        if ($old) {
            $release[] = $old;
        }
        if ($new) {
            $take[] = $new;
        }
    }
    /* คืนให้หมดก่อนแล้วค่อยหยิบ — ย้ายชิ้นเดิมจากช่องหนึ่งไปอีกช่องหนึ่งจะได้ไม่ไป
       ติดว่า "ชิ้นนี้ถูกขายแล้ว" ด้วยตัวมันเองที่ยังไม่ได้คืน */
    foreach ($release as $lot) {
        releaseLot($q, $lot, "คืนของ: $note");
    }
    foreach ($take as $lot) {
        if (!pickLot($q, $lot, $note)) {
            bad('สินค้าชิ้นนี้ถูกขายไปแล้วระหว่างนี้ — เลือกชิ้นอื่น');
        }
    }
}

function orderDetail(?int $id): array
{
    $sel  = Sql::ORDER_SELECT;
    $from = Sql::ORDER_FROM;

    $o = Db::get(
        "SELECT $sel, c.sex, c.email, c.nationality, c.notes AS customer_notes $from WHERE o.id = ?",
        $id
    );
    if (!$o) {
        missing();
    }
    $o['prescription'] = $o['final_prescription_id']
        ? Db::get('SELECT * FROM prescriptions WHERE id = ?', (int) $o['final_prescription_id'])
        : null;

    /* v_stock_lot_all ไม่ใช่ v_stock_lot — ออเดอร์จากระบบเดิมชี้ไปที่ของใน legacy_stock
       ซึ่งไม่อยู่ในคลังจริงแล้ว (ดู migration 032) */
    $item = fn($sid) => $sid ? Db::get('SELECT * FROM v_stock_lot_all WHERE id = ?', (int) $sid) : null;
    $o['left_lens']  = $item($o['lens_product_id']);
    $o['right_lens'] = $item($o['right_lens_product_id']);
    $o['frame']      = $item($o['frame_product_id']);
    if (!$o['frame'] && (int) ($o['frame_remote'] ?? 0) === 1) {
        /* กรอบจากคลังอีกสาขา — ไม่มีล็อตที่นี่ ประกอบจาก snapshot ในออเดอร์ให้หน้าแก้ออเดอร์เห็นชิ้นเดิม */
        $o['frame'] = [
            'id' => null, 'remote' => 1, 'sku' => $o['frame_sku'], 'product_name' => $o['frame_name'],
            'brand' => $o['frame_brand'], 'model' => $o['frame_model'], 'color' => $o['frame_color'],
            'size' => $o['frame_size'], 'remaining_qty' => null,
            'location' => class_exists('FrameRemote') ? 'คลัง' . FrameRemote::label() : null,
        ];
    }
    /* Bewell: เลนส์ที่เลือกจากรายการเลนส์ไม่ผูกล็อต left_lens/right_lens จึงว่างเสมอ —
       หาเลนส์ในรายการจาก SKU ของแต่ละข้าง หน้าแก้ออเดอร์จะได้ขึ้นเลนส์ที่เลือกไว้แทนช่องว่าง
       ไม่กรอง active: เลนส์ที่ปิดไปแล้วยังต้องเห็นในออเดอร์ที่ขายไปแล้ว */
    $cat = fn($code) => $code ? (Db::get('SELECT * FROM lens_catalog WHERE code = ?', (string) $code) ?: null) : null;
    $o['lens_catalog_r'] = $o['left_lens'] ? null : $cat($o['lens_r_sku'] ?? null);
    $o['lens_catalog_l'] = $o['right_lens'] ? null : $cat($o['lens_l_sku'] ?? null);
    /* ใบเบิกที่ส่งรายการเบิกไปแล้ว POST /api/lens-requisitions/sync ปฏิเสธ (lens_req_locked) —
       บอกหน้าแก้ออเดอร์ก่อน จะได้ล็อกช่องเลนส์ไว้ แทนที่จะปล่อยให้เลือกใหม่แล้วชื่อในออเดอร์เปลี่ยน
       แต่ใบเบิกยังเป็นตัวเดิม · ยืนยันขั้นขายแล้วยังเปลี่ยนได้ ไม่ล็อก (ดู /sync) */
    $req = Db::get(
        "SELECT status FROM lens_requisitions
          WHERE order_id = ? AND status <> 'cancelled' ORDER BY id DESC LIMIT 1",
        (int) $o['id']
    );
    $o['lens_locked'] = $req && $req['status'] !== 'pending'
        ? 'ส่งรายการเบิกเลนส์ไปแล้ว — ยกเลิกใบเบิกเดิมก่อนถ้าต้องการเปลี่ยนเลนส์'
        : null;
    /* รุ่นของเลนส์สั่งตัด RX — custom_orders ไม่มีคอลัมน์รุ่น เลนส์สต็อกได้รุ่นจากล็อตข้างบน
       RX ไม่มีล็อตจึงอ่านจากสินค้าในคลังตาม SKU · ใบสั่งซื้อพิมพ์ "Zeiss · Digital lenses …" */
    $o['lens_model'] = (string) (rxLensProduct($o)['attrs']['model'] ?? '') ?: null;

    /* เลนส์สั่งตัดแต่ละข้างมาถึงร้านเมื่อไร — คลังติ๊กบนหน้าใบสั่งตัด (ร้านขอไว้ 14 ก.ย. 2026)
       การ์ดเลนส์ในหน้าเคสขึ้น "เลนส์เข้าแล้ว" หรือ "รอเลนส์" จากช่องนี้ · null = ยังไม่มา
       หรือข้างนั้นไม่ได้สั่งตัด */
    foreach (['r', 'l'] as $side) {
        $rxId = (int) ($o["lens_{$side}_rx_id"] ?? 0);
        $lens = $rxId ? rxLensState($rxId) : null;
        /* ใบที่ไม่มีแล้วในคลังห้ามขึ้นเป็นการ์ด "สั่งตัดแล้ว" — การ์ดซ่อนปุ่มสั่งตัดของข้างนั้น
           ข้างนั้นจึงเปิดใบใหม่ไม่ได้จนกว่าจะกดล้าง · ตัดลิงก์ออกจากคำตอบ ฟอร์มจะได้ขึ้นปุ่มสั่งตัด
           ตามปกติ และบันทึกครั้งถัดไปก็ล้างค่าค้างในฐานไปเอง */
        $o["lens_{$side}_rx_gone_doc"] = null;
        if ($lens && $lens['gone']) {
            $o["lens_{$side}_rx_gone_doc"] = $o["lens_{$side}_rx_doc"] ?? null;
            $o["lens_{$side}_rx_id"]  = null;
            $o["lens_{$side}_rx_doc"] = null;
            $lens = null;
        }
        $o["lens_{$side}_rx_arrived_at"] = $lens['arrived_at'] ?? null;
        /* เจียร์เสีย (ร้านขอ 30 ก.ย. 2026) — `scrapped_at` คือใบที่ผูกอยู่ตอนนี้เสียและคลังยังไม่ได้
           สั่งใหม่ · `scraps` คือทุกใบของข้างนี้ที่เคยเสีย การ์ดเลนส์บอกได้ว่าใบนี้สั่งแทนใบไหน */
        $o["lens_{$side}_rx_scrapped_at"] = $lens['scrapped_at'] ?? null;
        $o["lens_{$side}_rx_scraps"]      = $lens['scraps'] ?? [];
    }

    $o['payment_rows'] = Db::all(
        'SELECT p.*, e.employee_name AS received_by_name FROM payments p
           LEFT JOIN employees e ON e.id = p.received_by
          WHERE p.order_id = ? ORDER BY p.paid_at',
        $id
    );
    $o['balance'] = round2((float) $o['total_price'] - (float) $o['discount'] - (float) $o['paid']);
    return $o;
}

GET('/api/orders', function (array $req) {
    $q      = $req['query'];
    $status = str_or($q['status'] ?? null, 'all') ?: 'all';
    $where  = [];
    $args   = [];
    $unf    = Sql::UNFILLED;

    if ($status === 'unfilled') {
        $where[] = "o.order_closed = 0 AND $unf";
    } elseif ($status === 'unclosed') {
        $where[] = "o.order_closed = 0 AND NOT $unf";
    } elseif ($status === 'open') {
        $where[] = 'o.order_closed = 0';
    } elseif ($status === 'closed') {
        $where[] = 'o.order_closed = 1';
    }

    if ($cid = int_or($q['customer_id'] ?? null)) {
        $where[] = 'o.customer_id = ?';
        $args[]  = $cid;
    }
    if ($caseId = int_or($q['case_id'] ?? null)) {
        $where[] = 'o.case_id = ?';
        $args[]  = $caseId;
    }
    if ($term = str_or($q['q'] ?? null)) {
        $p = like($term);
        /* ตารางโชว์เลขเคสแทน INV แล้ว (15 ก.ย. 2026) — พิมพ์เลขที่เห็นต้องเจอ · INV ยังค้นได้เผื่อเลขเก่า */
        $where[] = '(c.first_name LIKE ? OR c.last_name LIKE ? OR c.phone LIKE ?
                  OR cs.case_code LIKE ? OR o.invoice_code LIKE ? OR o.lens_name LIKE ? OR o.frame_name LIKE ?
                  OR CAST(o.id AS CHAR) = ?)';
        array_push($args, $p, $p, $p, $p, $p, $p, $p, $term);
    }
    if ($fromDate = str_or($q['from'] ?? null)) {
        $where[] = 'DATE(o.order_date) >= ?';
        $args[]  = $fromDate;
    }
    if ($toDate = str_or($q['to'] ?? null)) {
        $where[] = 'DATE(o.order_date) <= ?';
        $args[]  = $toDate;
    }

    $sel      = Sql::ORDER_SELECT;
    $from     = Sql::ORDER_FROM;
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $args[]   = min(int_or($q['limit'] ?? null, 200), 2000);

    return Db::all(
        "SELECT $sel $from $sqlWhere ORDER BY o.order_date DESC, o.id DESC LIMIT ?",
        ...$args
    );
});

GET('/api/orders/:id', fn(array $r) => orderDetail(int_or($r['params']['id'])));

POST('/api/orders', function (array $req) {
    $body = $req['body'];
    $cid  = int_or($body['customer_id'] ?? null);
    if (!$cid) {
        bad('กรุณาเลือกลูกค้า');
    }
    if (!Db::get('SELECT id FROM customers WHERE id = ?', $cid)) {
        bad('ไม่พบลูกค้ารายนี้');
    }
    $code = str_or($body['invoice_code'] ?? null)
        ?: nextCode('INV', 'custom_orders', 'invoice_code');

    $id = Db::tx(function (Tx $q) use ($body, $code, $cid) {
        /* กันกดปุ่ม "เปิดออเดอร์" ซ้ำ — ปุ่มไม่ล็อกระหว่างรอ กดสองทีได้ออเดอร์สองใบ
           ใบแรกไม่มีเงินไม่มีสต็อก แต่รายงานนับยอดขายและยอดค้างซ้ำ (เจอ 12 เคสบนร้าน
           เช่น CASE-2026-00140, 00159 เมื่อ 28 ก.ย. 2026) · ล็อกแถวลูกค้าให้คำขอที่ยิง
           มาพร้อมกันเข้าคิวทีละคำขอ แล้วถ้ามีใบของลูกค้า+เคสเดียวกัน ราคาเท่ากัน เพิ่งเปิด
           ไม่เกิน 30 วินาที ให้ส่งใบเดิมกลับไปแทนการเปิดใบใหม่ */
        $q->get('SELECT id FROM customers WHERE id = ? FOR UPDATE', $cid);
        $dup = $q->get(
            'SELECT id FROM custom_orders
              WHERE customer_id = ? AND case_id <=> ? AND total_price = ?
                AND created_at >= NOW() - INTERVAL 30 SECOND
              ORDER BY id DESC LIMIT 1',
            $cid,
            int_or($body['case_id'] ?? null),
            /* ราคาจาก orderVals() ไม่ใช่ body ตรง ๆ — ฟอร์มบางหน้าไม่ส่ง total_price
               มา ให้ API รวมจากราคาชิ้นเอง */
            orderVals($body)[array_search('total_price', ORDER_COLS, true)]
        );
        if ($dup) {
            return (int) $dup['id'];
        }

        $names = implode(',', ORDER_COLS);
        $marks = implode(',', array_fill(0, count(ORDER_COLS), '?'));
        $r = $q->run(
            "INSERT INTO custom_orders (invoice_code, $names) VALUES (?, $marks)",
            ...[$code, ...orderVals($body)]
        );
        $oid     = $r['insertId'];
        $deposit = num($body['deposit'] ?? null);

        /* ไม่ออกเลขใบเสร็จตรงนี้แล้ว (ตั้งแต่ 13 ต.ค. 2026) — เลขเกิดเมื่อกด "ออกใบเสร็จ"
           เท่านั้น ดู routes/receipts.php */

        if ($deposit > 0) {
            $q->run(
                'INSERT INTO payments (case_id, order_id, kind, method, amount, received_by, notes)
                 VALUES (?,?,?,?,?,?,?)',
                int_or($body['case_id'] ?? null),
                $oid,
                'deposit',
                str_or($body['deposit_pay_type'] ?? null, 'Cash') ?: 'Cash',
                $deposit,
                int_or($body['employee_id'] ?? null),
                'มัดจำตอนเปิดออเดอร์'
            );
        }
        logEvent($q, int_or($body['case_id'] ?? null), [
            'action'      => 'order_created',
            'entity'      => 'custom_order',
            'entity_id'   => $oid,
            'employee_id' => int_or($body['employee_id'] ?? null),
            'note'        => $code,
        ]);
        if (int_or($body['case_id'] ?? null)) {
            setStatus($q, int_or($body['case_id']), $deposit > 0 ? 'appointment' : 'order_confirm', [
                'employee_id' => int_or($body['employee_id'] ?? null),
                'action'      => 'order_created',
            ]);
        }
        return $oid;
    });
    /* Bewell: ใบสั่งตัด RX ของออเดอร์ → คำขอในคลัง TimeOptic (ส่งเฉพาะเคสที่ยืนยันขายแล้ว) */
    TimeOpticRx::afterOrderSave($id, LensRequisition::actorEmployee());

    return orderDetail($id);
});

PUT('/api/orders/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    $cur = Db::get('SELECT id, order_date, appointment_date, appointment_time FROM custom_orders WHERE id = ?', $id);
    if (!$cur) {
        missing();
    }
    /* วันนัดรับกรอกที่ขั้นชำระเงิน ฟอร์มขายไม่มีช่องนี้ — ไม่ได้ส่งมา = คงค่าเดิม ไม่ใช่ล้างทิ้ง
       (กดบันทึกแก้ไขแล้ววันนัดหาย ร้านเจอ 31 ต.ค. 2026) · ล้างวันนัดจริงเดินทาง PUT .../appointment */
    $body = $req['body'];
    foreach (['appointment_date', 'appointment_time'] as $c) {
        if (!array_key_exists($c, $body)) {
            $body[$c] = $cur[$c];
        }
    }
    /* วันเปิดบิลไม่ใช่ช่องของฟอร์มแก้ออเดอร์ (หน้าขายไม่ได้ส่งมา) — orderVals() เติม
       "ตอนนี้" ให้ช่องที่ว่าง กดบันทึกแก้ไขแล้ววันเปิดบิลเลยกลายเป็นวันที่กด (ร้านเจอ 2 ต.ค. 2026)
       · แก้วันเปิดบิลจริงเดินทาง PUT /api/orders/:id/order-date */
    $body['order_date'] = $cur['order_date'];
    $set = implode(',', array_map(fn($c) => "$c=?", ORDER_COLS));
    Db::run("UPDATE custom_orders SET $set WHERE id=?", ...[...orderVals($body), $id]);
    syncSoldStock($id, int_or($body['employee_id'] ?? null));
    /* Bewell: ใบสั่งตัด RX ถูกยกเลิก/เปลี่ยน = ถอนคำขอเดิม · ขายแล้ว = ส่งใบสั่งใหม่ */
    TimeOpticRx::afterOrderSave($id, LensRequisition::actorEmployee());
    return orderDetail($id);
});

/**
 * ออเดอร์ที่ยืนยันขายไปแล้ว — บันทึกแก้ไขแล้วสต็อกต้องตามทันที
 *
 * ของออกจากคลังตอนยืนยันขั้นขาย (processes.php) แต่หลังจากนั้นฟอร์มขายยังแก้ได้
 * เดิมเปลี่ยนเลนส์แล้วกด "บันทึกการแก้ไข" ชิ้นเก่าไม่คืน ชิ้นใหม่ไม่ตัด จนกว่าจะเปิด
 * ขั้นขายแล้วยืนยันใหม่ (ร้านเจอ 3 ต.ค. 2026) · issueForCase เทียบกับที่ตัดไว้แล้วเอง:
 * ช่องเดิมข้าม ช่องที่เปลี่ยนคืนชิ้นเก่าแล้วตัดชิ้นใหม่ ช่องที่ล้างทิ้งคืนของ
 *
 * ยังไม่ยืนยันขาย = ยังไม่มีอะไรถูกตัด ไม่แตะ (ตัดตอนกดยืนยันตามเดิม)
 * ตัดไม่สำเร็จ = ทำแบบเดียวกับตอนยืนยัน: เปิดขั้นขายกลับเป็น "กำลังทำ" แล้วโยนสาเหตุ
 * ให้คนกดเห็น · ออเดอร์ที่แก้ถูกบันทึกไปแล้ว แก้สาเหตุแล้วกดยืนยันขายใหม่ได้
 *
 * @return array|null ผลของ issueForCase หรือ null เมื่อไม่ต้องทำอะไร
 */
function syncSoldStock(int $orderId, ?int $employeeId): ?array
{
    $caseId = (int) (Db::get('SELECT case_id FROM custom_orders WHERE id = ?', $orderId)['case_id'] ?? 0);
    if (!$caseId) {
        return null;
    }
    $sold = Db::get(
        "SELECT id FROM case_processes
          WHERE case_id = ? AND process = 'sales' AND status = 'completed' AND completed_at IS NOT NULL",
        $caseId
    );
    if (!$sold) {
        return null;
    }
    try {
        return CaseStock::issueForCase(caseDetail($caseId), $employeeId);
    } catch (Throwable $e) {
        Db::tx(function (Tx $q) use ($caseId, $e) {
            saveProcess($q, $caseId, 'sales', ['status' => 'in_progress', 'completed_at' => null]);
            logEvent($q, $caseId, [
                'action' => 'stock_issue_failed', 'entity' => 'case_process',
                'note'   => mb_substr('บันทึกแก้ไขออเดอร์: ' . $e->getMessage(), 0, 250),
            ]);
        });
        throw $e;
    }
}

/**
 * วันนัดรับ — คอลัมน์เดียวของออเดอร์ ไม่ใช่ทั้งใบ
 *
 * PUT /api/orders/:id เขียนทับทุกคอลัมน์ใน ORDER_COLS ยิงมาแค่วันนัดรับเส้นนั้น
 * จะล้างราคา/สินค้า/ส่วนลดทิ้งหมด ขั้น "ชำระเงิน" จึงต้องมีเส้นที่แตะแค่ช่องเดียว
 *
 * ค่าว่างแปลว่า "ยังไม่กำหนด" (ล้างวันนัด) ไม่ใช่ "ไม่เปลี่ยน" — ฟิลด์นี้ไม่บังคับ
 * กรอก และไม่เกี่ยวกับว่าจ่ายครบหรือยัง เคสที่ค้างเงินก็นัดวันรับได้ตามปกติ
 */
PUT('/api/orders/:id/appointment', function (array $req) {
    $id = int_or($req['params']['id']);
    $o  = Db::get('SELECT id, case_id FROM custom_orders WHERE id = ?', $id);
    if (!$o) {
        missing();
    }
    $date = nul($req['body']['appointment_date'] ?? null);
    if ($date !== null) {
        $date = substr($date, 0, 10);
        [$y, $m, $d] = array_pad(explode('-', $date), 3, '');
        if (!checkdate((int) $m, (int) $d, (int) $y)) {
            bad('วันนัดรับไม่ถูกต้อง');
        }
    }
    Db::tx(function (Tx $q) use ($id, $o, $date, $req) {
        $q->run('UPDATE custom_orders SET appointment_date=? WHERE id=?', $date, $id);
        logEvent($q, int_or($o['case_id']), [
            'action'      => 'appointment_set',
            'entity'      => 'custom_order',
            'entity_id'   => $id,
            'employee_id' => int_or($req['body']['employee_id'] ?? null),
            'note'        => $date ?? 'ล้างวันนัดรับ',
        ]);
    });
    return orderDetail($id);
});

/**
 * วันเปิดบิล (order_date) — แอดมิน/เจ้าของร้านเท่านั้น (ร้านขอ 2 ต.ค. 2026)
 *
 * ใช้ตอนเปิดบิลย้อนหลังแล้ววันที่บนบิลเป็นวันที่คีย์ ไม่ใช่วันที่ขายจริง · แก้จากตาราง
 * หน้ารายงานงานตัดแว่น · เกณฑ์สิทธิ์เดียวกับเปลี่ยนลูกค้าของเคส (`system.zone`)
 *
 * แตะคอลัมน์เดียว เหตุผลเดียวกับวันนัดรับข้างบน · เปลี่ยนแค่วัน เวลาเดิมคงไว้ บิลที่เปิด
 * วันเดียวกันจึงยังเรียงตามลำดับเดิม · เลขใบเสร็จที่ออกแล้วไม่เปลี่ยน (เลขผูกถาวร —
 * routes/receipts.php) อยากให้เลขเรียงตามวันใหม่ใช้ api/cli/renumber-receipts.php
 * บังคับเหตุผล แล้วลงไทม์ไลน์เคส: จากวันไหนเป็นวันไหน ใครแก้
 * เทสต์: api/tests/99-order-date-edit.test.php
 */
PUT('/api/orders/:id/order-date', function (array $req) {
    $actor = StockModule::actor();
    if (!$actor || !\Optic\Roles::systemZone($actor['roles'] ?? [])) {
        throw new HttpError(403, 'แก้วันเปิดบิลได้เฉพาะแอดมินหรือเจ้าของร้าน', ['reason' => 'forbidden']);
    }
    $id = int_or($req['params']['id']);
    $o  = Db::get('SELECT id, case_id, order_date FROM custom_orders WHERE id = ?', $id);
    if (!$o) {
        missing();
    }
    $date = substr(trim((string) ($req['body']['order_date'] ?? '')), 0, 10);
    [$y, $m, $d] = array_pad(explode('-', $date), 3, '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !checkdate((int) $m, (int) $d, (int) $y)) {
        bad('วันเปิดบิลไม่ถูกต้อง');
    }
    if ($date > date('Y-m-d')) {
        bad('วันเปิดบิลต้องไม่เกินวันนี้');
    }
    $reason = trim((string) ($req['body']['reason'] ?? ''));
    if ($reason === '') {
        bad('กรุณาใส่เหตุผลที่แก้วันเปิดบิล');
    }

    $old  = (string) ($o['order_date'] ?? '');
    $time = strlen($old) >= 19 ? substr($old, 11, 8) : '00:00:00';
    $new  = "$date $time";
    if (substr($old, 0, 10) === $date) {
        throw new HttpError(400, 'วันเปิดบิลเป็นวันนี้อยู่แล้ว', ['reason' => 'same_date']);
    }

    Db::tx(function (Tx $q) use ($id, $o, $old, $new, $reason, $actor) {
        $q->run('UPDATE custom_orders SET order_date = ? WHERE id = ?', $new, $id);
        $by = (string) ($actor['displayName'] ?? $actor['username'] ?? '');
        logEvent($q, int_or($o['case_id']), [
            'action'      => 'order_date_changed',
            'entity'      => 'custom_order',
            'entity_id'   => $id,
            'employee_id' => $actor['employeeId'] ?? null,
            'note'        => sprintf('%s → %s · %s', substr($old, 0, 10) ?: '-', substr($new, 0, 10), $reason)
                . ($by !== '' ? " · โดย $by" : ''),
            'payload'     => ['from' => $old ?: null, 'to' => $new],
        ]);
    });
    return orderDetail($id);
});

POST('/api/orders/:id/fill', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $o    = Db::get('SELECT * FROM custom_orders WHERE id = ?', $id);
    if (!$o) {
        missing();
    }
    if ((int) $o['order_closed']) {
        bad('ออเดอร์นี้ปิดการขายแล้ว');
    }

    /* "ขายไปแล้ว" ห้ามหยิบ ยกเว้นชิ้นที่ออเดอร์ใบนี้ถืออยู่แล้ว — ตั้งแต่ /fill
       เป็นคนตัดสต็อก ชิ้นที่เพิ่งเลือกไปก็นับว่าขายแล้วทันที เปิดฟอร์มขึ้นมากด
       บันทึกซ้ำโดยไม่เปลี่ยนอะไรจึงจะโดนปฏิเสธด้วยของของตัวเอง */
    $pick = function (string $key) use ($body, $o) {
        $sid = int_or($body[$key] ?? null);
        if (!$sid) {
            return null;
        }
        $held = in_array($sid, array_map('intval', array_filter([
            $o['lens_product_id'], $o['right_lens_product_id'], $o['frame_product_id'],
        ])), true);
        $s = Db::get('SELECT * FROM v_stock_lot WHERE id = ?', $sid);
        /* ออเดอร์จากระบบเดิมที่ยังไม่ปิดถือของใน legacy_stock อยู่ — บันทึกซ้ำโดยไม่เปลี่ยน
           ชิ้นต้องผ่าน · แต่เลือกของเก่าชิ้นใหม่ไม่ได้ เพราะไม่ใช่ของในคลังจริง (migration 032)
           เปลี่ยนไปเลือกของจริงแทน: releaseLot ของชิ้นเก่าไม่เจอแถวใน stock_lots จึงไม่ทำอะไร */
        if (!$s && $held) {
            $s = Db::get("SELECT * FROM v_stock_lot_all WHERE id = ? AND source = 'legacy'", $sid);
        }
        if (!$s) {
            bad("ไม่พบสินค้ารหัส $sid");
        }
        if ((int) $s['sold'] && !$held) {
            bad("สินค้ารหัส $sid ({$s['product_name']}) ถูกขายไปแล้ว");
        }
        return $s;
    };
    $L = $pick('lens_product_id');
    $R = $pick('right_lens_product_id');
    $F = $pick('frame_product_id');

    Db::tx(function (Tx $q) use ($id, $o, $body, $L, $R, $F) {
        $lensRef  = $L ?? $R;
        $lensName = str_or($body['lens_name'] ?? null)
            ?: ($lensRef ? $lensRef['product_name'] : $o['lens_name']);
        $frameName = str_or($body['frame_name'] ?? null)
            ?: ($F ? $F['product_name'] : $o['frame_name']);

        $q->run(
            'UPDATE custom_orders SET lens_product_id=?, right_lens_product_id=?,
               frame_product_id=?, lens_name=?, frame_name=?, appointment_date=?, notes=?
             WHERE id=?',
            $L ? (int) $L['id'] : null,
            $R ? (int) $R['id'] : null,
            $F ? (int) $F['id'] : null,
            $lensName,
            $frameName,
            nul($body['appointment_date'] ?? null) ?? $o['appointment_date'],
            !array_key_exists('notes', $body) ? $o['notes'] : nul($body['notes']),
            $id
        );
        /* ของออกจากคลังตรงนี้ ไม่ใช่ตอนปิดการขาย — เลือกให้ลูกค้าแล้วชิ้นนั้นเป็นของเขา
           คนอื่นหยิบไม่ได้ (ห้องผลิตซึ่งเคยเป็นคนเบิกไม่มีแล้ว) */
        moveOrderStock(
            $q,
            [
                'lens_product_id'       => int_or($o['lens_product_id']),
                'right_lens_product_id' => int_or($o['right_lens_product_id']),
                'frame_product_id'      => int_or($o['frame_product_id']),
            ],
            [
                'lens_product_id'       => $L ? (int) $L['id'] : null,
                'right_lens_product_id' => $R ? (int) $R['id'] : null,
                'frame_product_id'      => $F ? (int) $F['id'] : null,
            ],
            'เลือกสินค้าเข้าออเดอร์ ' . ($o['invoice_code'] ?? '')
        );
        $parts = array_filter([
            $L ? 'L#' . $L['id'] : null,
            $R ? 'R#' . $R['id'] : null,
            $F ? 'F#' . $F['id'] : null,
        ]);
        logEvent($q, int_or($o['case_id']), [
            'action'      => 'order_filled',
            'entity'      => 'custom_order',
            'entity_id'   => $id,
            'employee_id' => int_or($body['employee_id'] ?? null),
            'note'        => implode(' ', $parts),
        ]);
    });

    return orderDetail($id);
});

POST('/api/orders/:id/close', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $o    = Db::get('SELECT * FROM custom_orders WHERE id = ?', $id);
    if (!$o) {
        missing();
    }
    if ((int) $o['order_closed']) {
        bad('ออเดอร์นี้ปิดการขายไปแล้ว');
    }

    Db::tx(function (Tx $q) use ($id, $o, $body) {
        $paidRow = $q->get(
            'SELECT COALESCE(SUM(amount),0) paid FROM payments WHERE order_id = ? AND cancelled_at IS NULL',
            $id
        );
        $balance = round2((float) $o['total_price'] - (float) $o['discount'] - (float) $paidRow['paid']);

        $rawIncome = $body['order_close_income'] ?? null;
        $income    = ($rawIncome === null || $rawIncome === '') ? $balance : num($rawIncome);

        $stamp   = str_or($body['order_close_date'] ?? null) ?: nowStamp();
        $empId   = int_or($body['order_close_employee_id'] ?? null) ?? int_or($o['employee_id']);
        $payType = str_or($body['order_close_pay_type'] ?? null, 'Cash') ?: 'Cash';

        $q->run(
            'UPDATE custom_orders SET order_closed = 1, order_close_date = ?,
               order_close_employee_id = ?, order_close_income = ?, order_close_pay_type = ?,
               notes = ? WHERE id = ?',
            $stamp,
            $empId,
            $income,
            $payType,
            !array_key_exists('notes', $body) ? $o['notes'] : nul($body['notes']),
            $id
        );

        if ($income > 0) {
            $q->run(
                'INSERT INTO payments (case_id, order_id, kind, method, amount, received_by, paid_at, notes)
                 VALUES (?,?,?,?,?,?,?,?)',
                int_or($o['case_id']),
                $id,
                'final',
                $payType,
                $income,
                $empId,
                $stamp,
                'รับเงินตอนปิดการขาย'
            );
        }
        /* ของถูกตัดไปแล้วตอนเลือกเข้าออเดอร์ (/fill) — ปิดการขายคือเรื่องเงิน ไม่ใช่เรื่องของ */
        logEvent($q, int_or($o['case_id']), [
            'action'      => 'order_closed',
            'entity'      => 'custom_order',
            'entity_id'   => $id,
            'employee_id' => $empId,
            'note'        => 'รับเพิ่ม ' . $income,
        ]);
        if ($o['case_id']) {
            setStatus($q, (int) $o['case_id'], 'completed', [
                'employee_id' => $empId,
                'action'      => 'order_closed',
            ]);
        }
    });

    return orderDetail($id);
});

POST('/api/orders/:id/reopen', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $o    = Db::get('SELECT * FROM custom_orders WHERE id = ?', $id);
    if (!$o) {
        missing();
    }
    Db::tx(function (Tx $q) use ($id, $o, $body) {
        $q->run(
            'UPDATE custom_orders SET order_closed = 0, order_close_date = NULL,
               order_close_income = NULL WHERE id = ?',
            $id
        );
        $q->run("DELETE FROM payments WHERE order_id = ? AND kind = 'final'", $id);
        /* ของยังอยู่กับออเดอร์ — เปิดกลับมาแก้ไม่ได้แปลว่าเอาของคืนขึ้นชั้น
           ถ้าจะคืนจริงคือแก้ที่ /fill ให้เลือกชิ้นอื่นหรือเอาออก */
        logEvent($q, int_or($o['case_id']), [
            'action'      => 'order_reopened',
            'entity'      => 'custom_order',
            'entity_id'   => $id,
            'employee_id' => int_or($body['employee_id'] ?? null),
        ]);
        if ($o['case_id']) {
            setStatus($q, (int) $o['case_id'], 'waiting_pickup', [
                'employee_id' => int_or($body['employee_id'] ?? null),
                'action'      => 'order_reopened',
            ]);
        }
    });
    return orderDetail($id);
});

DELETE('/api/orders/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    $o  = Db::get('SELECT * FROM custom_orders WHERE id = ?', $id);
    if (!$o) {
        missing();
    }
    if ((int) $o['order_closed']) {
        bad('ลบไม่ได้ — ออเดอร์ปิดการขายแล้ว');
    }
    Db::tx(function (Tx $q) use ($id, $o) {
        /* Bewell: ใบเบิกเลนส์ของออเดอร์นี้ถูกยกเลิก ไม่ถูกลบ — ใบจำเลขออเดอร์ไว้ใน order_ref */
        LensRequisition::cancelFor(
            $q, 'order', $id, 'order_deleted',
            'ลบออเดอร์ ' . ($o['invoice_code'] ?? ('#' . $id)),
            LensRequisition::actorEmployee()
        );
        TimeOpticRx::cancelFor($q, 'order', $id, 'ลบออเดอร์ ' . ($o['invoice_code'] ?? ('#' . $id)), LensRequisition::actorEmployee());
        /* เลขใบเสร็จของออเดอร์นี้ไม่ลบตาม — ตีตรายกเลิกแล้วเก็บไว้ในชุดเลข
           ไม่งั้นทะเบียนใบเสร็จของบัญชีมีเลขหลุดโดยไม่มีใครอธิบายได้ */
        $case = $o['case_id'] ? $q->get('SELECT case_code FROM cases WHERE id = ?', (int) $o['case_id']) : null;
        voidReceiptIn($q, 'order', $id, trim(sprintf(
            'ลบออเดอร์ %s %s',
            (string) ($o['invoice_code'] ?? ''),
            (string) ($case['case_code'] ?? '')
        )), true);
        $q->run('DELETE FROM payments WHERE order_id = ?', $id);
        $q->run('DELETE FROM custom_orders WHERE id = ?', $id);
    });
    return ['ok' => true];
});
