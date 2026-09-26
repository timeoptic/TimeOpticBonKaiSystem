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
        'shop_name'                => 'TIMEOPTIC @ Be Well MEDICAL CENTER',
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

            /* บันทึกการใช้งานของทั้งระบบ — ใครทำอะไร เมื่อไหร่ (ดู services/ActivityLog.php)

               ไม่มี FOREIGN KEY ไปที่ `admins` โดยตั้งใจ: ร่องรอยต้องอยู่ต่อได้แม้
               บัญชีที่ทำจะถูกลบทิ้ง จึงเก็บชื่อกับบทบาท ณ เวลานั้นเป็นสำเนาไว้ในแถว
               แทนที่จะ join กลับไปหาแถวที่อาจไม่มีอยู่แล้ว

               `at` เป็น datetime(3) เพราะวันหนึ่งมีหลายพันแถว — ความละเอียดระดับ
               วินาทีทำให้ลำดับของสิ่งที่เกิดในวินาทีเดียวกันอ่านไม่ออก ซึ่งเป็น
               วินาทีที่คนมาเปิดล็อกอ่านสนใจที่สุด */
            'activity_log' => "CREATE TABLE IF NOT EXISTS activity_log (
                id          bigint(20) unsigned NOT NULL AUTO_INCREMENT,
                at          datetime(3) NOT NULL DEFAULT current_timestamp(3),
                kind        varchar(12) NOT NULL COMMENT 'audit | auth | error | request',
                actor_id    int(10) unsigned DEFAULT NULL COMMENT 'admins.id — ไม่ผูก FK โดยตั้งใจ',
                actor_name  varchar(120) DEFAULT NULL COMMENT 'ชื่อ ณ เวลานั้น',
                actor_role  varchar(20)  DEFAULT NULL,
                method      varchar(8)  NOT NULL,
                path        varchar(255) NOT NULL,
                status      smallint(6) NOT NULL DEFAULT 0,
                duration_ms int(10) unsigned NOT NULL DEFAULT 0,
                entity      varchar(40) DEFAULT NULL COMMENT 'ชื่อตารางที่ถูกแตะ',
                entity_id   int(10) unsigned DEFAULT NULL,
                action      varchar(40) DEFAULT NULL,
                summary     varchar(255) DEFAULT NULL COMMENT 'ข้อความไทยพร้อมอ่าน',
                changes     text DEFAULT NULL COMMENT 'JSON [{field, before, after}]',
                payload     text DEFAULT NULL,
                ip          varchar(45)  DEFAULT NULL,
                user_agent  varchar(255) DEFAULT NULL,
                PRIMARY KEY (id),
                KEY idx_log_at (at),
                KEY idx_log_kind (kind, at),
                KEY idx_log_actor (actor_id, at),
                KEY idx_log_entity (entity, entity_id, at)
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

            /* one row per (case, process) — the 6-process workflow's own status
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

            /* ส่งมอบ — one row per case, the last step of the 6-step flow.
               The handover used to be written onto production_jobs.pickup_at,
               which meant a case could not be handed over without a production
               job; the bench room is gone, the handover is not. */
            /* สมุดว่าเคสนี้ตัดอะไรออกจากคลังไปแล้วบ้าง — ของจริงอยู่ที่ inventory_logs
               ของฝั่งคลัง ตารางนี้เก็บ "สำเนาของเลขอ้างอิง ณ เวลาที่ของเคลื่อน"
               ไว้สองเรื่อง: กันตัดซ้ำเมื่อกดยืนยันการขายใหม่ และเก็บ idem_key ไว้ใช้
               เป็น reverses_key ตอนคืนของ

               ห้ามมี foreign key ไป stock_lots — สมุดสต็อกเป็นบันทึกประวัติ ไม่ใช่
               ตัวชี้ที่ยังมีชีวิต ผูกเป็น FK แล้วจะได้ผลแย่สองทาง: ลบล็อตไม่ได้เพราะ
               ฝั่งเราค้ำอยู่ หรือประวัติถูก cascade ลบตามไป · lot_id จึงเป็น int เปล่า ๆ */
            'case_stock_issues' => "CREATE TABLE IF NOT EXISTS case_stock_issues (
                id               int(10) unsigned NOT NULL AUTO_INCREMENT,
                case_id          int(10) unsigned NOT NULL,
                order_id         int(10) unsigned NOT NULL,
                slot             varchar(16) NOT NULL COMMENT 'frame | lensR | lensL',
                kind             varchar(10) NOT NULL DEFAULT 'issue' COMMENT 'issue | rx',
                sku              varchar(100) NOT NULL,
                product_name     varchar(255) DEFAULT NULL,
                lot_id           int(10) unsigned DEFAULT NULL COMMENT 'ล็อตที่ฟอร์มเลือก อ้างอิงเฉย ๆ ไม่ใช่ FK',
                quantity         int(11) NOT NULL DEFAULT 1,
                idem_key         varchar(120) NOT NULL,
                reference_doc    varchar(100) DEFAULT NULL,
                unit_cost        decimal(12,2) DEFAULT NULL COMMENT 'null = บัญชีที่เชื่อมเป็น staff จึงไม่ได้รับต้นทุน',
                total_cost       decimal(12,2) DEFAULT NULL,
                response         longtext DEFAULT NULL,
                employee_id      int(10) unsigned DEFAULT NULL,
                issued_at        datetime NOT NULL DEFAULT current_timestamp(),
                reversed_at      datetime DEFAULT NULL,
                reverse_idem_key varchar(120) DEFAULT NULL,
                reverse_note     varchar(255) DEFAULT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY uq_csi_idem (idem_key),
                KEY idx_csi_case (case_id),
                KEY idx_csi_order_slot (order_id, slot),
                CONSTRAINT fk_csi_case FOREIGN KEY (case_id) REFERENCES cases (id) ON DELETE CASCADE
              ) $c",

            'case_deliveries' => "CREATE TABLE IF NOT EXISTS case_deliveries (
                id                        int(10) unsigned NOT NULL AUTO_INCREMENT,
                case_id                   int(10) unsigned NOT NULL,
                order_id                  int(10) unsigned DEFAULT NULL,
                delivered_at              datetime DEFAULT NULL,
                handed_over_by            int(10) unsigned DEFAULT NULL,
                received_by_customer_name varchar(120) DEFAULT NULL,
                note                      varchar(500) DEFAULT NULL,
                created_at                datetime NOT NULL DEFAULT current_timestamp(),
                updated_at                datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
                PRIMARY KEY (id),
                UNIQUE KEY uq_cd_case (case_id),
                CONSTRAINT fk_cd_case FOREIGN KEY (case_id) REFERENCES cases (id) ON DELETE CASCADE
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

            /* ขั้น "เลนส์" จองของไว้ให้เคส แต่ยังไม่ตัดสต็อก — ของยังอยู่บนชั้น
               แต่เคสอื่นหยิบไม่ได้ ยอดที่ขายได้จริงคือ
               remaining_qty − SUM(qty ของการจองที่ยัง active) */
            'stock_reservations' => "CREATE TABLE IF NOT EXISTS stock_reservations (
                id           int(10) unsigned NOT NULL AUTO_INCREMENT,
                case_id      int(10) unsigned NOT NULL,
                order_id     int(10) unsigned DEFAULT NULL,
                item_type    varchar(20) NOT NULL,
                product_id   int(10) unsigned DEFAULT NULL,
                stock_lot_id int(10) unsigned DEFAULT NULL,
                qty          int(11) NOT NULL DEFAULT 1,
                status       varchar(20) NOT NULL DEFAULT 'active',
                note         varchar(255) DEFAULT NULL,
                reserved_at  datetime NOT NULL DEFAULT current_timestamp(),
                reserved_by  int(10) unsigned DEFAULT NULL,
                released_at  datetime DEFAULT NULL,
                released_by  int(10) unsigned DEFAULT NULL,
                consumed_at  datetime DEFAULT NULL,
                PRIMARY KEY (id),
                KEY idx_sr_case (case_id, item_type, status),
                KEY idx_sr_lot (stock_lot_id, status),
                KEY idx_sr_product (product_id, status),
                KEY fk_sr_emp (reserved_by),
                CONSTRAINT fk_sr_case FOREIGN KEY (case_id)      REFERENCES cases (id)      ON DELETE CASCADE,
                CONSTRAINT fk_sr_lot  FOREIGN KEY (stock_lot_id) REFERENCES stock_lots (id) ON DELETE SET NULL,
                CONSTRAINT fk_sr_emp  FOREIGN KEY (reserved_by)  REFERENCES employees (id)  ON DELETE SET NULL
              ) $c",

            /* สถานะรายชิ้นของเคส — กรอบ / เลนส์ขวา / เลนส์ซ้าย
               is_required = 0 คือ "งานข้างเดียว" ไม่ต้องใช้ชิ้นนี้
               ส่วนการสั่งของกับซัพพลายเออร์เก็บที่นี่ด้วย เพราะ lens_jobs
               เป็นรายเคส (ทั้งคู่รวมกัน) ไม่ใช่รายชิ้น */
            'case_item_fulfillment' => "CREATE TABLE IF NOT EXISTS case_item_fulfillment (
                id               int(10) unsigned NOT NULL AUTO_INCREMENT,
                case_id          int(10) unsigned NOT NULL,
                order_id         int(10) unsigned DEFAULT NULL,
                item_type        varchar(20) NOT NULL,
                is_required      tinyint(1) NOT NULL DEFAULT 1,
                status           varchar(20) NOT NULL DEFAULT 'not_chosen',
                supplier_id      int(10) unsigned DEFAULT NULL,
                order_no         varchar(60) DEFAULT NULL,
                ordered_at       datetime DEFAULT NULL,
                expected_arrival date DEFAULT NULL,
                received_at      datetime DEFAULT NULL,
                note             varchar(255) DEFAULT NULL,
                updated_by       int(10) unsigned DEFAULT NULL,
                created_at       datetime NOT NULL DEFAULT current_timestamp(),
                updated_at       datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
                PRIMARY KEY (id),
                UNIQUE KEY uq_cif_case_item (case_id, item_type),
                KEY fk_cif_supplier (supplier_id),
                KEY fk_cif_emp (updated_by),
                CONSTRAINT fk_cif_case     FOREIGN KEY (case_id)     REFERENCES cases (id)     ON DELETE CASCADE,
                CONSTRAINT fk_cif_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL,
                CONSTRAINT fk_cif_emp      FOREIGN KEY (updated_by)  REFERENCES employees (id) ON DELETE SET NULL
              ) $c",

            /* เลขใบเสร็จที่ออกให้ลูกค้าจริง (ใบเสร็จ / ใบกำกับภาษีอย่างย่อ)
             *
             * ทำไมเป็นตารางของตัวเอง ไม่ใช่คอลัมน์แปะที่ custom_orders:
             *   - ใบเสร็จออกได้ทั้งจากเคสแว่นและจาก POS ถ้าเก็บเป็นคอลัมน์ในสองตาราง
             *     ตัวนับจะเดินแยกกันและตรวจเลขซ้ำข้ามตารางไม่ได้
             *   - ชุดเลขเอกสารภาษีต้องตอบได้ว่า "เลขนี้ออกเมื่อไหร่ ใครออก ให้ใบไหน"
             *     ซึ่งเป็นแถวของเหตุการณ์ ไม่ใช่คุณสมบัติของออเดอร์
             *
             * UNIQUE สามตัวคือหัวใจ ไม่ใช่ของประดับ:
             *   uq_receipt_no    เลขห้ามซ้ำ — ฐานกันเอง ไม่ต้องเชื่อว่าโค้ดถูก
             *   uq_receipt_order หนึ่งออเดอร์ได้ใบเดียวตลอดกาล เปิดหน้าพิมพ์ซ้ำกี่ครั้ง
             *   uq_receipt_sale  หรือพนักงานสองคนเปิดพร้อมกัน ก็ยังได้เลขเดิมใบเดิม
             * (MySQL ยอมให้ NULL ซ้ำได้ในดัชนี unique แถวฝั่ง POS ที่ order_id เป็น NULL
             *  จึงอยู่ร่วมกันได้หลายแถว และกลับกัน)
             */
            'receipts' => "CREATE TABLE IF NOT EXISTS receipts (
                id           int(10) unsigned NOT NULL AUTO_INCREMENT,
                receipt_no   varchar(40) NOT NULL COMMENT 'Bill-2026-09-00042 (เคส) / BillP-... (POS)',
                order_id     int(10) unsigned DEFAULT NULL,
                sale_id      int(10) unsigned DEFAULT NULL,
                total_amount decimal(12,2) NOT NULL DEFAULT 0.00 COMMENT 'ยอดรวม VAT ณ วันที่ออกเลข',
                issued_at    datetime NOT NULL DEFAULT current_timestamp(),
                issued_by    int(10) unsigned DEFAULT NULL COMMENT 'admins.id ของคนที่เปิดหน้าใบเสร็จครั้งแรก',
                PRIMARY KEY (id),
                UNIQUE KEY uq_receipt_no (receipt_no),
                UNIQUE KEY uq_receipt_order (order_id),
                UNIQUE KEY uq_receipt_sale (sale_id),
                CONSTRAINT fk_receipt_order FOREIGN KEY (order_id) REFERENCES custom_orders (id) ON DELETE CASCADE,
                CONSTRAINT fk_receipt_sale  FOREIGN KEY (sale_id)  REFERENCES pos_sales (id)     ON DELETE CASCADE
              ) $c",

            /* ชื่อที่พิมพ์ลงบล็อกลูกค้าของใบเสร็จ — คนละคนกับลูกค้าในเคสได้
               เคสเป็นของพ่อ แต่ลูกเป็นคนออกบิล วันหลังพ่อมาตัดแว่นอีก คนหน้าร้าน
               ค้นชื่อลูกแล้วดึงมาเติมได้ ไม่ต้องพิมพ์ที่อยู่กับเลขภาษีใหม่ทั้งชุด

               ทำไมไม่เพิ่มคอลัมน์ใน customers: ชื่อบนใบไม่ใช่ชื่อคนที่มาตัดแว่น
               ลูกค้าคนเดียวออกใบได้หลายนาม (ตัวเอง / บริษัท / คนที่จ่ายให้) และนาม
               หนึ่งก็ใช้กับลูกค้าหลายคนได้ ยัดลงตารางลูกค้าคือตอบสองคำถามด้วยช่องเดียว

               `customer_id` เป็นแค่ "เคยออกใบให้ใคร" ไว้ดันขึ้นบนสุดตอนค้น ไม่ใช่
               เจ้าของ — ลูกออกใบให้แม่ด้วยก็ยังค้นชื่อเจอตามปกติ

               ไม่มี UNIQUE บนชื่อหรือเลขภาษี: ชื่อพ้องกันมีจริง และนามที่ยังไม่รู้
               เลขภาษีก็ต้องบันทึกได้ การรวมแถวซ้ำทำที่ POST /api/bill-parties
               ซึ่งเทียบชื่อกับเลขแบบปรับรูปแบบให้เหมือนกันก่อน */
            'bill_parties' => "CREATE TABLE IF NOT EXISTS bill_parties (
                id           int(10) unsigned NOT NULL AUTO_INCREMENT,
                name         varchar(200) NOT NULL COMMENT 'ชื่อที่พิมพ์ลงใบ — บุคคลหรือนิติบุคคล',
                tax_id       varchar(30)  DEFAULT NULL COMMENT 'เลขผู้เสียภาษี · บุคคลธรรมดาคือเลขบัตรประชาชน',
                address      varchar(255) DEFAULT NULL,
                phone        varchar(40)  DEFAULT NULL,
                customer_id  int(10) unsigned DEFAULT NULL COMMENT 'เคยออกใบให้ลูกค้าคนไหน — ไว้เดาให้ ไม่ใช่เจ้าของ',
                created_at   datetime NOT NULL DEFAULT current_timestamp(),
                last_used_at datetime DEFAULT NULL COMMENT 'ครั้งล่าสุดที่ถูกพิมพ์ลงใบจริง',
                PRIMARY KEY (id),
                KEY idx_bill_party_name (name(64)),
                KEY idx_bill_party_tax (tax_id),
                KEY idx_bill_party_customer (customer_id),
                CONSTRAINT fk_bill_party_customer FOREIGN KEY (customer_id)
                  REFERENCES customers (id) ON DELETE SET NULL
              ) $c",

            /* ใบเบิกเลนส์ของ Bewell — เลนส์ไม่ใช่สต็อก ไม่ผ่าน CaseStock หรือ rx_orders
               rx_snapshot = ค่าสายตาที่คัดลอกไว้ตอนออกใบ ใบที่ส่งร้านเลนส์ไปแล้วต้องไม่เปลี่ยนตาม
               ใบค่าสายตาที่ถูกแก้ทีหลัง (null = เคสยังไม่ยืนยันค่าสายตาสุดท้าย) */
            'lens_requisitions' => "CREATE TABLE IF NOT EXISTS lens_requisitions (
                id              int(10) unsigned NOT NULL AUTO_INCREMENT,
                req_no          varchar(30) NOT NULL,
                case_id         int(10) unsigned NOT NULL,
                customer_id     int(10) unsigned NOT NULL,
                order_id        int(10) unsigned DEFAULT NULL,
                prescription_id int(10) unsigned DEFAULT NULL,
                rx_snapshot     longtext DEFAULT NULL,
                status          enum('pending','issued','ordered','received','assembled','cancelled') NOT NULL DEFAULT 'pending',
                total           decimal(12,2) NOT NULL DEFAULT 0,
                note            text DEFAULT NULL,
                cancel_reason   varchar(255) DEFAULT NULL,
                created_by      int(10) unsigned DEFAULT NULL,
                created_at      datetime NOT NULL DEFAULT current_timestamp(),
                updated_at      datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
                issued_at       datetime DEFAULT NULL,
                ordered_at      datetime DEFAULT NULL,
                received_at     datetime DEFAULT NULL,
                assembled_at    datetime DEFAULT NULL,
                cancelled_at    datetime DEFAULT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY uq_lr_no (req_no),
                KEY idx_lr_case (case_id),
                KEY idx_lr_order (order_id),
                KEY idx_lr_status (status),
                CONSTRAINT fk_lr_case FOREIGN KEY (case_id) REFERENCES cases (id) ON DELETE CASCADE,
                CONSTRAINT fk_lr_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
                CONSTRAINT fk_lr_order FOREIGN KEY (order_id) REFERENCES custom_orders (id) ON DELETE SET NULL,
                CONSTRAINT fk_lr_rx FOREIGN KEY (prescription_id) REFERENCES prescriptions (id) ON DELETE SET NULL
              ) $c",

            /* รายการในใบเบิก — ทุกช่องของ spec คัดลอกเก็บไว้ ใบเก่ายังอ่านได้ครบ
               แม้วันหนึ่งแหล่งเลนส์เปลี่ยนจาก MOCK เป็นฐานจริง */
            'lens_requisition_items' => "CREATE TABLE IF NOT EXISTS lens_requisition_items (
                id             int(10) unsigned NOT NULL AUTO_INCREMENT,
                requisition_id int(10) unsigned NOT NULL,
                eye            enum('R','L','pair') NOT NULL,
                source         varchar(20) NOT NULL DEFAULT 'MOCK',
                mock_code      varchar(120) DEFAULT NULL,
                brand          varchar(80) NOT NULL,
                lens_type      varchar(80) DEFAULT NULL,
                design         varchar(120) DEFAULT NULL,
                lens_index     varchar(10) DEFAULT NULL,
                coating        varchar(80) DEFAULT NULL,
                option_name    varchar(80) DEFAULT NULL,
                photochromic   varchar(80) DEFAULT NULL,
                color          varchar(40) DEFAULT NULL,
                quantity       int(11) NOT NULL DEFAULT 1,
                unit_price     decimal(12,2) NOT NULL DEFAULT 0,
                line_total     decimal(12,2) NOT NULL DEFAULT 0,
                PRIMARY KEY (id),
                KEY idx_lri_req (requisition_id),
                CONSTRAINT fk_lri_req FOREIGN KEY (requisition_id) REFERENCES lens_requisitions (id) ON DELETE CASCADE
              ) $c",

            /* รายการเลนส์ที่ Bewell ขายได้ — แอดมินเพิ่ม/แก้/ปิดเองที่หน้า /lens-catalog
               ไม่ใช่คลัง: ไม่มีจำนวนคงเหลือ ไม่มีล็อต · sph / cyl / add_power เป็นแค่ป้ายของรุ่นนั้น
               (รายชื่อจำลองจากเว็บหลักแยกรุ่นตามค่าสายตา) ใช้กรองในหน้าขาย ว่าง = ใช้ได้ทุกค่า
               ไม่มีการลบ — ปิดใช้งานแทน ใบเก่าคัดลอกค่าไว้เองอยู่แล้ว (lens_requisition_items) */
            'lens_catalog' => "CREATE TABLE IF NOT EXISTS lens_catalog (
                id            int(10) unsigned NOT NULL AUTO_INCREMENT,
                code          varchar(40)  NOT NULL,
                lens_name     varchar(160) NOT NULL,
                lens_type     varchar(60)  NOT NULL,
                lens_index    varchar(10)  DEFAULT NULL,
                coating       varchar(80)  DEFAULT NULL,
                brand         varchar(80)  DEFAULT NULL,
                sph           varchar(10)  DEFAULT NULL,
                cyl           varchar(10)  DEFAULT NULL,
                add_power     varchar(10)  DEFAULT NULL,
                cost_price    decimal(12,2) DEFAULT NULL COMMENT 'ต่อคู่',
                selling_price decimal(12,2) NOT NULL DEFAULT 0 COMMENT 'ต่อคู่',
                active        tinyint(1) NOT NULL DEFAULT 1,
                sort_order    int(11) NOT NULL DEFAULT 0,
                created_by    int(10) unsigned DEFAULT NULL,
                updated_by    int(10) unsigned DEFAULT NULL,
                created_at    datetime NOT NULL DEFAULT current_timestamp(),
                updated_at    datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
                PRIMARY KEY (id),
                UNIQUE KEY uq_lens_catalog_code (code),
                KEY idx_lens_catalog_active (active, sort_order)
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
            /* One row per case. The original joined custom_orders on case_id, so
               a case with two orders came back twice and the board drew it twice
               — pick the latest instead. (It also carried four lens_jobs columns
               for the ติดตามเลนส์ screen; that screen and its step are gone.) */
            'v_case_board' => "CREATE OR REPLACE VIEW v_case_board AS
                SELECT c.id, c.case_code, c.status, c.is_rush, c.opened_at, c.closed_at,
                       c.customer_id, c.notes, c.case_type, c.customer_category,
                       c.referral_source, c.referral_note,
                       s.stage_no, s.label_th AS status_label_th, s.label_en AS status_label_en,
                       s.stage_group, s.sort_order AS status_order, s.is_waiting, s.is_terminal,
                       cu.first_name, cu.mid_name, cu.last_name, cu.phone, cu.line_id,
                       e.employee_name AS received_by_name,
                       o.id AS order_id, o.invoice_code, o.lens_type, o.frame_name, o.lens_name,
                       o.appointment_date, o.appointment_time, o.total_price, o.discount,
                       o.total_price - o.discount AS net_price,
                       COALESCE(p.paid, 0) AS paid,
                       o.total_price - o.discount - COALESCE(p.paid, 0) AS balance,
                       TIMESTAMPDIFF(DAY, c.opened_at, CURRENT_TIMESTAMP()) AS age_days
                  FROM cases c
                  JOIN case_statuses s ON s.code = c.status
                  JOIN customers cu    ON cu.id = c.customer_id
                  LEFT JOIN employees e ON e.id = c.received_by
                  LEFT JOIN custom_orders o
                         ON o.id = (SELECT MAX(o2.id) FROM custom_orders o2 WHERE o2.case_id = c.id)
                  LEFT JOIN (SELECT order_id, SUM(amount) paid FROM payments
                              WHERE order_id IS NOT NULL AND cancelled_at IS NULL
                              GROUP BY order_id) p ON p.order_id = o.id",
        ];
    }

    /**
     * The 6-step case flow, spelled out as rows of case_statuses.
     *
     *   รับลูกค้า → วัดสายตา → ขาย/เลือกกรอบ → ชำระเงิน → วัด Center → ส่งมอบ
     *
     * `stage_group` is the step; `code` is the one status a case sits on inside
     * it. Two rules the rest of the app leans on, so they are enforced here
     * rather than left to whoever edits the table next:
     *
     *   1. sort_order never crosses back into an earlier group. advanceCaseStatus()
     *      compares sort_order to decide "don't drag the case backwards", so a
     *      sales-group row sorting after a payment-group row would let a case
     *      bounce. This is why นัดหมาย/เอกสาร sits in delivery, not sales.
     *   2. every non-terminal group has at least one row, because
     *      entryStatusOfGroup() takes the first of them by sort_order.
     *
     * Declared in full and reconciled on every boot: a code that is not in this
     * list is not part of the flow, and any case still parked on one is moved to
     * the delivery step (everything cut — เลนส์, ผลิต, QC, แพ็คสินค้า — happened
     * after วัด Center and before the customer collected).
     */
    private const CASE_STATUS_ROWS = [
        // code,               stage_no, stage_group, label_th, label_en, sort, waiting, terminal
        ['reception',      '1', 'reception', 'รับลูกค้า / ลงข้อมูล', 'Reception',            10, 0, 0],
        ['old_rx',         '1', 'reception', 'บันทึกค่าสายตาเดิม',   'Old prescription',     20, 0, 0],
        ['waiting_exam',   '2', 'exam',      'รอวัดสายตา',           'Waiting for exam',     30, 1, 0],
        ['exam',           '2', 'exam',      'กำลังวัดสายตา',        'Eye examination',      40, 0, 0],
        ['rx_decision',    '2', 'exam',      'ตัดสินใจค่าสายตา',     'Prescription decision', 50, 0, 0],
        ['waiting_sales',  '3', 'sales',     'รอฝ่ายขาย',            'Waiting for sales',    60, 1, 0],
        ['sales',          '3', 'sales',     'ขาย / เลือกกรอบ',      'Sales',                70, 0, 0],
        ['order_confirm',  '3', 'sales',     'ยืนยันออเดอร์',        'Order confirmation',   80, 0, 0],
        ['payment',        '4', 'payment',   'ชำระเงิน',             'Payment',              90, 0, 0],
        ['centering',      '5', 'centering', 'วัดจุดศูนย์กลาง',      'Centering',           100, 0, 0],
        ['frame_fitting',  '5', 'centering', 'วัดกรอบ / ฟิตติ้ง',    'Frame & fitting',     110, 0, 0],
        ['appointment',    '6', 'delivery',  'นัดหมายรับของ',        'Appointment',         120, 0, 0],
        ['ready_notify',   '6', 'delivery',  'พร้อมแจ้งลูกค้า',      'Ready to notify',     130, 1, 0],
        ['notified',       '6', 'delivery',  'แจ้งลูกค้าแล้ว',       'Customer notified',   140, 0, 0],
        ['waiting_pickup', '6', 'delivery',  'รอลูกค้ามารับ',        'Waiting for pickup',  150, 1, 0],
        ['pickup',         '6', 'delivery',  'ส่งมอบ',               'Pickup',              160, 0, 0],
        ['completed',      '—', 'done',      'ปิดเคสแล้ว',           'Completed',           900, 0, 1],
        ['cancelled',      '—', 'done',      'ยกเลิกเคส',            'Cancelled',           910, 0, 1],
    ];

    /** where a case goes when the status it is sitting on is no longer in the flow */
    private const DEAD_STATUS_LANDING = 'appointment';

    private static function reshapeCaseStatuses(): void
    {
        $codes = [];
        foreach (self::CASE_STATUS_ROWS as $r) {
            $codes[] = $r[0];
            Db::run(
                'INSERT INTO case_statuses
                   (code, stage_no, stage_group, label_th, label_en, sort_order, is_waiting, is_terminal)
                 VALUES (?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE
                   stage_no = VALUES(stage_no), stage_group = VALUES(stage_group),
                   label_th = VALUES(label_th), label_en = VALUES(label_en),
                   sort_order = VALUES(sort_order), is_waiting = VALUES(is_waiting),
                   is_terminal = VALUES(is_terminal)',
                $r[0], $r[1], $r[2], $r[3], $r[4], $r[5], $r[6], $r[7]
            );
        }
        $in = implode(',', array_fill(0, count($codes), '?'));
        /* move the cases first: v_case_board INNER JOINs case_statuses, so a case
           left pointing at a deleted code would vanish off the board entirely */
        Db::run(
            "UPDATE cases SET status = ? WHERE status NOT IN ($in)",
            self::DEAD_STATUS_LANDING,
            ...$codes
        );
        Db::run("DELETE FROM case_statuses WHERE code NOT IN ($in)", ...$codes);
    }

    /**
     * ย้าย "ใครเป็นลูกค้า" ออกจาก "งานนี้คืองานอะไร".
     *
     * `case_type` เคยรับสองหน้าที่: SIGHTFIRST กับ ลูกค้าใหม่ ปนอยู่กับ ตัดแว่นใหม่ /
     * เปลี่ยนเลนส์ / ซ่อม ทั้งที่คนละคำถาม — เคส SIGHTFIRST หนึ่งใบจึงบอกไม่ได้เลยว่า
     * เป็นงานตัดแว่นใหม่หรือเปลี่ยนเลนส์ เพราะช่องถูกใช้ไปแล้ว
     *
     * เดินครั้งเดียวก็พอ แต่เขียนให้รันซ้ำได้ไม่เสียหาย: แถวที่มี customer_category
     * แล้วจะไม่ถูกแตะ และค่าที่ไม่ใช่ประเภทงานจริงจะถูกล้างออกจาก case_type
     */
    private static function splitCustomerCategoryOutOfCaseType(): void
    {
        Db::run(
            "UPDATE cases SET customer_category = 'sight_first'
              WHERE customer_category IS NULL AND case_type = 'SIGHTFIRST'"
        );
        Db::run("UPDATE cases SET customer_category = 'customer' WHERE customer_category IS NULL");
        /* ค่าที่ตอบคำถาม "ใครเป็นลูกค้า" ไม่ใช่ "งานอะไร" — ย้ายความหมายไปแล้ว ล้างทิ้ง */
        Db::run(
            "UPDATE cases SET case_type = NULL
              WHERE case_type IN ('SIGHTFIRST', 'ลูกค้าใหม่', 'ลูกค้าเก่า', 'ลูกค้าร้าน')"
        );
    }

    /**
     * เติมค่าให้คอลัมน์ enum ที่มีอยู่แล้ว — ค่าเดิมอยู่ครบตามลำดับเดิม ไม่มีการลดค่าออก
     *
     * @return string[] "table.column+value" ที่เพิ่มในรอบนี้
     */
    private static function extendEnum(string $table, string $column, array $values, string $tail): array
    {
        $row = Db::get(
            'SELECT COLUMN_TYPE t FROM information_schema.columns
              WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
            $table,
            $column
        );
        if (!$row) {
            return [];
        }
        preg_match_all("/'((?:[^']|'')*)'/", (string) $row['t'], $m);
        $have    = array_map(fn($v) => str_replace("''", "'", $v), $m[1]);
        $missing = array_values(array_diff($values, $have));
        if (!$missing) {
            return [];
        }
        $list = implode(',', array_map(fn($v) => "'" . str_replace("'", "''", $v) . "'", array_merge($have, $missing)));
        Db::pdo()->exec("ALTER TABLE `$table` MODIFY COLUMN `$column` enum($list) $tail");
        return array_map(fn($v) => "$table.$column+$v", $missing);
    }

    /**
     * รายการเลนส์ตั้งต้นของ Bewell — ใส่ครั้งเดียวตอนตารางยังว่าง แอดมินแก้ต่อเองที่หน้าจอ
     * ราคาเป็นตัวอย่าง ร้านต้องแก้ก่อนใช้จริง · ตารางมีแถวแล้ว (รวมแถวที่ปิดไว้) จะไม่แตะอีก
     */
    private static function seedLensCatalog(): void
    {
        if ((int) Db::get('SELECT COUNT(*) n FROM lens_catalog')['n'] > 0) {
            return;
        }
        /* รายชื่อเลนส์จำลองเดิมของ Bewell (1,582 รายการจากเว็บหลัก TimeOptic) — ไฟล์เดียวกับที่ใช้
           ตั้งบนเซิร์ฟเวอร์ · ตารางมีแถวแล้ว (รวมแถวที่ปิดไว้) จะไม่แตะอีก แอดมินแก้ต่อเองที่หน้าจอ */
        $file = dirname(__DIR__, 2) . '/deploy/bewell-lens-catalog-mock.sql';
        if (is_file($file)) {
            Db::pdo()->exec((string) file_get_contents($file));
        }
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

        /* ช่องทางรับเงินที่ร้านใช้จริง — ถุงเงิน (กรุงไทย) เป็นช่องทางหนึ่ง ไม่ใช่ "อื่น ๆ"
           แถวเดิมที่ยังชื่อ Other ไม่มีใครใช้ จึงเปลี่ยนเป็นถุงเงินได้โดยไม่กระทบข้อมูลเก่า */
        $added = array_merge(
            /* หน้าไหนเป็นคนสร้างรายการรับเงินนี้ — ขั้น "ชำระเงิน" หรือขั้น "ส่งมอบ"
               มีไว้ตรวจย้อนอย่างเดียว ไม่มีตรรกะไหนอ่าน แถวเก่าเป็น null ได้ */
            self::addColumns('payments', [
                'source' => "varchar(20) DEFAULT NULL COMMENT 'payment | delivery'",
            ]),
            self::addColumns('custom_orders', [
                /* ราคาขายของออเดอร์นี้ ไม่ใช่ราคาใน products — ตั้งแยกได้ทีละชิ้น
                   lens_od_price = เลนส์ขวา (R) · lens_os_price = เลนส์ซ้าย (L)
                   ชื่อคอลัมน์ยัง od/os ตาม schema เดิม ส่วนที่ผู้ใช้เห็นเป็น R/L */
                'frame_price'    => 'decimal(10,2) NOT NULL DEFAULT 0',
                'lens_od_price'  => 'decimal(10,2) NOT NULL DEFAULT 0',
                'lens_os_price'  => 'decimal(10,2) NOT NULL DEFAULT 0',
                'options_price'  => 'decimal(10,2) NOT NULL DEFAULT 0',
                /* ชื่อกับ SKU ของเลนส์แยกข้าง — เดิมมี lens_name ใบเดียวใช้ร่วมกันทั้งสอง
                   ตา ซึ่งบอกไม่ได้ว่าข้างไหนเป็นรุ่นอะไรเมื่อสั่งคนละรุ่น เก็บเป็น snapshot
                   ตอนขาย ไม่ใช่ join ทีหลัง เพราะสินค้าใน master เปลี่ยนชื่อได้ */
                'lens_r_name'    => 'varchar(200) DEFAULT NULL',
                'lens_r_sku'     => 'varchar(80) DEFAULT NULL',
                'lens_l_name'    => 'varchar(200) DEFAULT NULL',
                'lens_l_sku'     => 'varchar(80) DEFAULT NULL',
                /* ประเภทกรอบ — คำไทยจาก Lookups::FRAME_TYPES ออเดอร์เก่าเป็น NULL */
                'frame_type'     => 'varchar(40) DEFAULT NULL',
                /* ใบสั่งตัด RX ที่เปิดจากหน้าเคสให้เลนส์ข้างนี้ — id แถว RX_ORDER ในสมุด
                   ฝั่งคลัง กับเลขที่ใบสั่ง · เปิดออเดอร์กลับมาจะได้การ์ดเลนส์เดิม และปุ่ม
                   "ล้าง" รู้ว่าต้องยกเลิกใบไหน · ออเดอร์ที่ไม่ได้สั่งตัดเป็น NULL */
                'lens_r_rx_id'   => 'int(10) unsigned DEFAULT NULL',
                'lens_r_rx_doc'  => 'varchar(100) DEFAULT NULL',
                'lens_l_rx_id'   => 'int(10) unsigned DEFAULT NULL',
                'lens_l_rx_doc'  => 'varchar(100) DEFAULT NULL',
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
                /* ปิดงานผลิต — คนละเรื่องกับส่งมอบ (pickup_at) */
                'completed_at'              => 'datetime DEFAULT NULL',
                'completed_by'              => 'int(10) unsigned DEFAULT NULL',
                /* หยุดรอสินค้า: รออะไร เพราะอะไร ใครสั่งหยุด เมื่อไหร่ */
                'waiting_item'              => 'varchar(20) DEFAULT NULL',
                'waiting_reason'            => 'varchar(255) DEFAULT NULL',
                'paused_at'                 => 'datetime DEFAULT NULL',
                'paused_by'                 => 'int(10) unsigned DEFAULT NULL',
            ]),
            self::addColumns('cases', [
                'closed_by' => 'int(10) unsigned DEFAULT NULL',
                /* ประเภท "งาน" — ตัดแว่นใหม่ / เปลี่ยนเลนส์ / ซ่อม / ตรวจสายตา
                   ตัวเลือกล็อกไว้ที่ Lookups::lists() ไม่ได้อ่านจากค่าที่เคยพิมพ์แล้ว */
                'case_type'     => 'varchar(40) DEFAULT NULL',
                /* ประเภท "ลูกค้า" — sight_first / customer. เคยปนอยู่ใน case_type
                   ซึ่งทำให้ตอบสองคำถามด้วยช่องเดียว: เคส SIGHTFIRST เลยบอกไม่ได้ว่า
                   เป็นงานตัดแว่นใหม่หรือเปลี่ยนเลนส์ ตอนนี้เป็นคนละแกนกัน และ
                   ตัวแบ่งสมุดงาน SightFirst / ลูกค้าร้าน อ่านจากช่องนี้ */
                'customer_category' => 'varchar(20) DEFAULT NULL',
                /* ช่องทางที่รู้จักร้าน เลือก "อื่น ๆ" แล้วพิมพ์เองได้ */
                'referral_note' => 'varchar(255) DEFAULT NULL',
            ]),
            /* อายุที่ลูกค้าบอกมา — สำหรับคนที่ไม่ทราบหรือไม่บอกวันเกิด
             *
             * ทำไมไม่แปลงเป็นวันเกิดปลอม (1 ม.ค. ของปีนั้น) แล้วเก็บช่องเดียว: ค่าที่เดา
             * ขึ้นมาแยกไม่ออกจากวันเกิดจริงในภายหลัง และหน้าที่คิดค่า ADD จะเชื่อมันเต็ม ๆ
             *
             * ทำไมต้องมี age_recorded_on: อายุเป็นค่าที่หมดอายุ · เก็บแค่ "45" ไว้ อีกสามปี
             * หน้าจอก็ยังอ่านว่า 45 · มีวันที่กำกับแล้วคำนวณปีที่ผ่านไปได้ และบอกผู้อ่านได้
             * ด้วยว่าเลขนี้ถามไว้เมื่อไหร่
             *
             * วันเกิดชนะเสมอเมื่อมีทั้งคู่ — ดู lib/customerAge.js */
            self::addColumns('customers', [
                'age_years'       => 'tinyint(3) unsigned DEFAULT NULL',
                'age_recorded_on' => 'date DEFAULT NULL',
            ]),
            /* ขั้นวัด Center บันทึกว่าเมื่อไหร่ และใครเป็นคนกรอก แยกจากใครเป็นคนวัด */
            /* ช่องทางที่เลิกใช้แล้วต้องหายจากตัวเลือก แต่ป้ายชื่อยังต้องอยู่
               ไม่งั้นรายการเก่าจะโชว์เป็นรหัสดิบ */
            self::addColumns('list_pay_type', [
                'is_active' => 'tinyint(1) NOT NULL DEFAULT 1',
            ]),
            /* กุญแจกันตัดซ้ำเวลาเปลี่ยนไปตัดสต็อกผ่าน API ของคลัง —
               ค่าคงที่ต่อรายการเบิก ไม่ใช่ uuid ที่เปลี่ยนทุกครั้งที่ retry */
            self::addColumns('production_withdrawals', [
                'idem_key' => 'varchar(80) DEFAULT NULL',
            ]),
            self::addColumns('centerings', [
                'measured_at' => 'datetime DEFAULT NULL',
                /* Cor. — ความยาว corridor ของเลนส์โปรเกรสซีฟ (mm) ค่าเดียวใช้ทั้งสองข้าง
                   varchar เหมือนค่าการวัดตัวอื่นในตารางนี้ (PD, FH, CVD) ที่เก็บตามที่พิมพ์
                   บน Hostinger ไม่มีอะไรเรียก run() ต้องสั่งเพิ่มเอง — ดู deploy/README.md */
                'corridor'    => 'varchar(20) DEFAULT NULL',
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
                /* ตาหลัก / ตารอง — 'r' | 'l' | 'both' | NULL (ยังไม่ได้ระบุ)
                   'both' คือสองข้างเด่นเท่ากัน ไม่ใช่ "ติ๊กไว้ทั้งคู่" คนละความหมายกับว่าง */
                'dominant_eye'         => "varchar(10) DEFAULT NULL COMMENT 'r | l | both'",
            ]),
            /* บล็อกลูกค้าที่พิมพ์ลงใบนั้นจริง — สำเนา ไม่ใช่ JOIN กลับไปที่ bill_parties
               ใบเสร็จเป็นเอกสารภาษี ลูกค้าย้ายบ้านแล้วมาแก้ที่อยู่ในรายชื่อ ใบที่ออก
               ไปแล้วต้องยังพิมพ์ที่อยู่ ณ วันที่ออกออกมาได้เหมือนเดิม

               แถวเก่าเป็น null แปลว่า "ไม่รู้ว่าตอนนั้นพิมพ์อะไรลงไป" ซึ่งเป็นความจริง
               ก่อนหน้านี้ช่องสี่ช่องอยู่ใน useState ของหน้าเว็บ ไม่เคยถูกเก็บที่ไหนเลย

               bill_party_id ไม่ผูก FK โดยตั้งใจ ด้วยเหตุผลเดียวกับ activity_log.actor_id:
               ลบนามทิ้งจากรายชื่อแล้ว ใบที่เคยออกต้องอ่านออกเหมือนเดิม */
            self::addColumns('receipts', [
                'bill_name'     => "varchar(200) DEFAULT NULL COMMENT 'ชื่อบนใบ ณ วันที่ออก'",
                'bill_tax_id'   => 'varchar(30)  DEFAULT NULL',
                'bill_address'  => 'varchar(255) DEFAULT NULL',
                'bill_phone'    => 'varchar(40)  DEFAULT NULL',
                'bill_party_id' => "int(10) unsigned DEFAULT NULL COMMENT 'bill_parties.id — ไม่ผูก FK โดยตั้งใจ'",
            ])
        );
        /* "ยังไม่ชำระ" — รายการรับเงิน 0 บาท ลูกค้าจะมาจ่ายตอนรับของ (ร้านขอ 14 ก.ย. 2026)
           บน Hostinger ไม่มีอะไรเรียก run() ต้องสั่งเพิ่มเอง — ดู deploy/README.md */
        $added = array_merge($added, self::extendEnum('payments', 'kind', ['unpaid'], "NOT NULL DEFAULT 'deposit'"));

        /* Bewell: ใบเบิกเลนส์ = บันทึกการใช้เลนส์ (Lens Usage) — ดู services/LensRequisition.php
           ค่าเลนส์ในรายการเป็นสำเนา ณ วันที่ขาย แอดมินแก้ชื่อหรือราคาใน lens_catalog ทีหลัง
           ใบเก่าต้องไม่เปลี่ยนตาม · lens_catalog_id ไม่ผูก FK โดยตั้งใจ ด้วยเหตุผลเดียวกัน */
        $added = array_merge(
            $added,
            self::addColumns('lens_requisition_items', [
                'lens_catalog_id' => "int(10) unsigned DEFAULT NULL COMMENT 'lens_catalog.id — ไม่ผูก FK โดยตั้งใจ'",
                'lens_code'       => 'varchar(40)  DEFAULT NULL',
                'lens_name'       => 'varchar(160) DEFAULT NULL',
                'cost_price'      => "decimal(12,2) DEFAULT NULL COMMENT 'ต้นทุนต่อหน่วย ณ วันที่ขาย'",
            ]),
            self::addColumns('lens_requisitions', [
                /* ใช้เลนส์จริง = ยืนยันขั้นขายแล้ว (จังหวะเดียวกับที่ตัดสต็อกกรอบ) · NULL = ยังเป็นแค่ร่าง */
                'used_at'       => 'datetime DEFAULT NULL',
                'used_by'       => 'int(10) unsigned DEFAULT NULL',
                /* ใครยกเลิก และยกเลิกเพราะอะไร — ไม่มีการลบใบทิ้ง */
                'cancelled_by'  => 'int(10) unsigned DEFAULT NULL',
                'cancel_source' => "varchar(30) DEFAULT NULL COMMENT 'manual | order_deleted | case_cancelled'",
                /* เลขออเดอร์ ณ วันที่ออกใบ — ลบออเดอร์ทิ้งแล้ว order_id เป็น NULL แต่ยังย้อนดูได้ว่าใบไหน */
                'order_ref'     => 'varchar(30) DEFAULT NULL',
            ])
        );
        $added = array_merge($added, self::addColumns('lens_catalog', [
            'sph'       => 'varchar(10) DEFAULT NULL AFTER brand',
            'cyl'       => 'varchar(10) DEFAULT NULL AFTER sph',
            'add_power' => 'varchar(10) DEFAULT NULL AFTER cyl',
        ]));
        self::seedLensCatalog();
        /* ใบที่ออกก่อนมีช่อง order_ref — จำเลขออเดอร์ไว้ตอนที่ออเดอร์ยังอยู่ */
        Db::run(
            'UPDATE lens_requisitions lr JOIN custom_orders o ON o.id = lr.order_id
                SET lr.order_ref = o.invoice_code WHERE lr.order_ref IS NULL'
        );

        /* Views come after addColumns, not before: v_case_board selects columns that
           addColumns() is what puts there, so on a database that has not seen this
           release yet, building the view first fails on its own migration. */
        foreach (self::views() as $sql) {
            Db::pdo()->exec($sql);
        }

        self::reshapeCaseStatuses();
        self::splitCustomerCategoryOutOfCaseType();
        /* พร้อมเพย์ / QR ไม่ได้ใช้แล้ว — ซ่อนจากตัวเลือก แต่แถวยังอยู่ให้ประวัติอ่านออก */
        Db::run("UPDATE list_pay_type SET is_active = 0 WHERE code = 'QR'");

        if (Db::get("SELECT COUNT(*) n FROM list_pay_type WHERE code = 'ThungNgern'")['n'] == 0) {
            $usedOther = (int) Db::get("SELECT COUNT(*) n FROM payments WHERE method = 'Other'")['n'];
            if ($usedOther === 0) {
                Db::run("DELETE FROM list_pay_type WHERE code = 'Other'");
            }
            Db::run(
                "INSERT INTO list_pay_type (code, label_th, sort_order) VALUES (?,?,?)",
                'ThungNgern',
                'ถุงเงิน',
                5
            );
        }

        $created = array_merge($created, $added);
        foreach (self::DEFAULT_SETTINGS as $key => $value) {
            Db::run('INSERT IGNORE INTO app_settings (`key`, `value`) VALUES (?, ?)', $key, $value);
        }
        return $created;
    }
}
