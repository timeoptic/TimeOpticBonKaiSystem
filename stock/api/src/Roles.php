<?php

declare(strict_types=1);

namespace Optic;

/**
 * The one place that answers "who may do what".
 *
 * A person's `job_title` ("technician", "reception,sales") describes the work
 * they do and is never consulted here. Permission comes from `role` alone, which
 * an owner sets deliberately. Conflating the two is how a new technician quietly
 * ends up able to edit prices.
 */
final class Roles
{
    /** ผม/ผู้ดูแลระบบ — ทุกอย่างที่เจ้าของร้านทำได้ บวกงานระบบที่ร้านไม่ต้องยุ่ง */
    public const SUPERUSER = 'superuser';
    public const OWNER = 'owner';
    /** แอดมินของทั้งสองฝั่ง — จัดการผู้ใช้ ต้นทุน แดชบอร์ด แต่ไม่ใช่เจ้าของร้าน */
    public const ADMIN = 'admin';
    /** พนักงานขายหน้าร้าน — เข้าระบบแล้วอยู่ฝั่งหน้าร้าน */
    public const SALES = 'sales';
    /** พนักงานคลัง — เข้าระบบแล้วอยู่ฝั่งคลัง */
    public const STOCK = 'stock';

    public const ALL = [self::SUPERUSER, self::OWNER, self::ADMIN, self::SALES, self::STOCK];

    public const LABEL = [
        self::SUPERUSER => 'ผู้ดูแลระบบ',
        self::OWNER     => 'เจ้าของร้าน',
        self::ADMIN     => 'แอดมิน',
        self::SALES     => 'พนักงานขาย',
        self::STOCK     => 'พนักงานคลัง',
    ];

    /**
     * ลำดับสิทธิ์ ใช้ตอบคำถามเดียว: ใครตั้งบทบาทให้ใครได้
     *
     * ไม่ได้แปลว่าบทบาทที่สูงกว่าทำได้ทุกอย่างของบทบาทที่ต่ำกว่าเสมอไป
     * ความสามารถแต่ละอย่างยังตอบด้วยฟังก์ชันของตัวเองข้างล่าง — ตัวเลขนี้มีไว้
     * กันการยกระดับตัวเอง: แอดมินตั้งใครเป็นเจ้าของร้านหรือผู้ดูแลระบบไม่ได้
     * ไม่งั้นสิทธิ์ "จัดการผู้ใช้" กลายเป็นสิทธิ์ "เป็นอะไรก็ได้" ในสองคลิก
     *
     * พนักงานขายกับพนักงานคลังอยู่ระดับเดียวกัน — คนละงาน ไม่ใช่คนละชั้น
     */
    private const RANK = [
        self::SUPERUSER => 4,
        self::OWNER     => 3,
        self::ADMIN     => 2,
        self::SALES     => 1,
        self::STOCK     => 1,
    ];

    public static function isRole(mixed $v): bool
    {
        return is_string($v) && in_array($v, self::ALL, true);
    }

    public static function rank(string $role): int
    {
        return self::RANK[$role] ?? 0;
    }

    /**
     * ผู้ที่มีบทบาท `$actor` ตั้งบัญชีให้เป็นบทบาท `$target` ได้หรือไม่
     *
     * ตั้งได้เฉพาะบทบาทที่ต่ำกว่าตัวเอง หรือเท่ากับตัวเอง — เจ้าของร้านตั้ง
     * เจ้าของร้านคนที่สองได้ (ร้านต้องมีคนสำรอง) แต่แอดมินตั้งเจ้าของร้านไม่ได้
     */
    public static function canGrant(string $actorRole, string $targetRole): bool
    {
        return self::isRole($targetRole) && self::rank($targetRole) <= self::rank($actorRole);
    }

    /**
     * งานของระบบ ไม่ใช่งานของร้าน — migration, การตั้งค่าที่พังทั้งระบบได้
     *
     * แยกจาก manageAdmins เพราะเจ้าของร้านควรจัดการคนของตัวเองได้เต็มที่
     * โดยไม่ต้องถือสิทธิ์ที่ทำให้ระบบล่มได้ด้วยการกดผิด
     */
    public static function manageSystem(string $role): bool
    {
        return $role === self::SUPERUSER;
    }

    public static function manageAdmins(string $role): bool
    {
        return $role === self::SUPERUSER || $role === self::OWNER || $role === self::ADMIN;
    }

    /** Anything that touches money: RX_ORDER unit_cost and a lot's cost_per_unit. */
    public static function enterRxCost(string $role): bool
    {
        return self::rank($role) >= self::RANK[self::ADMIN];
    }

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
     */
    public static function seeCost(string $role): bool
    {
        return self::rank($role) >= self::RANK[self::ADMIN];
    }

    /**
     * Money owed by other branches, and the profit on it.
     *
     * Narrower than seeCost only in intent; kept as its own question so that
     * loosening one does not silently loosen the other.
     */
    public static function seeBranchMoney(string $role): bool
    {
        return self::rank($role) >= self::RANK[self::ADMIN];
    }

    /** Product master data — SKU, price, category, lens spec. */
    public static function editCatalog(string $role): bool
    {
        return self::rank($role) >= self::RANK[self::ADMIN];
    }

    /**
     * เพิ่มสินค้า "ใหม่" เข้าแคตตาล็อก — คนละคำถามกับ editCatalog ที่เป็นการแก้ของเดิม
     *
     * พนักงานขายเจอเลนส์รุ่นที่ยังไม่มีในระบบตอนลูกค้ายืนอยู่ตรงหน้า ถ้าเพิ่มเองไม่ได้
     * ออเดอร์ก็ค้างจนกว่าจะมีแอดมินว่าง — ซึ่งแปลว่าคนขายจะเลี่ยงไปพิมพ์ชื่อมั่ว ๆ
     * ลงช่องอื่นแทน แล้วของชิ้นนั้นจะไม่มีวันขึ้นคลัง
     *
     * ปลอดภัยกว่าการแก้ของเดิมโดยธรรมชาติ: การเพิ่มแถวใหม่ไม่ทำให้ตัวเลขของที่
     * ขายไปแล้วเปลี่ยน ส่วนการแก้ราคาสินค้าที่มีประวัติการขายอยู่ทำได้
     *
     * ต้นทุนไม่ได้ถูกผ่อนตาม — enterRxCost ยังเป็นของแอดมินขึ้นไปเหมือนเดิม
     * คนขายกรอกได้แค่ "ขายเท่าไร" ไม่ใช่ "ซื้อมาเท่าไร"
     */
    public static function addCatalog(string $role): bool
    {
        return self::rank($role) >= self::RANK[self::SALES];
    }

    /**
     * Recording stock movements. Every valid role may do this today; the check
     * stays so the call sites read the same as the others when it tightens.
     */
    public static function moveStock(string $role): bool
    {
        return self::isRole($role);
    }

    /** The list of branches stock may be lent to. Only an owner decides that. */
    public static function manageBranches(string $role): bool
    {
        return $role === self::SUPERUSER || $role === self::OWNER;
    }

    /**
     * หน้าแรกหลังล็อกอินของแต่ละบทบาท
     *
     * พนักงานมีงานเดียวและมีฝั่งเดียว จึงส่งเข้าไปให้ถึงที่ทำงานเลย — คนที่เปิด
     * ระบบวันละสามสิบครั้งไม่ควรต้องเลือกเมนูเดิมทุกครั้ง · คนที่ทำงานทั้งสอง
     * ฝั่ง (แอดมิน เจ้าของร้าน ผู้ดูแลระบบ) เดาแทนไม่ได้ว่าเปิดมาเพื่ออะไร
     * จึงพาไปหน้าให้เลือก แล้วให้เลือกเอง
     *
     * เป็นเส้นทางของหน้าเว็บ ไม่ใช่ของ API — อยู่ที่นี่เพราะเป็นคำตอบของ
     * "บทบาทนี้ทำงานฝั่งไหน" ซึ่งเป็นคำถามเดียวกับที่ทั้งไฟล์นี้ตอบ
     */
    public static function home(string $role): string
    {
        return match ($role) {
            self::SALES => '/',
            self::STOCK => '/stock/',
            default     => '/hub/',
        };
    }

    /**
     * Writing down the money a branch sent back.
     *
     * Same permission as entering a cost, and for the same reason: the amount
     * keyed here is what the profit is computed from, so it belongs to whoever
     * is answerable for the books rather than to whoever handed over the goods.
     */
    public static function settleBranch(string $role): bool
    {
        return self::rank($role) >= self::RANK[self::ADMIN];
    }

    /**
     * The whole permission table, answered by the same functions that enforce it.
     *
     * Every cell below is produced by calling the real capability check, not by
     * writing the answer down a second time. A hand-kept copy of this table would
     * be right the day it was written and quietly wrong after the first change —
     * and a permissions screen that lies is worse than no permissions screen,
     * because someone will trust it.
     *
     * `always` marks the things every signed-in role can do. They have no check
     * of their own precisely because there is nothing to decide; saying so out
     * loud is more useful than leaving them off the table.
     *
     * @return array<string,mixed>
     */
    public static function policy(): array
    {
        /** @var array<string,array{title:string,rows:list<array{label:string,cap:?string,note?:string}>}> $groups */
        $groups = [
            [
                'title' => 'การมองเห็นข้อมูล',
                'rows' => [
                    [
                        'label' => 'สินค้า · ยอดคงเหลือ · ราคาขาย',
                        'cap' => null,
                        'note' => 'พนักงานต้องใช้ราคาขายในการขาย จึงเห็นได้ทุกบทบาท',
                    ],
                    [
                        'label' => 'ล็อต · ความเคลื่อนไหว · ใครเบิก',
                        'cap' => null,
                        'note' => 'สมุดสต็อกเปิดให้ทุกคนอ่าน เพื่อให้ตรวจสอบกันเองได้',
                    ],
                    [
                        'label' => 'ต้นทุน/ชิ้น · มูลค่าคลัง · ต้นทุนขาย',
                        'cap' => 'seeCost',
                        'note' => 'ตัดออกจากคำตอบของ API ไม่ใช่แค่ซ่อนในหน้าเว็บ',
                    ],
                    [
                        'label' => 'ยอดและกำไรจากสาขา · หน้าค้างรับ',
                        'cap' => 'seeBranchMoney',
                        'note' => 'ทั้งหน้าเป็นตัวเลขเงิน จึงปิดทั้งหน้า ไม่ใช่ปิดเป็นคอลัมน์',
                    ],
                    [
                        'label' => 'รายชื่อผู้ใช้และสิทธิ์',
                        'cap' => 'manageAdmins',
                    ],
                ],
            ],
            [
                'title' => 'การบันทึกสต็อก',
                'rows' => [
                    ['label' => 'เบิก · ตัดของเสีย · คืนของ', 'cap' => 'moveStock'],
                    ['label' => 'รับของเข้าคลัง · ปรับยอดล็อต', 'cap' => 'moveStock'],
                    ['label' => 'เปิดใบสั่งตัด RX', 'cap' => 'moveStock'],
                    [
                        'label' => 'กรอกต้นทุน (ตอนรับของ · ล็อต · RX)',
                        'cap' => 'enterRxCost',
                        'note' => 'แยกจากการขยับสต็อก — ตัวเลขที่เป็นเงินคนละสิทธิ์กัน',
                    ],
                ],
            ],
            [
                'title' => 'แคตตาล็อกและเงิน',
                'rows' => [
                    ['label' => 'เพิ่ม · แก้ · ลบสินค้า · ลบล็อต', 'cap' => 'editCatalog'],
                    ['label' => 'บันทึกรับเงินจากสาขา · ตัดหนี้สูญ', 'cap' => 'settleBranch'],
                    ['label' => 'เพิ่ม · แก้สาขา', 'cap' => 'manageBranches'],
                    [
                        'label' => 'จัดการผู้ใช้ · ตั้งรหัสผ่าน',
                        'cap' => 'manageAdmins',
                        'note' => 'ตั้งบทบาทได้ไม่เกินบทบาทของตัวเอง — แอดมินตั้งเจ้าของร้านไม่ได้',
                    ],
                    [
                        'label' => 'งานระบบ · migration · ตั้งค่าที่กระทบทั้งระบบ',
                        'cap' => 'manageSystem',
                        'note' => 'แยกจากสิทธิ์จัดการผู้ใช้ เจ้าของร้านจึงจัดการคนได้โดยไม่ต้องถือสิทธิ์ที่ทำระบบล่มได้',
                    ],
                ],
            ],
        ];

        $out = [];
        foreach ($groups as $group) {
            $rows = [];
            foreach ($group['rows'] as $row) {
                $allow = [];
                foreach (self::ALL as $role) {
                    // The table is the enforcement, called once per cell.
                    $allow[$role] = $row['cap'] === null
                        ? true
                        : (bool) self::{$row['cap']}($role);
                }
                $rows[] = [
                    'label'  => $row['label'],
                    'note'   => $row['note'] ?? null,
                    'always' => $row['cap'] === null,
                    'allow'  => $allow,
                ];
            }
            $out[] = ['title' => $group['title'], 'rows' => $rows];
        }

        return [
            'roles' => array_map(
                static fn(string $r): array => ['key' => $r, 'label' => self::LABEL[$r]],
                self::ALL,
            ),
            'groups' => $out,
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
