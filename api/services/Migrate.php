<?php
/**
 * Additive migrations. These only CREATE TABLE IF NOT EXISTS — nothing in the
 * original 27-table Access-derived schema is altered or dropped.
 */
declare(strict_types=1);

final class Migrate
{
    private const CHARSET = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    private const DEFAULT_SETTINGS = [
        'telegram_enabled'         => '0',
        'telegram_bot_token'       => '',
        'telegram_chat_id'         => '',
        'reminder_default_minutes' => '10',
        'shop_name'                => 'TIME OPTIC',
        'shop_open_time'           => '10:00',
        'shop_close_time'          => '20:00',
        'slot_minutes'             => '30',
    ];

    private static function tables(): array
    {
        $c = self::CHARSET;
        return [
            /* key/value settings (Telegram bot config, shop defaults) */
            'app_settings' => "CREATE TABLE IF NOT EXISTS app_settings (
                `key`      varchar(64) NOT NULL,
                `value`    text DEFAULT NULL,
                updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
                PRIMARY KEY (`key`)
              ) $c",

            /* advance queue bookings (จองคิวล่วงหน้า) */
            'bookings' => "CREATE TABLE IF NOT EXISTS bookings (
                id               int(10) unsigned NOT NULL AUTO_INCREMENT,
                booking_code     varchar(40) NOT NULL,
                customer_id      int(10) unsigned DEFAULT NULL,
                case_id          int(10) unsigned DEFAULT NULL,
                first_name       varchar(100) DEFAULT NULL,
                last_name        varchar(100) DEFAULT NULL,
                phone            varchar(40)  DEFAULT NULL,
                line_id          varchar(80)  DEFAULT NULL,
                booking_date     date NOT NULL,
                booking_time     time NOT NULL,
                duration_min     smallint(6) NOT NULL DEFAULT 30,
                service_type     varchar(60) NOT NULL DEFAULT 'eye_exam',
                channel          varchar(30) NOT NULL DEFAULT 'phone',
                status           varchar(20) NOT NULL DEFAULT 'booked',
                assigned_to      int(10) unsigned DEFAULT NULL,
                reminder_minutes smallint(6) NOT NULL DEFAULT 10,
                reminder_sent_at datetime DEFAULT NULL,
                confirmed_at     datetime DEFAULT NULL,
                arrived_at       datetime DEFAULT NULL,
                cancelled_reason varchar(255) DEFAULT NULL,
                intake_note      text DEFAULT NULL,
                notes            text DEFAULT NULL,
                created_by       int(10) unsigned DEFAULT NULL,
                created_at       datetime NOT NULL DEFAULT current_timestamp(),
                updated_at       datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
                PRIMARY KEY (id),
                UNIQUE KEY uq_booking_code (booking_code),
                KEY idx_booking_day (booking_date, booking_time),
                KEY idx_booking_status (status, booking_date),
                KEY idx_booking_reminder (reminder_sent_at, booking_date),
                KEY fk_booking_customer (customer_id),
                KEY fk_booking_case (case_id),
                KEY fk_booking_emp (assigned_to),
                KEY fk_booking_creator (created_by),
                CONSTRAINT fk_booking_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL,
                CONSTRAINT fk_booking_case     FOREIGN KEY (case_id)     REFERENCES cases (id)     ON DELETE SET NULL,
                CONSTRAINT fk_booking_emp      FOREIGN KEY (assigned_to) REFERENCES employees (id) ON DELETE SET NULL,
                CONSTRAINT fk_booking_creator  FOREIGN KEY (created_by)  REFERENCES employees (id) ON DELETE SET NULL
              ) $c",

            /* บันทึกเบื้องต้นทีละขั้นตอน — one row per question/answer captured */
            'booking_notes' => "CREATE TABLE IF NOT EXISTS booking_notes (
                id          int(10) unsigned NOT NULL AUTO_INCREMENT,
                booking_id  int(10) unsigned NOT NULL,
                case_id     int(10) unsigned DEFAULT NULL,
                step        varchar(40) NOT NULL DEFAULT 'intake',
                question    varchar(200) DEFAULT NULL,
                note        text NOT NULL,
                recorded_by int(10) unsigned DEFAULT NULL,
                created_at  datetime NOT NULL DEFAULT current_timestamp(),
                PRIMARY KEY (id),
                KEY idx_bn_booking (booking_id, created_at),
                KEY fk_bn_case (case_id),
                KEY fk_bn_emp (recorded_by),
                CONSTRAINT fk_bn_booking FOREIGN KEY (booking_id)  REFERENCES bookings (id)  ON DELETE CASCADE,
                CONSTRAINT fk_bn_case    FOREIGN KEY (case_id)     REFERENCES cases (id)     ON DELETE SET NULL,
                CONSTRAINT fk_bn_emp     FOREIGN KEY (recorded_by) REFERENCES employees (id) ON DELETE SET NULL
              ) $c",

            /* every Telegram (or other) message we tried to send */
            'notification_log' => "CREATE TABLE IF NOT EXISTS notification_log (
                id         int(10) unsigned NOT NULL AUTO_INCREMENT,
                channel    varchar(20) NOT NULL DEFAULT 'telegram',
                kind       varchar(40) NOT NULL DEFAULT 'booking_reminder',
                booking_id int(10) unsigned DEFAULT NULL,
                target     varchar(120) DEFAULT NULL,
                message    text DEFAULT NULL,
                ok         tinyint(1) NOT NULL DEFAULT 0,
                error      varchar(255) DEFAULT NULL,
                created_at datetime NOT NULL DEFAULT current_timestamp(),
                PRIMARY KEY (id),
                KEY idx_nl_created (created_at),
                KEY fk_nl_booking (booking_id),
                CONSTRAINT fk_nl_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE SET NULL
              ) $c",

            /* one row per (case, process) — the 9-process workflow's own status
               axis, written only by an explicit action on that process. A case
               with no rows still reports a status; it is derived from its data
               (api/routes/processes.php). */
            'case_processes' => "CREATE TABLE IF NOT EXISTS case_processes (
                id           int(10) unsigned NOT NULL AUTO_INCREMENT,
                case_id      int(10) unsigned NOT NULL,
                process      varchar(20) NOT NULL,
                status       varchar(20) NOT NULL DEFAULT 'not_started',
                started_at   datetime DEFAULT NULL,
                completed_at datetime DEFAULT NULL,
                note         varchar(500) DEFAULT NULL,
                created_at   datetime NOT NULL DEFAULT current_timestamp(),
                updated_at   datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
                PRIMARY KEY (id),
                UNIQUE KEY uq_cp_case_process (case_id, process),
                CONSTRAINT fk_cp_case FOREIGN KEY (case_id) REFERENCES cases (id) ON DELETE CASCADE
              ) $c",

            /* every stock item pulled for a case's production — the initial
               pickLot() calls at "เริ่มผลิต" and any later "เบิกเพิ่ม" */
            'production_withdrawals' => "CREATE TABLE IF NOT EXISTS production_withdrawals (
                id                int(10) unsigned NOT NULL AUTO_INCREMENT,
                case_id           int(10) unsigned NOT NULL,
                production_job_id int(10) unsigned DEFAULT NULL,
                item_type         varchar(20) NOT NULL,
                stock_lot_id      int(10) unsigned DEFAULT NULL,
                is_extra          tinyint(1) NOT NULL DEFAULT 0,
                reason            varchar(255) DEFAULT NULL,
                withdrawn_by      int(10) unsigned DEFAULT NULL,
                withdrawn_at      datetime NOT NULL DEFAULT current_timestamp(),
                PRIMARY KEY (id),
                KEY idx_pw_case (case_id),
                KEY fk_pw_job (production_job_id),
                KEY fk_pw_lot (stock_lot_id),
                KEY fk_pw_emp (withdrawn_by),
                CONSTRAINT fk_pw_case FOREIGN KEY (case_id) REFERENCES cases (id) ON DELETE CASCADE,
                CONSTRAINT fk_pw_job  FOREIGN KEY (production_job_id) REFERENCES production_jobs (id) ON DELETE SET NULL,
                CONSTRAINT fk_pw_lot  FOREIGN KEY (stock_lot_id) REFERENCES stock_lots (id) ON DELETE SET NULL,
                CONSTRAINT fk_pw_emp  FOREIGN KEY (withdrawn_by) REFERENCES employees (id) ON DELETE SET NULL
              ) $c",
        ];
    }

    /**
     * Views that must be kept in step with the code. Re-created on every run —
     * CREATE OR REPLACE is idempotent and the definitions live here rather than
     * in a dump nobody reads.
     */
    private static function views(): array
    {
        return [
            /* One row per case. The original joined custom_orders and lens_jobs
               on case_id, so a case with two orders came back twice and the
               board drew it twice — pick the latest of each instead. */
            'v_case_board' => "CREATE OR REPLACE VIEW v_case_board AS
                SELECT c.id, c.case_code, c.status, c.is_rush, c.opened_at, c.closed_at,
                       c.customer_id, c.notes,
                       s.stage_no, s.label_th AS status_label_th, s.label_en AS status_label_en,
                       s.stage_group, s.sort_order AS status_order, s.is_waiting, s.is_terminal,
                       cu.first_name, cu.last_name, cu.phone, cu.line_id,
                       e.employee_name AS received_by_name,
                       o.id AS order_id, o.invoice_code, o.lens_type, o.frame_name, o.lens_name,
                       o.appointment_date, o.appointment_time, o.total_price, o.discount,
                       o.total_price - o.discount AS net_price,
                       COALESCE(p.paid, 0) AS paid,
                       o.total_price - o.discount - COALESCE(p.paid, 0) AS balance,
                       lj.source AS lens_source, lj.status AS lens_status,
                       lj.expected_arrival, lj.follow_up_count,
                       TIMESTAMPDIFF(DAY, c.opened_at, CURRENT_TIMESTAMP()) AS age_days
                  FROM cases c
                  JOIN case_statuses s ON s.code = c.status
                  JOIN customers cu    ON cu.id = c.customer_id
                  LEFT JOIN employees e ON e.id = c.received_by
                  LEFT JOIN custom_orders o
                         ON o.id = (SELECT MAX(o2.id) FROM custom_orders o2 WHERE o2.case_id = c.id)
                  LEFT JOIN lens_jobs lj
                         ON lj.id = (SELECT MAX(l2.id) FROM lens_jobs l2 WHERE l2.case_id = c.id)
                  LEFT JOIN (SELECT order_id, SUM(amount) paid FROM payments
                              WHERE order_id IS NOT NULL AND cancelled_at IS NULL
                              GROUP BY order_id) p ON p.order_id = o.id",
        ];
    }

    /** @return string[] "table.column" names actually added this run */
    private static function addColumns(string $table, array $columns): array
    {
        $added = [];
        foreach ($columns as $name => $ddl) {
            $exists = Db::get(
                'SELECT COUNT(*) n FROM information_schema.columns
                  WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
                $table,
                $name
            );
            if (!(int) ($exists['n'] ?? 0)) {
                Db::pdo()->exec("ALTER TABLE `$table` ADD COLUMN `$name` $ddl");
                $added[] = "$table.$name";
            }
        }
        return $added;
    }

    /** @return string[] names of tables that were created on this run */
    public static function run(): array
    {
        $created = [];
        foreach (self::tables() as $name => $sql) {
            $existing = Db::get(
                'SELECT COUNT(*) n FROM information_schema.tables
                  WHERE table_schema = DATABASE() AND table_name = ?',
                $name
            );
            if (!(int) ($existing['n'] ?? 0)) {
                Db::pdo()->exec($sql);
                $created[] = $name;
            }
        }
        foreach (self::views() as $sql) {
            Db::pdo()->exec($sql);
        }

        $added = array_merge(
            self::addColumns('custom_orders', [
                'frame_price'    => 'decimal(10,2) NOT NULL DEFAULT 0',
                'lens_od_price'  => 'decimal(10,2) NOT NULL DEFAULT 0',
                'lens_os_price'  => 'decimal(10,2) NOT NULL DEFAULT 0',
                'options_price'  => 'decimal(10,2) NOT NULL DEFAULT 0',
            ]),
            self::addColumns('frame_fittings', [
                'frame_box_a' => 'decimal(6,2) DEFAULT NULL',
                'frame_box_b' => 'decimal(6,2) DEFAULT NULL',
            ]),
            self::addColumns('qc_checks', [
                'check_lens_od' => 'tinyint(1) NOT NULL DEFAULT 0',
                'check_lens_os' => 'tinyint(1) NOT NULL DEFAULT 0',
            ]),
            self::addColumns('payments', [
                'cancelled_at'  => 'datetime DEFAULT NULL',
                'cancelled_by'  => 'int(10) unsigned DEFAULT NULL',
                'cancel_reason' => 'varchar(255) DEFAULT NULL',
            ]),
            self::addColumns('production_jobs', [
                'status'                    => "varchar(30) NOT NULL DEFAULT 'WAITING_FOR_ITEMS'",
                'started_at'                => 'datetime DEFAULT NULL',
                'started_by'                => 'int(10) unsigned DEFAULT NULL',
                'received_by_customer_name' => 'varchar(120) DEFAULT NULL',
            ]),
            self::addColumns('cases', [
                'closed_by' => 'int(10) unsigned DEFAULT NULL',
                /* ประเภทงานของเคส — คนละเรื่องกับ "ลูกค้าเก่า/ใหม่" (is_new_customer)
                   เก็บเป็น varchar เพื่อให้เพิ่มประเภทใหม่ได้โดยไม่ต้องแก้ schema:
                   /api/meta สร้างตัวเลือกจากค่าที่เคยใช้จริงรวมกับค่าตั้งต้น */
                'case_type'     => 'varchar(40) DEFAULT NULL',
                /* ช่องทางที่รู้จักร้าน เลือก "อื่น ๆ" แล้วพิมพ์เองได้ */
                'referral_note' => 'varchar(255) DEFAULT NULL',
            ]),
            /* แว่นเดิมบนใบกระดาษมีแค่ SPH/ADD/VA/PD มาแต่เดิม ของจริงต้องอ่าน
               CYL/AXIS จากเลนส์เก่าด้วย และใบจากภายนอกต้องรู้ว่ามาจากที่ไหนเมื่อไร */
            self::addColumns('prescriptions', [
                'old_r_cylinder'       => 'varchar(20) DEFAULT NULL',
                'old_r_axis'           => 'varchar(20) DEFAULT NULL',
                'old_l_cylinder'       => 'varchar(20) DEFAULT NULL',
                'old_l_axis'           => 'varchar(20) DEFAULT NULL',
                'health_eye_disease'   => 'tinyint(1) NOT NULL DEFAULT 0',
                'health_drug_allergy'  => 'tinyint(1) NOT NULL DEFAULT 0',
                'health_medication'    => 'tinyint(1) NOT NULL DEFAULT 0',
                'external_place'       => 'varchar(120) DEFAULT NULL',
                'external_date'        => 'date DEFAULT NULL',
            ])
        );
        Db::run("UPDATE case_statuses SET stage_group = 'centering' WHERE code = 'centering'");
        Db::run("UPDATE case_statuses SET stage_group = 'payment' WHERE code = 'payment'");
        $created = array_merge($created, $added);
        foreach (self::DEFAULT_SETTINGS as $key => $value) {
            Db::run('INSERT IGNORE INTO app_settings (`key`, `value`) VALUES (?, ?)', $key, $value);
        }
        return $created;
    }
}
