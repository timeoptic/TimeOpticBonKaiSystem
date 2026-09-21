<?php

declare(strict_types=1);

/**
 * กติกาใบเบิกเลนส์ของ Bewell — แยกจาก route เพื่อเทสต์ได้โดยไม่ต้องผ่าน HTTP
 *
 * เลนส์ของ Bewell ไม่ใช่สต็อก ใบเบิกจึงไม่แตะ products / stock_lots / rx_orders เลย
 */
final class LensRequisition
{
    /** ลำดับงานปกติ — เดินหน้าหรือข้ามขั้นได้ ย้อนไม่ได้ · cancelled อยู่นอกลำดับ */
    public const FLOW = ['pending', 'issued', 'ordered', 'received', 'assembled'];

    public const LABEL = [
        'pending'   => 'รอเบิก',
        'issued'    => 'เบิกแล้ว',
        'ordered'   => 'ส่งผลิต / สั่งเลนส์',
        'received'  => 'ได้รับเลนส์',
        'assembled' => 'ประกอบแล้ว',
        'cancelled' => 'ยกเลิก',
    ];

    /** คอลัมน์เวลาที่ประทับตอนเข้าสถานะนั้น */
    public const STAMP = [
        'issued'    => 'issued_at',
        'ordered'   => 'ordered_at',
        'received'  => 'received_at',
        'assembled' => 'assembled_at',
        'cancelled' => 'cancelled_at',
    ];

    /** ช่องของใบค่าสายตาที่คัดลอกลงใบเบิก */
    public const RX_FIELDS = [
        'r_sphere', 'r_cylinder', 'r_axis', 'r_add', 'r_pd', 'r_prism', 'r_base',
        'l_sphere', 'l_cylinder', 'l_axis', 'l_add', 'l_pd', 'l_prism', 'l_base',
        'pd_total', 'test_for',
    ];

    /** null = เปลี่ยนได้ · ข้อความ = เหตุผลที่เปลี่ยนไม่ได้ */
    public static function transitionError(string $from, string $to, bool $hasRx): ?string
    {
        if (!isset(self::LABEL[$to])) {
            return 'สถานะไม่ถูกต้อง';
        }
        if ($from === $to) {
            return 'ใบเบิกอยู่สถานะนี้อยู่แล้ว';
        }
        if ($from === 'cancelled') {
            return 'ใบเบิกนี้ถูกยกเลิกแล้ว';
        }
        if ($to === 'cancelled') {
            return $from === 'assembled' ? 'ประกอบแล้ว ยกเลิกใบเบิกไม่ได้' : null;
        }
        if (array_search($to, self::FLOW, true) < array_search($from, self::FLOW, true)) {
            return 'ย้อนสถานะใบเบิกไม่ได้';
        }
        if (!$hasRx) {
            return 'เคสนี้ยังไม่มีค่าสายตาสุดท้าย — ยืนยันค่าสายตาก่อนเบิกเลนส์';
        }
        return null;
    }

    /**
     * ค่าสายตาสุดท้ายของออเดอร์ — ใบที่ผูกกับออเดอร์ก่อน (ตั้งตอนกดยืนยันค่าสายตา)
     * ไม่มีค่อยหาใบ final ล่าสุดของเคส เหมือนที่หน้าออเดอร์หาอยู่
     */
    public static function finalRx(Tx $q, array $order): ?array
    {
        $row = null;
        if (!empty($order['final_prescription_id'])) {
            $row = $q->get('SELECT * FROM prescriptions WHERE id = ?', (int) $order['final_prescription_id']);
        }
        if (!$row && !empty($order['case_id'])) {
            $row = $q->get(
                "SELECT * FROM prescriptions WHERE case_id = ? AND kind = 'final'
                  ORDER BY confirmed_at DESC, id DESC LIMIT 1",
                (int) $order['case_id']
            );
        }
        return $row ?: null;
    }

    public static function snapshot(array $rx): array
    {
        $out = ['prescription_id' => (int) $rx['id']];
        foreach (self::RX_FIELDS as $f) {
            $out[$f] = $rx[$f] ?? null;
        }
        return $out;
    }

    /** รายการจากหน้าเว็บ → แถวพร้อมเขียน · ลำดับคีย์ = ลำดับคอลัมน์ใน INSERT ของ routes/lens.php */
    public static function cleanItems(array $items): array
    {
        if (!$items) {
            bad('ไม่มีรายการเลนส์');
        }
        $text = static fn($v, int $max) => mb_substr(trim((string) ($v ?? '')), 0, $max);
        $out  = [];
        foreach (array_values($items) as $i => $it) {
            $n   = $i + 1;
            $eye = strtoupper(trim((string) ($it['eye'] ?? '')));
            if (!in_array($eye, ['R', 'L', 'PAIR'], true)) {
                bad("รายการที่ $n: ข้างของเลนส์ไม่ถูกต้อง");
            }
            $brand = $text($it['brand'] ?? '', 80);
            if ($brand === '') {
                bad("รายการที่ $n: ไม่มียี่ห้อเลนส์");
            }
            $qty   = max(1, (int) ($it['quantity'] ?? 1));
            $price = round((float) ($it['unit_price'] ?? 0), 2);
            if ($price < 0) {
                bad("รายการที่ $n: ราคาติดลบไม่ได้");
            }
            $source = strtoupper((string) ($it['source'] ?? 'MOCK'));
            $out[] = [
                'eye'          => $eye === 'PAIR' ? 'pair' : $eye,
                'source'       => in_array($source, ['MOCK', 'DATABASE'], true) ? $source : 'MOCK',
                'mock_code'    => $text($it['mock_code'] ?? '', 120) ?: null,
                'brand'        => $brand,
                'lens_type'    => $text($it['lens_type'] ?? '', 80) ?: null,
                'design'       => $text($it['design'] ?? '', 120) ?: null,
                'lens_index'   => $text($it['lens_index'] ?? '', 10) ?: null,
                'coating'      => $text($it['coating'] ?? '', 80) ?: null,
                'option_name'  => $text($it['option_name'] ?? '', 80) ?: null,
                'photochromic' => $text($it['photochromic'] ?? '', 80) ?: null,
                'color'        => $text($it['color'] ?? '', 40) ?: null,
                'quantity'     => $qty,
                'unit_price'   => $price,
                'line_total'   => round($qty * $price, 2),
            ];
        }
        return $out;
    }
}
