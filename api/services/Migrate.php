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
        ];
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
        foreach (self::DEFAULT_SETTINGS as $key => $value) {
            Db::run('INSERT IGNORE INTO app_settings (`key`, `value`) VALUES (?, ?)', $key, $value);
        }
        return $created;
    }
}
