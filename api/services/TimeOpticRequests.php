<?php

declare(strict_types=1);

/**
 * ส่งใบเบิกเลนส์ของ Bewell เข้า "คำขอจากสาขา" ของคลัง TimeOptic (ร้านขอ 10 พ.ย. 2026)
 *
 *   https://controlsystem-timeoptic.com/stock/requests/  ← คนตรวจของ TimeOptic เห็นคำขอที่นี่
 *
 * เลนส์ใน lens_catalog ของ Bewell คือ SKU ตัวเดียวกับสินค้าในคลัง TimeOptic (LNS-xxxx) จึงส่งเป็น
 * คำขอแบบ "เบิกจากสต็อก" (kind = issue) ให้สาขา Bewell · คำขอยังไม่ตัดของ — คนตรวจของ TimeOptic
 * ตรวจ แก้ได้ แล้วกดยืนยัน ระบบฝั่งนั้นจึงตัดสต็อกและเปิดใบเบิกค้างรับของสาขา Bewell
 *
 * ยืนยันตัวตนด้วยบัญชีระบบหนึ่งบัญชีในคลัง TimeOptic (บทบาท branch · admins.branch_id = สาขา Bewell)
 * ล็อกอินใหม่ทุกครั้งที่เรียก — นาน ๆ ส่งครั้ง ไม่คุ้มเก็บ session
 *
 * ตั้งค่าใน .env (ไม่ตั้ง = ปิดทางนี้ ใบเบิกทำงานแบบเดิมทุกอย่าง):
 *   TIMEOPTIC_STOCK_API   เช่น https://controlsystem-timeoptic.com/stock-api
 *   TIMEOPTIC_STOCK_USER  / TIMEOPTIC_STOCK_PASS
 *   TIMEOPTIC_BRANCH_ID   สาขา Bewell ในคลัง TimeOptic (5335)
 */
final class TimeOpticRequests
{
    /** สถานะคำขอฝั่ง TimeOptic → ข้อความที่พนักงาน Bewell เห็น */
    public const LABEL = [
        'pending'   => 'รอ TimeOptic ตรวจ',
        'approved'  => 'TimeOptic ตัดสต็อกแล้ว',
        /* คลังของไม่พอตอนยืนยัน — ตัดเท่าที่มี ที่ขาดค้างรอของในคำขอเดิม (ร้านขอ 19 พ.ย. 2026)
           ฝั่งคลังเก็บเป็น approved + result.waiting · ฝั่งนี้แยกออกมาให้พนักงานเห็น */
        'partial'   => 'TimeOptic ตัดบางส่วน · รอของ',
        'waiting'   => 'TimeOptic รอของเข้าคลัง',
        'rejected'  => 'TimeOptic ตีกลับ',
        'cancelled' => 'ยกเลิกคำขอแล้ว',
    ];

    public static function enabled(): bool
    {
        return self::cfg() !== null;
    }

    /**
     * รายการเลนส์ของใบเบิก → ตะกร้าเบิก {sku, quantity} — SKU เดียวกันสองข้างรวมเป็นจำนวนเดียว
     * เลนส์ที่ไม่มีรหัส (พิมพ์เองนอกรายการเลนส์) ส่งเข้าคลังไม่ได้ → ข้อความบอกว่าตัวไหน
     *
     * @param list<array<string,mixed>> $items
     * @return list<array{sku:string,quantity:int}>
     */
    public static function basket(array $items): array
    {
        $qty = [];
        foreach ($items as $it) {
            $sku = trim((string) ($it['lens_code'] ?? ''));
            if ($sku === '') {
                $name = trim((string) ($it['lens_name'] ?? $it['design'] ?? $it['brand'] ?? ''));
                throw new HttpError(
                    409,
                    "เลนส์ \"$name\" ไม่มีรหัสสินค้า ส่งคำขอเข้าคลัง TimeOptic ไม่ได้ — เลือกเลนส์จากรายการในหน้าขายใหม่",
                    ['reason' => 'lens_no_sku']
                );
            }
            /* หน้าขายเลือกรุ่นเดียวกันสองข้าง = แถวเดียว eye "pair" quantity 1 (หน่วยคู่) — คลังนับเป็นชิ้น จึง ×2 */
            $pieces    = max(1, (int) ($it['quantity'] ?? 1)) * (($it['eye'] ?? '') === 'pair' ? 2 : 1);
            $qty[$sku] = ($qty[$sku] ?? 0) + $pieces;
        }
        if (!$qty) {
            throw new HttpError(409, 'ใบเบิกนี้ไม่มีรายการเลนส์', ['reason' => 'lens_req_empty']);
        }
        $out = [];
        foreach ($qty as $sku => $n) {
            $out[] = ['sku' => (string) $sku, 'quantity' => $n];
        }
        return $out;
    }

    /** หมายเหตุบนคำขอ — คนตรวจฝั่ง TimeOptic ค้นด้วยเลขใบ/เลขออเดอร์จากตรงนี้ (สูงสุด 400 ตัว) */
    public static function note(array $r): string
    {
        $parts = array_filter([
            'BonKai ' . $r['req_no'],
            $r['invoice_code'] ? 'ออเดอร์ ' . $r['invoice_code'] : null,
            $r['case_code'] ? 'เคส ' . $r['case_code'] : null,
            trim((string) ($r['customer_name'] ?? '')) ?: null,
        ]);
        return mb_substr(implode(' · ', $parts), 0, 400);
    }

    /**
     * ส่งคำขอ → ['id' => 60, 'code' => 'REQ-00060', 'status' => 'pending']
     *
     * @param list<array{sku:string,quantity:int}> $basket
     */
    public static function create(array $basket, string $note): array
    {
        return self::submit('issue', ['items' => $basket, 'note' => $note]);
    }

    /**
     * ใบสั่งตัด RX หนึ่งใบ → คำขอ kind = rx (คนตรวจของ TimeOptic ยืนยันแล้วฝั่งนั้นเปิดใบสั่งตัดให้สาขา Bewell)
     *
     * @param array<string,mixed> $body {brand, lens_model, eye_side, sph, cyl, axis, add, sale_price, note}
     */
    public static function createRx(array $body): array
    {
        return self::submit('rx', $body);
    }

    private static function submit(string $kind, array $body): array
    {
        $c   = self::need();
        $res = self::session(fn(callable $call) => $call('POST', '/issue-requests', [
            'kind'      => $kind,
            'branch_id' => $c['branch'],
            'body'      => $body,
        ]));
        $req = $res['request'] ?? null;
        if (!is_array($req) || !isset($req['id'])) {
            throw self::fail('คลัง TimeOptic ตอบกลับไม่ครบ ไม่แน่ใจว่าคำขอเข้าไปหรือยัง — ดูที่หน้าคำขอจากสาขาก่อนส่งซ้ำ');
        }
        return self::shape($req);
    }

    /** ยกเลิกคำขอที่ยังรอตรวจ → สถานะล่าสุดของคำขอ (ตรวจไปแล้ว = ได้สถานะนั้นกลับมา ไม่โยน) */
    public static function cancel(int $id): array
    {
        return self::session(function (callable $call) use ($id) {
            try {
                return self::shape($call('POST', "/issue-requests/$id/cancel", [])['request'] ?? []);
            } catch (HttpError $e) {
                if (($e->payload['reason'] ?? '') !== 'not_pending') {
                    throw $e;
                }
                foreach ($call('GET', '/issue-requests/mine?q=' . rawurlencode(sprintf('REQ-%05d', $id)), null)['requests'] ?? [] as $r) {
                    if ((int) ($r['id'] ?? 0) === $id) {
                        return self::shape($r);
                    }
                }
                throw $e;
            }
        });
    }

    /**
     * ยกเลิกคำขอฝั่งคลังของใบเบิกใบนี้ แล้วเก็บสถานะที่ได้กลับมา → ข้อความต่อท้ายไทม์ไลน์
     * ติดต่อคลังไม่ได้ไม่ขวางการยกเลิกฝั่ง Bewell (ออเดอร์ถูกลบ/เคสยกเลิกต้องเดินต่อได้) แค่บอกไว้
     */
    public static function cancelLinked(Tx $q, int $requisitionId, int $reqId, string $code): string
    {
        if (!self::enabled()) {
            return " · คำขอ $code ในคลัง TimeOptic ยังไม่ถูกยกเลิก (ยังไม่ได้ตั้งค่าการเชื่อม)";
        }
        try {
            $t = self::cancel($reqId);
        } catch (HttpError $e) {
            return " · ยกเลิกคำขอ $code ในคลัง TimeOptic ไม่สำเร็จ: " . $e->getMessage();
        }
        $q->run(
            'UPDATE lens_requisitions SET timeoptic_status = ?, timeoptic_note = ?, timeoptic_synced_at = NOW() WHERE id = ?',
            $t['status'],
            $t['note'],
            $requisitionId
        );
        return match ($t['status']) {
            'cancelled' => " · ยกเลิกคำขอ $code ในคลัง TimeOptic แล้ว",
            'approved'  => " · คำขอ $code TimeOptic ตัดสต็อกไปแล้ว — คุยกับ TimeOptic เรื่องคืนเลนส์",
            default     => " · คำขอ $code ในคลัง TimeOptic: " . (self::LABEL[$t['status']] ?? $t['status']),
        };
    }

    /**
     * ยืนยันขั้นขาย → ส่งใบเบิกของเคสที่ยังรอเบิกและยังไม่เคยส่ง เข้าคลังทันที (ร้านขอ 10 พ.ย. 2026)
     *
     * ส่งไม่ผ่านไม่ขวางการขาย — ถึงตรงนี้กรอบถูกตัดออกจากคลังไปแล้ว ขายจริงแล้ว · ลงไทม์ไลน์ว่า
     * ส่งไม่ผ่านเพราะอะไร ใบยังรอเบิก พนักงานส่งซ้ำได้ด้วยการเลื่อนใบออกจาก "รอเบิก" ตามทางเดิม
     * แถวถูกล็อก FOR UPDATE กดยืนยันซ้ำพร้อมกันจึงส่งได้ครั้งเดียว
     *
     * @return list<string> ใบที่ส่งไม่ผ่าน "LR-xxx: เหตุผล"
     */
    public static function sendForCase(Tx $q, int $caseId, ?int $employee): array
    {
        if (!self::enabled()) {
            return [];
        }
        $rows = $q->all(
            "SELECT id FROM lens_requisitions
              WHERE case_id = ? AND status = 'pending' AND timeoptic_req_id IS NULL AND used_at IS NOT NULL
              ORDER BY id FOR UPDATE",
            $caseId
        );
        $failed = [];
        foreach ($rows as $row) {
            $why = self::sendOne($q, (int) $row['id'], $caseId, $employee);
            if ($why !== null) {
                $failed[] = $why;
            }
        }
        return $failed;
    }

    /**
     * เปลี่ยนเลนส์หลังขาย ในใบที่ส่งคำขอไปแล้ว — ถอนคำขอเดิม แล้วส่งรายการใหม่เป็นคำขอใบใหม่
     * TimeOptic ตัดสต็อกไปแล้ว = เปลี่ยนไม่ได้ (409 ทั้งการบันทึกถอย) ต้องยกเลิกใบเบิกเดิมก่อน
     * ติดต่อคลังไม่ได้ตอนถอน = บันทึกไม่ผ่าน (502) ไม่ปล่อยให้คลังถือรายการเก่าไว้เงียบ ๆ
     */
    public static function resend(Tx $q, int $id, int $caseId, ?int $employee): void
    {
        if (!self::enabled()) {
            return;
        }
        $r    = $q->get('SELECT req_no, timeoptic_req_id, timeoptic_req_code, timeoptic_status FROM lens_requisitions WHERE id = ?', $id);
        $code = (string) $r['timeoptic_req_code'];
        $st   = (string) ($r['timeoptic_status'] ?? 'pending');
        /* รอตรวจ ถอนได้ · ทั้งใบรอของ (ยังไม่ได้ตัดอะไร) ถอนส่วนที่รอได้ ได้สถานะใหม่กลับมา */
        if ($st === 'pending' || $st === 'waiting') {
            $st = self::cancel((int) $r['timeoptic_req_id'])['status'];
        }
        if ($st === 'approved' || $st === 'partial') {
            throw new HttpError(
                409,
                "คำขอ $code TimeOptic ตัดสต็อกไปแล้ว เปลี่ยนเลนส์ไม่ได้ — ยกเลิกใบเบิกเดิมก่อนถ้าต้องการเปลี่ยนเลนส์",
                ['reason' => 'lens_req_locked']
            );
        }
        $q->run(
            'UPDATE lens_requisitions SET timeoptic_req_id = NULL, timeoptic_req_code = NULL, timeoptic_status = NULL,
                    timeoptic_note = NULL, timeoptic_synced_at = NULL WHERE id = ?',
            $id
        );
        logEvent($q, $caseId, [
            'action'      => 'lens_timeoptic_withdrawn',
            'entity'      => 'lens_requisition',
            'entity_id'   => $id,
            'employee_id' => $employee,
            'note'        => $r['req_no'] . ": ถอนคำขอ $code ในคลัง TimeOptic (เปลี่ยนเลนส์หลังขาย)",
        ]);
        self::sendOne($q, $id, $caseId, $employee);
    }

    /** ส่งใบเดียว → null = ส่งแล้ว · ข้อความ = ส่งไม่ผ่าน (ลงไทม์ไลน์แล้ว ไม่โยน) */
    private static function sendOne(Tx $q, int $id, int $caseId, ?int $employee): ?string
    {
        $full = lensReqLoadTx($q, $id);
        try {
            $sent = self::create(self::basket($full['items']), self::note($full));
        } catch (Throwable $e) {
            $why = $full['req_no'] . ': ' . $e->getMessage();
            logEvent($q, $caseId, [
                'action'      => 'lens_timeoptic_send_failed',
                'entity'      => 'lens_requisition',
                'entity_id'   => $id,
                'employee_id' => $employee,
                'note'        => mb_substr(
                    $full['req_no'] . ': ส่งคำขอเข้าคลัง TimeOptic ไม่ผ่าน — ' . $e->getMessage()
                    . ' · ส่งใหม่ได้ที่หน้าใบเบิกเลนส์',
                    0,
                    250
                ),
            ]);
            return $why;
        }
        $q->run(
            'UPDATE lens_requisitions SET timeoptic_req_id = ?, timeoptic_req_code = ?, timeoptic_status = ?,
                    timeoptic_note = NULL, timeoptic_synced_at = NOW() WHERE id = ?',
            $sent['id'],
            $sent['code'],
            $sent['status'],
            $id
        );
        logEvent($q, $caseId, [
            'action'      => 'lens_timeoptic_sent',
            'entity'      => 'lens_requisition',
            'entity_id'   => $id,
            'employee_id' => $employee,
            'note'        => $full['req_no'] . ': ส่งคำขอเข้าคลัง TimeOptic ' . $sent['code'] . ' (หลังยืนยันขาย)',
        ]);
        return null;
    }

    /**
     * เปิดขั้นขายกลับมาแก้ → ถอนคำขอของใบที่ยังรอเบิก ซึ่ง TimeOptic ยังไม่ได้ตรวจ แล้วล้างเลขคำขอ
     * ยืนยันขายรอบใหม่จะส่งรายการเลนส์ที่แก้แล้วเป็นคำขอใบใหม่ · คลังตรวจไปแล้ว (ตัด/ตีกลับ)
     * ไม่ล้าง เก็บสถานะที่ได้มา · ติดต่อคลังไม่ได้ไม่ขวางการเปิดขั้นขาย แค่ลงไทม์ไลน์ไว้
     */
    public static function withdrawForCase(Tx $q, int $caseId, ?int $employee): void
    {
        if (!self::enabled()) {
            return;
        }
        $rows = $q->all(
            "SELECT id, req_no, timeoptic_req_id, timeoptic_req_code FROM lens_requisitions
              WHERE case_id = ? AND status = 'pending' AND timeoptic_req_id IS NOT NULL
                AND COALESCE(timeoptic_status, 'pending') = 'pending'
              ORDER BY id FOR UPDATE",
            $caseId
        );
        foreach ($rows as $r) {
            $code = (string) $r['timeoptic_req_code'];
            try {
                $t = self::cancel((int) $r['timeoptic_req_id']);
            } catch (Throwable $e) {
                $t    = null;
                $note = "ถอนคำขอ $code ในคลัง TimeOptic ไม่สำเร็จ: " . $e->getMessage();
            }
            if ($t !== null && $t['status'] === 'cancelled') {
                $q->run(
                    'UPDATE lens_requisitions SET timeoptic_req_id = NULL, timeoptic_req_code = NULL, timeoptic_status = NULL,
                            timeoptic_note = NULL, timeoptic_synced_at = NULL WHERE id = ?',
                    (int) $r['id']
                );
                $note = "ถอนคำขอ $code ในคลัง TimeOptic แล้ว — ยืนยันขายใหม่จะส่งคำขอใบใหม่";
            } elseif ($t !== null) {
                $q->run(
                    'UPDATE lens_requisitions SET timeoptic_status = ?, timeoptic_note = ?, timeoptic_synced_at = NOW() WHERE id = ?',
                    $t['status'],
                    $t['note'],
                    (int) $r['id']
                );
                $note = "คำขอ $code ถอนไม่ได้ — " . (self::LABEL[$t['status']] ?? $t['status']);
            }
            logEvent($q, $caseId, [
                'action'      => 'lens_timeoptic_withdrawn',
                'entity'      => 'lens_requisition',
                'entity_id'   => (int) $r['id'],
                'employee_id' => $employee,
                'note'        => mb_substr($r['req_no'] . ': ' . $note . ' (เปิดขั้นขายกลับมาแก้)', 0, 250),
            ]);
        }
    }

    /**
     * สถานะล่าสุดของคำขอที่บัญชีนี้ส่ง — [id => shape] · 50 ใบล่าสุดตามที่คลังส่งมา
     *
     * @return array<int,array<string,mixed>>
     */
    public static function mine(): array
    {
        return array_map(static fn(array $r): array => self::shape($r), self::mineRaw());
    }

    /**
     * คำขอตามที่คลังส่งมา (ยังไม่แปลง) — ให้คนเรียกแปลงเองพร้อมข้างตาของใบเบิก (`shape($r, $eyes)`)
     *
     * @return array<int,array<string,mixed>>
     */
    public static function mineRaw(): array
    {
        $rows = self::session(fn(callable $call) => $call('GET', '/issue-requests/mine', null)['requests'] ?? []);
        $out  = [];
        foreach ($rows as $r) {
            if (is_array($r) && isset($r['id'])) {
                $out[(int) $r['id']] = $r;
            }
        }
        return $out;
    }

    /**
     * ข้างตาของแต่ละ SKU ในใบเบิก → ['LNS-0264' => ['R'], ...] สำหรับ shape()
     *
     * @param list<array<string,mixed>> $items แถว lens_requisition_items (lens_code, eye)
     * @return array<string,list<string>>
     */
    public static function eyesOf(array $items): array
    {
        $out = [];
        foreach ($items as $it) {
            $sku = trim((string) ($it['lens_code'] ?? ''));
            $eye = (string) ($it['eye'] ?? '');
            if ($sku === '' || $eye === '') {
                continue;
            }
            foreach ($eye === 'pair' ? ['R', 'L'] : [$eye] as $e) {
                if (!in_array($e, $out[$sku] ?? [], true)) {
                    $out[$sku][] = $e;
                }
            }
        }
        return $out;
    }

    /**
     * คำขอจากคลัง → ช่องที่ Bewell เก็บ
     *
     * approved ที่ยังมีรายการรอของ (คลังของไม่พอ) แยกเป็น partial (ตัดไปบางส่วน) / waiting (ยังไม่ได้ตัดเลย)
     * แล้วบอกทีละข้างว่าข้างไหนตัดแล้ว ข้างไหนรอ · รายการรอที่ถูกยกเลิกบอกในหมายเหตุพร้อมเหตุผล
     * ทุกรายการถูกยกเลิกโดยไม่ได้ตัดอะไรเลย = cancelled
     *
     * @param array<string,list<string>> $eyes ข้างตาต่อ SKU (`eyesOf`) — ไม่ส่ง = บอกแค่รหัส
     */
    public static function shape(array $r, array $eyes = []): array
    {
        $status  = (string) ($r['status'] ?? 'pending');
        $note    = null;
        $result  = is_array($r['result'] ?? null) ? $r['result'] : [];
        $cut     = is_array($result['lines'] ?? null) ? $result['lines'] : [];
        $waiting = is_array($r['waiting'] ?? null) ? $r['waiting'] : (is_array($result['waiting'] ?? null) ? $result['waiting'] : []);
        $drops   = is_array($result['dropped'] ?? null) ? $result['dropped'] : [];
        $dropped = [];
        $why     = [];
        foreach ($drops as $d) {
            if (is_array($d)) {
                $dropped = array_merge($dropped, is_array($d['lines'] ?? null) ? $d['lines'] : []);
                if (trim((string) ($d['reason'] ?? '')) !== '') {
                    $why[] = trim((string) $d['reason']);
                }
            }
        }
        $dropWhy = $why ? ' (' . implode(' / ', $why) . ')' : '';
        $undone  = $r['undone']['state'] ?? null;

        if ($status === 'rejected') {
            $note = $r['rejectReason'] ?? null;
        } elseif ($status === 'approved' && $undone) {
            $note = 'คลังย้อนรายการแล้ว (' . $undone . ')';
        } elseif ($status === 'approved' && $waiting) {
            $status = $cut ? 'partial' : 'waiting';
            $note   = implode(' · ', array_filter([
                $cut ? 'ตัดแล้ว: ' . self::linesText($cut, $eyes) : null,
                'รอของ: ' . self::linesText($waiting, $eyes),
                $dropped ? 'ยกเลิก: ' . self::linesText($dropped, $eyes) . $dropWhy : null,
            ]));
        } elseif ($status === 'approved' && !$cut && $dropped) {
            $status = 'cancelled';
            $note   = 'TimeOptic ยกเลิกรายการที่รอของ: ' . self::linesText($dropped, $eyes) . $dropWhy;
        } elseif ($status === 'approved') {
            $note = implode(' · ', array_filter([
                ($result['referenceDoc'] ?? null) ? 'ใบเบิก ' . $result['referenceDoc'] : null,
                $dropped
                    ? 'ตัดแล้ว: ' . self::linesText($cut, $eyes) . ' · ยกเลิกที่รอของ: ' . self::linesText($dropped, $eyes) . $dropWhy
                    : null,
            ])) ?: null;
        }
        if ($note === null && !empty($r['edited'])) {
            $note = 'TimeOptic แก้รายการก่อนยืนยัน';
        }
        return [
            'id'     => (int) ($r['id'] ?? 0),
            'code'   => (string) ($r['code'] ?? sprintf('REQ-%05d', (int) ($r['id'] ?? 0))),
            'status' => isset(self::LABEL[$status]) ? $status : 'pending',
            'note'   => $note === null ? null : mb_substr((string) $note, 0, 400),
        ];
    }

    /* ─────────────────────────────────────────────────────── ภายใน */

    /**
     * บรรทัด {sku, quantity} → "R LNS-0264, L LNS-0263" (SKU ซ้ำรวมกัน)
     * ระบุข้างเมื่อ SKU นั้นมีข้างเดียวในใบเบิก หรือจำนวนเท่ากับจำนวนข้างพอดี ไม่งั้นบอกจำนวน
     *
     * @param list<mixed> $lines
     * @param array<string,list<string>> $eyes
     */
    private static function linesText(array $lines, array $eyes): string
    {
        $qty = [];
        foreach ($lines as $l) {
            if (is_array($l) && isset($l['sku'])) {
                $qty[(string) $l['sku']] = ($qty[(string) $l['sku']] ?? 0) + (int) ($l['quantity'] ?? 0);
            }
        }
        $out = [];
        foreach ($qty as $sku => $n) {
            $e     = $eyes[$sku] ?? [];
            $side  = count($e) === 1 || (count($e) > 1 && count($e) === $n) ? implode('+', $e) . ' ' : '';
            $out[] = $side . $sku . ($n > 1 && $side === '' ? " ×$n" : '');
        }
        return implode(', ', $out);
    }

    /** @return array{api:string,user:string,pass:string,branch:int}|null */
    private static function cfg(): ?array
    {
        $api    = rtrim((string) env('TIMEOPTIC_STOCK_API', ''), '/');
        $user   = (string) env('TIMEOPTIC_STOCK_USER', '');
        $pass   = (string) env('TIMEOPTIC_STOCK_PASS', '');
        $branch = (int) env('TIMEOPTIC_BRANCH_ID', '0');
        if ($api === '' || $user === '' || $pass === '' || $branch < 1) {
            return null;
        }
        return ['api' => $api, 'user' => $user, 'pass' => $pass, 'branch' => $branch];
    }

    private static function need(): array
    {
        $c = self::cfg();
        if ($c === null) {
            throw self::fail('ยังไม่ได้ตั้งค่าการเชื่อมคลัง TimeOptic (TIMEOPTIC_STOCK_* ใน .env)');
        }
        return $c;
    }

    /**
     * ล็อกอินหนึ่งครั้งแล้วเรียกต่อด้วยคุกกี้เดียวกัน · $fn ได้ฟังก์ชัน call(method, path, body)
     */
    private static function session(callable $fn): mixed
    {
        $c   = self::need();
        $jar = tempnam(sys_get_temp_dir(), 'tos');
        try {
            $call = static fn(string $m, string $p, ?array $b) => self::http($c['api'], $jar, $m, $p, $b);
            $call('POST', '/auth/login', ['username' => $c['user'], 'password' => $c['pass']]);
            return $fn($call);
        } finally {
            if (is_string($jar) && is_file($jar)) {
                @unlink($jar);
            }
        }
    }

    private static function http(string $base, string $jar, string $method, string $path, ?array $body): array
    {
        $ch = curl_init($base . $path);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_COOKIEJAR      => $jar,
            CURLOPT_COOKIEFILE     => $jar,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'Accept: application/json'],
        ]);
        foreach ([getenv('CA_BUNDLE'), ini_get('curl.cainfo'), ini_get('openssl.cafile')] as $ca) {
            if (is_string($ca) && $ca !== '' && is_readable($ca)) {
                curl_setopt($ch, CURLOPT_CAINFO, $ca);
                break;
            }
        }
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
        }
        $raw  = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_errno($ch) ? curl_error($ch) : null;
        curl_close($ch);

        if ($err !== null || !is_string($raw)) {
            throw self::fail('ติดต่อคลัง TimeOptic ไม่ได้' . ($err ? " ($err)" : '') . ' — ลองใหม่อีกครั้ง');
        }
        $data = json_decode($raw, true);
        if ($code >= 200 && $code < 300 && is_array($data)) {
            return $data;
        }
        $msg = is_array($data) && isset($data['message']) ? (string) $data['message'] : "HTTP $code";
        $why = is_array($data) && isset($data['reason']) ? (string) $data['reason'] : 'timeoptic_error';
        if ($path === '/auth/login') {
            $msg = 'บัญชีเชื่อมคลัง TimeOptic ล็อกอินไม่ผ่าน — ' . $msg;
        }
        throw new HttpError(502, 'คลัง TimeOptic: ' . $msg, ['reason' => $why]);
    }

    private static function fail(string $msg): HttpError
    {
        return new HttpError(502, $msg, ['reason' => 'timeoptic_unreachable']);
    }
}
