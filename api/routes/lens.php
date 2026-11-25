<?php

declare(strict_types=1);

require_once __DIR__ . '/../services/LensRequisition.php';
require_once __DIR__ . '/../services/TimeOpticRequests.php';

/**
 * ใบเบิกเลนส์ของ Bewell
 *
 * หน้าขายบันทึกออเดอร์ด้วยเส้นทางเดิมก่อน แล้วค่อยเรียก /sync ที่นี่ — ออเดอร์เดิมจึงไม่มีอะไร
 * เปลี่ยน และ sync ที่พลาดไม่ทำให้ออเดอร์พัง · กติกาสถานะอยู่ใน services/LensRequisition.php
 */

function lensActorEmployee(): ?int
{
    return LensRequisition::actorEmployee();
}

function lensReqLoad(int $id): array
{
    $r = Db::get(
        "SELECT lr.*, c.case_code, CONCAT_WS(' ', cu.first_name, cu.last_name) AS customer_name,
                cu.phone AS customer_phone, COALESCE(o.invoice_code, lr.order_ref) AS invoice_code,
                e.employee_name AS created_by_name, eu.employee_name AS used_by_name,
                ec.employee_name AS cancelled_by_name
           FROM lens_requisitions lr
           JOIN cases c      ON c.id = lr.case_id
           JOIN customers cu ON cu.id = lr.customer_id
           LEFT JOIN custom_orders o ON o.id = lr.order_id
           LEFT JOIN employees e     ON e.id = lr.created_by
           LEFT JOIN employees eu    ON eu.id = lr.used_by
           LEFT JOIN employees ec    ON ec.id = lr.cancelled_by
          WHERE lr.id = ?",
        $id
    );
    if (!$r) {
        missing('ไม่พบใบเบิกเลนส์');
    }
    $r['rx_snapshot']  = $r['rx_snapshot'] ? json_decode($r['rx_snapshot'], true) : null;
    $r['status_label'] = LensRequisition::LABEL[$r['status']] ?? $r['status'];
    $r['cancel_source_label'] = LensRequisition::CANCEL_SOURCE[$r['cancel_source'] ?? ''] ?? null;
    $r['timeoptic_enabled']      = TimeOpticRequests::enabled();
    $r['timeoptic_status_label'] = TimeOpticRequests::LABEL[$r['timeoptic_status'] ?? ''] ?? null;
    $r['items']        = Db::all(
        "SELECT * FROM lens_requisition_items WHERE requisition_id = ? ORDER BY FIELD(eye, 'R', 'L', 'pair'), id",
        $id
    );
    return $r;
}

/** แบบเดียวกับ lensReqLoad แต่อ่านในทรานแซกชันที่ล็อกแถวไว้ — ใช้ตอนส่งเข้าคลัง TimeOptic */
/** ตะกร้าที่จะส่งเข้าคลัง ไว้เทียบว่าเลนส์เปลี่ยนจริงไหม · เลนส์ไม่มีรหัสนับเป็นตะกร้าที่ส่งไม่ได้ */
function lensReqBasket(array $items): ?array
{
    try {
        return TimeOpticRequests::basket($items);
    } catch (HttpError) {
        return null;
    }
}

function lensReqLoadTx(Tx $q, int $id): array
{
    $r = $q->get(
        "SELECT lr.*, c.case_code, CONCAT_WS(' ', cu.first_name, cu.last_name) AS customer_name,
                COALESCE(o.invoice_code, lr.order_ref) AS invoice_code
           FROM lens_requisitions lr
           JOIN cases c      ON c.id = lr.case_id
           JOIN customers cu ON cu.id = lr.customer_id
           LEFT JOIN custom_orders o ON o.id = lr.order_id
          WHERE lr.id = ?",
        $id
    );
    $r['items'] = $q->all('SELECT * FROM lens_requisition_items WHERE requisition_id = ? ORDER BY id', $id);
    return $r;
}

GET('/api/lens-requisitions', function (array $req) {
    $status = (string) ($req['query']['status'] ?? '');
    $term   = trim((string) ($req['query']['q'] ?? ''));
    $where  = [];
    $args   = [];
    if (isset(LensRequisition::LABEL[$status])) {
        $where[] = 'lr.status = ?';
        $args[]  = $status;
    }
    if ($term !== '') {
        $where[] = '(lr.req_no LIKE ? OR c.case_code LIKE ? OR cu.first_name LIKE ? OR cu.last_name LIKE ? OR cu.phone LIKE ?)';
        array_push($args, ...array_fill(0, 5, "%$term%"));
    }
    $rows = Db::all(
        "SELECT lr.id, lr.req_no, lr.case_id, lr.status, lr.total, lr.created_at, lr.used_at,
                lr.timeoptic_req_code, lr.timeoptic_status, lr.timeoptic_note,
                lr.rx_snapshot IS NOT NULL AS has_rx, c.case_code,
                CONCAT_WS(' ', cu.first_name, cu.last_name) AS customer_name,
                (SELECT GROUP_CONCAT(CONCAT(i.eye, ': ', CONCAT_WS(' ', i.brand, i.design, i.lens_index, i.coating))
                         ORDER BY FIELD(i.eye, 'R', 'L', 'pair') SEPARATOR ' · ')
                   FROM lens_requisition_items i WHERE i.requisition_id = lr.id) AS summary
           FROM lens_requisitions lr
           JOIN cases c      ON c.id = lr.case_id
           JOIN customers cu ON cu.id = lr.customer_id"
        . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
        . ' ORDER BY lr.id DESC LIMIT 300',
        ...$args
    );
    foreach ($rows as &$r) {
        $r['has_rx']       = (bool) $r['has_rx'];
        $r['status_label'] = LensRequisition::LABEL[$r['status']] ?? $r['status'];
        $r['timeoptic_status_label'] = TimeOpticRequests::LABEL[$r['timeoptic_status'] ?? ''] ?? null;
    }
    unset($r);
    return $rows;
});

/**
 * ดึงสถานะล่าสุดของคำขอที่ส่งเข้าคลัง TimeOptic มาเก็บ — หน้ารายการใบเบิกเรียกตอนเปิด
 * คลังส่งมา 50 คำขอล่าสุดของบัญชีเชื่อม ใบที่เก่ากว่านั้นคงสถานะที่ดึงไว้ครั้งสุดท้าย
 */
POST('/api/lens-requisitions/timeoptic-refresh', function () {
    if (!TimeOpticRequests::enabled()) {
        return ['enabled' => false, 'updated' => 0];
    }
    $mine = TimeOpticRequests::mineRaw();
    $n    = 0;
    foreach (Db::all(
        'SELECT id, req_no, case_id, timeoptic_req_id, timeoptic_req_code, timeoptic_status, timeoptic_note
           FROM lens_requisitions WHERE timeoptic_req_id IS NOT NULL'
    ) as $r) {
        $raw = $mine[(int) $r['timeoptic_req_id']] ?? null;
        if (!$raw) {
            continue;
        }
        /* ข้างตาของใบนี้ — บอกได้ว่าข้างไหนตัดแล้ว ข้างไหนรอของ (ร้านขอ 19 พ.ย. 2026) */
        $t = TimeOpticRequests::shape($raw, TimeOpticRequests::eyesOf(
            Db::all('SELECT lens_code, eye FROM lens_requisition_items WHERE requisition_id = ?', (int) $r['id'])
        ));
        if ($t['status'] === $r['timeoptic_status'] && $t['note'] === $r['timeoptic_note']) {
            continue;
        }
        Db::tx(function (Tx $q) use ($r, $t) {
            $q->run(
                'UPDATE lens_requisitions SET timeoptic_status = ?, timeoptic_note = ?, timeoptic_synced_at = NOW() WHERE id = ?',
                $t['status'],
                $t['note'],
                (int) $r['id']
            );
            /* สถานะเปลี่ยน → ลงไทม์ไลน์เคส ให้เห็นว่าคลังตัดครบ/ตัดบางส่วน/รอของ/ตีกลับเมื่อไร */
            if ($t['status'] !== $r['timeoptic_status']) {
                logEvent($q, (int) $r['case_id'], [
                    'action'    => 'lens_timeoptic_status',
                    'entity'    => 'lens_requisition',
                    'entity_id' => (int) $r['id'],
                    'note'      => mb_substr(
                        $r['req_no'] . ': คำขอ ' . $r['timeoptic_req_code'] . ' — '
                        . (TimeOpticRequests::LABEL[$t['status']] ?? $t['status'])
                        . ($t['note'] ? ' (' . $t['note'] . ')' : ''),
                        0,
                        250
                    ),
                ]);
            }
        });
        $n++;
    }
    return ['enabled' => true, 'updated' => $n];
});

GET('/api/lens-requisitions/:id', fn(array $req) => lensReqLoad((int) $req['params']['id']));

GET('/api/cases/:id/lens-requisitions', function (array $req) {
    $ids = Db::all('SELECT id FROM lens_requisitions WHERE case_id = ? ORDER BY id DESC', (int) $req['params']['id']);
    return array_map(static fn($r) => lensReqLoad((int) $r['id']), $ids);
});

POST('/api/lens-requisitions/sync', function (array $req) {
    $orderId = int_or($req['body']['order_id'] ?? null);
    if (!$orderId) {
        bad('ต้องระบุออเดอร์');
    }
    $raw = $req['body']['items'] ?? [];
    /* items ว่าง = หน้าขายกด "ล้าง" เลนส์ทั้งสองข้าง → ยกเลิกใบเดิม (ไม่ลบ) ไม่ใช่ออกใบว่าง */
    $clear    = is_array($raw) && !$raw;
    $items    = $clear ? [] : LensRequisition::cleanItems(is_array($raw) ? $raw : []);
    $employee = lensActorEmployee();

    $id = Db::tx(function (Tx $q) use ($orderId, $items, $clear, $employee) {
        $order = $q->get(
            'SELECT o.id, o.case_id, o.final_prescription_id, o.invoice_code, COALESCE(o.customer_id, c.customer_id) AS customer_id
               FROM custom_orders o LEFT JOIN cases c ON c.id = o.case_id
              WHERE o.id = ? FOR UPDATE',
            $orderId
        );
        if (!$order) {
            missing('ไม่พบออเดอร์');
        }
        if (!$order['case_id']) {
            bad('ออเดอร์นี้ไม่ได้ผูกกับเคส จึงออกใบเบิกเลนส์ไม่ได้');
        }
        $items = LensRequisition::withCatalog($q, $items);
        $rx    = LensRequisition::finalRx($q, $order);
        $snap  = $rx ? json_encode(LensRequisition::snapshot($rx), JSON_UNESCAPED_UNICODE) : null;
        $total = round(array_sum(array_column($items, 'line_total')), 2);

        /* ใบที่ยังใช้งานของออเดอร์นี้มีได้ใบเดียว — ยกเลิกแล้วค่อยออกใบใหม่ */
        $open = $q->get(
            "SELECT id, status, used_at, timeoptic_req_id FROM lens_requisitions
              WHERE order_id = ? AND status <> 'cancelled' ORDER BY id DESC LIMIT 1 FOR UPDATE",
            $orderId
        );
        if ($open && $open['status'] !== 'pending') {
            throw new HttpError(
                409,
                'ใบเบิกเลนส์ของออเดอร์นี้เบิกไปแล้ว แก้รายการไม่ได้ — ยกเลิกใบเดิมก่อนถ้าต้องการเปลี่ยนเลนส์',
                ['reason' => 'lens_req_locked']
            );
        }
        if ($clear) {
            if ($open) {
                LensRequisition::cancelFor($q, 'order', $orderId, 'lens_cleared', 'ล้างเลนส์ออกจากออเดอร์', $employee);
            }
            return null;
        }
        /* ยืนยันขั้นขายแล้วยังเปลี่ยนเลนส์ได้ (ร้านขอ 26 ก.ย. 2026) — ใบยังนับเป็น "ใช้เลนส์"
           วันที่ขายเดิม (used_at ไม่แตะ) แค่รายการเป็นตัวใหม่ · ชื่อเดิม→ใหม่ลงไทม์ไลน์ไว้ตรวจย้อนหลัง
           ใบที่ส่งรายการเบิกไปแล้วยังล็อกตามข้างบน เพราะ TimeOptic ได้รายการเดิมไปแล้ว */
        $before = null;
        if ($open && $open['used_at']) {
            $before = implode(' + ', array_column(
                $q->all('SELECT COALESCE(lens_name, design) AS n FROM lens_requisition_items WHERE requisition_id = ? ORDER BY id', (int) $open['id']),
                'n'
            ));
        }
        /* ใบที่ส่งคำขอเข้าคลัง TimeOptic แล้ว (ยืนยันขาย) — จำตะกร้าเดิมไว้เทียบ เปลี่ยนเลนส์จริงค่อยส่งใหม่ */
        $sentBasket = null;
        if ($open && $open['timeoptic_req_id']) {
            $sentBasket = lensReqBasket($q->all('SELECT lens_code, eye, quantity FROM lens_requisition_items WHERE requisition_id = ?', (int) $open['id']));
        }
        if ($open) {
            $id = (int) $open['id'];
            $q->run(
                'UPDATE lens_requisitions SET prescription_id = ?, rx_snapshot = ?, total = ?, order_ref = ? WHERE id = ?',
                $rx['id'] ?? null,
                $snap,
                $total,
                $order['invoice_code'],
                $id
            );
            $q->run('DELETE FROM lens_requisition_items WHERE requisition_id = ?', $id);
            $action = 'lens_requisition_updated';
        } else {
            $id = (int) $q->run(
                'INSERT INTO lens_requisitions (req_no, case_id, customer_id, order_id, order_ref, prescription_id, rx_snapshot, total, created_by)
                 VALUES (?,?,?,?,?,?,?,?,?)',
                nextCode('LR', 'lens_requisitions', 'req_no'),
                (int) $order['case_id'],
                (int) $order['customer_id'],
                $orderId,
                $order['invoice_code'],
                $rx['id'] ?? null,
                $snap,
                $total,
                $employee
            )['insertId'];
            $action = 'lens_requisition_created';
        }
        foreach ($items as $it) {
            $cols = array_keys($it);
            $q->run(
                'INSERT INTO lens_requisition_items (requisition_id, `' . implode('`, `', $cols) . '`)
                 VALUES (?' . str_repeat(',?', count($cols)) . ')',
                $id,
                ...array_values($it)
            );
        }
        logEvent($q, (int) $order['case_id'], [
            'action'      => $action,
            'entity'      => 'lens_requisition',
            'entity_id'   => $id,
            'employee_id' => $employee,
        ]);
        /* ใบใหม่ของเคสที่ยืนยันขั้นขายไปแล้ว (ล้างเลนส์แล้วเลือกใหม่) — จะไม่มีการยืนยันขาย
           รอบใหม่มาเรียก markUsed ให้ จึงนับเป็นใช้เลนส์ตรงนี้เลย */
        if (!$open) {
            $sales = $q->get(
                "SELECT status, completed_at FROM case_processes WHERE case_id = ? AND process = 'sales'",
                (int) $order['case_id']
            );
            if ($sales && $sales['status'] === 'completed' && $sales['completed_at']) {
                LensRequisition::markUsed($q, (int) $order['case_id'], $employee);
                TimeOpticRequests::sendForCase($q, (int) $order['case_id'], $employee);
            }
        }
        if ($sentBasket !== null
            && $sentBasket !== lensReqBasket($q->all('SELECT lens_code, eye, quantity FROM lens_requisition_items WHERE requisition_id = ?', $id))) {
            TimeOpticRequests::resend($q, $id, (int) $order['case_id'], $employee);
        }
        $after = implode(' + ', array_map(static fn($it) => (string) ($it['lens_name'] ?? $it['design'] ?? ''), $items));
        if ($before !== null && $before !== $after) {
            logEvent($q, (int) $order['case_id'], [
                'action'      => 'lens_usage_changed',
                'entity'      => 'lens_requisition',
                'entity_id'   => $id,
                'employee_id' => $employee,
                'note'        => mb_substr("เปลี่ยนเลนส์หลังยืนยันขาย: $before → $after", 0, 250),
            ]);
        }
        return $id;
    });
    return $id === null ? ['cleared' => true] : lensReqLoad($id);
});

POST('/api/lens-requisitions/:id/status', function (array $req) {
    $id       = (int) $req['params']['id'];
    $to       = (string) ($req['body']['status'] ?? '');
    $reason   = mb_substr(trim((string) ($req['body']['reason'] ?? '')), 0, 255);
    $employee = lensActorEmployee();

    Db::tx(function (Tx $q) use ($id, $to, $reason, $employee) {
        $r = $q->get(
            'SELECT lr.*, o.final_prescription_id
               FROM lens_requisitions lr LEFT JOIN custom_orders o ON o.id = lr.order_id
              WHERE lr.id = ? FOR UPDATE',
            $id
        );
        if (!$r) {
            missing('ไม่พบใบเบิกเลนส์');
        }
        /* ค่าสายตาถูกยืนยันหลังออกใบ — ใบที่ยังรอเบิกยังไม่ได้ไปไหน ดึงค่าล่าสุดได้ */
        if (!$r['rx_snapshot'] && $r['status'] === 'pending') {
            $rx = LensRequisition::finalRx($q, $r);
            if ($rx) {
                $r['rx_snapshot'] = json_encode(LensRequisition::snapshot($rx), JSON_UNESCAPED_UNICODE);
                $q->run(
                    'UPDATE lens_requisitions SET prescription_id = ?, rx_snapshot = ? WHERE id = ?',
                    (int) $rx['id'],
                    $r['rx_snapshot'],
                    $id
                );
            }
        }
        $why = LensRequisition::transitionError($r['status'], $to, (bool) $r['rx_snapshot']);
        if ($why !== null) {
            throw new HttpError(409, $why, ['reason' => 'lens_req_transition']);
        }
        if ($to === 'cancelled' && $reason === '') {
            bad('ต้องระบุเหตุผลที่ยกเลิกใบเบิก');
        }
        /* คลัง TimeOptic — ออกจาก "รอเบิก" ครั้งแรก = ส่งคำขอเข้า "คำขอจากสาขา" ของคลัง
           ส่งไม่ผ่าน = สถานะไม่ขยับ (โยนต่อ ทรานแซกชันถอย) ใบจึงไม่ค้าง "ส่งแล้ว" ทั้งที่ไม่ได้ส่ง
           แถวถูกล็อก FOR UPDATE อยู่ กดซ้ำพร้อมกันสองเครื่องจึงส่งได้ครั้งเดียว */
        $sent = null;
        if (TimeOpticRequests::enabled() && $r['status'] === 'pending' && $to !== 'cancelled' && !$r['timeoptic_req_id']) {
            $full = lensReqLoadTx($q, $id);
            $sent = TimeOpticRequests::create(TimeOpticRequests::basket($full['items']), TimeOpticRequests::note($full));
            $q->run(
                'UPDATE lens_requisitions SET timeoptic_req_id = ?, timeoptic_req_code = ?, timeoptic_status = ?,
                        timeoptic_note = NULL, timeoptic_synced_at = NOW() WHERE id = ?',
                $sent['id'],
                $sent['code'],
                $sent['status'],
                $id
            );
        }
        /* ยกเลิกใบที่ส่งเข้าคลังแล้ว — คำขอยังรอตรวจก็ยกเลิกตามไปด้วย · คลังตัดไปแล้วยกเลิกฝั่งนี้ได้
           แต่ของออกจากคลังไปแล้ว ไทม์ไลน์บอกให้คุยกับ TimeOptic เรื่องคืนของ */
        $tNote = '';
        if ($to === 'cancelled' && $r['timeoptic_req_id'] && $r['timeoptic_status'] !== 'cancelled') {
            $tNote = TimeOpticRequests::cancelLinked($q, $id, (int) $r['timeoptic_req_id'], (string) $r['timeoptic_req_code']);
        }
        $col = LensRequisition::STAMP[$to];
        $q->run(
            "UPDATE lens_requisitions SET status = ?, `$col` = NOW(), cancel_reason = ?,
                    cancelled_by = ?, cancel_source = ? WHERE id = ?",
            $to,
            $to === 'cancelled' ? $reason : $r['cancel_reason'],
            $to === 'cancelled' ? $employee : $r['cancelled_by'],
            $to === 'cancelled' ? 'manual' : $r['cancel_source'],
            $id
        );
        logEvent($q, (int) $r['case_id'], [
            'action'      => 'lens_requisition_status',
            'entity'      => 'lens_requisition',
            'entity_id'   => $id,
            'employee_id' => $employee,
            'note'        => mb_substr(
                $r['req_no'] . ': ' . LensRequisition::LABEL[$r['status']] . ' → ' . LensRequisition::LABEL[$to]
                . ($reason !== '' ? ' · ' . $reason : '')
                . ($sent ? ' · ส่งคำขอเข้าคลัง TimeOptic ' . $sent['code'] : '')
                . $tNote,
                0,
                250
            ),
            'payload'     => ['from' => $r['status'], 'to' => $to, 'timeoptic' => $sent['code'] ?? null],
        ]);
    });
    return lensReqLoad($id);
});
