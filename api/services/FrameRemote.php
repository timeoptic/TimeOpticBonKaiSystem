<?php
/**
 * คลังกรอบของอีกสาขา — สาขาแพไม้ขายกรอบจากสต็อกที่อยู่ในระบบบ่อนไก่
 *
 * ทำไมต้องคุยผ่านเน็ต: บน Hostinger Cloud ผู้ใช้ฐานข้อมูลหนึ่งคนเข้าได้ฐานเดียว
 * สองสาขาจึงใช้ตารางสต็อกชุดเดียวกันตรง ๆ ไม่ได้ · สต็อกกรอบจริงอยู่ที่บ่อนไก่ที่เดียว
 * สาขานี้ค้น ตัด และคืนกรอบผ่าน API ของบ่อนไก่ด้วยบัญชีเชื่อมต่อหนึ่งบัญชี
 *
 * เปิดด้วย .env ของสาขาที่ไม่ได้ถือสต็อกกรอบ (บ่อนไก่ไม่ต้องตั้ง):
 *   FRAME_STOCK_URL    ที่อยู่เว็บ API ของบ่อนไก่ เช่น https://bonkai.example.com หรือ http://127.0.0.1:8099
 *   FRAME_STOCK_USER   บัญชีในระบบบ่อนไก่ ที่มีสิทธิ์ stock.move (บทบาท stock หรือ sales)
 *   FRAME_STOCK_PASS
 *   FRAME_STOCK_TAG    รหัสสาขานี้ ใช้นำหน้า idem_key กันชนกับเลขเคสของบ่อนไก่ (ค่าปริยาย branch)
 *   FRAME_STOCK_LABEL  ชื่อคลังที่คนเห็น (ค่าปริยาย บ่อนไก่)
 *   FRAME_STOCK_FROM   ชื่อสาขานี้ ขึ้นในสมุดสต็อกของบ่อนไก่ (ค่าปริยาย แพไม้)
 *
 * กรณีเลวร้ายที่รับไว้ (ทดสอบใน api/tests/101-frame-remote.test.php และ
 * C:\TimeOptic-QA-backup-20261114\frame-remote\test-frame-remote.mjs):
 *
 *  - บ่อนไก่ล่ม / เน็ตหลุด ตอนยืนยันขาย → การขายผ่าน แถวตัดกรอบเป็น "pending"
 *    แล้วส่งใหม่เองจาก flush() (ทุกครั้งที่มีคนเปิดเว็บ ทุก 30 วินาที + cron) ด้วย idem_key เดิม
 *  - ยิงไปแล้วแต่ไม่ได้คำตอบ (บ่อนไก่ตัดแล้ว เน็ตตัดก่อนตอบ) → ส่งซ้ำด้วยคีย์เดิม
 *    บ่อนไก่ตอบผลเดิม ไม่ตัดสองรอบ · แถวถูกจดเป็น pending *ก่อน* ยิงทุกครั้ง
 *    PHP ตายกลางทางก็ยังมีแถวให้ส่งซ้ำ
 *  - ชิ้นสุดท้ายถูกขายพร้อมกันสองสาขา → บ่อนไก่ล็อกแถวให้ได้คนเดียว อีกฝั่ง (ถ้าออนไลน์)
 *    ยืนยันขายไม่ผ่านพร้อมข้อความ · ถ้าเป็นแถวที่รอส่งอยู่ กลายเป็น "failed" ขึ้นแถบเตือน
 *  - เปิดขั้นขายกลับมาแก้ / เปลี่ยนกรอบ ตอนบ่อนไก่ล่ม → คืนเข้าคิว ส่งทีหลัง
 *    ถ้าการตัดเดิมไม่เคยไปถึง บ่อนไก่ตอบ unknown_original = ไม่มีอะไรต้องคืน
 *  - บัญชีเชื่อมต่อถูกเปลี่ยนรหัส/ปิด → นับเป็น "ติดต่อไม่ได้" การขายไม่สะดุด
 *    แถบเตือนบอกสาเหตุให้แอดมินแก้ .env
 *  - ค้นหากรอบตอนบ่อนไก่ล่ม → ใช้รายการล่าสุดที่จำไว้ (frame_remote_cache) จำนวนคงเหลือขึ้นว่าไม่ทราบ
 */
declare(strict_types=1);

final class FrameRemoteDown extends RuntimeException
{
}

final class FrameRemote
{
    /** แถว case_stock_issues ที่ยังต้องส่ง/ต้องตรวจ */
    private const OPEN = "remote = 1 AND (remote_state IN ('pending','failed') OR reverse_state IN ('pending','failed'))";

    public static function enabled(): bool
    {
        return self::cfg() !== null;
    }

    public static function label(): string
    {
        return (string) (env('FRAME_STOCK_LABEL', '') ?: 'บ่อนไก่');
    }

    public static function from(): string
    {
        return (string) (env('FRAME_STOCK_FROM', '') ?: 'แพไม้');
    }

    public static function tag(): string
    {
        $t = preg_replace('/[^a-z0-9]+/i', '', (string) env('FRAME_STOCK_TAG', ''));
        return strtolower($t ?: 'branch');
    }

    /* ------------------------------------------------------------ ค้นหา */

    /**
     * ค้นกรอบในคลังบ่อนไก่ — คำค้นเดียวกับ GET /api/stock ของที่นี่ (บ่อนไก่ใช้โค้ดชุดเดียวกัน)
     * ติดต่อไม่ได้ → ตอบจากรายการที่จำไว้ล่าสุด แถวมี stale = 1
     */
    public static function search(array $query): array
    {
        /* ค้นผ่านรายการสินค้าของระบบคลังบ่อนไก่ (/stock-api/products) — บัญชีเชื่อมต่อเป็นบทบาท
           stock ซึ่งเข้า /api/stock ของหน้าร้านไม่ได้ (frontdesk_only) และไม่ควรได้ · ไม่เห็นต้นทุน */
        $term  = trim((string) ($query['q'] ?? ''));
        $limit = max(1, min((int) ($query['limit'] ?? 30) ?: 30, 100));
        try {
            $res = self::call('GET', '/stock-api/products?' . http_build_query([
                'type' => 'Frame', 'q' => $term, 'per' => $limit, 'sort' => $term === '' ? 'name' : 'match',
            ]), null, 6);
        } catch (FrameRemoteDown $e) {
            return self::fromCache($term, $limit, $e->getMessage());
        }
        $where = 'คลัง' . self::label();
        $rows  = [];
        foreach ((is_array($res) ? ($res['rows'] ?? []) : []) as $p) {
            if (!is_array($p) || trim((string) ($p['sku'] ?? '')) === '') {
                continue;
            }
            $left = (int) ($p['onHand'] ?? 0);
            if (($query['sold'] ?? null) === '0' && $left <= 0 && $term === '') {
                continue; /* ไม่ได้พิมพ์ค้น = โชว์เฉพาะที่มีของ เหมือนช่องเลือกของที่นี่ */
            }
            $rows[] = [
                'id'            => (int) ($p['id'] ?? 0) ?: null,
                'remote'        => 1,
                'sku'           => (string) $p['sku'],
                'product_name'  => (string) ($p['name'] ?? ''),
                'brand'         => $p['brand'] ?? null,
                'model'         => $p['model'] ?? null,
                'color'         => $p['color'] ?? null,
                'size'          => $p['size'] ?? null,
                'product_type'  => 'Frame',
                'product_price' => $p['basePrice'] ?? null,
                'remaining_qty' => $left,
                'location'      => $where,
            ];
        }
        self::remember($rows);
        return $rows;
    }

    private static function remember(array $rows): void
    {
        foreach ($rows as $r) {
            $sku = trim((string) ($r['sku'] ?? ''));
            if ($sku === '') {
                continue;
            }
            $text = mb_strtolower(implode(' ', array_map('strval', [
                $sku, $r['product_name'] ?? '', $r['brand'] ?? '', $r['model'] ?? '', $r['color'] ?? '', $r['size'] ?? '',
            ])));
            Db::run(
                'INSERT INTO frame_remote_cache (sku, search_text, row_json, seen_at) VALUES (?,?,?,?)
                 ON DUPLICATE KEY UPDATE search_text = VALUES(search_text), row_json = VALUES(row_json), seen_at = VALUES(seen_at)',
                mb_substr($sku, 0, 100),
                mb_substr($text, 0, 1000),
                json_encode($r, JSON_UNESCAPED_UNICODE),
                nowStamp()
            );
        }
    }

    private static function fromCache(string $term, int $limit, string $why): array
    {
        $sql  = 'SELECT row_json, seen_at FROM frame_remote_cache';
        $args = [];
        $words = array_values(array_filter(preg_split('/\s+/u', mb_strtolower(trim($term))) ?: []));
        if ($words) {
            $sql .= ' WHERE ' . implode(' AND ', array_fill(0, count($words), 'search_text LIKE ?'));
            foreach ($words as $w) {
                $args[] = '%' . addcslashes($w, '%_\\') . '%';
            }
        }
        $sql .= ' ORDER BY seen_at DESC LIMIT ' . max(1, min($limit ?: 30, 200));
        $out = [];
        foreach (Db::all($sql, ...$args) as $c) {
            $r = json_decode((string) $c['row_json'], true) ?: [];
            $r['remote']        = 1;
            $r['stale']         = 1;
            $r['remaining_qty'] = null;
            $r['location']      = 'คลัง' . self::label() . ' · ติดต่อไม่ได้ ใช้รายการเมื่อ '
                . substr((string) $c['seen_at'], 0, 16) . ' — ยอดคงเหลือไม่ทราบ';
            $out[] = $r;
        }
        if (!$out) {
            throw new HttpError(502, 'ติดต่อคลังกรอบ' . self::label() . "ไม่ได้ ($why) และยังไม่เคยจำรายการกรอบนี้ไว้", ['reason' => 'frame_remote_down']);
        }
        return $out;
    }

    /* ------------------------------------------------------------ ตัด / คืน */

    /**
     * ตัดกรอบหนึ่งชิ้นของเคส — จดแถว pending ก่อนยิงเสมอ
     * ติดต่อไม่ได้ = ไม่โยน (ขายต่อได้) · บ่อนไก่ปฏิเสธ (ของหมด/ไม่มี SKU) = โยน StockApiError
     */
    public static function issue(array $row): array
    {
        $id = self::insertPending($row);
        try {
            $res = self::call('POST', '/stock-api/stock/issue', [
                'source'        => 'branch-' . self::tag(),
                'idem_key'      => $row['idem_key'],
                'sku'           => $row['sku'],
                'quantity'      => 1,
                'reference_doc' => $row['reference_doc'],
                'note'          => $row['note'],
            ], 10);
        } catch (FrameRemoteDown $e) {
            self::mark($id, ['remote_error' => $e->getMessage()]);
            return $row + ['id' => $id, 'remote_state' => 'pending', 'remote_error' => $e->getMessage()];
        } catch (StockApiError $e) {
            /* ปฏิเสธตั้งแต่ตอนกดขาย — ไม่มีอะไรถูกตัด ลบแถวทิ้ง คนกดเห็นสาเหตุ */
            Db::run('DELETE FROM case_stock_issues WHERE id = ?', $id);
            throw $e;
        }
        self::mark($id, ['remote_state' => 'done', 'remote_error' => null, 'response' => json_encode($res, JSON_UNESCAPED_UNICODE)]);
        return $row + ['id' => $id, 'remote_state' => 'done'];
    }

    /** คืนกรอบที่ตัดไว้ — ปิดแถวฝั่งเราก่อน (ช่องนั้นว่างทันที) แล้วค่อยส่ง ส่งไม่ได้ก็รอคิว */
    public static function reverse(array $prev, string $why): array
    {
        $key = substr('rev-' . $prev['idem_key'] . '-' . $prev['id'], 0, 120);
        Db::run(
            "UPDATE case_stock_issues SET reversed_at = ?, reverse_idem_key = ?, reverse_note = ?, reverse_state = 'pending'
              WHERE id = ?",
            nowStamp(),
            $key,
            mb_substr($why, 0, 255),
            (int) $prev['id']
        );
        $row = Db::get('SELECT * FROM case_stock_issues WHERE id = ?', (int) $prev['id']);
        self::sendReverse($row);
        return ['slot' => $prev['slot'], 'kind' => 'issue', 'sku' => $prev['sku'], 'remote' => 1];
    }

    /**
     * ส่งรายการที่ค้างทั้งหมดอีกรอบ — เรียกได้บ่อยเท่าไรก็ได้ ทุกคำขอใช้คีย์เดิม
     * @return array{sent:int,pending:int,failed:int}
     */
    public static function flush(int $limit = 50): array
    {
        if (!self::enabled()) {
            return ['sent' => 0, 'pending' => 0, 'failed' => 0];
        }
        $got = Db::get("SELECT GET_LOCK('frame_remote_flush', 0) l");
        if (!(int) ($got['l'] ?? 0)) {
            return self::counts() + ['sent' => 0];
        }
        $sent = 0;
        try {
            $rows = Db::all(
                "SELECT * FROM case_stock_issues WHERE remote = 1
                   AND (remote_state = 'pending' OR reverse_state = 'pending') ORDER BY id LIMIT " . max(1, $limit)
            );
            foreach ($rows as $r) {
                try {
                    if ($r['reverse_state'] === 'pending') {
                        self::sendReverse($r, true);
                    } else {
                        self::sendIssue($r);
                    }
                    $sent++;
                } catch (FrameRemoteDown) {
                    break; /* บ่อนไก่ยังล่ม — รอบหน้าค่อยลองใหม่ ไม่ต้องยิงที่เหลือให้เสียเวลา */
                }
            }
        } finally {
            Db::get("SELECT RELEASE_LOCK('frame_remote_flush') r");
        }
        return self::counts() + ['sent' => $sent];
    }

    /** ส่งการตัดที่ค้าง (pending ที่ยังไม่ถูกคืน) */
    private static function sendIssue(array $r): void
    {
        Db::run('UPDATE case_stock_issues SET remote_tries = remote_tries + 1, remote_at = ? WHERE id = ?', nowStamp(), (int) $r['id']);
        try {
            $res = self::call('POST', '/stock-api/stock/issue', [
                'source'        => 'branch-' . self::tag(),
                'idem_key'      => $r['idem_key'],
                'sku'           => $r['sku'],
                'quantity'      => (int) $r['quantity'],
                'reference_doc' => $r['reference_doc'],
                'note'          => 'ส่งซ้ำ — ขายที่สาขา' . self::from() . ' กรอบ เคส ' . $r['reference_doc'],
            ], 10);
        } catch (FrameRemoteDown $e) {
            self::mark((int) $r['id'], ['remote_error' => $e->getMessage()]);
            throw $e;
        } catch (StockApiError $e) {
            /* ขายไปแล้วจริงที่หน้าร้าน แต่บ่อนไก่ตัดไม่ได้ (ของหมด / SKU ถูกลบ) — ต้องมีคนดู */
            self::mark((int) $r['id'], ['remote_state' => 'failed', 'remote_error' => $e->getMessage()]);
            return;
        }
        self::mark((int) $r['id'], ['remote_state' => 'done', 'remote_error' => null, 'response' => json_encode($res, JSON_UNESCAPED_UNICODE)]);
    }

    private static function sendReverse(array $r, bool $rethrow = false): void
    {
        $id = (int) $r['id'];
        if ($r['remote_state'] === 'failed') {
            /* การตัดเดิมไม่เคยสำเร็จ — ไม่มีอะไรต้องคืน */
            self::mark($id, ['reverse_state' => 'done', 'remote_state' => 'cancelled']);
            return;
        }
        Db::run('UPDATE case_stock_issues SET remote_tries = remote_tries + 1, remote_at = ? WHERE id = ?', nowStamp(), $id);
        try {
            self::call('POST', '/stock-api/stock/return', [
                'source'       => 'branch-' . self::tag(),
                'idem_key'     => (string) $r['reverse_idem_key'],
                'reverses_key' => (string) $r['idem_key'],
                'note'         => 'สาขา' . self::from() . ': ' . (string) $r['reverse_note'],
            ], 10);
        } catch (FrameRemoteDown $e) {
            self::mark($id, ['remote_error' => $e->getMessage()]);
            if ($rethrow) {
                throw $e;
            }
            return;
        } catch (StockApiError $e) {
            if ($e->reason === 'unknown_original') {
                /* การตัดเดิมไม่เคยไปถึงบ่อนไก่ — ไม่มีของต้องคืน ถือว่าจบ */
                self::mark($id, ['reverse_state' => 'done', 'remote_state' => 'cancelled', 'remote_error' => null]);
                return;
            }
            if (in_array($e->reason, ['not_reversible', 'nothing_to_return', 'already_reversed'], true)) {
                self::mark($id, ['reverse_state' => 'done', 'remote_error' => null]);
                return;
            }
            if ($e->reason === 'in_flight') {
                self::mark($id, ['remote_error' => $e->getMessage()]);
                return;
            }
            self::mark($id, ['reverse_state' => 'failed', 'remote_error' => $e->getMessage()]);
            return;
        }
        $state = $r['remote_state'] === 'pending' ? 'cancelled' : $r['remote_state'];
        self::mark($id, ['reverse_state' => 'done', 'remote_state' => $state, 'remote_error' => null]);
    }

    /* ------------------------------------------------------------ สถานะ */

    /** @return array{pending:int,failed:int} */
    public static function counts(): array
    {
        $r = Db::get(
            "SELECT SUM(remote_state = 'pending' AND reversed_at IS NULL) + SUM(reverse_state = 'pending') p,
                    SUM(remote_state = 'failed' AND reverse_state IS NULL) + SUM(reverse_state = 'failed') f
               FROM case_stock_issues WHERE remote = 1"
        );
        return ['pending' => (int) ($r['p'] ?? 0), 'failed' => (int) ($r['f'] ?? 0)];
    }

    /** รายการที่ค้าง/ต้องตรวจ พร้อมเลขเคส ให้แถบเตือนแสดง */
    public static function open(): array
    {
        return Db::all(
            'SELECT i.id, i.case_id, c.case_code, i.sku, i.product_name, i.issued_at, i.reversed_at,
                    i.remote_state, i.reverse_state, i.remote_error, i.remote_tries, i.remote_at
               FROM case_stock_issues i LEFT JOIN cases c ON c.id = i.case_id
              WHERE ' . self::OPEN . '
              ORDER BY i.id DESC LIMIT 100'
        );
    }

    /** "รับรู้แล้ว" สำหรับรายการ failed ที่คนไปปรับยอดที่บ่อนไก่เองแล้ว */
    public static function resolve(int $id, string $by): void
    {
        $r = Db::get('SELECT * FROM case_stock_issues WHERE id = ? AND remote = 1', $id);
        if (!$r) {
            missing();
        }
        $note = mb_substr('ปิดรายการโดย ' . $by . ' ' . nowStamp() . ' — ' . (string) $r['remote_error'], 0, 255);
        if ($r['reverse_state'] === 'failed') {
            self::mark($id, ['reverse_state' => 'resolved', 'remote_error' => $note]);
        } elseif ($r['remote_state'] === 'failed') {
            self::mark($id, ['remote_state' => 'resolved', 'remote_error' => $note]);
        }
    }

    /** ทดสอบการเชื่อมต่อจากหน้าเว็บ */
    public static function ping(): array
    {
        $t = microtime(true);
        try {
            $me = self::call('GET', '/api/auth/me', null, 6);
            return ['ok' => true, 'ms' => (int) round((microtime(true) - $t) * 1000),
                'user' => $me['user']['username'] ?? $me['username'] ?? null];
        } catch (FrameRemoteDown $e) {
            return ['ok' => false, 'error' => $e->getMessage()];
        }
    }

    /* ------------------------------------------------------------ ภายใน */

    private static function insertPending(array $r): int
    {
        Db::run(
            "INSERT INTO case_stock_issues
               (case_id, order_id, slot, kind, sku, product_name, lot_id, quantity, idem_key, reference_doc,
                response, employee_id, issued_at, remote, remote_state, remote_tries, remote_at)
             VALUES (?,?,?,'issue',?,?,NULL,1,?,?,NULL,?,?,1,'pending',1,?)",
            $r['case_id'],
            $r['order_id'],
            $r['slot'],
            $r['sku'],
            $r['product_name'],
            $r['idem_key'],
            $r['reference_doc'],
            $r['employee_id'],
            nowStamp(),
            nowStamp()
        );
        return (int) Db::pdo()->lastInsertId();
    }

    private static function mark(int $id, array $cols): void
    {
        $set = implode(', ', array_map(fn($c) => "`$c` = ?", array_keys($cols)));
        Db::run("UPDATE case_stock_issues SET $set WHERE id = ?", ...array_values($cols), ...[$id]);
    }

    /** @return array{url:string,user:string,pass:string}|null */
    private static function cfg(): ?array
    {
        $url  = rtrim((string) env('FRAME_STOCK_URL', ''), '/');
        $user = (string) env('FRAME_STOCK_USER', '');
        $pass = (string) env('FRAME_STOCK_PASS', '');
        return ($url === '' || $user === '' || $pass === '') ? null : ['url' => $url, 'user' => $user, 'pass' => $pass];
    }

    private static function jar(array $c): string
    {
        return sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'frame-remote-' . md5($c['url'] . '|' . $c['user']) . '.jar';
    }

    /** เรียกด้วยคุกกี้ที่จำไว้ · ได้ 401 ล็อกอินใหม่หนึ่งครั้งแล้วลองซ้ำ */
    private static function call(string $method, string $path, ?array $body, int $timeout): mixed
    {
        $c = self::cfg();
        if ($c === null) {
            throw new FrameRemoteDown('ยังไม่ได้ตั้งค่าการเชื่อมคลังกรอบ (FRAME_STOCK_* ใน .env)');
        }
        $jar = self::jar($c);
        [$code, $data] = self::http($c['url'], $jar, $method, $path, $body, $timeout);
        if ($code === 401) {
            [$lc, $ld] = self::http($c['url'], $jar, 'POST', '/api/auth/login', ['username' => $c['user'], 'password' => $c['pass']], 8);
            if ($lc < 200 || $lc >= 300) {
                throw new FrameRemoteDown('บัญชีเชื่อมคลังกรอบ' . self::label() . 'ล็อกอินไม่ผ่าน (' . self::msg($ld, $lc) . ') — แก้ FRAME_STOCK_USER / FRAME_STOCK_PASS');
            }
            [$code, $data] = self::http($c['url'], $jar, $method, $path, $body, $timeout);
        }
        if ($code >= 200 && $code < 300) {
            return $data;
        }
        $reason = is_array($data) ? (string) ($data['reason'] ?? '') : '';
        if ($code === 401 || $code === 403 || $code >= 500 || $code === 0 || !is_array($data)) {
            /* สิทธิ์ไม่พอ/เซิร์ฟเวอร์พัง = ปัญหาการเชื่อมต่อ ไม่ใช่การขาย — รอส่งใหม่ */
            throw new FrameRemoteDown('คลังกรอบ' . self::label() . ': ' . self::msg($data, $code));
        }
        throw new StockApiError($reason ?: 'remote_rejected', 'คลังกรอบ' . self::label() . ': ' . self::msg($data, $code), $code, $data);
    }

    private static function msg(mixed $d, int $code): string
    {
        if (is_array($d)) {
            return (string) ($d['message'] ?? $d['error'] ?? "HTTP $code");
        }
        return $code ? "HTTP $code" : 'ไม่มีคำตอบ';
    }

    /** @return array{0:int,1:mixed} */
    private static function http(string $base, string $jar, string $method, string $path, ?array $body, int $timeout): array
    {
        $ch = curl_init($base . $path);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_CONNECTTIMEOUT => 4,
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
            throw new FrameRemoteDown('ติดต่อคลังกรอบ' . self::label() . 'ไม่ได้' . ($err ? " ($err)" : ''));
        }
        return [$code, json_decode($raw, true)];
    }
}
