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
            $qty[$sku] = ($qty[$sku] ?? 0) + max(1, (int) ($it['quantity'] ?? 1));
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
            'Bewell ' . $r['req_no'],
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
        $c   = self::need();
        $res = self::session(fn(callable $call) => $call('POST', '/issue-requests', [
            'kind'      => 'issue',
            'branch_id' => $c['branch'],
            'body'      => ['items' => $basket, 'note' => $note],
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
     * สถานะล่าสุดของคำขอที่บัญชีนี้ส่ง — [id => shape] · 50 ใบล่าสุดตามที่คลังส่งมา
     *
     * @return array<int,array<string,mixed>>
     */
    public static function mine(): array
    {
        $rows = self::session(fn(callable $call) => $call('GET', '/issue-requests/mine', null)['requests'] ?? []);
        $out  = [];
        foreach ($rows as $r) {
            if (isset($r['id'])) {
                $out[(int) $r['id']] = self::shape($r);
            }
        }
        return $out;
    }

    /** คำขอจากคลัง → ช่องที่ Bewell เก็บ */
    public static function shape(array $r): array
    {
        $status = (string) ($r['status'] ?? 'pending');
        $note   = null;
        if ($status === 'rejected') {
            $note = $r['rejectReason'] ?? null;
        } elseif ($status === 'approved') {
            $undone = $r['undone']['state'] ?? null;
            $note   = $undone
                ? 'คลังย้อนรายการแล้ว (' . $undone . ')'
                : (($r['result']['referenceDoc'] ?? null) ? 'ใบเบิก ' . $r['result']['referenceDoc'] : null);
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
