'use client';
/**
 * Sidebar + topbar frame around every page. Port of frontend/src/components/Shell.jsx,
 * absorbing the crumb-from-path logic that used to live in frontend/src/App.jsx
 * (Next's file-based routing replaced the central <Routes> table).
 */
import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  ['หน้าหลัก', [
    ['🏠', 'เมนูหลัก', '/'],
  ]],
  ['งานในร้าน', [
    ['📅', 'ปฏิทินจองคิว', '/bookings'],
    ['🗂', 'กระดานงาน', '/cases'],
    ['🔎', 'ติดตามเลนส์', '/lens-tracker'],
  ]],
  ['งานหน้าร้าน', [
    ['👥', 'ลูกค้า', '/customers'],
    ['👁', 'วัดสายตา', '/prescriptions'],
    ['👓', 'ออเดอร์ตัดแว่น', '/orders'],
    ['🛍', 'ขายสินค้า', '/sales'],
  ]],
  ['คลังสินค้า', [
    ['📦', 'สต็อกสินค้า', '/stock'],
    ['📍', 'ตำแหน่งสินค้า', '/locations'],
  ]],
  ['การเงิน', [
    ['💰', 'รายรับ', '/income'],
    ['💸', 'รายจ่าย', '/expense'],
  ]],
  ['ข้อมูลระบบ', [
    ['🧑‍💼', 'พนักงาน', '/employees'],
    ['🏭', 'ซัพพลายเออร์', '/suppliers'],
    ['📊', 'รายงาน', '/reports'],
    ['⚙️', 'ตั้งค่า/แจ้งเตือน', '/settings'],
  ]],
];

/** path -> breadcrumb, matched longest-first. Detail/edit pages under a
    domain (e.g. /customers/detail?id=5) still match their domain's '/customers'
    entry, since the id lives in the query string, not the path. */
const TITLES = [
  ['/', 'เมนูหลัก'],
  ['/customers/new', 'ลูกค้าใหม่'],
  ['/customers/detail', 'รายละเอียดลูกค้า'],
  ['/customers/edit', 'แก้ไขลูกค้า'],
  ['/customers', 'ลูกค้า'],
  ['/prescriptions/new', 'บันทึกการวัดสายตา'],
  ['/prescriptions', 'วัดสายตา'],
  ['/bookings/new', 'จองคิวใหม่'],
  ['/bookings', 'ปฏิทินจองคิว'],
  ['/settings', 'ตั้งค่า/แจ้งเตือน'],
  ['/cases/new', 'เปิดเคสใหม่'],
  ['/cases', 'กระดานงาน'],
  ['/lens-tracker', 'ติดตามเลนส์'],
  ['/employees', 'พนักงาน'],
  ['/orders/new', 'เปิดออเดอร์ใหม่'],
  ['/orders', 'ออเดอร์ตัดแว่น'],
  ['/sales/new', 'ขายสินค้าทั่วไป'],
  ['/sales', 'ขายสินค้า'],
  ['/stock/new', 'เพิ่มสินค้าเข้าคลัง'],
  ['/stock', 'สต็อกสินค้า'],
  ['/locations', 'ตำแหน่งสินค้า'],
  ['/suppliers', 'ซัพพลายเออร์'],
  ['/income', 'รายรับ'],
  ['/expense', 'รายจ่าย'],
  ['/reports/daily', 'สรุปรายวัน'],
  ['/reports/monthly', 'รายรับรายเดือน'],
  ['/reports/checklist', 'เช็คลิสต์สต็อก'],
  ['/reports/labels', 'พิมพ์ป้ายราคา'],
  ['/reports/unsold', 'สินค้าค้างสต็อก'],
  ['/reports', 'รายงาน'],
  ['/print/order', 'ใบสั่งตัดแว่น'],
  ['/print/prescription', 'ใบวัดสายตา'],
];

export function crumbFor(pathname) {
  if (pathname === '/') return 'เมนูหลัก';
  const hit = TITLES
    .filter(([p]) => p !== '/' && (pathname === p || pathname.startsWith(p + '/')))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? hit[1] : 'TimeOptic';
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  const p = (n) => String(n).padStart(2, '0');
  return (
    <span id="clock">
      {`${p(now.getDate())}/${p(now.getMonth() + 1)}/${now.getFullYear()}  ${p(now.getHours())}:${p(now.getMinutes())}`}
    </span>
  );
}

export function Shell({ children }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const crumb = crumbFor(pathname);

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    document.title = `${crumb} — TimeOptic`;
    window.scrollTo(0, 0);
  }, [crumb, pathname]);

  const base = '/' + (pathname.split('/')[1] || '');

  return (
    <div className="app" id="app">
      <aside className={`sidebar ${open ? 'open' : ''}`} id="sidebar">
        <div className="brand">
          <span className="brand-mark">◎◎</span>
          <span className="brand-text"><b>TimeOptic</b><small>ระบบจัดการร้านแว่นตา</small></span>
        </div>
        <nav id="nav">
          {NAV.map(([group, items]) => (
            <Fragment key={group}>
              <div className="nav-group">{group}</div>
              {items.map(([icon, label, to]) => (
                <Link key={to} href={to} className={to === base ? 'active' : ''}>
                  <span className="ic">{icon}</span>{label}
                </Link>
              ))}
            </Fragment>
          ))}
        </nav>
        <div className="sidebar-foot"><Clock /></div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn"
            id="menu-toggle"
            title="เมนู"
            aria-label="เมนู"
            onClick={() => setOpen((v) => !v)}
          >
            ☰
          </button>
          <div className="crumb" id="crumb">{crumb}</div>
          <div className="spacer" />
          <Link className="btn btn-ghost" href="/">🏠 เมนูหลัก</Link>
        </header>
        <div className="content" id="view">{children}</div>
      </main>
    </div>
  );
}
