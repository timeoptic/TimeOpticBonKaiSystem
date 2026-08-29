'use client';
/**
 * Sidebar + topbar frame around every page. Port of frontend/src/components/Shell.jsx,
 * absorbing the crumb-from-path logic that used to live in frontend/src/App.jsx
 * (Next's file-based routing replaced the central <Routes> table).
 */
import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { crumbFor } from '../lib/crumb.js';
import { Icon } from './Icon.jsx';

export { crumbFor };

const NAV = [
  ['หน้าหลัก', [
    ['🏠', 'เมนูหลัก', '/'],
  ]],
  ['งานในร้าน', [
    ['📅', 'ปฏิทินจองคิว', '/bookings'],
    ['🗂', 'กระดานงาน', '/cases'],
  ]],
  /* รับลูกค้าไม่มีหน้ารวมของตัวเอง — "เปิดเคสใหม่" บนกระดานงานคือขั้นนั้น */
  ['ขั้นตอนงาน 6 ขั้น', [
    ['👁', 'วัดสายตา', '/exam'],
    ['🛍', 'ขาย-เลือกกรอบ', '/case-sales'],
    ['💳', 'ชำระเงิน', '/case-payments'],
    ['🎯', 'วัด Center', '/centering'],
    ['📦', 'ส่งมอบ', '/delivery'],
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
    <span id="clock" suppressHydrationWarning>
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
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    const onResize = () => { if (window.innerWidth > 820) setOpen(false); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
                  <span className="ic"><Icon name={icon} /></span>{label}
                </Link>
              ))}
            </Fragment>
          ))}
        </nav>
        <div className="sidebar-foot"><Clock /></div>
      </aside>

      {open && (
        <div className="sidebar-overlay" onClick={() => setOpen(false)} aria-hidden="true" />
      )}

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
            <Icon name="menu" />
          </button>
          <div className="crumb" id="crumb">{crumb}</div>
          <div className="spacer" />
          <Link className="btn btn-ghost" href="/"><Icon name="home" /> <span className="lbl">เมนูหลัก</span></Link>
        </header>
        <div className="content" id="view">{children}</div>
      </main>
    </div>
  );
}
