<?php

declare(strict_types=1);

require_once __DIR__ . '/../services/LensRequisition.php';

/**
 * ใบเบิกเลนส์ของ Bewell
 *
 * หน้าขายบันทึกออเดอร์ด้วยเส้นทางเดิมก่อน แล้วค่อยเรียก /sync ที่นี่ — ออเดอร์เดิมจึงไม่มีอะไร
 * เปลี่ยน และ sync ที่พลาดไม่ทำให้ออเดอร์พัง · กติกาสถานะอยู่ใน services/LensRequisition.php
 */

function lensActorEmployee(): ?int
{
    $a = StockModule::actor();
    return isset($a['employeeId']) ? (int) $a['employeeId'] : null;
}

function lensReqLoad(int $id): array
{
    $r = Db::get(
        "SELECT lr.*, c.case_code, CONCAT_WS(' ', cu.first_name, cu.last_name) AS customer_name,
                cu.phone AS customer_phone, o.invoice_code, e.employee_name AS created_by_name
           FROM lens_requisitions lr
           JOIN cases c      ON c.id = lr.case_id
           JOIN customers cu ON cu.id = lr.customer_id
           LEFT JOIN custom_orders o ON o.id = lr.order_id
           LEFT JOIN employees e     ON e.id = lr.created_by
          WHERE lr.id = ?",
        $id
    );
    if (!$r) {
        missing('ไม่พบใบเบิกเลนส์');
    }
    $r['rx_snapshot']  = $r['rx_snapshot'] ? json_decode($r['rx_snapshot'], true) : null;
    $r['status_label'] = LensRequisition::LABEL[$r['status']] ?? $r['status'];
    $r['items']        = Db::all(
        "SELECT * FROM lens_requisition_items WHERE requisition_id = ? ORDER BY FIELD(eye, 'R', 'L', 'pair'), id",
        $id
    );
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
        "SELECT lr.id, lr.req_no, lr.case_id, lr.status, lr.total, lr.created_at,
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
    }
    unset($r);
    return $rows;
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
    $raw      = $req['body']['items'] ?? [];
    $items    = LensRequisition::cleanItems(is_array($raw) ? $raw : []);
    $employee = lensActorEmployee();

    $id = Db::tx(function (Tx $q) use ($orderId, $items, $employee) {
        $order = $q->get(
            'SELECT o.id, o.case_id, o.final_prescription_id, COALESCE(o.customer_id, c.customer_id) AS customer_id
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
        $rx    = LensRequisition::finalRx($q, $order);
        $snap  = $rx ? json_encode(LensRequisition::snapshot($rx), JSON_UNESCAPED_UNICODE) : null;
        $total = round(array_sum(array_column($items, 'line_total')), 2);

        /* ใบที่ยังใช้งานของออเดอร์นี้มีได้ใบเดียว — ยกเลิกแล้วค่อยออกใบใหม่ */
        $open = $q->get(
            "SELECT id, status FROM lens_requisitions
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
        if ($open) {
            $id = (int) $open['id'];
            $q->run(
                'UPDATE lens_requisitions SET prescription_id = ?, rx_snapshot = ?, total = ? WHERE id = ?',
                $rx['id'] ?? null,
                $snap,
                $total,
                $id
            );
            $q->run('DELETE FROM lens_requisition_items WHERE requisition_id = ?', $id);
            $action = 'lens_requisition_updated';
        } else {
            $id = (int) $q->run(
                'INSERT INTO lens_requisitions (req_no, case_id, customer_id, order_id, prescription_id, rx_snapshot, total, created_by)
                 VALUES (?,?,?,?,?,?,?,?)',
                nextCode('LR', 'lens_requisitions', 'req_no'),
                (int) $order['case_id'],
                (int) $order['customer_id'],
                $orderId,
                $rx['id'] ?? null,
                $snap,
                $total,
                $employee
            )['insertId'];
            $action = 'lens_requisition_created';
        }
        foreach ($items as $it) {
            $q->run(
                'INSERT INTO lens_requisition_items (requisition_id, eye, source, mock_code, brand, lens_type, design,
                   lens_index, coating, option_name, photochromic, color, quantity, unit_price, line_total)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
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
        return $id;
    });
    return lensReqLoad($id);
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
        $col = LensRequisition::STAMP[$to];
        $q->run(
            "UPDATE lens_requisitions SET status = ?, `$col` = NOW(), cancel_reason = ? WHERE id = ?",
            $to,
            $to === 'cancelled' ? $reason : $r['cancel_reason'],
            $id
        );
        logEvent($q, (int) $r['case_id'], [
            'action'      => 'lens_requisition_status',
            'entity'      => 'lens_requisition',
            'entity_id'   => $id,
            'employee_id' => $employee,
            'note'        => $r['req_no'] . ': ' . LensRequisition::LABEL[$r['status']] . ' → ' . LensRequisition::LABEL[$to]
                . ($reason !== '' ? ' · ' . $reason : ''),
            'payload'     => ['from' => $r['status'], 'to' => $to],
        ]);
    });
    return lensReqLoad($id);
});
