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
import { useAuth } from '../contexts/AuthContext.jsx';
import { isAdminPath, isAdminUp, worksBothSides } from '../lib/roles.js';

/**
 * ระบบคลังและต้นทุนเป็นอีกหน้าเว็บหนึ่ง คนละเมนู คนละหน้าตา
 *
 * ตั้งใจไม่ยุบสองเมนูเข้าด้วยกัน — คนละงาน คนละคนใช้ ยุบแล้วเมนูจะยาวจนหาไม่เจอ
 * ทั้งสองฝั่ง มีแค่ปุ่มเดินข้ามไปมา และล็อกอินใบเดียวกันจึงไม่ต้องล็อกอินซ้ำ
 *
 * ตอนนี้อยู่เว็บเดียวกันแล้ว ใต้ /stock — ต้องเป็น <a> ไม่ใช่ <Link> เพราะสอง
 * ฝั่ง import CSS คนละชุดที่ layout ของกลุ่มตัวเอง เดินข้ามแบบ client-side
 * จะได้สไตล์สองชุดทับกันในหน้าเดียว
 */
const STOCK_APP = process.env.NEXT_PUBLIC_STOCK_APP_URL || '/stock/';

export { crumbFor };

const NAV = [
  ['หน้าหลัก', [
    ['🏠', 'เมนูหลัก', '/'],
  ]],
  ['งานในร้าน', [
    ['📅', 'ปฏิทินจองคิว', '/bookings'],
    ['🗂', 'กระดานงาน', '/cases'],
  ]],
  /* ครบ 6 ขั้นตามหัวข้อ — ขั้นแรกไม่มีหน้ารวมของตัวเอง จึงชี้ไปที่ "เปิดเคสใหม่" */
  ['ขั้นตอนงาน 6 ขั้น', [
    ['🛎', 'รับลูกค้า', '/cases/new'],
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
    ['🛍', 'ขายสินค้า', '/pos'],
  ]],
  /* เคยมี "สต็อกสินค้า" ชี้ไป /stock ของฝั่งนี้เอง — ตอนนี้ /stock เป็นของระบบ
     คลังที่ย้ายเข้ามา และมีปุ่ม "คลังและต้นทุน" ในกลุ่ม "ระบบอื่น" อยู่แล้ว
     สองรายการที่พาไปที่เดียวกันมีไว้ก็สับสนเปล่า ๆ */
  ['คลังสินค้า', [
    ['📍', 'ตำแหน่งสินค้า', '/locations'],
    /* ของที่หน้าร้านขายไปแล้วแต่คลังยังไม่มี — หน้านั้นเป็นของฝั่งคลัง หน้าร้าน
       แค่มีทางเดินไปถึง เพราะคนที่เพิ่งรับออเดอร์คือคนที่รู้ว่าต้องสั่งอะไร */
    ['🧾', 'สินค้ารอสั่ง', '/stock/backorders'],
  ]],
  /* สองกลุ่มท้ายเป็นงานของแอดมิน — เงินของร้านและข้อมูลระบบไม่ใช่งานหน้าร้าน
     ธงตัวที่สามของกลุ่มคือ adminOnly · ด่านจริงอยู่ที่ `api/index.php` ซึ่งตอบ 403
     ให้ทุกเส้นของสองกลุ่มนี้ ตรงนี้แค่ไม่วาดปุ่มที่กดไปก็ถูกปฏิเสธอยู่ดี */
  ['การเงิน', [
    ['💰', 'รายรับ', '/income'],
    ['💸', 'รายจ่าย', '/expense'],
  ], true],
  ['ข้อมูลระบบ', [
    ['🧑‍💼', 'พนักงาน', '/employees'],
    ['🏭', 'ซัพพลายเออร์', '/suppliers'],
    ['📊', 'รายงาน', '/reports'],
    ['⚙️', 'ตั้งค่า/แจ้งเตือน', '/settings'],
  ], true],
];

/** ทุก href ในเมนู — ใช้ตัดสินว่าหน้านี้มีเมนูตรง ๆ หรือควรไฮไลต์เมนูของกลุ่ม */
const NAV_PATHS = new Set(NAV.flatMap(([, items]) => items.map(([, , to]) => to)));

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

/** ใครล็อกอินอยู่ กับปุ่มออก — มุมขวาบน ที่เดียวกับทุกระบบ */
function WhoAmI() {
  const { actor, logout } = useAuth();
  if (!actor) {
    return null;
  }
  return (
    <span className="row" style={{ gap: 8, alignItems: "center" }}>
      <span className="muted lbl" style={{ fontSize: 12 }}>
        {actor.displayName || actor.username} · {actor.roleLabel}
      </span>
      <button type="button" className="btn btn-ghost" onClick={logout} title="ออกจากระบบ">
        ออก
      </button>
    </span>
  );
}

export function Shell({ children }) {
  const { actor } = useAuth();
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
  /* trailingSlash ทำให้ path เป็น "/cases/new/" — ตัดทิ้งก่อนเทียบกับ href ในเมนู */
  const here = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  /* หน้าที่มีเมนูของตัวเอง (เช่น /cases/new) ไฮไลต์เมนูนั้น ไม่ใช่เมนูของกลุ่ม (/cases) */
  const isActive = (to) => (NAV_PATHS.has(here) ? here === to : to === base);

  /**
   * โซนแอดมินเป็นฝั่งของตัวเอง เหมือนหน้าร้านกับคลัง — ไม่ใช่สองกลุ่มที่ต่อท้าย
   * เมนูหน้าร้าน · อยู่โซนไหนก็เห็นเมนูของโซนนั้นอย่างเดียว เพราะเมนูสิบกว่ารายการ
   * ที่ปนงานคนละแบบกันคือเมนูที่หาอะไรไม่เจอ
   *
   * เดินข้ามโซนด้วย "เลือกระบบ" ในกลุ่ม "ระบบอื่น" ซึ่งต่อท้ายให้ทั้งสองโซน
   *
   * คนที่ไม่ใช่แอดมินได้เมนูหน้าร้านเสมอ แม้จะพิมพ์ URL ของโซนแอดมินเข้ามา —
   * เขาจะเห็นการ์ด "ไม่มีสิทธิ์" พร้อมเมนูปกติ ไม่ใช่หน้าจอที่เมนูหายไปทั้งแถบ
   * ซึ่งอ่านได้ว่าระบบพัง
   */
  const inAdminZone = isAdminUp(actor) && isAdminPath(here);
  const navGroups = NAV.filter(([, , adminOnly]) => (inAdminZone ? !!adminOnly : !adminOnly));

  return (
    <div className="app" id="app">
      <aside className={`sidebar ${open ? 'open' : ''}`} id="sidebar">
        <div className="brand">
          <span className="brand-mark">◎◎</span>
          <span className="brand-text"><b>TimeOptic</b><small>ระบบจัดการร้านแว่นตา</small></span>
        </div>
        <nav id="nav">
          {navGroups.map(([group, items]) => (
            <Fragment key={group}>
              <div className="nav-group">{group}</div>
              {items.map(([icon, label, to]) => (
                /* เมนูที่ชี้ออกไปฝั่งคลังต้องโหลดหน้าใหม่ ไม่ใช่ <Link> — สองฝั่ง
                   import CSS คนละชุด เดินข้ามแบบ client-side จะได้สไตล์ทับกัน
                   ก่อนหน้านี้ "สต็อกสินค้า" ยังเป็น <Link> เพราะสมัยที่เขียน
                   /stock ยังเป็นหน้าของฝั่งนี้เอง */
                to.startsWith('/stock') ? (
                  <a key={to} href={`${to}/`}>
                    <span className="ic"><Icon name={icon} /></span>{label}
                  </a>
                ) : (
                  <Link key={to} href={to} className={isActive(to) ? 'active' : ''}>
                    <span className="ic"><Icon name={icon} /></span>{label}
                  </Link>
                )
              ))}
            </Fragment>
          ))}
          {/* พนักงานขายทำงานฝั่งเดียว ปุ่มข้ามฝั่งจึงไม่ขึ้นให้เขา — กดไปก็ถูก
              ส่งกลับมาที่เดิม */}
          {worksBothSides(actor) ? (
            <>
              <div className="nav-group">ระบบอื่น</div>
              <a href={STOCK_APP}>
                <span className="ic"><Icon name="📦" /></span>คลังและต้นทุน
              </a>
              <a href="/hub/">
                <span className="ic"><Icon name="🏠" /></span>เลือกระบบ
              </a>
            </>
          ) : null}
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
          <WhoAmI />
        </header>
        <div className="content" id="view">{children}</div>
      </main>
    </div>
  );
}
