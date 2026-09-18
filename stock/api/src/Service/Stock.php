<?php

declare(strict_types=1);

namespace Optic\Service;

use Optic\ApiError;
use Optic\Db;
use PDO;

/**
 * Everything that moves stock goes through here.
 *
 * Both callers use the same path: the shop-floor system when a technician takes
 * material for a job, and our own screens when someone keys a movement by hand.
 * One implementation means the ledger can only be wrong in one place.
 *
 * Three properties this class is responsible for:
 *
 *  1. FIFO is decided here, never by the caller. A lot carries its own cost, so
 *     picking a lot is an accounting decision. Callers say what and how many.
 *
 *  2. A repeated request does the work once. The caller supplies a key that is
 *     stable across retries; the second arrival replays the first answer.
 *
 *  3. Concurrent cuts cannot oversell. Lot rows are locked with FOR UPDATE for
 *     the length of the transaction, quantities are decremented relatively, and
 *     every write is guarded so a lost update surfaces as an error rather than
 *     as stock that quietly does not add up.
 */
final class Stock
{
    private const ACTION_LOG = [
        'ISSUE'  => 'OUT',
        'SCRAP'  => 'SCRAP',
        'RETURN' => 'RETURN',
    ];

    /**
     * How many lines one basket may carry.
     *
     * A customer's job is a frame and two lenses; a branch collecting a week's
     * order is a dozen. Past that it is a stock transfer, and a transfer that
     * fails at line 40 and rolls back 39 good cuts helps nobody — those belong
     * in their own baskets.
     */
    private const BASKET_MAX = 20;

    /**
     * ที่ทางเดียวที่ยอดคงเหลือติดลบได้ — การตัดที่ตามหลังการขายหน้าร้าน
     *
     * ตอนคำขอแบบนั้นมาถึงที่นี่ ของออกจากร้านไปแล้วจริง การปฏิเสธไม่ได้ทำให้ของ
     * กลับมา ได้แค่สมุดที่ไม่ตรงกับชั้น · ยอดติดลบที่บอกตรง ๆ ว่าค้างอยู่เท่าไร
     * ดีกว่า และเป็นที่มาของหน้า "สินค้ารอสั่ง"
     *
     * ที่อื่นไม่ใช่แบบนั้น การเบิกที่คนกดเองจากหน้าคลังเกิดขึ้นก่อนของจะขยับ คน
     * กดกำลังจะเดินไปหยิบของจากชั้น และถ้าบนชั้นไม่มี การบันทึกว่าหยิบไปแล้วคือ
     * การโกหกสมุดตั้งแต่แถวแรก ไม่ใช่การจดความจริงที่เกิดไปแล้ว
     *
     * `source` ของคำขอที่เข้ามาทาง HTTP ถูกทับเป็น 'web' ที่ปากทาง (ดู
     * `public/index.php`) เบราว์เซอร์จึงอ้างตัวเป็นหน้าร้านเพื่อผ่านข้อนี้ไม่ได้
     */
    private const MAY_GO_SHORT = ['frontdesk'];

    /**
     * @param array{source?:string,idem_key?:string,sku?:string,quantity?:mixed,
     *              actor_id?:mixed,reference_doc?:?string,note?:?string} $req
     * @return array<string,mixed>
     */
    public static function issue(array $req): array
    {
        return self::draw('ISSUE', $req);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function scrap(array $req): array
    {
        return self::draw('SCRAP', $req);
    }

    /**
     * Several products leaving on one errand — a basket.
     *
     * A pair of lenses is two SKUs, because the left and the right hardly ever
     * share a power, and a customer's job is routinely a frame and two lenses.
     * Done as separate requests those come apart: the frame cuts, a lens is
     * short, and the ledger holds two thirds of a job with nothing saying so.
     * One key, one transaction, all lines or none.
     *
     * @param array<string,mixed> $req @return array<string,mixed>
     */
    public static function issueMany(array $req): array
    {
        return self::drawMany('ISSUE', $req);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function scrapMany(array $req): array
    {
        return self::drawMany('SCRAP', $req);
    }

    /* ------------------------------------------------------------------ read */

    /**
     * What a caller should check before promising a customer anything.
     *
     * @return array<string,mixed>
     */
    public static function availability(string $sku): array
    {
        $p = self::product($sku);

        /* นับล็อตค้างส่งเข้าไปในยอดคงเหลือด้วย — ของที่ขายไปก่อนรับเข้าทำให้ยอด
           ติดลบได้ และตัวเลขที่ติดลบคือคำตอบที่ตรงกับความจริง · ส่วน "กี่ล็อต"
           นับเฉพาะล็อตที่มีของจริง เพราะล็อตค้างส่งไม่ใช่กล่องที่หยิบได้ */
        $row = Db::one(
            'SELECT COALESCE(SUM(remaining_qty), 0) AS on_hand,
                    SUM(CASE WHEN remaining_qty > 0 THEN 1 ELSE 0 END) AS lots
             FROM stock_lots WHERE product_id = ?',
            [$p['id']],
        );

        return [
            'sku'            => $p['sku'],
            'name'           => $p['name'],
            'is_custom_made' => (bool) $p['is_custom_made'],
            // A made-to-order lens is not "out of stock" — it never had any.
            'on_hand'        => (bool) $p['is_custom_made'] ? 0 : (int) $row['on_hand'],
            'lots'           => (bool) $p['is_custom_made'] ? 0 : (int) $row['lots'],
        ];
    }

    /**
     * ล็อตค้างส่งของสินค้าตัวนี้ — เปิดให้ก่อนการขาย ถ้ายังไม่มี
     *
     * หน้าขายของหน้าร้านเก็บ id ของล็อตลงออเดอร์ แล้วตอนยืนยันการขายค่อยแปลงเป็น
     * SKU ส่งมาตัด · สินค้าที่มีแต่ชื่อในแคตตาล็อก ยังไม่เคยรับของเข้าสักล็อต จึงไม่มี
     * อะไรให้ออเดอร์ชี้ ทั้งที่การขายหน้าร้านตัดติดลบได้อยู่แล้ว (`MAY_GO_SHORT`)
     *
     * ใบที่เปิดคือ `SHORT-<sku>` ใบเดียวกับที่การตัดติดลบจะไปลงอยู่แล้ว ยอดศูนย์
     * ไม่มีของเคลื่อน จึงไม่มีแถวในสมุด (ยอดศูนย์ = ผลรวมสมุดศูนย์ `doctor` ยังผ่าน)
     * เรียกซ้ำได้ใบเดิม · เปิดแล้วไม่มีใครขายก็ไม่เสียหาย ยอดของสินค้ายังเป็นศูนย์
     *
     * @return array{lot_id:int,sku:string,created:bool}
     */
    public static function backorderLot(string $sku): array
    {
        $sku = trim($sku);
        if ($sku === '') {
            throw ApiError::badRequest('ต้องระบุ sku', 'missing_field');
        }
        $p = self::product($sku);
        if ((bool) $p['is_custom_made']) {
            throw ApiError::customMade($sku);
        }

        return Db::tx(static function (PDO $pdo) use ($p) {
            /* ล็อกแถวสินค้าก่อนหา — lot_number ไม่มี UNIQUE สองคนกดเลือกพร้อมกันจะได้ไม่
               เปิดล็อตค้างส่งสองใบให้สินค้าตัวเดียว (คนที่สองรอ แล้วเจอใบของคนแรก) */
            $pdo->prepare('SELECT id FROM products WHERE id = ? FOR UPDATE')->execute([$p['id']]);

            $before = $pdo->prepare('SELECT COUNT(*) FROM stock_lots WHERE product_id = ? AND lot_number = ?');
            $before->execute([$p['id'], 'SHORT-' . $p['sku']]);
            $existed = (int) $before->fetchColumn() > 0;

            $lot = self::shortfallLot($pdo, $p);
            return ['lot_id' => (int) $lot['id'], 'sku' => (string) $p['sku'], 'created' => !$existed];
        });
    }

    /* ----------------------------------------------------------------- write */

    /**
     * ISSUE and SCRAP both take stock out in FIFO order. They differ only in
     * what the ledger calls it, which is what keeps ruined material out of the
     * cost of goods sold.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    private static function draw(string $action, array $req): array
    {
        $source = self::str($req, 'source', 30);
        $key    = self::str($req, 'idem_key', 120);
        $sku    = self::str($req, 'sku', 100);
        $qty    = self::qty($req);
        $actor  = self::actor($req);
        $doc    = self::optional($req, 'reference_doc', 100);
        $note   = self::optional($req, 'note', 500);
        $to     = self::recipient($action, $req);

        $replay = self::replayOf($source, $key);
        if ($replay !== null) {
            return $replay;
        }

        try {
            return self::drawTx($action, $source, $key, $sku, $qty, $actor, $doc, $note, $to);
        } catch (ReplayNeeded) {
            // Someone else claimed the key while we were waiting on the index.
            // Their transaction has committed by now, so their answer is ours.
            return self::replayOf($source, $key)
                ?? throw ApiError::conflict('in_flight', 'คำขอเดียวกันกำลังทำอยู่ ลองใหม่อีกครั้ง');
        }
    }

    /**
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    private static function drawMany(string $action, array $req): array
    {
        $source = self::str($req, 'source', 30);
        $key    = self::str($req, 'idem_key', 120);
        $items  = self::items($req);
        $actor  = self::actor($req);
        $doc    = self::optional($req, 'reference_doc', 100);
        $note   = self::optional($req, 'note', 500);
        $to     = self::recipient($action, $req);

        $replay = self::replayOf($source, $key);
        if ($replay !== null) {
            return $replay;
        }

        try {
            return self::drawManyTx($action, $source, $key, $items, $actor, $doc, $note, $to);
        } catch (ReplayNeeded) {
            return self::replayOf($source, $key)
                ?? throw ApiError::conflict('in_flight', 'คำขอเดียวกันกำลังทำอยู่ ลองใหม่อีกครั้ง');
        }
    }

    /**
     * @param list<array{sku:string,quantity:int}> $items
     * @param array{admin_id:?int,branch_id:?int,taken_by:?string} $to
     * @return array<string,mixed>
     */
    private static function drawManyTx(
        string $action,
        string $source,
        string $key,
        array $items,
        ?int $actor,
        ?string $doc,
        ?string $note,
        array $to,
    ): array {
        return Db::tx(static function (PDO $pdo) use ($action, $source, $key, $items, $actor, $doc, $note, $to) {
            $total = array_sum(array_map(static fn($i) => $i['quantity'], $items));

            // A basket has no single SKU to file under, so it files under none;
            // the lines are in the response, which is the record that replays.
            $requestId = self::claim($pdo, $source, $key, $action, null, $total, $actor);
            if ($requestId === null) {
                throw new ReplayNeeded();
            }

            $issuedTo = $to['admin_id'] === null ? null : self::staff($pdo, $to['admin_id']);

            // Sorted by SKU before anything is locked. Two tills each holding
            // one of the other's lots is a deadlock; taking them in the same
            // order every time means the second till waits instead.
            usort($items, static fn($a, $b) => strcmp($a['sku'], $b['sku']));

            // Every line is locked and checked before any of them is cut, so a
            // basket that cannot be filled writes nothing at all — no half-cut
            // pair, and no branch receivable opened for goods that never left.
            $plans = [];
            foreach ($items as $item) {
                $plans[] = self::plan($pdo, $source, $item['sku'], $item['quantity']);
            }

            $lines = [];
            $cuts = [];
            foreach ($plans as $plan) {
                $line = self::applyPlan($pdo, $action, $plan, $actor, $doc, $note, $to, $issuedTo);
                $line['total_cost'] = self::totalCost($line['cuts']);
                $lines[] = $line;
                $cuts = array_merge($cuts, $line['cuts']);
            }

            $response = [
                'replayed'   => false,
                'action'     => $action,
                'lines'      => $lines,
                'quantity'   => $total,
                'total_cost' => self::totalCost($cuts),
                'issued_to'  => $issuedTo,
            ];

            self::record($pdo, $requestId, $response);
            return $response;
        });
    }

    /**
     * The basket's lines, checked and tidied.
     *
     * The same SKU twice is added up rather than cut twice: two lines of the
     * same product are one withdrawal of that product as far as the shelf is
     * concerned, and cutting twice would open two branch receivables for what
     * the branch received once.
     *
     * @param array<string,mixed> $req
     * @return list<array{sku:string,quantity:int}>
     */
    private static function items(array $req): array
    {
        $raw = $req['items'] ?? null;
        if (!is_array($raw) || $raw === []) {
            throw ApiError::badRequest('ตะกร้าต้องมีอย่างน้อยหนึ่งรายการ', 'empty_basket');
        }
        if (count($raw) > self::BASKET_MAX) {
            throw ApiError::badRequest(
                'ตะกร้าใส่ได้ไม่เกิน ' . self::BASKET_MAX . ' รายการต่อครั้ง',
                'basket_too_big',
            );
        }

        $merged = [];
        foreach ($raw as $line) {
            if (!is_array($line)) {
                throw ApiError::badRequest('รายการในตะกร้าต้องเป็นอ็อบเจกต์', 'bad_basket_line');
            }
            $sku = self::str($line, 'sku', 100);
            $qty = self::qty($line);
            $merged[$sku] = ($merged[$sku] ?? 0) + $qty;
        }

        $items = [];
        foreach ($merged as $sku => $qty) {
            $items[] = ['sku' => (string) $sku, 'quantity' => $qty];
        }
        return $items;
    }

    /**
     * @param array{admin_id:?int,branch_id:?int,taken_by:?string} $to
     * @return array<string,mixed>
     */
    private static function drawTx(
        string $action,
        string $source,
        string $key,
        string $sku,
        int $qty,
        ?int $actor,
        ?string $doc,
        ?string $note,
        array $to,
    ): array {
        return Db::tx(static function (PDO $pdo) use ($action, $source, $key, $sku, $qty, $actor, $doc, $note, $to) {
            // Claim the key before doing any work. A concurrent duplicate blocks
            // here on the unique index until we commit, then replays our answer.
            $requestId = self::claim($pdo, $source, $key, $action, $sku, $qty, $actor);
            if ($requestId === null) {
                throw new ReplayNeeded();
            }

            // The recipient is settled before any stock moves, so a withdrawal
            // never half-happens against a branch that turns out to be closed.
            $issuedTo = $to['admin_id'] === null ? null : self::staff($pdo, $to['admin_id']);

            $line = self::cutOne($pdo, $action, $source, $sku, $qty, $actor, $doc, $note, $to, $issuedTo);

            $response = [
                'replayed'        => false,
                'action'          => $action,
                'sku'             => $sku,
                'cuts'            => $line['cuts'],
                'total_cost'      => self::totalCost($line['cuts']),
                'remaining_after' => $line['remaining_after'],
                'issued_to'       => $issuedTo,
                'branch_issue_id' => $line['branch_issue_id'],
            ];

            self::record($pdo, $requestId, $response);
            return $response;
        });
    }

    /**
     * One product's worth of a withdrawal, inside a transaction someone else
     * opened.
     *
     * Split out of `drawTx` so a basket can run it once per line without a
     * second copy of the FIFO rules. Everything it touches — the lot lock, the
     * ledger rows, the branch receivable — belongs to the caller's transaction,
     * so a line that refuses takes the whole basket down with it. That is the
     * point: a pair of lenses half-issued is worse than a pair not issued.
     *
     * @param array{admin_id:?int,branch_id:?int,taken_by:?string} $to
     * @return array{sku:string,name:string,quantity:int,cuts:list<array<string,mixed>>,remaining_after:int,branch_issue_id:?int}
     */
    private static function cutOne(
        PDO $pdo,
        string $action,
        string $source,
        string $sku,
        int $qty,
        ?int $actor,
        ?string $doc,
        ?string $note,
        array $to,
        ?int $issuedTo,
    ): array {
        return self::applyPlan(
            $pdo,
            $action,
            self::plan($pdo, $source, $sku, $qty),
            $actor,
            $doc,
            $note,
            $to,
            $issuedTo,
        );
    }

    /**
     * Everything that can be refused, settled before anything is written.
     *
     * Locking and checking is its own step so a basket can clear every line
     * before it cuts the first one. Rolling back would undo the writes either
     * way, but "refused, nothing written" and "written, then unwound" are not
     * the same thing to read afterwards — and the branch receivable a line
     * opens is a document, not just a row.
     *
     * @return array{product:array<string,mixed>,lots:list<array<string,mixed>>,available:int,quantity:int}
     */
    private static function plan(PDO $pdo, string $source, string $sku, int $qty): array
    {
        $p = self::product($sku);
        if ((bool) $p['is_custom_made']) {
            throw ApiError::customMade($sku);
        }

        // FOR UPDATE holds these rows for the rest of the transaction, so a
        // second technician cutting the same product waits rather than
        // reading a quantity that is about to change.
        $st = $pdo->prepare(
            'SELECT id, lot_number, remaining_qty, cost_per_unit
             FROM stock_lots
             WHERE product_id = ? AND remaining_qty > 0
             ORDER BY received_date ASC, id ASC
             FOR UPDATE'
        );
        $st->execute([$p['id']]);
        $lots = $st->fetchAll();

        $available = array_sum(array_map(static fn($l) => (int) $l['remaining_qty'], $lots));

        $shortfall = max(0, $qty - $available);

        /*
         * ของไม่พอ — ปฏิเสธ ยกเว้นคำขอที่มาจากการขายหน้าร้าน
         *
         * ร้านขายกรอบที่ยังไม่เข้าอยู่แล้ว ลูกค้าสั่ง จ่ายเงิน ของมาสัปดาห์หน้า
         * เมื่อก่อนระบบปฏิเสธทุกทาง พนักงานจึงต้องเลือกระหว่างไม่บันทึกการขาย
         * กับรับของเข้าลอย ๆ ก่อนเพื่อให้ตัดผ่าน · ทั้งสองทางทำให้ตัวเลขในระบบ
         * ไม่ตรงกับความจริง ซึ่งแย่กว่ายอดติดลบที่บอกตรง ๆ ว่าค้างอยู่เท่าไร
         *
         * แต่ข้อยกเว้นนั้นเป็นของการขาย ไม่ใช่ของทุกคนที่กดตัด — การเบิกที่คนกด
         * เองจากหน้าคลังยังปฏิเสธเหมือนเดิม ดู `MAY_GO_SHORT` ว่าทำไม
         */
        if ($shortfall > 0 && !in_array($source, self::MAY_GO_SHORT, true)) {
            throw ApiError::insufficient($sku, $qty, $available);
        }

        return [
            'product'   => $p,
            'lots'      => $lots,
            'available' => $available,
            'quantity'  => $qty,
            'shortfall' => $shortfall,
        ];
    }

    /**
     * ล็อตค้างส่งของสินค้าตัวหนึ่ง — ที่เดียวที่ยอดติดลบได้
     *
     * ล็อตจริงคือของที่มาถึงเป็นกล่อง ติดลบไม่ได้ตามนิยาม · ของที่ขายไปก่อนของ
     * มาถึงจึงไปกองอยู่บนล็อตนี้ หนึ่งใบต่อสินค้าหนึ่งตัว ไม่มีต้นทุนเพราะยังไม่
     * รู้ว่าจะซื้อมาเท่าไร และไม่ถูกหยิบไปตัดรอบหน้า เพราะการตัดเลือกเฉพาะล็อตที่
     * ยอดเป็นบวก
     */
    private static function shortfallLot(PDO $pdo, array $p): array
    {
        $number = 'SHORT-' . $p['sku'];

        $st = $pdo->prepare(
            'SELECT id, lot_number, remaining_qty, cost_per_unit FROM stock_lots
             WHERE product_id = ? AND lot_number = ? FOR UPDATE'
        );
        $st->execute([$p['id'], $number]);
        $lot = $st->fetch();
        if ($lot !== false) {
            return $lot;
        }

        $pdo->prepare(
            'INSERT INTO stock_lots
               (lot_number, product_id, supplier_id, cost_per_unit, initial_qty,
                remaining_qty, received_date, notes)
             VALUES (?, ?, NULL, NULL, 0, 0, CURDATE(), ?)'
        )->execute([
            $number,
            $p['id'],
            'ล็อตค้างส่ง — ของที่ขายไปก่อนรับเข้า หักกลบเองเมื่อของมาถึง',
        ]);

        return [
            'id'            => (int) $pdo->lastInsertId(),
            'lot_number'    => $number,
            'remaining_qty' => 0,
            'cost_per_unit' => null,
        ];
    }

    /**
     * The writing half: the receivable, the lot decrements and the ledger rows.
     *
     * @param array{product:array<string,mixed>,lots:list<array<string,mixed>>,available:int,quantity:int} $plan
     * @param array{admin_id:?int,branch_id:?int,taken_by:?string} $to
     * @return array{sku:string,name:string,quantity:int,cuts:list<array<string,mixed>>,remaining_after:int,branch_issue_id:?int}
     */
    private static function applyPlan(
        PDO $pdo,
        string $action,
        array $plan,
        ?int $actor,
        ?string $doc,
        ?string $note,
        array $to,
        ?int $issuedTo,
    ): array {
        $p = $plan['product'];
        $lots = $plan['lots'];
        $available = $plan['available'];
        $qty = $plan['quantity'];

        $branchIssueId = $to['branch_id'] === null
            ? null
            : self::openBranchIssue($pdo, $to, $p, $qty, $actor, $note);

        $cuts = [];
        $left = $qty;
        foreach ($lots as $lot) {
            if ($left === 0) {
                break;
            }
            $take = min($left, (int) $lot['remaining_qty']);
            $left -= $take;

            // Relative decrement plus a guard. If another writer slipped in
            // despite the lock, rowCount() is 0 and we refuse rather than
            // writing a quantity computed from a stale read.
            $changed = $pdo->prepare(
                'UPDATE stock_lots SET remaining_qty = remaining_qty - ?
                 WHERE id = ? AND remaining_qty >= ?'
            );
            $changed->execute([$take, $lot['id'], $take]);
            if ($changed->rowCount() !== 1) {
                throw ApiError::conflict('race', 'มีการแก้ยอดล็อตนี้พร้อมกัน ลองใหม่อีกครั้ง', [
                    'lot' => $lot['lot_number'],
                ]);
            }

            $pdo->prepare(
                'INSERT INTO inventory_logs
                   (product_id, lot_id, action_type, quantity, unit_cost,
                    reference_doc, notes, created_by, created_by_kind,
                    issued_to_admin_id, scrap_by, branch_issue_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'user\', ?, ?, ?, NOW())'
            )->execute([
                $p['id'],
                $lot['id'],
                self::ACTION_LOG[$action],
                -$take,
                $lot['cost_per_unit'],
                $doc,
                $note,
                $actor,
                $issuedTo,
                $to['scrap_by'] ?? null,
                $branchIssueId,
            ]);

            LowStock::watch((int) $p['id']);

            $cuts[] = [
                'lot'       => $lot['lot_number'],
                'lot_id'    => (int) $lot['id'],
                'quantity'  => $take,
                'unit_cost' => $lot['cost_per_unit'],
            ];
        }

        /*
         * ส่วนที่ของไม่พอ — ลงบนล็อตค้างส่ง ยอดของสินค้าจึงติดลบได้
         *
         * ยังต้องมีแถวในสมุดเท่าจำนวนที่ตัดจริงทั้งหมด ไม่งั้นยอดคงเหลือกับสมุด
         * จะไม่ตรงกัน ซึ่งเป็นข้อที่ `doctor` ตรวจ · ต้นทุนของแถวนี้เป็น NULL
         * เพราะยังไม่รู้ว่าจะซื้อของมาเท่าไร — จะรู้ตอนของมาถึงและถูกหักกลบ
         */
        if ($left > 0) {
            $short = self::shortfallLot($pdo, $p);

            $pdo->prepare('UPDATE stock_lots SET remaining_qty = remaining_qty - ? WHERE id = ?')
                ->execute([$left, $short['id']]);

            $pdo->prepare(
                'INSERT INTO inventory_logs
                   (product_id, lot_id, action_type, quantity, unit_cost,
                    reference_doc, notes, created_by, created_by_kind,
                    issued_to_admin_id, scrap_by, branch_issue_id, created_at)
                 VALUES (?, ?, ?, ?, NULL, ?, ?, ?, \'user\', ?, ?, ?, NOW())'
            )->execute([
                $p['id'],
                $short['id'],
                self::ACTION_LOG[$action],
                -$left,
                $doc,
                trim((string) $note . ' · ขายเกินของที่มี ค้างส่ง ' . $left . ' ชิ้น'),
                $actor,
                $issuedTo,
                $to['scrap_by'] ?? null,
                $branchIssueId,
            ]);

            LowStock::watch((int) $p['id']);

            $cuts[] = [
                'lot'       => $short['lot_number'],
                'lot_id'    => (int) $short['id'],
                'quantity'  => $left,
                'unit_cost' => null,
                'shortfall' => true,
            ];
            $left = 0;
        }

        if ($branchIssueId !== null) {
            self::costBranchIssue($pdo, $branchIssueId, $cuts);
        }

        return [
            'sku'             => $p['sku'],
            'name'            => $p['name'],
            'quantity'        => $qty,
            'cuts'            => $cuts,
            'remaining_after' => $available - $qty,
            'branch_issue_id' => $branchIssueId,
        ];
    }

    /* ------------------------------------------------------------ recipients */

    /**
     * Opens the receivable that a branch withdrawal creates.
     *
     * No amount is recorded here, on purpose. What the branch owes is not known
     * on the day the goods leave — only what they cost us is. The money, and
     * with it the profit and the date the profit belongs to, arrives later
     * through Settlement::settle().
     *
     * @param array{admin_id:?int,branch_id:?int,taken_by:?string} $to
     * @param array<string,mixed> $p
     */
    private static function openBranchIssue(
        PDO $pdo,
        array $to,
        array $p,
        int $qty,
        ?int $actor,
        ?string $note,
    ): int {
        $st = $pdo->prepare('SELECT id, name, is_active FROM branches WHERE id = ?');
        $st->execute([$to['branch_id']]);
        $branch = $st->fetch();

        if ($branch === false) {
            throw ApiError::notFound('ไม่พบสาขาที่ระบุ');
        }
        if (!(bool) $branch['is_active']) {
            throw ApiError::conflict(
                'branch_inactive',
                "สาขา {$branch['name']} ปิดใช้งานอยู่ เบิกใหม่ไม่ได้",
                ['branch' => $branch['name']],
            );
        }

        $pdo->prepare(
            'INSERT INTO branch_issues
               (branch_id, taken_by, product_id, sku, quantity,
                cost_total, cost_unknown_qty, issued_at, issued_by, status, note)
             VALUES (?, ?, ?, ?, ?, 0, 0, NOW(), ?, \'pending\', ?)'
        )->execute([
            $branch['id'],
            $to['taken_by'],
            $p['id'],
            $p['sku'],
            $qty,
            $actor,
            $note,
        ]);

        return (int) $pdo->lastInsertId();
    }

    /**
     * Freezes what the withdrawal cost us, once FIFO has said which lots it came
     * from. Frozen rather than recomputed later: a lot's cost being corrected in
     * six weeks must not silently rewrite the margin on a settled withdrawal.
     *
     * @param list<array<string,mixed>> $cuts
     */
    private static function costBranchIssue(PDO $pdo, int $issueId, array $cuts): void
    {
        $total = '0';
        $unknown = 0;

        foreach ($cuts as $c) {
            if ($c['unit_cost'] === null) {
                // Counted, not guessed. The screens show these pieces as missing
                // a cost so nobody reads the total as the whole story.
                $unknown += (int) $c['quantity'];
                continue;
            }
            $total = bcadd($total, bcmul((string) $c['unit_cost'], (string) $c['quantity'], 2), 2);
        }

        $pdo->prepare('UPDATE branch_issues SET cost_total = ?, cost_unknown_qty = ? WHERE id = ?')
            ->execute([$total, $unknown, $issueId]);
    }

    /**
     * คืนของที่สาขาเบิกไป กลับเข้าล็อตเดิมที่มันถูกตัดออกมา
     *
     * ทำงานอยู่ในทรานแซกชันที่คนเรียกเปิดไว้ — สถานะของใบเบิกกับยอดของล็อตต้อง
     * เปลี่ยนพร้อมกันหรือไม่เปลี่ยนเลย ใบที่ยกเลิกแล้วแต่ของไม่กลับเข้าคลังคือ
     * ของที่หายไปเฉย ๆ โดยไม่มีบรรทัดไหนอธิบาย
     *
     * ล็อตไหนและกี่ชิ้น อ่านจากสมุด ไม่ใช่ให้คนเรียกบอก: ของที่ตัดจาก FIFO ไป
     * สามล็อตต้องกลับเข้าสามล็อตเดิมตามจำนวนเดิม คืนรวมเข้าล็อตเดียวจะทำให้
     * ฐานต้นทุนของล็อตนั้นผิดไปตลอด · แถว OUT ที่ผูกกับใบเบิกใบนี้บอกครบอยู่แล้ว
     *
     * ล็อตค้างส่ง (`SHORT-<sku>`) ก็อยู่ในนั้นด้วย และถูกหักกลบกลับด้วยกฎเดียวกัน
     * — มันคือล็อตที่ `initial_qty` เป็นศูนย์และยอดคงเหลือติดลบ การคืนของจึงพา
     * มันกลับขึ้นมาที่ศูนย์พอดี ไม่ใช่กรณีพิเศษที่ต้องเขียนแยก
     *
     * @return list<array{lot:string,lot_id:int,quantity:int}> สิ่งที่คืนเข้าไปจริง
     */
    public static function undoBranchIssue(PDO $pdo, int $issueId, ?int $actor, string $note): array
    {
        $st = $pdo->prepare(
            'SELECT g.lot_id, g.quantity, g.product_id, g.reference_doc, l.lot_number
             FROM inventory_logs g
             JOIN stock_lots l ON l.id = g.lot_id
             WHERE g.branch_issue_id = ? AND g.action_type = \'OUT\'
             ORDER BY g.id ASC'
        );
        $st->execute([$issueId]);
        $cuts = $st->fetchAll();

        $back = [];
        foreach ($cuts as $cut) {
            $qty = -(int) $cut['quantity'];
            if ($qty <= 0) {
                continue;
            }

            // ไม่คืนเกินกว่าที่ล็อตนั้นเคยรับเข้า — เหมือนเส้นทางคืนของปกติ
            $put = $pdo->prepare(
                'UPDATE stock_lots SET remaining_qty = remaining_qty + ?
                 WHERE id = ? AND remaining_qty + ? <= initial_qty'
            );
            $put->execute([$qty, $cut['lot_id'], $qty]);
            if ($put->rowCount() !== 1) {
                throw ApiError::conflict('over_return', 'คืนแล้วยอดจะเกินจำนวนที่เคยรับเข้าล็อตนี้', [
                    'lot' => $cut['lot_number'],
                ]);
            }

            $pdo->prepare(
                'INSERT INTO inventory_logs
                   (product_id, lot_id, action_type, quantity, unit_cost,
                    reference_doc, notes, created_by, created_by_kind,
                    branch_issue_id, created_at)
                 SELECT product_id, id, \'RETURN\', ?, cost_per_unit, ?, ?, ?, \'user\', ?, NOW()
                 FROM stock_lots WHERE id = ?'
            )->execute([
                $qty,
                $cut['reference_doc'],
                $note,
                $actor,
                $issueId,
                $cut['lot_id'],
            ]);

            LowStock::watchLot((int) $cut['lot_id']);

            $back[] = [
                'lot'      => (string) $cut['lot_number'],
                'lot_id'   => (int) $cut['lot_id'],
                'quantity' => $qty,
            ];
        }

        return $back;
    }

    /**
     * The branch brought the goods back, so the receivable never becomes money.
     * 'cancelled' rather than 'written_off': nobody failed to pay.
     */
    private static function cancelBranchIssue(PDO $pdo, int $issueId): void
    {
        $st = $pdo->prepare('SELECT id, status FROM branch_issues WHERE id = ? FOR UPDATE');
        $st->execute([$issueId]);
        $issue = $st->fetch();

        if ($issue === false) {
            return; // Nothing left to cancel; the stock still goes back.
        }

        if ($issue['status'] === 'settled') {
            throw ApiError::conflict(
                'already_settled',
                'รายการนี้รับเงินจากสาขาไปแล้ว คืนของย้อนหลังไม่ได้ — ให้ฝ่ายบัญชีออกใบลดหนี้แทน',
                ['branchIssueId' => $issueId],
            );
        }

        $pdo->prepare('UPDATE branch_issues SET status = \'cancelled\' WHERE id = ?')
            ->execute([$issueId]);
    }

    /** Confirms the named person is a real, active account before naming them. */
    private static function staff(PDO $pdo, int $adminId): int
    {
        $st = $pdo->prepare('SELECT id, is_active FROM admins WHERE id = ?');
        $st->execute([$adminId]);
        $row = $st->fetch();

        if ($row === false) {
            throw ApiError::notFound('ไม่พบผู้ใช้ที่ระบุเป็นผู้เบิก');
        }
        if (!(bool) $row['is_active']) {
            throw ApiError::conflict('inactive_actor', 'บัญชีผู้เบิกถูกปิดใช้งานอยู่');
        }

        return (int) $row['id'];
    }

    /**
     * Puts back what a previous request took out, reading the original request
     * to know which lots and how many. The caller cannot say — that would let a
     * mistake return stock into the wrong lot and corrupt its cost basis.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function returnStock(array $req): array
    {
        $source  = self::str($req, 'source', 30);
        $key     = self::str($req, 'idem_key', 120);
        $reverse = self::str($req, 'reverses_key', 120);
        $actor   = self::actor($req);
        $note    = self::optional($req, 'note', 500);

        $replay = self::replayOf($source, $key);
        if ($replay !== null) {
            return $replay;
        }

        $original = Db::one(
            'SELECT * FROM stock_requests WHERE source = ? AND idem_key = ? AND status = \'done\'',
            [$source, $reverse],
        );
        if ($original === null) {
            throw ApiError::conflict('unknown_original', "ไม่พบรายการเดิมที่อ้างถึง ({$reverse})", [
                'reverses_key' => $reverse,
            ]);
        }
        if ($original['action'] === 'RETURN') {
            throw ApiError::conflict('not_reversible', 'รายการที่อ้างถึงเป็นการคืนอยู่แล้ว คืนซ้ำไม่ได้');
        }

        $prev = json_decode((string) $original['response'], true);
        $cuts = is_array($prev['cuts'] ?? null) ? $prev['cuts'] : [];
        if ($cuts === []) {
            throw ApiError::conflict('nothing_to_return', 'รายการเดิมไม่ได้ตัดสต็อกไว้');
        }

        $branchIssueId = isset($prev['branch_issue_id']) && is_int($prev['branch_issue_id'])
            ? $prev['branch_issue_id']
            : null;

        try {
            return self::returnTx($source, $key, $actor, $note, $original, $cuts, $branchIssueId);
        } catch (ReplayNeeded) {
            return self::replayOf($source, $key)
                ?? throw ApiError::conflict('in_flight', 'คำขอเดียวกันกำลังทำอยู่ ลองใหม่อีกครั้ง');
        }
    }

    /**
     * @param array<string,mixed> $original
     * @param list<array<string,mixed>> $cuts
     * @return array<string,mixed>
     */
    private static function returnTx(
        string $source,
        string $key,
        ?int $actor,
        ?string $note,
        array $original,
        array $cuts,
        ?int $branchIssueId,
    ): array {
        return Db::tx(static function (PDO $pdo) use ($source, $key, $actor, $note, $original, $cuts, $branchIssueId) {
            $requestId = self::claim(
                $pdo,
                $source,
                $key,
                'RETURN',
                (string) $original['sku'],
                abs((int) $original['quantity']),
                $actor,
            );
            if ($requestId === null) {
                throw new ReplayNeeded();
            }

            // Cancel the debt before moving any stock. A branch that has already
            // paid cannot have its withdrawal quietly reversed here — that is a
            // credit note, and it belongs to whoever keeps the books.
            if ($branchIssueId !== null) {
                self::cancelBranchIssue($pdo, $branchIssueId);
            }

            $back = [];
            foreach ($cuts as $cut) {
                // Never put back more than the lot originally held.
                $changed = $pdo->prepare(
                    'UPDATE stock_lots SET remaining_qty = remaining_qty + ?
                     WHERE id = ? AND remaining_qty + ? <= initial_qty'
                );
                $changed->execute([$cut['quantity'], $cut['lot_id'], $cut['quantity']]);
                if ($changed->rowCount() !== 1) {
                    throw ApiError::conflict('over_return', 'คืนแล้วยอดจะเกินจำนวนที่เคยรับเข้าล็อตนี้', [
                        'lot' => $cut['lot'],
                    ]);
                }

                $pdo->prepare(
                    'INSERT INTO inventory_logs
                       (product_id, lot_id, action_type, quantity, unit_cost,
                        reference_doc, notes, created_by, created_by_kind, created_at)
                     SELECT product_id, id, \'RETURN\', ?, cost_per_unit, ?, ?, ?, \'user\', NOW()
                     FROM stock_lots WHERE id = ?'
                )->execute([
                    $cut['quantity'],
                    (string) $original['idem_key'],
                    $note,
                    $actor,
                    $cut['lot_id'],
                ]);

                LowStock::watchLot((int) $cut['lot_id']);

                $back[] = ['lot' => $cut['lot'], 'lot_id' => $cut['lot_id'], 'quantity' => $cut['quantity']];
            }

            $response = [
                'replayed'     => false,
                'action'       => 'RETURN',
                'sku'          => $original['sku'],
                'reverses_key' => $original['idem_key'],
                'returned'     => $back,
            ];

            self::record($pdo, $requestId, $response);
            return $response;
        });
    }

    /* -------------------------------------------------------------- internals */

    /** @return array<string,mixed> */
    private static function product(string $sku): array
    {
        $p = Db::one(
            'SELECT id, sku, name, is_custom_made FROM products WHERE sku = ?',
            [$sku],
        );
        if ($p === null) {
            throw ApiError::unknownSku($sku);
        }
        return $p;
    }

    /**
     * Returns the stored answer when this key has already been honoured, or null
     * when it is new. Only successful requests occupy a key: a refusal must stay
     * retryable, because "out of stock" stops being true the moment a delivery
     * arrives.
     *
     * @return array<string,mixed>|null
     */
    private static function replayOf(string $source, string $key): ?array
    {
        $row = Db::one(
            'SELECT response FROM stock_requests WHERE source = ? AND idem_key = ? AND status = \'done\'',
            [$source, $key],
        );
        if ($row === null || $row['response'] === null) {
            return null;
        }

        $prev = json_decode((string) $row['response'], true);
        if (!is_array($prev)) {
            return null;
        }

        $prev['replayed'] = true;
        return $prev;
    }

    /**
     * Inserts the claim. Returns the new row id, or null when the key was taken
     * while we waited — the caller then replays.
     */
    private static function claim(
        PDO $pdo,
        string $source,
        string $key,
        string $action,
        ?string $sku,
        int $qty,
        ?int $actor,
    ): ?int {
        try {
            // 'pending' is the truth at this point: the key is reserved, the work
            // has not happened. It becomes 'done' only once a response exists.
            $pdo->prepare(
                'INSERT INTO stock_requests
                   (source, idem_key, action, sku, quantity, actor_id, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, \'pending\', NOW())'
            )->execute([$source, $key, $action, $sku, $qty, $actor]);

            return (int) $pdo->lastInsertId();
        } catch (\PDOException $e) {
            // 23000 is the integrity-constraint class; here it can only be the
            // unique key. A concurrent duplicate would have blocked on that index
            // until the other transaction finished, so by now the row is settled.
            if (($e->errorInfo[0] ?? '') !== '23000') {
                throw $e;
            }

            $st = $pdo->prepare(
                'SELECT id, status FROM stock_requests WHERE source = ? AND idem_key = ? FOR UPDATE'
            );
            $st->execute([$source, $key]);
            $existing = $st->fetch();

            if ($existing === false) {
                // The other transaction rolled back after we collided. The key is
                // free again, so start over rather than guessing.
                throw new ReplayNeeded();
            }

            if ($existing['status'] === 'done') {
                return null;
            }

            // A claim whose work never finished. Nothing was committed alongside
            // it, so taking it over is safe and keeps the key usable.
            $pdo->prepare(
                'UPDATE stock_requests
                 SET action = ?, sku = ?, quantity = ?, actor_id = ?, status = \'pending\',
                     response = NULL, created_at = NOW()
                 WHERE id = ?'
            )->execute([$action, $sku, $qty, $actor, $existing['id']]);

            return (int) $existing['id'];
        }
    }

    /** @param array<string,mixed> $response */
    private static function record(PDO $pdo, int $requestId, array $response): void
    {
        $pdo->prepare('UPDATE stock_requests SET status = \'done\', response = ? WHERE id = ?')
            ->execute([json_encode($response, JSON_UNESCAPED_UNICODE), $requestId]);
    }

    /** @param list<array<string,mixed>> $cuts */
    private static function totalCost(array $cuts): ?string
    {
        $total = '0';
        $known = false;

        foreach ($cuts as $c) {
            if ($c['unit_cost'] === null) {
                // One lot without a supplier invoice makes the whole total a
                // guess. Say so with null instead of quietly counting it as zero.
                return null;
            }
            $known = true;
            $total = bcadd($total, bcmul((string) $c['unit_cost'], (string) $c['quantity'], 2), 2);
        }

        return $known ? $total : null;
    }

    /* -------------------------------------------------------------- validation */

    /** @param array<string,mixed> $req */
    private static function str(array $req, string $field, int $max): string
    {
        $v = $req[$field] ?? null;
        if (!is_string($v) || trim($v) === '') {
            throw ApiError::badRequest("ต้องระบุ {$field}", 'missing_field');
        }
        $v = trim($v);
        if (mb_strlen($v) > $max) {
            throw ApiError::badRequest("{$field} ยาวเกิน {$max} ตัวอักษร", 'field_too_long');
        }
        return $v;
    }

    /** @param array<string,mixed> $req */
    private static function optional(array $req, string $field, int $max): ?string
    {
        $v = $req[$field] ?? null;
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_string($v)) {
            throw ApiError::badRequest("{$field} ต้องเป็นข้อความ", 'bad_field');
        }
        $v = trim($v);
        return $v === '' ? null : mb_substr($v, 0, $max);
    }

    /** @param array<string,mixed> $req */
    private static function qty(array $req): int
    {
        $v = $req['quantity'] ?? null;
        if (!is_int($v) && !(is_string($v) && ctype_digit($v))) {
            throw ApiError::badRequest('quantity ต้องเป็นจำนวนเต็ม', 'bad_quantity');
        }
        $n = (int) $v;
        if ($n < 1 || $n > 999999) {
            throw ApiError::badRequest('quantity ต้องอยู่ระหว่าง 1 ถึง 999999', 'bad_quantity');
        }
        return $n;
    }

    /**
     * Who the stock went to — a different question from who keyed it in, which
     * is what `actor_id` answers and which the caller never gets to choose.
     *
     * Exactly one answer is allowed. Someone on staff took it, or a branch did;
     * both at once would leave the ledger unable to say whose it was.
     *
     * ของเสียมีคำตอบของตัวเองอีกช่อง — `scrap_by` ชื่อคนที่ทำเสีย พิมพ์เอง บังคับกรอก
     * (ร้านขอไว้ 12 ก.ย. 2026) · คนทำเสียมักเป็นเด็กฝึกงานที่ไม่มีบัญชี และไม่ควรต้องมี
     * การเดาเป็นคนที่คีย์อยู่คือการกล่าวหาคนผิด จึงไม่มีค่าตั้งต้นให้
     *
     * @param array<string,mixed> $req
     * @return array{admin_id:?int,branch_id:?int,taken_by:?string,scrap_by:?string}
     */
    private static function recipient(string $action, array $req): array
    {
        $scrapBy = null;
        if ($action === 'SCRAP') {
            $raw = $req['scrap_by'] ?? null;
            $scrapBy = is_string($raw) ? trim($raw) : '';
            if ($scrapBy === '') {
                throw ApiError::badRequest('กรอกชื่อคนที่ทำของเสียก่อน', 'missing_scrap_by');
            }
            if (mb_strlen($scrapBy) > 120) {
                throw ApiError::badRequest('ชื่อคนที่ทำของเสียยาวเกิน 120 ตัวอักษร', 'bad_scrap_by');
            }
        }

        $adminId  = self::optionalId($req, 'issued_to_admin_id');
        $branchId = self::optionalId($req, 'branch_id');
        $takenBy  = self::optional($req, 'taken_by', 120);

        if ($adminId !== null && $branchId !== null) {
            throw ApiError::badRequest(
                'ระบุได้อย่างเดียว — ผู้เบิกที่เป็นพนักงาน หรือสาขาที่มาเบิก',
                'ambiguous_recipient',
            );
        }

        if ($branchId !== null) {
            // Ruined material is not lent to anyone, and stock coming back is
            // already tied to the request it reverses.
            if ($action !== 'ISSUE') {
                throw ApiError::badRequest(
                    'สาขาเบิกได้เฉพาะรายการเบิก/ขาย ไม่ใช่ของเสียหรือการคืน',
                    'branch_not_issuable',
                );
            }
            // The collector's name is welcome but not required. What the
            // receivable is owed by is the branch, and that is `branch_id`.
            // Demanding a name at the counter only ever collected "-" and "พี่",
            // which reads back a month later exactly like a real answer.
        }

        return ['admin_id' => $adminId, 'branch_id' => $branchId, 'taken_by' => $takenBy, 'scrap_by' => $scrapBy];
    }

    /** @param array<string,mixed> $req */
    private static function optionalId(array $req, string $field): ?int
    {
        $v = $req[$field] ?? null;
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_int($v) && !(is_string($v) && ctype_digit($v))) {
            throw ApiError::badRequest("{$field} ต้องเป็นจำนวนเต็ม", 'bad_field');
        }
        $n = (int) $v;
        if ($n < 1) {
            throw ApiError::badRequest("{$field} ต้องมากกว่า 0", 'bad_field');
        }
        return $n;
    }

    /** @param array<string,mixed> $req */
    private static function actor(array $req): ?int
    {
        $v = $req['actor_id'] ?? null;
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_int($v) && !(is_string($v) && ctype_digit($v))) {
            throw ApiError::badRequest('actor_id ต้องเป็นจำนวนเต็ม', 'bad_actor');
        }
        return (int) $v;
    }
}

/** Thrown inside a transaction when the key turned out to be taken. */
final class ReplayNeeded extends \RuntimeException {}
