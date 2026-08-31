<?php

declare(strict_types=1);

/**
 * Generates the data-dictionary section of the shared reference document.
 *
 * Read straight out of information_schema rather than transcribed by hand: a
 * dictionary that is typed out goes stale the first time someone adds a column,
 * and a stale dictionary is worse than none because it is believed.
 */

require __DIR__ . '/../src/bootstrap.php';

use Optic\Db;

const OURS = ['categories', 'suppliers', 'products', 'stock_lots', 'inventory_logs', 'admins'];

/** Domain grouping for the shop-floor tables, by what they are about. */
const DOMAINS = [
    'ลูกค้าและเคส'      => ['customers', 'cases', 'case_events', 'case_photos', 'case_processes', 'case_statuses', 'customer_notifications', 'notification_log'],
    'นัดหมายและคิว'     => ['bookings', 'booking_notes'],
    'ค่าสายตาและงานเลนส์' => ['prescriptions', 'centerings', 'frame_fittings', 'lens_jobs', 'lens_followups', 'qc_checks'],
    'ผลิตและเบิกของ'    => ['production_jobs', 'production_withdrawals', 'stock_requests', 'product_locations'],
    'ขายและการเงิน'     => ['sales', 'payments', 'incomes', 'expenses', 'custom_orders'],
    'สาขา'             => ['branches', 'branch_issues'],
    'พนักงานและระบบ'    => ['employees', 'app_settings', 'schema_migrations'],
    'ตารางค่าคงที่'     => ['list_len_type', 'list_marketing', 'list_pay_type', 'list_product_type', 'list_sex'],
];

/** Written by hand only where the meaning is not in the name. */
const NOTES = [
    'products'       => 'แคตตาล็อกสินค้า หนึ่งแถวคือของหนึ่งอย่างที่ร้านขาย เลนส์คนละค่าสายตาถือเป็นคนละแถว เพราะสต็อกแยกตามค่าสายตาอยู่แล้ว สเปกที่ต่างกันไปตามชนิดเก็บใน attributes เป็น JSON',
    'stock_lots'     => 'ของที่รับเข้ามาเป็นล็อต แต่ละล็อตถือต้นทุนของตัวเอง การตัดสต็อกเดินตาม FIFO จาก received_date แล้ว id',
    'inventory_logs' => 'สมุดสต็อก ทุกการเคลื่อนไหวลงที่นี่และไม่มีการลบ reference_doc คือเลขอ้างอิงจากระบบต้นทาง (เช่น case_code) เก็บเป็นข้อความ ไม่ใช่ foreign key',
    'categories'     => 'หมวดหมู่สินค้า มีหนึ่งแถวต่อหนึ่งชนิดสินค้า และ code ตรงกับ products.product_type',
    'suppliers'      => 'ผู้ขายที่ร้านสั่งของ อ้างจาก stock_lots.supplier_id',
    'admins'         => 'บัญชีผู้ใช้ของระบบคลัง มีสามบทบาท owner / accountant / staff',
    'branches'       => 'สาขาที่มาเบิกของจากคลังนี้',
    'branch_issues'  => 'ของที่ออกไปให้สาขา ของออกวันหนึ่งเงินเข้าอีกวันหนึ่ง สถานะจึงแยกจากตัวการเคลื่อนไหว',
];

/**
 * Two outputs from one reader.
 *
 * The HTML feeds the shared handbook people read; the Markdown goes into a repo
 * so the other team's tooling can read it as text. Generating both from the same
 * pass is the only way they cannot disagree — pass `md` as the first argument.
 */
define('MD', in_array('md', array_slice($argv ?? [], 1), true));

function h(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** A pipe inside a cell would end the column early. */
function mdCell(?string $s): string
{
    return str_replace(['|', "\n"], ['\\|', ' '], (string) $s);
}

function heading(string $text, string $anchor): void
{
    echo MD ? "\n## {$text}\n\n" : '<h3 id="' . h($anchor) . '">' . h($text) . '</h3>';
}

function lede(string $text): void
{
    echo MD ? "{$text}\n" : '<p class="lede">' . h($text) . '</p>';
}

/**
 * @param list<array<string,mixed>> $cols
 * @param array<string,string> $fkBy
 * @param list<array<string,mixed>> $refs
 */
function renderTableMd(string $name, bool $ours, array $cols, array $fkBy, array $refs, ?int $n): void
{
    $side = $ours ? 'ระบบคลัง' : 'ระบบหน้าร้าน';
    $size = $n === null ? 'view' : number_format($n) . ' แถว';

    echo "\n### `{$name}`\n\n";
    echo "*{$side} · {$size}*\n\n";

    if (isset(NOTES[$name])) {
        echo NOTES[$name] . "\n\n";
    }

    echo "| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |\n";
    echo "| --- | --- | --- | --- | --- | --- |\n";

    foreach ($cols as $c) {
        $key = match ($c['column_key']) {
            'PRI' => 'PK',
            'UNI' => 'UQ',
            'MUL' => 'IX',
            default => '',
        };
        $type = $c['column_type'] . ($c['extra'] ? ' ' . $c['extra'] : '');
        $def = $c['column_default'];
        $ref = $fkBy[$c['column_name']] ?? null;

        printf(
            "| `%s` | `%s` | %s | %s | %s | %s |\n",
            mdCell($c['column_name']),
            mdCell($type),
            $c['is_nullable'] === 'YES' ? 'yes' : 'no',
            $key,
            $def === null ? '—' : '`' . mdCell((string) $def) . '`',
            $ref === null ? '—' : '`' . mdCell($ref) . '`',
        );
    }

    if ($refs !== []) {
        $parts = [];
        foreach ($refs as $r) {
            $parts[] = '`' . $r['table_name'] . '.' . $r['column_name'] . '`';
        }
        echo "\nถูกอ้างโดย: " . implode(' · ', $parts) . "\n";
    }
}

/** @return list<array<string,mixed>> */
function columns(string $table): array
{
    return Db::all(
        "SELECT column_name, column_type, is_nullable, column_key, column_default, extra, column_comment
         FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ?
         ORDER BY ordinal_position",
        [$table],
    );
}

/** @return list<array<string,mixed>> */
function foreignKeys(string $table): array
{
    return Db::all(
        "SELECT column_name, referenced_table_name, referenced_column_name
         FROM information_schema.key_column_usage
         WHERE table_schema = DATABASE() AND table_name = ? AND referenced_table_name IS NOT NULL
         ORDER BY column_name",
        [$table],
    );
}

/** Who points at this table — the half of a relationship a column list never shows. */
function referrers(string $table): array
{
    return Db::all(
        "SELECT table_name, column_name
         FROM information_schema.key_column_usage
         WHERE table_schema = DATABASE() AND referenced_table_name = ?
         ORDER BY table_name, column_name",
        [$table],
    );
}

function rowCount(string $table): ?int
{
    try {
        return (int) Db::value("SELECT COUNT(*) FROM `{$table}`");
    } catch (Throwable) {
        return null; // A view whose source is missing, most likely.
    }
}

function renderTable(string $name, bool $ours): void
{
    $cols = columns($name);
    if ($cols === []) {
        return;
    }
    $fks = foreignKeys($name);
    $refs = referrers($name);
    $n = rowCount($name);

    $fkBy = [];
    foreach ($fks as $f) {
        $fkBy[$f['column_name']] = $f['referenced_table_name'] . '.' . $f['referenced_column_name'];
    }

    if (MD) {
        renderTableMd($name, $ours, $cols, $fkBy, $refs, $n);
        return;
    }

    echo '<section class="tbl" id="t-' . h($name) . '">';
    echo '<h4 class="tbl__name">' . h($name);
    echo '<span class="tbl__meta">' . ($n === null ? 'view' : number_format($n) . ' แถว') . '</span>';
    echo ($ours ? '<span class="tag tag--ours">คลัง</span>' : '<span class="tag">หน้าร้าน</span>');
    echo '</h4>';

    if (isset(NOTES[$name])) {
        echo '<p class="tbl__note">' . h(NOTES[$name]) . '</p>';
    }

    echo '<div class="scroll"><table class="cols"><thead><tr>';
    echo '<th>คอลัมน์</th><th>ชนิด</th><th>Null</th><th>คีย์</th><th>ค่าเริ่มต้น</th><th>อ้างถึง</th>';
    echo '</tr></thead><tbody>';

    foreach ($cols as $c) {
        $key = match ($c['column_key']) {
            'PRI' => '<span class="k k--pri">PK</span>',
            'UNI' => '<span class="k k--uni">UQ</span>',
            'MUL' => '<span class="k">IX</span>',
            default => '',
        };
        $extra = $c['extra'] ? ' <span class="muted">' . h($c['extra']) . '</span>' : '';
        $def = $c['column_default'];
        $ref = $fkBy[$c['column_name']] ?? null;

        echo '<tr>';
        echo '<td class="mono">' . h($c['column_name']) . '</td>';
        echo '<td class="mono muted">' . h($c['column_type']) . $extra . '</td>';
        echo '<td>' . ($c['is_nullable'] === 'YES' ? '<span class="muted">yes</span>' : 'no') . '</td>';
        echo '<td>' . $key . '</td>';
        echo '<td class="mono muted">' . ($def === null ? '—' : h((string) $def)) . '</td>';
        echo '<td class="mono">' . ($ref === null ? '<span class="muted">—</span>'
            : '<a href="#t-' . h(explode('.', $ref)[0]) . '">' . h($ref) . '</a>') . '</td>';
        echo '</tr>';
    }
    echo '</tbody></table></div>';

    if ($refs !== []) {
        $parts = [];
        foreach ($refs as $r) {
            $parts[] = '<a href="#t-' . h($r['table_name']) . '"><code>' . h($r['table_name'] . '.' . $r['column_name']) . '</code></a>';
        }
        echo '<p class="tbl__refs"><strong>ถูกอ้างโดย</strong> ' . implode(' · ', $parts) . '</p>';
    }

    echo '</section>';
}

/* ------------------------------------------------------------------ output */

$all = [];
foreach (Db::all('SHOW FULL TABLES') as $row) {
    $vals = array_values($row);
    $all[$vals[0]] = $vals[1]; // BASE TABLE | VIEW
}

heading('ตารางของระบบคลังและต้นทุน', 'dd-ours');
lede('หกตารางนี้คือทั้งหมดที่ระบบคลังเป็นเจ้าของ นอกจากนี้เป็นของหน้าร้าน');
foreach (OURS as $t) {
    if (isset($all[$t])) {
        renderTable($t, true);
        unset($all[$t]);
    }
}

foreach (DOMAINS as $title => $tables) {
    $present = array_values(array_filter($tables, static fn(string $t): bool => isset($all[$t])));
    if ($present === []) {
        continue;
    }
    heading($title, 'dd-' . md5($title));
    foreach ($present as $t) {
        renderTable($t, false);
        unset($all[$t]);
    }
}

$views = array_keys(array_filter($all, static fn(string $k): bool => $k === 'VIEW'));
$rest = array_keys(array_filter($all, static fn(string $k): bool => $k !== 'VIEW'));

if ($rest !== []) {
    heading('ตารางอื่น', 'dd-rest');
    foreach ($rest as $t) {
        renderTable($t, false);
    }
}

if ($views !== []) {
    heading('View', 'dd-views');
    lede('View อ่านอย่างเดียว เขียนไม่ได้ ใช้สำหรับหน้าจอที่ต้องรวมหลายตาราง');
    foreach ($views as $t) {
        renderTable($t, false);
    }
}
