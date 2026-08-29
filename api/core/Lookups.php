<?php
/**
 * Dropdown sources. Most live in the schema's list_* tables; the free-text
 * columns offer whatever the shop has actually typed before, with a sensible
 * starter set when a table is still empty.
 */
declare(strict_types=1);

final class Lookups
{
    private const LIST_TABLES = [
        'sex'          => 'list_sex',
        'marketing'    => 'list_marketing',
        'pay_type'     => 'list_pay_type',
        'product_type' => 'list_product_type',
        'len_type'     => 'list_len_type',
    ];

    public static function lists(): array
    {
        $out = [];
        foreach (self::LIST_TABLES as $kind => $table) {
            $hasActive = Db::get(
                'SELECT COUNT(*) n FROM information_schema.columns
                  WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
                $table,
                'is_active'
            );
            $active = (int) ($hasActive['n'] ?? 0) ? ' AND is_active = 1' : '';
            $rows = Db::all("SELECT code, label_th FROM `$table` ORDER BY sort_order, code");
            /* ตัวเลือกที่ยังให้เลือกได้ กับป้ายชื่อของทุกค่าที่เคยมี — คนละชุดกัน
               รายการเก่าที่ใช้ช่องทางที่เลิกใช้แล้วจึงยังอ่านออก */
            $offered = Db::all("SELECT code FROM `$table` WHERE 1=1$active ORDER BY sort_order, code");
            $out[$kind] = array_map(fn($r) => $r['code'], $offered);
            $labels = [];
            foreach ($rows as $r) {
                $labels[$r['code']] = $r['label_th'];
            }
            $out[$kind . '_labels'] = (object) $labels;
        }

        $col = fn(array $rows) => array_map(fn($r) => $r['c'], $rows);

        $out['expense_type'] = $col(Db::all(
            "SELECT DISTINCT expense_type c FROM expenses
              WHERE expense_type IS NOT NULL AND expense_type <> '' ORDER BY c"
        ));
        $out['income_type'] = $col(Db::all(
            "SELECT DISTINCT income_type c FROM incomes
              WHERE income_type IS NOT NULL AND income_type <> '' ORDER BY c"
        ));
        $out['branch'] = array_values(array_unique(array_merge(
            $col(Db::all("SELECT DISTINCT branch c FROM expenses WHERE branch <> '' ORDER BY c")),
            $col(Db::all("SELECT DISTINCT branch c FROM incomes  WHERE branch <> '' ORDER BY c"))
        )));

        if (!$out['expense_type']) {
            $out['expense_type'] = ['เลนส์', 'ค่าขนส่ง', 'จิปาถะ', 'ตกแต่ง', 'สินค้าแว่น',
                'คอนแทคเลนส์', 'ซ่อมบำรุง', 'ค่าเช่า', 'ค่าทำบัญชี', 'Internet', 'โทรศัพท์', 'เงินเดือน'];
        }
        if (!$out['income_type']) {
            $out['income_type'] = ['ค่าเช่า', 'ประกันสังคม', 'อื่นๆ'];
        }
        if (!$out['branch']) {
            $out['branch'] = ['Timeoptic', 'ส่วนตัว'];
        }

        /**
         * สามคำถามที่หน้าเปิดเคสถามแยกกัน และเคยปนกันอยู่ในช่องเดียว
         *
         *   case_type          งานชิ้นนี้คืองานอะไร
         *   customer_category  ลูกค้ารายนี้มาจากไหน — SightFirst หรือลูกค้าร้าน
         *   referral_source    รู้จักร้านจากช่องทางไหน (รายละเอียดพิมพ์ที่ referral_note)
         *
         * ทั้งสามชุดล็อกไว้ในโค้ด ไม่ได้เอาค่าที่เคยพิมพ์ใน DB มารวมเป็นตัวเลือกด้วย —
         * ไม่งั้นค่าที่เพิ่งย้ายออกไปจะโผล่กลับมาให้เลือกใหม่ทุกครั้ง
         */
        $out['case_type'] = ['ตัดแว่นใหม่', 'เปลี่ยนเลนส์', 'ซ่อม/ปรับแว่น', 'ตรวจสายตา'];

        $out['customer_category'] = [
            ['sight_first', 'Sight First'],
            ['customer', 'ลูกค้า'],
        ];

        $out['referral_source'] = [
            ['fb_ig_tt', 'FB / IG / TT'],
            ['line', 'Line'],
            ['ai', 'AI'],
            ['google', 'Google'],
            ['walk_in', 'Walk In'],
            ['other', 'อื่นๆ'],
        ];

        $out['test_for']     = ['Distance', 'Reading', 'Progressive', 'Bi-focal'];
        /* ค่าแว่นเดิมมาได้ 3 ทางเท่านั้น (ตรงกับแอปเดิม lib/migrate.js) */
        $out['rx_source_old'] = [
            ['history', 'ดึงจากประวัติในระบบ'],
            ['lensmeter', 'วัดจากแว่นเดิม (lensmeter)'],
            ['external_rx', 'ใบ Prescription จากภายนอก'],
        ];
        $out['rx_source_measured'] = [
            ['refraction', 'ตรวจวัดด้วยนักทัศนมาตร (refraction)'],
            ['autorefractor', 'เครื่องวัดอัตโนมัติ (auto-refractor)'],
            ['contact_lens', 'ค่าจากคอนแทคเลนส์เดิม'],
            ['other', 'อื่น ๆ'],
        ];
        $out['old_glasses_type'] = [
            ['single', 'Single Lens — ชั้นเดียว'],
            ['bifocal', 'Bi-Focal — สองชั้น'],
            ['progressive', 'Progressive — โปรเกรสซีฟ'],
        ];
        $out['payment_kind'] = ['deposit', 'partial', 'final', 'full'];
        $out['lens_source']  = ['stock', 'order'];
        return $out;
    }

    public static function caseStatuses(): array
    {
        return Db::all(
            'SELECT code, stage_no, label_th, label_en, stage_group, sort_order,
                    is_waiting, is_terminal
               FROM case_statuses ORDER BY sort_order'
        );
    }
}
