<?php
/** Lens and frame suppliers, with the lead time used to predict lens ETAs. */
declare(strict_types=1);

GET('/api/suppliers', fn() => Db::all('SELECT * FROM suppliers ORDER BY active DESC, name'));

POST('/api/suppliers', function (array $req) {
    $body = $req['body'];
    if (str_or($body['name'] ?? null) === '') {
        bad('กรุณากรอกชื่อซัพพลายเออร์');
    }
    $r = Db::run(
        'INSERT INTO suppliers (name, contact_person, phone, email, default_lead_days, notes)
         VALUES (?,?,?,?,?,?)',
        str_or($body['name']),
        nul($body['contact_person'] ?? null),
        nul($body['phone'] ?? null),
        nul($body['email'] ?? null),
        int_or($body['default_lead_days'] ?? null, 7),
        nul($body['notes'] ?? null)
    );
    return Db::get('SELECT * FROM suppliers WHERE id = ?', $r['insertId']);
});

PUT('/api/suppliers/:id', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    Db::run(
        'UPDATE suppliers SET name=?, contact_person=?, phone=?, email=?,
           default_lead_days=?, active=?, notes=? WHERE id=?',
        str_or($body['name'] ?? null),
        nul($body['contact_person'] ?? null),
        nul($body['phone'] ?? null),
        nul($body['email'] ?? null),
        int_or($body['default_lead_days'] ?? null, 7),
        boolInt($body['active'] ?? null),
        nul($body['notes'] ?? null),
        $id
    );
    return Db::get('SELECT * FROM suppliers WHERE id = ?', $id);
});
