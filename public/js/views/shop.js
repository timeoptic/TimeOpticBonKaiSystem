/* Stock, product locations, product sales */
import {
  api, meta, el, frag, card, table, pageHead, field, input, select, listSelect,
  employeeSelect, formData, money, fmtDate, fmtDateTime, dtLocal, ok, err,
  confirmDialog, picker, todayISO, nowLocal,
} from '../core.js';

/* ============================== STOCK ============================== */
export async function stockList({ navigate, query }) {
  const wrap = el('div');
  wrap.append(pageHead('📦', 'Menu Stock', 'รายการสินค้าในคลัง', [
    el('a.btn.btn-ghost', { href: '#/stock/new', text: '+ เพิ่มสินค้าเข้าคลัง' }),
    el('a.btn.btn-ghost', { href: '#/reports/labels', text: '🏷 พิมพ์ป้ายราคา' }),
  ]));

  const search = el('input', { type: 'search', placeholder: 'ชื่อสินค้า / ผู้ขาย / รหัส', value: query.q || '' });
  const type = select('type', [['', 'ทุกประเภท'], ...(meta.lists.product_type || [])], query.type || '');
  const sold = select('sold', [['0', 'คงเหลือในคลัง'], ['1', 'ขายแล้ว'], ['', 'ทั้งหมด']], query.sold ?? '0');
  const holder = el('div');
  let timer = null;

  async function run() {
    holder.replaceChildren(el('div.loading', {}, [el('span.spin'), ' กำลังโหลด…']));
    const rows = await api.get('/api/stock', {
      q: search.value.trim(), type: type.value, sold: sold.value, limit: 500,
    });
    const value = rows.filter((r) => !r.sold).reduce((a, r) => a + r.product_price, 0);
    holder.replaceChildren(card(null, [table([
      { label: 'ID', key: 'id', cls: 'mono' },
      { label: 'ประเภท', key: 'product_type' },
      { label: 'ชื่อสินค้า', key: 'product_name' },
      { label: 'ตำแหน่ง', render: (r) => r.location || '-' },
      { label: 'ราคาขาย', render: (r) => money(r.product_price), cls: 'num' },
      { label: 'ต้นทุน', render: (r) => money(r.product_expense), cls: 'num' },
      { label: 'ผู้ขาย/แบรนด์', render: (r) => r.vendor_name || r.brand || '-' },
      { label: 'รับเข้าเมื่อ', render: (r) => fmtDateTime(r.stock_date), cls: 'nowrap' },
      {
        label: 'สถานะ', render: (r) => r.sold
          ? el('span.badge.gray', { text: 'ขายแล้ว ' + fmtDate(r.clear_date) })
          : el('span.badge.ok', { text: 'ในคลัง' }),
      },
      { label: 'หมายเหตุ', key: 'notes' },
    ], rows, {
      onRowClick: (r) => navigate('#/stock/' + r.id),
      empty: 'ไม่พบสินค้า',
      footer: rows.length ? el('tr', {}, [
        el('td', { colspan: 4, text: `${rows.length} รายการ (มูลค่าคงคลัง)` }),
        el('td.num', { text: money(value) }),
        el('td', { colspan: 5 }),
      ]) : null,
    })], { tight: true }));
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 240); });
  type.addEventListener('change', run);
  sold.addEventListener('change', run);

  wrap.append(el('div.toolbar', {}, [
    el('div.field.grow', {}, [el('label', { text: 'ค้นหา' }), search]),
    field('ประเภทสินค้า', type),
    field('สถานะ', sold),
  ]));
  wrap.append(holder);
  run();
  return wrap;
}

export async function stockForm({ params, navigate, refresh }) {
  const editing = !!params.id;
  const s = editing ? await api.get('/api/stock/' + params.id) : null;

  const names = await api.get('/api/stock/names');
  const form = el('form.card-body');
  form.append(el('div.form-grid', {}, [
    field('ประเภทสินค้า / ProductType', listSelect('product_type', 'product_type', s?.product_type || 'Frame')),
    field('แบรนด์ / Brand', input('brand', { value: s?.brand || '', list: 'brand-list' })),
    field('รุ่น / Model', input('model', { value: s?.model || '' })),
    field('สี / Color', input('color', { value: s?.color || '' })),
    field('ขนาด / Size', input('size', { value: s?.size || '' })),
    field('SKU', input('sku', { value: s?.sku || '' })),
    field('Lens index', input('lens_index', { value: s?.lens_index || '' })),
    field('Coating', input('coating', { value: s?.coating || '' })),
    field('ซัพพลายเออร์', select('supplier_id',
      [['', '— ไม่ระบุ —'], ...(meta.suppliers || []).map((v) => [v.id, v.name])],
      s?.supplier_id || '')),
    el('div.field.full', {}, [
      el('label', { text: 'ชื่อสินค้า / ProductName *' }),
      input('product_name', { value: s?.product_name || '', required: true, list: 'name-list' }),
    ]),
    field('ราคาขาย / ProductPrice', input('product_price', { type: 'number', step: '1', min: '0', value: s?.product_price ?? 0 })),
    field('ต้นทุน / ProductExpense', input('product_expense', { type: 'number', step: '1', min: '0', value: s?.product_expense ?? 0 })),
    field('ผู้ขาย / VendorName', input('vendor_name', { value: s?.vendor_name || '' })),
    editing ? null : field('จำนวน / Amount',
      input('amount', { type: 'number', min: '1', max: '500', value: 1 }), 'สร้างเป็นสินค้ารายชิ้น ชิ้นละ 1 รหัส'),
    el('div.field.full', {}, [
      el('label', { text: 'หมายเหตุ / Notes' }),
      el('textarea', { name: 'notes', text: s?.notes || '' }),
    ]),
  ]));
  form.append(el('datalist#name-list', {}, [...new Set(names.map((n) => n.product_name))]
    .map((n) => el('option', { value: n }))));
  form.append(el('datalist#brand-list', {}, ['Hoya', 'Hitop', 'Tantawan', 'Coach', 'SP Optic', 'RayBan', 'Maxim', 'Acuvue', 'B&L']
    .map((n) => el('option', { value: n }))));
  form.append(el('div.form-actions', {}, [
    el('button.btn.btn-lg', { type: 'submit', text: editing ? '💾 บันทึก' : '✔ Enter — รับเข้าคลัง' }),
    editing && !s.sold ? el('button.btn.btn-danger', {
      type: 'button', text: '🗑 ลบ',
      onclick: async () => {
        if (!await confirmDialog('ลบสินค้า', `ลบ "${s.product_name}" (#${s.id})?`,
          { confirmText: 'ลบ', danger: true })) return;
        try { await api.del('/api/stock/' + s.id); ok('ลบแล้ว'); navigate('#/stock'); }
        catch (ex) { err(ex); }
      },
    }) : null,
    el('a.btn.btn-light', { href: '#/stock', text: 'ยกเลิก' }),
  ]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await api.put('/api/stock/' + s.id, formData(form));
        ok('บันทึกแล้ว');
        navigate('#/stock');
      } else {
        const r = await api.post('/api/stock', formData(form));
        ok(`รับสินค้าเข้าคลัง ${r.count} ชิ้น (รหัส ${r.ids[0]}${r.count > 1 ? '–' + r.ids.at(-1) : ''})`);
        refresh();
      }
    } catch (ex) { err(ex); }
  });

  return frag([
    pageHead('📦', editing ? 'Edit Stock Item' : 'Add to Stock',
      editing ? `แก้ไขสินค้า #${s.id}` : 'เพิ่มสินค้าเข้าคลัง',
      editing && s.sold ? [el('span.badge.gray', { text: 'ขายแล้ว ' + fmtDate(s.clear_date) })] : []),
    el('div.card', {}, [form]),
  ]);
}

/* ========================= PRODUCT LOCATION ======================== */
export async function locationList({ refresh }) {
  const wrap = el('div');
  wrap.append(pageHead('📍', 'Product Location', 'ตำแหน่งจัดเก็บสินค้า'));

  const form = el('form.card-body');
  form.append(el('div.form-grid', {}, [
    field('ชื่อสินค้า / ProductName *', input('product_name', { required: true })),
    field('ตำแหน่ง / Location *', input('location', { required: true, placeholder: 'เช่น ตู้PRO1, Display, ข้างหลัง' })),
    el('div.field', {}, [el('label', { text: ' ' }),
      el('button.btn', { type: 'submit', text: '+ เพิ่มตำแหน่ง' })]),
  ]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api.post('/api/locations', formData(form)); ok('เพิ่มแล้ว'); refresh(); }
    catch (ex) { err(ex); }
  });
  wrap.append(el('div.card', {}, [
    el('div.card-head', {}, [el('h2', { text: 'เพิ่มตำแหน่งสินค้า' })]), form,
  ]));

  const search = el('input', { type: 'search', placeholder: 'ค้นหาชื่อสินค้า / ตำแหน่ง' });
  const holder = el('div');
  let timer = null;
  async function run() {
    const rows = await api.get('/api/locations', { q: search.value.trim() });
    holder.replaceChildren(card(null, [table([
      { label: 'ID', key: 'id', cls: 'mono' },
      { label: 'ชื่อสินค้า', key: 'product_name' },
      { label: 'ตำแหน่ง', key: 'location' },
      {
        label: '', cls: 'nowrap', render: (r) => el('button.btn.btn-sm.btn-light', {
          text: '🗑', onclick: async () => {
            try { await api.del('/api/locations/' + r.id); ok('ลบแล้ว'); run(); }
            catch (ex) { err(ex); }
          },
        }),
      },
    ], rows, { empty: 'ยังไม่มีข้อมูลตำแหน่งสินค้า' })], { tight: true }));
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 240); });
  wrap.append(el('div.toolbar', {}, [el('div.field.grow', {}, [el('label', { text: 'ค้นหา' }), search])]));
  wrap.append(holder);
  run();
  return wrap;
}

/* ============================== SALES ============================== */
export async function saleList({ query }) {
  const wrap = el('div');
  wrap.append(pageHead('🧾', 'Sales History', 'ประวัติการขายสินค้า', [
    el('a.btn.btn-ghost', { href: '#/sales/new', text: '+ ขายสินค้า' }),
  ]));

  const search = el('input', { type: 'search', placeholder: 'Invoice / ชื่อสินค้า / หมายเหตุ', value: query.q || '' });
  const from = el('input', { type: 'date', value: query.from || '' });
  const to = el('input', { type: 'date', value: query.to || '' });
  const holder = el('div');
  let timer = null;

  async function run() {
    holder.replaceChildren(el('div.loading', {}, [el('span.spin'), ' กำลังโหลด…']));
    const rows = await api.get('/api/sales', {
      q: search.value.trim(), from: from.value, to: to.value, limit: 500,
    });
    const total = rows.reduce((a, r) => a + r.price - r.discount, 0);
    holder.replaceChildren(card(null, [table([
      { label: 'ID', key: 'id', cls: 'mono' },
      { label: 'วันที่ขาย', render: (r) => fmtDateTime(r.sale_date), cls: 'nowrap' },
      { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
      { label: 'สินค้า', render: (r) => r.product_name || `#${r.product_stock_id}` },
      { label: 'ประเภท', key: 'product_type' },
      { label: 'ราคา', render: (r) => money(r.price), cls: 'num' },
      { label: 'ส่วนลด', render: (r) => money(r.discount), cls: 'num' },
      { label: 'สุทธิ', render: (r) => money(r.price - r.discount), cls: 'num' },
      { label: 'ชำระ', key: 'pay_type' },
      { label: 'ช่องทาง', key: 'marketing' },
      { label: 'พนักงาน', key: 'employee_name' },
      { label: 'หมายเหตุ', key: 'notes' },
      {
        label: '', cls: 'nowrap', render: (r) => el('button.btn.btn-sm.btn-light', {
          text: '🗑', title: 'ยกเลิกการขาย (คืนสินค้าเข้าคลัง)',
          onclick: async () => {
            if (!await confirmDialog('ยกเลิกการขาย',
              `ยกเลิกรายการขาย #${r.id} และคืนสินค้ากลับเข้าคลัง?`,
              { confirmText: 'ยกเลิกการขาย', danger: true })) return;
            try { await api.del('/api/sales/' + r.id); ok('ยกเลิกแล้ว'); run(); }
            catch (ex) { err(ex); }
          },
        }),
      },
    ], rows, {
      empty: 'ไม่พบรายการขาย',
      footer: rows.length ? el('tr', {}, [
        el('td', { colspan: 7, text: `รวม ${rows.length} รายการ` }),
        el('td.num', { text: money(total) }),
        el('td', { colspan: 5 }),
      ]) : null,
    })], { tight: true }));
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 240); });
  from.addEventListener('change', run);
  to.addEventListener('change', run);

  wrap.append(el('div.toolbar', {}, [
    el('div.field.grow', {}, [el('label', { text: 'ค้นหา' }), search]),
    field('ตั้งแต่วันที่', from),
    field('ถึงวันที่', to),
  ]));
  wrap.append(holder);
  run();
  return wrap;
}

export async function saleForm({ navigate }) {
  let item = null;
  const price = input('price', { type: 'number', step: '1', min: '0', value: 0 });
  const discount = input('discount', { type: 'number', step: '1', min: '0', value: 0 });
  const net = el('div.k-value', { text: money(0) });
  const recalc = () => {
    net.textContent = money((Number(price.value) || 0) - (Number(discount.value) || 0));
  };
  [price, discount].forEach((i) => i.addEventListener('input', recalc));

  const chosen = el('div.card-body');
  const draw = () => {
    chosen.replaceChildren(item
      ? el('dl.kv', {}, [
        el('dt', { text: 'รหัสสินค้า' }), el('dd', { text: '#' + item.id }),
        el('dt', { text: 'ชื่อสินค้า' }), el('dd', { text: item.product_name }),
        el('dt', { text: 'ประเภท' }), el('dd', { text: item.product_type }),
        el('dt', { text: 'ราคาตั้ง' }), el('dd', { text: money(item.product_price) }),
        el('dt', { text: 'ตำแหน่ง' }), el('dd', { text: item.location || '-' }),
      ])
      : el('span.muted', { text: 'เลือกสินค้าจากคลังทางซ้าย' }));
    recalc();
  };
  draw();

  const p = picker({
    placeholder: 'ค้นหาสินค้าในคลัง (ชื่อ / รหัส)',
    fetcher: (q) => api.get('/api/stock', { q, sold: 0, limit: 40 }),
    label: (r) => r.product_name,
    sub: (r) => `${r.product_type} · ${money(r.product_price)}${r.location ? ' · ' + r.location : ''}`,
    onPick: (r) => { item = r; price.value = r.product_price; draw(); },
  });

  const form = el('form');
  form.append(card('รายละเอียดการขาย', [
    el('div.form-grid', {}, [
      field('พนักงาน / Employee', employeeSelect('employee_id', '')),
      field('วันที่ขาย / SaleDate', input('sale_date', { type: 'datetime-local', value: nowLocal() })),
      field('ราคา / Price', price),
      field('ส่วนลด / Discount', discount),
      field('ชำระด้วย / PayType', listSelect('pay_type', 'pay_type', 'Cash')),
      field('ช่องทาง / Marketing', listSelect('marketing', 'marketing', 'Walk-in')),
      el('div.kpi.accent', {}, [el('div.k-label', { text: 'ยอดสุทธิ' }), net]),
    ]),
    el('div.field.full', {}, [
      el('label', { text: 'หมายเหตุ / Notes' }),
      el('textarea', { name: 'notes' }),
    ]),
    el('div.form-actions', {}, [
      el('button.btn.btn-lg', { type: 'submit', text: '✔ Enter — บันทึกการขาย' }),
      el('a.btn.btn-light', { href: '#/sales', text: 'ยกเลิก' }),
    ]),
  ]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!item) return err('กรุณาเลือกสินค้าจากคลังก่อน');
    try {
      const body = { ...formData(form), product_stock_id: item.id };
      body.sale_date = (body.sale_date || '').replace('T', ' ');
      const saved = await api.post('/api/sales', body);
      ok('บันทึกการขาย ' + saved.invoice_code + ' เรียบร้อย');
      navigate('#/sales');
    } catch (ex) { err(ex); }
  });

  return frag([
    pageHead('🛍', 'Product Sale', 'ขายสินค้าทั่วไป'),
    el('div.split', {}, [
      el('div.card', {}, [
        el('div.card-head', {}, [el('h2', { text: 'เลือกสินค้าจากคลัง' })]),
        el('div.card-body', {}, [p.node]),
      ]),
      el('div.card', {}, [
        el('div.card-head', {}, [el('h2', { text: 'สินค้าที่เลือก' })]),
        chosen,
      ]),
    ]),
    form,
  ]);
}


/* ============================= SUPPLIERS =========================== */
export async function supplierList({ refresh }) {
  const rows = await api.get('/api/suppliers');
  const form = el('form.card-body');
  form.append(el('div.form-grid', {}, [
    field('ชื่อซัพพลายเออร์ *', input('name', { required: true })),
    field('ผู้ติดต่อ', input('contact_person')),
    field('เบอร์โทร', input('phone')),
    field('อีเมล', input('email', { type: 'email' })),
    field('Lead time ปกติ (วัน)', input('default_lead_days', { type: 'number', min: '0', value: 7 })),
  ]));
  form.append(el('div.form-actions', {}, [
    el('button.btn', { type: 'submit', text: '+ เพิ่มซัพพลายเออร์' })]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api.post('/api/suppliers', formData(form)); ok('เพิ่มแล้ว'); refresh(); }
    catch (ex) { err(ex); }
  });

  const toggle = async (r) => {
    try { await api.put('/api/suppliers/' + r.id, { ...r, active: r.active ? 0 : 1 }); refresh(); }
    catch (ex) { err(ex); }
  };

  return frag([
    pageHead('🏭', 'Suppliers', 'ซัพพลายเออร์เลนส์/สินค้า'),
    el('div.card', {}, [
      el('div.card-head', {}, [el('h2', { text: 'เพิ่มซัพพลายเออร์' })]), form,
    ]),
    card('รายชื่อซัพพลายเออร์', [table([
      { label: 'ID', key: 'id', cls: 'mono' },
      { label: 'ชื่อ', key: 'name' },
      { label: 'ผู้ติดต่อ', key: 'contact_person' },
      { label: 'เบอร์โทร', key: 'phone', cls: 'nowrap' },
      { label: 'อีเมล', key: 'email' },
      { label: 'Lead time', render: (r) => r.default_lead_days + ' วัน', cls: 'num' },
      {
        label: 'สถานะ', render: (r) => (r.active
          ? el('span.badge.ok', { text: 'ใช้งาน' })
          : el('span.badge.gray', { text: 'ปิด' })),
      },
      {
        label: '', cls: 'nowrap', render: (r) => el('button.btn.btn-sm.btn-light', {
          text: r.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน', onclick: () => toggle(r),
        }),
      },
    ], rows, { empty: 'ยังไม่มีซัพพลายเออร์' })], { tight: true }),
  ]);
}
