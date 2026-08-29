<?php
/**
 * SQL fragments shared by more than one route file, plus the two case-workflow
 * writes (audit log + status move) that several routes call.
 */
declare(strict_types=1);

final class Sql
{
    public const ORDER_SELECT = '
      o.*, c.first_name, c.last_name, c.phone, c.line_id,
      e.employee_name AS employee_name,
      ce.employee_name AS close_employee_name,
      cs.case_code,
      COALESCE(pay.paid, 0) AS paid,
      o.total_price - o.discount - COALESCE(pay.paid, 0) AS balance';

    public const ORDER_FROM = '
      FROM custom_orders o
      JOIN customers c        ON c.id  = o.customer_id
      LEFT JOIN employees e   ON e.id  = o.employee_id
      LEFT JOIN employees ce  ON ce.id = o.order_close_employee_id
      LEFT JOIN cases cs      ON cs.id = o.case_id
      LEFT JOIN (SELECT order_id, SUM(amount) paid FROM payments
                 WHERE order_id IS NOT NULL AND cancelled_at IS NULL
                 GROUP BY order_id) pay ON pay.order_id = o.id';

    /** an order still missing one of its three physical items */
    public const UNFILLED = '(COALESCE(o.lens_product_id,0)=0
                    OR COALESCE(o.right_lens_product_id,0)=0
                    OR COALESCE(o.frame_product_id,0)=0)';

    public const BOOKING_SELECT = '
      b.*, c.first_name AS cust_first_name, c.last_name AS cust_last_name,
      c.phone AS cust_phone, c.line_id AS cust_line_id,
      e.employee_name AS assigned_name, cr.employee_name AS created_by_name,
      ca.case_code, ca.status AS case_status,
      TIMESTAMP(b.booking_date, b.booking_time) AS starts_at';

    public const BOOKING_FROM = '
      FROM bookings b
      LEFT JOIN customers c  ON c.id  = b.customer_id
      LEFT JOIN employees e  ON e.id  = b.assigned_to
      LEFT JOIN employees cr ON cr.id = b.created_by
      LEFT JOIN cases ca     ON ca.id = b.case_id';
}

/**
 * Append a row to the case audit log. No-op without a case id, so routes can
 * call it unconditionally.
 */
function logEvent(Tx $q, ?int $caseId, array $f): void
{
    if (!$caseId) {
        return;
    }
    $q->run(
        'INSERT INTO case_events (case_id, from_status, to_status, action, entity,
           entity_id, employee_id, note, payload)
         VALUES (?,?,?,?,?,?,?,?,?)',
        $caseId,
        nul($f['from_status'] ?? null),
        nul($f['to_status'] ?? null),
        str_or($f['action'] ?? null),
        nul($f['entity'] ?? null),
        int_or($f['entity_id'] ?? null),
        int_or($f['employee_id'] ?? null),
        nul($f['note'] ?? null),
        isset($f['payload']) && $f['payload'] !== null
            ? json_encode($f['payload'], JSON_UNESCAPED_UNICODE)
            : null
    );
}

/** Move a case to a new status (validated) and log it. */
function setStatus(Tx $q, ?int $caseId, ?string $toStatus, array $opt = []): void
{
    if (!$caseId || !$toStatus) {
        return;
    }
    $c = $q->get('SELECT id, status FROM cases WHERE id = ?', $caseId);
    if (!$c) {
        return;
    }
    $target = $q->get('SELECT code, is_terminal FROM case_statuses WHERE code = ?', $toStatus);
    if (!$target) {
        bad("ไม่รู้จักสถานะ \"$toStatus\"");
    }
    if ($c['status'] === $toStatus) {
        return;
    }
    $closedAt = ((int) ($target['is_terminal'] ?? 0)) === 1 ? 'NOW()' : 'closed_at';
    $q->run(
        "UPDATE cases SET status = ?, closed_at = $closedAt WHERE id = ?",
        $toStatus,
        $caseId
    );
    logEvent($q, $caseId, [
        'from_status' => $c['status'],
        'to_status'   => $toStatus,
        'action'      => $opt['action'] ?? 'status_change',
        'employee_id' => $opt['employee_id'] ?? null,
        'note'        => $opt['note'] ?? null,
    ]);
}

/**
 * Shared create-or-update handler for the one-row-per-case workflow tables
 * (centerings, frame_fittings, case_deliveries).
 */
function upsertFactory(array $spec): callable
{
    return function (array $req) use ($spec) {
        $body     = $req['body'];
        $table    = $spec['table'];
        $cols     = $spec['cols'];
        $intCols  = $spec['intCols']  ?? [];
        $boolCols = $spec['boolCols'] ?? [];

        $caseId = int_or($body['case_id'] ?? null);
        if (!$caseId) {
            bad('กรุณาระบุเคส');
        }
        $vals = [];
        foreach ($cols as $c) {
            if (in_array($c, $intCols, true)) {
                $vals[] = int_or($body[$c] ?? null);
            } elseif (in_array($c, $boolCols, true)) {
                $vals[] = boolInt($body[$c] ?? null);
            } else {
                $vals[] = nul($body[$c] ?? null);
            }
        }

        $id = Db::tx(function (Tx $q) use ($table, $cols, $vals, $caseId, $body, $spec) {
            $ex = $q->get("SELECT id FROM `$table` WHERE case_id = ? ORDER BY id DESC LIMIT 1", $caseId);
            if ($ex) {
                $set = implode(',', array_map(fn($c) => "`$c`=?", $cols));
                $q->run("UPDATE `$table` SET $set WHERE id = ?", ...[...$vals, (int) $ex['id']]);
                $rid = (int) $ex['id'];
            } else {
                $names  = implode(',', array_map(fn($c) => "`$c`", $cols));
                $marks  = implode(',', array_fill(0, count($cols), '?'));
                $r = $q->run(
                    "INSERT INTO `$table` (case_id, $names) VALUES (?, $marks)",
                    ...[$caseId, ...$vals]
                );
                $rid = $r['insertId'];
            }
            $emp = int_or($body['performed_by'] ?? null)
                ?? int_or($body['recorded_by'] ?? null)
                ?? int_or($body['employee_id'] ?? null);
            logEvent($q, $caseId, [
                'action'      => $spec['action'],
                'entity'      => $table,
                'entity_id'   => $rid,
                'employee_id' => $emp,
            ]);
            if (!empty($spec['status'])) {
                setStatus($q, $caseId, $spec['status'], [
                    'employee_id' => int_or($body['performed_by'] ?? null) ?? int_or($body['recorded_by'] ?? null),
                    'action'      => $spec['action'],
                ]);
            }
            return $rid;
        });

        return Db::get("SELECT * FROM `$table` WHERE id = ?", $id);
    };
}
