/* TimeOptic Web — shell + hash router */
import { el, $, loadMeta, err, loading } from './core.js';
import * as core from './views/core-views.js';
import * as orders from './views/orders.js';
import * as shop from './views/shop.js';
import * as finance from './views/finance.js';
import * as reports from './views/reports.js';
import * as cases from './views/cases.js';
import * as bookings from './views/bookings.js';

/* ------------------------------- nav ------------------------------ */
const NAV = [
  ['หน้าหลัก', [
    ['🏠', 'เมนูหลัก', '#/'],
  ]],
  ['งานในร้าน', [
    ['📅', 'ปฏิทินจองคิว', '#/bookings'],
    ['🗂', 'กระดานงาน', '#/cases'],
    ['🔎', 'ติดตามเลนส์', '#/lens-tracker'],
  ]],
  ['งานหน้าร้าน', [
    ['👥', 'ลูกค้า', '#/customers'],
    ['👁', 'วัดสายตา', '#/prescriptions'],
    ['👓', 'ออเดอร์ตัดแว่น', '#/orders'],
    ['🛍', 'ขายสินค้า', '#/sales'],
  ]],
  ['คลังสินค้า', [
    ['📦', 'สต็อกสินค้า', '#/stock'],
    ['📍', 'ตำแหน่งสินค้า', '#/locations'],
  ]],
  ['การเงิน', [
    ['💰', 'รายรับ', '#/income'],
    ['💸', 'รายจ่าย', '#/expense'],
  ]],
  ['ข้อมูลระบบ', [
    ['🧑‍💼', 'พนักงาน', '#/employees'],
    ['🏭', 'ซัพพลายเออร์', '#/suppliers'],
    ['📊', 'รายงาน', '#/reports'],
    ['⚙️', 'ตั้งค่า/แจ้งเตือน', '#/settings'],
  ]],
];

function buildNav() {
  const nav = $('#nav');
  nav.replaceChildren();
  for (const [group, items] of NAV) {
    nav.append(el('div.nav-group', { text: group }));
    for (const [ic, label, href] of items) {
      // title ทำให้ยังรู้ว่าเมนูไหนตอน sidebar ยุบเหลือแต่ไอคอน
      nav.append(el('a', { href, title: label, dataset: { href } }, [
        el('span.ic', { text: ic }), el('span.lbl', { text: label }),
      ]));
    }
  }
}

/* --------------------------- sidebar ------------------------------ */
const SIDEBAR_KEY = 'timeoptic:sidebar-collapsed';
/* จอเล็ก sidebar เป็นแผงเลื่อนทับเนื้อหา (คลาส .open)
   จอใหญ่ sidebar ยุบเหลือแถบไอคอนแทน (คลาส .collapsed บน #app) */
const isNarrow = () => window.matchMedia('(max-width:820px)').matches;

/* บนจอเล็กแผงเมนูทับปุ่ม ☰ จนกดไม่โดน ต้องมีทางปิดของตัวเอง:
   ปุ่มกากบาทในแผง แตะฉากมืดด้านหลัง หรือกด Esc */
function closeNav() {
  $('#sidebar').classList.remove('open');
  document.body.classList.remove('nav-open');
}

function toggleSidebar() {
  if (isNarrow()) {
    const open = $('#sidebar').classList.toggle('open');
    document.body.classList.toggle('nav-open', open);
    return;
  }
  const collapsed = $('#app').classList.toggle('collapsed');
  markNavScrollable();
  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  } catch { /* โหมดส่วนตัวเขียนไม่ได้ ไม่ใช่เรื่องคอขาดบาดตาย */ }
}

/* แถบเลื่อนของเมนูถูกซ่อนไว้ ถ้าเมนูยาวเกินจอจึงต้องมีอย่างอื่นบอก
   ไม่งั้นบนจอเตี้ยจะไม่มีใครรู้ว่ายังมีเมนูอยู่ข้างล่าง */
function markNavScrollable() {
  const nav = $('#nav');
  if (nav) nav.classList.toggle('scrollable', nav.scrollHeight > nav.clientHeight + 1);
}

function restoreSidebar() {
  let saved = null;
  try { saved = localStorage.getItem(SIDEBAR_KEY); } catch { /* อ่านไม่ได้ก็ใช้ค่าเริ่มต้น */ }
  if (saved === '1') $('#app').classList.add('collapsed');
}

function markActive(hash) {
  const base = '#/' + (hash.replace(/^#\/?/, '').split('/')[0] || '');
  for (const a of $('#nav').querySelectorAll('a')) {
    const target = a.dataset.href;
    a.classList.toggle('active', target === base || (base === '#/' && target === '#/'));
  }
}

/* ----------------------------- routes ----------------------------- */
const ROUTES = [
  ['', core.dashboard, 'เมนูหลัก'],

  ['customers', core.customerList, 'ลูกค้า'],
  ['customers/new', core.customerForm, 'ลูกค้าใหม่'],
  ['customers/:id', core.customerDetail, 'ข้อมูลลูกค้า'],
  ['customers/:id/edit', core.customerForm, 'แก้ไขลูกค้า'],

  ['prescriptions', core.prescriptionList, 'วัดสายตา'],
  ['prescriptions/new', core.prescriptionForm, 'บันทึกการวัดสายตา'],
  ['prescriptions/:id', core.prescriptionForm, 'แก้ไขผลวัดสายตา'],

  ['bookings', bookings.bookingCalendar, 'ปฏิทินจองคิว'],
  ['bookings/new', bookings.bookingForm, 'จองคิวใหม่'],
  ['bookings/:id', bookings.bookingDetail, 'รายละเอียดการจอง'],
  ['bookings/:id/edit', bookings.bookingForm, 'แก้ไขการจอง'],
  ['settings', bookings.settingsView, 'ตั้งค่า/แจ้งเตือน'],

  ['cases', cases.caseBoard, 'กระดานงาน'],
  ['cases/new', cases.caseForm, 'เปิดเคสใหม่'],
  ['cases/:id', cases.caseDetail, 'รายละเอียดเคส'],
  ['lens-tracker', cases.lensTracker, 'ติดตามเลนส์'],

  ['employees', core.employeeList, 'พนักงาน'],

  ['orders', orders.orderList, 'ออเดอร์ตัดแว่น'],
  ['orders/new', orders.orderForm, 'เปิดออเดอร์ใหม่'],
  ['orders/:id', orders.orderDetail, 'รายละเอียดออเดอร์'],
  ['orders/:id/edit', orders.orderForm, 'แก้ไขออเดอร์'],
  ['orders/:id/fill', orders.fillOrder, 'เติมของเข้าออเดอร์'],
  ['orders/:id/close', orders.closeOrder, 'ปิดการขาย'],

  ['sales', shop.saleList, 'ขายสินค้า'],
  ['sales/new', shop.saleForm, 'ขายสินค้าทั่วไป'],
  ['stock', shop.stockList, 'สต็อกสินค้า'],
  ['stock/new', shop.stockForm, 'เพิ่มสินค้าเข้าคลัง'],
  ['stock/:id', shop.stockForm, 'แก้ไขสินค้า'],
  ['locations', shop.locationList, 'ตำแหน่งสินค้า'],
  ['suppliers', shop.supplierList, 'ซัพพลายเออร์'],

  ['income', finance.incomeView, 'รายรับ'],
  ['expense', finance.expenseView, 'รายจ่าย'],

  ['reports', reports.reportIndex, 'รายงาน'],
  ['reports/daily', reports.dailyClosed, 'สรุปรายวัน'],
  ['reports/monthly', reports.monthly, 'รายรับรายเดือน'],
  ['reports/checklist', reports.checklist, 'เช็คลิสต์สต็อก'],
  ['reports/labels', reports.labels, 'พิมพ์ป้ายราคา'],
  ['reports/unsold', reports.unsold, 'สินค้าค้างสต็อก'],

  ['print/order/:id', reports.printOrder, 'ใบสั่งตัดแว่น'],
  ['print/prescription/:id', reports.printPrescription, 'ใบวัดสายตา'],
];

const compiled = ROUTES.map(([pattern, view, title]) => {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:([a-z_]+)/gi, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  }) + '$');
  return { rx, keys, view, title };
});

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, search] = raw.split('?');
  return {
    path: path.replace(/\/$/, ''),
    query: Object.fromEntries(new URLSearchParams(search || '')),
  };
}

let token = 0;
async function render() {
  const { path, query } = parseHash();
  const my = ++token;
  markActive('#/' + path);

  const match = compiled.find((r) => r.rx.test(path));
  const view = $('#view');
  if (!match) {
    $('#crumb').textContent = 'ไม่พบหน้า';
    view.replaceChildren(el('div.card', {}, [
      el('div.card-body', {}, [
        el('h2', { text: '404 — ไม่พบหน้านี้' }),
        el('p', {}, [el('a', { href: '#/', text: '← กลับเมนูหลัก' })]),
      ]),
    ]));
    return;
  }

  const m = match.rx.exec(path);
  const params = {};
  match.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));

  $('#crumb').textContent = match.title;
  document.title = `${match.title} — TimeOptic`;
  view.replaceChildren(loading());
  window.scrollTo(0, 0);

  try {
    const node = await match.view({ params, query, navigate, refresh: render });
    if (my !== token) return; // a newer navigation won
    view.replaceChildren(node);
  } catch (e) {
    if (my !== token) return;
    console.error(e);
    err(e);
    view.replaceChildren(el('div.card', {}, [
      el('div.card-body', {}, [
        el('h2', { text: 'โหลดข้อมูลไม่สำเร็จ' }),
        el('p.muted', { text: e.message }),
        el('button.btn.btn-light', { text: 'ลองใหม่', onclick: render }),
      ]),
    ]));
  }
}

export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

/* ------------------------------ boot ------------------------------ */
function tickClock() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  $('#clock').textContent =
    `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}  ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function boot() {
  buildNav();
  tickClock();
  setInterval(tickClock, 30000);

  restoreSidebar();
  markNavScrollable();
  window.addEventListener('resize', markNavScrollable);
  $('#menu-toggle').addEventListener('click', toggleSidebar);
  $('#nav').addEventListener('click', (e) => {
    // บนจอเล็ก sidebar ทับเนื้อหาอยู่ พอเลือกเมนูแล้วต้องปิดเอง
    if (e.target.closest('a')) closeNav();
  });
  $('#nav-close').addEventListener('click', closeNav);
  $('#scrim').addEventListener('click', closeNav);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNav(); });
  // กางจอจนพ้นโหมดจอเล็กแล้ว ต้องล้างสถานะทิ้ง ไม่งั้นฉากมืดค้าง
  window.addEventListener('resize', () => { if (!isNarrow()) closeNav(); });
  window.addEventListener('hashchange', render);

  try {
    await loadMeta();
  } catch (e) {
    err('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้: ' + e.message);
  }
  if (!location.hash) location.hash = '#/';
  render();
}
boot();
