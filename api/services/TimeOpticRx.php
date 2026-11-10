<?php

declare(strict_types=1);

require_once __DIR__ . '/TimeOpticRequests.php';

/**
 * ใบสั่งตัด RX ของ Bewell → "คำขอจากสาขา" ของคลัง TimeOptic แบบ kind = rx (ร้านขอ 10 พ.ย. 2026)
 *
 * ใบสั่งตัดเปิดในคลังของ Bewell เอง (stock-api/rx) ผูกกับออเดอร์ทีละข้าง (custom_orders.lens_r_rx_id /
 * lens_l_rx_id = inventory_logs.id) · ส่งเข้า TimeOptic จังหวะเดียวกับใบเบิกเลนส์ คือกดยืนยันขั้นขาย
 * ส่งไม่ผ่านไม่ขวางการขาย — ลงไทม์ไลน์ บันทึกออเดอร์อีกครั้งหรือยืนยันขายใหม่ก็ส่งซ้ำให้
 *
 *   ยืนยันขาย             → ส่งใบสั่งที่ยังไม่มีคำขอ
 *   บันทึกออเดอร์          → ใบสั่งถูกยกเลิก/เปลี่ยน = ถอนคำขอเดิม · ขายแล้ว = ส่งใบสั่งใหม่
 *   เปิดขั้นขายกลับมาแก้   → ถอนคำขอที่ยังรอตรวจ
 *   ลบออเดอร์ / ยกเลิกเคส → ถอนคำขอ
 *
 * คำขอที่ TimeOptic ตัด/ตีกลับไปแล้วถอนไม่ได้ — ปล่อยไว้ ไทม์ไลน์บอกให้คุยกับ TimeOptic
 */
final class TimeOpticRx
{
    /** @return list<string> ข้างที่ส่งไม่ผ่าน */
    public static function sendForCase(Tx $q, int $caseId, ?int $employee): array
    {
        if (!TimeOpticRequests::enabled()) {
            return [];
        }
        $failed = [];
        foreach ($q->all('SELECT id FROM custom_orders WHERE case_id = ? ORDER BY id', $caseId) as $o) {
            array_push($failed, ...self::syncOrder($q, (int) $o['id'], true, $employee));
        }
        return $failed;
    }

    /** หลังบันทึกออเดอร์ — พลาดไม่ทำให้การบันทึกออเดอร์พัง */
    public static function afterOrderSave(int $orderId, ?int $employee): void
    {
        if (!TimeOpticRequests::enabled()) {
            return;
        }
        try {
            Db::tx(fn(Tx $q) => self::syncOrderTx($q, $orderId, $employee));
        } catch (Throwable $e) {
            error_log('TimeOpticRx::afterOrderSave ' . $orderId . ': ' . $e->getMessage());
        }
    }

    /** ตัวเดียวกับ afterOrderSave แต่อยู่ในทรานแซกชันของคนเรียก (เทสต์ใช้ตัวนี้) */
    public static function syncOrderTx(Tx $q, int $orderId, ?int $employee): array
    {
        if (!TimeOpticRequests::enabled()) {
            return [];
        }
        $o    = $q->get('SELECT case_id FROM custom_orders WHERE id = ?', $orderId);
        $sold = $o && $o['case_id'] && $q->get(
            "SELECT 1 AS x FROM case_processes WHERE case_id = ? AND process = 'sales' AND status = 'completed'",
            (int) $o['case_id']
        );
        return self::syncOrder($q, $orderId, (bool) $sold, $employee);
    }

    /** เปิดขั้นขายกลับมาแก้ — ถอนคำขอที่ยังรอตรวจ ยืนยันใหม่ส่งใบใหม่ */
    public static function withdrawForCase(Tx $q, int $caseId, ?int $employee): void
    {
        if (!TimeOpticRequests::enabled()) {
            return;
        }
        $rows = $q->all(
            "SELECT * FROM timeoptic_rx_requests WHERE case_id = ? AND active = 1 AND status = 'pending' FOR UPDATE",
            $caseId
        );
        foreach ($rows as $r) {
            self::withdraw($q, $r, 'เปิดขั้นขายกลับมาแก้', $employee);
        }
    }

    /** ลบออเดอร์ ($by = order) / ยกเลิกเคส ($by = case) */
    public static function cancelFor(Tx $q, string $by, int $id, string $reason, ?int $employee): void
    {
        if (!TimeOpticRequests::enabled()) {
            return;
        }
        $col = $by === 'order' ? 'order_id' : 'case_id';
        foreach ($q->all("SELECT * FROM timeoptic_rx_requests WHERE `$col` = ? AND active = 1 FOR UPDATE", $id) as $r) {
            self::withdraw($q, $r, $reason, $employee);
        }
    }

    /* ─────────────────────────────────────────────────────── ภายใน */

    /** @return list<string> */
    private static function syncOrder(Tx $q, int $orderId, bool $send, ?int $employee): array
    {
        $o = $q->get(
            "SELECT o.id, o.case_id, o.invoice_code, o.lens_r_rx_id, o.lens_l_rx_id, c.case_code,
                    CONCAT_WS(' ', cu.first_name, cu.last_name) AS customer_name
               FROM custom_orders o
               LEFT JOIN cases c      ON c.id = o.case_id
               LEFT JOIN customers cu ON cu.id = COALESCE(o.customer_id, c.customer_id)
              WHERE o.id = ? FOR UPDATE",
            $orderId
        );
        if (!$o) {
            return [];
        }
        $failed = [];
        foreach (['r', 'l'] as $side) {
            $logId  = (int) ($o["lens_{$side}_rx_id"] ?? 0);
            $rx     = $logId ? self::rx($q, $logId) : null;
            $active = $q->get(
                'SELECT * FROM timeoptic_rx_requests WHERE order_id = ? AND side = ? AND active = 1 ORDER BY id DESC LIMIT 1 FOR UPDATE',
                $orderId,
                $side
            );
            if ($active && (!$rx || (int) $active['rx_log_id'] !== $logId)) {
                if (!self::withdraw($q, $active, 'ใบสั่งตัดในออเดอร์ถูกยกเลิกหรือเปลี่ยน', $employee)) {
                    continue; // ถอนไม่ได้ (ติดต่อคลังไม่ได้) — ไม่ส่งใบใหม่ซ้อน
                }
                $active = null;
            }
            if ($send && $rx && !$active) {
                $why = self::send($q, $o, $side, $rx, $employee);
                if ($why !== null) {
                    $failed[] = $why;
                }
            }
        }
        return $failed;
    }

    /** ใบสั่งตัดที่ยังไม่ยกเลิก หรือ null */
    private static function rx(Tx $q, int $logId): ?array
    {
        $r = $q->get(
            "SELECT g.id, g.reference_doc, p.sku, p.name, p.brand,
                    r.eye_side, r.sph, r.cyl, r.axis, r.add_power, r.sale_price, r.cancelled_at
               FROM inventory_logs g
               JOIN products p ON p.id = g.product_id
               LEFT JOIN rx_orders r ON r.log_id = g.id
              WHERE g.id = ? AND g.action_type = 'RX_ORDER'",
            $logId
        );
        return $r && !$r['cancelled_at'] ? $r : null;
    }

    private static function send(Tx $q, array $o, string $side, array $rx, ?int $employee): ?string
    {
        $doc   = (string) ($rx['reference_doc'] ?? '');
        $label = 'ใบสั่งตัด ' . ($doc !== '' ? $doc : '#' . $rx['id']) . ' (' . ($side === 'r' ? 'ขวา' : 'ซ้าย') . ')';
        $num   = static fn($v) => $v === null || $v === '' ? null : (string) $v;
        $note  = implode(' · ', array_filter([
            'Bewell ' . $label,
            $o['invoice_code'] ? 'ออเดอร์ ' . $o['invoice_code'] : null,
            $o['case_code'] ? 'เคส ' . $o['case_code'] : null,
            trim((string) ($o['customer_name'] ?? '')) ?: null,
        ]));
        try {
            $sent = TimeOpticRequests::createRx([
                'brand'      => $rx['brand'] ? mb_substr((string) $rx['brand'], 0, 120) : null,
                'lens_model' => mb_substr((string) $rx['name'], 0, 120),
                'eye_side'   => $rx['eye_side'] ?: ($side === 'r' ? 'right' : 'left'),
                'sph'        => $num($rx['sph']),
                'cyl'        => $num($rx['cyl']),
                'axis'       => $num($rx['axis']),
                'add'        => $num($rx['add_power']),
                'sale_price' => $num($rx['sale_price']),
                'note'       => mb_substr($note, 0, 400),
            ]);
        } catch (Throwable $e) {
            logEvent($q, $o['case_id'] ? (int) $o['case_id'] : null, [
                'action'      => 'rx_timeoptic_send_failed',
                'entity'      => 'custom_order',
                'entity_id'   => (int) $o['id'],
                'employee_id' => $employee,
                'note'        => mb_substr(
                    $label . ': ส่งคำขอเข้าคลัง TimeOptic ไม่ผ่าน — ' . $e->getMessage() . ' · บันทึกออเดอร์อีกครั้งเพื่อส่งใหม่',
                    0,
                    250
                ),
            ]);
            return $label . ': ' . $e->getMessage();
        }
        $q->run(
            'INSERT INTO timeoptic_rx_requests (case_id, order_id, side, rx_log_id, rx_doc, req_id, req_code, status, synced_at)
             VALUES (?,?,?,?,?,?,?,?,NOW())',
            $o['case_id'] ? (int) $o['case_id'] : null,
            (int) $o['id'],
            $side,
            (int) $rx['id'],
            $doc !== '' ? $doc : null,
            $sent['id'],
            $sent['code'],
            $sent['status']
        );
        logEvent($q, $o['case_id'] ? (int) $o['case_id'] : null, [
            'action'      => 'rx_timeoptic_sent',
            'entity'      => 'custom_order',
            'entity_id'   => (int) $o['id'],
            'employee_id' => $employee,
            'note'        => mb_substr($label . ': ส่งคำขอเข้าคลัง TimeOptic ' . $sent['code'], 0, 250),
        ]);
        return null;
    }

    /** ถอนคำขอ → true = แถวนี้ไม่ใช่คำขอปัจจุบันแล้ว · false = ติดต่อคลังไม่ได้ แถวยังเหมือนเดิม */
    private static function withdraw(Tx $q, array $r, string $why, ?int $employee): bool
    {
        $code   = (string) $r['req_code'];
        $st     = (string) $r['status'];
        $caseId = $r['case_id'] ? (int) $r['case_id'] : null;
        if ($st === 'pending') {
            try {
                $st = TimeOpticRequests::cancel((int) $r['req_id'])['status'];
            } catch (Throwable $e) {
                logEvent($q, $caseId, [
                    'action'      => 'rx_timeoptic_withdraw_failed',
                    'entity'      => 'custom_order',
                    'entity_id'   => $r['order_id'] ? (int) $r['order_id'] : null,
                    'employee_id' => $employee,
                    'note'        => mb_substr("ถอนคำขอ $code ในคลัง TimeOptic ไม่สำเร็จ: " . $e->getMessage() . " · $why", 0, 250),
                ]);
                return false;
            }
        }
        $q->run('UPDATE timeoptic_rx_requests SET active = 0, status = ?, synced_at = NOW() WHERE id = ?', $st, (int) $r['id']);
        $msg = match ($st) {
            'cancelled' => "ถอนคำขอ $code ในคลัง TimeOptic แล้ว",
            'approved'  => "คำขอ $code TimeOptic เปิดใบสั่งตัดไปแล้ว — คุยกับ TimeOptic เรื่องยกเลิกใบสั่ง",
            default     => "คำขอ $code ในคลัง TimeOptic: " . (TimeOpticRequests::LABEL[$st] ?? $st),
        };
        logEvent($q, $caseId, [
            'action'      => 'rx_timeoptic_withdrawn',
            'entity'      => 'custom_order',
            'entity_id'   => $r['order_id'] ? (int) $r['order_id'] : null,
            'employee_id' => $employee,
            'note'        => mb_substr("$msg · $why", 0, 250),
        ]);
        return true;
    }
}
