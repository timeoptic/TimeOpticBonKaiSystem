<?php

declare(strict_types=1);

namespace Optic;

/**
 * The one place that answers "who may do what".
 *
 * A person's `job_title` ("technician", "reception,sales") describes the work
 * they do and is never consulted here. Permission comes from the roles an owner
 * sets deliberately. Conflating the two is how a new technician quietly ends up
 * able to edit prices.
 *
 * ── หนึ่งคนถือได้หลายบทบาท ────────────────────────────────────────────────
 * ทุกฟังก์ชันในไฟล์นี้รับ **รายการ** บทบาท ไม่ใช่บทบาทเดียว และสิทธิ์ที่ได้คือ
 * ยูเนียนของทุกบทบาทที่ถือ · ผู้จัดการที่ขายหน้าร้านด้วยดูแลระบบด้วยจึงถือ
 * sales + admin ได้ตรง ๆ แทนที่จะต้องเลือกอย่างเดียวแล้วเปิดบัญชีที่สองไว้ทำอีกอย่าง
 *
 * ── ทำไมเลิกใช้บันไดยศตัดสินสิทธิ์ ────────────────────────────────────────
 * เดิมทุกคำถามตอบด้วย `rank($role) >= rank(ADMIN)` ซึ่งอ่านง่ายตราบใดที่สิทธิ์
 * ซ้อนกันเป็นชั้นจริง · โจทย์สองข้อทำให้ไม่จริงอีกต่อไป:
 *
 *   · แอดมิน **เห็น** ต้นทุนได้ แต่ **กรอก** ไม่ได้ — สองคำถามนี้เคยเป็นเงื่อนไข
 *     เดียวกัน ถ้าอันหลังขยับไปเป็นเจ้าของร้านเท่านั้น บันไดต้องมีเงื่อนไขเฉพาะกิจ
 *     แทรก แล้วมันจะไม่ใช่บันไดอีกต่อไป แต่ยังหน้าตาเหมือนบันได
 *   · `case.view_all` ไม่ใช่เรื่องยศเลย — พนักงานคลังยศเท่าพนักงานขาย แต่ไม่มี
 *     สิทธิ์นี้ เพราะทำงานคนละฝั่ง ไม่ใช่เพราะอยู่ต่ำกว่า
 *
 * สิทธิ์จึงมีชื่อของตัวเอง (`PERMS`) และบทบาทคือชุดของชื่อพวกนั้น (`GRANTS`)
 * `rank` ยังอยู่ แต่เหลืองานเดียว: ตอบว่าใครตั้งบทบาทให้ใครได้ ซึ่งเป็นงานที่
 * docblock ของมันเขียนไว้แต่แรกอยู่แล้ว
 */
final class Roles
{
    /** ผม/ผู้ดูแลระบบ — ทุกอย่างที่เจ้าของร้านทำได้ บวกงานระบบที่ร้านไม่ต้องยุ่ง */
    public const SUPERUSER = 'superuser';
    public const OWNER = 'owner';
    /** แอดมินของทั้งสองฝั่ง — จัดการผู้ใช้ แดชบอร์ด เห็นต้นทุน แต่กรอกต้นทุนไม่ได้ */
    public const ADMIN = 'admin';
    /** พนักงานขายหน้าร้าน — เข้าระบบแล้วอยู่ฝั่งหน้าร้าน */
    public const SALES = 'sales';
    /** เด็กฝึกงานหน้าร้าน — ชุดสิทธิ์เดียวกับพนักงานขายทุกช่อง ต่างกันแค่ป้าย */
    public const TRAINEE = 'trainee';
    /** พนักงานคลัง — เข้าระบบแล้วอยู่ฝั่งคลัง */
    public const STOCK = 'stock';
    /**
     * บัญชี — อ่านเงินของร้าน ไม่ได้เป็นคนทำให้ตัวเลขเกิด
     *
     * ไม่มี `frontdesk.use` จึงเดินได้เฉพาะเส้นทางกลุ่มการเงินของ `/api` (ดูด่าน
     * ที่สองใน `api/index.php`) และไม่มี `stock.move` เพราะคนที่ตรวจตัวเลขกับคน
     * ที่ทำให้ตัวเลขเกิดไม่ควรเป็นคนเดียวกัน — ต้องการทั้งสองอย่างก็ให้สองบทบาท
     */
    public const ACCOUNTING = 'accounting';

    public const ALL = [
        self::SUPERUSER, self::OWNER, self::ADMIN,
        self::SALES, self::TRAINEE, self::STOCK, self::ACCOUNTING,
    ];

    /** ชื่อที่ใช้เป็นแท็กในตารางผู้ใช้ — สั้น ไม่ตัดบรรทัดเวลามีหลายอัน */
    public const NAME = [
        self::SUPERUSER => 'Superuser',
        self::OWNER     => 'Owner',
        self::ADMIN     => 'Admin',
        self::SALES     => 'Sales',
        self::TRAINEE   => 'Trainee Staff',
        self::STOCK     => 'Stock',
        self::ACCOUNTING => 'Accounting',
    ];

    public const LABEL = [
        self::SUPERUSER => 'ผู้ดูแลระบบ',
        self::OWNER     => 'เจ้าของร้าน',
        self::ADMIN     => 'แอดมิน',
        self::SALES     => 'พนักงานขาย',
        self::TRAINEE   => 'พนักงานฝึกหัด',
        self::STOCK     => 'พนักงานคลัง',
        self::ACCOUNTING => 'บัญชี',
    ];

    /** คำอธิบายหนึ่งบรรทัดข้างเช็กบ็อกซ์ตอนกำหนดสิทธิ์ */
    public const NOTE = [
        self::SUPERUSER => 'ทุกอย่างของเจ้าของร้าน บวกงานระบบ',
        self::OWNER     => 'เห็นและทำได้ทุกอย่างในร้าน รวมถึงต้นทุน',
        self::ADMIN     => 'ทุกระบบ เห็นต้นทุนได้ แต่กรอก/แก้ต้นทุนไม่ได้',
        self::SALES     => 'ระบบหน้าร้านทั้งหมด และดูเคสลูกค้าได้ทุกใบ',
        self::TRAINEE   => 'เหมือนพนักงานขายทุกอย่าง — ป้ายไว้ให้รายงานอ่านออก',
        self::STOCK     => 'เฉพาะระบบคลัง ไม่เห็นเคสลูกค้าและไม่เห็นต้นทุน',
        self::ACCOUNTING => 'การเงินและรายงาน เห็นต้นทุน — ไม่แตะผู้ใช้ ตั้งค่า และการบันทึกสต็อก',
    ];

    /**
     * ลำดับสิทธิ์ ใช้ตอบคำถามเดียว: ใครตั้งบทบาทให้ใครได้
     *
     * ไม่ได้แปลว่าบทบาทที่สูงกว่าทำได้ทุกอย่างของบทบาทที่ต่ำกว่า — คำตอบนั้นอยู่ที่
     * `GRANTS` ข้างล่าง · ตัวเลขนี้มีไว้กันการยกระดับตัวเอง: แอดมินตั้งใครเป็น
     * เจ้าของร้านหรือผู้ดูแลระบบไม่ได้ ไม่งั้นสิทธิ์ "จัดการผู้ใช้" กลายเป็นสิทธิ์
     * "เป็นอะไรก็ได้" ในสองคลิก
     *
     * ขาย ฝึกหัด คลัง และบัญชีอยู่ระดับเดียวกัน — คนละงาน ไม่ใช่คนละชั้น ·
     * บัญชีเห็นตัวเลขที่พนักงานขายไม่เห็น แต่นั่นคือสิทธิ์ ไม่ใช่ยศ
     */
    private const RANK = [
        self::SUPERUSER  => 4,
        self::OWNER      => 3,
        self::ADMIN      => 2,
        self::SALES      => 1,
        self::TRAINEE    => 1,
        self::STOCK      => 1,
        self::ACCOUNTING => 1,
    ];

    /* ─────────────────────────────────────────────────────────── สิทธิ์ */

    /**
     * สิทธิ์ทั้งหมดที่ระบบรู้จัก → [กลุ่ม, สิ่งที่ทำได้, เหตุผลที่กันไว้]
     *
     * ลำดับในนี้คือลำดับที่ตารางสิทธิ์บนหน้าจอแสดง และกลุ่มถูกอ่านจากช่องแรก
     * ไม่ได้ประกาศแยก — ตารางสองชุดที่ต้องเรียงให้ตรงกันเองคือตารางที่วันหนึ่ง
     * จะไม่ตรงกัน
     */
    private const PERMS = [
        'frontdesk.use' => ['การเข้าถึงระบบ', 'ระบบหน้าร้าน — รับลูกค้า วัดสายตา ขาย ชำระเงิน นัดรับ',
            'พนักงานคลังไม่มีสิทธิ์นี้ จึงถูกปฏิเสธทั้ง /api ที่ประตู ไม่ใช่แค่ซ่อนเมนู'],
        'case.view_all' => ['การเข้าถึงระบบ', 'ดู Case ลูกค้าทั้งหมดในระบบ',
            'ทุกคนที่ทำงานหน้าร้านต้องรับเคสต่อจากกันได้ จึงเห็นทั้งหมด ไม่ใช่เฉพาะของตัวเอง'],
        'stock.use'     => ['การเข้าถึงระบบ', 'ระบบคลังและต้นทุน', null],
        'money.zone'    => ['การเข้าถึงระบบ', 'รายรับ · รายจ่าย · รายงาน · ซัพพลายเออร์',
            'เคยรวมกับข้อมูลระบบเป็น admin.zone ก้อนเดียว · แยกออกมาเพราะบัญชีต้องอ่านเงินได้ โดยไม่ได้สิทธิ์ตั้งค่าระบบและจัดการคนติดมาด้วย'],
        'system.zone'   => ['การเข้าถึงระบบ', 'พนักงาน · การตั้งค่า · การแจ้งเตือน · บันทึกการใช้งาน',
            'อีกครึ่งของ admin.zone เดิม — งานที่กระทบว่าระบบทำงานยังไง ไม่ใช่ตัวเลขว่าร้านได้เท่าไร'],
        'users.manage'  => ['การเข้าถึงระบบ', 'จัดการผู้ใช้ · ตั้งรหัสผ่าน',
            'ตั้งบทบาทได้ไม่เกินบทบาทสูงสุดของตัวเอง — แอดมินตั้งเจ้าของร้านไม่ได้'],
        'system.manage' => ['การเข้าถึงระบบ', 'งานระบบ · migration · ตั้งค่าที่กระทบทั้งระบบ',
            'แยกจากสิทธิ์จัดการผู้ใช้ เจ้าของร้านจึงจัดการคนได้โดยไม่ต้องถือสิทธิ์ที่ทำระบบล่มได้'],

        'cost.view'     => ['การมองเห็นข้อมูล', 'ต้นทุน/ชิ้น · มูลค่าคลัง · ต้นทุนขาย',
            'ตัดออกจากคำตอบของ API ไม่ใช่แค่ซ่อนในหน้าเว็บ'],
        'branch.money'  => ['การมองเห็นข้อมูล', 'หน้าการเบิกจากสาขา · หน้าจัดการสาขา · ยอดและกำไรจากสาขา',
            'สองหน้านี้ปิดทั้งหน้า ไม่ใช่ปิดเป็นคอลัมน์ — แต่ชื่อสาขายังเลือกได้ตามปกติตอนบันทึกเบิก'],

        'stock.move'    => ['การบันทึกสต็อก', 'เบิก · ตัดของเสีย · คืนของ · รับของเข้า', null],
        'scrap.blame'   => ['การบันทึกสต็อก', 'ระบุว่าคนอื่นเป็นคนทำของเสีย',
            'ตัดของเสียที่ตัวเองทำ ทำได้ทุกบทบาท — ที่กันไว้คือการลงชื่อคนอื่น'],
        'cost.edit'     => ['การบันทึกสต็อก', 'กรอก/แก้ต้นทุน (ตอนรับของ · ล็อต · RX)',
            'ตัวเลขที่กำไรทั้งร้านคำนวณจากมัน จึงเป็นของเจ้าของร้าน ไม่ใช่ของคนที่บังเอิญคีย์'],

        'product.add'   => ['แคตตาล็อกและเงิน', 'เพิ่มสินค้าใหม่ · เปิดรุ่นเลนส์ใหม่',
            'ของใหม่ถูกค้นพบตอนทำงาน หน้าร้านจึงเพิ่มได้ — แต่ยังกรอกต้นทุนไม่ได้'],
        'catalog.edit'  => ['แคตตาล็อกและเงิน', 'แก้ · ลบสินค้า · ลบล็อต',
            'แก้ SKU หรือลบสินค้าที่ขายมาทั้งปี กระทบประวัติของคนอื่นย้อนหลัง'],
        'branch.settle' => ['แคตตาล็อกและเงิน', 'บันทึกรับเงินจากสาขา · ตัดหนี้สูญ', null],
        'branch.manage' => ['แคตตาล็อกและเงิน', 'เพิ่ม · แก้สาขา', null],
    ];

    /** งานหน้าร้านล้วน — ประกาศแยกไว้เพราะสองบทบาทใช้ชุดนี้ร่วมกันทั้งชุด */
    private const FLOOR = ['frontdesk.use', 'case.view_all', 'stock.move', 'product.add'];

    /** งานคลังล้วน */
    private const WAREHOUSE = ['stock.use', 'stock.move', 'product.add'];

    /**
     * งานเงินล้วน — บัญชีถือชุดนี้ทั้งชุด แอดมินขึ้นไปถือมันบวกอย่างอื่น
     *
     * ประกาศแยกด้วยเหตุผลเดียวกับ `FLOOR`: วันที่กลุ่มการเงินได้สิทธิ์ใหม่หนึ่งข้อ
     * ทุกคนที่ควรได้ต้องได้พร้อมกัน โดยไม่ต้องมีใครไล่เติมสี่ที่แล้วจำได้ครบ
     */
    private const MONEY = ['money.zone', 'cost.view', 'branch.money', 'branch.settle'];

    /**
     * บทบาท → ชุดสิทธิ์ · สิทธิ์จริงของคนหนึ่งคนคือยูเนียนของทุกบทบาทที่ถือ
     *
     * เขียนซ้อนกันด้วย `...` ไม่ใช่คัดลอกรายการ — วันที่แอดมินได้สิทธิ์ใหม่หนึ่งข้อ
     * เจ้าของร้านต้องได้ตามโดยไม่ต้องมีใครจำได้ · และ trainee อ้าง `FLOOR` ตัวเดียว
     * กับ sales จริง ๆ จึงไม่มีวันที่สองบทบาทนี้หลุดจากกันโดยไม่ตั้งใจ
     */
    private const GRANTS = [
        self::SALES   => self::FLOOR,
        self::TRAINEE => self::FLOOR,
        self::STOCK   => self::WAREHOUSE,
        /* `stock.use` ตัวเดียว ไม่ใช่ `WAREHOUSE` ทั้งชุด — เข้าไปอ่านมูลค่าคลัง
           และยอดสาขาได้ แต่ไม่มี `stock.move` และ `product.add` */
        self::ACCOUNTING => [...self::MONEY, 'stock.use'],
        self::ADMIN   => [
            ...self::FLOOR, ...self::WAREHOUSE, ...self::MONEY,
            'system.zone', 'users.manage', 'catalog.edit',
        ],
        self::OWNER => [
            ...self::FLOOR, ...self::WAREHOUSE, ...self::MONEY,
            'system.zone', 'users.manage', 'catalog.edit',
            'cost.edit', 'scrap.blame', 'branch.manage',
        ],
        self::SUPERUSER => [
            ...self::FLOOR, ...self::WAREHOUSE, ...self::MONEY,
            'system.zone', 'users.manage', 'catalog.edit',
            'cost.edit', 'scrap.blame', 'branch.manage',
            'system.manage',
        ],
    ];

    /* ───────────────────────────────────────────────── ถามเรื่องบทบาท */

    public static function isRole(mixed $v): bool
    {
        return is_string($v) && in_array($v, self::ALL, true);
    }

    /**
     * เก็บเฉพาะบทบาทที่ระบบรู้จัก แล้วเรียงจากสิทธิ์มากไปน้อย
     *
     * ทุกทางเข้าของไฟล์นี้ผ่านตรงนี้ก่อน — ค่าที่หลุดมาจากฐานรุ่นเก่า จาก session
     * ที่ค้าง หรือจาก body ที่ใครส่งมา จึงกลายเป็น "ไม่มีบทบาท" แทนที่จะกลายเป็น
     * บทบาทที่ไม่มีใครนิยามไว้แล้ววิ่งต่อไปเงียบ ๆ
     *
     * @param list<string> $roles @return list<string>
     */
    public static function clean(array $roles): array
    {
        $out = array_values(array_unique(array_filter($roles, self::isRole(...))));
        usort($out, static fn(string $a, string $b) => self::RANK[$b] <=> self::RANK[$a]
            ?: array_search($a, self::ALL, true) <=> array_search($b, self::ALL, true));
        return $out;
    }

    /** ยศของคนหนึ่งคน = ยศสูงสุดของบทบาทที่ถือ · ไม่ถืออะไรเลย = 0 */
    public static function rank(array $roles): int
    {
        $best = 0;
        foreach ($roles as $r) {
            $best = max($best, self::RANK[$r] ?? 0);
        }
        return $best;
    }

    /**
     * ผู้ที่ถือ `$actorRoles` ตั้งบทบาท `$target` ให้คนอื่นได้หรือไม่
     *
     * ตั้งได้เฉพาะบทบาทที่ยศไม่เกินยศสูงสุดของตัวเอง — เจ้าของร้านตั้งเจ้าของร้าน
     * คนที่สองได้ (ร้านต้องมีคนสำรอง) แต่แอดมินตั้งเจ้าของร้านไม่ได้
     *
     * @param list<string> $actorRoles
     */
    public static function canGrant(array $actorRoles, string $target): bool
    {
        return self::isRole($target) && self::RANK[$target] <= self::rank($actorRoles);
    }

    /** @param list<string> $roles @return list<string> */
    public static function namesOf(array $roles): array
    {
        return array_map(static fn(string $r): string => self::NAME[$r] ?? $r, $roles);
    }

    /** "Owner + Admin" — คอลัมน์ Role ในตาราง และ actor_role ในบันทึกการใช้งาน */
    public static function text(array $roles): string
    {
        return $roles === [] ? '' : implode(' + ', self::namesOf($roles));
    }

    /* ───────────────────────────────────────────────── ถามเรื่องสิทธิ์ */

    /** @param list<string> $roles */
    public static function has(array $roles, string $perm): bool
    {
        foreach ($roles as $r) {
            if (in_array($perm, self::GRANTS[$r] ?? [], true)) {
                return true;
            }
        }
        return false;
    }

    /**
     * ยูเนียนของทุกบทบาทที่ถือ เรียงตามลำดับใน `PERMS`
     *
     * หน้าเว็บใช้ตัวนี้ตัดสินว่าจะวาดเมนูไหน แทนที่จะถือสำเนาของกฎไว้อีกชุดแล้ว
     * ลืมแก้ตอนเพิ่มบทบาท · เป็นมารยาท ไม่ใช่ด่าน — ด่านจริงคือฟังก์ชันข้างล่าง
     * ที่ API เรียกทุกคำขอ
     *
     * @param list<string> $roles @return list<string>
     */
    public static function permsOf(array $roles): array
    {
        return array_values(array_filter(
            array_keys(self::PERMS),
            static fn(string $p): bool => self::has($roles, $p),
        ));
    }

    /* ─────────────────────────────────── ความสามารถ — ชื่อที่ call site ใช้
       เปลือกบาง ๆ ของ has() ทั้งหมด · เก็บไว้เพราะ `Roles::seeCost($roles)` ที่
       จุดเรียกอ่านออกว่ากันอะไรอยู่ ส่วน `has($roles, 'cost.view')` อ่านออกว่า
       ไปดูที่ไหนต่อ — ทั้งสองอย่างมีค่า จึงมีทั้งสองอย่าง */

    /** @param list<string> $roles */
    public static function useFrontdesk(array $roles): bool { return self::has($roles, 'frontdesk.use'); }
    /** @param list<string> $roles */
    public static function viewAllCases(array $roles): bool { return self::has($roles, 'case.view_all'); }
    /** @param list<string> $roles */
    public static function useStock(array $roles): bool { return self::has($roles, 'stock.use'); }
    /**
     * เงินของร้าน — รายรับ รายจ่าย รายงาน ซัพพลายเออร์
     *
     * แยกจาก `systemZone` เพราะบัญชีต้องอ่านตัวเลขพวกนี้ได้ โดยไม่ได้สิทธิ์ตั้งค่า
     * ระบบและจัดการผู้ใช้ติดมาด้วย · แอดมินขึ้นไปถือทั้งสองอัน สิทธิ์จึงไม่ขยับ
     *
     * @param list<string> $roles
     */
    public static function moneyZone(array $roles): bool { return self::has($roles, 'money.zone'); }

    /** ข้อมูลระบบ — พนักงาน ตั้งค่า แจ้งเตือน บันทึกการใช้งาน @param list<string> $roles */
    public static function systemZone(array $roles): bool { return self::has($roles, 'system.zone'); }
    /** @param list<string> $roles */
    public static function manageAdmins(array $roles): bool { return self::has($roles, 'users.manage'); }
    /** งานของระบบ ไม่ใช่งานของร้าน @param list<string> $roles */
    public static function manageSystem(array $roles): bool { return self::has($roles, 'system.manage'); }

    /**
     * Anything that touches money: RX_ORDER unit_cost and a lot's cost_per_unit.
     *
     * เจ้าของร้านเท่านั้น · แอดมินเห็นตัวเลขได้ (`seeCost`) แต่เป็นคนตั้งมันไม่ได้ —
     * กำไรทั้งร้านคำนวณจากช่องนี้ คนที่รับผิดชอบตัวเลขกับคนที่บังเอิญเป็นคนคีย์
     * ของเข้าคลัง ไม่จำเป็นต้องเป็นคนเดียวกัน
     *
     * @param list<string> $roles
     */
    public static function enterRxCost(array $roles): bool { return self::has($roles, 'cost.edit'); }

    /**
     * Seeing what things cost us — as opposed to what they sell for.
     *
     * Shop-floor staff sell at the marked price and never need the buying price
     * to do it, so they do not get it. Enforced on the way out of the API rather
     * than by hiding fields in the browser: a screen that merely declines to
     * draw a number has still been sent it.
     *
     * The selling price is a different thing and stays visible to everyone —
     * quoting it is the job.
     *
     * @param list<string> $roles
     */
    public static function seeCost(array $roles): bool { return self::has($roles, 'cost.view'); }

    /**
     * Money owed by other branches, and the profit on it.
     *
     * Narrower than seeCost only in intent; kept as its own question so that
     * loosening one does not silently loosen the other.
     *
     * @param list<string> $roles
     */
    public static function seeBranchMoney(array $roles): bool { return self::has($roles, 'branch.money'); }

    /** Product master data — SKU, price, category, lens spec. @param list<string> $roles */
    public static function editCatalog(array $roles): bool { return self::has($roles, 'catalog.edit'); }

    /**
     * เพิ่มสินค้าที่ยังไม่มีในแคตตาล็อก — คนละคำถามกับการแก้ของที่มีอยู่
     *
     * ของใหม่ถูกค้นพบตอนทำงาน ไม่ใช่ตอนนั่งจัดแคตตาล็อก: ลูกค้ายืนอยู่ตรงหน้า
     * แล้วสั่งเลนส์รุ่นที่ร้านไม่เคยลง หรือของมาส่งถึงหน้าร้านก่อนใครจะลงคลัง
     * ถ้าเพิ่มไม่ได้ ทางออกของพนักงานคือเลือกของผิดตัวที่ใกล้เคียงที่สุด หรือไม่
     * บันทึกอะไรเลย — ทั้งสองทางทำให้ตัวเลขในระบบผิดกว่าการมี SKU เกินมาหนึ่งตัว
     *
     * @param list<string> $roles
     */
    public static function addProduct(array $roles): bool { return self::has($roles, 'product.add'); }

    /** Recording stock movements. @param list<string> $roles */
    public static function moveStock(array $roles): bool { return self::has($roles, 'stock.move'); }

    /** The list of branches stock may be lent to. Only an owner decides that. @param list<string> $roles */
    public static function manageBranches(array $roles): bool { return self::has($roles, 'branch.manage'); }

    /**
     * Writing down that the ruined material was someone else's doing.
     *
     * Anyone may scrap, and anyone may scrap something they broke themselves —
     * that needs no permission and is the case this shop meets every week.
     * Naming a *colleague* is a different act: it is an accusation, the
     * dashboard adds it up per person, and it has to come from whoever answers
     * for the shop. Left open to everyone it would be worth nothing as
     * evidence, because the cheapest way to keep your own tally clean would be
     * to type somebody else's name.
     *
     * @param list<string> $roles
     */
    public static function blameScrap(array $roles): bool { return self::has($roles, 'scrap.blame'); }

    /**
     * Writing down the money a branch sent back.
     *
     * @param list<string> $roles
     */
    public static function settleBranch(array $roles): bool { return self::has($roles, 'branch.settle'); }

    /**
     * หน้าแรกหลังล็อกอิน
     *
     * คนที่ทำงานฝั่งเดียวถูกส่งเข้าไปให้ถึงที่ทำงานเลย — คนที่เปิดระบบวันละสามสิบ
     * ครั้งไม่ควรต้องเลือกเมนูเดิมทุกครั้ง เพราะไม่มีอะไรให้เลือก
     *
     * คนที่ทำได้ทั้งสองฝั่ง (แอดมิน เจ้าของร้าน ผู้ดูแลระบบ) ลงที่หน้าเลือกระบบ
     * `/hub/` · เคยส่งลงแดชบอร์ดฝั่งคลังตรง ๆ ด้วยเหตุผลว่ามันตอบคำถามแรกของวัน
     * ว่า "เมื่อคืนเกิดอะไรขึ้นบ้าง" แต่นั่นเป็นการเดาแทนเจ้าของร้านว่าวันนี้เปิด
     * ระบบมาเพื่ออะไร และวันที่เดาผิด — ซึ่งคือวันที่เขาเปิดมาดูหน้าร้าน — แปลว่า
     * ต้องเดินย้อนออกจากฝั่งที่ไม่ได้ตั้งใจเข้าทุกครั้ง · ถามครั้งเดียวถูกกว่า
     *
     * เป็นเส้นทางของหน้าเว็บ ไม่ใช่ของ API — อยู่ที่นี่เพราะเป็นคำตอบของ
     * "คนนี้ทำงานฝั่งไหน" ซึ่งเป็นคำถามเดียวกับที่ทั้งไฟล์นี้ตอบ
     *
     * @param list<string> $roles
     */
    public static function home(array $roles): string
    {
        if (self::useFrontdesk($roles) && self::useStock($roles)) return '/hub/';
        /* บัญชีมี `stock.use` ติดมาด้วย แต่งานแรกของวันคือเงิน ไม่ใช่คลัง — และ
           หน้าร้านที่ `/` เป็นหน้าที่เขาเปิดไม่ได้อยู่แล้ว */
        if (!self::useFrontdesk($roles) && self::moneyZone($roles)) return '/income/';
        return self::useStock($roles) ? '/stock/dashboard/' : '/';
    }

    /* ─────────────────────────────────────────────────────── ตารางสิทธิ์ */

    /**
     * The whole permission table, built from the same map that enforces it.
     *
     * ทุกช่องมาจาก `GRANTS` ตัวเดียวกับที่ `has()` ใช้ตอบทุกคำขอ · ตารางที่พิมพ์
     * คำตอบไว้ซ้ำจะถูกวันแรกแล้วผิดเงียบ ๆ หลังการแก้ครั้งแรก — และหน้าจอสิทธิ์
     * ที่โกหกแย่กว่าไม่มีหน้าจอสิทธิ์ เพราะจะมีคนเชื่อมัน
     *
     * @return array<string,mixed>
     */
    public static function policy(): array
    {
        $groups = [];
        foreach (self::PERMS as $perm => [$group, $label, $note]) {
            $allow = [];
            foreach (self::ALL as $role) {
                $allow[$role] = self::has([$role], $perm);
            }
            $groups[$group][] = [
                'perm'   => $perm,
                'label'  => $label,
                'note'   => $note,
                /* จริงกับทุกบทบาท = ไม่มีอะไรให้ตัดสิน · หน้าจอวาดต่างออกไป
                   แทนที่จะวาดแถวเครื่องหมายถูกหกอันที่ไม่ได้บอกอะไร */
                'always' => !in_array(false, $allow, true),
                'allow'  => $allow,
            ];
        }

        return [
            'roles' => array_map(
                static fn(string $r): array => [
                    'key'   => $r,
                    'name'  => self::NAME[$r],
                    'label' => self::LABEL[$r],
                    'note'  => self::NOTE[$r],
                    'rank'  => self::RANK[$r],
                ],
                self::ALL,
            ),
            'groups' => array_map(
                static fn(string $title): array => ['title' => $title, 'rows' => $groups[$title]],
                array_keys($groups),
            ),
        ];
    }

    /** Throws instead of returning false, for use at the top of a handler. */
    public static function require(bool $allowed, string $what): void
    {
        if (!$allowed) {
            throw ApiError::forbidden("สิทธิ์ของคุณ{$what}ไม่ได้");
        }
    }
}
