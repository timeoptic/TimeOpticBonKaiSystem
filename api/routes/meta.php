<?php
/** Everything the front-end needs once at boot: dropdowns, staff, statuses. */
declare(strict_types=1);

GET('/api/meta', fn() => [
    'lists'     => Lookups::lists(),
    'employees' => Db::all(
        'SELECT id, employee_name, first_name, last_name, roles
           FROM employees WHERE active = 1 ORDER BY employee_name'
    ),
    'statuses'  => Lookups::caseStatuses(),
    'suppliers' => Db::all(
        'SELECT id, name, default_lead_days FROM suppliers WHERE active = 1 ORDER BY name'
    ),
    'booking'   => [
        'service_types'    => Booking::SERVICE_TYPES,
        'statuses'         => Booking::STATUSES,
        'channels'         => Booking::CHANNELS,
        'intake_questions' => Booking::INTAKE_QUESTIONS,
    ],
    /* ใครเลือกได้ในขั้นไหน (services/ProcessStaff.php) — ช่องเลือกพนักงานของหน้าเคสกรองจากชุดนี้ */
    'process_staff' => (object) ProcessStaff::config(),
    'today'     => today(),
    'now'       => nowStamp(),
]);
