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
    public const OWNER = 'owner';
    public const ACCOUNTANT = 'accountant';
    public const STAFF = 'staff';

    public const ALL = [self::OWNER, self::ACCOUNTANT, self::STAFF];

    public const LABEL = [
        self::OWNER      => 'เจ้าของร้าน',
        self::ACCOUNTANT => 'ฝ่ายบัญชี',
        self::STAFF      => 'พนักงานหน้าร้าน',
    ];

    public static function isRole(mixed $v): bool
    {
        return is_string($v) && in_array($v, self::ALL, true);
    }

    public static function manageAdmins(string $role): bool
    {
        return $role === self::OWNER;
    }

    /** Anything that touches money: RX_ORDER unit_cost and a lot's cost_per_unit. */
    public static function enterRxCost(string $role): bool
    {
        return $role === self::OWNER || $role === self::ACCOUNTANT;
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
        return $role === self::OWNER || $role === self::ACCOUNTANT;
    }

    /**
     * Money owed by other branches, and the profit on it.
     *
     * Narrower than seeCost only in intent; kept as its own question so that
     * loosening one does not silently loosen the other.
     */
    public static function seeBranchMoney(string $role): bool
    {
        return $role === self::OWNER || $role === self::ACCOUNTANT;
    }

    /** Product master data — SKU, price, category, lens spec. */
    public static function editCatalog(string $role): bool
    {
        return $role === self::OWNER || $role === self::ACCOUNTANT;
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
        return $role === self::OWNER;
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
        return $role === self::OWNER || $role === self::ACCOUNTANT;
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
                    ['label' => 'จัดการผู้ใช้ · ตั้งรหัสผ่าน', 'cap' => 'manageAdmins'],
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
