<?php

declare(strict_types=1);

namespace Optic\Service;

use Optic\ApiError;
use Optic\Db;
use Optic\Roles;

/**
 * The other shops that come and take stock from this one.
 *
 * A short list that changes once or twice a year, which is exactly why it is a
 * table and not a free-text field: "สาขาบางแค" and "บางแค" typed on different
 * days are two different debtors as far as a text column is concerned, and the
 * money owed would be split between them without anyone noticing.
 *
 * A branch that has ever taken stock is never deleted, only deactivated: its
 * old withdrawals still have to be readable and settleable long after it
 * closes. One that never took anything is just a typo, and a typo should be
 * removable — see delete() below for where the line falls.
 */
final class Branches
{
    /**
     * Every branch with what it currently owes.
     *
     * The outstanding figure is what the goods cost us, not what the branch will
     * pay — the selling side of a withdrawal is unknown until the money arrives.
     * It is a floor on the debt, and the screens label it that way.
     *
     * @return list<array<string,mixed>>
     */
    public static function list(bool $activeOnly = false, bool $money = false): array
    {
        $rows = Db::all(
            'SELECT b.id, b.name, b.contact, b.is_active, b.note,
                    COUNT(i.id)                                     AS pending_count,
                    COALESCE(SUM(i.cost_total), 0)                  AS pending_cost,
                    COALESCE(SUM(i.cost_unknown_qty), 0)            AS pending_unknown
             FROM branches b
             LEFT JOIN branch_issues i ON i.branch_id = b.id AND i.status = \'pending\'
             ' . ($activeOnly ? 'WHERE b.is_active = 1' : '') . '
             GROUP BY b.id, b.name, b.contact, b.is_active, b.note
             ORDER BY b.is_active DESC, b.name ASC'
        );

        return array_map(static fn(array $r): array => [
            'id'             => (int) $r['id'],
            'name'           => $r['name'],
            'contact'        => $r['contact'],
            'isActive'       => (bool) $r['is_active'],
            'note'           => $r['note'],
            'pendingCount'   => (int) $r['pending_count'],
            // How many rows are outstanding is a stock fact; what they cost is
            // not, so shop-floor staff get the count and not the money.
            'pendingCost'    => $money ? (float) $r['pending_cost'] : null,
            'pendingUnknown' => (int) $r['pending_unknown'],
        ], $rows);
    }

    /** @param array<string,mixed> $body @return array<string,mixed> */
    public static function create(array $body, array $roles): array
    {
        Roles::require(Roles::manageBranches($roles), 'เพิ่มสาขา');

        $name = self::name($body);
        $contact = self::optional($body, 'contact', 160);
        $note = self::optional($body, 'note', 500);

        if (Db::one('SELECT id FROM branches WHERE name = ?', [$name]) !== null) {
            throw ApiError::conflict('duplicate_branch', "มีสาขาชื่อ {$name} อยู่แล้ว", ['name' => $name]);
        }

        Db::run(
            'INSERT INTO branches (name, contact, is_active, note) VALUES (?, ?, 1, ?)',
            [$name, $contact, $note],
        );

        return self::one((int) Db::conn()->lastInsertId());
    }

    /** @param array<string,mixed> $body @return array<string,mixed> */
    public static function update(int $id, array $body, array $roles): array
    {
        Roles::require(Roles::manageBranches($roles), 'แก้ไขสาขา');

        $current = Db::one('SELECT * FROM branches WHERE id = ?', [$id]);
        if ($current === null) {
            throw ApiError::notFound('ไม่พบสาขาที่ระบุ');
        }

        $name = array_key_exists('name', $body) ? self::name($body) : (string) $current['name'];
        if ($name !== $current['name']) {
            $clash = Db::one('SELECT id FROM branches WHERE name = ? AND id <> ?', [$name, $id]);
            if ($clash !== null) {
                throw ApiError::conflict('duplicate_branch', "มีสาขาชื่อ {$name} อยู่แล้ว", ['name' => $name]);
            }
        }

        $active = array_key_exists('is_active', $body)
            ? (bool) $body['is_active']
            : (bool) $current['is_active'];

        // Closing a branch that still owes money would hide the debt from the
        // only screen that lists it. Settle or write off first.
        if (!$active && (bool) $current['is_active']) {
            $owing = (int) Db::value(
                'SELECT COUNT(*) FROM branch_issues WHERE branch_id = ? AND status = \'pending\'',
                [$id],
            );
            if ($owing > 0) {
                throw ApiError::conflict(
                    'branch_has_debt',
                    "สาขานี้ยังค้างอยู่ {$owing} รายการ — เคลียร์ก่อนจึงปิดใช้งานได้",
                    ['pending' => $owing],
                );
            }
        }

        Db::run(
            'UPDATE branches SET name = ?, contact = ?, is_active = ?, note = ? WHERE id = ?',
            [
                $name,
                array_key_exists('contact', $body) ? self::optional($body, 'contact', 160) : $current['contact'],
                $active ? 1 : 0,
                array_key_exists('note', $body) ? self::optional($body, 'note', 500) : $current['note'],
                $id,
            ],
        );

        return self::one($id);
    }

    /**
     * Remove a branch that never traded.
     *
     * The line is drawn at whether anything was ever withdrawn, not at whether
     * money is still owed. A branch with a settled withdrawal behind it is part
     * of the ledger — the row naming it is what makes that withdrawal readable
     * a year later — so it can only ever be switched off. A branch someone
     * created by mistake has nothing behind it and should not have to be carried
     * for the life of the shop.
     *
     * Refusing here, by name and by count, says that plainly. Left to the
     * foreign key it would arrive as a constraint violation, which is true and
     * useless.
     *
     * @return array<string,mixed>
     */
    public static function delete(int $id, array $roles): array
    {
        Roles::require(Roles::manageBranches($roles), 'ลบสาขา');

        $b = Db::one('SELECT id, name FROM branches WHERE id = ?', [$id]);
        if ($b === null) {
            throw ApiError::notFound('ไม่พบสาขาที่ระบุ');
        }

        $issues = (int) Db::value('SELECT COUNT(*) FROM branch_issues WHERE branch_id = ?', [$id]);
        if ($issues > 0) {
            throw ApiError::conflict(
                'branch_has_history',
                "ลบไม่ได้ — สาขานี้เคยเบิกของไปแล้ว {$issues} รายการ ประวัติต้องอ่านย้อนหลังได้ · ปิดใช้งานแทนได้",
                ['issues' => $issues],
            );
        }

        Db::run('DELETE FROM branches WHERE id = ?', [$id]);

        return ['id' => $id, 'name' => $b['name']];
    }

    /* -------------------------------------------------------------- helpers */

    /** @return array<string,mixed> */
    private static function one(int $id): array
    {
        // Internal read-back after a write, always by an owner, so the money is
        // theirs to see.
        foreach (self::list(false, true) as $b) {
            if ($b['id'] === $id) {
                return $b;
            }
        }
        throw ApiError::notFound('ไม่พบสาขาที่ระบุ');
    }

    /** @param array<string,mixed> $body */
    private static function name(array $body): string
    {
        $v = $body['name'] ?? null;
        if (!is_string($v) || trim($v) === '') {
            throw ApiError::badRequest('ต้องระบุชื่อสาขา', 'missing_field');
        }
        $v = trim($v);
        if (mb_strlen($v) > 120) {
            throw ApiError::badRequest('ชื่อสาขายาวเกิน 120 ตัวอักษร', 'field_too_long');
        }
        return $v;
    }

    /** @param array<string,mixed> $body */
    private static function optional(array $body, string $field, int $max): ?string
    {
        $v = $body[$field] ?? null;
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_string($v)) {
            throw ApiError::badRequest("{$field} ต้องเป็นข้อความ", 'bad_field');
        }
        $v = trim($v);
        return $v === '' ? null : mb_substr($v, 0, $max);
    }
}
