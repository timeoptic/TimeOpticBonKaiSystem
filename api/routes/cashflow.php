<?php
/**
 * Plain cash-book rows: incomes and expenses.
 *
 * The two are identical apart from the table, the type column, and the fact
 * that expenses also record how they were paid — so both endpoint families are
 * generated from one description instead of written twice.
 */
declare(strict_types=1);

$cashflowKinds = [
    ['table' => 'incomes',  'typeCol' => 'income_type',  'endpoint' => 'income',
        'cols' => ['cf_date', 'income_type', 'branch', 'amount', 'notes']],
    ['table' => 'expenses', 'typeCol' => 'expense_type', 'endpoint' => 'expense',
        'cols' => ['cf_date', 'expense_type', 'branch', 'amount', 'pay_type', 'notes']],
];

foreach ($cashflowKinds as $kind) {
    $table    = $kind['table'];
    $typeCol  = $kind['typeCol'];
    $endpoint = $kind['endpoint'];
    $cols     = $kind['cols'];

    $vals = function (array $b) use ($cols): array {
        $out = [];
        foreach ($cols as $c) {
            if ($c === 'amount') {
                $out[] = num($b[$c] ?? null);
            } elseif ($c === 'cf_date') {
                $out[] = nul($b['cf_date'] ?? null) ?? today();
            } else {
                $out[] = nul($b[$c] ?? null);
            }
        }
        return $out;
    };

    GET("/api/$endpoint", function (array $req) use ($table, $typeCol) {
        $q     = $req['query'];
        $where = [];
        $args  = [];

        if ($term = str_or($q['q'] ?? null)) {
            $p = like($term);
            $where[] = "($typeCol LIKE ? OR branch LIKE ? OR notes LIKE ?)";
            array_push($args, $p, $p, $p);
        }
        if ($from = str_or($q['from'] ?? null)) {
            $where[] = 'cf_date >= ?';
            $args[]  = $from;
        }
        if ($to = str_or($q['to'] ?? null)) {
            $where[] = 'cf_date <= ?';
            $args[]  = $to;
        }
        $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $args[]   = min(int_or($q['limit'] ?? null, 300), 2000);

        $rows = Db::all(
            "SELECT * FROM `$table` $sqlWhere ORDER BY cf_date DESC, id DESC LIMIT ?",
            ...$args
        );
        return ['rows' => $rows, 'total' => round2(sumCol($rows, 'amount'))];
    });

    POST("/api/$endpoint", function (array $req) use ($table, $cols, $vals) {
        $names = implode(',', $cols);
        $marks = implode(',', array_fill(0, count($cols), '?'));
        $r = Db::run("INSERT INTO `$table` ($names) VALUES ($marks)", ...$vals($req['body']));
        return Db::get("SELECT * FROM `$table` WHERE id = ?", $r['insertId']);
    });

    PUT("/api/$endpoint/:id", function (array $req) use ($table, $cols, $vals) {
        $id = int_or($req['params']['id']);
        if (!Db::get("SELECT id FROM `$table` WHERE id = ?", $id)) {
            missing();
        }
        $set = implode(',', array_map(fn($c) => "$c=?", $cols));
        Db::run("UPDATE `$table` SET $set WHERE id=?", ...[...$vals($req['body']), $id]);
        return Db::get("SELECT * FROM `$table` WHERE id = ?", $id);
    });

    DELETE("/api/$endpoint/:id", function (array $req) use ($table) {
        Db::run("DELETE FROM `$table` WHERE id = ?", int_or($req['params']['id']));
        return ['ok' => true];
    });
}

unset($cashflowKinds, $kind, $table, $typeCol, $endpoint, $cols, $vals);
