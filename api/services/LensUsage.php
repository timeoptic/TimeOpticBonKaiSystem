<?php

declare(strict_types=1);

require_once __DIR__ . '/LensRequisition.php';

/**
 * การใช้เลนส์ของ Bewell (Lens Usage) — อ่านอย่างเดียว สำหรับหน้าความเคลื่อนไหวและไฟล์ Export
 *
 * หนึ่งแถว = หนึ่งรายการในใบเบิกเลนส์ที่ยืนยันขั้นขายแล้ว (lens_requisitions.used_at)
 * ไม่ใช่สต็อก: ไม่อ่านหรือเขียน inventory_logs / stock_lots เลย และไม่มียอดคงเหลือ
 * ใบที่ถูกยกเลิกยังแสดงอยู่ (สถานะ "ยกเลิก") เพื่อให้ตรวจย้อนหลังได้ — กรองออกด้วยสถานะ
 */
final class LensUsage
{
    public const PER_PAGE = 25;

    /** ข้างของเลนส์ → หน่วยที่แสดง */
    public const UNIT = ['pair' => 'คู่', 'R' => 'ข้าง', 'L' => 'ข้าง'];

    private const HEAD = [
        'ลำดับ', 'วันที่', 'เลขที่ POS', 'Case ID', 'ชื่อลูกค้า', 'Lens Code', 'Lens Name', 'Lens Type',
        'Brand', 'Index', 'Coating',
        'OD SPH', 'OD CYL', 'OD AXIS', 'OD ADD',
        'OS SPH', 'OS CYL', 'OS AXIS', 'OS ADD',
        'จำนวน', 'หน่วย', 'ต้นทุน/คู่', 'ราคาขาย', 'สถานะ', 'ผู้ทำรายการ', 'หมายเหตุ',
    ];

    /**
     * ตัวกรองจาก query string → [เงื่อนไข SQL, ค่า] · ใช้ร่วมกันทั้งรายการ ตัวนับ และ Export
     * ไฟล์ที่ได้จึงตรงกับสิ่งที่อยู่บนหน้าจอเสมอ
     */
    public static function where(array $f): array
    {
        $w    = ['lr.used_at IS NOT NULL'];
        $args = [];
        $date = static fn($v) => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $v) ? (string) $v : '';
        if (($from = $date($f['from'] ?? '')) !== '') {
            $w[]    = 'lr.used_at >= ?';
            $args[] = $from;
        }
        if (($to = $date($f['to'] ?? '')) !== '') {
            $w[]    = 'lr.used_at < DATE_ADD(?, INTERVAL 1 DAY)';
            $args[] = $to;
        }
        foreach (['lens_type' => 'i.lens_type', 'index' => 'i.lens_index', 'coating' => 'i.coating'] as $key => $col) {
            $v = trim((string) ($f[$key] ?? ''));
            if ($v !== '') {
                $w[]    = "$col = ?";
                $args[] = $v;
            }
        }
        $name = trim((string) ($f['lens_name'] ?? ''));
        if ($name !== '') {
            /* ตรงตัว ไม่ใช่บางส่วน — "Progressive" ต้องไม่ได้ "Progressive Blue Cut" มาด้วย */
            $w[]    = 'COALESCE(i.lens_name, i.design) = ?';
            $args[] = $name;
        }
        $status = (string) ($f['status'] ?? '');
        if (isset(LensRequisition::LABEL[$status])) {
            $w[]    = 'lr.status = ?';
            $args[] = $status;
        }
        $who = int_or($f['who'] ?? null);
        if ($who) {
            $w[]    = 'lr.used_by = ?';
            $args[] = $who;
        }
        $term = trim((string) ($f['q'] ?? ''));
        if ($term !== '') {
            $w[] = '(lr.req_no LIKE ? OR COALESCE(o.invoice_code, lr.order_ref) LIKE ? OR c.case_code LIKE ?
                     OR cu.first_name LIKE ? OR cu.last_name LIKE ? OR COALESCE(i.lens_name, i.design) LIKE ?
                     OR i.lens_code LIKE ?)';
            array_push($args, ...array_fill(0, 7, "%$term%"));
        }
        return [implode(' AND ', $w), $args];
    }

    private const FROM = '
          FROM lens_requisition_items i
          JOIN lens_requisitions lr ON lr.id = i.requisition_id
          JOIN cases c      ON c.id = lr.case_id
          JOIN customers cu ON cu.id = lr.customer_id
          LEFT JOIN custom_orders o ON o.id = lr.order_id
          LEFT JOIN employees eu    ON eu.id = lr.used_by
          LEFT JOIN employees ec    ON ec.id = lr.cancelled_by';

    private const SELECT = "
        SELECT i.id, i.requisition_id, i.eye, i.lens_catalog_id,
               COALESCE(i.lens_code, i.mock_code) AS lens_code,
               COALESCE(i.lens_name, i.design) AS lens_name,
               i.lens_type, NULLIF(i.brand, '') AS brand, i.lens_index, i.coating,
               i.quantity, i.unit_price, i.line_total, i.cost_price,
               lr.req_no, lr.status, lr.used_at, lr.case_id, lr.rx_snapshot, lr.note,
               lr.cancelled_at, lr.cancel_reason, lr.cancel_source,
               COALESCE(o.invoice_code, lr.order_ref) AS invoice_code,
               c.case_code, CONCAT_WS(' ', cu.first_name, cu.last_name) AS customer_name,
               eu.employee_name AS used_by_name, ec.employee_name AS cancelled_by_name";

    /** นับจำนวนรายการตามตัวกรอง — การ์ด "ใช้เลนส์" บนหน้าความเคลื่อนไหว */
    public static function count(array $f): int
    {
        [$w, $args] = self::where($f);
        return (int) Db::get('SELECT COUNT(*) n ' . self::FROM . " WHERE $w", ...$args)['n'];
    }

    /** หนึ่งหน้า (25 แถว) ตามตัวกรอง — เรียงใหม่ไปเก่า */
    public static function page(array $f, bool $seeCost): array
    {
        [$w, $args] = self::where($f);
        $total = (int) Db::get('SELECT COUNT(*) n ' . self::FROM . " WHERE $w", ...$args)['n'];
        $page  = max(1, (int) ($f['page'] ?? 1));
        $rows  = Db::all(
            self::SELECT . self::FROM . " WHERE $w ORDER BY lr.used_at DESC, i.id DESC LIMIT "
                . self::PER_PAGE . ' OFFSET ' . (($page - 1) * self::PER_PAGE),
            ...$args
        );
        return [
            'rows'    => array_map(static fn(array $r) => self::shape($r, $seeCost), $rows),
            'total'   => $total,
            'page'    => $page,
            'perPage' => self::PER_PAGE,
            'pages'   => max(1, (int) ceil($total / self::PER_PAGE)),
        ];
    }

    /** ทุกแถวตามตัวกรอง — สำหรับ Export (เพดาน 20,000 แถว กันไฟล์โตจนเซิร์ฟเวอร์ล้ม) */
    public static function all(array $f, bool $seeCost): array
    {
        [$w, $args] = self::where($f);
        $rows = Db::all(
            self::SELECT . self::FROM . " WHERE $w ORDER BY lr.used_at ASC, i.id ASC LIMIT 20000",
            ...$args
        );
        return array_map(static fn(array $r) => self::shape($r, $seeCost), $rows);
    }

    /** ตัวเลือกของช่องกรอง — ค่าจากรายการเลนส์และจากใบที่เคยขาย (เลนส์ที่ถูกปิดไปแล้วยังกรองได้) */
    public static function options(): array
    {
        $distinct = static fn(string $col, string $itemCol) => array_values(array_filter(array_column(Db::all(
            "SELECT v FROM (SELECT $col AS v FROM lens_catalog UNION SELECT $itemCol FROM lens_requisition_items) x
              WHERE v IS NOT NULL AND v <> '' ORDER BY v"
        ), 'v')));
        return [
            'lens_types' => $distinct('lens_type', 'lens_type'),
            'indexes'    => $distinct('lens_index', 'lens_index'),
            'coatings'   => $distinct('coating', 'coating'),
            'names'      => $distinct('lens_name', 'COALESCE(lens_name, design)'),
            'statuses'   => array_map(
                static fn(string $k) => ['value' => $k, 'label' => LensRequisition::LABEL[$k], 'code' => LensRequisition::CODE[$k]],
                array_keys(LensRequisition::LABEL)
            ),
            'people'     => Db::all(
                'SELECT DISTINCT e.id, e.employee_name AS name
                   FROM lens_requisitions lr JOIN employees e ON e.id = lr.used_by
                  ORDER BY e.employee_name'
            ),
        ];
    }

    /** แถวจากฐาน → รูปที่หน้าเว็บและไฟล์ใช้ · ค่าสายตาอ่านจากสำเนา ณ วันที่ขาย */
    public static function shape(array $r, bool $seeCost): array
    {
        $rx  = $r['rx_snapshot'] ? (json_decode((string) $r['rx_snapshot'], true) ?: []) : [];
        $eye = static fn(string $p) => [
            'sph'  => self::txt($rx[$p . '_sphere'] ?? null),
            'cyl'  => self::txt($rx[$p . '_cylinder'] ?? null),
            'axis' => self::txt($rx[$p . '_axis'] ?? null),
            'add'  => self::txt($rx[$p . '_add'] ?? null),
        ];
        return [
            'id'                => (int) $r['id'],
            'requisitionId'     => (int) $r['requisition_id'],
            'reqNo'             => $r['req_no'],
            'usedAt'            => $r['used_at'],
            'invoiceCode'       => $r['invoice_code'],
            'caseId'            => (int) $r['case_id'],
            'caseCode'          => $r['case_code'],
            'customerName'      => $r['customer_name'],
            'eye'               => $r['eye'],
            'lensCode'          => $r['lens_code'],
            'lensName'          => $r['lens_name'],
            'lensType'          => $r['lens_type'],
            'brand'             => $r['brand'],
            'lensIndex'         => $r['lens_index'],
            'coating'           => $r['coating'],
            /* ข้างเดียวมีค่าสายตาแค่ข้างนั้น */
            'od'                => $r['eye'] === 'L' ? null : $eye('r'),
            'os'                => $r['eye'] === 'R' ? null : $eye('l'),
            'quantity'          => (int) $r['quantity'],
            'unit'              => self::UNIT[$r['eye']] ?? '',
            'costPrice'         => $seeCost && $r['cost_price'] !== null ? (float) $r['cost_price'] : null,
            'sellingPrice'      => (float) $r['line_total'],
            'status'            => $r['status'],
            'statusLabel'       => LensRequisition::LABEL[$r['status']] ?? $r['status'],
            'statusCode'        => LensRequisition::CODE[$r['status']] ?? strtoupper((string) $r['status']),
            'usedBy'            => $r['used_by_name'],
            'cancelledAt'       => $r['cancelled_at'],
            'cancelledBy'       => $r['cancelled_by_name'],
            'cancelReason'      => $r['cancel_reason'],
            'cancelSource'      => LensRequisition::CANCEL_SOURCE[$r['cancel_source'] ?? ''] ?? null,
            'note'              => self::note($r),
        ];
    }

    private static function txt(mixed $v): ?string
    {
        $v = trim((string) ($v ?? ''));
        return $v === '' ? null : $v;
    }

    /** หมายเหตุในไฟล์ — ข้างของเลนส์ เลขใบเบิก และเรื่องการยกเลิก (ใคร เมื่อไร เพราะอะไร) */
    private static function note(array $r): string
    {
        $parts = [$r['req_no']];
        if ($r['eye'] !== 'pair') {
            $parts[] = $r['eye'] === 'R' ? 'ข้างขวา (R)' : 'ข้างซ้าย (L)';
        }
        if ($r['status'] === 'cancelled') {
            $parts[] = 'ยกเลิก ' . substr((string) $r['cancelled_at'], 0, 16)
                . ($r['cancelled_by_name'] ? ' โดย ' . $r['cancelled_by_name'] : '')
                . ($r['cancel_reason'] ? ' · ' . $r['cancel_reason'] : '');
        }
        if (trim((string) $r['note']) !== '') {
            $parts[] = trim((string) $r['note']);
        }
        return implode(' · ', $parts);
    }

    /* ---- Export ---------------------------------------------------------- */

    public static function fileName(array $f): string
    {
        $from = (string) ($f['from'] ?? '');
        $to   = (string) ($f['to'] ?? '');
        $span = $from !== '' || $to !== '' ? ' ' . ($from ?: 'เริ่มต้น') . ' ถึง ' . ($to ?: 'ล่าสุด') : '';
        return "Lens Usage - Be Well$span.xlsx";
    }

    public static function workbook(array $f, bool $seeCost): Xlsx
    {
        $rows = self::all($f, $seeCost);
        $book = new Xlsx();
        $sh   = $book->sheet('Lens Usage - Be Well');
        $sh->widths([6, 11, 16, 16, 24, 18, 30, 14, 12, 7, 12, 8, 8, 8, 8, 8, 8, 8, 8, 7, 7, 11, 11, 20, 18, 44]);
        $sh->row(array_map(static fn(string $h) => Xlsx::t($h, Xlsx::HEAD), self::HEAD));
        $first = $sh->nextRow();
        $txt   = static fn(?string $v) => $v === null ? Xlsx::t('-') : Xlsx::t($v);
        foreach ($rows as $n => $r) {
            $od = $r['od'] ?? [];
            $os = $r['os'] ?? [];
            $sh->row([
                Xlsx::n($n + 1, Xlsx::INT),
                Xlsx::d($r['usedAt']),
                Xlsx::t($r['invoiceCode'] ?? ''),
                Xlsx::t($r['caseCode']),
                Xlsx::t($r['customerName']),
                Xlsx::t($r['lensCode'] ?? ''),
                Xlsx::t($r['lensName'] ?? ''),
                Xlsx::t($r['lensType'] ?? ''),
                Xlsx::t($r['brand'] ?? ''),
                Xlsx::t($r['lensIndex'] ?? ''),
                Xlsx::t($r['coating'] ?? ''),
                $txt($od['sph'] ?? null), $txt($od['cyl'] ?? null), $txt($od['axis'] ?? null), $txt($od['add'] ?? null),
                $txt($os['sph'] ?? null), $txt($os['cyl'] ?? null), $txt($os['axis'] ?? null), $txt($os['add'] ?? null),
                Xlsx::n($r['quantity'], Xlsx::INT),
                Xlsx::t($r['eye'] === 'pair' ? 'Pair' : 'Side'),
                $r['costPrice'] === null ? Xlsx::blank() : Xlsx::n($r['costPrice']),
                Xlsx::n($r['sellingPrice']),
                Xlsx::t($r['statusCode']),
                Xlsx::t($r['usedBy'] ?? ''),
                Xlsx::t($r['note']),
            ]);
        }
        $last = $sh->nextRow() - 1;
        $sh->freeze(1);
        $sh->filterFrom(1, count(self::HEAD), max($last, 1));
        return $book;
    }
}
