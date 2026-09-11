<?php
/**
 * สรุปคิวส่งมอบวันละครั้ง (ค่าตั้งต้นหนึ่งทุ่ม) — สองข้อความ
 *
 *   ① คิวส่งมอบพรุ่งนี้ — ไว้เตรียมของก่อนปิดร้าน
 *   ② เลยกำหนดส่งมอบ   — ไว้โทรตาม
 *
 * ทำไมต้องแยกสองข้อความ: ถ้ารวมเป็นก้อนเดียวแล้วเจอลิมิต 4,096 ตัวอักษรของ
 * Telegram คิวพรุ่งนี้ (ของที่ต้องใช้จริงพรุ่งเช้า) จะถูกรายการค้างพันกว่าราย
 * เบียดตกไป แยกก้อนแล้วอีกก้อนพังก็ยังได้ก้อนที่เหลือ และ notification_log
 * แยกแถวให้เห็นว่าเจ๊งตัวไหน
 *
 * เกณฑ์คิวลอกมาจากกระดานส่งมอบ (api/routes/workflow.php: GET /api/delivery)
 * ตัวต่อตัว — เคสยังไม่ปิด + อยู่ขั้น delivery + ยังไม่มี delivered_at
 * ห้ามตั้งนิยามใหม่ที่นี่ ไม่งั้นตัวเลขบนจอกับในกลุ่มไลน์งานจะขัดกันเอง
 *
 * PHP ไม่มีโปรเซสค้างไว้ให้ตั้งเวลา จึงใช้วิธีเดียวกับ Scheduler: รันครั้งเดียว
 * จบทุกครั้งที่ถูกเรียก แล้วให้ isDue() ตัดสินเองว่ารอบนี้ถึงคิวส่งหรือยัง
 */
declare(strict_types=1);

final class DeliveryDigest
{
    public const DEFAULTS = [
        'delivery_digest_enabled'      => '0',
        'delivery_digest_time'         => '19:00',
        'delivery_digest_overdue_days' => '30',
        'delivery_digest_target'       => 'digest',
    ];

    /** วันที่ส่งสรุปไปแล้วล่าสุด — ตัวกันส่งซ้ำ เพราะรอบกวาดรันทุกนาที */
    public const LAST_SENT_KEY = 'delivery_digest_last_date';

    /** กันพิมพ์เลขมั่วในหน้าตั้งค่าแล้วสรุปย้อนไปสิบปี */
    private const MAX_OVERDUE_DAYS = 365;

    /**
     * เกณฑ์ "ยังไม่ได้ส่งมอบ" ชุดเดียวกับกระดานส่งมอบ
     * ใช้กับ FROM ที่ join v_case_board เป็น b และ case_deliveries เป็น d
     */
    private const OPEN_QUEUE = "b.is_terminal = 0
                            AND d.delivered_at IS NULL
                            AND b.stage_group = 'delivery'";

    private const FROM = 'FROM v_case_board b
                          LEFT JOIN case_deliveries d ON d.case_id = b.id';

    private const COLS = 'b.id AS case_id, b.case_code, b.invoice_code, b.is_rush,
                          b.first_name, b.mid_name, b.last_name, b.phone,
                          b.appointment_date, b.appointment_time,
                          b.status, b.status_label_th';

    /* ------------------------------------------------------------------ *
     * คิว
     * ------------------------------------------------------------------ */

    /** เคสที่นัดรับวันนั้นและยังไม่ได้ส่งมอบ — เคสด่วนขึ้นก่อน แล้วเรียงตามเวลานัด */
    public static function queue(string $date): array
    {
        return Db::all(
            'SELECT ' . self::COLS . ', 0 AS days_late
             ' . self::FROM . '
              WHERE ' . self::OPEN_QUEUE . '
                AND b.appointment_date = ?
              ORDER BY b.is_rush DESC,
                       b.appointment_time IS NULL, b.appointment_time,
                       b.case_code',
            $date
        );
    }

    /**
     * เคยนัดไว้ แต่วันนัดผ่านไปแล้วและของยังอยู่ที่ร้าน — เลยนานสุดขึ้นก่อน
     *
     * มีกรอบวันเพราะฐานนี้มีคิวค้างจากข้อมูลนำเข้าเก่ากว่าพันใบย้อนไปถึงปี 2019
     * ถ้าส่งทั้งหมดคือสแปมวันละพันบรรทัดที่ไม่มีใครอ่าน
     */
    public static function overdue(int $days, ?string $today = null): array
    {
        $days  = max(1, min($days, self::MAX_OVERDUE_DAYS));
        $today ??= today();

        return Db::all(
            'SELECT ' . self::COLS . ',
                    DATEDIFF(?, b.appointment_date) AS days_late
             ' . self::FROM . '
              WHERE ' . self::OPEN_QUEUE . '
                AND b.appointment_date < ?
                AND b.appointment_date >= ? - INTERVAL ? DAY
              ORDER BY b.appointment_date, b.case_code',
            $today,
            $today,
            $today,
            $days
        );
    }

    /* ------------------------------------------------------------------ *
     * ตัวกันส่งซ้ำ
     * ------------------------------------------------------------------ */

    /**
     * รอบกวาดนี้ควรส่งสรุปหรือยัง
     *
     * แยกออกมาเป็นฟังก์ชันล้วน ๆ (รับเวลาเข้ามา ไม่ไปอ่านนาฬิกาเอง) เพราะเป็น
     * ตรรกะที่พังแล้วเจ็บที่สุด — พังทางหนึ่งคือกลุ่มโดนสรุปเดิมซ้ำทุกนาที
     * พังอีกทางคือเงียบไปทั้งวันโดยไม่มีใครรู้ ทดสอบตรง ๆ ได้ทั้งสองทาง
     *
     * เปิดเครื่องช้าถึงสามทุ่มยังได้รับ (ยังเป็นวันเดียวกัน) แต่ถ้าปิดข้ามคืน
     * เช้ามาจะไม่มีสรุปของเมื่อวานเด้งย้อนหลัง เพราะเวลายังไม่ถึงรอบของวันใหม่
     */
    public static function isDue(string $now, string $sendAt, ?string $lastSent, string $today): bool
    {
        if ($lastSent === $today) {
            return false;
        }
        return self::hhmm($now) >= self::hhmm($sendAt);
    }

    /**
     * "9:00" → "09:00"
     *
     * เทียบเวลาด้วยการเทียบสตริง ซึ่งถูกต้องเฉพาะตอนที่ทั้งคู่มีศูนย์นำหน้า —
     * "9:00" เทียบแล้วมากกว่า "19:00" เสมอ ค่าที่ตั้งพลาดตัวเดียวจึงแปลว่า
     * สรุปเงียบไปตลอดกาลโดยไม่มีอะไรฟ้อง ช่องในหน้าตั้งค่าเป็น input type=time
     * ที่เติมศูนย์ให้อยู่แล้ว แต่ค่านี้ยิงผ่าน API ตรง ๆ ก็ได้
     */
    private static function hhmm(string $v): string
    {
        [$h, $m] = array_pad(explode(':', trim($v), 2), 2, '0');
        return sprintf('%02d:%02d', (int) $h, (int) $m);
    }

    /* ------------------------------------------------------------------ *
     * รอบส่ง
     * ------------------------------------------------------------------ */

    private static function setting(array $s, string $key): string
    {
        $v = trim((string) ($s[$key] ?? ''));
        return $v !== '' ? $v : self::DEFAULTS[$key];
    }

    /**
     * กลุ่มที่สรุปนี้จะไปโผล่ — ค่าเริ่มต้นคือกลุ่มรายงานการส่งมอบของมันเอง
     *
     * ชื่อที่ระบบไม่รู้จักถือว่าไม่ได้ตั้ง แล้วกลับไปใช้ค่าเริ่มต้น (Telegram::target()
     * จะตกไป main ซึ่งไม่ใช่สิ่งที่ตั้งใจ) — ค่าที่พิมพ์ผิดไม่ควรทำให้สรุปเปลี่ยนกลุ่มเงียบ ๆ
     */
    public static function target(): string
    {
        $v = self::setting(Telegram::settings(), 'delivery_digest_target');
        return isset(Telegram::TARGETS[$v]) ? $v : self::DEFAULTS['delivery_digest_target'];
    }

    /**
     * @param array{force?: bool} $opt  force = ปุ่ม "ส่งทดสอบ" — ข้ามทั้งสวิตช์
     *        และนาฬิกา และไม่กินโควตาของวันนั้น (ไม่เขียน LAST_SENT_KEY)
     */
    public static function runOnce(array $opt = []): array
    {
        $force = (bool) ($opt['force'] ?? false);
        $s     = Telegram::settings(true);

        if (!$force) {
            if (self::setting($s, 'delivery_digest_enabled') !== '1') {
                return ['sent' => 0, 'skipped' => 'สรุปคิวส่งมอบปิดอยู่'];
            }
            if (!Telegram::isEnabled()) {
                return ['sent' => 0, 'skipped' => 'telegram ปิดอยู่หรือยังไม่ได้ตั้งค่า'];
            }
            $due = self::isDue(
                date('H:i'),
                self::setting($s, 'delivery_digest_time'),
                nul($s[self::LAST_SENT_KEY] ?? null),
                today()
            );
            if (!$due) {
                return ['sent' => 0, 'skipped' => 'ยังไม่ถึงรอบส่งของวันนี้'];
            }
        }

        $tomorrow = date('Y-m-d', strtotime(today() . ' +1 day'));
        $days     = (int) self::setting($s, 'delivery_digest_overdue_days');

        $queue   = self::queue($tomorrow);
        $overdue = self::overdue($days);

        $to = self::target();
        $a  = self::sendAll(Telegram::deliveryQueueMessages($queue, $tomorrow), 'delivery_digest', $force, $to);

        /* ไม่มีของค้าง = ไม่ต้องรบกวนกลุ่ม ต่างจากคิวพรุ่งนี้ที่ส่งทุกวันแม้ว่าง
           เพราะข้อความที่มาตรงเวลาคือหลักฐานว่าตัวแจ้งเตือนยังไม่ตาย */
        $b = self::sendAll(Telegram::deliveryOverdueMessages($overdue, $days), 'delivery_overdue', $force, $to);

        /* ปักวันไว้เฉพาะตอนคิวพรุ่งนี้ออกไปครบทุกก้อน — ส่งพลาดเพราะเน็ตหลุด
           รอบกวาดนาทีถัดไปจะลองใหม่เอง */
        if (!$force && $a['ok']) {
            Telegram::saveSettings([self::LAST_SENT_KEY => today()]);
        }

        return [
            'sent'    => $a['sent'] + $b['sent'],
            'date'    => $tomorrow,
            'queue'   => count($queue),
            'overdue' => count($overdue),
            'parts'   => ['queue' => count($a['msgs']), 'overdue' => count($b['msgs'])],
            'error'   => $a['error'] ?? $b['error'],
        ];
    }

    /**
     * ยิงทุกก้อนของสรุปหนึ่งชุด
     *
     * เว้นจังหวะเมื่อมีเกินสามก้อน — Telegram จำกัดราวยี่สิบข้อความต่อนาทีต่อกลุ่ม
     * ยิงรวดเดียวสามสิบใบจะโดน 429 แล้วก้อนท้าย ๆ หายทั้งชุด · ทางแก้คือส่งช้าลง
     * ไม่ใช่ตัดรายชื่อคนที่ของค้างออก · กรอบ 30 วันปกติได้สามก้อน จึงไม่หน่วงเลย
     *
     * @param  list<string> $msgs
     * @return array{sent:int, ok:bool, error:?string, msgs:list<string>}
     */
    private static function sendAll(array $msgs, string $kind, bool $force, string $to): array
    {
        $sent  = 0;
        $error = null;

        foreach ($msgs as $i => $msg) {
            if ($i > 0 && count($msgs) > 3) {
                sleep(3);
            }
            $r = Telegram::send($msg, ['kind' => $kind, 'force' => $force, 'target' => $to]);
            if ($r['ok']) {
                $sent++;
            } else {
                $error ??= $r['error'];
            }
        }
        return ['sent' => $sent, 'ok' => $msgs !== [] && $sent === count($msgs), 'error' => $error, 'msgs' => $msgs];
    }
}
