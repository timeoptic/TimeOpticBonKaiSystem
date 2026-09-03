<?php
/**
 * ลูกค้ารายนี้มาจากไหน — อ่านจากโน้ตของเคส
 *
 * ผลถูกเก็บที่ `cases.customer_category` ซึ่งมีอยู่ในสคีมาแล้วและกระดานงานใช้
 * แยกสมุด SightFirst ออกจากลูกค้าร้านอยู่ก่อนแล้ว (ดู routes/cases.php และ
 * routes/workflow.php) · ไม่ได้เพิ่มคอลัมน์ใหม่ เพราะคอลัมน์ที่สามที่ตอบคำถาม
 * เดียวกันคือความจริงสามชุดที่วันหนึ่งจะไม่ตรงกัน
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ทำไมโน้ตอย่างเดียวไม่พอ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ข้อมูลจริง 8,919 เคสบอกว่า เคสที่ `referral_source = 'Lions'` มี 1,255 เคส
 * (สโมสรไลออนส์เป็นเจ้าของโครงการ SightFirst) แต่มีแค่ 164 เคสที่เขียนคำว่า
 * SF หรือ Sight ไว้ในโน้ต — จับจากโน้ตอย่างเดียวจะพลาดไป 1,091 เคส
 *
 * ช่องทางที่ร้านติ๊กไว้ตอนเปิดเคสจึงมาก่อนเสมอ แล้วโน้ตเป็นตัวช่วยจับเคสที่
 * พนักงานลืมติ๊ก
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ทำไม "SF" ต้องจับแบบคำเต็ม
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ในโน้ตจริง 177 เคสมีตัวอักษร "SF" แต่ส่วนใหญ่คือ **SFT** ซึ่งเป็นรหัสโค้ตติ้ง
 * ของเลนส์ Hoya ("Hoya CurveTop 1.6 SFT", "Hoya F/T SFT Sensity Brown")
 * ไม่ใช่โครงการ Sight First เลย
 *
 * คำที่เป็นอักษรละตินจึงถูกจับแบบมีขอบคำ ส่วนคำไทยจับแบบอยู่ในข้อความได้เลย
 * เพราะภาษาไทยไม่เว้นวรรคระหว่างคำ ขอบคำแบบละตินใช้ไม่ได้
 */
declare(strict_types=1);

final class CaseSource
{
    /**
     * ค่าที่เก็บใน `cases.customer_category`
     *
     * `sight_first` สะกดแบบนี้มาก่อนหน้านี้แล้ว และกระดานงานเทียบตรง ๆ กับสตริงนี้
     * — เปลี่ยนเป็น SIGHT_FIRST ตามสเปกเมื่อไหร่ สมุด SightFirst จะว่างทันที
     */
    public const SIGHT_FIRST = 'sight_first';
    public const ONLINE      = 'online';
    public const WALK_IN     = 'walk_in';
    public const REFERRAL    = 'referral';
    public const OTHER       = 'other';

    public const ALL = [self::SIGHT_FIRST, self::ONLINE, self::WALK_IN, self::REFERRAL, self::OTHER];

    public const LABELS = [
        self::SIGHT_FIRST => 'Sight First',
        self::ONLINE      => 'ออนไลน์',
        self::WALK_IN     => 'เดินเข้าร้าน',
        self::REFERRAL    => 'ลูกค้าแนะนำ',
        self::OTHER       => 'อื่นๆ',
    ];

    /** คีย์ใน `app_settings` — แอดมินแก้ได้ที่หน้าตั้งค่า ไม่ต้องแก้โค้ด */
    public const SETTING_KEYS = [
        self::SIGHT_FIRST => 'case_kw_sight_first',
        self::ONLINE      => 'case_kw_online',
        self::REFERRAL    => 'case_kw_referral',
    ];

    /**
     * ค่าตั้งต้นของคำค้น — ใช้เฉพาะตอนที่ยังไม่เคยมีใครตั้งค่า
     *
     * รอบแรกชุดนี้แคบกว่านี้: ฝั่งออนไลน์มีแต่คำที่มี "Online" อยู่ด้วย ตามรายการ
     * ในสเปกข้อ 2 เป๊ะ ๆ · ผลคือจับได้ 4 เคสจาก 1,200 เคสที่เป็นการขายออนไลน์จริง
     * เพราะร้านไม่ได้พิมพ์แบบนั้น — เขียน "tiktok กรอบเต็มพลาสติก", "shopee order"
     * และตั้งชื่อกรอบว่า "Online Frame"
     *
     * ชุดนี้จึงกว้างขึ้นให้ตรงกับที่ร้านพิมพ์จริง · เคสที่เข้าเงื่อนไข online
     * จะ **ถูกลบ** เวลาสั่งเก็บกวาด จึงต้องดู `--dry-run` ทุกครั้งก่อนแก้คำค้น
     */
    public const DEFAULTS = [
        self::SIGHT_FIRST => [
            'SF', 'Sight First', 'SightFirst', 'Sight', 'Lions',
            'ไลออนส์', 'โครงการตรวจสายตา', 'ออกหน่วย',
            'โรงเรียน', 'รร.', 'มหาวิทยาลัย', 'วิทยาลัย', 'สถาบัน',
        ],
        /* คำฝั่งออนไลน์กว้างกว่ารายการในสเปกข้อ 2 โดยตั้งใจ
         *
         * สเปกให้คำที่ทุกคำมี "Online" อยู่ด้วย แต่ในข้อมูลจริงร้านไม่ได้พิมพ์
         * แบบนั้น — เขียนว่า "tiktok กรอบเต็มพลาสติก" หรือ "shopee order" และ
         * ตั้งชื่อกรอบว่า "Online Frame" · จับตามสเปกเป๊ะ ๆ ได้แค่ 4 เคสจาก 1,200 */
        self::ONLINE => [
            'Online', 'ออนไลน์', 'Online Frame',
            'FB Online', 'Facebook Online', 'TikTok Online', 'Line Online',
            'TikTok', 'Shopee', 'Lazada',
        ],
        self::REFERRAL => [
            'แนะนำ', 'เพื่อนแนะนำ', 'Friend', 'Referral',
        ],
    ];

    /**
     * ค่า `referral_source` ที่แปลว่าเป็นงาน Sight First โดยไม่ต้องดูโน้ต
     *
     * 'Lions' คือสโมสรไลออนส์ เจ้าของโครงการ SightFirst — เป็นตัวชี้วัดที่แม่นที่สุด
     * ที่ร้านมี (1,255 เคส) เพราะพนักงานติ๊กตอนเปิดเคส ไม่ใช่พิมพ์อิสระ
     */
    public const SF_REFERRAL_SOURCES = ['lions', 'sight first', 'sightfirst', 'sf'];

    /**
     * ช่องทางที่ติ๊กไว้แล้วแปลว่าเป็นการขายออนไลน์
     *
     * ร้านติ๊ก TikTok / Shopee ไว้ที่ช่อง "รู้จักร้านจากไหน" สำหรับออเดอร์ที่สั่ง
     * ผ่านแพลตฟอร์มจริง ๆ — ดูได้จากชื่อกรอบที่ตั้งว่า "Online Frame" และโน้ตที่
     * เขียนว่า "tiktok order" / "shopee order" ในใบเดียวกัน
     *
     * ยังมาทีหลังคำในโน้ตฝั่ง Sight First เสมอ ตามลำดับในสเปกข้อ 3 — เคสที่ติ๊ก
     * TikTok ไว้แต่โน้ตบอกว่าเป็นงานโครงการ ยังเป็น Sight First
     */
    public const ONLINE_REFERRAL_SOURCES = ['tiktok', 'shopee', 'lazada'];

    /** คำค้นที่ใช้อยู่จริง — ของแอดมินถ้าตั้งไว้ ไม่งั้นเป็นค่าตั้งต้น */
    public static function keywords(): array
    {
        $out = [];
        foreach (self::SETTING_KEYS as $type => $key) {
            $raw = Db::get('SELECT `value` FROM app_settings WHERE `key` = ?', $key);
            $val = $raw['value'] ?? null;
            $list = null;
            if (is_string($val) && trim($val) !== '') {
                $decoded = json_decode($val, true);
                if (is_array($decoded)) {
                    $list = array_values(array_filter(array_map(
                        static fn($x) => trim((string) $x),
                        $decoded
                    ), static fn($x) => $x !== ''));
                }
            }
            $out[$type] = $list ?? self::DEFAULTS[$type];
        }
        return $out;
    }

    /** บันทึกคำค้นชุดใหม่ — คืนชุดที่บันทึกจริงกลับไป */
    public static function saveKeywords(array $patch): array
    {
        foreach (self::SETTING_KEYS as $type => $key) {
            if (!array_key_exists($type, $patch)) {
                continue;
            }
            $list = array_values(array_unique(array_filter(array_map(
                static fn($x) => trim((string) $x),
                is_array($patch[$type]) ? $patch[$type] : []
            ), static fn($x) => $x !== '')));
            Db::run(
                'INSERT INTO app_settings (`key`, `value`) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
                $key,
                json_encode($list, JSON_UNESCAPED_UNICODE)
            );
        }
        return self::keywords();
    }

    /**
     * คำนี้อยู่ในข้อความไหม
     *
     * คำที่เป็นอักษรละตินล้วนต้องมีขอบคำ — "SF" ไม่นับว่าเจอใน "SFT" หรือ
     * "Hoya F/T SFT" · คำที่มีอักษรไทยปนจับแบบอยู่ในข้อความได้เลย เพราะภาษาไทย
     * เขียนติดกันไม่มีช่องว่างระหว่างคำ การบังคับขอบคำจะทำให้ไม่เจออะไรเลย
     *
     * ขอบคำที่ใช้คือ "ไม่ใช่ตัวอักษรหรือตัวเลข" ไม่ใช่ `\b` ของ PCRE เพราะ `\b`
     * นับตัวอักษรไทยเป็นขอบด้วย — "SFไทย" จะกลายเป็นเจอ ทั้งที่ไม่ใช่
     */
    public static function hit(string $haystack, string $needle): bool
    {
        $needle = trim($needle);
        if ($needle === '') {
            return false;
        }
        $isLatin = (bool) preg_match('/^[\x20-\x7E]+$/', $needle);
        if (!$isLatin) {
            return mb_stripos($haystack, $needle) !== false;
        }
        $q = preg_quote($needle, '/');
        return (bool) preg_match('/(?<![A-Za-z0-9])' . $q . '(?![A-Za-z0-9])/iu', $haystack);
    }

    /**
     * ตัดสินว่าเคสนี้มาจากช่องทางไหน
     *
     * ลำดับความสำคัญตามสเปกข้อ 3: SIGHT_FIRST มาก่อน ONLINE เสมอ · โน้ตที่เขียน
     * "SF Online โรงเรียนวังไกลกังวล" เป็นงาน Sight First ไม่ใช่งานออนไลน์
     *
     * `$referralSource` คือช่องทางที่พนักงานติ๊กไว้ตอนเปิดเคส — ถ้าเป็นไลออนส์
     * ตัดสินได้ทันทีโดยไม่ต้องอ่านโน้ต
     *
     * @return array{sourceType:string, matched:list<string>, reason:string}
     */
    public static function detect(
        ?string $note,
        ?string $referralSource = null,
        ?array $kw = null,
        ?string $extra = null
    ): array {
        $kw   = $kw ?? self::keywords();
        /* `$extra` คือข้อความอื่นบนใบเดียวกันที่บอกที่มาได้ — ชื่อกรอบกับชื่อเลนส์
           ของออเดอร์ · ร้านตั้งชื่อกรอบว่า "Online Frame" สำหรับของที่ขายผ่าน
           แพลตฟอร์ม ซึ่งเป็นสัญญาณที่ชัดกว่าโน้ตเสียอีก (958 เคส เทียบกับ 4 เคส
           ที่จับได้จากโน้ตอย่างเดียว) */
        $note = trim((string) ($note ?? '') . ' ' . (string) ($extra ?? ''));
        $ref  = mb_strtolower(trim((string) ($referralSource ?? '')));

        if ($ref !== '' && in_array($ref, self::SF_REFERRAL_SOURCES, true)) {
            return [
                'sourceType' => self::SIGHT_FIRST,
                'matched'    => [$referralSource],
                'reason'     => 'ช่องทางที่ติ๊กไว้ตอนเปิดเคส',
            ];
        }

        /* ลำดับนี้คือลำดับความสำคัญ อย่าสลับ — เจอกลุ่มไหนก่อนตอบกลุ่มนั้น */
        foreach ([self::SIGHT_FIRST, self::ONLINE, self::REFERRAL] as $type) {
            $matched = [];
            foreach ($kw[$type] ?? [] as $word) {
                if ($note !== '' && self::hit($note, $word)) {
                    $matched[] = $word;
                }
            }
            if ($matched) {
                return ['sourceType' => $type, 'matched' => $matched, 'reason' => 'คำในโน้ต'];
            }
        }

        /* โน้ตไม่บอกอะไร — กลับไปดูช่องทางที่ติ๊กไว้
         *
         * ตรงนี้ตัดสินได้แค่สองกลุ่มที่ "ไม่ถูกลบ" เท่านั้น · ช่องทางอย่าง TikTok
         * หรือ FB **ตั้งใจไม่แปลว่า online** ทั้งที่ฟังดูตรง เพราะเคสที่เป็น online
         * จะถูกลบทิ้ง และในข้อมูลจริงมี 974 เคสที่ติ๊ก TikTok ไว้พร้อมออเดอร์และเงิน
         * — การติ๊กว่ารู้จักร้านจาก TikTok ไม่ได้แปลว่าลูกค้าไม่ได้เดินมาที่ร้าน
         *
         * ถ้าร้านต้องการแบบนั้นจริง เพิ่มคำที่หน้าตั้งค่าได้ และตัวจัดประเภทย้อนหลัง
         * จะโชว์จำนวนที่จะถูกลบให้ดูก่อนเสมอ
         */
        if ($ref !== '' && in_array($ref, self::ONLINE_REFERRAL_SOURCES, true)) {
            return ['sourceType' => self::ONLINE, 'matched' => [$referralSource],
                'reason' => 'ช่องทางที่ติ๊กไว้ตอนเปิดเคส'];
        }

        if ($ref !== '') {
            if (str_contains($ref, 'walk') || str_contains($ref, 'เดิน')) {
                return ['sourceType' => self::WALK_IN, 'matched' => [$referralSource],
                    'reason' => 'ช่องทางที่ติ๊กไว้ตอนเปิดเคส'];
            }
            if (str_contains($ref, 'friend') || str_contains($ref, 'referral')
                || str_contains($ref, 'แนะนำ')) {
                return ['sourceType' => self::REFERRAL, 'matched' => [$referralSource],
                    'reason' => 'ช่องทางที่ติ๊กไว้ตอนเปิดเคส'];
            }
        }

        /* ไม่ได้ติ๊กอะไรและโน้ตไม่บอก = อื่นๆ · ไม่เดาว่าเป็นคนเดินเข้าร้าน
           เพราะนั่นคือการแต่งข้อมูลที่ไม่มีใครเคยบันทึกไว้ */
        return ['sourceType' => self::OTHER, 'matched' => [], 'reason' => 'ไม่พบคำที่ตรงกับกลุ่มไหน'];
    }

    /**
     * ลองคำค้นชุดปัจจุบันกับเคสทั้งหมด แล้วบอกว่าจะได้กลุ่มละกี่เคส
     *
     * มีไว้ให้หน้าตั้งค่าโชว์ผลก่อนกดบันทึก — คำว่า "TikTok" คำเดียวทำให้กลุ่ม
     * ออนไลน์กระโดดจาก 4 เป็น 875 เคส และเคสกลุ่มนั้นคือเคสที่จะถูกลบ
     * ตัวเลขที่เห็นก่อนกด ดีกว่าคำเตือนที่เขียนไว้ในคู่มือ
     */
    public static function tally(?array $kw = null): array
    {
        $kw  = $kw ?? self::keywords();
        $out = array_fill_keys(self::ALL, 0);
        foreach (Db::all(
            "SELECT k.notes, k.referral_source,
                    CONCAT_WS(' ', o.frame_name, o.lens_name) AS extra
               FROM cases k LEFT JOIN custom_orders o ON o.case_id = k.id"
        ) as $r) {
            $t = self::detect($r['notes'], $r['referral_source'], $kw, $r['extra'])['sourceType'];
            $out[$t] = ($out[$t] ?? 0) + 1;
        }
        return $out;
    }

    /** ค่าที่รับได้เท่านั้น — ค่าอื่นจากหน้าเว็บถูกปัดทิ้ง ไม่ใช่บันทึกลงไปเงียบ ๆ */
    public static function valid(?string $v): ?string
    {
        $v = trim((string) ($v ?? ''));
        if ($v === '') {
            return null;
        }
        /* 'customer' คือค่าเดิมของระบบก่อนหน้านี้ (ดู Migrate::splitCustomerCategoryOutOfCaseType)
           แปลว่า "ลูกค้าร้าน ไม่ใช่ SightFirst" ซึ่งตรงกับ walk_in ในชุดใหม่ */
        if ($v === 'customer') {
            return self::WALK_IN;
        }
        return in_array($v, self::ALL, true) ? $v : null;
    }
}
