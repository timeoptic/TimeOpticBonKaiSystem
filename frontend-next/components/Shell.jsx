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

/**
 * เมนูจัดใหม่ตามการทำงานจริงของร้าน ไม่ใช่ตามโครงตาราง:
 *   งานหน้าร้าน = สิ่งที่พนักงานแตะทุกวัน เรียงตามลำดับที่ลูกค้าเดินผ่านจริง ๆ
 *   หลังบ้าน    = งานที่ตามหลังลูกค้ากลับบ้านไปแล้ว
 *
 * เดิมมีสองกลุ่มที่ทับกัน ("ขั้นตอนงาน 6 ขั้น" กับ "งานหน้าร้าน") ทำให้ "วัดสายตา"
 * โผล่สองที่คนละความหมาย (/exam คือคิวที่รอวัด · /prescriptions คือประวัติค่าสายตา)
 * รวมเป็นกลุ่มเดียวแล้วแยกชื่อให้ตรงกับสิ่งที่หน้านั้นเป็นจริง ๆ
 *
 * ธงตัวที่สามของกลุ่มคือ adminOnly · ด่านจริงอยู่ที่ `api/index.php` ซึ่งตอบ 403
 * ให้ทุกเส้นของกลุ่มนั้น ตรงนี้แค่ไม่วาดปุ่มที่กดไปก็ถูกปฏิเสธอยู่ดี
 */
const NAV = [
  ['หน้าหลัก', [
    ['home', 'ภาพรวม', '/'],
  ]],
  ['งานในร้าน', [
    ['calendar', 'ปฏิทินจองคิว', '/bookings'],
    ['board', 'กระดานงาน', '/cases'],
  ]],
  /* ครบ 6 ขั้นตามหัวข้อ — ขั้นแรกไม่มีหน้ารวมของตัวเอง จึงชี้ไปที่ "เปิดเคสใหม่" */
  ['ขั้นตอนงาน 6 ขั้น', [
    ['bellDesk', 'รับลูกค้า', '/cases/new'],
    ['eye', 'วัดสายตา', '/exam'],
    ['bag', 'ขาย-เลือกกรอบ', '/case-sales'],
    ['card', 'ชำระเงิน', '/case-payments'],
    ['target', 'วัด Center', '/centering'],
    ['box', 'ส่งมอบ', '/delivery'],
  ]],
  /* "วัดสายตา" มีสองรายการโดยตั้งใจ และไปคนละหน้า:
       ขั้นตอนงาน → /exam          คิวเคสที่รอวัดวันนี้
       งานหน้าร้าน → /prescriptions ประวัติค่าสายตาย้อนหลังของลูกค้า
     กลุ่มที่มันอยู่คือสิ่งที่บอกความต่าง ไม่ใช่ชื่อ */
  ['งานหน้าร้าน', [
    ['users', 'ลูกค้า', '/customers'],
    ['eye', 'วัดสายตา', '/prescriptions'],
    ['glasses', 'ออเดอร์ตัดแว่น', '/orders'],
    ['bag', 'ขายสินค้า', '/pos'],
    ['pin', 'ตำแหน่งสินค้า', '/locations'],
  ]],
  ['การเงิน', [
    ['coins', 'รายรับ', '/income'],
    ['banknote', 'รายจ่าย', '/expense'],
  ], true],
  ['ข้อมูลระบบ', [
    ['🧑‍💼', 'พนักงาน', '/employees'],
    /* พนักงาน กับ ผู้ใช้ เป็นคนละเรื่องและคนละหน้า: ข้างบนคือทะเบียนชื่อเล่น
       วันเกิด หน้าที่ · ข้างล่างคือบัญชีเข้าใช้ รหัสผ่าน สิทธิ์

       บัญชีเปิดได้ทั้งหน้าร้านและคลัง หน้าจัดการบัญชีจึงย้ายออกจาก /stock มา
       อยู่ที่ /users ของทั้งเว็บ และมีทางเข้าที่เดียวคือตรงนี้ — แถบข้างฝั่ง
       คลังไม่มีปุ่มนี้แล้ว · ตอนนี้หน้านั้นเขียนด้วยของหน้าร้านแล้ว จึงเป็น
       <Link> เหมือนเมนูอื่น ไม่ใช่การโหลดหน้าใหม่ */
    ['lock', 'ผู้ใช้และสิทธิ์', '/users'],
    ['factory', 'ซัพพลายเออร์', '/suppliers'],
    ['chart', 'รายงาน', '/reports'],
    /* บันทึกการใช้งาน — อยู่ท้ายกลุ่มเพราะเป็นที่ที่คนมาเปิดตอนมีเรื่องให้ตรวจ
       ไม่ใช่ทุกวัน · ด่านจริงเป็นตัวเดียวกับเมนูอื่นในกลุ่ม (ADMIN_PREFIXES) */
    ['clock', 'บันทึกการใช้งาน', '/logs'],
    ['gear', 'ตั้งค่า/แจ้งเตือน', '/settings'],
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
  const name = actor.displayName || actor.username || "";
  /* อักษรย่อจากชื่อที่แสดง — ชื่อไทยไม่มีนามสกุลแยกเสมอไป จึงเอาตัวแรกของคำแรก
     ตัวเดียว ไม่ใช่พยายามหาชื่อ-สกุลแบบฝรั่งแล้วได้ตัวอักษรมั่ว ๆ */
  const initial = name.trim().charAt(0) || "?";
  return (
    <div className="whoami">
      <span className="whoami-mark" aria-hidden="true">{initial}</span>
      <span className="whoami-text">
        <b>{name}</b>
        <small>{actor.roleLabel}</small>
      </span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={logout} title="ออกจากระบบ">
        ออก
      </button>
    </div>
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
    /* 1024 = จุดที่ globals.css เลิกทำ .sidebar เป็น drawer แล้วให้มันยืนถาวร
       ถ้าสองเลขนี้ไม่ตรงกัน จะมีช่วงความกว้างที่แถบข้างโผล่ถาวรแต่ state `open`
       ยังค้างเป็น true อยู่ แล้วฉากมืดคลุมจอทั้งที่ไม่มี drawer ให้ปิด */
    const onResize = () => { if (window.innerWidth >= 1024) setOpen(false); };
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
                    <span className="ic"><Icon name={icon} /></span><span className="lbl">{label}</span>
                  </a>
                ) : (
                  <Link key={to} href={to} className={isActive(to) ? 'active' : ''} aria-current={isActive(to) ? 'page' : undefined}>
                    <span className="ic"><Icon name={icon} /></span><span className="lbl">{label}</span>
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
                <span className="ic"><Icon name="box" /></span><span className="lbl">คลังและต้นทุน</span>
              </a>
              <a href="/hub/">
                <span className="ic"><Icon name="home" /></span><span className="lbl">เลือกระบบ</span>
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
          <WhoAmI />
        </header>
        <div className="content" id="view">{children}</div>
      </main>
    </div>
  );
}
