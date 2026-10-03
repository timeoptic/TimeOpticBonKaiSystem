<?php

declare(strict_types=1);

namespace Optic\Service;

use Optic\ApiError;
use Optic\Db;
use Optic\Roles;

/**
 * The money that comes back after a branch has already taken the goods.
 *
 * A branch withdrawal splits one transaction across two dates, and that split is
 * the whole reason this file exists:
 *
 *   day the goods leave   — the stock is gone and the cost is known. Nothing is
 *                           earned. The withdrawal records no amount at all,
 *                           because what the branch will pay is not decided yet.
 *
 *   day the money arrives — the amount is known, so profit can exist. It is
 *                           recognised on THIS date, not on the withdrawal date,
 *                           which is what keeps a month's books honest when the
 *                           two fall either side of a month end.
 *
 * Writing an estimated price on the withdrawal day and correcting it later would
 * put a number in the ledger that nobody agreed to, so the column simply stays
 * empty until there is a real one.
 */
final class Settlement
{
    public const PER_PAGE = 25;

    /** เพดานของ `all` — ทุกใบในครั้งเดียวสำหรับไฟล์ Excel */
    public const EXPORT_MAX = 10000;

    private const STATUS_LABEL = [
        'pending'     => 'ค้างรับ',
        'settled'     => 'รับเงินแล้ว',
        'written_off' => 'ตัดหนี้สูญ',
        'cancelled'   => 'ยกเลิก (คืนของ)',
    ];

    /**
     * Every row here is an amount of money owed or received, so unlike the stock
     * screens there is nothing left to show once the money is taken out. The
     * whole listing is refused rather than blanked.
     *
     * @param array{status?:?string,branch_id?:?int,q?:?string,page?:mixed} $filter
     * @return array{rows:list<array<string,mixed>>,total:int,page:int,perPage:int}
     */
    /**
     * ตัวกรองที่ตัดขอบเขตของทั้งหน้าจอ — สาขา และคำค้น
     *
     * แยกออกมาเพราะทั้งตารางและตัวเลขสรุปข้างบนต้องมองข้อมูลก้อนเดียวกัน · ก่อน
     * หน้านี้ตัวเลขสรุปนับทุกใบเสมอ กรองสาขาแล้วตารางเหลือสาขาเดียวแต่การ์ดยัง
     * บอกยอดรวมของทุกสาขา ซึ่งอ่านแล้วเข้าใจว่าสาขานั้นเบิกไปเท่านั้นจริง ๆ
     *
     * `status` ไม่อยู่ในนี้ตั้งใจ — ตัวเลขสรุปแบ่งของมันเองด้วยสถานะ (ค้างรับ กับ
     * รับเงินแล้วเดือนนี้) ถ้าเอาสถานะจากตารางมาทับ ครึ่งหลังจะเป็นศูนย์ตลอด
     *
     * @param array{branch_id?:?int,q?:?string} $filter
     * @return array{0:list<string>,1:list<mixed>}
     */
    private static function scope(array $filter): array
    {
        $where = ['1=1'];
        $args = [];

        if (!empty($filter['branch_id'])) {
            $where[] = 'i.branch_id = ?';
            $args[] = (int) $filter['branch_id'];
        }

        if (!empty($filter['q'])) {
            // หมายเหตุตอนเบิก (เลขบิล) กับหมายเหตุตอนรับเงิน — ร้านขอ 3 ต.ค. 2026
            $where[] = '(i.sku LIKE ? OR i.taken_by LIKE ? OR b.name LIKE ? OR p.name LIKE ?
                         OR i.note LIKE ? OR i.settled_note LIKE ?)';
            $like = '%' . $filter['q'] . '%';
            array_push($args, $like, $like, $like, $like, $like, $like);
        }

        // ช่วงวันที่เบิก — `< ถึง + 1 วัน` ไม่ใช่ `<= ถึง 23:59:59` ซึ่งทำใบที่เบิก
        // วินาทีสุดท้ายของวันหล่นหาย · วันที่ผิดรูปแบบไม่ถูกใช้ ดีกว่าตอบ error ให้
        // ลิงก์ที่พิมพ์ผิดแล้วหน้าว่างทั้งหน้า
        if (self::isDay($filter['from'] ?? null)) {
            $where[] = 'i.issued_at >= ?';
            $args[] = $filter['from'];
        }
        if (self::isDay($filter['to'] ?? null)) {
            $where[] = 'i.issued_at < DATE_ADD(?, INTERVAL 1 DAY)';
            $args[] = $filter['to'];
        }

        return [$where, $args];
    }

    /** 'YYYY-MM-DD' ที่เป็นวันที่มีจริง */
    private static function isDay(mixed $v): bool
    {
        return is_string($v)
            && preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m) === 1
            && checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
    }

    public static function list(array $filter, array $roles): array
    {
        Roles::require(Roles::seeBranchMoney($roles), 'ดูรายการค้างรับจากสาขา');

        [$where, $args] = self::scope($filter);

        $status = $filter['status'] ?? null;
        if (is_string($status) && isset(self::STATUS_LABEL[$status])) {
            $where[] = 'i.status = ?';
            $args[] = $status;
        }

        $clause = implode(' AND ', $where);

        $total = (int) Db::value(
            "SELECT COUNT(*) FROM branch_issues i
             JOIN branches b ON b.id = i.branch_id
             LEFT JOIN products p ON p.id = i.product_id
             WHERE {$clause}",
            $args,
        );

        /* `all` = ไฟล์ Excel ขอทุกใบที่ตรงกับตัวกรองในครั้งเดียว — ไฟล์ที่มีแค่ 25 แถว
           ของหน้าที่เปิดอยู่คือไฟล์ที่ขาดโดยไม่มีอะไรบอก · มีเพดานกันคำขอที่ลากทั้ง
           ตารางไม่รู้จบ ซึ่งร้านนี้ยังห่างจากตัวเลขนั้นมาก */
        $all = !empty($filter['all']);
        $per = $all ? max(1, min($total, self::EXPORT_MAX)) : self::PER_PAGE;
        $page = $all ? 1 : self::page($filter['page'] ?? 1, $total);
        $offset = ($page - 1) * $per;

        // Anything still owed sorts to the top: this screen exists to get money
        // collected, and history is only there to check against.
        $rows = Db::all(
            "SELECT i.*, b.name AS branch_name, p.name AS product_name,
                    a.display_name AS issued_by_name, s.display_name AS settled_by_name
             FROM branch_issues i
             JOIN branches b ON b.id = i.branch_id
             LEFT JOIN products p ON p.id = i.product_id
             LEFT JOIN admins a ON a.id = i.issued_by
             LEFT JOIN admins s ON s.id = i.settled_by
             WHERE {$clause}
             ORDER BY " . self::order($filter['sort'] ?? null, $filter['dir'] ?? null) . "
             LIMIT ? OFFSET ?",
            [...$args, $per, $offset],
        );

        return [
            'rows'    => array_map(self::shape(...), $rows),
            'total'   => $total,
            'page'    => $page,
            'perPage' => $per,
        ];
    }

    /**
     * What is owed, and what has actually been earned.
     *
     * `pendingCost` is what the outstanding goods cost us — a floor on the debt,
     * not the debt itself, because the selling side is unknown until payment.
     * `monthProfit` counts settled rows only and dates each by the day its money
     * arrived, the same rule the individual rows follow.
     *
     * รับตัวกรองชุดเดียวกับตารางข้างล่าง (ยกเว้นสถานะ ดู `scope`) เพื่อให้ตัวเลข
     * บนการ์ดพูดถึงของก้อนเดียวกับที่ตาเห็นอยู่ · ไม่ส่งอะไรมา = ทั้งร้าน ซึ่งเป็น
     * พฤติกรรมเดิมและเป็นสิ่งที่ผู้เรียกอื่นต้องการ
     *
     * @param array{branch_id?:?int,q?:?string} $filter
     * @return array<string,mixed>
     */
    public static function summary(array $roles, array $filter = []): array
    {
        Roles::require(Roles::seeBranchMoney($roles), 'ดูยอดค้างรับจากสาขา');

        [$where, $args] = self::scope($filter);
        $clause = implode(' AND ', $where);

        /* join ทั้งสองใบติดมาด้วยเสมอ ไม่ได้ต่อเมื่อมีคำค้น — คำค้นมองชื่อสาขากับ
           ชื่อสินค้า และ SQL ที่ประกอบต่างกันตามว่ามีคำค้นไหม คือ SQL สองชุดที่
           ต้องถูกทั้งคู่ · ต้นทุนของ join ที่ไม่ได้ใช้ตรงนี้คือศูนย์ */
        $from = "FROM branch_issues i
                 JOIN branches b ON b.id = i.branch_id
                 LEFT JOIN products p ON p.id = i.product_id";

        $pending = Db::one(
            "SELECT COUNT(*) AS n, COALESCE(SUM(i.cost_total), 0) AS cost,
                    COALESCE(SUM(i.cost_unknown_qty), 0) AS unknown
             {$from}
             WHERE i.status = 'pending' AND {$clause}",
            $args,
        ) ?? ['n' => 0, 'cost' => 0, 'unknown' => 0];

        $settled = Db::one(
            "SELECT COUNT(*) AS n,
                    COALESCE(SUM(i.settled_amount), 0) AS amount,
                    COALESCE(SUM(i.settled_amount - i.cost_total), 0) AS profit
             {$from}
             WHERE i.status = 'settled'
               AND i.settled_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
               AND {$clause}",
            $args,
        ) ?? ['n' => 0, 'amount' => 0, 'profit' => 0];

        return [
            'pendingCount'   => (int) $pending['n'],
            'pendingCost'    => (float) $pending['cost'],
            'pendingUnknown' => (int) $pending['unknown'],
            'monthCount'     => (int) $settled['n'],
            'monthAmount'    => (float) $settled['amount'],
            'monthProfit'    => (float) $settled['profit'],
        ];
    }

    /**
     * The branch paid. This is the moment the transaction earns anything, and
     * `settled_at` is the date that profit belongs to.
     *
     * @param array<string,mixed> $body
     * @return array<string,mixed>
     */
    public static function settle(int $id, array $body, array $roles, int $actorId): array
    {
        Roles::require(Roles::settleBranch($roles), 'บันทึกรับเงินจากสาขา');

        $amount = self::amount($body);
        $when = self::when($body);
        $note = self::optional($body, 'note', 500);

        $issue = self::byIdRaw($id);
        self::mustBePending($issue);

        if ($when < substr((string) $issue['issued_at'], 0, 10)) {
            throw ApiError::badRequest('วันที่รับเงินต้องไม่มาก่อนวันที่เบิก', 'bad_settled_date');
        }

        // Guarded on status as well as id, so two people pressing the button at
        // the same moment cannot both write an amount.
        $changed = Db::run(
            'UPDATE branch_issues
             SET status = \'settled\', settled_amount = ?, settled_at = ?,
                 settled_by = ?, settled_note = ?
             WHERE id = ? AND status = \'pending\'',
            [$amount, $when . ' ' . date('H:i:s'), $actorId, $note, $id],
        );
        if ($changed !== 1) {
            throw ApiError::conflict('race', 'มีคนบันทึกรายการนี้พร้อมกัน ลองใหม่อีกครั้ง');
        }

        self::logMoney($issue, $amount, $note, $actorId, 'รับเงินค่าของที่สาขาเบิกไป');

        return self::byId($id);
    }

    /**
     * เงินที่เพิ่งกรอก เป็นรายการของวันที่กรอก
     *
     * ของออกไปหาสาขาวันหนึ่ง เงินกลับมาอีกวันหนึ่ง — เดิมมีแค่ตัวเลขในใบเบิกใบ
     * เดิม เงินที่รับวันนี้จึงไม่มีบรรทัดไหนบอกเลยว่าเกิดขึ้นวันนี้ ต้องไปเปิดใบ
     * เบิกของเดือนก่อนถึงจะเห็น และหน้าความเคลื่อนไหวก็เงียบสนิททั้งที่มีเงินเข้า
     *
     * แถวนี้ไม่ใช่การเคลื่อนของ `quantity` จึงเป็นศูนย์ · `unit_cost` เก็บจำนวน
     * เงินที่รับมาทั้งใบ ซึ่งอ่านได้จากบรรทัดในหมายเหตุ และไม่ถูกนับซ้ำที่ไหน
     * เพราะทุกที่คิดมูลค่าเป็น `quantity * unit_cost`
     *
     * ผูก `branch_issue_id` ไว้ ใบเบิกใบไหนได้เงินแล้วจึงตามกลับได้จากสมุด
     *
     * @param array<string,mixed> $issue
     */
    private static function logMoney(array $issue, string $amount, ?string $note, int $actorId, string $what): void
    {
        $productId = (int) ($issue['product_id'] ?? 0);
        if ($productId === 0) {
            return; // ใบเบิกที่สินค้าถูกลบไปแล้ว — สมุดผูกกับสินค้าเสมอ
        }

        /* เลขเอกสารเดียวกับตอนของออกไป — ใบเบิกไม่ได้เก็บเลขไว้เอง มันอยู่บนแถว
           ที่ตัดของออกให้สาขานั้น เงินกับของจะได้อยู่ใต้เลขเดียวกันในสมุด */
        $doc = Db::value(
            'SELECT reference_doc FROM inventory_logs
              WHERE branch_issue_id = ? AND reference_doc IS NOT NULL
              ORDER BY id ASC LIMIT 1',
            [(int) $issue['id']],
        );

        Db::run(
            'INSERT INTO inventory_logs
               (product_id, lot_id, action_type, quantity, unit_cost, reference_doc,
                notes, created_by, created_by_kind, branch_issue_id, created_at)
             VALUES (?, NULL, \'SETTLE\', 0, ?, ?, ?, ?, \'user\', ?, NOW())',
            [
                $productId,
                $amount,
                $doc === null ? null : (string) $doc,
                $what . ' — ' . $amount . ' บาท' . ($note !== null ? " · {$note}" : ''),
                $actorId,
                (int) $issue['id'],
            ],
        );
    }

    /**
     * The branch is not going to pay. Kept apart from 'cancelled', which means
     * the goods came back, so a report can tell a bad debt from a return.
     *
     * @param array<string,mixed> $body
     * @return array<string,mixed>
     */
    public static function writeOff(int $id, array $body, array $roles, int $actorId): array
    {
        Roles::require(Roles::settleBranch($roles), 'ตัดหนี้สูญ');

        $note = self::optional($body, 'note', 500);
        if ($note === null) {
            throw ApiError::badRequest('ตัดหนี้สูญต้องบอกเหตุผลไว้ด้วย', 'missing_field');
        }

        $issue = self::byIdRaw($id);
        self::mustBePending($issue);

        $changed = Db::run(
            'UPDATE branch_issues
             SET status = \'written_off\', settled_amount = 0, settled_at = NOW(),
                 settled_by = ?, settled_note = ?
             WHERE id = ? AND status = \'pending\'',
            [$actorId, $note, $id],
        );
        if ($changed !== 1) {
            throw ApiError::conflict('race', 'มีคนบันทึกรายการนี้พร้อมกัน ลองใหม่อีกครั้ง');
        }

        /* ศูนย์บาทก็ยังเป็นการตัดสินใจเรื่องเงินที่เกิดวันนี้ และเป็นบรรทัดที่คน
           ตรวจย้อนหลังอยากเห็นมากกว่าใบที่จ่ายครบด้วยซ้ำ */
        self::logMoney($issue, '0.00', $note, $actorId, 'ตัดหนี้สูญค่าของที่สาขาเบิกไป');

        return self::byId($id);
    }

    /**
     * แก้ป้ายบนหนี้ก้อนนี้ — ไม่ใช่แก้ของที่ออกไปแล้ว
     *
     * เส้นแบ่งของทั้งฟังก์ชันนี้: อะไรที่แก้แล้วของบนชั้นไม่ขยับ แก้ได้
     *
     *   แก้ได้     สาขา · ผู้รับของ · วันที่เบิก · หมายเหตุ
     *              ทั้งสี่อย่างเป็นคำอธิบายของรายการ คีย์ผิดได้เป็นเรื่องปกติ
     *              (สาขาสองสาขาชื่อคล้ายกัน คนละคนมารับ วันที่ลืมแก้) และแก้แล้ว
     *              ไม่มีชิ้นไหนย้ายที่
     *
     *   แก้ไม่ได้  สินค้า · จำนวน
     *              สองอย่างนี้คือของที่ถูกตัดออกจากล็อตไปแล้วตาม FIFO และ
     *              `cost_total` ถูกแช่แข็งไว้จากล็อตพวกนั้นโดยตั้งใจ (ดู
     *              `Stock::costBranchIssue`) · แก้ตัวเลขเฉย ๆ จะได้ใบที่บอกว่า
     *              เบิกไปห้าชิ้น แต่ในคลังหายไปสอง และต้นทุนเป็นของอีกจำนวนหนึ่ง
     *              คีย์จำนวนผิดต้องยกเลิกแล้วเบิกใหม่ ซึ่งพาของกลับเข้าล็อตถูกใบ
     *
     * เฉพาะใบที่ยังค้างอยู่ · ใบที่รับเงินแล้วเป็นตัวเลขที่เข้ารายงานไปแล้ว
     * เปลี่ยนสาขาทีหลังคือย้ายยอดของเดือนที่ปิดไปแล้วข้ามสาขา
     *
     * @param array<string,mixed> $body
     * @return array<string,mixed>
     */
    public static function edit(int $id, array $body, array $roles, int $actorId): array
    {
        Roles::require(Roles::settleBranch($roles), 'แก้รายการค้างรับจากสาขา');

        $issue = self::byIdRaw($id);
        self::mustBePending($issue);

        $branchId = self::branch($body, (int) $issue['branch_id']);
        $takenBy = array_key_exists('taken_by', $body)
            ? self::optional($body, 'taken_by', 120)
            : $issue['taken_by'];
        $note = array_key_exists('note', $body)
            ? self::optional($body, 'note', 500)
            : $issue['note'];

        /* เวลาในวันเดิมถูกเก็บไว้ — ช่องที่คนกรอกมีแค่วันที่ ถ้าเขียนทับเป็น
           เที่ยงคืนทุกครั้งที่กดบันทึก ลำดับของใบที่เบิกวันเดียวกันจะพังไปด้วย */
        $issuedAt = (string) $issue['issued_at'];
        if (array_key_exists('issued_at', $body)) {
            $day = self::day($body, 'issued_at');
            if ($day !== null) {
                $issuedAt = $day . ' ' . substr($issuedAt, 11, 8);
            }
        }

        $changed = Db::run(
            'UPDATE branch_issues
             SET branch_id = ?, taken_by = ?, issued_at = ?, note = ?
             WHERE id = ? AND status = \'pending\'',
            [$branchId, $takenBy, $issuedAt, $note, $id],
        );
        if ($changed !== 1) {
            throw ApiError::conflict('race', 'มีคนแก้รายการนี้พร้อมกัน ลองใหม่อีกครั้ง');
        }

        return self::byId($id);
    }

    /**
     * สาขาเอาของมาคืน หนี้ก้อนนี้จึงไม่มีวันกลายเป็นเงิน
     *
     * ต่างจาก `writeOff()` ตรงที่ไม่มีใครเบี้ยว — ของกลับมาแล้ว รายงานจึงต้อง
     * แยกสองอย่างนี้ออกจากกันได้ ('cancelled' กับ 'written_off')
     *
     * **ของต้องกลับเข้าคลังจริง ๆ ไม่ใช่แค่เปลี่ยนสถานะ** ใบเบิกใบหนึ่งคือครึ่ง
     * หนึ่งของธุรกรรมที่ของออกไปแล้ว การปิดใบโดยไม่คืนของคือการทำให้ของหายจาก
     * คลังโดยไม่มีบรรทัดไหนอธิบาย ซึ่ง `doctor` จะจับได้ในวันรุ่งขึ้นว่ายอดล็อต
     * ไม่ตรงกับสมุด · ทั้งสองอย่างจึงอยู่ในทรานแซกชันเดียวกัน
     *
     * @param array<string,mixed> $body
     * @return array<string,mixed>
     */
    public static function cancel(int $id, array $body, array $roles, int $actorId): array
    {
        Roles::require(Roles::settleBranch($roles), 'ยกเลิกรายการค้างรับจากสาขา');

        $note = self::optional($body, 'note', 500);
        if ($note === null) {
            throw ApiError::badRequest('ยกเลิกรายการเบิกต้องบอกเหตุผลไว้ด้วย', 'missing_field');
        }

        $issue = self::byIdRaw($id);
        if ($issue['status'] === 'settled') {
            throw ApiError::conflict(
                'already_settled',
                'รายการนี้รับเงินจากสาขาไปแล้ว ยกเลิกย้อนหลังไม่ได้ — ให้ฝ่ายบัญชีออกใบลดหนี้แทน',
                ['status' => $issue['status']],
            );
        }
        self::mustBePending($issue);

        $back = Db::tx(static function (\PDO $pdo) use ($id, $note, $actorId): array {
            $changed = $pdo->prepare(
                'UPDATE branch_issues
                 SET status = \'cancelled\', settled_at = NOW(), settled_by = ?, settled_note = ?
                 WHERE id = ? AND status = \'pending\''
            );
            $changed->execute([$actorId, $note, $id]);
            if ($changed->rowCount() !== 1) {
                throw ApiError::conflict('race', 'มีคนบันทึกรายการนี้พร้อมกัน ลองใหม่อีกครั้ง');
            }

            return Stock::undoBranchIssue($pdo, $id, $actorId, 'สาขาคืนของ — ' . $note);
        });

        return self::byId($id) + ['returned' => $back];
    }

    /* -------------------------------------------------------------- helpers */

    /**
     * The ORDER BY for a sortable column.
     *
     * A whitelist, never the caller's string: this is interpolated into the SQL.
     * Whatever is chosen, anything still owed sorts above anything closed —
     * this screen exists to get money collected, and history is only here to
     * check against.
     */
    private static function order(mixed $sort, mixed $dir): string
    {
        $column = match ($sort) {
            'branch'  => 'b.name',
            'product' => 'i.sku',
            'qty'     => 'i.quantity',
            'cost'    => 'i.cost_total',
            'amount'  => 'i.settled_amount',
            'profit'  => 'i.settled_amount - i.cost_total',
            'settled' => 'i.settled_at',
            'taken'   => 'i.taken_by',
            default   => 'i.issued_at',
        };

        $natural = in_array($column, ['b.name', 'i.sku', 'i.taken_by'], true) ? 'ASC' : 'DESC';
        $order = match ($dir) {
            'asc'   => 'ASC',
            'desc'  => 'DESC',
            default => $natural,
        };

        return "(i.status = 'pending') DESC, {$column} {$order}, i.id {$order}";
    }

    /** @param array<string,mixed> $issue */
    private static function mustBePending(array $issue): void
    {
        if ($issue['status'] === 'pending') {
            return;
        }
        throw ApiError::conflict(
            'not_pending',
            'รายการนี้ไม่ได้ค้างอยู่แล้ว — ' . (self::STATUS_LABEL[$issue['status']] ?? $issue['status']),
            ['status' => $issue['status']],
        );
    }

    /** @return array<string,mixed> */
    private static function byIdRaw(int $id): array
    {
        $row = Db::one('SELECT * FROM branch_issues WHERE id = ?', [$id]);
        if ($row === null) {
            throw ApiError::notFound('ไม่พบรายการเบิกของสาขาที่ระบุ');
        }
        return $row;
    }

    /** @return array<string,mixed> */
    private static function byId(int $id): array
    {
        $row = Db::one(
            'SELECT i.*, b.name AS branch_name, p.name AS product_name,
                    a.display_name AS issued_by_name, s.display_name AS settled_by_name
             FROM branch_issues i
             JOIN branches b ON b.id = i.branch_id
             LEFT JOIN products p ON p.id = i.product_id
             LEFT JOIN admins a ON a.id = i.issued_by
             LEFT JOIN admins s ON s.id = i.settled_by
             WHERE i.id = ?',
            [$id],
        );
        if ($row === null) {
            throw ApiError::notFound('ไม่พบรายการเบิกของสาขาที่ระบุ');
        }
        return self::shape($row);
    }

    /** @param array<string,mixed> $r @return array<string,mixed> */
    private static function shape(array $r): array
    {
        $cost = (float) $r['cost_total'];
        $amount = $r['settled_amount'] === null ? null : (float) $r['settled_amount'];

        return [
            'id'             => (int) $r['id'],
            'branchId'       => (int) $r['branch_id'],
            'branchName'     => $r['branch_name'] ?? null,
            'takenBy'        => $r['taken_by'],
            'productId'      => (int) $r['product_id'],
            'sku'            => $r['sku'],
            'productName'    => $r['product_name'] ?? null,
            'quantity'       => (int) $r['quantity'],
            'costTotal'      => $cost,
            'costUnknownQty' => (int) $r['cost_unknown_qty'],
            'issuedAt'       => $r['issued_at'],
            'issuedByName'   => $r['issued_by_name'] ?? null,
            'status'         => $r['status'],
            'statusLabel'    => self::STATUS_LABEL[$r['status']] ?? $r['status'],
            'settledAmount'  => $amount,
            'settledAt'      => $r['settled_at'],
            'settledByName'  => $r['settled_by_name'] ?? null,
            'settledNote'    => $r['settled_note'],
            'note'           => $r['note'],
            // A number only once the money is in. A pending row has no profit,
            // which is the entire reason this table exists.
            'profit'         => $r['status'] === 'settled' && $amount !== null
                ? round($amount - $cost, 2)
                : null,
        ];
    }

    private static function page(mixed $raw, int $total): int
    {
        $page = is_numeric($raw) ? (int) $raw : 1;
        $last = max(1, (int) ceil($total / self::PER_PAGE));
        return max(1, min($page, $last));
    }

    /** @param array<string,mixed> $body */
    private static function amount(array $body): string
    {
        $v = $body['amount'] ?? null;
        if (is_string($v)) {
            $v = trim($v);
        }
        if ($v === null || $v === '' || !is_numeric($v)) {
            throw ApiError::badRequest('ต้องระบุยอดเงินที่ได้รับเป็นตัวเลข', 'bad_amount');
        }
        $n = (float) $v;
        if ($n < 0) {
            throw ApiError::badRequest('ยอดเงินติดลบไม่ได้', 'bad_amount');
        }
        if ($n > 99999999.99) {
            throw ApiError::badRequest('ยอดเงินสูงเกินกว่าที่ระบบเก็บได้', 'bad_amount');
        }
        return number_format($n, 2, '.', '');
    }

    /**
     * The day the money arrived, which is rarely the day someone gets round to
     * keying it in — hence a field rather than NOW().
     *
     * @param array<string,mixed> $body
     */
    private static function when(array $body): string
    {
        $v = $body['received_date'] ?? null;
        if ($v === null || $v === '') {
            return date('Y-m-d');
        }
        if (!is_string($v) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
            throw ApiError::badRequest('วันที่รับเงินต้องอยู่ในรูปแบบ YYYY-MM-DD', 'bad_date');
        }
        [$y, $m, $d] = array_map(intval(...), explode('-', $v));
        if (!checkdate($m, $d, $y)) {
            throw ApiError::badRequest('วันที่รับเงินไม่มีอยู่จริง', 'bad_date');
        }
        if ($v > date('Y-m-d')) {
            throw ApiError::badRequest('วันที่รับเงินเป็นอนาคตไม่ได้', 'bad_date');
        }
        return $v;
    }

    /**
     * สาขาที่ใบนี้จะถูกย้ายไป — หรือสาขาเดิม ถ้าไม่ได้ส่งมา
     *
     * ต้องเปิดใช้งานอยู่ ด้วยเหตุผลเดียวกับตอนเบิก (`Stock::openBranchIssue`):
     * สาขาที่ปิดไปแล้วรับหนี้ก้อนใหม่ไม่ได้ และการย้ายหนี้ไปให้มันคือการเพิ่ม
     * หนี้ก้อนใหม่ในสายตาของหน้าจอที่ตามเก็บเงิน
     *
     * @param array<string,mixed> $body
     */
    private static function branch(array $body, int $current): int
    {
        if (!array_key_exists('branch_id', $body) || $body['branch_id'] === null || $body['branch_id'] === '') {
            return $current;
        }

        $id = (int) $body['branch_id'];
        if ($id === $current) {
            return $current;
        }

        $branch = Db::one('SELECT id, name, is_active FROM branches WHERE id = ?', [$id]);
        if ($branch === null) {
            throw ApiError::notFound('ไม่พบสาขาที่ระบุ');
        }
        if (!(bool) $branch['is_active']) {
            throw ApiError::conflict(
                'branch_inactive',
                "สาขา {$branch['name']} ปิดใช้งานอยู่ ย้ายรายการค้างมาไม่ได้",
                ['branch' => $branch['name']],
            );
        }

        return (int) $branch['id'];
    }

    /**
     * วันที่ล้วน ๆ จากฟอร์ม — null เมื่อช่องถูกส่งมาว่าง
     *
     * ต่างจาก `when()` ตรงที่ไม่มีค่าตั้งต้นเป็นวันนี้ ช่องที่ถูกล้างหมายถึง
     * "ไม่ได้แก้" ไม่ใช่ "ย้ายมาเป็นวันนี้"
     *
     * @param array<string,mixed> $body
     */
    private static function day(array $body, string $field): ?string
    {
        $v = $body[$field] ?? null;
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_string($v) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
            throw ApiError::badRequest('วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD', 'bad_date');
        }
        [$y, $m, $d] = array_map(intval(...), explode('-', $v));
        if (!checkdate($m, $d, $y)) {
            throw ApiError::badRequest('วันที่ไม่มีอยู่จริง', 'bad_date');
        }
        if ($v > date('Y-m-d')) {
            throw ApiError::badRequest('วันที่เบิกเป็นอนาคตไม่ได้', 'bad_date');
        }
        return $v;
    }

    /** @param array<string,mixed> $body */
    private static function optional(array $body, string $field, int $max): ?string
    {
        $v = $body[$field] ?? null;
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_string($v)) {
            throw ApiError::badRequest("{$field} ต้องเป็นข้อความ", 'bad_field');
        }
        $v = trim($v);
        return $v === '' ? null : mb_substr($v, 0, $max);
    }
}
