/** Sidebar + topbar frame around every page. */
import { Fragment, useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';

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

export function Shell({ crumb, children }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  // close the drawer whenever the route changes
  useEffect(() => { setOpen(false); }, [pathname]);

  /** the sidebar highlights by first path segment, so /orders/5 lights /orders */
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
                <NavLink key={to} to={to} className={to === base ? 'active' : ''}>
                  <span className="ic">{icon}</span>{label}
                </NavLink>
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
          <Link className="btn btn-ghost" to="/">🏠 เมนูหลัก</Link>
        </header>
        <div className="content" id="view">{children}</div>
      </main>
    </div>
  );
}
