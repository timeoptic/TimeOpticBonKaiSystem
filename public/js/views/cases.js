/* Case board, case detail (full workflow) and lens tracker */
import {
  api, meta, el, frag, card, table, pageHead, field, input, select, listSelect,
  employeeSelect, formData, money, moneyShort, fmtDate, fmtDateTime, dateOnly, dtLocal,
  nowLocal, custName, power, rxNum, ok, err, confirmDialog, picker, todayISO,
  stageInfo, statusChip, statusByCode,
} from '../core.js';

const GROUPS = ['reception', 'exam', 'sales', 'production', 'qc', 'delivery'];

/* ============================== BOARD ============================== */
export async function caseBoard({ navigate, query }) {
  const wrap = el('div');
  wrap.append(pageHead('🗂', 'Case Board', 'กระดานงานในร้าน', [
    el('a.btn.btn-ghost', { href: '#/cases/new', text: '+ เปิดเคสใหม่' }),
    el('a.btn.btn-ghost', { href: '#/lens-tracker', text: '🔎 ติดตามเลนส์' }),
  ]));

  const search = el('input', { type: 'search', placeholder: 'ค้นหา เคส / ลูกค้า / เบอร์ / Invoice', value: query.q || '' });
  const rushOnly = el('input', { type: 'checkbox' });
  const showDone = el('input', { type: 'checkbox' });
  const holder = el('div');
  let timer = null;

  async function run() {
    holder.replaceChildren(el('div.loading', {}, [el('span.spin'), ' กำลังโหลด…']));
    const rows = await api.get('/api/cases', {
      q: search.value.trim(),
      rush: rushOnly.checked ? 1 : '',
      open: showDone.checked ? 0 : '',
      limit: 500,
    });
    const byGroup = {};
    for (const r of rows) (byGroup[r.stage_group] ||= []).push(r);

    const cols = (showDone.checked ? [...GROUPS, 'done'] : GROUPS).map((g) => {
      const info = stageInfo(g);
      const list = byGroup[g] || [];
      return el('div.board-col', {}, [
        el('div.board-head', { style: `border-top-color:${info.color}` }, [
          el('span', { text: `${info.icon} ${info.label}` }),
          el('span.badge.gray', { text: String(list.length) }),
        ]),
        el('div.board-body', {}, list.length
          ? list.map((c) => caseCard(c, navigate))
          : [el('div.board-empty', { text: '—' })]),
      ]);
    });
    holder.replaceChildren(el('div.board', {}, cols));
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
  rushOnly.addEventListener('change', run);
  showDone.addEventListener('change', run);

  wrap.append(el('div.toolbar', {}, [
    el('div.field.grow', {}, [el('label', { text: 'ค้นหา' }), search]),
    el('label.check', {}, [rushOnly, ' ด่วนเท่านั้น 🔥']),
    el('label.check', {}, [showDone, ' แสดงเคสที่จบแล้ว']),
    el('button.btn.btn-light', { text: '↻ รีเฟรช', onclick: run }),
  ]));
  wrap.append(holder);
  run();
  return wrap;
}

function caseCard(c, navigate) {
  const late = c.expected_arrival && new Date(c.expected_arrival) < new Date()
    && c.lens_status === 'waiting_arrival';
  return el('div.case-card', {
    class: c.is_rush ? 'rush' : '',
    onclick: () => navigate('#/cases/' + c.id),
  }, [
    el('div.cc-top', {}, [
      el('b', { text: [c.first_name, c.last_name].filter(Boolean).join(' ') }),
      c.is_rush ? el('span.badge.danger', { text: '🔥 ด่วน' }) : null,
    ]),
    el('div.cc-code', { text: `${c.case_code}${c.invoice_code ? ' · ' + c.invoice_code : ''}` }),
    el('div.cc-status', { text: `${c.stage_no} ${c.status_label_th}` }),
    c.lens_name || c.frame_name
      ? el('div.cc-item', { text: [c.lens_name, c.frame_name].filter(Boolean).join(' / ') })
      : null,
    el('div.cc-foot', {}, [
      c.appointment_date
        ? el('span', { text: '📅 ' + fmtDate(c.appointment_date) })
        : el('span.muted', { text: '—' }),
      c.balance !== null && c.balance !== undefined
        ? el('span', { text: 'ค้าง ' + moneyShort(c.balance) }) : null,
    ]),
    el('div.cc-foot', {}, [
      el('span.muted', { text: `เปิดมา ${c.age_days} วัน` }),
      late ? el('span.badge.danger', { text: 'เลนส์เลย ETA' }) : null,
      c.is_waiting ? el('span.badge.warn', { text: 'รอ' }) : null,
    ]),
  ]);
}

/* ============================= NEW CASE ============================ */
export async function caseForm({ query, navigate }) {
  let customer = query.customer ? await api.get('/api/customers/' + query.customer) : null;
  const chosen = el('div.card-body');
  const draw = () => chosen.replaceChildren(customer
    ? el('div.row', {}, [
      el('span.badge.blue', { text: '#' + customer.id }),
      el('b', { text: custName(customer) }),
      el('span.muted', { text: customer.phone || '' }),
    ])
    : el('span.muted', { text: 'ยังไม่ได้เลือกลูกค้า' }));
  draw();

  const pick = picker({
    placeholder: 'ค้นหาลูกค้า (ชื่อ / เบอร์โทร / รหัส)',
    fetcher: (q) => api.get('/api/customers', { q, limit: 40 }),
    label: custName,
    sub: (r) => r.phone || '',
    onPick: (r) => { customer = r; draw(); },
  });

  const form = el('form');
  form.append(card('เปิดเคสใหม่', [
    el('div.form-grid', {}, [
      field('พนักงานผู้รับเรื่อง', employeeSelect('received_by', '')),
      field('สถานะเริ่มต้น', select('status',
        (meta.statuses || []).filter((s) => !s.is_terminal)
          .map((s) => [s.code, `${s.stage_no} ${s.label_th}`]), 'reception')),
      el('div.field', {}, [
        el('label', { text: 'ประเภทงาน' }),
        el('div.row', {}, [
          el('label.check', {}, [input('is_rush', { type: 'checkbox' }), ' งานด่วน 🔥']),
          el('label.check', {}, [input('is_new_customer', { type: 'checkbox' }), ' ลูกค้าใหม่']),
        ]),
      ]),
      field('หมายเหตุความเร่งด่วน', input('priority_note')),
    ]),
    el('div.field.full', {}, [
      el('label', { text: 'บันทึกตอนรับเรื่อง / Reception note' }),
      el('textarea', { name: 'reception_note', placeholder: 'ลูกค้าต้องการอะไร มีอาการอย่างไร' }),
    ]),
    el('div.form-actions', {}, [
      el('button.btn.btn-lg', { type: 'submit', text: '✔ เปิดเคส' }),
      el('a.btn.btn-light', { href: '#/cases', text: 'ยกเลิก' }),
    ]),
  ]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!customer) return err('กรุณาเลือกลูกค้าก่อน');
    try {
      const saved = await api.post('/api/cases', { ...formData(form), customer_id: customer.id });
      ok('เปิดเคส ' + saved.case_code + ' แล้ว');
      navigate('#/cases/' + saved.id);
    } catch (ex) { err(ex); }
  });

  return frag([
    pageHead('🗂', 'New Case', 'เปิดเคสใหม่'),
    el('div.split', {}, [
      el('div.card', {}, [
        el('div.card-head', {}, [
          el('h2', { text: 'เลือกลูกค้า' }),
          el('div.right', {}, [el('a.btn.btn-sm.btn-light', { href: '#/customers/new', text: '+ ลูกค้าใหม่' })]),
        ]),
        el('div.card-body', {}, [pick.node]),
      ]),
      el('div.card', {}, [
        el('div.card-head', {}, [el('h2', { text: 'ลูกค้าที่เลือก' })]), chosen,
      ]),
    ]),
    form,
  ]);
}

/* ============================ CASE DETAIL ========================== */
const yn = (v) => (v ? '✔' : '—');

function rxTable(t) {
  const row = (label, k) => el('tr', {}, [
    el('td.lbl', { text: label }),
    ...[power(t[`${k}_sphere`]), power(t[`${k}_cylinder`]), rxNum(t[`${k}_axis`]),
      power(t[`${k}_add`]), rxNum(t[`${k}_pd`]), rxNum(t[`${k}_va`]),
      t[`${k}_prism`] || '—'].map((v) => el('td', { text: String(v) })),
  ]);
  return el('table.doc', {}, [
    el('thead', {}, [el('tr', {}, ['', 'SPH', 'CYL', 'AXIS', 'ADD', 'PD', 'VA', 'PRISM']
      .map((h) => el('th', { text: h })))]),
    el('tbody', {}, [row('R', 'r'), row('L', 'l')]),
  ]);
}

export async function caseDetail({ params, navigate, refresh }) {
  const c = await api.get('/api/cases/' + params.id);
  const wrap = el('div');
  const empId = () => Number(document.querySelector('#actor-select')?.value) || null;

  wrap.append(pageHead('🗂', c.case_code, custName(c), [
    el('a.btn.btn-ghost', { href: '#/customers/' + c.customer_id, text: '👤 ข้อมูลลูกค้า' }),
    c.order ? el('a.btn.btn-ghost', { href: '#/orders/' + c.order.id, text: '👓 ออเดอร์' }) : null,
    c.order ? el('a.btn.btn-ghost', { href: '#/print/order/' + c.order.id, text: '🖨 ใบสั่ง' }) : null,
  ]));

  /* ---- status strip ---- */
  const actor = employeeSelect('actor', '');
  actor.id = 'actor-select';
  const statusSel = select('to_status',
    (meta.statuses || []).map((s) => [s.code, `${s.stage_no} ${s.label_th}`]), c.status);

  wrap.append(el('div.card', {}, [
    el('div.card-body', {}, [
      el('div.row', { style: 'gap:14px;align-items:center;margin-bottom:12px' }, [
        statusChip(c),
        c.is_rush ? el('span.badge.danger', { text: '🔥 งานด่วน' }) : null,
        c.is_waiting ? el('span.badge.warn', { text: 'สถานะรอ' }) : null,
        el('span.muted', { text: `เปิดเมื่อ ${fmtDateTime(c.opened_at)}` }),
        c.received_by_name ? el('span.muted', { text: `รับโดย ${c.received_by_name}` }) : null,
        c.phone ? el('span.muted', { text: '☎ ' + c.phone }) : null,
      ]),
      el('div.toolbar', { style: 'margin:0' }, [
        field('ผู้ทำรายการ', actor),
        field('เปลี่ยนสถานะเป็น', statusSel),
        el('button.btn.btn-accent', {
          text: '→ เปลี่ยนสถานะ',
          onclick: async () => {
            try {
              await api.post(`/api/cases/${c.id}/status`,
                { status: statusSel.value, employee_id: empId() });
              ok('เปลี่ยนสถานะแล้ว'); refresh();
            } catch (ex) { err(ex); }
          },
        }),
        el('button.btn.btn-light', {
          text: c.is_rush ? 'ยกเลิกงานด่วน' : '🔥 ตั้งเป็นงานด่วน',
          onclick: async () => {
            try {
              await api.put('/api/cases/' + c.id, { ...c, is_rush: c.is_rush ? 0 : 1 });
              refresh();
            } catch (ex) { err(ex); }
          },
        }),
      ]),
    ]),
  ]));

  /* ---- money strip ---- */
  if (c.order) {
    wrap.append(el('div.kpis', {}, [
      el('div.kpi', {}, [el('div.k-label', { text: 'ราคารวม' }),
        el('div.k-value', { text: moneyShort(c.order.total_price) })]),
      el('div.kpi', {}, [el('div.k-label', { text: 'ส่วนลด' }),
        el('div.k-value', { text: moneyShort(c.order.discount) })]),
      el('div.kpi.ok', {}, [el('div.k-label', { text: 'รับแล้ว' }),
        el('div.k-value', { text: moneyShort(c.paid) })]),
      el('div.kpi.warn', {}, [el('div.k-label', { text: 'คงเหลือ' }),
        el('div.k-value', { text: moneyShort(c.balance) })]),
      el('div.kpi', {}, [el('div.k-label', { text: 'วันนัดรับ' }),
        el('div.k-value', {
          style: 'font-size:17px',
          text: fmtDate(c.order.appointment_date) || '—',
        })]),
    ]));
  }

  /* ---- tab panels ---- */
  const panels = {
    'ค่าสายตา': rxPanel(c, refresh, empId),
    'เลนส์': lensPanel(c, refresh, empId),
    'ผลิต & QC': productionPanel(c, refresh, empId),
    'การเงิน': paymentPanel(c, refresh, empId),
    'ติดต่อลูกค้า': notifyPanel(c, refresh, empId),
    'ไทม์ไลน์': timelinePanel(c, refresh, empId),
  };
  const names = Object.keys(panels);
  const body = el('div');
  const tabs = el('div.tabs', {}, names.map((n, i) =>
    el('a', {
      href: 'javascript:void 0', class: i === 0 ? 'active' : '', text: n,
      onclick: (e) => {
        e.preventDefault();
        [...tabs.children].forEach((a) => a.classList.remove('active'));
        e.target.classList.add('active');
        body.replaceChildren(panels[n]);
      },
    })));
  body.replaceChildren(panels[names[0]]);
  wrap.append(tabs, body);
  return wrap;
}

/* ---------------------------- rx panel ---------------------------- */
function rxPanel(c, refresh, empId) {
  const rows = c.prescriptions || [];
  const KIND = { old: 'ค่าเดิม', measured: 'ที่วัดได้', final: 'ที่ใช้จริง' };
  const box = el('div.stack');

  for (const t of rows) {
    box.append(card(`${KIND[t.kind] || t.kind} — ${fmtDateTime(t.test_date)}`, [
      rxTable(t),
      el('div.row', {}, [
        t.test_for ? el('span.badge.gray', { text: t.test_for }) : null,
        t.performed_by_name ? el('span.muted', { text: 'ผู้วัด ' + t.performed_by_name }) : null,
        t.confirmed_at ? el('span.badge.ok', { text: 'ยืนยันแล้ว' }) : null,
      ]),
      [t.health_cataract && 'ต้อกระจก', t.health_eye_surgery && 'เคยผ่าตัดตา',
        t.health_diabetes && 'เบาหวาน', t.health_bp && 'ความดัน', t.health_heart && 'หัวใจ']
        .filter(Boolean).length
        ? el('p', {}, [el('b', { text: 'สุขภาพ: ' }),
          [t.health_cataract && 'ต้อกระจก', t.health_eye_surgery && 'เคยผ่าตัดตา',
            t.health_diabetes && 'เบาหวาน', t.health_bp && 'ความดัน', t.health_heart && 'หัวใจ']
            .filter(Boolean).join(', '), t.health_note ? ' — ' + t.health_note : ''])
        : null,
      t.exam_note ? el('p.muted', { text: t.exam_note }) : null,
      el('div.row', {}, [
        el('a.btn.btn-sm.btn-light', { href: '#/prescriptions/' + t.id, text: '✎ แก้ไข' }),
        el('a.btn.btn-sm.btn-light', { href: '#/print/prescription/' + t.id, text: '🖨 พิมพ์' }),
        t.kind !== 'final' ? el('button.btn.btn-sm.btn-accent', {
          text: '✔ ใช้ค่านี้เป็นค่าจริง',
          onclick: async () => {
            try {
              await api.post(`/api/prescriptions/${t.id}/confirm`, { employee_id: empId() });
              ok('ยืนยันค่าสายตาแล้ว'); refresh();
            } catch (ex) { err(ex); }
          },
        }) : null,
      ]),
    ], { badge: t.kind === 'final' ? el('span.badge.ok', { text: 'FINAL' }) : null }));
  }
  if (!rows.length) box.append(el('div.empty', { text: 'ยังไม่มีค่าสายตาในเคสนี้' }));
  box.append(el('div.row', {}, [
    el('a.btn.btn-accent', {
      href: `#/prescriptions/new?customer=${c.customer_id}&case=${c.id}`,
      text: '+ บันทึกค่าสายตาใหม่',
    }),
  ]));
  return box;
}

/* --------------------------- lens panel --------------------------- */
function lensPanel(c, refresh, empId) {
  const j = c.lens_job;
  const box = el('div.stack');

  const form = el('form.card-body');
  const source = select('source', [['stock', 'มีในสต็อก (หยิบได้เลย)'], ['order', 'ต้องสั่งซัพพลายเออร์']],
    j?.source || 'stock');
  const supplierWrap = el('div.form-grid');
  const drawSupplier = () => {
    supplierWrap.style.display = source.value === 'order' ? '' : 'none';
  };
  source.addEventListener('change', drawSupplier);

  supplierWrap.append(
    field('ซัพพลายเออร์', select('supplier_id',
      [['', '— เลือก —'], ...(meta.suppliers || []).map((s) => [s.id, s.name])],
      j?.supplier_id || '')),
    field('เลขที่ใบสั่ง', input('supplier_order_no', { value: j?.supplier_order_no || '' })),
    field('วันที่สั่ง', input('order_date', { type: 'date', value: dateOnly(j?.order_date) || todayISO() })),
    field('Lead time (วัน)', input('lead_time_days', { type: 'number', min: '0', value: j?.lead_time_days ?? 7 })),
    field('คาดว่าจะถึง (ETA)', input('expected_arrival', { type: 'date', value: dateOnly(j?.expected_arrival) })),
  );

  form.append(el('div.form-grid', {}, [
    field('แหล่งเลนส์ / Source', source),
    field('ผู้หยิบ/ผู้ตรวจ', employeeSelect('picked_by', j?.picked_by || '')),
    el('div.field', {}, [
      el('label', { text: 'ตรวจสอบ' }),
      el('div.row', {}, [
        el('label.check', {}, [input('rx_checked', { type: 'checkbox', checked: !!j?.rx_checked }), ' ตรวจค่าสายตา']),
        el('label.check', {}, [input('lens_checked', { type: 'checkbox', checked: !!j?.lens_checked }), ' ตรวจเลนส์']),
      ]),
    ]),
  ]));
  form.append(supplierWrap);
  form.append(el('div.field.full', {}, [
    el('label', { text: 'หมายเหตุ' }),
    el('textarea', { name: 'notes', text: j?.notes || '' }),
  ]));
  form.append(el('div.form-actions', {}, [
    el('button.btn', { type: 'submit', text: j ? '💾 บันทึกงานเลนส์' : '+ สร้างงานเลนส์' }),
    j && j.status !== 'ready' ? el('button.btn.btn-ok', {
      type: 'button', text: '📦 เลนส์มาถึงแล้ว',
      onclick: async () => {
        try {
          await api.post(`/api/lens-jobs/${j.id}/receive`, { received_by: empId() });
          ok('บันทึกรับเลนส์แล้ว'); refresh();
        } catch (ex) { err(ex); }
      },
    }) : null,
  ]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/lens-jobs', {
        ...formData(form), case_id: c.id, order_id: c.order?.id,
        recorded_by: empId(),
      });
      ok('บันทึกงานเลนส์แล้ว'); refresh();
    } catch (ex) { err(ex); }
  });
  drawSupplier();

  box.append(el('div.card', {}, [
    el('div.card-head', {}, [
      el('h2', { text: 'งานเลนส์ — Lens Job' }),
      j ? el('span.badge', {
        class: j.status === 'ready' ? 'ok' : 'warn',
        text: j.status === 'ready' ? 'พร้อมแล้ว' : 'รอเลนส์มา',
      }) : null,
    ]),
    form,
  ]));

  /* follow-ups */
  if (j) {
    const fu = el('form.card-body');
    fu.append(el('div.form-grid', {}, [
      field('ผู้ติดต่อ', employeeSelect('contacted_by', '')),
      field('ช่องทาง', select('channel', ['phone', 'line', 'email', 'walk-in'], 'phone')),
      field('ETA เดิม', input('previous_eta_display', { value: dateOnly(j.expected_arrival) || '-', disabled: true })),
      field('ETA ใหม่', input('new_eta', { type: 'date' })),
      field('วันนัดใหม่ (ถ้าต้องเลื่อน)', input('new_appointment_date', { type: 'date' })),
      el('div.field', {}, [
        el('label', { text: 'ผลกระทบ' }),
        el('div.row', {}, [
          el('label.check', {}, [input('affects_appointment', { type: 'checkbox' }), ' กระทบวันนัด']),
          el('label.check', {}, [input('customer_notified', { type: 'checkbox' }), ' แจ้งลูกค้าแล้ว']),
        ]),
      ]),
    ]));
    fu.append(el('div.field.full', {}, [
      el('label', { text: 'คำตอบจากซัพพลายเออร์ / บันทึก' }),
      el('textarea', { name: 'supplier_reply' }),
    ]));
    fu.append(el('div.form-actions', {}, [
      el('button.btn.btn-light', { type: 'submit', text: '+ บันทึกการติดตาม' }),
    ]));
    fu.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const b = formData(fu);
        delete b.previous_eta_display;
        await api.post(`/api/lens-jobs/${j.id}/followup`, b);
        ok('บันทึกการติดตามแล้ว'); refresh();
      } catch (ex) { err(ex); }
    });

    box.append(el('div.card', {}, [
      el('div.card-head', {}, [
        el('h2', { text: 'ติดตามเลนส์ — Follow-up' }),
        el('span.badge.gray', { text: `${j.follow_up_count || 0} ครั้ง` }),
      ]),
      el('div.card-body.tight', {}, [table([
        { label: '#', key: 'seq', cls: 'num' },
        { label: 'เมื่อ', render: (f) => fmtDateTime(f.contacted_at), cls: 'nowrap' },
        { label: 'โดย', key: 'contacted_by_name' },
        { label: 'ช่องทาง', key: 'channel' },
        { label: 'ETA เดิม', render: (f) => fmtDate(f.previous_eta), cls: 'nowrap' },
        { label: 'ETA ใหม่', render: (f) => fmtDate(f.new_eta), cls: 'nowrap' },
        { label: 'กระทบนัด', render: (f) => yn(f.affects_appointment) },
        { label: 'แจ้งลูกค้า', render: (f) => yn(f.customer_notified) },
        { label: 'บันทึก', render: (f) => f.supplier_reply || f.note || '' },
      ], j.followups || [], { empty: 'ยังไม่มีการติดตาม' })]),
      fu,
    ]));
  }
  return box;
}

/* ------------------------ production panel ------------------------ */
function productionPanel(c, refresh, empId) {
  const p = c.production || {};
  const box = el('div.stack');

  /* frame fitting + centering */
  const ff = c.frame_fitting || {};
  const ce = c.centering || {};
  const fitForm = el('form.card-body');
  fitForm.append(el('div.form-grid', {}, [
    field('Frame size', input('frame_size', { value: ff.frame_size || '' })),
    field('Lens width', input('lens_width', { value: ff.lens_width || '' })),
    field('Bridge', input('bridge_width', { value: ff.bridge_width || '' })),
    field('Temple', input('temple_length', { value: ff.temple_length || '' })),
    field('ED', input('ed', { value: ff.ed || '' })),
    field('DBL', input('dbl', { value: ff.dbl || '' })),
    field('ผู้วัด', employeeSelect('performed_by', ff.performed_by || '')),
  ]));
  fitForm.append(el('div.form-actions', {}, [
    el('button.btn.btn-light', { type: 'submit', text: '💾 บันทึกการวัดกรอบ' })]));
  fitForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/frame-fittings',
        { ...formData(fitForm), case_id: c.id, order_id: c.order?.id, recorded_by: empId() });
      ok('บันทึกแล้ว'); refresh();
    } catch (ex) { err(ex); }
  });

  const ctForm = el('form.card-body');
  ctForm.append(el('div.form-grid', {}, [
    field('R PD', input('r_pd', { value: ce.r_pd || '' })),
    field('L PD', input('l_pd', { value: ce.l_pd || '' })),
    field('PD รวม', input('pd_total', { value: ce.pd_total || '' })),
    field('R Height', input('r_height', { value: ce.r_height || '' })),
    field('L Height', input('l_height', { value: ce.l_height || '' })),
    field('Vertex', input('vertex_distance', { value: ce.vertex_distance || '' })),
    field('Pantoscopic tilt', input('pantoscopic_tilt', { value: ce.pantoscopic_tilt || '' })),
    field('Wrap angle', input('wrap_angle', { value: ce.wrap_angle || '' })),
    field('ผู้วัด', employeeSelect('performed_by', ce.performed_by || '')),
  ]));
  ctForm.append(el('div.form-actions', {}, [
    el('button.btn.btn-light', { type: 'submit', text: '💾 บันทึกจุดศูนย์กลาง' })]));
  ctForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/centerings',
        { ...formData(ctForm), case_id: c.id, order_id: c.order?.id, recorded_by: empId() });
      ok('บันทึกแล้ว'); refresh();
    } catch (ex) { err(ex); }
  });

  box.append(el('div.split', {}, [
    el('div.card', {}, [el('div.card-head', {}, [el('h2', { text: 'วัดกรอบ — Frame Fitting' })]), fitForm]),
    el('div.card', {}, [el('div.card-head', {}, [el('h2', { text: 'จุดศูนย์กลาง — Centering' })]), ctForm]),
  ]));

  /* production job */
  const prod = el('form.card-body');
  prod.append(el('div.form-grid', {}, [
    field('ช่างที่รับงาน', employeeSelect('assigned_technician', p.assigned_technician || '')),
    field('เริ่มฝน', input('edging_started_at', { type: 'datetime-local', value: dtLocal(p.edging_started_at) })),
    field('ฝนเสร็จ', input('edging_finished_at', { type: 'datetime-local', value: dtLocal(p.edging_finished_at) })),
    field('ผู้ฝน', employeeSelect('edged_by', p.edged_by || '')),
    el('div.field', {}, [
      el('label', { text: 'ตรวจจับคู่' }),
      el('div.row', {}, [
        el('label.check', {}, [input('match_customer_ok', { type: 'checkbox', checked: !!p.match_customer_ok }), ' ตรงลูกค้า']),
        el('label.check', {}, [input('match_rx_ok', { type: 'checkbox', checked: !!p.match_rx_ok }), ' ตรงค่าสายตา']),
      ]),
    ]),
    el('div.field.full', {}, [
      el('label', { text: 'Checklist การแพ็ค' }),
      el('div.row', {}, [
        ['pack_glasses', 'แว่น'], ['pack_case', 'กล่อง'], ['pack_cloth', 'ผ้าเช็ด'],
        ['pack_warranty', 'ใบรับประกัน'], ['pack_prescription', 'ใบค่าสายตา'],
        ['pack_accessories', 'อุปกรณ์เสริม'],
      ].map(([k, label]) =>
        el('label.check', {}, [input(k, { type: 'checkbox', checked: !!p[k] }), ' ' + label]))),
    ]),
    field('ผู้แพ็ค', employeeSelect('packed_by', p.packed_by || '')),
    field('ผู้ตรวจการแพ็ค', employeeSelect('pack_checked_by', p.pack_checked_by || '')),
  ]));
  prod.append(el('div.field.full', {}, [
    el('label', { text: 'บันทึกการผลิต' }),
    el('textarea', { name: 'edging_remark', text: p.edging_remark || '' }),
  ]));
  prod.append(el('div.form-actions', {}, [
    el('button.btn.btn-light', { type: 'submit', text: '💾 บันทึกงานผลิต' })]));
  prod.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/production-jobs',
        { ...formData(prod), case_id: c.id, order_id: c.order?.id, employee_id: empId() });
      ok('บันทึกแล้ว'); refresh();
    } catch (ex) { err(ex); }
  });
  box.append(el('div.card', {}, [
    el('div.card-head', {}, [el('h2', { text: 'งานผลิต — Production' })]), prod]));

  /* QC */
  const qc = el('form.card-body');
  qc.append(el('div.form-grid', {}, [
    field('ผลตรวจ', select('result', [['pass', '✅ ผ่าน'], ['fail', '❌ ไม่ผ่าน']], 'pass')),
    field('ผู้ตรวจ', employeeSelect('checked_by', '')),
    field('การแก้ไขที่ทำ', input('action_taken', { placeholder: 'เช่น ฝนใหม่, สั่งเลนส์ใหม่' })),
    el('div.field.full', {}, [
      el('label', { text: 'รายการตรวจ' }),
      el('div.row', {}, [
        ['check_rx', 'ค่าสายตา'], ['check_centering', 'จุดศูนย์กลาง'], ['check_lens', 'เลนส์'],
        ['check_frame', 'กรอบ'], ['check_finish', 'ความเรียบร้อย'],
      ].map(([k, label]) => el('label.check', {}, [input(k, { type: 'checkbox' }), ' ' + label]))),
    ]),
  ]));
  qc.append(el('div.field.full', {}, [
    el('label', { text: 'ข้อบกพร่องที่พบ' }),
    el('textarea', { name: 'defects' }),
  ]));
  qc.append(el('div.form-actions', {}, [
    el('button.btn', { type: 'submit', text: '+ บันทึกผล QC' })]));
  qc.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/qc-checks', { ...formData(qc), case_id: c.id });
      ok('บันทึกผล QC แล้ว'); refresh();
    } catch (ex) { err(ex); }
  });

  box.append(el('div.card', {}, [
    el('div.card-head', {}, [
      el('h2', { text: 'QC' }),
      el('span.badge.gray', { text: `${(c.qc_checks || []).length} รอบ` }),
    ]),
    el('div.card-body.tight', {}, [table([
      { label: 'รอบ', key: 'attempt', cls: 'num' },
      {
        label: 'ผล', render: (r) => el('span.badge', {
          class: r.result === 'pass' ? 'ok' : 'danger',
          text: r.result === 'pass' ? 'ผ่าน' : 'ไม่ผ่าน',
        }),
      },
      { label: 'เมื่อ', render: (r) => fmtDateTime(r.checked_at), cls: 'nowrap' },
      { label: 'ผู้ตรวจ', key: 'checked_by_name' },
      { label: 'ข้อบกพร่อง', key: 'defects' },
      { label: 'แก้ไข', key: 'action_taken' },
    ], c.qc_checks || [], { empty: 'ยังไม่มีการตรวจ QC' })]),
    qc,
  ]));
  return box;
}

/* -------------------------- payment panel ------------------------- */
function paymentPanel(c, refresh, empId) {
  const form = el('form.card-body');
  form.append(el('div.form-grid', {}, [
    field('ประเภท', select('kind', [['deposit', 'มัดจำ'], ['partial', 'จ่ายบางส่วน'],
      ['final', 'ชำระส่วนที่เหลือ'], ['full', 'ชำระเต็ม']],
    c.paid > 0 ? 'final' : 'deposit')),
    field('จำนวนเงิน', input('amount', {
      type: 'number', step: '1', min: '1', value: c.balance > 0 ? c.balance : '', required: true,
    })),
    field('วิธีชำระ', listSelect('method', 'pay_type', 'Cash')),
    field('อ้างอิง (เลขที่โอน)', input('reference')),
    field('ผู้รับเงิน', employeeSelect('received_by', '')),
    field('เมื่อ', input('paid_at', { type: 'datetime-local', value: nowLocal() })),
  ]));
  form.append(el('div.form-actions', {}, [
    el('button.btn', { type: 'submit', text: '+ บันทึกการรับเงิน' })]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const b = formData(form);
      b.paid_at = (b.paid_at || '').replace('T', ' ');
      await api.post('/api/payments', { ...b, case_id: c.id, order_id: c.order?.id });
      ok('บันทึกการรับเงินแล้ว'); refresh();
    } catch (ex) { err(ex); }
  });

  return el('div.stack', {}, [
    el('div.card', {}, [
      el('div.card-head', {}, [
        el('h2', { text: 'ประวัติการรับเงิน' }),
        el('span.badge.ok', { text: 'รับแล้ว ' + money(c.paid) }),
      ]),
      el('div.card-body.tight', {}, [table([
        { label: 'เมื่อ', render: (p) => fmtDateTime(p.paid_at), cls: 'nowrap' },
        { label: 'ประเภท', key: 'kind' },
        { label: 'วิธี', key: 'method' },
        { label: 'จำนวน', render: (p) => money(p.amount), cls: 'num' },
        { label: 'อ้างอิง', key: 'reference' },
        { label: 'ผู้รับ', key: 'received_by_name' },
        { label: 'หมายเหตุ', key: 'notes' },
        {
          label: '', cls: 'nowrap', render: (p) => el('button.btn.btn-sm.btn-light', {
            text: '🗑', onclick: async () => {
              if (!await confirmDialog('ลบรายการรับเงิน',
                `ลบ ${money(p.amount)} (${p.kind})?`, { confirmText: 'ลบ', danger: true })) return;
              try { await api.del('/api/payments/' + p.id); ok('ลบแล้ว'); refresh(); }
              catch (ex) { err(ex); }
            },
          }),
        },
      ], c.payments || [], {
        empty: 'ยังไม่มีการรับเงิน',
        footer: (c.payments || []).length ? el('tr', {}, [
          el('td', { colspan: 3, text: 'รวม' }),
          el('td.num', { text: money(c.paid) }),
          el('td', { colspan: 4 }),
        ]) : null,
      })]),
      form,
    ]),
  ]);
}

/* --------------------------- notify panel ------------------------- */
function notifyPanel(c, refresh, empId) {
  const form = el('form.card-body');
  form.append(el('div.form-grid', {}, [
    field('ช่องทาง', select('channel', ['phone', 'line', 'sms', 'email', 'walk-in'], 'phone')),
    field('ผลการติดต่อ', select('result',
      [['reached', 'ติดต่อได้'], ['no_answer', 'ไม่รับสาย'], ['left_message', 'ฝากข้อความ'],
        ['wrong_number', 'เบอร์ผิด']], 'reached')),
    field('ผู้ติดต่อ', employeeSelect('contacted_by', '')),
  ]));
  form.append(el('div.field.full', {}, [
    el('label', { text: 'บันทึก' }), el('textarea', { name: 'note' })]));
  form.append(el('div.form-actions', {}, [
    el('button.btn', { type: 'submit', text: '+ บันทึกการติดต่อ' })]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post(`/api/cases/${c.id}/notify`, formData(form));
      ok('บันทึกแล้ว'); refresh();
    } catch (ex) { err(ex); }
  });

  return el('div.card', {}, [
    el('div.card-head', {}, [
      el('h2', { text: 'ประวัติการติดต่อลูกค้า' }),
      c.phone ? el('a.btn.btn-sm.btn-light', { href: 'tel:' + c.phone, text: '☎ ' + c.phone }) : null,
    ]),
    el('div.card-body.tight', {}, [table([
      { label: 'เมื่อ', render: (n) => fmtDateTime(n.contacted_at), cls: 'nowrap' },
      { label: 'ช่องทาง', key: 'channel' },
      { label: 'ผล', key: 'result' },
      { label: 'โดย', key: 'contacted_by_name' },
      { label: 'บันทึก', key: 'note' },
    ], c.notifications || [], { empty: 'ยังไม่เคยติดต่อ' })]),
    form,
  ]);
}

/* -------------------------- timeline panel ------------------------ */
function timelinePanel(c, refresh, empId) {
  const noteForm = el('form.card-body');
  noteForm.append(el('div.row', {}, [
    el('div.field.grow', {}, [
      el('label', { text: 'เพิ่มบันทึกลงไทม์ไลน์' }),
      input('note', { placeholder: 'พิมพ์บันทึก…', required: true }),
    ]),
    el('button.btn', { type: 'submit', text: '+ บันทึก' }),
  ]));
  noteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post(`/api/cases/${c.id}/note`,
        { ...formData(noteForm), employee_id: empId() });
      ok('บันทึกแล้ว'); refresh();
    } catch (ex) { err(ex); }
  });

  const items = (c.events || []).map((ev) => el('div.tl-item', {}, [
    el('div.tl-dot'),
    el('div.tl-body', {}, [
      el('div.tl-head', {}, [
        el('b', { text: ACTION_LABEL[ev.action] || ev.action }),
        ev.to_label ? el('span.badge.blue', { text: `→ ${ev.to_label}` }) : null,
        el('span.muted', { text: fmtDateTime(ev.created_at) }),
        ev.employee_name ? el('span.muted', { text: '· ' + ev.employee_name }) : null,
      ]),
      ev.note ? el('div.tl-note', { text: ev.note }) : null,
    ]),
  ]));

  return el('div.card', {}, [
    el('div.card-head', {}, [
      el('h2', { text: 'ไทม์ไลน์เคส' }),
      el('span.badge.gray', { text: `${(c.events || []).length} เหตุการณ์` }),
    ]),
    noteForm,
    el('div.card-body', {}, items.length
      ? [el('div.timeline', {}, items)]
      : [el('div.empty', { text: 'ยังไม่มีเหตุการณ์' })]),
  ]);
}

const ACTION_LABEL = {
  case_opened: 'เปิดเคส',
  status_change: 'เปลี่ยนสถานะ',
  note: 'บันทึก',
  prescription_added: 'บันทึกค่าสายตา',
  prescription_confirmed: 'ยืนยันค่าสายตา',
  order_created: 'เปิดออเดอร์',
  order_filled: 'เติมของเข้าออเดอร์',
  order_closed: 'ปิดการขาย',
  order_reopened: 'เปิดออเดอร์อีกครั้ง',
  payment: 'รับเงิน',
  payment_deleted: 'ลบรายการรับเงิน',
  lens_job_saved: 'บันทึกงานเลนส์',
  lens_followup: 'ติดตามเลนส์',
  lens_received: 'รับเลนส์เข้าร้าน',
  centering_saved: 'บันทึกจุดศูนย์กลาง',
  frame_fitting_saved: 'บันทึกการวัดกรอบ',
  production_saved: 'บันทึกงานผลิต',
  qc_pass: 'QC ผ่าน',
  qc_fail: 'QC ไม่ผ่าน',
  customer_notified: 'ติดต่อลูกค้า',
};

/* =========================== LENS TRACKER ========================== */
export async function lensTracker({ navigate, query }) {
  const wrap = el('div');
  wrap.append(pageHead('🔎', 'Lens Tracker', 'ติดตามเลนส์ที่สั่งซัพพลายเออร์', [
    el('a.btn.btn-ghost', { href: '#/cases', text: '← กระดานงาน' }),
  ]));

  const risk = select('risk', [['', 'ทุกระดับ'], ['late', 'เลย ETA'], ['soon', 'ใกล้ถึง'],
    ['ok', 'ปกติ']], query.risk || '');
  const threat = el('input', { type: 'checkbox' });
  const holder = el('div');

  async function run() {
    holder.replaceChildren(el('div.loading', {}, [el('span.spin'), ' กำลังโหลด…']));
    const rows = await api.get('/api/lens-tracker', {
      risk: risk.value, threatens: threat.checked ? 1 : '',
    });
    holder.replaceChildren(card(null, [table([
      { label: 'เคส', key: 'case_code', cls: 'mono' },
      {
        label: '', render: (r) => (r.is_rush
          ? el('span.badge.danger', { text: '🔥' }) : ''),
      },
      { label: 'ลูกค้า', render: custName },
      { label: 'เบอร์', key: 'phone', cls: 'nowrap' },
      { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
      { label: 'เลนส์', key: 'lens_name' },
      { label: 'ซัพพลายเออร์', key: 'supplier_name' },
      { label: 'เลขที่สั่ง', key: 'supplier_order_no' },
      { label: 'สั่งเมื่อ', render: (r) => fmtDate(r.order_date), cls: 'nowrap' },
      { label: 'ETA', render: (r) => fmtDate(r.expected_arrival), cls: 'nowrap' },
      {
        label: 'เหลือ (วัน)', cls: 'num',
        render: (r) => (r.days_to_eta === null ? '—' : String(r.days_to_eta)),
      },
      {
        label: 'ความเสี่ยง', render: (r) => el('span.badge', {
          class: r.risk_level === 'late' ? 'danger' : r.risk_level === 'soon' ? 'warn' : 'ok',
          text: r.risk_level,
        }),
      },
      { label: 'ตามแล้ว', key: 'follow_up_count', cls: 'num' },
      { label: 'วันนัด', render: (r) => fmtDate(r.appointment_date), cls: 'nowrap' },
      {
        label: 'กระทบนัด', render: (r) => (r.threatens_appointment
          ? el('span.badge.danger', { text: 'เสี่ยงเลื่อน' }) : ''),
      },
    ], rows, {
      onRowClick: (r) => navigate('#/cases/' + r.case_id),
      empty: 'ไม่มีเลนส์ที่กำลังรอ',
    })], { tight: true }));
  }
  risk.addEventListener('change', run);
  threat.addEventListener('change', run);

  wrap.append(el('div.toolbar', {}, [
    field('ระดับความเสี่ยง', risk),
    el('label.check', {}, [threat, ' เฉพาะที่กระทบวันนัด']),
    el('button.btn.btn-light', { text: '↻ รีเฟรช', onclick: run }),
  ]));
  wrap.append(holder);
  run();
  return wrap;
}
