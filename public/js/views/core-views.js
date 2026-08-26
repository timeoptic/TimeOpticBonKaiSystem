/* Dashboard, customers, prescriptions, employees */
import {
  api, meta, el, frag, card, table, pageHead, field, input, select, listSelect,
  employeeSelect, formData, money, moneyShort, fmtDate, fmtDateTime, dateOnly, dtLocal,
  nowLocal, custName, power, rxNum, ok, err, confirmDialog, statusBadge, statusChip,
  picker, loadMeta, todayISO, stageInfo, glassesTypeOfLens,
  addCustomerAction,
} from '../core.js';

/* ============================== MAIN MENU ========================== */
const TILES = [
  ['📅', 'ปฏิทินจองคิว', 'Queue Booking', '#/bookings'],
  ['➕', 'จองคิวใหม่', 'New Booking', '#/bookings/new'],
  ['🗂', 'กระดานงาน', 'Case Board', '#/cases'],
  ['➕', 'เปิดเคสใหม่', 'New Case', '#/cases/new'],
  ['👥', 'ลูกค้าใหม่', 'New Customer', '#/customers/new'],
  ['👁', 'วัดสายตา', 'Prescription', '#/prescriptions/new'],
  ['👓', 'เปิดออเดอร์ตัดแว่น', 'Custom Order', '#/orders/new'],
  ['🔎', 'ติดตามเลนส์', 'Lens Tracker', '#/lens-tracker'],
  ['🛍', 'ขายสินค้าทั่วไป', 'Product Sale', '#/sales/new'],
  ['📦', 'เพิ่มสินค้าเข้าคลัง', 'Add to Stock', '#/stock/new'],
  ['📜', 'ประวัติการสั่งซื้อ', 'Order History', '#/orders'],
  ['💸', 'รายจ่าย', 'Expense', '#/expense'],
  ['💰', 'รายรับ', 'Income', '#/income'],
  ['📊', 'รายงาน', 'Reports', '#/reports'],
];

const kpi = (label, value, sub, cls = '') =>
  el('div.kpi', { class: cls }, [
    el('div.k-label', { text: label }),
    el('div.k-value', { text: value }),
    sub ? el('div.k-sub', { text: sub }) : null,
  ]);

export async function dashboard({ navigate }) {
  const d = await api.get('/api/dashboard');
  const s = d.stats;
  const wrap = el('div');

  wrap.append(pageHead('👓', 'Main Menu', 'เมนูหลัก', [
    el('a.btn.btn-ghost', { href: '#/cases', text: '🗂 กระดานงาน' }),
    el('a.btn.btn-ghost', { href: '#/reports/daily', text: '📅 สรุปรายวัน' }),
  ]));

  wrap.append(el('div.kpis', {}, [
    kpi('รับเงินวันนี้', moneyShort(s.received_today.amount),
      `${s.received_today.n} รายการ`, 'ok'),
    kpi('ขายสินค้าวันนี้', moneyShort(s.sales_today.amount), `${s.sales_today.n} รายการ`, 'accent'),
    kpi('รายจ่ายวันนี้', moneyShort(s.expense_today.amount), 'Expense', 'danger'),
    kpi('เคสที่ยังไม่จบ', String(s.open_cases),
      s.rush_cases ? `ด่วน ${s.rush_cases} เคส 🔥` : 'ทั้งร้าน', 'warn'),
    kpi('รอเลนส์มา', String(s.lens_waiting), 'Waiting arrival', 'warn'),
    kpi('คิวจองวันนี้', String(s.bookings_today ?? 0),
      `ยังไม่มา ${s.bookings_pending ?? 0} คิว`, 'accent'),
    kpi('นัดรับแว่นวันนี้', String(s.appointments_today), 'Appointment'),
    kpi('สินค้าคงคลัง', s.stock_on_hand.toLocaleString('th-TH'), 'ชิ้น'),
    kpi('ลูกค้าทั้งหมด', s.customers.toLocaleString('th-TH'), 'คน'),
  ]));

  /* workload by stage */
  const stages = Object.entries(d.board || {});
  if (stages.length) {
    wrap.append(card('งานค้างแต่ละขั้นตอน', [
      el('div.row', { style: 'gap:10px' }, stages.map(([g, n]) => {
        const info = stageInfo(g);
        return el('a', {
          href: '#/cases?stage=' + g,
          style: `display:flex;gap:9px;align-items:center;padding:10px 15px;border-radius:9px;` +
            `background:${info.color}14;color:${info.color};font-weight:700;text-decoration:none`,
        }, [`${info.icon} ${info.label}`, el('span.badge', {
          style: `background:${info.color};color:#fff`, text: String(n),
        })]);
      })),
    ]));
  }

  /* today's booked queue */
  const bookings = d.bookings_today || [];
  wrap.append(card('คิวจองวันนี้ — Today’s Queue', [table([
    {
      label: 'เวลา', cls: 'nowrap',
      render: (b) => el('b', { text: String(b.booking_time || '').slice(0, 5) }),
    },
    {
      label: 'อีก', cls: 'num',
      render: (b) => {
        const m = Number(b.mins_away);
        if (!Number.isFinite(m)) return '';
        if (m < -5) return el('span.muted', { text: 'ผ่านไปแล้ว' });
        if (m < 0) return el('span.badge.warn', { text: 'ถึงเวลาแล้ว' });
        return el('span.badge', {
          class: m <= 15 ? 'danger' : m <= 60 ? 'warn' : 'gray', text: m + ' นาที',
        });
      },
    },
    { label: 'รหัส', key: 'booking_code', cls: 'mono' },
    { label: 'ลูกค้า', render: (b) => [b.first_name, b.last_name].filter(Boolean).join(' ') || '(ไม่ระบุ)' },
    { label: 'เบอร์โทร', key: 'phone', cls: 'nowrap' },
    { label: 'ผู้ดูแล', key: 'assigned_name' },
    { label: 'สถานะ', key: 'status' },
    {
      label: 'แจ้งเตือน',
      render: (b) => (b.reminder_sent_at
        ? el('span.badge.ok', { text: '🔔 ส่งแล้ว' })
        : el('span.muted', { text: `ก่อน ${b.reminder_minutes} น.` })),
    },
    { label: 'บันทึกเบื้องต้น', render: (b) => (b.intake_note || '').slice(0, 70) },
  ], bookings, {
    onRowClick: (b) => navigate('#/bookings/' + b.id),
    empty: 'วันนี้ยังไม่มีคิวจอง',
  })], {
    tight: true,
    badge: el('span.badge.blue', { text: String(bookings.length) }),
    right: [el('a.btn.btn-sm.btn-light', { href: '#/bookings', text: 'ดูปฏิทิน' })],
  }));

  wrap.append(el('div.tiles', { style: 'margin-bottom:20px' }, TILES.map(([ic, th, en, href]) =>
    el('a.tile', { href }, [
      el('span.t-ic', { text: ic }),
      el('span', {}, [el('b', { text: th }), el('small', { text: en })]),
    ]))));

  const cols = [
    { label: 'วันที่สั่ง', render: (o) => fmtDateTime(o.order_date), cls: 'nowrap' },
    { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
    { label: 'ลูกค้า', render: custName },
    { label: 'พนักงาน', render: (o) => o.employee_name || '-' },
    { label: 'เลนส์', render: (o) => o.lens_name || '-' },
    { label: 'กรอบ', render: (o) => o.frame_name || '-' },
    { label: 'นัดรับ', render: (o) => fmtDate(o.appointment_date), cls: 'nowrap' },
    { label: 'ยอดรวม', render: (o) => money(o.total_price), cls: 'num' },
    { label: 'คงเหลือ', render: (o) => money(o.balance), cls: 'num' },
  ];
  const goto = (o) => navigate('#/orders/' + o.id);

  wrap.append(card('ออเดอร์ว่าง — Unfilled Orders (ยังไม่ได้เติมเลนส์/กรอบ)',
    [table(cols, d.unfilled, { onRowClick: goto, empty: 'ไม่มีออเดอร์ที่รอของ 🎉' })],
    { tight: true, badge: el('span.badge.warn', { text: String(d.unfilled.length) }) }));

  wrap.append(card('ออเดอร์ที่ยังไม่ปิดการขาย — Unclosed Orders (ของครบ รอลูกค้ารับ)',
    [table(cols, d.unclosed, { onRowClick: goto, empty: 'ไม่มีออเดอร์รอรับ' })],
    { tight: true, badge: el('span.badge.blue', { text: String(d.unclosed.length) }) }));

  return wrap;
}

/* ============================== CUSTOMERS ========================== */
export async function customerList({ navigate, query }) {
  const wrap = el('div');
  wrap.append(pageHead('👥', 'Customer Search', 'ค้นหาข้อมูลลูกค้า', [
    el('a.btn.btn-ghost', { href: '#/customers/new', text: '+ ลูกค้าใหม่' }),
  ]));

  const search = el('input', {
    type: 'search', placeholder: 'ค้นหา ชื่อ / นามสกุล / เบอร์โทร / LINE / อีเมล / รหัสลูกค้า',
    value: query.q || '', autofocus: true,
  });
  const holder = el('div');
  let timer = null;

  async function run() {
    holder.replaceChildren(el('div.loading', {}, [el('span.spin'), ' กำลังค้นหา…']));
    const rows = await api.get('/api/customers', { q: search.value.trim(), limit: 300 });
    holder.replaceChildren(card(null, [table([
      { label: 'ID', key: 'id', cls: 'mono' },
      { label: 'ชื่อ', key: 'first_name' },
      { label: 'นามสกุล', key: 'last_name' },
      { label: 'เพศ', key: 'sex' },
      { label: 'สัญชาติ', key: 'nationality' },
      { label: 'เบอร์โทร', key: 'phone', cls: 'nowrap' },
      { label: 'LINE', key: 'line_id' },
      { label: 'อีเมล', key: 'email' },
      {
        label: '', cls: 'nowrap', render: (r) => frag([
          el('a.btn.btn-sm.btn-accent', { href: `#/cases/new?customer=${r.id}`, text: '🗂 เปิดเคส' }),
          ' ',
          el('a.btn.btn-sm.btn-light', { href: `#/prescriptions/new?customer=${r.id}`, text: '👁' }),
        ]),
      },
    ], rows, {
      onRowClick: (r) => navigate('#/customers/' + r.id),
      empty: 'ไม่พบลูกค้า',
    })], { tight: true }));
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 240); });

  wrap.append(el('div.toolbar', {}, [el('div.field.grow', {}, [
    el('label', { text: 'ค้นหา' }), search,
  ])]));
  wrap.append(holder);
  run();
  return wrap;
}

export async function customerForm({ params, navigate, query }) {
  const editing = !!params.id;
  const c = editing ? await api.get('/api/customers/' + params.id) : {};
  const form = el('form.card');
  form.append(el('div.card-body', {}, [
    el('div.form-grid', {}, [
      field('ชื่อ / First name', input('first_name', { value: c.first_name || '', required: true })),
      field('ชื่อกลาง / Mid name', input('mid_name', { value: c.mid_name || '' })),
      field('นามสกุล / Last name', input('last_name', { value: c.last_name || '' })),
      field('เพศ / Sex', listSelect('sex', 'sex', c.sex, { blank: '—' })),
      field('สัญชาติ / Nationality', input('nationality', { value: c.nationality || '', list: 'nat-list' })),
      field('วันเกิด / Birth date', input('birth_date', { type: 'date', value: dateOnly(c.birth_date) })),
      field('เบอร์โทร / Phone', input('phone', { value: c.phone || '' })),
      field('LINE ID', input('line_id', { value: c.line_id || '' })),
      field('อีเมล / Email', input('email', { type: 'email', value: c.email || '' })),
      el('div.field.full', {}, [
        el('label', { text: 'หมายเหตุ / Notes' }),
        el('textarea', { name: 'notes', text: c.notes || '' }),
      ]),
    ]),
    el('datalist#nat-list', {}, ['Thai', 'NewZealand', 'Australian', 'British', 'American', 'Japanese']
      .map((n) => el('option', { value: n }))),
    el('div.form-actions', {}, [
      el('button.btn.btn-lg', { type: 'submit', text: editing ? '💾 บันทึกการแก้ไข' : '✔ บันทึกลูกค้าใหม่' }),
      el('a.btn.btn-light', { href: editing ? '#/customers/' + c.id : '#/customers', text: 'ยกเลิก' }),
    ]),
  ]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const body = formData(form);
      const saved = editing
        ? await api.put('/api/customers/' + c.id, body)
        : await api.post('/api/customers', body);
      ok('บันทึกลูกค้าเรียบร้อย');
      if (query.next === 'case') navigate('#/cases/new?customer=' + saved.id);
      else navigate('#/customers/' + saved.id);
    } catch (ex) { err(ex); }
  });

  return frag([
    pageHead('👥', editing ? 'Edit Customer' : 'New Customer',
      editing ? 'แก้ไขข้อมูลลูกค้า' : 'ลูกค้าใหม่'),
    form,
  ]);
}

export async function customerDetail({ params, navigate }) {
  const c = await api.get('/api/customers/' + params.id);
  const wrap = el('div');
  wrap.append(pageHead('👤', custName(c), `รหัสลูกค้า #${c.id}`, [
    el('a.btn.btn-ghost', { href: `#/cases/new?customer=${c.id}`, text: '🗂 เปิดเคส' }),
    el('a.btn.btn-ghost', { href: `#/prescriptions/new?customer=${c.id}`, text: '👁 วัดสายตา' }),
    el('a.btn.btn-ghost', { href: `#/orders/new?customer=${c.id}`, text: '👓 เปิดออเดอร์' }),
    el('a.btn.btn-ghost', { href: `#/customers/${c.id}/edit`, text: '✎ แก้ไข' }),
  ]));

  wrap.append(el('div.split', {}, [
    card('ข้อมูลลูกค้า', [
      el('dl.kv', {}, [
        el('dt', { text: 'ชื่อ-นามสกุล' }), el('dd', { text: custName(c) }),
        el('dt', { text: 'เพศ' }), el('dd', { text: c.sex || '-' }),
        el('dt', { text: 'สัญชาติ' }), el('dd', { text: c.nationality || '-' }),
        el('dt', { text: 'วันเกิด' }), el('dd', { text: fmtDate(c.birth_date) || '-' }),
        el('dt', { text: 'เบอร์โทร' }), el('dd', { text: c.phone || '-' }),
        el('dt', { text: 'LINE' }), el('dd', { text: c.line_id || '-' }),
        el('dt', { text: 'อีเมล' }), el('dd', { text: c.email || '-' }),
        el('dt', { text: 'หมายเหตุ' }), el('dd', { text: c.notes || '-' }),
        el('dt', { text: 'ลูกค้าตั้งแต่' }), el('dd', { text: fmtDate(c.created_at) }),
      ]),
      el('div.form-actions', { style: 'margin-top:14px' }, [
        el('button.btn.btn-sm.btn-danger', {
          text: '🗑 ลบลูกค้า',
          onclick: async () => {
            if (!await confirmDialog('ลบลูกค้า', `ลบ "${custName(c)}" ออกจากระบบ?`,
              { confirmText: 'ลบ', danger: true })) return;
            try { await api.del('/api/customers/' + c.id); ok('ลบแล้ว'); navigate('#/customers'); }
            catch (ex) { err(ex); }
          },
        }),
      ]),
    ]),
    card('เคสของลูกค้า', [table([
      { label: 'เคส', key: 'case_code', cls: 'mono' },
      { label: 'สถานะ', render: statusChip },
      { label: 'เปิดเมื่อ', render: (k) => fmtDate(k.opened_at), cls: 'nowrap' },
      { label: 'ยอด', render: (k) => (k.net_price === null ? '-' : money(k.net_price)), cls: 'num' },
      { label: 'ค้าง', render: (k) => (k.balance === null ? '-' : money(k.balance)), cls: 'num' },
    ], c.cases, {
      onRowClick: (k) => navigate('#/cases/' + k.id),
      empty: 'ยังไม่มีเคส',
    })], { tight: true }),
  ]));

  wrap.append(card('ประวัติค่าสายตา', [table([
    { label: 'วันที่', render: (t) => fmtDateTime(t.test_date), cls: 'nowrap' },
    { label: 'ชนิด', render: (t) => el('span.badge', { class: t.kind === 'final' ? 'ok' : 'gray', text: t.kind }) },
    {
      label: 'R (Sph/Cyl/Axis/Add)', cls: 'nowrap',
      render: (t) => `${power(t.r_sphere)} / ${power(t.r_cylinder)} / ${rxNum(t.r_axis)} / ${power(t.r_add)}`,
    },
    {
      label: 'L (Sph/Cyl/Axis/Add)', cls: 'nowrap',
      render: (t) => `${power(t.l_sphere)} / ${power(t.l_cylinder)} / ${rxNum(t.l_axis)} / ${power(t.l_add)}`,
    },
    { label: 'ใช้สำหรับ', key: 'test_for' },
    { label: 'ผู้วัด', key: 'employee_name' },
    {
      label: '', cls: 'nowrap', render: (t) => frag([
        el('a.btn.btn-sm.btn-light', { href: '#/prescriptions/' + t.id, text: '✎' }), ' ',
        el('a.btn.btn-sm.btn-light', { href: '#/print/prescription/' + t.id, text: '🖨' }),
      ]),
    },
  ], c.prescriptions, { empty: 'ยังไม่มีประวัติการวัดสายตา' })], { tight: true }));

  wrap.append(card('ประวัติการสั่งตัดแว่น', [table([
    { label: 'วันที่', render: (o) => fmtDateTime(o.order_date), cls: 'nowrap' },
    { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
    { label: 'เลนส์', key: 'lens_name' },
    { label: 'กรอบ', key: 'frame_name' },
    { label: 'ยอดรวม', render: (o) => money(o.total_price), cls: 'num' },
    { label: 'รับแล้ว', render: (o) => money(o.paid), cls: 'num' },
    { label: 'คงเหลือ', render: (o) => money(o.balance), cls: 'num' },
    { label: 'สถานะ', render: statusBadge },
  ], c.orders, {
    onRowClick: (o) => navigate('#/orders/' + o.id),
    empty: 'ยังไม่มีออเดอร์',
  })], { tight: true }));

  return wrap;
}

/* =========================== PRESCRIPTIONS ========================= */
export async function prescriptionList({ navigate }) {
  const wrap = el('div');
  wrap.append(pageHead('👁', 'Prescriptions', 'ประวัติการวัดสายตา', [
    el('a.btn.btn-ghost', { href: '#/prescriptions/new', text: '+ วัดสายตาใหม่' }),
  ]));
  const search = el('input', { type: 'search', placeholder: 'ค้นหาด้วย ชื่อลูกค้า / เบอร์โทร / รหัส' });
  const holder = el('div');
  let timer = null;

  async function run() {
    holder.replaceChildren(el('div.loading', {}, [el('span.spin'), ' กำลังค้นหา…']));
    const rows = await api.get('/api/prescriptions', { q: search.value.trim(), limit: 300 });
    holder.replaceChildren(card(null, [table([
      { label: 'ID', key: 'id', cls: 'mono' },
      { label: 'วันที่วัด', render: (t) => fmtDateTime(t.test_date), cls: 'nowrap' },
      { label: 'ชนิด', render: (t) => el('span.badge', { class: t.kind === 'final' ? 'ok' : 'gray', text: t.kind }) },
      { label: 'ลูกค้า', render: custName },
      { label: 'เบอร์โทร', key: 'phone', cls: 'nowrap' },
      { label: 'R Sph', render: (t) => power(t.r_sphere), cls: 'num' },
      { label: 'R Cyl', render: (t) => power(t.r_cylinder), cls: 'num' },
      { label: 'R Axis', render: (t) => rxNum(t.r_axis), cls: 'num' },
      { label: 'L Sph', render: (t) => power(t.l_sphere), cls: 'num' },
      { label: 'L Cyl', render: (t) => power(t.l_cylinder), cls: 'num' },
      { label: 'L Axis', render: (t) => rxNum(t.l_axis), cls: 'num' },
      { label: 'ใช้สำหรับ', key: 'test_for' },
      { label: 'ผู้วัด', key: 'employee_name' },
      {
        label: '', cls: 'nowrap', render: (t) =>
          el('a.btn.btn-sm.btn-light', { href: '#/print/prescription/' + t.id, text: '🖨' }),
      },
    ], rows, { onRowClick: (t) => navigate('#/prescriptions/' + t.id), empty: 'ไม่พบข้อมูล' })],
    { tight: true }));
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 240); });
  wrap.append(el('div.toolbar', {}, [el('div.field.grow', {}, [el('label', { text: 'ค้นหา' }), search])]));
  wrap.append(holder);
  run();
  return wrap;
}

/* ใบวัดสายตาอ่านเป็นตาราง: แถวคือค่าที่วัด คอลัมน์คือตาข้างซ้าย/ขวา
   วางแบบนี้เทียบค่าสองตาได้ในบรรทัดเดียว เหมือนใบกระดาษที่ร้านใช้อยู่ */
const RX_ROWS = [
  ['va', 'VA', 'Visual acuity', '20/20'],
  ['sphere', 'Sphere', 'SPH · ค่าสายตา', '-2.25'],
  ['cylinder', 'Cylinder', 'CYL · ค่าเอียง', '-0.50'],
  ['axis', 'Axis', 'AXIS · องศา', '180'],
  ['add', 'Add', 'ADD · สายตายาว', '+2.00'],
  ['pd', 'PD', 'PD · ระยะรูม่านตา', '32'],
];

/* ปริซึมใช้เฉพาะเคสตาเข/ตาเหล่ ไม่ได้กรอกทุกใบ จึงพับเก็บไว้หลังปุ่ม */
const PRISM_ROWS = [
  ['prism', 'Prism', 'PRISM · ค่าปริซึม', '2Δ'],
  ['base', 'Base', 'BASE · ฐานปริซึม', 'IN / OUT / UP / DOWN'],
];

const rxHead = () => el('thead', {}, [el('tr', {}, [
  el('th'),
  el('th.od', {}, [el('b', { text: 'OD · ตาขวา ' }), el('span.eye-tag', { text: 'R' })]),
  el('th.os', {}, [el('b', { text: 'OS · ตาซ้าย ' }), el('span.eye-tag', { text: 'L' })]),
])]);

const rxRow = (t, [key, name, sub, ph], prefix = '') => el('tr', {}, [
  el('td.rx-lbl', {}, [el('b', { text: name }), el('small', { text: sub })]),
  ...['r', 'l'].map((k) => el('td', {}, [
    input(`${prefix}${k}_${key}`, { value: t[`${prefix}${k}_${key}`] ?? '', placeholder: ph }),
  ])),
]);

/** ตารางค่าสายตาแยกตา + ปุ่มเปิดแถว Prism / Base */
const rxGrid = (t) => {
  const prism = PRISM_ROWS.map((r) => {
    const tr = rxRow(t, r);
    tr.classList.add('rx-prism');
    return tr;
  });
  /* เคยกรอกปริซึมไว้ก็กางให้เห็นเลย ไม่ต้องให้ไปกดหาเอง */
  let open = PRISM_ROWS.some(([key]) => ['r', 'l'].some((k) => t[`${k}_${key}`]));
  const draw = () => prism.forEach((tr) => { tr.style.display = open ? '' : 'none'; });

  const toggle = el('button.btn.btn-sm.btn-light', {
    type: 'button',
    style: 'margin-top:10px',
    text: open ? '− Prism / Base' : '+ Prism / Base',
    onclick: (e) => {
      open = !open;
      draw();
      e.currentTarget.textContent = open ? '− Prism / Base' : '+ Prism / Base';
    },
  });
  draw();

  return frag([
    el('div.rx-wrap', {}, [el('table.rx-grid', {}, [
      rxHead(),
      el('tbody', {}, [
        ...RX_ROWS.map((r) => rxRow(t, r)),
        el('tr.rx-total', {}, [
          el('td.rx-lbl', {}, [el('b', { text: 'PD รวม' }), el('small', { text: 'PD total' })]),
          el('td', {}, [input('pd_total', { value: t.pd_total ?? '', placeholder: '64' })]),
          el('td'),
        ]),
        ...prism,
      ]),
    ])]),
    toggle,
  ]);
};

/* วัดสองตาพร้อมกัน ใบกระดาษถามแค่ 4 ค่า จึงใช้ตารางย่อชุดเดียวกัน */
const BIN_ROWS = [
  ['sphere', 'Sphere', 'SPH · ค่าสายตา', '-2.25'],
  ['add', 'Add', 'ADD · สายตายาว', '+2.00'],
  ['va', 'VA', 'Visual acuity', '20/20'],
  ['pd', 'PD', 'PD · ระยะรูม่านตา', '32'],
];

const rxBinoGrid = (t) => el('div.rx-wrap', {}, [el('table.rx-grid', {}, [
  rxHead(),
  el('tbody', {}, BIN_ROWS.map((r) => rxRow(t, r, 'bin_'))),
])]);

/* Old Glasses — ค่าที่อ่านได้จากแว่นที่ลูกค้าใส่มา ใบกระดาษถาม SPH / ADD / VA / PD เท่ากัน */
const rxOldGrid = (t) => el('div.rx-wrap', {}, [el('table.rx-grid', {}, [
  rxHead(),
  el('tbody', {}, BIN_ROWS.map((r) => rxRow(t, r, 'old_'))),
])]);

export function rxFormFields(
  t = {}, { kindField = true, headerRow = true, historyRx = null, historyGlasses = null } = {}) {
  const out = frag([]);
  /* ที่มาของค่า / ใช้สำหรับ / ผู้วัด ย้ายไปอยู่ในกล่อง Old Glasses แล้ว
     หัวฟอร์มจึงเหลือแค่ช่องที่เป็นของทั้งใบ และมีเฉพาะหน้าบันทึกเต็ม
     headerRow: 'compact' = ไม่ต้องมีหัวเลย เพราะช่องที่เหลือหน้าเคสไม่ได้ถาม */
  if (headerRow && headerRow !== 'compact') {
    out.append(el('div.form-grid.two', {}, [
      kindField
        ? field('ชนิดค่าสายตา', select('kind',
          [['old', 'ค่าเดิม (แว่นเก่า)'], ['measured', 'ค่าที่วัดได้'], ['final', 'ค่าที่ใช้จริง']],
          t.kind || 'measured'))
        : null,
      field('วันที่วัด', input('test_date', {
        type: 'datetime-local', value: dtLocal(t.test_date) || nowLocal(),
      })),
    ]));
  }
  /* บล็อกบนสุดของใบกระดาษ — ตาเปล่า กับ ระยะที่ใช้สายตา */
  out.append(el('fieldset', { style: 'margin-top:14px' }, [
    el('legend', { text: 'ตาเปล่า / ระยะใช้งาน' }),
    el('div.form-grid', {}, [
      field('ตาเปล่า R', input('va_naked_r', { value: t.va_naked_r || '', placeholder: '20/40' })),
      field('ตาเปล่า L', input('va_naked_l', { value: t.va_naked_l || '', placeholder: '20/40' })),
      field('ระยะอ่านหนังสือ R (ซม.)', input('dist_vertical_r', { value: t.dist_vertical_r || '' })),
      field('ระยะอ่านหนังสือ L (ซม.)', input('dist_vertical_l', { value: t.dist_vertical_l || '' })),
      field('ระยะคอมพิวเตอร์ R (ซม.)', input('dist_monitor_r', { value: t.dist_monitor_r || '' })),
      field('ระยะคอมพิวเตอร์ L (ซม.)', input('dist_monitor_l', { value: t.dist_monitor_l || '' })),
      field('รู้จักร้านจาก', listSelect('known_from', 'marketing', t.known_from, { blank: '—' })),
    ]),
  ]));

  out.append(el('fieldset', {}, [
    el('legend', { text: 'ประวัติสุขภาพ' }),
    el('div.row', { style: 'gap:16px' }, [
      ['health_cataract', 'ต้อกระจก'], ['health_eye_surgery', 'เคยผ่าตัดตา'],
      ['health_diabetes', 'เบาหวาน'], ['health_bp', 'ความดัน'], ['health_heart', 'โรคหัวใจ'],
    ].map(([k, label]) =>
      el('label.check', {}, [input(k, { type: 'checkbox', checked: !!t[k] }), ' ' + label]))),
    el('div.field.full', { style: 'margin-top:12px' }, [
      el('label', { text: 'รายละเอียดสุขภาพ' }),
      input('health_note', { value: t.health_note || '' }),
    ]),
  ]));

  /* Old Glasses — แว่นที่ลูกค้าใส่มา
     ค่าชุดนี้ได้มาจากไหน ใช้สำหรับระยะไหน ใครเป็นคนอ่าน อยู่ในกล่องเดียวกับตัวค่า
     จะได้อ่านเป็นใบเดียวกันเหมือนใบกระดาษ */
  /* ค่าแว่นเดิมมาได้ 3 ทางเท่านั้น — ดึงจากประวัติ / วัดจากแว่น / ใบจากภายนอก */
  const srcSel = listSelect('source', 'rx_source_old', t.source, { blank: '—' });
  const typeSel = listSelect('old_glasses_type', 'old_glasses_type', t.old_glasses_type,
    { blank: '— ไม่มีแว่นเดิม —' });
  /* select ที่ disabled จะไม่ถูกส่งไปกับฟอร์ม ต้องมีตัวเงาคอยถือค่าไว้แทน
     วางไว้ก่อน select จริง เวลาปลดล็อกค่าจาก select จึงเขียนทับตัวเงา */
  const typeMirror = input('old_glasses_type', { type: 'hidden', value: t.old_glasses_type || '' });
  const srcHint = el('p.hint', { style: 'margin:6px 0 0' });

  const performedSel = employeeSelect('performed_by', t.performed_by);

  const lockType = (on) => {
    typeSel.disabled = on;
    typeMirror.value = on ? typeSel.value : '';
  };

  const oldFs = el('fieldset', {}, [
    el('legend', { text: 'Old Glasses — แว่นเดิมที่ลูกค้าใส่มา' }),
    el('div.form-grid', { style: 'margin-bottom:4px' }, [
      field('ที่มาของค่า', srcSel),
      field('ผู้วัด / ผู้อ่านค่า', performedSel),
      el('div.field', {}, [
        el('label', { text: 'แว่นเดิมเป็นแบบ' }), typeMirror, typeSel,
      ]),
    ]),
    el('div', { style: 'margin-bottom:12px' }, [srcHint]),
    rxOldGrid(t),
  ]);

  /* "ดึงจากประวัติในระบบ" = ค่ามาจากใบเก่า คนกรอกไม่ต้องพิมพ์และแก้ไม่ได้
     อีกสองทางคนกรอกอ่านค่ามาเอง จึงปลดล็อกให้เลือก/พิมพ์ตามจริง */
  /* จำค่าที่เติมให้จากประวัติไว้ พอเปลี่ยนไปที่มาอื่นจะได้ล้างเฉพาะช่องที่ยังไม่ถูกแก้
     ถ้าคนกรอกพิมพ์ทับไปแล้วก็ปล่อยไว้ ไม่ลบงานที่เขาทำ */
  let pulled = null;

  const clearPulled = () => {
    if (!pulled) return;
    for (const [name, val] of Object.entries(pulled)) {
      const box = oldFs.querySelector(`[name=${name}]`);
      if (box && box.value === val) box.value = '';
    }
    if (typeSel.value === (pulled.__type || '')) typeSel.value = '';
    pulled = null;
  };

  const applySource = async () => {
    if (srcSel.value !== 'history') {
      clearPulled();
      lockType(false);
      srcHint.textContent = '';
      return;
    }
    const r = historyRx ? await historyRx() : null;
    if (!r) {
      lockType(false);
      srcHint.textContent = 'ไม่พบค่าสายตาเดิมของลูกค้ารายนี้ในระบบ — เลือกที่มาเป็นทางอื่นแล้วกรอกเองได้เลย';
      return;
    }
    /* ค่าในแว่นที่ใส่อยู่ = ค่าที่สั่งตัดไว้ในใบก่อนหน้า */
    pulled = {};
    for (const k of ['r', 'l']) {
      for (const fld of ['sphere', 'add', 'va', 'pd']) {
        const name = `old_${k}_${fld}`;
        const box = oldFs.querySelector(`[name=${name}]`);
        if (!box) continue;
        box.value = r[`${k}_${fld}`] ?? '';
        pulled[name] = box.value;
      }
    }
    // เติมชื่อผู้วัดจากใบเก่าไว้ก่อน แก้ไขได้ตามปกติ (ไม่ล็อกเหมือนชนิดแว่น)
    if (r.performed_by) {
      performedSel.value = String(r.performed_by);
      pulled.performed_by = performedSel.value;
    }
    /* ใบเก่าส่วนใหญ่ไม่ได้กรอกช่องนี้ไว้ ให้ดูจากเลนส์ที่สั่งตัดในออเดอร์เก่าแทน
       เพราะแว่นที่ลูกค้าใส่มาก็คือแว่นที่เราตัดให้รอบก่อนนั่นเอง */
    const fromOrder = historyGlasses ? await historyGlasses() : null;
    const type = r.old_glasses_type || fromOrder?.type || '';
    typeSel.value = type;
    pulled.__type = type;
    lockType(!!type);
    const when = fmtDate(r.test_date);
    srcHint.textContent = type
      ? `ดึงจากใบวันที่ ${when} · ชนิดแว่น${fromOrder && !r.old_glasses_type ? 'มาจากเลนส์ที่ตัดให้รอบก่อน' : 'ตามที่บันทึกไว้'} — ล็อกไว้ แก้ไม่ได้`
      : `ดึงจากใบวันที่ ${when} — ประวัติไม่ได้ระบุชนิดแว่น เลือกเองได้`;
  };
  srcSel.addEventListener('change', applySource);
  if (srcSel.value === 'history') applySource();

  out.append(oldFs);

  /* RX Monocular — ค่าแยกตาทีละข้าง ตรงกับบล็อกบนใบวัดสายตาของร้าน */
  out.append(el('fieldset', {}, [
    el('legend', { text: 'RX Monocular — ค่าแยกตา' }),
    rxGrid(t),
  ]));

  /* RX Binocular — วัดสองตาพร้อมกัน กระดาษถามแค่ SPH / ADD / VA / PD */
  out.append(el('fieldset', {}, [
    el('legend', { text: 'RX Binocular — วัดสองตาพร้อมกัน' }),
    rxBinoGrid(t),
  ]));

  out.append(el('div.form-grid', {}, [
    /* ผู้บันทึก = คนที่นั่งคีย์ข้อมูล อาจคนละคนกับผู้วัด ใบกระดาษถามแยกกัน */
    field('ผู้บันทึก', employeeSelect('recorded_by', t.recorded_by)),
  ]));

  out.append(el('div.form-grid.two', {}, [
    el('div.field', {}, [
      el('label', { text: 'บันทึกการตรวจ / Exam note' }),
      el('textarea', { name: 'exam_note', text: t.exam_note || '' }),
    ]),
    el('div.field', {}, [
      el('label', { text: 'หมายเหตุ / Notes' }),
      el('textarea', { name: 'notes', text: t.notes || '' }),
    ]),
  ]));
  return out;
}

export async function prescriptionForm({ params, query, navigate }) {
  const editing = !!params.id;
  const t = editing ? await api.get('/api/prescriptions/' + params.id) : {};
  let customerId = editing ? t.customer_id : (query.customer ? Number(query.customer) : null);
  let customer = customerId ? await api.get('/api/customers/' + customerId) : null;
  const caseId = editing ? t.case_id : (query.case ? Number(query.case) : null);

  const chosen = el('div.card-body');
  const drawChosen = () => chosen.replaceChildren(customer
    ? el('div.row', {}, [
      el('span.badge.blue', { text: '#' + customer.id }),
      el('b', { text: custName(customer) }),
      el('span.muted', { text: customer.phone || '' }),
    ])
    : el('span.muted', { text: 'ยังไม่ได้เลือกลูกค้า' }));
  drawChosen();

  const pick = picker({
    placeholder: 'ค้นหาลูกค้า (ชื่อ / เบอร์โทร / รหัส)',
    fetcher: (q) => api.get('/api/customers', { q, limit: 40 }),
    // ค้นไม่เจอ = ลูกค้าใหม่ ให้เพิ่มได้ตรงนั้นเลย ไม่ต้องทิ้งฟอร์มที่กรอกค้างไว้
    emptyAction: addCustomerAction(),
    label: custName,
    sub: (r) => r.phone || '',
    onPick: (r) => { customer = r; customerId = r.id; drawChosen(); },
  });

  const form = el('form');
  /* ลูกค้าเปลี่ยนได้ระหว่างกรอก จึงอ่าน customerId ตอนกดเลือก ไม่ใช่ตอนสร้างฟอร์ม */
  const historyRx = () => (customerId
    ? api.get('/api/prescriptions', { customer_id: customerId })
      .then((all) => {
        const other = (all || []).filter((r) => r.id !== t.id);
        return other.find((r) => r.kind === 'final') || other[0] || null;
      })
      .catch(() => null)
    : Promise.resolve(null));

  const historyGlasses = () => (customerId
    ? api.get('/api/orders', { customer_id: customerId })
      .then((rows) => {
        const o = (rows || [])[0];
        const type = o ? glassesTypeOfLens(o.lens_type) : '';
        return type ? { type, lens_type: o.lens_type } : null;
      })
      .catch(() => null)
    : Promise.resolve(null));

  form.append(rxFormFields(t, { historyRx, historyGlasses }));
  form.append(el('div.form-actions', { style: 'margin-top:14px' }, [
    el('button.btn.btn-lg', { type: 'submit', text: editing ? '💾 บันทึกการแก้ไข' : '✔ บันทึกผลวัดสายตา' }),
    editing ? el('a.btn.btn-light', { href: '#/print/prescription/' + t.id, text: '🖨 พิมพ์' }) : null,
    el('a.btn.btn-light', {
      href: caseId ? '#/cases/' + caseId : '#/prescriptions', text: 'ยกเลิก',
    }),
  ]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!customerId) return err('กรุณาเลือกลูกค้าก่อน');
    try {
      const body = { ...formData(form), customer_id: customerId, case_id: caseId };
      body.test_date = (body.test_date || '').replace('T', ' ');
      const saved = editing
        ? await api.put('/api/prescriptions/' + t.id, body)
        : await api.post('/api/prescriptions', body);
      ok('บันทึกผลวัดสายตาเรียบร้อย');
      if (caseId) navigate('#/cases/' + caseId);
      else navigate('#/customers/' + customerId);
    } catch (ex) { err(ex); }
  });

  return frag([
    pageHead('👁', 'Prescription', 'บันทึกการวัดสายตา',
      caseId ? [el('a.btn.btn-ghost', { href: '#/cases/' + caseId, text: '← กลับไปที่เคส' })] : []),
    el('div.split', {}, [
      card('ลูกค้า', [pick.node]),
      el('div.card', {}, [
        el('div.card-head', {}, [el('h2', { text: 'ลูกค้าที่เลือก' })]), chosen,
      ]),
    ]),
    card(null, [form]),
  ]);
}

/* ============================== EMPLOYEES ========================== */
export async function employeeList({ refresh }) {
  const rows = await api.get('/api/employees');
  const form = el('form.card-body');
  form.append(el('div.form-grid', {}, [
    field('ชื่อเล่น / Nickname *', input('employee_name', { required: true })),
    field('ชื่อจริง', input('first_name')),
    field('นามสกุล', input('last_name')),
    field('เพศ', listSelect('sex', 'sex', 'Female')),
    field('วันเกิด', input('birth_date', { type: 'date' })),
    field('หน้าที่ / Roles', input('roles', { placeholder: 'เช่น sales, optometrist, technician' })),
  ]));
  form.append(el('div.form-actions', {}, [
    el('button.btn', { type: 'submit', text: '✔ เพิ่มพนักงาน' }),
  ]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/employees', formData(form));
      await loadMeta();
      ok('เพิ่มพนักงานแล้ว');
      refresh();
    } catch (ex) { err(ex); }
  });

  const toggle = async (r) => {
    try {
      await api.put('/api/employees/' + r.id, { ...r, active: r.active ? 0 : 1 });
      await loadMeta();
      refresh();
    } catch (ex) { err(ex); }
  };

  return frag([
    pageHead('🧑‍💼', 'Employee', 'พนักงาน'),
    el('div.card', {}, [
      el('div.card-head', {}, [el('h2', { text: 'เพิ่มพนักงานใหม่' })]),
      form,
    ]),
    card('รายชื่อพนักงาน', [table([
      { label: 'ID', key: 'id', cls: 'mono' },
      { label: 'ชื่อเล่น', key: 'employee_name' },
      { label: 'ชื่อจริง', key: 'first_name' },
      { label: 'นามสกุล', key: 'last_name' },
      { label: 'เพศ', key: 'sex' },
      { label: 'หน้าที่', key: 'roles' },
      { label: 'วันเกิด', render: (r) => fmtDate(r.birth_date), cls: 'nowrap' },
      {
        label: 'สถานะ', render: (r) => (r.active
          ? el('span.badge.ok', { text: 'ทำงานอยู่' })
          : el('span.badge.gray', { text: 'ลาออก' })),
      },
      {
        label: '', cls: 'nowrap', render: (r) => el('button.btn.btn-sm.btn-light', {
          text: r.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน', onclick: () => toggle(r),
        }),
      },
    ], rows, { empty: 'ยังไม่มีพนักงาน' })], { tight: true }),
  ]);
}
