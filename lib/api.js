// TimeOptic Web — JSON API over the MariaDB `timeoptic` schema
import {
  all, get, run, tx, lists, caseStatuses, invoiceCode, nextCode, nowStamp, today,
} from './db.js';
import {
  SERVICE_TYPES, BOOKING_STATUSES, BOOKING_CHANNELS, INTAKE_QUESTIONS, REFERRAL_SOURCES,
  RX_SOURCES, RX_SOURCES_OLD, RX_SOURCES_MEASURED, OLD_GLASSES_TYPES,
} from './migrate.js';

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */
const num = (v, d = 0) =>
  (v === '' || v === null || v === undefined || isNaN(Number(v)) ? d : Number(v));
const int = (v, d = null) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const str = (v, d = '') => (v === null || v === undefined ? d : String(v).trim());
/** '' -> null, for nullable text/date columns */
const nul = (v) => {
  const s = str(v);
  return s === '' ? null : s;
};
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0);
const like = (q) => '%' + String(q).trim().replace(/[%_\\]/g, (m) => '\\' + m) + '%';
const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => { throw new HttpError(400, msg); };
const missing = (msg = 'ไม่พบข้อมูล / Not found') => { throw new HttpError(404, msg); };

/* ------------------------------------------------------------------ *
 * router
 * ------------------------------------------------------------------ */
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:([a-z_]+)/gi, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  }) + '$');
  routes.push({ method, rx, keys, handler });
};
const GET = (p, h) => route('GET', p, h);
const POST = (p, h) => route('POST', p, h);
const PUT = (p, h) => route('PUT', p, h);
const DELETE = (p, h) => route('DELETE', p, h);

export async function handle(method, pathname, query, body) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.rx.exec(pathname);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return r.handler({ params, query, body: body || {} });
  }
  throw new HttpError(404, `No route for ${method} ${pathname}`);
}

/* ------------------------------------------------------------------ *
 * shared SQL fragments
 * ------------------------------------------------------------------ */
const ORDER_SELECT = `
  o.*, c.first_name, c.last_name, c.phone, c.line_id,
  e.employee_name AS employee_name,
  ce.employee_name AS close_employee_name,
  cs.case_code,
  COALESCE(pay.paid, 0) AS paid,
  o.total_price - o.discount - COALESCE(pay.paid, 0) AS balance`;
const ORDER_FROM = `
  FROM custom_orders o
  JOIN customers c        ON c.id  = o.customer_id
  LEFT JOIN employees e   ON e.id  = o.employee_id
  LEFT JOIN employees ce  ON ce.id = o.order_close_employee_id
  LEFT JOIN cases cs      ON cs.id = o.case_id
  LEFT JOIN (SELECT order_id, SUM(amount) paid FROM payments
             WHERE order_id IS NOT NULL GROUP BY order_id) pay ON pay.order_id = o.id`;
const UNFILLED = `(COALESCE(o.lens_product_id,0)=0
                OR COALESCE(o.right_lens_product_id,0)=0
                OR COALESCE(o.frame_product_id,0)=0)`;

/** append a row to the case audit log */
async function logEvent(q, caseId, fields) {
  if (!caseId) return;
  await q.run(
    `INSERT INTO case_events (case_id, from_status, to_status, action, entity,
       entity_id, employee_id, note, payload)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    caseId, nul(fields.from_status), nul(fields.to_status), str(fields.action),
    nul(fields.entity), int(fields.entity_id), int(fields.employee_id),
    nul(fields.note), fields.payload ? JSON.stringify(fields.payload) : null);
}

/** move a case to a new status (validated) and log it */
async function setStatus(q, caseId, toStatus, { employee_id, note, action } = {}) {
  if (!caseId || !toStatus) return;
  const c = await q.get('SELECT id, status FROM cases WHERE id = ?', caseId);
  if (!c) return;
  const ok = await q.get('SELECT code FROM case_statuses WHERE code = ?', toStatus);
  if (!ok) bad(`ไม่รู้จักสถานะ "${toStatus}"`);
  if (c.status === toStatus) return;
  const terminal = await q.get(
    'SELECT is_terminal FROM case_statuses WHERE code = ?', toStatus);
  await q.run(
    `UPDATE cases SET status = ?, closed_at = ${terminal?.is_terminal ? 'NOW()' : 'closed_at'}
     WHERE id = ?`, toStatus, caseId);
  await logEvent(q, caseId, {
    from_status: c.status, to_status: toStatus,
    action: action || 'status_change', employee_id, note,
  });
}

/* ================================ META ============================= */
GET('/api/meta', async () => ({
  /* rx_source / old_glasses_type อยู่ในโค้ด ไม่ได้อยู่ในตาราง จึงต่อท้ายตรงนี้ */
  lists: {
    ...(await lists()),
    rx_source: RX_SOURCES,
    rx_source_old: RX_SOURCES_OLD,
    rx_source_measured: RX_SOURCES_MEASURED,
    old_glasses_type: OLD_GLASSES_TYPES,
  },
  employees: await all(
    `SELECT id, employee_name, first_name, last_name, roles
     FROM employees WHERE active = 1 ORDER BY employee_name`),
  statuses: await caseStatuses(),
  suppliers: await all(
    `SELECT id, name, default_lead_days FROM suppliers WHERE active = 1 ORDER BY name`),
  booking: {
    service_types: SERVICE_TYPES,
    statuses: BOOKING_STATUSES,
    channels: BOOKING_CHANNELS,
    intake_questions: INTAKE_QUESTIONS,
  },
  referral_sources: REFERRAL_SOURCES,
  today: today(),
  now: nowStamp(),
}));

/* ============================= DASHBOARD =========================== */
GET('/api/dashboard', async () => {
  const d = today();
  const bookingsToday = await all(`
    SELECT b.*, e.employee_name AS assigned_name,
           COALESCE(c.first_name, b.first_name) AS first_name,
           COALESCE(c.last_name,  b.last_name)  AS last_name,
           COALESCE(c.phone,      b.phone)      AS phone,
           ca.case_code,
           TIMESTAMPDIFF(MINUTE, NOW(), TIMESTAMP(b.booking_date, b.booking_time)) AS mins_away
    FROM bookings b
    LEFT JOIN customers c ON c.id = b.customer_id
    LEFT JOIN employees e ON e.id = b.assigned_to
    LEFT JOIN cases ca    ON ca.id = b.case_id
    WHERE b.booking_date = CURDATE() AND b.status <> 'cancelled'
    ORDER BY b.booking_time`).catch(() => []);

  const [unfilled, unclosed, board, lens] = await Promise.all([
    all(`SELECT ${ORDER_SELECT} ${ORDER_FROM}
         WHERE o.order_closed = 0 AND ${UNFILLED}
         ORDER BY o.order_date DESC LIMIT 100`),
    all(`SELECT ${ORDER_SELECT} ${ORDER_FROM}
         WHERE o.order_closed = 0 AND NOT ${UNFILLED}
         ORDER BY o.appointment_date IS NULL, o.appointment_date, o.order_date DESC
         LIMIT 200`),
    all(`SELECT stage_group, COUNT(*) n FROM v_case_board
         WHERE is_terminal = 0 GROUP BY stage_group`),
    all(`SELECT risk_level, COUNT(*) n FROM v_lens_tracker GROUP BY risk_level`),
  ]);

  const one = async (sql, ...p) => (await get(sql, ...p)) || {};
  return {
    unfilled, unclosed,
    bookings_today: bookingsToday,
    board: Object.fromEntries(board.map((r) => [r.stage_group, r.n])),
    lens_risk: Object.fromEntries(lens.map((r) => [r.risk_level, r.n])),
    stats: {
      customers: (await one('SELECT COUNT(*) n FROM customers')).n,
      open_cases: (await one(
        `SELECT COUNT(*) n FROM cases c JOIN case_statuses s ON s.code = c.status
         WHERE s.is_terminal = 0`)).n,
      rush_cases: (await one(
        `SELECT COUNT(*) n FROM cases c JOIN case_statuses s ON s.code = c.status
         WHERE s.is_terminal = 0 AND c.is_rush = 1`)).n,
      open_orders: (await one(
        'SELECT COUNT(*) n FROM custom_orders WHERE order_closed = 0')).n,
      stock_on_hand: (await one('SELECT COALESCE(SUM(remaining_qty),0) n FROM stock_lots')).n,
      lens_waiting: (await one(
        `SELECT COUNT(*) n FROM lens_jobs WHERE status = 'waiting_arrival'`)).n,
      received_today: await one(
        `SELECT COUNT(*) n, COALESCE(SUM(amount),0) amount
         FROM payments WHERE DATE(paid_at) = ?`, d),
      sales_today: await one(
        `SELECT COUNT(*) n, COALESCE(SUM(price - discount),0) amount
         FROM sales WHERE DATE(sale_date) = ?`, d),
      expense_today: await one(
        'SELECT COALESCE(SUM(amount),0) amount FROM expenses WHERE cf_date = ?', d),
      appointments_today: (await one(
        `SELECT COUNT(*) n FROM custom_orders
         WHERE order_closed = 0 AND appointment_date = ?`, d)).n,
      bookings_today: bookingsToday.length,
      bookings_pending: bookingsToday.filter(
        (b) => b.status === 'booked' || b.status === 'confirmed').length,
    },
  };
});

/* =============================== CASES ============================= */
GET('/api/cases', async ({ query }) => {
  const where = [], args = [];
  const status = str(query.status), group = str(query.stage_group), q = str(query.q);
  if (status) { where.push('status = ?'); args.push(status); }
  if (group) { where.push('stage_group = ?'); args.push(group); }
  if (str(query.open) !== '0') where.push('is_terminal = 0');
  if (query.rush === '1') where.push('is_rush = 1');
  if (q) {
    const p = like(q);
    where.push(`(case_code LIKE ? OR first_name LIKE ? OR last_name LIKE ?
                 OR phone LIKE ? OR invoice_code LIKE ?)`);
    args.push(p, p, p, p, p);
  }
  return all(`SELECT * FROM v_case_board
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY is_rush DESC, status_order, opened_at
    LIMIT ?`, ...args, Math.min(int(query.limit, 300), 1000));
});

async function caseDetail(id) {
  const c = await get(
    `SELECT c.*, s.stage_no, s.label_th AS status_label_th, s.label_en AS status_label_en,
            s.stage_group, s.sort_order AS status_order, s.is_waiting, s.is_terminal,
            cu.first_name, cu.last_name, cu.phone, cu.line_id, cu.email, cu.sex,
            cu.nationality, cu.birth_date,
            rb.employee_name AS received_by_name
     FROM cases c
     JOIN case_statuses s   ON s.code = c.status
     JOIN customers cu      ON cu.id  = c.customer_id
     LEFT JOIN employees rb ON rb.id  = c.received_by
     WHERE c.id = ?`, id);
  if (!c) missing();

  const [rx, order, lensJob, centering, fitting, production, qc, payments, notifs, events] =
    await Promise.all([
      all(`SELECT p.*, pe.employee_name AS performed_by_name
           FROM prescriptions p LEFT JOIN employees pe ON pe.id = p.performed_by
           WHERE p.case_id = ? OR (p.customer_id = ? AND p.case_id IS NULL)
           ORDER BY FIELD(p.kind,'final','measured','old'), p.test_date DESC`, id, c.customer_id),
      get(`SELECT ${ORDER_SELECT} ${ORDER_FROM} WHERE o.case_id = ?
           ORDER BY o.id DESC LIMIT 1`, id),
      get(`SELECT lj.*, sup.name AS supplier_name,
                  ls.product_name AS left_lens_name, rs.product_name AS right_lens_name
           FROM lens_jobs lj
           LEFT JOIN suppliers sup ON sup.id = lj.supplier_id
           LEFT JOIN v_stock_lot ls ON ls.id  = lj.left_lens_stock_id
           LEFT JOIN v_stock_lot rs ON rs.id  = lj.right_lens_stock_id
           WHERE lj.case_id = ? ORDER BY lj.id DESC LIMIT 1`, id),
      get('SELECT * FROM centerings WHERE case_id = ? ORDER BY id DESC LIMIT 1', id),
      get('SELECT * FROM frame_fittings WHERE case_id = ? ORDER BY id DESC LIMIT 1', id),
      get('SELECT * FROM production_jobs WHERE case_id = ? ORDER BY id DESC LIMIT 1', id),
      all(`SELECT q.*, e.employee_name AS checked_by_name FROM qc_checks q
           LEFT JOIN employees e ON e.id = q.checked_by
           WHERE q.case_id = ? ORDER BY q.attempt DESC, q.id DESC`, id),
      all(`SELECT p.*, e.employee_name AS received_by_name FROM payments p
           LEFT JOIN employees e ON e.id = p.received_by
           WHERE p.case_id = ? ORDER BY p.paid_at`, id),
      all(`SELECT n.*, e.employee_name AS contacted_by_name FROM customer_notifications n
           LEFT JOIN employees e ON e.id = n.contacted_by
           WHERE n.case_id = ? ORDER BY n.contacted_at DESC`, id),
      all(`SELECT ev.*, e.employee_name,
                  fs.label_th AS from_label, ts.label_th AS to_label
           FROM case_events ev
           LEFT JOIN employees e      ON e.id  = ev.employee_id
           LEFT JOIN case_statuses fs ON fs.code = ev.from_status
           LEFT JOIN case_statuses ts ON ts.code = ev.to_status
           WHERE ev.case_id = ? ORDER BY ev.created_at DESC, ev.id DESC LIMIT 200`, id),
    ]);

  if (lensJob) {
    lensJob.followups = await all(
      `SELECT f.*, e.employee_name AS contacted_by_name FROM lens_followups f
       LEFT JOIN employees e ON e.id = f.contacted_by
       WHERE f.lens_job_id = ? ORDER BY f.seq`, lensJob.id);
  }
  const paid = payments.reduce((a, p) => a + Number(p.amount), 0);
  return {
    ...c,
    prescriptions: rx, order, lens_job: lensJob, centering, frame_fitting: fitting,
    production, qc_checks: qc, payments, notifications: notifs, events,
    paid: round2(paid),
    balance: order ? round2(order.total_price - order.discount - paid) : null,
  };
}
GET('/api/cases/:id', ({ params }) => caseDetail(int(params.id)));

POST('/api/cases', async ({ body }) => {
  const cid = int(body.customer_id);
  if (!cid) bad('กรุณาเลือกลูกค้า');
  if (!await get('SELECT id FROM customers WHERE id = ?', cid)) bad('ไม่พบลูกค้ารายนี้');
  const code = str(body.case_code) || await nextCode('CASE', 'cases', 'case_code');
  return tx(async (q) => {
    const r = await q.run(
      `INSERT INTO cases (case_code, customer_id, status, is_new_customer, is_rush,
         priority_note, received_by, recorded_by, reception_note, notes, referral_source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      code, cid, str(body.status, 'reception'), bool(body.is_new_customer),
      bool(body.is_rush), nul(body.priority_note), int(body.received_by),
      int(body.recorded_by) || int(body.received_by), nul(body.reception_note),
      nul(body.notes), nul(body.referral_source));
    const id = r.insertId;
    await logEvent(q, id, {
      to_status: str(body.status, 'reception'), action: 'case_opened',
      employee_id: int(body.received_by), note: nul(body.reception_note),
    });
    return { id, case_code: code };
  }).then((res) => caseDetail(res.id));
});

PUT('/api/cases/:id', async ({ params, body }) => {
  const id = int(params.id);
  if (!await get('SELECT id FROM cases WHERE id = ?', id)) missing();
  await run(
    `UPDATE cases SET is_rush = ?, priority_note = ?, received_by = ?,
       reception_note = ?, notes = ? WHERE id = ?`,
    bool(body.is_rush), nul(body.priority_note), int(body.received_by),
    nul(body.reception_note), nul(body.notes), id);
  return caseDetail(id);
});

POST('/api/cases/:id/status', async ({ params, body }) => {
  const id = int(params.id);
  const to = str(body.status);
  if (!to) bad('กรุณาระบุสถานะปลายทาง');
  await tx(async (q) => {
    await setStatus(q, id, to, {
      employee_id: int(body.employee_id), note: nul(body.note), action: 'status_change',
    });
    if (to === 'cancelled' && nul(body.note)) {
      await q.run('UPDATE cases SET cancelled_reason = ? WHERE id = ?', str(body.note), id);
    }
  });
  return caseDetail(id);
});

POST('/api/cases/:id/note', async ({ params, body }) => {
  const id = int(params.id);
  if (!str(body.note)) bad('กรุณากรอกข้อความ');
  await tx((q) => logEvent(q, id, {
    action: 'note', employee_id: int(body.employee_id), note: str(body.note),
  }));
  return caseDetail(id);
});

POST('/api/cases/:id/notify', async ({ params, body }) => {
  const id = int(params.id);
  await tx(async (q) => {
    await q.run(
      `INSERT INTO customer_notifications (case_id, channel, contacted_by, result, note)
       VALUES (?,?,?,?,?)`,
      id, str(body.channel, 'phone'), int(body.contacted_by),
      str(body.result, 'reached'), nul(body.note));
    await logEvent(q, id, {
      action: 'customer_notified', entity: 'customer_notification',
      employee_id: int(body.contacted_by),
      note: `${str(body.channel, 'phone')} — ${str(body.result, 'reached')}`,
    });
    if (str(body.result) === 'reached') {
      const cur = await q.get('SELECT status FROM cases WHERE id = ?', id);
      if (cur && (cur.status === 'ready_notify' || cur.status === 'notified')) {
        await setStatus(q, id, 'waiting_pickup', {
          employee_id: int(body.contacted_by), action: 'customer_notified',
        });
      }
    }
  });
  return caseDetail(id);
});

/* ============================= CUSTOMERS =========================== */
GET('/api/customers', async ({ query }) => {
  const q = str(query.q);
  const limit = Math.min(int(query.limit, 200), 1000);
  if (!q) return all('SELECT * FROM customers ORDER BY id DESC LIMIT ?', limit);
  const p = like(q);
  return all(
    `SELECT * FROM customers
     WHERE first_name LIKE ? OR last_name LIKE ? OR phone LIKE ?
        OR email LIKE ? OR line_id LIKE ? OR notes LIKE ? OR CAST(id AS CHAR) = ?
     ORDER BY id DESC LIMIT ?`, p, p, p, p, p, p, q, limit);
});

GET('/api/customers/:id', async ({ params }) => {
  const id = int(params.id);
  const c = await get('SELECT * FROM customers WHERE id = ?', id);
  if (!c) missing();
  c.prescriptions = await all(
    `SELECT p.*, e.employee_name FROM prescriptions p
     LEFT JOIN employees e ON e.id = p.performed_by
     WHERE p.customer_id = ? ORDER BY p.test_date DESC, p.id DESC`, id);
  c.orders = await all(
    `SELECT ${ORDER_SELECT} ${ORDER_FROM} WHERE o.customer_id = ?
     ORDER BY o.order_date DESC`, id);
  c.cases = await all(
    'SELECT * FROM v_case_board WHERE customer_id = ? ORDER BY opened_at DESC', id);
  return c;
});

const customerCols = (b) => [
  str(b.first_name), nul(b.mid_name), nul(b.last_name), nul(b.sex), nul(b.nationality),
  nul(b.email), nul(b.phone), nul(b.line_id), nul(b.birth_date), nul(b.notes)];

POST('/api/customers', async ({ body }) => {
  if (!str(body.first_name) && !str(body.last_name)) bad('กรุณากรอกชื่อลูกค้า');
  const r = await run(
    `INSERT INTO customers (first_name, mid_name, last_name, sex, nationality,
       email, phone, line_id, birth_date, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?)`, ...customerCols(body));
  return get('SELECT * FROM customers WHERE id = ?', r.insertId);
});

PUT('/api/customers/:id', async ({ params, body }) => {
  const id = int(params.id);
  if (!await get('SELECT id FROM customers WHERE id = ?', id)) missing();
  await run(
    `UPDATE customers SET first_name=?, mid_name=?, last_name=?, sex=?, nationality=?,
       email=?, phone=?, line_id=?, birth_date=?, notes=? WHERE id=?`,
    ...customerCols(body), id);
  return get('SELECT * FROM customers WHERE id = ?', id);
});

DELETE('/api/customers/:id', async ({ params }) => {
  const id = int(params.id);
  const n = (await get('SELECT COUNT(*) n FROM custom_orders WHERE customer_id = ?', id)).n;
  if (n) bad(`ลบไม่ได้ — ลูกค้ารายนี้มีออเดอร์ ${n} รายการ`);
  const k = (await get('SELECT COUNT(*) n FROM cases WHERE customer_id = ?', id)).n;
  if (k) bad(`ลบไม่ได้ — ลูกค้ารายนี้มีเคส ${k} รายการ`);
  await run('DELETE FROM customers WHERE id = ?', id);
  return { ok: true };
});

/* ============================= EMPLOYEES =========================== */
GET('/api/employees', () =>
  all('SELECT * FROM employees ORDER BY active DESC, employee_name'));

POST('/api/employees', async ({ body }) => {
  if (!str(body.employee_name)) bad('กรุณากรอกชื่อเล่นพนักงาน');
  const r = await run(
    `INSERT INTO employees (employee_name, first_name, last_name, sex, birth_date, roles, active)
     VALUES (?,?,?,?,?,?,1)`,
    str(body.employee_name), nul(body.first_name), nul(body.last_name),
    nul(body.sex), nul(body.birth_date), nul(body.roles));
  return get('SELECT * FROM employees WHERE id = ?', r.insertId);
});

PUT('/api/employees/:id', async ({ params, body }) => {
  const id = int(params.id);
  if (!await get('SELECT id FROM employees WHERE id = ?', id)) missing();
  await run(
    `UPDATE employees SET employee_name=?, first_name=?, last_name=?, sex=?,
       birth_date=?, roles=?, active=? WHERE id=?`,
    str(body.employee_name), nul(body.first_name), nul(body.last_name), nul(body.sex),
    nul(body.birth_date), nul(body.roles), bool(body.active), id);
  return get('SELECT * FROM employees WHERE id = ?', id);
});

/* =========================== PRESCRIPTIONS ========================= */
const RX_VALUE_COLS = [
  'r_sphere', 'r_cylinder', 'r_axis', 'r_add', 'r_pd', 'r_va', 'r_prism', 'r_base',
  'l_sphere', 'l_cylinder', 'l_axis', 'l_add', 'l_pd', 'l_va', 'l_prism', 'l_base',
  'pd_total',
  'bin_r_sphere', 'bin_r_add', 'bin_r_va', 'bin_r_pd',
  'bin_l_sphere', 'bin_l_add', 'bin_l_va', 'bin_l_pd',
  'dist_vertical_r', 'dist_vertical_l', 'dist_monitor_r', 'dist_monitor_l',
  'va_naked_r', 'va_naked_l',
  'old_r_sphere', 'old_r_add', 'old_r_va', 'old_r_pd',
  'old_l_sphere', 'old_l_add', 'old_l_va', 'old_l_pd',
];
const RX_HEALTH = ['health_cataract', 'health_eye_surgery', 'health_diabetes',
  'health_bp', 'health_heart'];

GET('/api/prescriptions', async ({ query }) => {
  const base = `SELECT p.*, c.first_name, c.last_name, c.phone, e.employee_name
                FROM prescriptions p
                JOIN customers c      ON c.id = p.customer_id
                LEFT JOIN employees e ON e.id = p.performed_by`;
  const cid = int(query.customer_id), q = str(query.q);
  const limit = Math.min(int(query.limit, 200), 1000);
  if (cid) return all(`${base} WHERE p.customer_id = ? ORDER BY p.test_date DESC`, cid);
  if (q) {
    const p = like(q);
    return all(`${base}
      WHERE c.first_name LIKE ? OR c.last_name LIKE ? OR c.phone LIKE ?
         OR CAST(p.id AS CHAR) = ?
      ORDER BY p.test_date DESC LIMIT ?`, p, p, p, q, limit);
  }
  return all(`${base} ORDER BY p.test_date DESC, p.id DESC LIMIT ?`, limit);
});

GET('/api/prescriptions/:id', async ({ params }) => {
  const r = await get(
    `SELECT p.*, c.first_name, c.last_name, c.phone, c.sex, c.nationality,
            e.employee_name
     FROM prescriptions p
     JOIN customers c      ON c.id = p.customer_id
     LEFT JOIN employees e ON e.id = p.performed_by
     WHERE p.id = ?`, int(params.id));
  if (!r) missing();
  return r;
});

function rxColsValues(b) {
  const cols = ['case_id', 'customer_id', 'kind', 'source', 'based_on_id', 'adjust_reason',
    'test_date', 'test_for', ...RX_VALUE_COLS, 'old_glasses_type', ...RX_HEALTH,
    'health_note', 'known_from', 'exam_note', 'notes',
    'performed_by', 'recorded_by'];
  const vals = cols.map((c) => {
    if (c === 'case_id' || c === 'customer_id' || c === 'based_on_id'
      || c === 'performed_by' || c === 'recorded_by') return int(b[c]);
    if (c === 'kind') return ['old', 'measured', 'final'].includes(str(b.kind)) ? str(b.kind) : 'measured';
    if (c === 'test_date') return str(b.test_date) || nowStamp();
    if (RX_HEALTH.includes(c)) return bool(b[c]);
    return nul(b[c]);
  });
  return { cols, vals };
}

POST('/api/prescriptions', async ({ body }) => {
  if (!int(body.customer_id)) bad('กรุณาเลือกลูกค้า');
  const { cols, vals } = rxColsValues(body);
  const r = await tx(async (q) => {
    const res = await q.run(
      `INSERT INTO prescriptions (${cols.join(',')})
       VALUES (${cols.map(() => '?').join(',')})`, ...vals);
    await logEvent(q, int(body.case_id), {
      action: 'prescription_added', entity: 'prescription', entity_id: res.insertId,
      employee_id: int(body.performed_by), note: `kind=${vals[cols.indexOf('kind')]}`,
    });
    return res;
  });
  return get('SELECT * FROM prescriptions WHERE id = ?', r.insertId);
});

PUT('/api/prescriptions/:id', async ({ params, body }) => {
  const id = int(params.id);
  if (!await get('SELECT id FROM prescriptions WHERE id = ?', id)) missing();
  const { cols, vals } = rxColsValues(body);
  await run(`UPDATE prescriptions SET ${cols.map((c) => c + '=?').join(',')} WHERE id=?`,
    ...vals, id);
  return get('SELECT * FROM prescriptions WHERE id = ?', id);
});

POST('/api/prescriptions/:id/confirm', async ({ params, body }) => {
  const id = int(params.id);
  const rx = await get('SELECT * FROM prescriptions WHERE id = ?', id);
  if (!rx) missing();
  await tx(async (q) => {
    await q.run(
      `UPDATE prescriptions SET kind = 'final', confirmed_by = ?, confirmed_at = NOW()
       WHERE id = ?`, int(body.employee_id), id);
    if (rx.case_id) {
      await q.run('UPDATE custom_orders SET final_prescription_id = ? WHERE case_id = ?',
        id, rx.case_id);
      await logEvent(q, rx.case_id, {
        action: 'prescription_confirmed', entity: 'prescription', entity_id: id,
        employee_id: int(body.employee_id),
      });
    }
  });
  return get('SELECT * FROM prescriptions WHERE id = ?', id);
});

/* =============================== STOCK =============================
   สต็อกจริงเก็บเป็น products (ระดับ SKU) + stock_lots (ล็อตที่รับเข้าแต่ละครั้ง
   มี remaining_qty แทน "sold ต่อชิ้น" เดิม) — ดู lib/migrate.js
   Endpoint กลุ่มนี้ path และรูปคำตอบยังเหมือนตาราง stock เดิมทุกช่อง
   ฝั่งหน้าเว็บ (public/js) จึงไม่ต้องแก้ — ข้างในคุยกับตารางใหม่ทั้งหมด
   v_stock_lot คือ view อ่านอย่างเดียวที่ต่อ products+stock_lots ให้หน้าตาแบบ "1 ล็อต 1 แถว"
   ใช้ตรงนี้และจุดอื่นที่ต้องการแค่ join อ่านชื่อ/ราคา ไม่ใช่รายชิ้นจริง */

const PRODUCT_ATTR_FIELDS = ['model', 'color', 'size', 'lens_design', 'lens_index',
  'coating', 'tint', 'addons', 'product_line', 'vendor_name'];

/** ขยาย 1 แถวล็อต (มี initial_qty/remaining_qty) เป็นแถวรายชิ้นจริง
    ใช้เฉพาะจุดที่ต้องนับ/พิมพ์เป็นรายชิ้น (หน้าคลัง, ป้ายราคา, รายงานค้างสต็อก)
    จุดอื่นที่แค่ต้องรู้ยอดรวมใช้ SUM(remaining_qty) ตรง ๆ เร็วกว่า ไม่ต้องขยาย */
function expandLots(lots) {
  const out = [];
  for (const lot of lots) {
    for (let i = 0; i < lot.remaining_qty; i++) out.push({ ...lot, sold: 0 });
    for (let i = 0; i < lot.initial_qty - lot.remaining_qty; i++) out.push({ ...lot, sold: 1 });
  }
  return out;
}

/** ตัดสต็อก 1 ชิ้นจากล็อตที่ระบุ (แทน UPDATE stock SET sold=1 เดิม)
    คืน false ถ้าล็อตไม่เหลือของแล้ว (กันขาย/จองซ้อน) — ไม่ทำอะไรถ้า lotId ว่าง */
async function pickLot(q, lotId, note) {
  if (!lotId) return true;
  const r = await q.run(
    'UPDATE stock_lots SET remaining_qty = remaining_qty - 1 WHERE id = ? AND remaining_qty > 0',
    lotId);
  if (!r.affectedRows) return false;
  const lot = await q.get('SELECT product_id FROM stock_lots WHERE id = ?', lotId);
  await q.run(
    `INSERT INTO inventory_logs (product_id, lot_id, action_type, quantity, notes)
     VALUES (?,?,'OUT',-1,?)`, lot.product_id, lotId, nul(note));
  return true;
}

/** คืนสต็อก 1 ชิ้นกลับล็อต (แทน UPDATE stock SET sold=0 เดิม) */
async function releaseLot(q, lotId, note) {
  if (!lotId) return;
  const r = await q.run('UPDATE stock_lots SET remaining_qty = remaining_qty + 1 WHERE id = ?', lotId);
  if (!r.affectedRows) return;
  const lot = await q.get('SELECT product_id FROM stock_lots WHERE id = ?', lotId);
  await q.run(
    `INSERT INTO inventory_logs (product_id, lot_id, action_type, quantity, notes)
     VALUES (?,?,'RETURN',1,?)`, lot.product_id, lotId, nul(note));
}

/** หา product เดิมด้วย sku (ถ้ามีของ sku นี้อยู่แล้ว = รับล็อตใหม่เข้าของเดิม)
    ไม่งั้นสร้าง product ใหม่ — ตรงกับพฤติกรรมเดิมที่ "เพิ่มเข้าคลัง" แต่ละครั้งคือของชิ้นใหม่ */
async function findOrCreateProduct(q, b) {
  const sku = nul(b.sku);
  if (sku) {
    const existing = await q.get('SELECT id FROM products WHERE sku = ?', sku);
    if (existing) return existing.id;
  }
  const cat = await q.get('SELECT id FROM categories WHERE code = ?', str(b.product_type, 'Frame'));
  if (!cat) bad('ไม่รู้จักประเภทสินค้า: ' + b.product_type);
  const attrs = JSON.stringify(Object.fromEntries(PRODUCT_ATTR_FIELDS.map((f) => [f, nul(b[f])])));
  const finalSku = sku || `SKU-${Date.now().toString(36).toUpperCase()}${int(b.__seq, 0)}`;
  const r = await q.run(
    `INSERT INTO products (sku, category_id, product_type, name, brand, base_selling_price,
       is_custom_made, attributes)
     VALUES (?,?,?,?,?,?,0,?)`,
    finalSku, cat.id, str(b.product_type, 'Frame'), str(b.product_name), nul(b.brand),
    num(b.product_price), attrs);
  return r.insertId;
}

GET('/api/stock', async ({ query }) => {
  const q = str(query.q), type = str(query.type), sold = str(query.sold);
  const where = [], args = [];
  if (q) {
    const p = like(q);
    where.push(`(s.product_name LIKE ? OR s.brand LIKE ? OR s.brand_name LIKE ?
                 OR s.vendor_name LIKE ? OR s.sku LIKE ? OR CAST(s.id AS CHAR) = ?)`);
    args.push(p, p, p, p, p, q);
  }
  if (type) { where.push('s.product_type = ?'); args.push(type); }
  const lots = await all(`SELECT s.*, l.location, sup.name AS supplier_name
    FROM v_stock_lot s
    LEFT JOIN product_locations l ON l.product_name = s.product_name
    LEFT JOIN suppliers sup       ON sup.id = s.supplier_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.id DESC`);
  let rows = expandLots(lots);
  if (sold === '0' || sold === '1') rows = rows.filter((r) => r.sold === Number(sold));
  return rows.slice(0, Math.min(int(query.limit, 300), 2000));
});

GET('/api/stock/names', ({ query }) => {
  const type = str(query.type);
  return all(
    `SELECT p.name AS product_name, p.product_type, MAX(p.base_selling_price) product_price,
            COALESCE(SUM(sl.initial_qty),0) n
     FROM products p LEFT JOIN stock_lots sl ON sl.product_id = p.id
     ${type ? 'WHERE p.product_type = ?' : ''}
     GROUP BY p.name, p.product_type ORDER BY p.name`,
    ...(type ? [type] : []));
});

GET('/api/stock/:id', async ({ params }) => {
  const s = await get(`SELECT s.*, l.location FROM v_stock_lot s
    LEFT JOIN product_locations l ON l.product_name = s.product_name
    WHERE s.id = ? LIMIT 1`, int(params.id));
  if (!s) missing();
  return s;
});

POST('/api/stock', async ({ body }) => {
  if (!str(body.product_name)) bad('กรุณากรอกชื่อสินค้า');
  const amount = Math.min(Math.max(int(body.amount, 1), 1), 500);
  const stockDate = str(body.stock_date) || nowStamp();
  const lotId = await tx(async (q) => {
    const productId = await findOrCreateProduct(q, body);
    const r = await q.run(
      `INSERT INTO stock_lots (lot_number, product_id, supplier_id, cost_per_unit,
         initial_qty, remaining_qty, received_date, notes)
       VALUES (?,?,?,?,?,?,DATE(?),?)`,
      `LOT-${Date.now().toString(36).toUpperCase()}`, productId, int(body.supplier_id),
      num(body.product_expense), amount, amount, stockDate, nul(body.notes));
    await q.run(
      `INSERT INTO inventory_logs (product_id, lot_id, action_type, quantity, notes)
       VALUES (?,?,'IN',?,'รับเข้าคลัง')`, productId, r.insertId, amount);
    return r.insertId;
  });
  // เดิมคืน ids แยกรายชิ้น ตอนนี้ทุกชิ้นในล็อตเดียวกันแชร์รหัสเดียวกัน
  return { ok: true, ids: [lotId], count: amount };
});

PUT('/api/stock/:id', async ({ params, body }) => {
  const id = int(params.id);
  const lot = await get('SELECT * FROM stock_lots WHERE id = ?', id);
  if (!lot) missing();
  const attrs = JSON.stringify(Object.fromEntries(PRODUCT_ATTR_FIELDS.map((f) => [f, nul(body[f])])));
  await tx(async (q) => {
    // ชื่อ/ราคา/สเปก เป็นของ SKU ร่วมกันทุกล็อต ส่วนต้นทุน/ผู้ขาย/หมายเหตุ เป็นของล็อตนี้ล็อตเดียว
    await q.run(
      `UPDATE products SET product_type=?, name=?, brand=?, base_selling_price=?, attributes=?
       WHERE id = (SELECT product_id FROM stock_lots WHERE id = ?)`,
      str(body.product_type, 'Frame'), str(body.product_name), nul(body.brand),
      num(body.product_price), attrs, id);
    await q.run(
      `UPDATE stock_lots SET supplier_id=?, cost_per_unit=?, notes=? WHERE id = ?`,
      int(body.supplier_id), num(body.product_expense), nul(body.notes), id);
  });
  return get('SELECT s.* FROM v_stock_lot s WHERE s.id = ?', id);
});

DELETE('/api/stock/:id', async ({ params }) => {
  const id = int(params.id);
  const lot = await get('SELECT * FROM stock_lots WHERE id = ?', id);
  if (!lot) missing();
  if (!lot.remaining_qty) bad('ลบไม่ได้ — สินค้าล็อตนี้ขายหมดแล้ว');
  await tx(async (q) => {
    // log ก่อนเสมอ ถ้าลบ lot ทิ้งทีหลัง FK จะหา lot_id ไม่เจอ (ลำดับสำคัญ)
    await q.run(
      `INSERT INTO inventory_logs (product_id, lot_id, action_type, quantity, notes)
       VALUES (?,?,'ADJUST',-1,'ลบออกจากหน้าคลัง')`, lot.product_id, id);
    if (lot.initial_qty <= 1) {
      // FK ของ inventory_logs.lot_id เป็น ON DELETE SET NULL อยู่แล้ว ไม่ต้อง NULL เอง
      await q.run('DELETE FROM stock_lots WHERE id = ?', id);
    } else {
      await q.run(
        'UPDATE stock_lots SET initial_qty = initial_qty - 1, remaining_qty = remaining_qty - 1 WHERE id = ?',
        id);
    }
  });
  return { ok: true };
});

/* ========================= PRODUCT LOCATIONS ======================= */
GET('/api/locations', ({ query }) => {
  const q = str(query.q);
  if (q) {
    const p = like(q);
    return all(`SELECT * FROM product_locations
      WHERE product_name LIKE ? OR location LIKE ?
      ORDER BY product_name LIMIT 500`, p, p);
  }
  return all('SELECT * FROM product_locations ORDER BY product_name LIMIT 500');
});
POST('/api/locations', async ({ body }) => {
  if (!str(body.product_name)) bad('กรุณากรอกชื่อสินค้า');
  if (!str(body.location)) bad('กรุณากรอกตำแหน่ง');
  const r = await run('INSERT INTO product_locations (product_name, location) VALUES (?,?)',
    str(body.product_name), str(body.location));
  return get('SELECT * FROM product_locations WHERE id = ?', r.insertId);
});
PUT('/api/locations/:id', async ({ params, body }) => {
  await run('UPDATE product_locations SET product_name=?, location=? WHERE id=?',
    str(body.product_name), str(body.location), int(params.id));
  return get('SELECT * FROM product_locations WHERE id = ?', int(params.id));
});
DELETE('/api/locations/:id', async ({ params }) => {
  await run('DELETE FROM product_locations WHERE id = ?', int(params.id));
  return { ok: true };
});

/* ============================= SUPPLIERS =========================== */
GET('/api/suppliers', () => all('SELECT * FROM suppliers ORDER BY active DESC, name'));
POST('/api/suppliers', async ({ body }) => {
  if (!str(body.name)) bad('กรุณากรอกชื่อซัพพลายเออร์');
  const r = await run(
    `INSERT INTO suppliers (name, contact_person, phone, email, default_lead_days, notes)
     VALUES (?,?,?,?,?,?)`,
    str(body.name), nul(body.contact_person), nul(body.phone), nul(body.email),
    int(body.default_lead_days, 7), nul(body.notes));
  return get('SELECT * FROM suppliers WHERE id = ?', r.insertId);
});
PUT('/api/suppliers/:id', async ({ params, body }) => {
  await run(`UPDATE suppliers SET name=?, contact_person=?, phone=?, email=?,
      default_lead_days=?, active=?, notes=? WHERE id=?`,
    str(body.name), nul(body.contact_person), nul(body.phone), nul(body.email),
    int(body.default_lead_days, 7), bool(body.active), nul(body.notes), int(params.id));
  return get('SELECT * FROM suppliers WHERE id = ?', int(params.id));
});

/* =============================== ORDERS ============================ */
GET('/api/orders', ({ query }) => {
  const status = str(query.status, 'all');
  const where = [], args = [];
  if (status === 'unfilled') where.push(`o.order_closed = 0 AND ${UNFILLED}`);
  else if (status === 'unclosed') where.push(`o.order_closed = 0 AND NOT ${UNFILLED}`);
  else if (status === 'open') where.push('o.order_closed = 0');
  else if (status === 'closed') where.push('o.order_closed = 1');

  if (int(query.customer_id)) { where.push('o.customer_id = ?'); args.push(int(query.customer_id)); }
  if (int(query.case_id)) { where.push('o.case_id = ?'); args.push(int(query.case_id)); }
  if (str(query.q)) {
    const p = like(query.q);
    where.push(`(c.first_name LIKE ? OR c.last_name LIKE ? OR c.phone LIKE ?
              OR o.invoice_code LIKE ? OR o.lens_name LIKE ? OR o.frame_name LIKE ?
              OR CAST(o.id AS CHAR) = ?)`);
    args.push(p, p, p, p, p, p, str(query.q));
  }
  if (str(query.from)) { where.push('DATE(o.order_date) >= ?'); args.push(str(query.from)); }
  if (str(query.to)) { where.push('DATE(o.order_date) <= ?'); args.push(str(query.to)); }

  return all(`SELECT ${ORDER_SELECT} ${ORDER_FROM}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY o.order_date DESC, o.id DESC LIMIT ?`,
  ...args, Math.min(int(query.limit, 200), 2000));
});

async function orderDetail(id) {
  const o = await get(`SELECT ${ORDER_SELECT}, c.sex, c.email, c.nationality,
      c.notes AS customer_notes ${ORDER_FROM} WHERE o.id = ?`, id);
  if (!o) missing();
  o.prescription = o.final_prescription_id
    ? await get('SELECT * FROM prescriptions WHERE id = ?', o.final_prescription_id) : null;
  const item = (sid) => (sid ? get('SELECT * FROM v_stock_lot WHERE id = ?', sid) : null);
  [o.left_lens, o.right_lens, o.frame] = await Promise.all([
    item(o.lens_product_id), item(o.right_lens_product_id), item(o.frame_product_id),
  ]);
  o.payment_rows = await all(
    `SELECT p.*, e.employee_name AS received_by_name FROM payments p
     LEFT JOIN employees e ON e.id = p.received_by
     WHERE p.order_id = ? ORDER BY p.paid_at`, id);
  o.balance = round2(o.total_price - o.discount - o.paid);
  return o;
}
GET('/api/orders/:id', ({ params }) => orderDetail(int(params.id)));

async function uniqueInvoice() {
  let code = invoiceCode(), i = 0;
  while (await get('SELECT id FROM custom_orders WHERE invoice_code = ?', code)) {
    code = invoiceCode(new Date(Date.now() + ++i * 1000));
  }
  return code;
}

const ORDER_COLS = ['case_id', 'customer_id', 'employee_id', 'recorded_by',
  'final_prescription_id', 'order_date', 'appointment_date', 'appointment_time',
  'lens_type', 'frame_product_id', 'frame_name', 'frame_brand', 'frame_model',
  'frame_color', 'frame_size', 'frame_sku', 'lens_product_id', 'right_lens_product_id',
  'lens_name', 'lens_brand', 'lens_design', 'lens_index', 'lens_coating', 'lens_tint',
  'lens_addons', 'total_price', 'discount', 'deposit', 'deposit_pay_type',
  'marketing', 'notes'];
const INT_ORDER_COLS = new Set(['case_id', 'customer_id', 'employee_id', 'recorded_by',
  'final_prescription_id', 'frame_product_id', 'lens_product_id', 'right_lens_product_id']);
const MONEY_ORDER_COLS = new Set(['total_price', 'discount', 'deposit']);
const orderVals = (b) => ORDER_COLS.map((c) => {
  if (INT_ORDER_COLS.has(c)) return int(b[c]);
  if (MONEY_ORDER_COLS.has(c)) return num(b[c]);
  if (c === 'order_date') return str(b.order_date) || nowStamp();
  return nul(b[c]);
});

POST('/api/orders', async ({ body }) => {
  const cid = int(body.customer_id);
  if (!cid) bad('กรุณาเลือกลูกค้า');
  if (!await get('SELECT id FROM customers WHERE id = ?', cid)) bad('ไม่พบลูกค้ารายนี้');
  const code = str(body.invoice_code) || await nextCode('INV', 'custom_orders', 'invoice_code');

  const id = await tx(async (q) => {
    const r = await q.run(
      `INSERT INTO custom_orders (invoice_code, ${ORDER_COLS.join(',')})
       VALUES (?, ${ORDER_COLS.map(() => '?').join(',')})`, code, ...orderVals(body));
    const oid = r.insertId;
    const deposit = num(body.deposit);
    if (deposit > 0) {
      await q.run(
        `INSERT INTO payments (case_id, order_id, kind, method, amount, received_by, notes)
         VALUES (?,?,?,?,?,?,?)`,
        int(body.case_id), oid, 'deposit', str(body.deposit_pay_type, 'Cash'),
        deposit, int(body.employee_id), 'มัดจำตอนเปิดออเดอร์');
    }
    await logEvent(q, int(body.case_id), {
      action: 'order_created', entity: 'custom_order', entity_id: oid,
      employee_id: int(body.employee_id), note: code,
    });
    if (int(body.case_id)) {
      await setStatus(q, int(body.case_id), deposit > 0 ? 'appointment' : 'order_confirm',
        { employee_id: int(body.employee_id), action: 'order_created' });
    }
    return oid;
  });
  return orderDetail(id);
});

PUT('/api/orders/:id', async ({ params, body }) => {
  const id = int(params.id);
  if (!await get('SELECT id FROM custom_orders WHERE id = ?', id)) missing();
  await run(`UPDATE custom_orders SET ${ORDER_COLS.map((c) => c + '=?').join(',')}
    WHERE id=?`, ...orderVals(body), id);
  return orderDetail(id);
});

POST('/api/orders/:id/fill', async ({ params, body }) => {
  const id = int(params.id);
  const o = await get('SELECT * FROM custom_orders WHERE id = ?', id);
  if (!o) missing();
  if (o.order_closed) bad('ออเดอร์นี้ปิดการขายแล้ว');

  const pick = async (key) => {
    const sid = int(body[key]);
    if (!sid) return null;
    const s = await get('SELECT * FROM v_stock_lot WHERE id = ?', sid);
    if (!s) bad(`ไม่พบสินค้ารหัส ${sid}`);
    if (s.sold) bad(`สินค้ารหัส ${sid} (${s.product_name}) ถูกขายไปแล้ว`);
    return s;
  };
  const [L, R, F] = await Promise.all([
    pick('lens_product_id'), pick('right_lens_product_id'), pick('frame_product_id')]);

  await tx(async (q) => {
    await q.run(
      `UPDATE custom_orders SET lens_product_id=?, right_lens_product_id=?,
         frame_product_id=?, lens_name=?, frame_name=?, appointment_date=?, notes=?
       WHERE id=?`,
      L ? L.id : null, R ? R.id : null, F ? F.id : null,
      str(body.lens_name) || (L || R ? (L || R).product_name : o.lens_name),
      str(body.frame_name) || (F ? F.product_name : o.frame_name),
      nul(body.appointment_date) || o.appointment_date,
      body.notes === undefined ? o.notes : nul(body.notes), id);
    await logEvent(q, o.case_id, {
      action: 'order_filled', entity: 'custom_order', entity_id: id,
      employee_id: int(body.employee_id),
      note: [L && `L#${L.id}`, R && `R#${R.id}`, F && `F#${F.id}`].filter(Boolean).join(' '),
    });
  });
  return orderDetail(id);
});

POST('/api/orders/:id/close', async ({ params, body }) => {
  const id = int(params.id);
  const o = await get('SELECT * FROM custom_orders WHERE id = ?', id);
  if (!o) missing();
  if (o.order_closed) bad('ออเดอร์นี้ปิดการขายไปแล้ว');

  await tx(async (q) => {
    const paidRow = await q.get(
      'SELECT COALESCE(SUM(amount),0) paid FROM payments WHERE order_id = ?', id);
    const balance = round2(o.total_price - o.discount - Number(paidRow.paid));
    const income = body.order_close_income === undefined || body.order_close_income === ''
      ? balance : num(body.order_close_income);
    const stamp = str(body.order_close_date) || nowStamp();
    const empId = int(body.order_close_employee_id) || o.employee_id;

    await q.run(
      `UPDATE custom_orders SET order_closed = 1, order_close_date = ?,
         order_close_employee_id = ?, order_close_income = ?, order_close_pay_type = ?,
         notes = ? WHERE id = ?`,
      stamp, empId, income, str(body.order_close_pay_type, 'Cash'),
      body.notes === undefined ? o.notes : nul(body.notes), id);

    if (income > 0) {
      await q.run(
        `INSERT INTO payments (case_id, order_id, kind, method, amount, received_by, paid_at, notes)
         VALUES (?,?,?,?,?,?,?,?)`,
        o.case_id, id, 'final', str(body.order_close_pay_type, 'Cash'), income,
        empId, stamp, 'รับเงินตอนปิดการขาย');
    }
    for (const sid of [o.lens_product_id, o.right_lens_product_id, o.frame_product_id]) {
      await pickLot(q, sid, `ปิดการขายออเดอร์ ${o.invoice_code}`);
    }
    await logEvent(q, o.case_id, {
      action: 'order_closed', entity: 'custom_order', entity_id: id,
      employee_id: empId, note: `รับเพิ่ม ${income}`,
    });
    if (o.case_id) {
      await setStatus(q, o.case_id, 'completed',
        { employee_id: empId, action: 'order_closed' });
    }
  });
  return orderDetail(id);
});

POST('/api/orders/:id/reopen', async ({ params, body }) => {
  const id = int(params.id);
  const o = await get('SELECT * FROM custom_orders WHERE id = ?', id);
  if (!o) missing();
  await tx(async (q) => {
    await q.run(
      `UPDATE custom_orders SET order_closed = 0, order_close_date = NULL,
        order_close_income = NULL WHERE id = ?`, id);
    await q.run(`DELETE FROM payments WHERE order_id = ? AND kind = 'final'`, id);
    for (const sid of [o.lens_product_id, o.right_lens_product_id, o.frame_product_id]) {
      await releaseLot(q, sid, `เปิดออเดอร์ ${o.invoice_code} กลับ`);
    }
    await logEvent(q, o.case_id, {
      action: 'order_reopened', entity: 'custom_order', entity_id: id,
      employee_id: int(body.employee_id),
    });
    if (o.case_id) await setStatus(q, o.case_id, 'waiting_pickup',
      { employee_id: int(body.employee_id), action: 'order_reopened' });
  });
  return orderDetail(id);
});

DELETE('/api/orders/:id', async ({ params }) => {
  const id = int(params.id);
  const o = await get('SELECT * FROM custom_orders WHERE id = ?', id);
  if (!o) missing();
  if (o.order_closed) bad('ลบไม่ได้ — ออเดอร์ปิดการขายแล้ว');
  await tx(async (q) => {
    await q.run('DELETE FROM payments WHERE order_id = ?', id);
    await q.run('DELETE FROM custom_orders WHERE id = ?', id);
  });
  return { ok: true };
});

/* ============================== PAYMENTS =========================== */
GET('/api/payments', ({ query }) => {
  const where = [], args = [];
  if (int(query.order_id)) { where.push('p.order_id = ?'); args.push(int(query.order_id)); }
  if (int(query.case_id)) { where.push('p.case_id = ?'); args.push(int(query.case_id)); }
  if (str(query.from)) { where.push('DATE(p.paid_at) >= ?'); args.push(str(query.from)); }
  if (str(query.to)) { where.push('DATE(p.paid_at) <= ?'); args.push(str(query.to)); }
  return all(`SELECT p.*, e.employee_name AS received_by_name,
      o.invoice_code, c.case_code
    FROM payments p
    LEFT JOIN employees e     ON e.id = p.received_by
    LEFT JOIN custom_orders o ON o.id = p.order_id
    LEFT JOIN cases c         ON c.id = p.case_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY p.paid_at DESC, p.id DESC LIMIT ?`,
  ...args, Math.min(int(query.limit, 300), 2000));
});

POST('/api/payments', async ({ body }) => {
  const amount = num(body.amount);
  if (!(amount > 0)) bad('จำนวนเงินต้องมากกว่า 0');
  const kind = ['deposit', 'partial', 'full', 'final'].includes(str(body.kind))
    ? str(body.kind) : 'partial';
  const id = await tx(async (q) => {
    const r = await q.run(
      `INSERT INTO payments (case_id, order_id, sale_id, kind, method, amount,
         reference, received_by, paid_at, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      int(body.case_id), int(body.order_id), int(body.sale_id), kind,
      str(body.method, 'Cash'), amount, nul(body.reference), int(body.received_by),
      str(body.paid_at) || nowStamp(), nul(body.notes));
    if (int(body.order_id) && kind === 'deposit') {
      await q.run(
        `UPDATE custom_orders SET deposit = deposit + ?, deposit_pay_type = COALESCE(deposit_pay_type, ?)
         WHERE id = ?`, amount, str(body.method, 'Cash'), int(body.order_id));
    }
    await logEvent(q, int(body.case_id), {
      action: 'payment', entity: 'payment', entity_id: r.insertId,
      employee_id: int(body.received_by), note: `${kind} ${amount} (${str(body.method, 'Cash')})`,
    });
    return r.insertId;
  });
  return get('SELECT * FROM payments WHERE id = ?', id);
});

DELETE('/api/payments/:id', async ({ params }) => {
  const id = int(params.id);
  const p = await get('SELECT * FROM payments WHERE id = ?', id);
  if (!p) missing();
  await tx(async (q) => {
    if (p.order_id && p.kind === 'deposit') {
      await q.run('UPDATE custom_orders SET deposit = GREATEST(deposit - ?, 0) WHERE id = ?',
        p.amount, p.order_id);
    }
    await q.run('DELETE FROM payments WHERE id = ?', id);
    await logEvent(q, p.case_id, {
      action: 'payment_deleted', entity: 'payment', entity_id: id, note: String(p.amount),
    });
  });
  return { ok: true };
});

/* ============================== LENS JOBS ========================== */
GET('/api/lens-tracker', ({ query }) => {
  const where = [], args = [];
  if (str(query.risk)) { where.push('risk_level = ?'); args.push(str(query.risk)); }
  if (query.threatens === '1') where.push('threatens_appointment = 1');
  return all(`SELECT * FROM v_lens_tracker
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY days_to_eta IS NULL, days_to_eta LIMIT 500`, ...args);
});

GET('/api/lens-jobs/:id', async ({ params }) => {
  const id = int(params.id);
  const j = await get(`SELECT lj.*, s.name AS supplier_name,
      ls.product_name AS left_lens_name, rs.product_name AS right_lens_name
    FROM lens_jobs lj
    LEFT JOIN suppliers s ON s.id = lj.supplier_id
    LEFT JOIN v_stock_lot ls ON ls.id = lj.left_lens_stock_id
    LEFT JOIN v_stock_lot rs ON rs.id = lj.right_lens_stock_id
    WHERE lj.id = ?`, id);
  if (!j) missing();
  j.followups = await all(
    `SELECT f.*, e.employee_name AS contacted_by_name FROM lens_followups f
     LEFT JOIN employees e ON e.id = f.contacted_by
     WHERE f.lens_job_id = ? ORDER BY f.seq`, id);
  return j;
});

/** create or update the lens job for a case */
POST('/api/lens-jobs', async ({ body }) => {
  const caseId = int(body.case_id);
  if (!caseId) bad('กรุณาระบุเคส');
  const source = str(body.source) === 'order' ? 'order' : 'stock';
  const status = str(body.status) ||
    (source === 'stock' ? 'ready' : 'waiting_arrival');

  const id = await tx(async (q) => {
    const existing = await q.get(
      'SELECT id FROM lens_jobs WHERE case_id = ? ORDER BY id DESC LIMIT 1', caseId);
    const cols = ['order_id', 'source', 'status', 'left_lens_stock_id', 'right_lens_stock_id',
      'rx_checked', 'lens_checked', 'picked_by', 'checked_by', 'supplier_id',
      'supplier_order_no', 'order_date', 'lead_time_days', 'expected_arrival',
      'recorded_by', 'notes'];
    const vals = [
      int(body.order_id), source, status,
      int(body.left_lens_stock_id), int(body.right_lens_stock_id),
      bool(body.rx_checked), bool(body.lens_checked),
      int(body.picked_by), int(body.checked_by), int(body.supplier_id),
      nul(body.supplier_order_no), nul(body.order_date), int(body.lead_time_days),
      nul(body.expected_arrival), int(body.recorded_by), nul(body.notes),
    ];
    let jid;
    if (existing) {
      await q.run(`UPDATE lens_jobs SET ${cols.map((c) => c + '=?').join(',')},
        picked_at = CASE WHEN ? = 1 AND picked_at IS NULL THEN NOW() ELSE picked_at END
        WHERE id = ?`, ...vals, source === 'stock' ? 1 : 0, existing.id);
      jid = existing.id;
    } else {
      const r = await q.run(
        `INSERT INTO lens_jobs (case_id, ${cols.join(',')}, original_eta, picked_at)
         VALUES (?, ${cols.map(() => '?').join(',')}, ?, ?)`,
        caseId, ...vals, nul(body.expected_arrival),
        source === 'stock' ? nowStamp() : null);
      jid = r.insertId;
    }
    await logEvent(q, caseId, {
      action: 'lens_job_saved', entity: 'lens_job', entity_id: jid,
      employee_id: int(body.recorded_by) || int(body.picked_by),
      note: `source=${source} status=${status}`,
    });
    await setStatus(q, caseId,
      source === 'stock' ? 'lens_ready' : 'waiting_lens_arrival',
      { employee_id: int(body.recorded_by), action: 'lens_job_saved' });
    return jid;
  });
  return handle('GET', '/api/lens-jobs/' + id, {}, {});
});

POST('/api/lens-jobs/:id/followup', async ({ params, body }) => {
  const id = int(params.id);
  const j = await get('SELECT * FROM lens_jobs WHERE id = ?', id);
  if (!j) missing();
  await tx(async (q) => {
    const seqRow = await q.get(
      'SELECT COALESCE(MAX(seq),0) s FROM lens_followups WHERE lens_job_id = ?', id);
    const newEta = nul(body.new_eta);
    await q.run(
      `INSERT INTO lens_followups (lens_job_id, seq, contacted_by, channel, previous_eta,
         new_eta, affects_appointment, customer_notified, notified_by,
         new_appointment_date, supplier_reply, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, Number(seqRow.s) + 1, int(body.contacted_by), nul(body.channel),
      j.expected_arrival, newEta, bool(body.affects_appointment),
      bool(body.customer_notified), int(body.notified_by),
      nul(body.new_appointment_date), nul(body.supplier_reply), nul(body.note));
    await q.run(
      `UPDATE lens_jobs SET follow_up_count = follow_up_count + 1,
        expected_arrival = COALESCE(?, expected_arrival) WHERE id = ?`, newEta, id);
    if (nul(body.new_appointment_date) && j.order_id) {
      await q.run('UPDATE custom_orders SET appointment_date = ? WHERE id = ?',
        str(body.new_appointment_date), j.order_id);
    }
    await logEvent(q, j.case_id, {
      action: 'lens_followup', entity: 'lens_job', entity_id: id,
      employee_id: int(body.contacted_by),
      note: newEta ? `ETA ใหม่ ${newEta}` : nul(body.note),
    });
  });
  return handle('GET', '/api/lens-jobs/' + id, {}, {});
});

POST('/api/lens-jobs/:id/receive', async ({ params, body }) => {
  const id = int(params.id);
  const j = await get('SELECT * FROM lens_jobs WHERE id = ?', id);
  if (!j) missing();
  await tx(async (q) => {
    await q.run(
      `UPDATE lens_jobs SET status = 'ready', received_at = ?, received_by = ?,
        arrival_checked_by = ?, lens_checked = 1 WHERE id = ?`,
      str(body.received_at) || nowStamp(), int(body.received_by),
      int(body.arrival_checked_by) || int(body.received_by), id);
    await logEvent(q, j.case_id, {
      action: 'lens_received', entity: 'lens_job', entity_id: id,
      employee_id: int(body.received_by), note: nul(body.note),
    });
    await setStatus(q, j.case_id, 'lens_received',
      { employee_id: int(body.received_by), action: 'lens_received' });
  });
  return handle('GET', '/api/lens-jobs/' + id, {}, {});
});

/* ================== CENTERING / FITTING / PRODUCTION =============== */
function upsertFactory({ table, cols, intCols = [], boolCols = [], action, status }) {
  return async ({ body }) => {
    const caseId = int(body.case_id);
    if (!caseId) bad('กรุณาระบุเคส');
    const vals = cols.map((c) => {
      if (intCols.includes(c)) return int(body[c]);
      if (boolCols.includes(c)) return bool(body[c]);
      return nul(body[c]);
    });
    const id = await tx(async (q) => {
      const ex = await q.get(
        `SELECT id FROM \`${table}\` WHERE case_id = ? ORDER BY id DESC LIMIT 1`, caseId);
      let rid;
      if (ex) {
        await q.run(`UPDATE \`${table}\` SET ${cols.map((c) => `\`${c}\`=?`).join(',')}
          WHERE id = ?`, ...vals, ex.id);
        rid = ex.id;
      } else {
        const r = await q.run(
          `INSERT INTO \`${table}\` (case_id, ${cols.map((c) => `\`${c}\``).join(',')})
           VALUES (?, ${cols.map(() => '?').join(',')})`, caseId, ...vals);
        rid = r.insertId;
      }
      await logEvent(q, caseId, {
        action, entity: table, entity_id: rid,
        employee_id: int(body.performed_by) || int(body.recorded_by) || int(body.employee_id),
      });
      if (status) await setStatus(q, caseId, status, {
        employee_id: int(body.performed_by) || int(body.recorded_by), action,
      });
      return rid;
    });
    return get(`SELECT * FROM \`${table}\` WHERE id = ?`, id);
  };
}

POST('/api/centerings', upsertFactory({
  table: 'centerings', action: 'centering_saved', status: 'order_confirm',
  cols: ['order_id', 'frame_product_id', 'r_pd', 'l_pd', 'pd_total', 'r_height', 'l_height',
    'r_seg_height', 'l_seg_height', 'vertex_distance', 'pantoscopic_tilt', 'wrap_angle',
    'center_point_note', 'other_params', 'performed_by', 'photo_taken_by', 'recorded_by', 'notes'],
  intCols: ['order_id', 'frame_product_id', 'performed_by', 'photo_taken_by', 'recorded_by'],
}));
GET('/api/centerings/:case_id', ({ params }) =>
  get('SELECT * FROM centerings WHERE case_id = ? ORDER BY id DESC LIMIT 1', int(params.case_id)));

POST('/api/frame-fittings', upsertFactory({
  table: 'frame_fittings', action: 'frame_fitting_saved', status: 'lens_source',
  cols: ['order_id', 'frame_size', 'lens_width', 'bridge_width', 'temple_length', 'ed', 'dbl',
    'r_pd', 'l_pd', 'r_height', 'l_height', 'fitting_data', 'other_params',
    'performed_by', 'recorded_by', 'notes'],
  intCols: ['order_id', 'performed_by', 'recorded_by'],
}));
GET('/api/frame-fittings/:case_id', ({ params }) =>
  get('SELECT * FROM frame_fittings WHERE case_id = ? ORDER BY id DESC LIMIT 1',
    int(params.case_id)));

POST('/api/production-jobs', upsertFactory({
  table: 'production_jobs', action: 'production_saved',
  cols: ['order_id', 'matched_at', 'matched_by', 'match_customer_ok', 'match_rx_ok',
    'match_note', 'assigned_technician', 'edging_started_at', 'edging_finished_at',
    'edged_by', 'edging_remark', 'pack_glasses', 'pack_case', 'pack_cloth',
    'pack_warranty', 'pack_prescription', 'pack_accessories', 'packed_by',
    'pack_checked_by', 'packed_at', 'packing_note', 'pickup_at', 'handed_over_by',
    'adjustment_by', 'adjustment_remark'],
  intCols: ['order_id', 'matched_by', 'assigned_technician', 'edged_by', 'packed_by',
    'pack_checked_by', 'handed_over_by', 'adjustment_by'],
  boolCols: ['match_customer_ok', 'match_rx_ok', 'pack_glasses', 'pack_case', 'pack_cloth',
    'pack_warranty', 'pack_prescription', 'pack_accessories'],
}));

POST('/api/qc-checks', async ({ body }) => {
  const caseId = int(body.case_id);
  if (!caseId) bad('กรุณาระบุเคส');
  const result = str(body.result) === 'fail' ? 'fail' : 'pass';
  const id = await tx(async (q) => {
    const a = await q.get(
      'SELECT COALESCE(MAX(attempt),0) n FROM qc_checks WHERE case_id = ?', caseId);
    const r = await q.run(
      `INSERT INTO qc_checks (case_id, job_id, attempt, result, action_taken,
         check_rx, check_centering, check_lens, check_frame, check_finish,
         defects, note, checked_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      caseId, int(body.job_id), Number(a.n) + 1, result, nul(body.action_taken),
      bool(body.check_rx), bool(body.check_centering), bool(body.check_lens),
      bool(body.check_frame), bool(body.check_finish),
      nul(body.defects), nul(body.note), int(body.checked_by));
    await logEvent(q, caseId, {
      action: 'qc_' + result, entity: 'qc_check', entity_id: r.insertId,
      employee_id: int(body.checked_by), note: nul(body.defects),
    });
    await setStatus(q, caseId, result === 'pass' ? 'packing' : 'qc_failed',
      { employee_id: int(body.checked_by), action: 'qc_' + result });
    return r.insertId;
  });
  return get('SELECT * FROM qc_checks WHERE id = ?', id);
});

/* =============================== SALES ============================= */
GET('/api/sales', ({ query }) => {
  const where = [], args = [];
  if (str(query.q)) {
    const p = like(query.q);
    where.push('(s.invoice_code LIKE ? OR st.product_name LIKE ? OR s.notes LIKE ?)');
    args.push(p, p, p);
  }
  if (str(query.from)) { where.push('DATE(s.sale_date) >= ?'); args.push(str(query.from)); }
  if (str(query.to)) { where.push('DATE(s.sale_date) <= ?'); args.push(str(query.to)); }
  return all(`SELECT s.*, st.product_name, st.product_type, e.employee_name,
      c.first_name, c.last_name
    FROM sales s
    LEFT JOIN v_stock_lot st ON st.id = s.product_stock_id
    LEFT JOIN employees e  ON e.id  = s.employee_id
    LEFT JOIN customers c  ON c.id  = s.customer_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.sale_date DESC, s.id DESC LIMIT ?`,
  ...args, Math.min(int(query.limit, 200), 2000));
});

POST('/api/sales', async ({ body }) => {
  const sid = int(body.product_stock_id);
  if (!sid) bad('กรุณาเลือกสินค้าจากคลัง');
  const id = await tx(async (q) => {
    const s = await q.get('SELECT * FROM v_stock_lot WHERE id = ?', sid);
    if (!s) bad(`ไม่พบสินค้ารหัส ${sid}`);
    if (s.sold) bad(`สินค้ารหัส ${sid} (${s.product_name}) ถูกขายไปแล้ว`);
    const stamp = str(body.sale_date) || nowStamp();
    const price = body.price === undefined || body.price === ''
      ? Number(s.product_price) : num(body.price);
    const r = await q.run(
      `INSERT INTO sales (invoice_code, sale_date, product_stock_id, customer_id,
         employee_id, price, discount, pay_type, marketing, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      str(body.invoice_code) || invoiceCode(), stamp, sid, int(body.customer_id),
      int(body.employee_id), price, num(body.discount),
      str(body.pay_type, 'Cash'), str(body.marketing, 'Walk-in'), nul(body.notes));
    if (!await pickLot(q, sid, `ขายสินค้า ${str(body.invoice_code) || ''}`.trim())) {
      bad(`สินค้ารหัส ${sid} (${s.product_name}) ถูกขายไปแล้ว`);
    }
    const net = round2(price - num(body.discount));
    if (net > 0) {
      await q.run(
        `INSERT INTO payments (sale_id, kind, method, amount, received_by, paid_at, notes)
         VALUES (?,?,?,?,?,?,?)`,
        r.insertId, 'full', str(body.pay_type, 'Cash'), net, int(body.employee_id),
        stamp, 'ขายสินค้าทั่วไป');
    }
    return r.insertId;
  });
  return get('SELECT * FROM sales WHERE id = ?', id);
});

DELETE('/api/sales/:id', async ({ params }) => {
  const id = int(params.id);
  const s = await get('SELECT * FROM sales WHERE id = ?', id);
  if (!s) missing();
  await tx(async (q) => {
    await releaseLot(q, s.product_stock_id, `ยกเลิกการขาย ${s.invoice_code || ''}`.trim());
    await q.run('DELETE FROM payments WHERE sale_id = ?', id);
    await q.run('DELETE FROM sales WHERE id = ?', id);
  });
  return { ok: true };
});

/* ========================= INCOME / EXPENSE ======================== */
for (const [table, typeCol, endpoint] of [
  ['incomes', 'income_type', 'income'], ['expenses', 'expense_type', 'expense']]) {
  const cols = table === 'incomes'
    ? ['cf_date', 'income_type', 'branch', 'amount', 'notes']
    : ['cf_date', 'expense_type', 'branch', 'amount', 'pay_type', 'notes'];
  const vals = (b) => cols.map((c) =>
    (c === 'amount' ? num(b[c]) : (c === 'cf_date' ? (nul(b.cf_date) || today()) : nul(b[c]))));

  GET(`/api/${endpoint}`, async ({ query }) => {
    const where = [], args = [];
    if (str(query.q)) {
      const p = like(query.q);
      where.push(`(${typeCol} LIKE ? OR branch LIKE ? OR notes LIKE ?)`);
      args.push(p, p, p);
    }
    if (str(query.from)) { where.push('cf_date >= ?'); args.push(str(query.from)); }
    if (str(query.to)) { where.push('cf_date <= ?'); args.push(str(query.to)); }
    const rows = await all(`SELECT * FROM \`${table}\`
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY cf_date DESC, id DESC LIMIT ?`,
    ...args, Math.min(int(query.limit, 300), 2000));
    return { rows, total: round2(rows.reduce((a, r) => a + Number(r.amount), 0)) };
  });

  POST(`/api/${endpoint}`, async ({ body }) => {
    const r = await run(`INSERT INTO \`${table}\` (${cols.join(',')})
      VALUES (${cols.map(() => '?').join(',')})`, ...vals(body));
    return get(`SELECT * FROM \`${table}\` WHERE id = ?`, r.insertId);
  });

  PUT(`/api/${endpoint}/:id`, async ({ params, body }) => {
    const id = int(params.id);
    if (!await get(`SELECT id FROM \`${table}\` WHERE id = ?`, id)) missing();
    await run(`UPDATE \`${table}\` SET ${cols.map((c) => c + '=?').join(',')} WHERE id=?`,
      ...vals(body), id);
    return get(`SELECT * FROM \`${table}\` WHERE id = ?`, id);
  });

  DELETE(`/api/${endpoint}/:id`, async ({ params }) => {
    await run(`DELETE FROM \`${table}\` WHERE id = ?`, int(params.id));
    return { ok: true };
  });
}

/* ============================== REPORTS ============================ */
GET('/api/reports/daily-closed', async ({ query }) => {
  const from = str(query.from) || today();
  const to = str(query.to) || from;
  const [orders, sales, deposits, payments] = await Promise.all([
    all(`SELECT ${ORDER_SELECT} ${ORDER_FROM}
         WHERE o.order_closed = 1 AND DATE(o.order_close_date) BETWEEN ? AND ?
         ORDER BY o.order_close_date`, from, to),
    all(`SELECT s.*, st.product_name, e.employee_name
         FROM sales s
         LEFT JOIN v_stock_lot st ON st.id = s.product_stock_id
         LEFT JOIN employees e ON e.id  = s.employee_id
         WHERE DATE(s.sale_date) BETWEEN ? AND ? ORDER BY s.sale_date`, from, to),
    all(`SELECT ${ORDER_SELECT} ${ORDER_FROM}
         WHERE DATE(o.order_date) BETWEEN ? AND ? AND o.deposit > 0
         ORDER BY o.order_date`, from, to),
    all(`SELECT p.*, o.invoice_code, e.employee_name AS received_by_name
         FROM payments p
         LEFT JOIN custom_orders o ON o.id = p.order_id
         LEFT JOIN employees e     ON e.id = p.received_by
         WHERE DATE(p.paid_at) BETWEEN ? AND ? ORDER BY p.paid_at`, from, to),
  ]);
  const byKey = (rows, key, amt) => {
    const m = {};
    for (const r of rows) m[r[key] || '-'] = round2((m[r[key] || '-'] || 0) + Number(amt(r)));
    return m;
  };
  const [exp, inc] = await Promise.all([
    get('SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE cf_date BETWEEN ? AND ?', from, to),
    get('SELECT COALESCE(SUM(amount),0) v FROM incomes  WHERE cf_date BETWEEN ? AND ?', from, to),
  ]);
  return {
    from, to, orders, sales, deposits, payments,
    summary: {
      payment_total: round2(payments.reduce((a, p) => a + Number(p.amount), 0)),
      payment_by_method: byKey(payments, 'method', (p) => p.amount),
      payment_by_kind: byKey(payments, 'kind', (p) => p.amount),
      close_income: round2(orders.reduce((a, o) => a + Number(o.order_close_income || 0), 0)),
      close_by_pay: byKey(orders, 'order_close_pay_type', (o) => o.order_close_income || 0),
      deposit_total: round2(deposits.reduce((a, o) => a + Number(o.deposit), 0)),
      deposit_by_pay: byKey(deposits, 'deposit_pay_type', (o) => o.deposit),
      sale_total: round2(sales.reduce((a, s) => a + Number(s.price) - Number(s.discount), 0)),
      sale_by_pay: byKey(sales, 'pay_type', (s) => s.price - s.discount),
      expense: Number(exp.v), other_income: Number(inc.v),
    },
  };
});

GET('/api/reports/income-by-month', async () => {
  const rows = await all(`
    SELECT ym,
           SUM(payment_income) payment_income, SUM(sale_income) sale_income,
           SUM(other_income) other_income, SUM(expense) expense
    FROM (
      SELECT DATE_FORMAT(paid_at,'%Y-%m') ym, SUM(amount) payment_income,
             0 sale_income, 0 other_income, 0 expense
        FROM payments GROUP BY ym
      UNION ALL
      SELECT DATE_FORMAT(sale_date,'%Y-%m'), 0, SUM(price - discount), 0, 0
        FROM sales GROUP BY 1
      UNION ALL
      SELECT DATE_FORMAT(cf_date,'%Y-%m'), 0, 0, SUM(amount), 0
        FROM incomes GROUP BY 1
      UNION ALL
      SELECT DATE_FORMAT(cf_date,'%Y-%m'), 0, 0, 0, SUM(amount)
        FROM expenses GROUP BY 1
    ) t WHERE ym IS NOT NULL
    GROUP BY ym ORDER BY ym DESC`);
  return rows.map((r) => {
    // sales already produce a payment row, so don't count them twice
    const total = Number(r.payment_income) + Number(r.other_income);
    return {
      ym: r.ym,
      payment_income: Number(r.payment_income),
      sale_income: Number(r.sale_income),
      other_income: Number(r.other_income),
      expense: Number(r.expense),
      total_income: round2(total),
      net: round2(total - Number(r.expense)),
    };
  });
});

GET('/api/reports/checklist', ({ query }) =>
  all(`SELECT p.name AS product_name, SUM(sl.remaining_qty) qty,
              MAX(p.base_selling_price) price, MIN(sl.received_date) oldest
       FROM stock_lots sl JOIN products p ON p.id = sl.product_id
       WHERE sl.remaining_qty > 0 AND p.product_type = ?
       GROUP BY p.name ORDER BY p.name`, str(query.type, 'Lens')));

GET('/api/reports/stock-labels', async ({ query }) => {
  const where = [], args = [];
  if (str(query.type)) { where.push('s.product_type = ?'); args.push(str(query.type)); }
  if (str(query.q)) { where.push('s.product_name LIKE ?'); args.push(like(query.q)); }
  const lots = await all(`SELECT s.id, s.product_name, s.product_type, s.product_price,
      s.remaining_qty, s.initial_qty, l.location
    FROM v_stock_lot s LEFT JOIN product_locations l ON l.product_name = s.product_name
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.product_name, s.id`, ...args);
  // ป้ายราคาพิมพ์รายชิ้น — ขยายล็อตเป็นแถวรายชิ้น เอาเฉพาะที่ยังไม่ขาย
  return expandLots(lots).filter((r) => !r.sold).slice(0, 500);
});

GET('/api/reports/unsold-stock', async ({ query }) => {
  const lots = await all(`SELECT s.*, l.location, DATEDIFF(NOW(), s.stock_date) age_days
    FROM v_stock_lot s LEFT JOIN product_locations l ON l.product_name = s.product_name
    WHERE DATEDIFF(NOW(), s.stock_date) >= ?
    ORDER BY s.stock_date`, int(query.days, 180));
  // รายงานค้างสต็อกนับเป็นรายชิ้น (ไว้รวมมูลค่า) — ขยายล็อตเหมือนป้ายราคา
  return expandLots(lots).filter((r) => !r.sold).slice(0, 500);
});

GET('/api/reports/order/:id', ({ params }) => orderDetail(int(params.id)));
GET('/api/reports/prescription/:id', ({ params }) =>
  handle('GET', '/api/prescriptions/' + params.id, {}, {}));

GET('/api/reports/workload', () => all(
  `SELECT stage_group, status, status_label_th AS label_th,
          COUNT(*) n, SUM(is_rush) rush, MIN(status_order) sort_order
   FROM v_case_board WHERE is_terminal = 0
   GROUP BY stage_group, status, status_label_th
   ORDER BY sort_order`));

/* ============================== BOOKINGS =========================== */
const BOOKING_SELECT = `
  b.*, c.first_name AS cust_first_name, c.last_name AS cust_last_name,
  c.phone AS cust_phone, c.line_id AS cust_line_id,
  e.employee_name AS assigned_name, cr.employee_name AS created_by_name,
  ca.case_code, ca.status AS case_status,
  TIMESTAMP(b.booking_date, b.booking_time) AS starts_at`;
const BOOKING_FROM = `
  FROM bookings b
  LEFT JOIN customers c  ON c.id  = b.customer_id
  LEFT JOIN employees e  ON e.id  = b.assigned_to
  LEFT JOIN employees cr ON cr.id = b.created_by
  LEFT JOIN cases ca     ON ca.id = b.case_id`;

const BOOKING_STATUS_CODES = ['booked', 'confirmed', 'arrived', 'in_service',
  'done', 'no_show', 'cancelled'];

/** the linked customer record wins over the free-text fields typed at booking time */
const shapeBooking = (b) => (b && {
  ...b,
  first_name: b.cust_first_name ?? b.first_name,
  last_name: b.cust_last_name ?? b.last_name,
  phone: b.cust_phone ?? b.phone,
  line_id: b.cust_line_id ?? b.line_id,
});

/* per-day counts. `month` covers one month; `from`/`to` cover any range so the
   year view can fill twelve mini-calendars with a single request */
GET('/api/bookings/calendar', async ({ query }) => {
  const month = /^\d{4}-\d{2}$/.test(str(query.month)) ? str(query.month) : today().slice(0, 7);
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(str(v));
  const ranged = isDate(query.from) && isDate(query.to);
  const days = await all(`
    SELECT booking_date AS d, COUNT(*) total,
      SUM(status IN ('booked','confirmed')) pending,
      SUM(status = 'arrived') arrived,
      SUM(status = 'in_service') in_service,
      SUM(status = 'done') done,
      SUM(status = 'no_show') no_show,
      SUM(status = 'cancelled') cancelled
    FROM bookings
    WHERE ${ranged ? 'booking_date BETWEEN ? AND ?' : "DATE_FORMAT(booking_date, '%Y-%m') = ?"}
    GROUP BY booking_date ORDER BY booking_date`,
  ...(ranged ? [str(query.from), str(query.to)] : [month]));
  return ranged ? { from: str(query.from), to: str(query.to), days } : { month, days };
});

GET('/api/bookings/today', async () => {
  const rows = await all(`SELECT ${BOOKING_SELECT} ${BOOKING_FROM}
    WHERE b.booking_date = CURDATE() AND b.status <> 'cancelled'
    ORDER BY b.booking_time`);
  return rows.map(shapeBooking);
});

GET('/api/bookings', async ({ query }) => {
  const where = [], args = [];
  if (str(query.date)) { where.push('b.booking_date = ?'); args.push(str(query.date)); }
  if (str(query.from)) { where.push('b.booking_date >= ?'); args.push(str(query.from)); }
  if (str(query.to)) { where.push('b.booking_date <= ?'); args.push(str(query.to)); }
  if (str(query.status)) { where.push('b.status = ?'); args.push(str(query.status)); }
  if (query.upcoming === '1') {
    where.push(`TIMESTAMP(b.booking_date, b.booking_time) >= NOW()
                AND b.status IN ('booked','confirmed')`);
  }
  if (str(query.q)) {
    const p = like(query.q);
    where.push(`(b.booking_code LIKE ? OR b.phone LIKE ? OR b.first_name LIKE ?
              OR b.last_name LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?
              OR c.phone LIKE ? OR b.intake_note LIKE ?)`);
    args.push(p, p, p, p, p, p, p, p);
  }
  const rows = await all(`SELECT ${BOOKING_SELECT} ${BOOKING_FROM}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY b.booking_date, b.booking_time LIMIT ?`,
  ...args, Math.min(int(query.limit, 300), 1000));
  return rows.map(shapeBooking);
});

async function bookingDetail(id) {
  const b = shapeBooking(await get(
    `SELECT ${BOOKING_SELECT} ${BOOKING_FROM} WHERE b.id = ?`, id));
  if (!b) missing();
  b.step_notes = await all(
    `SELECT n.*, e.employee_name AS recorded_by_name FROM booking_notes n
     LEFT JOIN employees e ON e.id = n.recorded_by
     WHERE n.booking_id = ? ORDER BY n.created_at, n.id`, id);
  b.notifications = await all(
    `SELECT id, kind, ok, error, created_at FROM notification_log
     WHERE booking_id = ? ORDER BY created_at DESC LIMIT 20`, id);
  return b;
}
GET('/api/bookings/:id', ({ params }) => bookingDetail(int(params.id)));

const BOOKING_COLS = ['customer_id', 'first_name', 'last_name', 'phone', 'line_id',
  'booking_date', 'booking_time', 'duration_min', 'service_type', 'channel',
  'assigned_to', 'reminder_minutes', 'intake_note', 'notes'];
const bookingVals = (b) => BOOKING_COLS.map((c) => {
  if (c === 'customer_id' || c === 'assigned_to') return int(b[c]);
  // NOT NULL columns — never let a blank field become NULL
  if (c === 'service_type') return str(b.service_type) || 'eye_exam';
  if (c === 'channel') return str(b.channel) || 'phone';
  if (c === 'duration_min') return Math.max(5, int(b.duration_min, 30));
  if (c === 'reminder_minutes') {
    const n = int(b.reminder_minutes, 10);
    return n < 0 ? 0 : Math.min(n, 1440);
  }
  if (c === 'booking_time') {
    const t = str(b.booking_time);
    return t.length === 5 ? t + ':00' : t;
  }
  return nul(b[c]);
});

POST('/api/bookings', async ({ body }) => {
  if (!nul(body.booking_date)) bad('กรุณาเลือกวันที่จอง');
  if (!nul(body.booking_time)) bad('กรุณาเลือกเวลาจอง');
  const cid = int(body.customer_id);
  if (cid && !await get('SELECT id FROM customers WHERE id = ?', cid)) bad('ไม่พบลูกค้ารายนี้');
  if (!cid && !str(body.first_name) && !str(body.phone)) {
    bad('กรุณาเลือกลูกค้าเดิม หรือกรอกชื่อ/เบอร์โทรของลูกค้าใหม่');
  }
  const code = await nextCode('BK', 'bookings', 'booking_code');

  const id = await tx(async (q) => {
    const r = await q.run(
      `INSERT INTO bookings (booking_code, ${BOOKING_COLS.join(',')}, created_by)
       VALUES (?, ${BOOKING_COLS.map(() => '?').join(',')}, ?)`,
      code, ...bookingVals(body), int(body.created_by));
    const bid = r.insertId;
    for (const n of Array.isArray(body.step_notes) ? body.step_notes : []) {
      if (!str(n.note)) continue;
      await q.run(
        `INSERT INTO booking_notes (booking_id, step, question, note, recorded_by)
         VALUES (?,?,?,?,?)`,
        bid, str(n.step, 'intake'), nul(n.question), str(n.note),
        int(n.recorded_by) || int(body.created_by));
    }
    return bid;
  });

  bookingCreatedPing(id); // fire-and-forget; never blocks the response
  return bookingDetail(id);
});

async function bookingCreatedPing(id) {
  try {
    const tg = await import('./telegram.js');
    if (!await tg.isEnabled()) return;
    const b = shapeBooking(await get(
      `SELECT ${BOOKING_SELECT} ${BOOKING_FROM} WHERE b.id = ?`, id));
    if (!b) return;
    const { SERVICE_TYPES } = await import('./migrate.js');
    b.service_label = Object.fromEntries(SERVICE_TYPES)[b.service_type] || b.service_type;
    await tg.send(tg.bookingCreatedMessage(b), { kind: 'booking_created', booking_id: id });
  } catch { /* a failed ping must never affect the booking itself */ }
}

PUT('/api/bookings/:id', async ({ params, body }) => {
  const id = int(params.id);
  const cur = await get('SELECT * FROM bookings WHERE id = ?', id);
  if (!cur) missing();
  // when the slot moves, clear the sent flag so the reminder fires for the new time
  const moved = str(body.booking_date) !== String(cur.booking_date)
    || str(body.booking_time).slice(0, 5) !== String(cur.booking_time).slice(0, 5);
  // คอลัมน์ที่ฟอร์มไม่ได้ส่งมาให้คงค่าเดิมไว้ ไม่งั้นการแก้ไขจะล้างข้อมูล
  // ที่กรอกไว้จากที่อื่น (เช่น line_id, intake_note ที่ถูกถอดออกจากฟอร์มจองแล้ว)
  const merged = { ...body };
  for (const c of BOOKING_COLS) if (merged[c] === undefined) merged[c] = cur[c];
  await run(`UPDATE bookings SET ${BOOKING_COLS.map((c) => c + '=?').join(',')}
    ${moved ? ', reminder_sent_at = NULL' : ''} WHERE id = ?`, ...bookingVals(merged), id);
  return bookingDetail(id);
});

POST('/api/bookings/:id/status', async ({ params, body }) => {
  const id = int(params.id);
  const b = await get('SELECT * FROM bookings WHERE id = ?', id);
  if (!b) missing();
  const s = str(body.status);
  if (!BOOKING_STATUS_CODES.includes(s)) bad(`สถานะ "${s}" ไม่ถูกต้อง`);
  await run(
    `UPDATE bookings SET status = ?,
       confirmed_at = CASE WHEN ? = 'confirmed' AND confirmed_at IS NULL THEN NOW() ELSE confirmed_at END,
       arrived_at   = CASE WHEN ? = 'arrived'   AND arrived_at   IS NULL THEN NOW() ELSE arrived_at END,
       cancelled_reason = CASE WHEN ? IN ('cancelled','no_show') THEN ? ELSE cancelled_reason END
     WHERE id = ?`, s, s, s, s, nul(body.reason), id);
  if (str(body.note)) {
    await run(
      `INSERT INTO booking_notes (booking_id, case_id, step, question, note, recorded_by)
       VALUES (?,?,?,?,?,?)`,
      id, b.case_id, s, 'เปลี่ยนสถานะ', str(body.note), int(body.employee_id));
  }
  return bookingDetail(id);
});

POST('/api/bookings/:id/notes', async ({ params, body }) => {
  const id = int(params.id);
  const b = await get('SELECT * FROM bookings WHERE id = ?', id);
  if (!b) missing();
  if (!str(body.note)) bad('กรุณากรอกบันทึก');
  await run(
    `INSERT INTO booking_notes (booking_id, case_id, step, question, note, recorded_by)
     VALUES (?,?,?,?,?,?)`,
    id, b.case_id, str(body.step, 'intake'), nul(body.question), str(body.note),
    int(body.recorded_by));
  return bookingDetail(id);
});

DELETE('/api/bookings/:id/notes/:note_id', async ({ params }) => {
  await run('DELETE FROM booking_notes WHERE id = ? AND booking_id = ?',
    int(params.note_id), int(params.id));
  return bookingDetail(int(params.id));
});

/** turn a booking into a real case, creating the customer record if they are new */
POST('/api/bookings/:id/open-case', async ({ body, params }) => {
  const id = int(params.id);
  const b = await get('SELECT * FROM bookings WHERE id = ?', id);
  if (!b) missing();
  if (b.case_id) bad('การจองนี้เปิดเคสไปแล้ว');

  const notes = await all(
    'SELECT question, note FROM booking_notes WHERE booking_id = ? ORDER BY created_at', id);
  const reception = [
    b.intake_note,
    ...notes.map((n) => (n.question ? `${n.question}: ${n.note}` : n.note)),
  ].filter(Boolean).join('\n');

  const result = await tx(async (q) => {
    let customerId = b.customer_id;
    let createdCustomer = false;
    if (!customerId) {
      const r = await q.run(
        `INSERT INTO customers (first_name, last_name, phone, line_id, notes)
         VALUES (?,?,?,?,?)`,
        str(b.first_name) || 'ลูกค้าจองคิว', nul(b.last_name), nul(b.phone),
        nul(b.line_id), `มาจากการจองคิว ${b.booking_code}`);
      customerId = r.insertId;
      createdCustomer = true;
    }
    const code = await nextCode('CASE', 'cases', 'case_code');
    const rc = await q.run(
      `INSERT INTO cases (case_code, customer_id, status, is_new_customer, is_rush,
         received_by, recorded_by, reception_note)
       VALUES (?,?,?,?,?,?,?,?)`,
      code, customerId, str(body.status, 'reception'), createdCustomer ? 1 : 0,
      bool(body.is_rush), int(body.received_by) || b.assigned_to,
      int(body.received_by) || b.created_by, reception || null);
    const caseId = rc.insertId;

    await logEvent(q, caseId, {
      to_status: str(body.status, 'reception'), action: 'case_opened',
      entity: 'booking', entity_id: id, employee_id: int(body.received_by),
      note: `เปิดจากการจองคิว ${b.booking_code}`,
    });
    await q.run(
      `UPDATE bookings SET case_id = ?, customer_id = ?, status = 'in_service',
        arrived_at = COALESCE(arrived_at, NOW()) WHERE id = ?`, caseId, customerId, id);
    await q.run('UPDATE booking_notes SET case_id = ? WHERE booking_id = ?', caseId, id);
    return { caseId, customerId, createdCustomer, caseCode: code };
  });

  return { ...result, booking: await bookingDetail(id) };
});

DELETE('/api/bookings/:id', async ({ params }) => {
  const id = int(params.id);
  const b = await get('SELECT * FROM bookings WHERE id = ?', id);
  if (!b) missing();
  if (b.case_id) bad('ลบไม่ได้ — การจองนี้เปิดเคสไปแล้ว (ใช้ปุ่ม "ยกเลิก" แทน)');
  await run('DELETE FROM bookings WHERE id = ?', id);
  return { ok: true };
});

/** send this booking's reminder immediately */
POST('/api/bookings/:id/remind', async ({ params }) => {
  const id = int(params.id);
  const b = shapeBooking(await get(
    `SELECT ${BOOKING_SELECT} ${BOOKING_FROM} WHERE b.id = ?`, id));
  if (!b) missing();
  const tg = await import('./telegram.js');
  const { SERVICE_TYPES } = await import('./migrate.js');
  const notes = await all(
    'SELECT question, note FROM booking_notes WHERE booking_id = ? ORDER BY created_at LIMIT 12', id);
  const mins = Math.max(0, Math.round(
    (new Date(String(b.starts_at).replace(' ', 'T')) - Date.now()) / 60000));
  const res = await tg.send(tg.reminderMessage({
    ...b,
    service_label: Object.fromEntries(SERVICE_TYPES)[b.service_type] || b.service_type,
    step_notes: notes.map((n) => (n.question ? `• ${n.question}: ${n.note}` : `• ${n.note}`)).join('\n'),
  }, mins), { kind: 'booking_reminder_manual', booking_id: id, force: true });
  if (!res.ok) bad(res.error || 'ส่งไม่สำเร็จ');
  await run('UPDATE bookings SET reminder_sent_at = NOW() WHERE id = ?', id);
  return bookingDetail(id);
});

/* ============================== SETTINGS =========================== */
GET('/api/settings', async () => {
  const tg = await import('./telegram.js');
  const s = await tg.settings(true);
  return {
    ...s,
    // never hand the raw token back to the browser
    telegram_bot_token: s.telegram_bot_token ? '••••••' + s.telegram_bot_token.slice(-4) : '',
    telegram_configured: await tg.isConfigured(),
    telegram_token_from_env: !!process.env.TELEGRAM_BOT_TOKEN,
  };
});

PUT('/api/settings', async ({ body }) => {
  const tg = await import('./telegram.js');
  const allowed = ['telegram_enabled', 'telegram_chat_id', 'reminder_default_minutes',
    'shop_name', 'shop_open_time', 'shop_close_time', 'slot_minutes'];
  const patch = {};
  for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
  const tok = str(body.telegram_bot_token);
  if (tok && !tok.startsWith('••••')) patch.telegram_bot_token = tok; // keep old token unless replaced
  await tg.saveSettings(patch);
  return handle('GET', '/api/settings', {}, {});
});

POST('/api/settings/telegram/test', async ({ body }) => {
  const tg = await import('./telegram.js');
  const tok = str(body.telegram_bot_token);
  if (tok && !tok.startsWith('••••')) await tg.saveSettings({ telegram_bot_token: tok });
  if (str(body.telegram_chat_id)) await tg.saveSettings({ telegram_chat_id: str(body.telegram_chat_id) });
  let bot;
  try {
    bot = await tg.verifyBot();
  } catch (e) {
    bad('ตรวจสอบ bot token ไม่ผ่าน: ' + e.message);
  }
  const res = await tg.send(
    '✅ <b>ทดสอบการเชื่อมต่อสำเร็จ</b>\nTimeOptic พร้อมส่งแจ้งเตือนคิวลูกค้าแล้ว',
    { kind: 'test', force: true });
  if (!res.ok) bad(res.error || 'ส่งข้อความทดสอบไม่สำเร็จ');
  return { ok: true, bot: { username: bot.username, first_name: bot.first_name } };
});

GET('/api/notifications', ({ query }) =>
  all(`SELECT n.*, b.booking_code FROM notification_log n
       LEFT JOIN bookings b ON b.id = n.booking_id
       ORDER BY n.created_at DESC LIMIT ?`, Math.min(int(query.limit, 100), 500)));

POST('/api/reminders/run', async () => {
  const { runOnce } = await import('./scheduler.js');
  return runOnce();
});
