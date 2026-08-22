/* Custom orders — list, create/edit, fill, close */
import {
  api, meta, el, frag, card, table, pageHead, field, input, select, listSelect,
  employeeSelect, formData, money, fmtDate, fmtDateTime, dtLocal, dateOnly, custName,
  power, rxNum, ok, err, confirmDialog, statusBadge, picker, todayISO, nowLocal,
} from '../core.js';

const STATUS_TABS = [
  ['all', 'ทั้งหมด'],
  ['unfilled', 'รอของ (Unfilled)'],
  ['unclosed', 'รอลูกค้ารับ (Unclosed)'],
  ['closed', 'ปิดการขายแล้ว'],
];

/* ------------------------------ LIST ------------------------------ */
export async function orderList({ navigate, query }) {
  const status = query.status || 'all';
  const wrap = el('div');
  wrap.append(pageHead('👓', 'Order History', 'ประวัติการสั่งตัดแว่น', [
    el('a.btn.btn-ghost', { href: '#/orders/new', text: '+ เปิดออเดอร์ใหม่' }),
  ]));
  wrap.append(el('div.tabs', {}, STATUS_TABS.map(([v, label]) =>
    el('a', { href: '#/orders?status=' + v, class: v === status ? 'active' : '', text: label }))));

  const search = el('input', { type: 'search', placeholder: 'ชื่อลูกค้า / เบอร์ / Invoice / เลนส์ / กรอบ', value: query.q || '' });
  const from = el('input', { type: 'date', value: query.from || '' });
  const to = el('input', { type: 'date', value: query.to || '' });
  const holder = el('div');
  let timer = null;

  async function run() {
    holder.replaceChildren(el('div.loading', {}, [el('span.spin'), ' กำลังค้นหา…']));
    const rows = await api.get('/api/orders', {
      status, q: search.value.trim(), from: from.value, to: to.value, limit: 500,
    });
    const sum = rows.reduce((a, o) => ({
      total: a.total + o.total_price,
      deposit: a.deposit + o.deposit,
      discount: a.discount + o.discount,
      income: a.income + o.order_close_income,
    }), { total: 0, deposit: 0, discount: 0, income: 0 });

    holder.replaceChildren(card(null, [table([
      { label: 'ID', key: 'id', cls: 'mono' },
      { label: 'วันที่สั่ง', render: (o) => fmtDateTime(o.order_date), cls: 'nowrap' },
      { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
      { label: 'ลูกค้า', render: custName },
      { label: 'พนักงาน', render: (o) => o.employee_name || '-' },
      { label: 'เลนส์', key: 'lens_name' },
      { label: 'กรอบ', key: 'frame_name' },
      { label: 'นัดรับ', render: (o) => fmtDate(o.appointment_date), cls: 'nowrap' },
      { label: 'ยอดรวม', render: (o) => money(o.total_price), cls: 'num' },
      { label: 'มัดจำ', render: (o) => money(o.deposit), cls: 'num' },
      { label: 'ส่วนลด', render: (o) => money(o.discount), cls: 'num' },
      { label: 'รับเมื่อปิด', render: (o) => money(o.order_close_income), cls: 'num' },
      { label: 'สถานะ', render: statusBadge },
    ], rows, {
      onRowClick: (o) => navigate('#/orders/' + o.id),
      empty: 'ไม่พบออเดอร์',
      footer: rows.length ? el('tr', {}, [
        el('td', { colspan: 8, text: `รวม ${rows.length} ออเดอร์` }),
        el('td.num', { text: money(sum.total) }),
        el('td.num', { text: money(sum.deposit) }),
        el('td.num', { text: money(sum.discount) }),
        el('td.num', { text: money(sum.income) }),
        el('td'),
      ]) : null,
    })], { tight: true }));
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
  from.addEventListener('change', run);
  to.addEventListener('change', run);

  wrap.append(el('div.toolbar', {}, [
    el('div.field.grow', {}, [el('label', { text: 'ค้นหา' }), search]),
    field('ตั้งแต่วันที่', from),
    field('ถึงวันที่', to),
    el('button.btn.btn-light', {
      text: 'ล้างตัวกรอง',
      onclick: () => { search.value = ''; from.value = ''; to.value = ''; run(); },
    }),
  ]));
  wrap.append(holder);
  run();
  return wrap;
}

/* --------------------- stock picker (lens/frame) ------------------- */
function stockPicker(labelText, type, initial, onChange) {
  const box = el('div.stack');
  const shown = el('div');
  let current = initial || null;

  const draw = () => shown.replaceChildren(current
    ? el('div.row', {}, [
      el('span.badge.blue', { text: '#' + current.id }),
      el('b', { text: current.product_name }),
      el('span.muted', { text: money(current.product_price) }),
      el('button.btn.btn-sm.btn-light', {
        type: 'button', text: '✕ เอาออก',
        onclick: () => { current = null; draw(); onChange(null); },
      }),
    ])
    : el('span.muted', { text: 'ยังไม่ได้เลือก' }));
  draw();

  const p = picker({
    placeholder: `ค้นหา${labelText}ในคลัง (ชื่อ / รหัส)`,
    fetcher: (q) => api.get('/api/stock', { q, type, sold: 0, limit: 40 }),
    label: (r) => r.product_name,
    sub: (r) => `${money(r.product_price)}${r.location ? ' · ' + r.location : ''}`,
    onPick: (r) => { current = r; draw(); onChange(r); },
  });

  box.append(shown, p.node);
  return { node: box, get value() { return current; } };
}

/* ------------------------------ FORM ------------------------------ */
export async function orderForm({ params, query, navigate }) {
  const editing = !!params.id;
  const o = editing ? await api.get('/api/orders/' + params.id) : {};
  if (editing && o.order_closed) {
    return frag([
      pageHead('👓', 'Custom Order', 'แก้ไขออเดอร์'),
      card(null, [el('p', { text: 'ออเดอร์นี้ปิดการขายแล้ว จึงแก้ไขไม่ได้' }),
        el('a.btn.btn-light', { href: '#/orders/' + o.id, text: '← กลับไปดูออเดอร์' })]),
    ]);
  }

  const caseId = editing ? o.case_id : (query.case ? Number(query.case) : null);
  let customerId = editing ? o.customer_id : (query.customer ? Number(query.customer) : null);
  let customer = customerId ? await api.get('/api/customers/' + customerId) : null;
  let rxList = customer ? customer.prescriptions : [];
  let rxId = editing ? o.final_prescription_id : (query.eyetest ? Number(query.eyetest) : (rxList[0]?.id ?? null));

  const custBox = el('div.card-body');
  const testBox = el('div.card-body');

  const drawTests = () => {
    if (!customer) return testBox.replaceChildren(el('span.muted', { text: 'เลือกลูกค้าก่อน' }));
    if (!rxList.length) {
      return testBox.replaceChildren(el('div.stack', {}, [
        el('span.muted', { text: 'ลูกค้ารายนี้ยังไม่มีผลวัดสายตา' }),
        el('a.btn.btn-sm.btn-accent', {
          href: `#/prescriptions/new?customer=${customer.id}&next=order`, text: '👁 วัดสายตาเลย',
        }),
      ]));
    }
    testBox.replaceChildren(el('div.picker', {}, rxList.map((t) => {
      const row = el('div.p-row', {
        class: t.id === rxId ? 'sel' : '',
        onclick: () => {
          rxId = t.id;
          [...row.parentElement.children].forEach((c) => c.classList.remove('sel'));
          row.classList.add('sel');
        },
      }, [
        el('span.p-main', {}, [
          el('b', { text: fmtDateTime(t.test_date) }),
          el('span.muted', {
            text: `  R ${power(t.r_sphere)}/${power(t.r_cylinder)}×${rxNum(t.r_axis)}` +
              `   L ${power(t.l_sphere)}/${power(t.l_cylinder)}×${rxNum(t.l_axis)}` +
              (t.test_for ? '  · ' + t.test_for : ''),
          }),
        ]),
        el('span.p-id', { text: '#' + t.id }),
      ]);
      return row;
    })));
  };

  const drawCust = () => custBox.replaceChildren(customer
    ? el('div.row', {}, [
      el('span.badge.blue', { text: '#' + customer.id }),
      el('b', { text: custName(customer) }),
      el('span.muted', { text: customer.phone || '' }),
      el('a.btn.btn-sm.btn-light', { href: '#/customers/' + customer.id, text: 'ดูข้อมูล' }),
    ])
    : el('span.muted', { text: 'ยังไม่ได้เลือกลูกค้า' }));

  const custPicker = picker({
    placeholder: 'ค้นหาลูกค้า (ชื่อ / เบอร์โทร / รหัส)',
    fetcher: (q) => api.get('/api/customers', { q, limit: 40 }),
    label: custName,
    sub: (r) => r.phone || '',
    onPick: async (r) => {
      customer = await api.get('/api/customers/' + r.id);
      customerId = customer.id;
      rxList = customer.prescriptions;
      rxId = rxList[0]?.id ?? null;
      drawCust(); drawTests();
    },
  });
  drawCust(); drawTests();

  /* money fields with live balance */
  const total = input('total_price', { type: 'number', step: '1', min: '0', value: o.total_price ?? 0 });
  const deposit = input('deposit', { type: 'number', step: '1', min: '0', value: o.deposit ?? 0 });
  const discount = input('discount', { type: 'number', step: '1', min: '0', value: o.discount ?? 0 });
  const balance = el('div.k-value', { text: money(0) });
  const recalc = () => {
    balance.textContent = money(
      (Number(total.value) || 0) - (Number(discount.value) || 0) - (Number(deposit.value) || 0));
  };
  [total, deposit, discount].forEach((i) => i.addEventListener('input', recalc));
  recalc();

  let leftLens = o.left_lens || null, rightLens = o.right_lens || null, frame = o.frame || null;
  const lensName = input('lens_name', { value: o.lens_name || '', placeholder: 'เช่น Hoya Blue1.5-+0.50' });
  const frameName = input('frame_name', { value: o.frame_name || '', placeholder: 'เช่น Coach 5191 / กรอบลูกค้า' });

  const lp = stockPicker('เลนส์ซ้าย', 'Lens', leftLens, (r) => {
    leftLens = r; if (r && !lensName.value) lensName.value = r.product_name;
  });
  const rp = stockPicker('เลนส์ขวา', 'Lens', rightLens, (r) => {
    rightLens = r; if (r && !lensName.value) lensName.value = r.product_name;
  });
  const fp = stockPicker('กรอบแว่น', 'Frame', frame, (r) => {
    frame = r; if (r && !frameName.value) frameName.value = r.product_name;
  });

  const form = el('form');
  form.append(card('รายละเอียดออเดอร์', [
    el('div.form-grid', {}, [
      field('พนักงานผู้ขาย / Employee', employeeSelect('employee_id', o.employee_id)),
      field('วันที่สั่ง / Order date',
        input('order_date', { type: 'datetime-local', value: dtLocal(o.order_date) || nowLocal() })),
      field('วันนัดรับ / Appointment', input('appointment_date', {
        type: 'date', value: dateOnly(o.appointment_date) || todayISO(7),
      })),
      field('ช่องทางที่รู้จัก / Marketing', listSelect('marketing', 'marketing', o.marketing || 'Walk-in')),
      field('ชื่อเลนส์ / LenName', lensName),
      field('ชื่อกรอบ / FrameName', frameName),
    ]),
  ]));

  form.append(card('ราคา & การชำระเงิน', [
    el('div.form-grid', {}, [
      field('ราคารวม / TotalPrice', total),
      field('ส่วนลด / Discount', discount),
      field('มัดจำ / Deposit', deposit,
        editing ? 'แก้ยอดมัดจำที่นี่จะไม่สร้างรายการรับเงิน — ใช้แท็บ "การเงิน" ในเคสแทน' : ''),
      field('ชำระมัดจำด้วย / DepositPayType', listSelect('deposit_pay_type', 'pay_type', o.deposit_pay_type || 'Cash')),
      el('div.kpi.accent', {}, [
        el('div.k-label', { text: 'คงเหลือรับตอนรับของ' }), balance,
        el('div.k-sub', { text: 'ราคารวม − ส่วนลด − มัดจำ' }),
      ]),
    ]),
  ]));

  form.append(card('สินค้าที่ใช้ (ถ้ามีของในคลังแล้ว)', [
    el('p.hint', { text: 'ถ้ายังต้องสั่งเลนส์จากซัพพลายเออร์ ให้ข้ามส่วนนี้ไปก่อน แล้วค่อยใช้เมนู "เติมของเข้าออเดอร์" ตอนของมาถึง' }),
    el('div.split', {}, [
      el('fieldset', {}, [el('legend', { text: 'เลนส์ซ้าย — Left Lens' }), lp.node]),
      el('fieldset', {}, [el('legend', { text: 'เลนส์ขวา — Right Lens' }), rp.node]),
    ]),
    el('fieldset', {}, [el('legend', { text: 'กรอบแว่น — Frame' }), fp.node]),
  ]));

  form.append(card('หมายเหตุ', [
    el('textarea', { name: 'notes', text: o.notes || '', placeholder: 'รายละเอียดเพิ่มเติม เช่น สีเลนส์ ทรงกรอบ การปรับขาแว่น' }),
    el('div.form-actions', { style: 'margin-top:14px' }, [
      el('button.btn.btn-lg', { type: 'submit', text: editing ? '💾 บันทึกการแก้ไข' : '✔ Enter — เปิดออเดอร์' }),
      el('a.btn.btn-light', { href: editing ? '#/orders/' + o.id : '#/orders', text: 'ยกเลิก' }),
    ]),
  ]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!customerId) return err('กรุณาเลือกลูกค้าก่อน');
    try {
      const body = {
        ...formData(form),
        customer_id: customerId,
        case_id: caseId,
        final_prescription_id: rxId,
        lens_product_id: leftLens?.id ?? null,
        right_lens_product_id: rightLens?.id ?? null,
        frame_product_id: frame?.id ?? null,
      };
      body.order_date = (body.order_date || '').replace('T', ' ');
      const saved = editing
        ? await api.put('/api/orders/' + o.id, body)
        : await api.post('/api/orders', body);
      ok(editing ? 'บันทึกออเดอร์แล้ว' : 'เปิดออเดอร์ ' + saved.invoice_code + ' เรียบร้อย');
      navigate(caseId ? '#/cases/' + caseId : '#/orders/' + saved.id);
    } catch (ex) { err(ex); }
  });

  return frag([
    pageHead('👓', 'Custom Order', editing ? 'แก้ไขออเดอร์ตัดแว่น' : 'เปิดออเดอร์ตัดแว่นใหม่'),
    el('div.split', {}, [
      el('div.card', {}, [
        el('div.card-head', {}, [
          el('h2', { text: 'เลือกลูกค้า' }),
          el('div.right', {}, [el('a.btn.btn-sm.btn-light', { href: '#/customers/new?next=order', text: '+ ลูกค้าใหม่' })]),
        ]),
        custBox,
        el('div.card-body', { style: 'padding-top:0' }, [custPicker.node]),
      ]),
      el('div.card', {}, [
        el('div.card-head', {}, [el('h2', { text: 'เลือกผลวัดสายตา' })]),
        testBox,
      ]),
    ]),
    form,
  ]);
}

/* ----------------------------- DETAIL ------------------------------ */
const itemLine = (label, s) => frag([
  el('dt', { text: label }),
  el('dd', {}, [s
    ? frag([s.product_name, ' ', el('span.muted', { text: `#${s.id} · ${money(s.product_price)}` })])
    : el('span.badge.warn', { text: 'ยังไม่ได้เติม' })]),
]);

export async function orderDetail({ params, navigate, refresh }) {
  const o = await api.get('/api/orders/' + params.id);
  const t = o.prescription;
  const wrap = el('div');

  const actions = [
    el('a.btn.btn-ghost', { href: '#/print/order/' + o.id, text: '🖨 ใบสั่งตัดแว่น' }),
    t ? el('a.btn.btn-ghost', { href: '#/print/prescription/' + t.id, text: '🖨 ใบวัดสายตา' }) : null,
  ];
  if (!o.order_closed) {
    actions.unshift(el('a.btn.btn-ghost', { href: '#/orders/' + o.id + '/edit', text: '✎ แก้ไข' }));
    actions.unshift(el('a.btn.btn-ghost', { href: '#/orders/' + o.id + '/close', text: '✅ ปิดการขาย' }));
    actions.unshift(el('a.btn.btn-ghost', { href: '#/orders/' + o.id + '/fill', text: '📦 เติมของ' }));
  }
  if (o.case_id) {
    actions.push(el('a.btn.btn-ghost', { href: '#/cases/' + o.case_id, text: '🗂 ' + (o.case_code || 'เคส') }));
  }
  wrap.append(pageHead('👓', o.invoice_code, custName(o), actions));

  wrap.append(el('div.split', {}, [
    card('ข้อมูลออเดอร์', [
      el('div.row', { style: 'margin-bottom:12px' }, [statusBadge(o)]),
      el('dl.kv', {}, [
        el('dt', { text: 'รหัสออเดอร์' }), el('dd', { text: '#' + o.id }),
        el('dt', { text: 'Invoice' }), el('dd', { text: o.invoice_code }),
        el('dt', { text: 'ลูกค้า' }), el('dd', {}, [
          el('a', { href: '#/customers/' + o.customer_id, text: custName(o) }),
          o.phone ? ` · ${o.phone}` : '',
        ]),
        el('dt', { text: 'พนักงาน' }), el('dd', { text: o.employee_name || '-' }),
        el('dt', { text: 'วันที่สั่ง' }), el('dd', { text: fmtDateTime(o.order_date) }),
        el('dt', { text: 'วันนัดรับ' }), el('dd', { text: fmtDate(o.appointment_date) || '-' }),
        el('dt', { text: 'ช่องทาง' }), el('dd', { text: o.marketing || '-' }),
        el('dt', { text: 'เลนส์' }), el('dd', { text: o.lens_name || '-' }),
        el('dt', { text: 'กรอบ' }), el('dd', { text: o.frame_name || '-' }),
        itemLine('เลนส์ซ้าย (stock)', o.left_lens),
        itemLine('เลนส์ขวา (stock)', o.right_lens),
        itemLine('กรอบ (stock)', o.frame),
        el('dt', { text: 'หมายเหตุ' }), el('dd', { text: o.notes || '-' }),
      ]),
    ]),
    el('div.stack', {}, [
      card('ยอดเงิน', [
        el('dl.kv', {}, [
          el('dt', { text: 'ราคารวม' }), el('dd', { text: money(o.total_price) }),
          el('dt', { text: 'ส่วนลด' }), el('dd', { text: money(o.discount) }),
          el('dt', { text: 'มัดจำ' }), el('dd', { text: `${money(o.deposit)} (${o.deposit_pay_type || '-'})` }),
          el('dt', { text: 'รับเงินแล้วรวม' }), el('dd', { text: money(o.paid) }),
          el('dt', { text: 'คงเหลือ' }),
          el('dd', {}, [el('b', { text: money(o.balance) })]),
        ]),
        o.order_closed ? el('dl.kv', { style: 'margin-top:10px' }, [
          el('dt', { text: 'ปิดเมื่อ' }), el('dd', { text: fmtDateTime(o.order_close_date) }),
          el('dt', { text: 'ผู้ปิด' }), el('dd', { text: o.close_employee_name || '-' }),
          el('dt', { text: 'ชำระด้วย' }), el('dd', { text: o.order_close_pay_type }),
        ]) : null,
      ]),
      t ? card('ผลวัดสายตาที่ใช้', [
        el('table.doc', { style: 'width:100%' }, [
          el('thead', {}, [el('tr', {}, ['', 'SPH', 'CYL', 'AXIS', 'ADD', 'PD', 'VA']
            .map((h) => el('th', { text: h })))]),
          el('tbody', {}, [
            el('tr', {}, [el('td.lbl', { text: 'R' }), power(t.r_sphere), power(t.r_cylinder),
              rxNum(t.r_axis), power(t.r_add), rxNum(t.r_pd), rxNum(t.r_va)].map((v, i) =>
                i === 0 ? v : el('td', { text: String(v) }))),
            el('tr', {}, [el('td.lbl', { text: 'L' }), power(t.l_sphere), power(t.l_cylinder),
              rxNum(t.l_axis), power(t.l_add), rxNum(t.l_pd), rxNum(t.l_va)].map((v, i) =>
                i === 0 ? v : el('td', { text: String(v) }))),
          ]),
        ]),
        el('p.hint', { text: `วัดเมื่อ ${fmtDateTime(t.test_date)}${t.test_for ? ' · ' + t.test_for : ''}` }),
      ]) : null,
      card('การจัดการ', [
        el('div.row', {}, [
          o.order_closed
            ? el('button.btn.btn-light', {
              text: '↩ เปิดออเดอร์อีกครั้ง',
              onclick: async () => {
                if (!await confirmDialog('เปิดออเดอร์อีกครั้ง',
                  'ระบบจะยกเลิกการปิดการขาย และคืนสินค้ากลับเข้าคลัง', { confirmText: 'เปิดใหม่' })) return;
                try { await api.post(`/api/orders/${o.id}/reopen`); ok('เปิดออเดอร์อีกครั้งแล้ว'); refresh(); }
                catch (ex) { err(ex); }
              },
            })
            : el('button.btn.btn-danger', {
              text: '🗑 ลบออเดอร์',
              onclick: async () => {
                if (!await confirmDialog('ลบออเดอร์', `ลบออเดอร์ ${o.invoice_code}?`,
                  { confirmText: 'ลบ', danger: true })) return;
                try { await api.del('/api/orders/' + o.id); ok('ลบแล้ว'); navigate('#/orders'); }
                catch (ex) { err(ex); }
              },
            }),
        ]),
      ]),
    ]),
  ]));
  return wrap;
}

/* ------------------------------ FILL ------------------------------- */
export async function fillOrder({ params, navigate }) {
  const o = await api.get('/api/orders/' + params.id);
  if (o.order_closed) {
    return frag([pageHead('📦', 'Fill Order', 'เติมของเข้าออเดอร์'),
      card(null, [el('p', { text: 'ออเดอร์นี้ปิดการขายแล้ว' }),
        el('a.btn.btn-light', { href: '#/orders/' + o.id, text: '← กลับ' })])]);
  }

  let L = o.left_lens, R = o.right_lens, F = o.frame;
  const lensName = input('lens_name', { value: o.lens_name || '' });
  const frameName = input('frame_name', { value: o.frame_name || '' });

  const lp = stockPicker('เลนส์ซ้าย', 'Lens', L, (r) => { L = r; if (r) lensName.value = r.product_name; });
  const rp = stockPicker('เลนส์ขวา', 'Lens', R, (r) => { R = r; if (r) lensName.value = r.product_name; });
  const fp = stockPicker('กรอบแว่น', 'Frame', F, (r) => { F = r; if (r) frameName.value = r.product_name; });

  const form = el('form');
  form.append(card('ออเดอร์', [
    el('dl.kv', {}, [
      el('dt', { text: 'Invoice' }), el('dd', { text: o.invoice_code }),
      el('dt', { text: 'ลูกค้า' }), el('dd', { text: custName(o) }),
      el('dt', { text: 'วันที่สั่ง' }), el('dd', { text: fmtDateTime(o.order_date) }),
      el('dt', { text: 'ยอดรวม' }), el('dd', { text: money(o.total_price) }),
      el('dt', { text: 'คงเหลือ' }), el('dd', { text: money(o.balance) }),
    ]),
  ]));
  form.append(card('เลือกสินค้าจริงจากคลัง', [
    el('div.split', {}, [
      el('fieldset', {}, [el('legend', { text: 'เลนส์ซ้าย — Left Lens' }), lp.node]),
      el('fieldset', {}, [el('legend', { text: 'เลนส์ขวา — Right Lens' }), rp.node]),
    ]),
    el('fieldset', {}, [el('legend', { text: 'กรอบแว่น — Frame' }), fp.node]),
    el('div.form-grid', {}, [
      field('ชื่อเลนส์ที่แสดงบนใบสั่ง', lensName),
      field('ชื่อกรอบที่แสดงบนใบสั่ง', frameName),
      field('วันนัดรับ', input('appointment_date', { type: 'date', value: dateOnly(o.appointment_date) })),
    ]),
    el('div.field.full', {}, [
      el('label', { text: 'หมายเหตุ' }),
      el('textarea', { name: 'notes', text: o.notes || '' }),
    ]),
    el('div.form-actions', {}, [
      el('button.btn.btn-lg', { type: 'submit', text: '✔ บันทึกการเติมของ' }),
      el('a.btn.btn-light', { href: '#/orders/' + o.id, text: 'ยกเลิก' }),
    ]),
  ]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post(`/api/orders/${o.id}/fill`, {
        ...formData(form),
        lens_product_id: L?.id ?? null,
        right_lens_product_id: R?.id ?? null,
        frame_product_id: F?.id ?? null,
      });
      ok('เติมของเข้าออเดอร์เรียบร้อย');
      navigate('#/orders/' + o.id);
    } catch (ex) { err(ex); }
  });

  return frag([pageHead('📦', 'Fill Order', 'เติมของเข้าออเดอร์'), form]);
}

/* ------------------------------ CLOSE ------------------------------ */
export async function closeOrder({ params, navigate }) {
  const o = await api.get('/api/orders/' + params.id);
  if (o.order_closed) {
    return frag([pageHead('✅', 'Close Order', 'ปิดการขาย'),
      card(null, [el('p', { text: 'ออเดอร์นี้ปิดการขายไปแล้ว' }),
        el('a.btn.btn-light', { href: '#/orders/' + o.id, text: '← กลับ' })])]);
  }
  const unfilled = !o.left_lens || !o.right_lens || !o.frame;

  const form = el('form');
  form.append(card('ปิดการขาย — Close Order', [
    unfilled ? el('p.badge.warn', {
      text: '⚠ ยังเติมสินค้าไม่ครบ — ปิดได้ แต่แนะนำให้เติมของก่อนเพื่อให้ตัดสต็อกถูกต้อง',
      style: 'display:block;padding:10px 14px;margin-bottom:12px',
    }) : null,
    el('dl.kv', { style: 'margin-bottom:16px' }, [
      el('dt', { text: 'Invoice' }), el('dd', { text: o.invoice_code }),
      el('dt', { text: 'ลูกค้า' }), el('dd', { text: custName(o) }),
      el('dt', { text: 'ราคารวม' }), el('dd', { text: money(o.total_price) }),
      el('dt', { text: 'ส่วนลด' }), el('dd', { text: money(o.discount) }),
      el('dt', { text: 'มัดจำที่รับแล้ว' }), el('dd', { text: money(o.deposit) }),
      el('dt', { text: 'คงเหลือ' }), el('dd', {}, [el('b', { text: money(o.balance) })]),
    ]),
    el('div.form-grid', {}, [
      field('รับเงินเพิ่ม / OrderCloseIncome',
        input('order_close_income', { type: 'number', step: '1', value: o.balance })),
      field('ชำระด้วย / PayType', listSelect('order_close_pay_type', 'pay_type', 'Cash')),
      field('พนักงานผู้ปิดการขาย', employeeSelect('order_close_employee_id', o.employee_id)),
      field('วันเวลาที่ปิด', input('order_close_date', { type: 'datetime-local', value: nowLocal() })),
    ]),
    el('div.field.full', {}, [
      el('label', { text: 'หมายเหตุ' }),
      el('textarea', { name: 'notes', text: o.notes || '' }),
    ]),
    el('p.hint', { text: 'เมื่อปิดการขาย ระบบจะตัดสต็อกเลนส์ซ้าย/ขวา และกรอบที่ผูกกับออเดอร์นี้ให้อัตโนมัติ' }),
    el('div.form-actions', {}, [
      el('button.btn.btn-lg.btn-ok', { type: 'submit', text: '✅ ปิดการขาย' }),
      el('a.btn.btn-light', { href: '#/orders/' + o.id, text: 'ยกเลิก' }),
    ]),
  ]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const body = formData(form);
      body.order_close_date = (body.order_close_date || '').replace('T', ' ');
      await api.post(`/api/orders/${o.id}/close`, body);
      ok('ปิดการขายเรียบร้อย');
      navigate('#/orders/' + o.id);
    } catch (ex) { err(ex); }
  });

  return frag([pageHead('✅', 'Close Order', 'ปิดการขาย'), form]);
}
