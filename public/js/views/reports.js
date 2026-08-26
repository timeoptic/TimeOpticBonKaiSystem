/* Reports & printable documents */
import {
  api, meta, el, frag, card, table, pageHead, field, input, select, listSelect,
  money, moneyShort, fmtDate, fmtDateTime, custName, power, rxNum, todayISO, err,
  listLabel,
} from '../core.js';
import { groupedBars, SERIES_COLORS } from '../chart.js';

const SHOP = { name: 'TIME OPTIC', tagline: 'ร้านแว่นตาไทม์ออพติก', line2: 'โทร. ___-___-____' };

/* ============================== INDEX ============================== */
const REPORT_GROUPS = [
  ['การเงิน', [
    ['📅', 'สรุปรายวัน', 'Daily Order Closed', 'ยอดปิดออเดอร์ มัดจำ และขายสินค้า แยกตามวิธีชำระเงิน', '#/reports/daily'],
    ['📈', 'รายรับรายเดือน', 'Sale Income By Month', 'เปรียบเทียบรายรับกับรายจ่ายย้อนหลังเป็นรายเดือน', '#/reports/monthly'],
  ]],
  ['คลังสินค้า', [
    ['📋', 'เช็คลิสต์สต็อก', 'Stock Checklist', 'นับสินค้าคงเหลือตามชื่อ แยก เลนส์ / คอนแทคเลนส์ / กรอบแว่น', '#/reports/checklist'],
    ['🏷', 'พิมพ์ป้ายราคา', 'Stock Label', 'ป้ายติดสินค้าพร้อมรหัสและราคา สั่งพิมพ์ได้ทันที', '#/reports/labels'],
    ['🕰', 'สินค้าค้างสต็อก', 'Unsold Stock', 'สินค้าที่รับเข้ามานานแล้วยังขายไม่ออก พร้อมมูลค่าที่จม', '#/reports/unsold'],
  ]],
];

export async function reportIndex() {
  return frag([
    pageHead('📊', 'Reports', 'รายงาน'),
    ...REPORT_GROUPS.map(([group, items]) => el('section.rep-group', {}, [
      el('h2.rep-group-title', { text: group }),
      el('div.rep-grid', {}, items.map(([ic, th, en, desc, href]) =>
        el('a.rep-card', { href }, [
          el('span.rep-ic', { text: ic }),
          el('span.rep-body', {}, [
            el('b.rep-th', { text: th }),
            el('span.rep-en', { text: en }),
            el('span.rep-desc', { text: desc }),
          ]),
          el('span.rep-go', { text: '→' }),
        ]))),
    ])),
  ]);
}

const printBtn = () => el('button.btn.btn-ghost.no-print', {
  text: '🖨 พิมพ์', onclick: () => window.print(),
});

/* =========================== DAILY CLOSED ========================== */
export async function dailyClosed({ query }) {
  const wrap = el('div');
  const from = el('input', { type: 'date', value: query.from || todayISO() });
  const to = el('input', { type: 'date', value: query.to || query.from || todayISO() });
  const holder = el('div');

  wrap.append(pageHead('📅', 'Daily Closed', 'สรุปยอดรายวัน', [printBtn()]));
  wrap.append(el('div.toolbar.no-print', {}, [
    field('ตั้งแต่วันที่', from),
    field('ถึงวันที่', to),
    el('button.btn.btn-light', {
      text: 'วันนี้', onclick: () => { from.value = todayISO(); to.value = todayISO(); run(); },
    }),
    el('button.btn.btn-light', {
      text: 'เมื่อวาน', onclick: () => { from.value = todayISO(-1); to.value = todayISO(-1); run(); },
    }),
    el('button.btn.btn-light', {
      text: '7 วันล่าสุด', onclick: () => { from.value = todayISO(-6); to.value = todayISO(); run(); },
    }),
  ]));

  const payTable = (title, map, total) => card(title, [
    table([
      { label: 'วิธีชำระ', key: 'k' },
      { label: 'จำนวนเงิน', render: (r) => money(r.v), cls: 'num' },
    ], Object.entries(map).map(([k, v]) => ({ k, v })), {
      empty: 'ไม่มีรายการ',
      footer: el('tr', {}, [el('td', { text: 'รวม' }), el('td.num', { text: money(total) })]),
    }),
  ], { tight: true });

  async function run() {
    holder.replaceChildren(el('div.loading', {}, [el('span.spin'), ' กำลังคำนวณ…']));
    const d = await api.get('/api/reports/daily-closed', { from: from.value, to: to.value });
    const s = d.summary;
    const grand = s.payment_total + s.other_income;

    holder.replaceChildren(frag([
      el('div.kpis', {}, [
        el('div.kpi.ok', {}, [el('div.k-label', { text: 'รับเงินจากลูกค้ารวม' }),
          el('div.k-value', { text: moneyShort(s.payment_total) }),
          el('div.k-sub', { text: `${d.payments.length} รายการ` })]),
        el('div.kpi.accent', {}, [el('div.k-label', { text: 'ในนั้น: ปิดออเดอร์' }),
          el('div.k-value', { text: moneyShort(s.close_income) }),
          el('div.k-sub', { text: `${d.orders.length} ออเดอร์` })]),
        el('div.kpi.accent', {}, [el('div.k-label', { text: 'ในนั้น: มัดจำ' }),
          el('div.k-value', { text: moneyShort(s.deposit_total) }),
          el('div.k-sub', { text: `${d.deposits.length} ออเดอร์` })]),
        el('div.kpi.accent', {}, [el('div.k-label', { text: 'ขายสินค้าทั่วไป' }),
          el('div.k-value', { text: moneyShort(s.sale_total) }),
          el('div.k-sub', { text: `${d.sales.length} รายการ` })]),
        el('div.kpi', {}, [el('div.k-label', { text: 'รายรับอื่น' }),
          el('div.k-value', { text: moneyShort(s.other_income) })]),
        el('div.kpi.danger', {}, [el('div.k-label', { text: 'รายจ่าย' }),
          el('div.k-value', { text: moneyShort(s.expense) })]),
        el('div.kpi.ok', {}, [el('div.k-label', { text: 'รวมรับสุทธิ' }),
          el('div.k-value', { text: moneyShort(grand - s.expense) }),
          el('div.k-sub', { text: `รับ ${moneyShort(grand)} − จ่าย ${moneyShort(s.expense)}` })]),
      ]),
      el('div.split', {}, [
        payTable('เงินที่รับ แยกตามวิธีชำระ', s.payment_by_method, s.payment_total),
        payTable('เงินที่รับ แยกตามประเภท', s.payment_by_kind, s.payment_total),
      ]),
      card('รายการรับเงินทั้งหมด', [table([
        { label: 'เวลา', render: (p) => fmtDateTime(p.paid_at), cls: 'nowrap' },
        { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
        { label: 'ประเภท', key: 'kind' },
        { label: 'วิธี', key: 'method' },
        { label: 'จำนวน', render: (p) => money(p.amount), cls: 'num' },
        { label: 'ผู้รับ', key: 'received_by_name' },
        { label: 'หมายเหตุ', key: 'notes' },
      ], d.payments, {
        empty: 'ไม่มีการรับเงินในช่วงนี้',
        footer: d.payments.length ? el('tr', {}, [
          el('td', { colspan: 4, text: 'รวม' }),
          el('td.num', { text: money(s.payment_total) }),
          el('td', { colspan: 2 }),
        ]) : null,
      })], { tight: true }),
      card('ออเดอร์ที่ปิดการขาย', [table([
        { label: 'เวลา', render: (o) => fmtDateTime(o.order_close_date), cls: 'nowrap' },
        { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
        { label: 'ลูกค้า', render: custName },
        { label: 'เลนส์', key: 'lens_name' },
        { label: 'กรอบ', key: 'frame_name' },
        { label: 'ยอดรวม', render: (o) => money(o.total_price), cls: 'num' },
        { label: 'มัดจำ', render: (o) => money(o.deposit), cls: 'num' },
        { label: 'รับเพิ่ม', render: (o) => money(o.order_close_income), cls: 'num' },
        { label: 'ชำระ', key: 'order_close_pay_type' },
        { label: 'ผู้ปิด', key: 'close_employee_name' },
      ], d.orders, { empty: 'ไม่มีออเดอร์ที่ปิดในช่วงนี้' })], { tight: true }),
      card('การขายสินค้าทั่วไป', [table([
        { label: 'เวลา', render: (r) => fmtDateTime(r.sale_date), cls: 'nowrap' },
        { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
        { label: 'สินค้า', key: 'product_name' },
        { label: 'ราคา', render: (r) => money(r.price), cls: 'num' },
        { label: 'ส่วนลด', render: (r) => money(r.discount), cls: 'num' },
        { label: 'สุทธิ', render: (r) => money(r.price - r.discount), cls: 'num' },
        { label: 'ชำระ', key: 'pay_type' },
        { label: 'พนักงาน', key: 'employee_name' },
      ], d.sales, { empty: 'ไม่มีการขายสินค้าในช่วงนี้' })], { tight: true }),
      card('มัดจำที่รับในช่วงนี้', [table([
        { label: 'เวลา', render: (o) => fmtDateTime(o.order_date), cls: 'nowrap' },
        { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
        { label: 'ลูกค้า', render: custName },
        { label: 'ยอดรวม', render: (o) => money(o.total_price), cls: 'num' },
        { label: 'มัดจำ', render: (o) => money(o.deposit), cls: 'num' },
        { label: 'ชำระ', key: 'deposit_pay_type' },
        { label: 'พนักงาน', key: 'employee_name' },
      ], d.deposits, { empty: 'ไม่มีการรับมัดจำในช่วงนี้' })], { tight: true }),
    ]));
  }
  from.addEventListener('change', run);
  to.addEventListener('change', run);
  wrap.append(holder);
  run();
  return wrap;
}

/* ============================== MONTHLY ============================ */
export async function monthly() {
  const rows = await api.get('/api/reports/income-by-month');
  const sum = rows.reduce((a, r) => ({
    pay: a.pay + r.payment_income, sale: a.sale + r.sale_income,
    other: a.other + r.other_income, exp: a.exp + r.expense, net: a.net + r.net,
  }), { pay: 0, sale: 0, other: 0, exp: 0, net: 0 });

  /* กราฟแท่งคู่ รับ/จ่าย — หน่วยบาททั้งคู่จึงใช้แกนเดียวได้
     ยอดสุทธิไม่เอามาปนในกราฟ เพราะติดลบได้และจะทำให้อ่านสัดส่วนผิด */
  const chartBox = el('div.chart-box');
  const chart = rows.length ? card('รายรับเทียบรายจ่ายรายเดือน', [
    el('div.chart-legend', {}, [
      el('span', {}, [el('i.sw', { style: `background:${SERIES_COLORS[0]}` }), 'รายรับ']),
      el('span', {}, [el('i.sw', { style: `background:${SERIES_COLORS[1]}` }), 'รายจ่าย']),
    ]),
    chartBox,
    el('p.hint', { text: 'ชี้ค้างที่แท่งเพื่อดูตัวเลข · ตัวเลขเต็มอยู่ในตารางด้านล่าง' }),
  ]) : null;

  if (rows.length) {
    // ต้องรอให้ต่อเข้าหน้าเว็บก่อน ไม่งั้นวัดความกว้างได้ 0
    // API คืนเดือนล่าสุดก่อน แต่กราฟเวลาต้องไล่จากเก่าไปใหม่ ไม่งั้นอ่านผิดทาง
    const asc = [...rows].sort((a, b) => String(a.ym).localeCompare(String(b.ym)));
    queueMicrotask(() => groupedBars(chartBox, {
      categories: asc.map((r) => r.ym),
      series: [
        { name: 'รายรับ', values: asc.map((r) => Number(r.total_income) || 0) },
        { name: 'รายจ่าย', values: asc.map((r) => Number(r.expense) || 0) },
      ],
      format: moneyShort,
    }));
  }

  const statTile = (label, value, cls = '') =>
    el('div.kpi', { class: cls }, [
      el('div.k-label', { text: label }),
      el('div.k-value', { text: money(value) }),
    ]);

  return frag([
    pageHead('📈', 'Sale Income By Month', 'สรุปรายรับรายเดือน', [printBtn()]),
    rows.length ? el('div.kpis', {}, [
      statTile('รวมรายรับ', sum.pay + sum.other, 'accent'),
      statTile('รวมรายจ่าย', sum.exp, 'danger'),
      statTile('คงเหลือสุทธิ', sum.net, sum.net < 0 ? 'danger' : 'ok'),
    ]) : null,
    chart,
    card('แยกตามเดือน', [table([
      { label: 'เดือน', key: 'ym', cls: 'nowrap' },
      { label: 'รับเงินจากลูกค้า', render: (r) => money(r.payment_income), cls: 'num' },
      { label: '(ในนั้นเป็นขายสินค้า)', render: (r) => money(r.sale_income), cls: 'num' },
      { label: 'รายรับอื่น', render: (r) => money(r.other_income), cls: 'num' },
      { label: 'รวมรับ', render: (r) => money(r.total_income), cls: 'num' },
      { label: 'รายจ่าย', render: (r) => money(r.expense), cls: 'num' },
      { label: 'สุทธิ', render: (r) => el('b', { text: money(r.net) }), cls: 'num' },
    ], rows, {
      empty: 'ยังไม่มีข้อมูล',
      footer: rows.length ? el('tr', {}, [
        el('td', { text: 'รวมทั้งหมด' }),
        el('td.num', { text: money(sum.pay) }),
        el('td.num', { text: money(sum.sale) }),
        el('td.num', { text: money(sum.other) }),
        el('td.num', { text: money(sum.pay + sum.other) }),
        el('td.num', { text: money(sum.exp) }),
        el('td.num', { text: money(sum.net) }),
      ]) : null,
    })], { tight: true }),
  ]);
}

/* ============================= CHECKLIST =========================== */
export async function checklist({ query }) {
  const wrap = el('div');
  const type = select('type', (meta.lists.product_type || ['Lens']), query.type || 'Lens');
  const holder = el('div');

  wrap.append(pageHead('📋', 'Stock Checklist', 'เช็คลิสต์สินค้าคงเหลือ', [printBtn()]));
  wrap.append(el('div.toolbar.no-print', {}, [field('ประเภทสินค้า', type)]));

  async function run() {
    holder.replaceChildren(el('div.loading', {}, [el('span.spin'), ' กำลังนับ…']));
    const rows = await api.get('/api/reports/checklist', { type: type.value });
    const qty = rows.reduce((a, r) => a + r.qty, 0);
    holder.replaceChildren(card(`${type.value} Checklist — คงเหลือ ${qty} ชิ้น`, [table([
      { label: 'ชื่อสินค้า', key: 'product_name' },
      { label: 'จำนวน', key: 'qty', cls: 'num' },
      { label: 'ราคาขาย', render: (r) => money(r.price), cls: 'num' },
      { label: 'รับเข้าครั้งแรก', render: (r) => fmtDate(r.oldest), cls: 'nowrap' },
      { label: 'นับจริง', render: () => el('span.muted', { text: '__________' }) },
    ], rows, { empty: 'ไม่มีสินค้าคงเหลือในประเภทนี้' })], { tight: true }));
  }
  type.addEventListener('change', run);
  wrap.append(holder);
  run();
  return wrap;
}

/* ============================== LABELS ============================= */
export async function labels() {
  const wrap = el('div');
  const type = select('type', [['', 'ทุกประเภท'], ...(meta.lists.product_type || [])], 'Frame');
  const q = el('input', { type: 'search', placeholder: 'กรองด้วยชื่อสินค้า' });
  const holder = el('div');

  wrap.append(pageHead('🏷', 'Stock Label', 'พิมพ์ป้ายราคาสินค้า', [printBtn()]));
  wrap.append(el('div.toolbar.no-print', {}, [
    field('ประเภทสินค้า', type),
    el('div.field.grow', {}, [el('label', { text: 'ค้นหา' }), q]),
    el('button.btn.btn-light', { text: 'แสดงป้าย', onclick: () => run() }),
  ]));

  async function run() {
    holder.replaceChildren(el('div.loading', {}, [el('span.spin'), ' กำลังโหลด…']));
    const rows = await api.get('/api/reports/stock-labels', { type: type.value, q: q.value.trim() });
    if (!rows.length) return holder.replaceChildren(el('div.empty', { text: 'ไม่มีสินค้าคงเหลือ' }));
    holder.replaceChildren(el('div.paper', {}, [
      el('div.labels', {}, rows.map((r) => el('div.label', {}, [
        el('b', { text: r.product_name }),
        el('div', { text: `#${r.id}${r.location ? ' · ' + r.location : ''}` }),
        el('div.price', { text: money(r.product_price) }),
      ]))),
    ]));
  }
  type.addEventListener('change', run);
  q.addEventListener('change', run);
  wrap.append(holder);
  run();
  return wrap;
}

/* ============================== UNSOLD ============================= */
export async function unsold({ query }) {
  const wrap = el('div');
  const days = select('days', [[30, '30 วัน'], [90, '90 วัน'], [180, '180 วัน'], [365, '1 ปี'], [730, '2 ปี']],
    query.days || 180);
  const holder = el('div');

  wrap.append(pageHead('🕰', 'Unsold Stock', 'สินค้าค้างสต็อก', [printBtn()]));
  wrap.append(el('div.toolbar.no-print', {}, [field('ค้างนานกว่า', days)]));

  async function run() {
    holder.replaceChildren(el('div.loading', {}, [el('span.spin'), ' กำลังโหลด…']));
    const rows = await api.get('/api/reports/unsold-stock', { days: days.value });
    const value = rows.reduce((a, r) => a + r.product_price, 0);
    holder.replaceChildren(card(`ค้างสต็อก ${rows.length} ชิ้น — มูลค่า ${money(value)}`, [table([
      { label: 'ID', key: 'id', cls: 'mono' },
      { label: 'ประเภท', key: 'product_type' },
      { label: 'ชื่อสินค้า', key: 'product_name' },
      { label: 'ตำแหน่ง', render: (r) => r.location || '-' },
      { label: 'ราคาขาย', render: (r) => money(r.product_price), cls: 'num' },
      { label: 'รับเข้าเมื่อ', render: (r) => fmtDate(r.stock_date), cls: 'nowrap' },
      { label: 'ค้าง (วัน)', key: 'age_days', cls: 'num' },
    ], rows, { empty: 'ไม่มีสินค้าค้างสต็อกตามเงื่อนไขนี้' })], { tight: true }));
  }
  days.addEventListener('change', run);
  wrap.append(holder);
  run();
  return wrap;
}

/* ====================== PRINTABLE: ORDER SLIP ====================== */
export async function printOrder({ params }) {
  const o = await api.get('/api/reports/order/' + params.id);
  const t = o.prescription;
  const rx = t ? el('table.doc', {}, [
    el('thead', {}, [el('tr', {}, ['', 'SPH', 'CYL', 'AXIS', 'ADD', 'PD', 'VA']
      .map((h) => el('th', { text: h })))]),
    el('tbody', {}, [
      el('tr', {}, [el('td.lbl', { text: 'R' }),
        ...[power(t.r_sphere), power(t.r_cylinder), rxNum(t.r_axis), power(t.r_add), rxNum(t.r_pd), rxNum(t.r_va)]
          .map((v) => el('td', { text: String(v) }))]),
      el('tr', {}, [el('td.lbl', { text: 'L' }),
        ...[power(t.l_sphere), power(t.l_cylinder), rxNum(t.l_axis), power(t.l_add), rxNum(t.l_pd), rxNum(t.l_va)]
          .map((v) => el('td', { text: String(v) }))]),
    ]),
  ]) : el('p.muted', { text: 'ไม่มีข้อมูลการวัดสายตาผูกกับออเดอร์นี้' });

  const line = (k, v) => frag([el('dt', { text: k }), el('dd', { text: v })]);

  return frag([
    pageHead('🖨', 'ใบสั่งตัดแว่น', o.invoice_code, [
      printBtn(),
      el('a.btn.btn-ghost.no-print', { href: '#/orders/' + o.id, text: '← กลับ' }),
    ]),
    el('div.paper', {}, [
      el('div.doc-head', {}, [
        el('div', {}, [
          el('h1', { text: SHOP.name }),
          el('div.shop', { text: SHOP.tagline }),
          el('div.shop', { text: SHOP.line2 }),
        ]),
        el('div', { style: 'text-align:right' }, [
          el('h1', { style: 'font-size:19px', text: 'ใบสั่งตัดแว่น' }),
          el('div.shop', { text: 'Invoice: ' + o.invoice_code }),
          el('div.shop', { text: 'วันที่: ' + fmtDateTime(o.order_date) }),
          el('div.shop', { text: 'นัดรับ: ' + (fmtDate(o.appointment_date) || '-') }),
        ]),
      ]),
      el('dl.kv', { style: 'margin-bottom:14px' }, [
        line('ลูกค้า', custName(o)),
        line('เบอร์โทร', o.phone || '-'),
        line('พนักงาน', o.employee_name || '-'),
      ]),
      el('h3', { style: 'margin:14px 0 0;font-size:14px', text: 'ค่าสายตา — Prescription' }),
      rx,
      el('h3', { style: 'margin:0 0 0;font-size:14px', text: 'รายการสินค้า' }),
      el('table.doc', {}, [
        el('thead', {}, [el('tr', {}, ['รายการ', 'รายละเอียด', 'รหัสสินค้า']
          .map((h) => el('th', { text: h })))]),
        el('tbody', {}, [
          el('tr', {}, [el('td', { text: 'เลนส์' }), el('td', { text: o.lens_name || '-' }),
            el('td', { text: [o.lens_product_id, o.right_lens_product_id].filter(Boolean).join(' / ') || '-' })]),
          el('tr', {}, [el('td', { text: 'กรอบ' }), el('td', { text: o.frame_name || '-' }),
            el('td', { text: o.frame_product_id || '-' })]),
        ]),
      ]),
      el('table.doc', {}, [
        el('tbody', {}, [
          el('tr', {}, [el('td.lbl', { style: 'width:auto', text: 'ราคารวม' }), el('td', { text: money(o.total_price) })]),
          el('tr', {}, [el('td.lbl', { style: 'width:auto', text: 'ส่วนลด' }), el('td', { text: money(o.discount) })]),
          el('tr', {}, [el('td.lbl', { style: 'width:auto', text: `มัดจำ (${o.deposit_pay_type})` }), el('td', { text: money(o.deposit) })]),
          el('tr', {}, [el('td.lbl', { style: 'width:auto', text: o.order_closed ? 'รับเมื่อปิดการขาย' : 'คงเหลือชำระ' }),
            el('td', {}, [el('b', { text: money(o.order_closed ? o.order_close_income : o.balance) })])]),
        ]),
      ]),
      o.notes ? el('p', {}, [el('b', { text: 'หมายเหตุ: ' }), o.notes]) : null,
      el('div.sign', {}, [
        el('div', {}, [el('div.line'), 'ลายเซ็นลูกค้า']),
        el('div', {}, [el('div.line'), 'ผู้รับออเดอร์']),
      ]),
    ]),
  ]);
}

/* ===================== PRINTABLE: PRESCRIPTION ===================== */
export async function printPrescription({ params }) {
  const t = await api.get('/api/reports/prescription/' + params.id);
  const row = (side, k) => el('tr', {}, [
    el('td.lbl', { text: side }),
    ...[power(t[`${k}_sphere`]), power(t[`${k}_cylinder`]), rxNum(t[`${k}_axis`]),
      power(t[`${k}_add`]), rxNum(t[`${k}_pd`]), rxNum(t[`${k}_va`])]
      .map((v) => el('td', { text: String(v) })),
  ]);

  const shortRow = (side, prefix, k) => el('tr', {}, [
    el('td.lbl', { text: side }),
    ...[power(t[`${prefix}${k}_sphere`]), power(t[`${prefix}${k}_add`]),
      rxNum(t[`${prefix}${k}_va`]), rxNum(t[`${prefix}${k}_pd`])]
      .map((v) => el('td', { text: String(v) })),
  ]);
  const shortTable = (prefix) => el('table.doc', {}, [
    el('thead', {}, [el('tr', {}, ['', 'SPH', 'ADD', 'VA', 'PD']
      .map((h) => el('th', { text: h })))]),
    el('tbody', {}, [shortRow('R (ขวา)', prefix, 'r'), shortRow('L (ซ้าย)', prefix, 'l')]),
  ]);
  const filled = (prefix) => ['r', 'l'].some((k) => ['sphere', 'add', 'va', 'pd']
    .some((fld) => ![null, undefined, ''].includes(t[`${prefix}${k}_${fld}`])));
  const hasBin = filled('bin_');
  const hasOld = filled('old_');
  const health = [t.health_cataract && 'ต้อกระจก', t.health_eye_surgery && 'เคยผ่าตัดตา',
    t.health_diabetes && 'เบาหวาน', t.health_bp && 'ความดัน', t.health_heart && 'โรคหัวใจ']
    .filter(Boolean);

  return frag([
    pageHead('🖨', 'ใบวัดสายตา', `#${t.id}`, [
      printBtn(),
      el('a.btn.btn-ghost.no-print', { href: '#/customers/' + t.customer_id, text: '← กลับ' }),
    ]),
    el('div.paper', {}, [
      el('div.doc-head', {}, [
        el('div', {}, [
          el('h1', { text: 'EYE EXAMINATION' }),
          el('div.shop', { text: SHOP.name + ' — ' + SHOP.tagline }),
        ]),
        el('div', { style: 'text-align:right' }, [
          el('div.shop', { text: 'เลขที่: ' + t.id }),
          el('div.shop', { text: 'วันที่: ' + fmtDateTime(t.test_date) }),
        ]),
      ]),
      el('dl.kv', { style: 'margin-bottom:12px' }, [
        el('dt', { text: 'ลูกค้า' }), el('dd', { text: custName(t) }),
        el('dt', { text: 'เบอร์โทร' }), el('dd', { text: t.phone || '-' }),
        el('dt', { text: 'ใช้สำหรับ' }), el('dd', { text: t.test_for || '-' }),
        el('dt', { text: 'ที่มาของค่า' }),
        el('dd', { text: listLabel('rx_source', t.source) || '-' }),
        el('dt', { text: 'ตาเปล่า' }),
        el('dd', { text: `R ${t.va_naked_r || '-'}  /  L ${t.va_naked_l || '-'}` }),
        el('dt', { text: 'ระยะอ่านหนังสือ' }),
        el('dd', { text: `R ${t.dist_vertical_r || '-'}  /  L ${t.dist_vertical_l || '-'} ซม.` }),
        el('dt', { text: 'ระยะคอมพิวเตอร์' }),
        el('dd', { text: `R ${t.dist_monitor_r || '-'}  /  L ${t.dist_monitor_l || '-'} ซม.` }),
        el('dt', { text: 'Old Glasses' }),
        el('dd', { text: listLabel('old_glasses_type', t.old_glasses_type) || '-' }),
      ]),
      el('h3', { style: 'margin:14px 0 6px', text: 'RX Monocular' }),
      el('table.doc', {}, [
        el('thead', {}, [el('tr', {}, ['', 'SPH', 'CYL', 'AXIS', 'ADD', 'PD', 'VA']
          .map((h) => el('th', { text: h })))]),
        el('tbody', {}, [row('R (ขวา)', 'r'), row('L (ซ้าย)', 'l')]),
      ]),
      /* ใบกระดาษมีบล็อก Binocular แยกอยู่ใต้ Monocular พิมพ์เมื่อกรอกไว้จริงเท่านั้น */
      hasBin ? el('h3', { style: 'margin:14px 0 6px', text: 'RX Binocular' }) : null,
      hasBin ? shortTable('bin_') : null,
      /* ค่าจากแว่นเดิม พิมพ์ต่อท้ายเมื่อกรอกไว้ ช่างจะได้เทียบก่อน/หลังในใบเดียว */
      hasOld ? el('h3', { style: 'margin:14px 0 6px', text: 'Old Glasses — แว่นเดิม' }) : null,
      hasOld ? shortTable('old_') : null,
      health.length
        ? el('p', {}, [el('b', { text: 'ประวัติสุขภาพ: ' }),
          health.join(', ') + (t.health_note ? ' — ' + t.health_note : '')])
        : null,
      t.notes ? el('p', {}, [el('b', { text: 'หมายเหตุ: ' }), t.notes]) : null,
      el('div.sign', {}, [
        el('div', {}, [el('div.line'), 'ผู้วัดสายตา: ' + (t.employee_name || '')]),
        el('div', {}, [el('div.line'), 'วันที่']),
      ]),
    ]),
  ]);
}
