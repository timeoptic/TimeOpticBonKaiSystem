<?php
/**
 * Prescription Safety Alert — ตัวคำนวณการแจ้งเตือนค่าสายตา + ที่เก็บเกณฑ์/การทบทวน
 *
 * spec: docs/superpowers/specs/2026-10-14-rx-safety-alert-design.md
 *
 * `RxSafety` เป็นคู่แฝดของ `frontend-next/lib/rxSafety.js` (บรรทัดต่อบรรทัด) —
 * สองตัวรันกรณีทดสอบไฟล์เดียวกัน `api/tests/fixtures/rx-safety-cases.json`
 * หน้าเว็บใช้ตัว JS เตือนทันทีขณะกรอก · ตัวนี้คำนวณซ้ำจากค่าในฐานข้อมูลตอนบันทึก
 * Clinical Review เพื่อให้ audit ไม่ขึ้นกับสิ่งที่หน้าเว็บส่งมา
 *
 * เป็นส่วนเพิ่มล้วน — ไม่มีโค้ดเดิมตัวไหนเรียกใช้ นอกจาก routes/rx-safety.php
 */
declare(strict_types=1);

final class RxSafety
{
    /* เกณฑ์ของร้าน (ผู้ใช้กำหนด 14 ต.ค. 2026) — ต้องตรงกับ DEFAULT_RULES ใน lib/rxSafety.js */
    public const DEFAULT_RULES = [
        'sph'  => ['enabled' => true,  'warn' => 0.5, 'critical' => 0.75],
        'cyl'  => ['enabled' => true,  'warn' => 0.5, 'critical' => 0.75],
        'se'   => ['enabled' => false, 'warn' => 1.0, 'critical' => 2.0],
        'add'  => ['enabled' => true,  'warn' => 0.5, 'critical' => 0.75],
        'axis' => ['enabled' => true,  'warn' => 10,  'critical' => 20, 'min_cyl' => 0.75],
    ];

    public const MULTIFOCAL = ['Progressive', 'Bi-focal', 'Degressive'];

    public const EYE_NAME = ['r' => 'ตาขวา (OD)', 'l' => 'ตาซ้าย (OS)'];

    private const FIELD_LABEL = [
        'sphere' => 'SPH', 'cylinder' => 'CYL', 'axis' => 'AXIS', 'add' => 'ADD', 'va' => 'VA', 'se' => 'SE',
    ];

    private const ROW_FIELD = ['sph' => 'sphere', 'cyl' => 'cylinder', 'axis' => 'axis', 'se' => 'se', 'add' => 'add'];

    public static function mergeRules(?array $rules): array
    {
        $out = [];
        foreach (self::DEFAULT_RULES as $k => $def) {
            $out[$k] = array_merge($def, is_array($rules[$k] ?? null) ? $rules[$k] : []);
            /* JSON ทำ 1.0 กลายเป็น 1 — เก็บตัวเลขเป็น float เสมอ ค่าเดียวกันจะได้เทียบเท่ากัน */
            foreach ($out[$k] as $f => $v) {
                $out[$k][$f] = $f === 'enabled' ? (bool) $v : (is_numeric($v) ? (float) $v : $v);
            }
        }
        return $out;
    }

    /** ปัดสองตำแหน่ง ปัดออกจากศูนย์ (ตรงกับ round2 ฝั่ง JS) · −0 → 0 */
    public static function round2(?float $x): ?float
    {
        if ($x === null) {
            return null;
        }
        $r = round($x, 2);
        return $r == 0.0 ? 0.0 : $r;
    }

    private static function blank(mixed $raw): bool
    {
        return $raw === null || trim((string) $raw) === '';
    }

    /** @return array{state:string, value:?float} */
    public static function parseNum(mixed $raw): array
    {
        if (self::blank($raw)) {
            return ['state' => 'missing', 'value' => null];
        }
        $s = strtolower(trim((string) $raw));
        if ($s === 'plano' || $s === 'pl') {
            return ['state' => 'ok', 'value' => 0.0];
        }
        if (!preg_match('/^[+-]?(\d+(\.\d+)?|\.\d+)$/', $s)) {
            return ['state' => 'invalid', 'value' => null];
        }
        $v = (float) $s;
        return ['state' => 'ok', 'value' => $v == 0.0 ? 0.0 : $v];
    }

    /** @return array{state:string, value:?int} */
    public static function parseAxis(mixed $raw): array
    {
        if (self::blank($raw)) {
            return ['state' => 'missing', 'value' => null];
        }
        $s = trim((string) $raw);
        if (!preg_match('/^\d+$/', $s)) {
            return ['state' => 'invalid', 'value' => null];
        }
        return ['state' => 'ok', 'value' => (int) $s];
    }

    public static function transpose(float $sph, float $cyl, ?int $axis): array
    {
        if (!($cyl > 0)) {
            return [$sph, $cyl, $axis];
        }
        return [
            self::round2($sph + $cyl),
            self::round2(-$cyl),
            $axis === null ? null : ($axis > 90 ? $axis - 90 : $axis + 90),
        ];
    }

    public static function eyeRx(?array $e): array
    {
        $e = $e ?? [];
        $problems = [];
        $sph  = self::parseNum($e['sphere'] ?? null);
        $cyl  = self::parseNum($e['cylinder'] ?? null);
        $axis = self::parseAxis($e['axis'] ?? null);
        $add  = self::parseNum($e['add'] ?? null);
        $bad  = function (string $field, string $rule, string $message) use (&$problems) {
            $problems[] = ['field' => $field, 'rule' => $rule, 'level' => 'error', 'message' => $message];
        };

        if ($sph['state'] === 'invalid') {
            $bad('sphere', 'invalid', 'SPH ไม่ใช่ตัวเลขที่ถูกต้อง');
        }
        if ($cyl['state'] === 'invalid') {
            $bad('cylinder', 'invalid', 'CYL ไม่ใช่ตัวเลขที่ถูกต้อง');
        }
        if ($add['state'] === 'invalid') {
            $bad('add', 'invalid', 'ADD ไม่ใช่ตัวเลขที่ถูกต้อง');
        }

        $cylV  = null;
        $axisV = null;
        if ($cyl['state'] === 'missing') {
            if ($axis['state'] === 'missing') {
                $cylV = 0.0;
            } else {
                $bad('cylinder', 'axis_without_cyl', 'มี AXIS ' . trim((string) $e['axis']) . ' แต่ยังไม่กรอก CYL');
            }
        } elseif ($cyl['state'] === 'ok') {
            $cylV = $cyl['value'];
            if ($cylV != 0.0) {
                if ($axis['state'] === 'missing') {
                    $bad('axis', 'cyl_without_axis', 'มี CYL ' . trim((string) $e['cylinder']) . ' แต่ยังไม่กรอก AXIS');
                } elseif ($axis['state'] === 'invalid') {
                    $bad('axis', 'invalid', 'AXIS ต้องเป็นจำนวนเต็ม');
                } elseif ($axis['value'] > 180) {
                    $bad('axis', 'axis_range', "AXIS {$axis['value']}° อยู่นอกช่วง 0–180°");
                } else {
                    /* 0° กับ 180° คือแกนเดียวกัน — ระบบเดิม (normAxis) ยอมรับ 0 จึงไม่บล็อก แค่นับเป็น 180 ตอนเทียบ */
                    $axisV = $axis['value'] === 0 ? 180 : $axis['value'];
                }
            }
        }

        $ok = true;
        foreach ($problems as $p) {
            if (in_array($p['field'], ['sphere', 'cylinder', 'axis'], true)) {
                $ok = false;
            }
        }
        $base = $ok && $sph['state'] === 'ok' && $cylV !== null
            ? self::transpose($sph['value'], $cylV, $axisV)
            : null;
        return [
            'sph'        => $base[0] ?? null,
            'cyl'        => $base[1] ?? null,
            'axis'       => $base[2] ?? null,
            'add'        => $add['state'] === 'ok' ? $add['value'] : null,
            'sphMissing' => $sph['state'] === 'missing',
            'usable'     => $base !== null,
            'transposed' => $base !== null && $cylV > 0,
            'problems'   => $problems,
        ];
    }

    private static function hasAny(?array $set): bool
    {
        if (!$set) {
            return false;
        }
        foreach (['r', 'l'] as $k) {
            foreach (['sphere', 'cylinder', 'axis', 'add'] as $f) {
                if (!self::blank($set[$k][$f] ?? null)) {
                    return true;
                }
            }
        }
        return false;
    }

    private static function fmtD(?float $v): string
    {
        if ($v === null) {
            return '—';
        }
        return ($v > 0 ? '+' : '') . number_format($v, 2, '.', '');
    }

    private static function changeMessage(string $eye, string $k, string $level, array $row): string
    {
        $label = self::FIELD_LABEL[self::ROW_FIELD[$k]];
        $name  = self::EYE_NAME[$eye];
        if ($k === 'axis') {
            return $level === 'critical'
                ? "แกน AXIS {$name} ต่างจากแว่นเดิมมาก {$row['delta']}° ({$row['old']}° → {$row['final']}°) กรุณาตรวจสอบผลการวัดและความสบายของลูกค้าก่อนยืนยัน"
                : "แกน AXIS {$name} ต่างจากแว่นเดิม {$row['delta']}° ({$row['old']}° → {$row['final']}°) กรุณาตรวจสอบผลการวัดอีกครั้ง";
        }
        $head = $level === 'critical'
            ? "ค่าสายตา{$name} {$label} เปลี่ยนมาก " . self::fmtD($row['delta']) . ' D'
            : "ค่าสายตา{$name} {$label} เปลี่ยนจากแว่นเดิม " . self::fmtD($row['delta']) . ' D';
        $tail = $level === 'critical'
            ? 'กรุณาตรวจสอบผลการวัด VA และความสบายของลูกค้าก่อนยืนยัน'
            : 'กรุณาพิจารณาผลการวัดและความสบายของลูกค้าอีกครั้ง';
        return "$head (" . self::fmtD($row['old']) . ' → ' . self::fmtD($row['final']) . ") $tail";
    }

    private static function levelOf(float $abs, ?array $rule): ?string
    {
        if (!$rule || empty($rule['enabled'])) {
            return null;
        }
        $eps = 1e-9;
        if (isset($rule['critical']) && $abs + $eps >= (float) $rule['critical']) {
            return 'critical';
        }
        if (isset($rule['warn']) && $abs + $eps >= (float) $rule['warn']) {
            return 'warning';
        }
        return null;
    }

    /** สตริงเดียวกับ canonical() ฝั่ง JS — ห้ามเปลี่ยนรูปแบบข้างเดียว */
    public static function canonical(?array $oldEyes, array $finalEyes, string $testFor): string
    {
        $fx  = fn(?float $v) => $v === null ? null : number_format($v == 0.0 ? 0.0 : $v, 2, '.', '');
        $vec = function (?array $eyes) use ($fx) {
            if ($eyes === null) {
                return null;
            }
            $out = [];
            foreach (['r', 'l'] as $k) {
                $x = $eyes[$k];
                array_push($out, $fx($x['sph']), $fx($x['cyl']), $x['axis'] === null ? null : (string) $x['axis'], $fx($x['add']));
            }
            return $out;
        };
        return json_encode([$vec($oldEyes), $vec($finalEyes), trim($testFor)], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /**
     * @param ?array $old   ['r' => [sphere, cylinder, axis, add, va], 'l' => …] ค่าดิบ
     * @param array  $final รูปเดียวกัน
     */
    public static function evaluate(?array $old, array $final, ?string $testFor, array $rules): array
    {
        $R      = self::mergeRules($rules);
        $alerts = [];
        $push   = function (array $a) use (&$alerts) {
            $a = array_merge(['eye' => null, 'old' => null, 'final' => null, 'delta' => null], $a);
            $a['blocking'] = in_array($a['level'], ['error', 'info'], true);
            $alerts[] = $a;
        };

        $tf = trim((string) $testFor);
        if ($tf === '') {
            $push(['field' => 'test_for', 'rule' => 'required', 'level' => 'info', 'message' => 'ยังไม่ได้เลือก ใช้สำหรับ / Test For']);
        }
        $multifocal = in_array($tf, self::MULTIFOCAL, true);
        $hasOld     = self::hasAny($old);
        $fin = [];
        $odl = [];
        $compare = [];

        foreach (['r', 'l'] as $eye) {
            $raw  = $final[$eye] ?? [];
            $name = self::EYE_NAME[$eye];
            $f    = self::eyeRx($raw);
            $fin[$eye] = $f;
            foreach ($f['problems'] as $p) {
                $push(array_merge($p, ['eye' => $eye, 'message' => "$name: {$p['message']}"]));
            }
            if ($f['sphMissing']) {
                $push(['eye' => $eye, 'field' => 'sphere', 'rule' => 'required', 'level' => 'info', 'message' => "$name: ยังไม่ได้กรอก SPH"]);
            }
            if (self::blank($raw['va'] ?? null)) {
                $push(['eye' => $eye, 'field' => 'va', 'rule' => 'required', 'level' => 'info', 'message' => "$name: ยังไม่ได้กรอก VA"]);
            }
            if ($multifocal && self::blank($raw['add'] ?? null)) {
                $push(['eye' => $eye, 'field' => 'add', 'rule' => 'required', 'level' => 'info', 'message' => "$name: เลนส์ $tf ต้องมี ADD"]);
            }

            $o = $hasOld ? self::eyeRx($old[$eye] ?? []) : null;
            $odl[$eye] = $o;
            $rows = [];
            $comparable = false;
            $note = null;
            if (!$hasOld) {
                $note = 'ไม่มีค่าแว่นเดิม เปรียบเทียบไม่ได้';
            } elseif (!$o['usable']) {
                $note = $o['sphMissing'] ? 'แว่นเดิมไม่มีค่าตานี้ เปรียบเทียบไม่ได้' : 'ค่าแว่นเดิมอ่านไม่ได้ เปรียบเทียบไม่ได้';
            } elseif (!$f['usable']) {
                $note = 'ค่าที่จะจ่ายยังไม่ครบ/ไม่ถูกต้อง ยังเปรียบเทียบไม่ได้';
            } else {
                $comparable = true;
            }

            if ($comparable) {
                $seO = $o['sph'] + $o['cyl'] / 2;
                $seF = $f['sph'] + $f['cyl'] / 2;
                $rows[] = ['key' => 'sph', 'old' => $o['sph'], 'final' => $f['sph'], 'delta' => self::round2($f['sph'] - $o['sph'])];
                $rows[] = ['key' => 'cyl', 'old' => $o['cyl'], 'final' => $f['cyl'], 'delta' => self::round2($f['cyl'] - $o['cyl'])];
                $axisRow = ['key' => 'axis', 'old' => $o['axis'], 'final' => $f['axis'], 'delta' => null];
                if ($o['axis'] !== null && $f['axis'] !== null) {
                    $d = abs($o['axis'] - $f['axis']);
                    $axisRow['delta'] = min($d, 180 - $d);
                }
                $rows[] = $axisRow;
                $rows[] = ['key' => 'se', 'old' => self::round2($seO), 'final' => self::round2($seF), 'delta' => self::round2($seF - $seO)];
                $addRow = ['key' => 'add', 'old' => $o['add'], 'final' => $f['add'], 'delta' => null];
                if ($o['add'] !== null && $f['add'] !== null) {
                    $addRow['delta'] = self::round2($f['add'] - $o['add']);
                } elseif ($f['add'] !== null && $o['add'] === null) {
                    $addRow['note'] = 'แว่นเดิมไม่มี ADD';
                }
                $rows[] = $addRow;

                foreach ($rows as &$row) {
                    $row['level'] = null;
                    if ($row['delta'] === null) {
                        continue;
                    }
                    if ($row['key'] === 'axis') {
                        $rule   = $R['axis'];
                        $minCyl = (float) $rule['min_cyl'];
                        $bigCyl = abs($o['cyl']) + 1e-9 >= $minCyl && abs($f['cyl']) + 1e-9 >= $minCyl;
                        /* ไม่เตือนจากองศาอย่างเดียว — ค่าเอียงเล็ก แกนเปลี่ยนแทบไม่มีผลต่อการมองเห็น */
                        $row['level'] = $bigCyl ? self::levelOf((float) $row['delta'], $rule) : null;
                    } else {
                        $row['level'] = self::levelOf(abs((float) $row['delta']), $R[$row['key']]);
                    }
                    if ($row['level']) {
                        $push([
                            'eye' => $eye, 'field' => self::ROW_FIELD[$row['key']], 'rule' => $row['key'], 'level' => $row['level'],
                            'old' => $row['old'], 'final' => $row['final'], 'delta' => $row['delta'],
                            'message' => self::changeMessage($eye, $row['key'], $row['level'], $row),
                        ]);
                    }
                }
                unset($row);
            }
            $compare[$eye] = [
                'comparable' => $comparable, 'note' => $note, 'rows' => $rows,
                'transposed' => ['old' => (bool) ($o['transposed'] ?? false), 'final' => $f['transposed']],
            ];
        }

        $counts = ['info' => 0, 'warning' => 0, 'critical' => 0, 'error' => 0];
        $blocking = false;
        foreach ($alerts as $a) {
            $counts[$a['level']]++;
            $blocking = $blocking || $a['blocking'];
        }
        return [
            'alerts'      => $alerts,
            'compare'     => $compare,
            'hasOld'      => $hasOld,
            'counts'      => $counts,
            'blocking'    => $blocking,
            'fingerprint' => self::canonical($hasOld ? $odl : null, $fin, $tf),
        ];
    }

    /** แถว prescriptions → ค่าตาดิบ · `$prefix = 'old_'` อ่านแว่นเดิมแบบเก่าที่เก็บบนแถว measured */
    public static function eyesOf(array $row, string $prefix = ''): array
    {
        $out = [];
        foreach (['r', 'l'] as $k) {
            foreach (['sphere', 'cylinder', 'axis', 'add', 'va'] as $f) {
                $out[$k][$f] = $row["{$prefix}{$k}_{$f}"] ?? null;
            }
        }
        return $out;
    }
}

/**
 * ตารางของ Safety Alert — เพิ่มอย่างเดียว ไม่มี UPDATE / DELETE
 *
 * `ensure()` สร้างตารางเองถ้ายังไม่มี (ใช้ได้ทั้งเครื่องร้านและ Hostinger ที่ไม่รัน Migrate)
 * ระวัง: CREATE TABLE ใน MySQL commit ทรานแซกชันที่เปิดอยู่ — เรียกก่อนเปิดทรานแซกชันเสมอ
 */
final class RxSafetyStore
{
    private static bool $ensured = false;

    public const TABLES = [
        'rx_alert_rule_versions' => "CREATE TABLE IF NOT EXISTS rx_alert_rule_versions (
            version         int(11) NOT NULL AUTO_INCREMENT,
            rules           longtext NOT NULL,
            note            varchar(255) DEFAULT NULL,
            changed_by      int(11) DEFAULT NULL,
            changed_by_name varchar(100) DEFAULT NULL,
            changed_at      datetime NOT NULL DEFAULT current_timestamp(),
            PRIMARY KEY (version)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        'rx_reviews' => "CREATE TABLE IF NOT EXISTS rx_reviews (
            id               int(11) NOT NULL AUTO_INCREMENT,
            case_id          int(11) NOT NULL,
            prescription_id  int(11) NOT NULL,
            rule_version     int(11) NOT NULL,
            fingerprint      varchar(400) NOT NULL,
            old_rx           longtext DEFAULT NULL,
            measured_rx      longtext DEFAULT NULL,
            final_rx         longtext NOT NULL,
            alerts           longtext NOT NULL,
            max_severity     varchar(16) NOT NULL,
            reason           text NOT NULL,
            reviewed_by      int(11) DEFAULT NULL,
            reviewed_by_name varchar(100) DEFAULT NULL,
            reviewed_at      datetime NOT NULL DEFAULT current_timestamp(),
            PRIMARY KEY (id),
            KEY idx_case (case_id),
            KEY idx_rx (prescription_id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    ];

    public static function ensure(): void
    {
        if (self::$ensured) {
            return;
        }
        foreach (self::TABLES as $name => $sql) {
            $n = Db::get(
                'SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
                $name
            );
            if (!(int) ($n['n'] ?? 0)) {
                Db::pdo()->exec($sql);
            }
        }
        if (!Db::get('SELECT version FROM rx_alert_rule_versions LIMIT 1')) {
            Db::run(
                'INSERT INTO rx_alert_rule_versions (rules, note) VALUES (?, ?)',
                json_encode(RxSafety::DEFAULT_RULES),
                'ค่าเริ่มต้นสำหรับทดลอง — ยังไม่ผ่านการตรวจทานโดยนักทัศนมาตร'
            );
        }
        self::$ensured = true;
    }

    /** @return array{version:int, rules:array} */
    public static function current(): array
    {
        self::ensure();
        $r = Db::get('SELECT version, rules FROM rx_alert_rule_versions ORDER BY version DESC LIMIT 1');
        return ['version' => (int) $r['version'], 'rules' => RxSafety::mergeRules(json_decode($r['rules'], true))];
    }

    public static function history(): array
    {
        self::ensure();
        return array_map(fn($r) => [
            'version'         => (int) $r['version'],
            'rules'           => RxSafety::mergeRules(json_decode($r['rules'], true)),
            'note'            => $r['note'],
            'changed_by_name' => $r['changed_by_name'],
            'changed_at'      => $r['changed_at'],
        ], Db::all('SELECT * FROM rx_alert_rule_versions ORDER BY version DESC'));
    }

    /** ตรวจแล้วบันทึกเป็นเวอร์ชันใหม่ · ผิดรูป → 422 rules_invalid */
    public static function save(array $rules, ?string $note, ?array $actor): array
    {
        self::ensure();
        $clean  = [];
        $errors = [];
        foreach (RxSafety::DEFAULT_RULES as $k => $def) {
            $in = is_array($rules[$k] ?? null) ? $rules[$k] : [];
            $clean[$k] = ['enabled' => (bool) ($in['enabled'] ?? $def['enabled'])];
            foreach ($def as $f => $dv) {
                if ($f === 'enabled') {
                    continue;
                }
                $v = $in[$f] ?? $dv;
                if (!is_numeric($v) || (float) $v < 0) {
                    $errors[] = "$k.$f ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป";
                    continue;
                }
                $clean[$k][$f] = (float) $v;
            }
            if (isset($clean[$k]['warn'], $clean[$k]['critical']) && $clean[$k]['critical'] <= $clean[$k]['warn']) {
                $errors[] = "$k: เกณฑ์ทบทวน (แดง) ต้องมากกว่าเกณฑ์เตือน (เหลือง)";
            }
        }
        if ($errors) {
            throw new HttpError(422, implode(' · ', $errors), ['reason' => 'rules_invalid', 'errors' => $errors]);
        }
        $note = trim((string) $note);
        /* เลขเวอร์ชัน = ล่าสุด + 1 เอง ไม่พึ่ง AUTO_INCREMENT ที่กระโดดเมื่อมีทรานแซกชันล้ม —
           คนอ่านประวัติเห็น 1, 2, 3 ต่อกัน ไม่ใช่ 1, 4 แล้วสงสัยว่า 2, 3 หายไปไหน */
        Db::run(
            'INSERT INTO rx_alert_rule_versions (version, rules, note, changed_by, changed_by_name)
             SELECT COALESCE(MAX(version), 0) + 1, ?, ?, ?, ? FROM rx_alert_rule_versions',
            json_encode($clean),
            $note === '' ? null : mb_substr($note, 0, 255),
            isset($actor['id']) ? (int) $actor['id'] : null,
            $actor['displayName'] ?? $actor['username'] ?? null
        );
        return self::current();
    }
}
