<?php
/**
 * บันทึกการใช้งานของทั้งระบบหน้าร้าน — "ใครทำอะไร เมื่อไหร่"
 *
 * ── ทำไมอยู่ที่นี่ที่เดียว ────────────────────────────────────────────────
 * ทางที่ตรงไปตรงมากว่าคือไปเติมบรรทัด `log(...)` ในทุก handler ที่เขียนข้อมูล
 * ซึ่งตอนนี้มี 62 เส้นใน 20 ไฟล์ · เส้นที่ 63 ที่ใครเขียนเพิ่มวันหน้าจะลืม แล้ว
 * ล็อกที่มีรูโดยไม่มีใครรู้ว่ามีรู แย่กว่าไม่มีล็อกเลย เพราะคนอ่านจะเชื่อมัน
 *
 * ที่นี่จึงใช้หลักเดียวกับด่านตรวจสิทธิ์ใน `index.php`: ดักที่ประตูเดียว ทุกคำขอ
 * เดินผ่านอยู่แล้ว เส้นใหม่จึงถูกบันทึกเองโดยไม่ต้องมีใครจำได้
 *
 * ── หนึ่งคำขอ = หนึ่งแถว ────────────────────────────────────────────────
 * ล็อกทั้งสี่ชนิดอยู่ตารางเดียวกัน และหนึ่งคำขอเขียนได้แถวเดียวเสมอ ชนิดของแถว
 * ตัดสินจากผลจริงที่เกิดขึ้น ไม่ใช่จากที่มาของโค้ด:
 *
 *   auth     เข้า/ออกระบบ (ทั้งผ่านและไม่ผ่าน)      เก็บ 3 ปี
 *   error    ตอบ 4xx/5xx                            เก็บ 1 ปี
 *   audit    คำขอที่เขียนข้อมูลและสำเร็จ            เก็บ 3 ปี
 *   request  ที่เหลือ — การอ่านข้อมูลเฉย ๆ          เก็บ 30 วัน
 *
 * การแก้ราคาหนึ่งครั้งจึงอ่านได้ว่าเกิดเรื่องเดียว ไม่ใช่สองแถว (request + audit)
 * ที่คนอ่านต้องมาไล่จับคู่กันเอง — และพื้นที่หายไปครึ่งหนึ่งฟรี ๆ
 *
 * ── "ค่าก่อน → หลัง" มาจากไหน ───────────────────────────────────────────
 * ประตูรู้แค่ path ไม่รู้ว่าเส้นนี้ไปแก้แถวไหน · `ENTITIES` คือแผนที่จาก
 * คำนำหน้าเส้นทางไปเป็นชื่อตาราง ซึ่งพอที่จะ SELECT แถวนั้นเก็บไว้ก่อนเรียก
 * handler แล้ว SELECT ซ้ำหลังจบ แล้วเทียบกันเองได้ · ที่เหลือของ path กลายเป็น
 * ชื่อ action มาฟรี ๆ (`POST /api/orders/5/close` → close)
 *
 * ข้อจำกัดที่ยอมรับ: เห็นเฉพาะแถวหลักของเส้นทางนั้น ถ้า handler ไปแก้ตารางอื่น
 * พ่วงด้วย จะเห็นแค่ว่ามีคนเรียกเส้นนี้ ไม่เห็น diff ของแถวพ่วง · วันที่ต้องการ
 * ครบจริง ๆ ค่อยเติม trigger ในฐานเขียนลงตารางเดียวกันนี้ได้โดยไม่ต้องรื้อ
 *
 * ── กติกาที่ห้ามผิด ─────────────────────────────────────────────────────
 * ล็อกพัง = ไม่มีอะไรเกิดขึ้น · ทุกอย่างในไฟล์นี้อยู่ใน try/catch ที่กลืนทุก
 * ข้อผิดพลาด เพราะตารางล็อกเต็มต้องไม่ทำให้ร้านขายของไม่ได้
 */
declare(strict_types=1);

final class ActivityLog
{
    /* ── ที่ไม่บันทึก ─────────────────────────────────────────────────────
       auth/me: หน้าเว็บถามทุกครั้งที่เปลี่ยนหน้า — บันทึกแล้วได้แถวที่ไม่บอกอะไร
       วันละพัน · /api/logs: การเปิดดูล็อกจะกลายเป็นล็อกที่ท่วมล็อก */
    private const SKIP        = ['/api/auth/me', '/stock-api/auth/me'];
    private const SKIP_PREFIX = ['/api/logs'];

    /** POST ที่เป็นการ "ถาม" ไม่ใช่การ "เขียน" — ไม่มีอะไรเปลี่ยนให้บันทึก */
    private const READ_ONLY_POSTS = ['/api/customers/duplicates'];

    /** อายุของแต่ละชนิด (วัน) — ดูเหตุผลของตัวเลขในหัวไฟล์ */
    private const KEEP_DAYS = [
        'request' => 30,
        'error'   => 365,
        'audit'   => 1095,
        'auth'    => 1095,
    ];

    /**
     * คำนำหน้าเส้นทาง → ตารางที่มันแก้ · เทียบแบบยาวสุดชนะ
     * ('/api/pos/sales' ต้องชนะ '/api/pos' ถ้าวันหนึ่งมีตัวหลัง)
     */
    private const ENTITIES = [
        '/api/customers'     => 'customers',
        '/api/orders'        => 'custom_orders',
        '/api/cases'         => 'cases',
        '/api/payments'      => 'payments',
        '/api/pos/sales'     => 'pos_sales',
        '/api/prescriptions' => 'prescriptions',
        '/api/bookings'      => 'bookings',
        '/api/employees'     => 'employees',
        '/api/suppliers'     => 'suppliers',
        '/api/income'        => 'incomes',
        '/api/expense'       => 'expenses',
        '/api/locations'     => 'product_locations',
        '/api/sales'         => 'sales',
        '/api/rx'            => 'rx_orders',
        '/api/stock'         => 'stock_lots',
        '/api/uploads'       => 'case_photos',
        '/api/settings'      => 'app_settings',
        /* บัญชีผู้ใช้อยู่ในตาราง `admins` ซึ่งเป็นของ API ฝั่งคลัง แต่หน้าจอที่ใช้
           เปิดมันคือ /users ของหน้าร้าน · การเพิ่ม-ลบสิทธิ์คือสิ่งที่ล็อกต้องเห็น
           ที่สุดอย่างหนึ่ง จึงตามข้ามไปอีกฝั่ง ทำได้เพราะสองฝั่งใช้ PDO ตัวเดียวกัน */
        '/stock-api/users'   => 'admins',
    ];

    /** ชื่อไทยของตาราง — ใช้ประกอบข้อความในคอลัมน์ summary */
    private const ENTITY_LABEL = [
        'customers'         => 'ลูกค้า',
        'custom_orders'     => 'ออเดอร์ตัดแว่น',
        'cases'             => 'เคส',
        'payments'          => 'การรับเงิน',
        'pos_sales'         => 'บิลขายหน้าร้าน',
        'prescriptions'     => 'ใบวัดสายตา',
        'bookings'          => 'คิวจอง',
        'employees'         => 'พนักงาน',
        'suppliers'         => 'ซัพพลายเออร์',
        'incomes'           => 'รายรับ',
        'expenses'          => 'รายจ่าย',
        'product_locations' => 'ตำแหน่งสินค้า',
        'sales'             => 'รายการขาย',
        'rx_orders'         => 'ใบสั่งเลนส์',
        'stock_lots'        => 'สินค้าในคลัง',
        'case_photos'       => 'รูปในเคส',
        'app_settings'      => 'การตั้งค่าระบบ',
        'admins'            => 'บัญชีผู้ใช้',
    ];

    /** ชื่อไทยของ action — ที่ไม่มีในนี้ใช้ชื่อดิบจาก path ไปเลย */
    private const ACTION_LABEL = [
        'view'         => 'เปิดดู',
        'create'       => 'เพิ่ม',
        'update'       => 'แก้ไข',
        'delete'       => 'ลบ',
        'login'        => 'เข้าสู่ระบบ',
        'logout'       => 'ออกจากระบบ',
        'login_failed' => 'เข้าสู่ระบบไม่สำเร็จ',
        'close'        => 'ปิดงาน',
        'reopen'       => 'เปิดใหม่',
        'void'         => 'ยกเลิกบิล',
        'fill'         => 'เติมสินค้าเข้าออเดอร์',
        'status'       => 'เปลี่ยนสถานะ',
        'note'         => 'บันทึกโน้ต',
        'notes'        => 'บันทึกโน้ต',
        'notify'       => 'ส่งแจ้งเตือน',
        'confirm'      => 'ยืนยัน',
        'deliver'      => 'ส่งมอบ',
        'payments'     => 'รับชำระเงิน',
        'appointment'  => 'นัดหมาย',
        'open-case'    => 'เปิดเคสจากคิว',
        'remind'       => 'ส่งเตือนคิว',
        'start'        => 'เริ่มขั้นตอน',
        'complete'     => 'จบขั้นตอน',
        'state'        => 'แก้สถานะขั้นตอน',
        'run'          => 'สั่งให้ทำงาน',
        'test'         => 'ทดสอบ',
        'duplicates'   => 'ตรวจรายชื่อซ้ำ',
        'receipts'     => 'ออกใบเสร็จ',
        'centerings'   => 'บันทึกวัด Center',
        'frame-fittings'  => 'บันทึกวัดกรอบ',
        'case-deliveries' => 'บันทึกการส่งมอบ',
        'case-keywords'   => 'แก้คำค้นของเคส',
        /* เส้นอ่านข้อมูลที่ไม่มีตารางของตัวเอง — ไม่ใส่ก็ได้ แต่แถวจะขึ้นเป็นคำ
           อังกฤษดิบจาก path ซึ่งอ่านไม่ออกสำหรับคนที่มาเปิดล็อก */
        'meta'          => 'โหลดข้อมูลตั้งต้น',
        'overview'      => 'เปิดดูภาพรวมรายงาน',
        'policy'        => 'เปิดดูตารางสิทธิ์',
        'notifications' => 'เปิดดูประวัติแจ้งเตือน',
        'dashboard'     => 'เปิดดูหน้าหลัก',
    ];

    /** ช่องที่ต้องปิดก่อนเก็บเสมอ — เทียบแบบ "ชื่อช่องมีคำนี้อยู่" */
    private const SECRET_HINTS = ['password', 'passwd', 'secret', 'token', 'hash'];

    /** ช่องที่เปลี่ยนทุกครั้งอยู่แล้ว — ขึ้นใน diff ก็เป็นเสียงรบกวนล้วน */
    private const NOISE_COLUMNS = ['updated_at', 'created_at'];

    private static bool $armed = false;
    private static bool $done  = false;

    private static float $t0        = 0.0;
    private static string $method   = 'GET';
    private static string $path     = '/';
    private static string $fullPath = '/';
    private static ?array $actor    = null;

    private static ?string $table  = null;
    private static ?int $entityId  = null;
    private static ?string $action = null;
    private static ?array $before  = null;

    /**
     * เริ่มจับคำขอนี้ · เรียกครั้งเดียวใน `index.php` ก่อนด่านตรวจสิทธิ์
     *
     * ต้องมาก่อนด่าน เพราะคำขอที่ถูกปฏิเสธ (401/403) คือสิ่งที่คนดูล็อกอยากเห็น
     * ที่สุดอย่างหนึ่ง — "พนักงานขายพยายามเปิดหน้ารายงานตอนตีสอง"
     */
    public static function start(string $method, string $path): void
    {
        try {
            if (self::$armed || self::skipped($path)) {
                return;
            }
            self::$armed  = true;
            self::$t0     = microtime(true);
            self::$method = $method;
            self::$path   = $path;

            $query = (string) ($_SERVER['QUERY_STRING'] ?? '');
            self::$fullPath = $query === '' ? $path : ($path . '?' . $query);

            self::$actor = StockModule::actor();
            self::resolveEntity();

            /* แถว "ก่อน" ต้องอ่านก่อน handler ทำงาน — หลังจากนั้นไม่มีทางย้อนไปดูได้อีก */
            if (self::$table !== null && $method !== 'GET') {
                self::$before = self::snapshot();
            }

            /* กันคำขอที่จบด้วย exit() กลางทาง (ฝั่งคลัง /stock-api, ด่านตรวจสิทธิ์)
               และ fatal error — สองอย่างนี้ไม่มีทางกลับมาที่ index.php ให้ปิดงานเอง */
            register_shutdown_function([self::class, 'shutdown']);
        } catch (Throwable) {
            self::$armed = false;
        }
    }

    /**
     * ปิดงานและเขียนหนึ่งแถว · เรียกได้ครั้งเดียว เรียกซ้ำไม่มีผล
     *
     * @param mixed $result ค่าที่ handler คืน — ใช้หา id ของแถวที่เพิ่งสร้าง
     */
    public static function finish(int $status, array $body = [], mixed $result = null, ?string $error = null): void
    {
        if (!self::$armed || self::$done) {
            return;
        }
        self::$done = true;

        try {
            /* ล็อกอินสำเร็จ = เพิ่งมีตัวตนตอนนี้ ตอน start() ยังไม่มี */
            if (self::$actor === null) {
                self::$actor = StockModule::actor();
            }

            $ok      = $status < 400;
            $isWrite = self::$method !== 'GET' && !in_array(self::$path, self::READ_ONLY_POSTS, true);

            /* id ของแถวที่เพิ่งสร้าง มากับคำตอบ ไม่ได้อยู่ใน path */
            if (self::$entityId === null && $ok && $isWrite && is_array($result)) {
                self::$entityId = int_or($result['id'] ?? $result['insertId'] ?? null);
            }

            /* ไม่มีแถว "ก่อน" ก็ไม่มีอะไรให้เทียบ — การสร้างของใหม่บันทึกด้วย body
               ที่ส่งมา ไม่ใช่ diff กับความว่างเปล่า จึงไม่ต้องเสียคิวรีอ่านซ้ำ */
            $after   = ($ok && $isWrite && self::$before !== null) ? self::snapshot() : null;
            $changes = self::diff(self::$before, $after);

            $kind = self::classify($status, $isWrite);
            if ($kind === 'auth') {
                self::$action = self::$path === '/api/auth/logout'
                    ? 'logout'
                    : ($ok ? 'login' : 'login_failed');
            }

            /* ลบแล้วไม่มีแถว "หลัง" ให้เทียบ — เก็บแถวที่หายไปทั้งใบแทน
               ไม่งั้นล็อกจะบอกได้แค่ว่ามีคนลบอะไรสักอย่างที่ id เท่านี้ */
            $payload = null;
            if ($kind === 'error') {
                /* คำขอที่ตายที่ด่านตรวจสิทธิ์ไม่มีทั้งข้อความและ body — เก็บกล่องเปล่า
                   ไว้เท่ากับทำให้ทุกแถวมีปุ่ม "ดูเพิ่ม" ที่กดแล้วไม่มีอะไร */
                $payload = array_filter([
                    'error' => $error,
                    'body'  => self::redact($body) ?: null,
                ], static fn($v) => $v !== null && $v !== '') ?: null;
            } elseif (self::$action === 'delete' && self::$before !== null) {
                $payload = ['deleted' => self::redact(self::$before)];
            } elseif ($isWrite && $changes === null) {
                $payload = self::redact($body) ?: null;
            }

            self::write($kind, $status, $changes, $payload);
        } catch (Throwable) {
            /* ล็อกพัง = ไม่มีอะไรเกิดขึ้น · คำตอบของคำขอนี้ส่งไปแล้วด้วยซ้ำ */
        }
    }

    /** ทางออกสุดท้าย — คำขอที่จบด้วย exit() หรือ fatal error ก็ยังทิ้งร่องรอยไว้ */
    public static function shutdown(): void
    {
        if (self::$done) {
            return;
        }
        $status = http_response_code();
        self::finish(is_int($status) ? $status : 500);
    }

    /* ────────────────────────────────────────────────────────────────── */

    private static function skipped(string $path): bool
    {
        if (in_array($path, self::SKIP, true)) {
            return true;
        }
        foreach (self::SKIP_PREFIX as $p) {
            if ($path === $p || str_starts_with($path, $p . '/')) {
                return true;
            }
        }
        return false;
    }

    /**
     * แยก path เป็น ตาราง + id + ชื่อ action
     *
     * `/api/orders/5/close` → custom_orders · 5 · close
     * `/api/orders/5`       → custom_orders · 5 · update|delete (ตามวิธี)
     * `/api/orders`         → custom_orders · null · create
     */
    private static function resolveEntity(): void
    {
        $best = '';
        foreach (array_keys(self::ENTITIES) as $prefix) {
            if ((self::$path === $prefix || str_starts_with(self::$path, $prefix . '/'))
                && strlen($prefix) > strlen($best)
            ) {
                $best = $prefix;
            }
        }
        /* เส้นที่ไม่อยู่ในแผนที่ก็ยังต้องมีชื่อการกระทำที่อ่านออก — แยกแบบเดียวกัน
           จาก path ทั้งเส้น ได้อย่างน้อย "สั่งให้ทำงาน" แทน "POST /api/reminders/run" */
        self::$table = $best === '' ? null : self::ENTITIES[$best];
        $rest = array_values(array_filter(explode(
            '/',
            $best === '' ? self::$path : substr(self::$path, strlen($best))
        )));

        /* ตัวเลขตัวแรกคือแถวที่เส้นนี้พูดถึง (`/bookings/5/notes/9` = คิว 5 ไม่ใช่โน้ต 9)
           ส่วนคำท้ายสุดที่ไม่ใช่ตัวเลขคือสิ่งที่ทำกับมัน (close, void, payments) */
        $verb = null;
        foreach ($rest as $seg) {
            $n = int_or($seg);
            if ($n !== null) {
                self::$entityId ??= $n;
            } else {
                $verb = $seg;
            }
        }
        self::$action = $verb ?? match (self::$method) {
            'POST'   => self::$entityId === null ? 'create' : 'update',
            'PUT'    => 'update',
            'PATCH'  => 'update',
            'DELETE' => 'delete',
            default  => 'view',
        };
    }

    /**
     * แถวที่เส้นทางนี้ชี้ถึง ณ ตอนนี้
     *
     * `app_settings` เป็นตาราง key/value ทั้งใบคือ "การตั้งค่า" หนึ่งชุด ไม่ใช่
     * แถวละเรื่อง — จึงอ่านทั้งตารางแล้วยุบเป็น map เพื่อให้ diff อ่านได้ว่า
     * "shop_open_time: 10:00 → 09:00" ไม่ใช่ "แถวที่ 4 เปลี่ยน"
     */
    private static function snapshot(): ?array
    {
        $table = self::$table;
        if ($table === null || !isset(self::ENTITY_LABEL[$table])) {
            return null;
        }
        if ($table === 'app_settings') {
            $out = [];
            foreach (Db::all('SELECT `key`, `value` FROM app_settings') as $r) {
                $out[(string) $r['key']] = $r['value'];
            }
            return $out;
        }
        if (self::$entityId === null) {
            return null;
        }
        /* ชื่อตารางมาจาก ENTITIES ซึ่งเป็นค่าคงที่ในไฟล์นี้ ไม่ใช่ค่าจากผู้ใช้ */
        $row = Db::get("SELECT * FROM `$table` WHERE id = ?", self::$entityId);

        /* บทบาทของบัญชีอยู่คนละตาราง (`admin_roles`) — diff ที่อ่านแต่แถวหลักจึงมอง
           การเปลี่ยนสิทธิ์ไม่เห็นเลย ทั้งที่มันคือสิ่งที่คนเปิดล็อกอยากเห็นที่สุด
           เรื่องหนึ่ง · ต่อเป็นช่องสังเคราะห์เข้าไปในแถวที่อ่าน แทนที่จะไปเติมบรรทัด
           บันทึกใน Users::setRoles() — เส้นทางที่เปลี่ยนบทบาทได้มีมากกว่าหนึ่ง และ
           เส้นที่ใครเขียนเพิ่มวันหน้าจะได้บรรทัด `roles: sales → sales+admin` มาเอง
           โดยไม่ต้องจำว่าต้องเรียกอะไร (หลักเดียวกับที่หัวไฟล์นี้อธิบายไว้) */
        if ($row !== null && $table === 'admins') {
            $row['roles'] = implode('+', array_column(
                Db::all(
                    'SELECT role FROM admin_roles WHERE admin_id = ? ORDER BY role',
                    self::$entityId,
                ),
                'role',
            ));
        }

        return $row;
    }

    /** [{field, before, after}] ของช่องที่เปลี่ยนจริง · null = ไม่มีอะไรเปลี่ยน */
    private static function diff(?array $before, ?array $after): ?array
    {
        if ($before === null || $after === null) {
            return null;
        }
        $fields = array_unique(array_merge(array_keys($before), array_keys($after)));
        $out = [];
        foreach ($fields as $f) {
            if (in_array($f, self::NOISE_COLUMNS, true)) {
                continue;
            }
            $a = self::scalar($before[$f] ?? null);
            $b = self::scalar($after[$f] ?? null);
            if ($a === $b) {
                continue;
            }
            $secret = self::isSecret((string) $f);
            $out[] = [
                'field'  => (string) $f,
                'before' => $secret ? '***' : $a,
                'after'  => $secret ? '***' : $b,
            ];
            /* ล็อกหนึ่งแถวไม่ควรใหญ่กว่าข้อมูลที่มันอธิบาย — 40 ช่องคือมากกว่าที่
               ตารางไหนในระบบนี้มี ถ้าเกินแปลว่ามีอะไรผิดปกติ ตัดแล้วไปต่อ */
            if (count($out) >= 40) {
                break;
            }
        }
        return $out ?: null;
    }

    /** ค่าที่เทียบกันได้และเก็บลง JSON ได้ — ตัดความยาวกันล็อกบวม */
    private static function scalar(mixed $v): ?string
    {
        if ($v === null) {
            return null;
        }
        if (is_bool($v)) {
            return $v ? '1' : '0';
        }
        $s = is_scalar($v) ? (string) $v : (string) json_encode($v, JSON_UNESCAPED_UNICODE);
        return mb_strlen($s) > 300 ? (mb_substr($s, 0, 300) . '…') : $s;
    }

    private static function isSecret(string $field): bool
    {
        $f = strtolower($field);
        foreach (self::SECRET_HINTS as $hint) {
            if (str_contains($f, $hint)) {
                return true;
            }
        }
        return false;
    }

    /** สำเนาที่ปิดรหัสผ่าน/โทเคนแล้ว — ทำงานลึกลงไปในอาร์เรย์ซ้อนด้วย */
    private static function redact(mixed $data, int $depth = 0): mixed
    {
        if (!is_array($data) || $depth > 4) {
            return is_array($data) ? '[…]' : self::scalar($data);
        }
        $out = [];
        foreach ($data as $k => $v) {
            $out[$k] = self::isSecret((string) $k) ? '***' : self::redact($v, $depth + 1);
        }
        return $out;
    }

    private static function classify(int $status, bool $isWrite): string
    {
        /* เฉพาะสองเส้นนี้เท่านั้นที่เป็น "เข้า-ออกระบบ" · `/api/auth/me` ถูกข้ามไป
           ตั้งแต่ต้น ส่วน `/api/auth/policy` เป็นการอ่านตารางสิทธิ์เฉย ๆ — เคยถูก
           นับเป็นการล็อกอินเพราะจับทั้ง `/api/auth/` ซึ่งทำให้ล็อกรายงานว่ามีคน
           เข้าระบบทุกครั้งที่เปิดหน้า */
        if (self::$path === '/api/auth/login' || self::$path === '/api/auth/logout') {
            return 'auth';
        }
        if ($status >= 400) {
            return 'error';
        }
        return $isWrite ? 'audit' : 'request';
    }

    /** ข้อความไทยหนึ่งบรรทัดที่อ่านรู้เรื่องโดยไม่ต้องแปล path */
    private static function summary(string $kind): string
    {
        $action = self::$action ?? '';
        $verb   = self::ACTION_LABEL[$action] ?? $action;

        if ($kind === 'auth') {
            return $verb;
        }
        /* `DELETE /api/bookings/5/notes/9` ได้ action มาเป็น "notes" จากตัว path
           ซึ่งอ่านว่า "บันทึกโน้ต" ทั้งที่เป็นการลบโน้ต — เติมคำว่าลบให้ตรงกับ
           วิธีที่ใช้จริง ดีกว่าไปเดาชื่อการกระทำจากรูปประโยคของ path */
        if (self::$method === 'DELETE' && $action !== 'delete') {
            $verb = 'ลบ' . $verb;
        }
        $what = self::$table !== null ? (self::ENTITY_LABEL[self::$table] ?? self::$table) : '';
        $id   = self::$entityId !== null ? ' #' . self::$entityId : '';
        $text = trim("$verb $what$id");

        return $text !== '' ? $text : (self::$method . ' ' . self::$path);
    }

    private static function write(string $kind, int $status, ?array $changes, mixed $payload): void
    {
        $actor = self::$actor;
        $json  = static fn(mixed $v): ?string => $v === null || $v === []
            ? null
            : (string) json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $r = Db::run(
            'INSERT INTO activity_log
               (kind, actor_id, actor_name, actor_role, method, path, status, duration_ms,
                entity, entity_id, action, summary, changes, payload, ip, user_agent)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            $kind,
            int_or($actor['id'] ?? null),
            nul(mb_substr((string) ($actor['displayName'] ?? $actor['username'] ?? ''), 0, 120)),
            nul(\Optic\Roles::text($actor['roles'] ?? [])),
            self::$method,
            mb_substr(self::$fullPath, 0, 255),
            $status,
            (int) round((microtime(true) - self::$t0) * 1000),
            self::$table,
            self::$entityId,
            nul(mb_substr((string) self::$action, 0, 40)),
            nul(mb_substr(self::summary($kind), 0, 255)),
            $json($changes),
            $json($payload),
            nul(mb_substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45)),
            nul(mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255))
        );

        /* เก็บกวาดของเก่าเกาะไปกับคำขอปกติ — PHP ไม่มีโปรเซสค้างไว้ตั้งเวลา
           (เหตุผลเดียวกับที่ Scheduler.php อธิบายไว้)

           เช็คทุกคำขอคือเพิ่มคิวรีให้ทุกคำขอตลอดไปเพื่อทำงานที่ทำวันละครั้ง
           จึงยิงเฉพาะตอนที่เลขแถวหาร 200 ลงตัว — วันหนึ่งมีหลายพันแถว จึงถึงคิว
           แน่นอนอยู่ดี และวันที่เงียบจริง ๆ ก็ไม่มีอะไรให้ลบอยู่แล้ว */
        if (((int) ($r['insertId'] ?? 0)) % 200 === 0) {
            self::purgeIfDue();
        }
    }

    /** ลบล็อกที่เกินอายุ วันละครั้ง */
    private static function purgeIfDue(): void
    {
        $today = date('Y-m-d');
        $row   = Db::get("SELECT `value` FROM app_settings WHERE `key` = 'log_purged_on'");
        if ((string) ($row['value'] ?? '') === $today) {
            return;
        }
        /* ปักธงก่อนลบ ไม่ใช่หลัง — ถ้าการลบล้ม จะได้ไม่วนลองใหม่ทุกคำขอไปทั้งวัน */
        Db::run(
            "INSERT INTO app_settings (`key`, `value`) VALUES ('log_purged_on', ?)
             ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
            $today
        );
        foreach (self::KEEP_DAYS as $kind => $days) {
            /* LIMIT กันแถวค้างสะสมจากวันที่ระบบไม่ได้เปิด ไม่ให้กลายเป็นการลบ
               ล้านแถวในคำขอเดียว · ที่เหลือค่อยไปต่อวันพรุ่งนี้ */
            Db::run(
                'DELETE FROM activity_log WHERE kind = ? AND at < NOW() - INTERVAL ' . (int) $days . ' DAY LIMIT 20000',
                $kind
            );
        }
    }
}
