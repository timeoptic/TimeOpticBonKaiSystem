"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Actor } from "@/stockmod/lib/api";
import { stockHref, trimSlash } from "@/stockmod/lib/paths";
import { worksBothSides } from "@/lib/roles.js";
import { can } from "./AppShell";

/**
 * N3 side-rail — the app's one navigation surface.
 *
 * Under 900px it becomes a horizontal scrolling strip rather than collapsing
 * behind a menu button: stock work means switching sections constantly, and
 * hiding the nav costs a tap on every switch.
 */

type Item = { href: string; label: string; hint: string; icon: React.ReactNode };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const ICON = {
  chart: (
    <svg className="rail-icon" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <rect x="7.5" y="12" width="3" height="5" rx="1" />
      <rect x="12.5" y="8" width="3" height="9" rx="1" />
      <rect x="17.5" y="14" width="3" height="3" rx="1" />
    </svg>
  ),
  boxes: (
    <svg className="rail-icon" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z" />
      <path d="M3 15.5 12 20l9-4.5" />
      <path d="M3 12 12 16.5 21 12" />
    </svg>
  ),
  layers: (
    <svg className="rail-icon" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <rect x="3.5" y="4" width="17" height="6" rx="2" />
      <rect x="3.5" y="14" width="17" height="6" rx="2" />
    </svg>
  ),
  flow: (
    <svg className="rail-icon" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M4 8h11" />
      <path d="m12 5 3 3-3 3" />
      <path d="M20 16H9" />
      <path d="m12 13-3 3 3 3" />
    </svg>
  ),
  people: (
    <svg className="rail-icon" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16.5 6.2a3.5 3.5 0 0 1 0 6.6" />
      <path d="M17.5 14.8c2.1.5 3.5 2.3 3.5 4.7" />
    </svg>
  ),
  out: (
    <svg className="rail-icon" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M4 5.5h8v13H4z" />
      <path d="M9 12h11" />
      <path d="m17 9 3 3-3 3" />
    </svg>
  ),
  in: (
    <svg className="rail-icon" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M20 5.5h-8v13h8z" />
      <path d="M15 12H4" />
      <path d="m7 9-3 3 3 3" />
    </svg>
  ),
  lens: (
    <svg className="rail-icon" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="7.5" cy="13" r="4" />
      <circle cx="16.5" cy="13" r="4" />
      <path d="M11.5 12.5h1" />
      <path d="M4 8.5 6.5 6M20 8.5 17.5 6" />
    </svg>
  ),
  money: (
    <svg className="rail-icon" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <rect x="3" y="6.5" width="18" height="11" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6.5 12h.01M17.5 12h.01" />
    </svg>
  ),
  /* ตะกร้าที่ยังว่าง กับป้ายลบ — ของที่ต้องสั่ง ไม่ใช่ของที่มี */
  cart: (
    <svg className="rail-icon" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M3 5h2l2.2 9.2a1.6 1.6 0 0 0 1.6 1.3h7.6a1.6 1.6 0 0 0 1.6-1.2L20 8H6" />
      <circle cx="9.5" cy="19" r="1.3" />
      <circle cx="16.5" cy="19" r="1.3" />
      <path d="M11 11h4" />
    </svg>
  ),
  shops: (
    <svg className="rail-icon" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M4 10v9h16v-9" />
      <path d="M3 10 4.8 5h14.4L21 10a2.4 2.4 0 0 1-4.5 1 2.4 2.4 0 0 1-4.5 0 2.4 2.4 0 0 1-4.5 0A2.4 2.4 0 0 1 3 10Z" />
    </svg>
  ),
};

/**
 * The rail is grouped by what someone came here to do, not by what table the
 * data lives in. งานประจำวัน is the short list of things that happen many times
 * a day; everything under คลัง is looked at rather than done.
 */
const DAILY: Item[] = [
  { href: "/", label: "เบิก / ตัดสต็อก", hint: "ตัดของออกจากคลัง ขาย เบิก ของเสีย", icon: ICON.out },
  { href: "/products", label: "สินค้าและสต็อก", hint: "สินค้า ล็อต ต้นทุน และรับของเข้า", icon: ICON.boxes },
  { href: "/rx", label: "ใบสั่งตัด RX", hint: "สั่งเลนส์เฉพาะราย และลงต้นทุน", icon: ICON.lens },
  /* ของที่ขายไปแล้วแต่ยังไม่มีในคลัง — งานประจำวัน ไม่ใช่รายงาน: รายการนี้คือของ
     ที่ต้องสั่งวันนี้ และหายไปเองเมื่อรับของเข้า */
  { href: "/backorders", label: "สินค้ารอสั่ง", hint: "ขายไปแล้วของยังไม่เข้า ยอดติดลบ", icon: ICON.cart },
];

const STOCK: Item[] = [
  { href: "/dashboard", label: "แดชบอร์ด", hint: "สรุปตามช่วงวัน ขายดี และของที่ค้างสต็อก", icon: ICON.chart },
  { href: "/movements", label: "ความเคลื่อนไหว", hint: "นำเข้า ขาย เบิก ปรับ คืน", icon: ICON.flow },
];

const MONEY: Item[] = [
  { href: "/settlements", label: "ค้างรับจากสาขา", hint: "ของออกไปแล้ว เงินยังไม่มา", icon: ICON.money },
  { href: "/branches", label: "สาขา", hint: "รายชื่อสาขาที่มาเบิกของได้", icon: ICON.shops },
];

/**
 * หน้าร้านเป็นอีกเว็บหนึ่ง คนละเมนู คนละหน้าตา
 *
 * ตั้งใจไม่ยุบสองเมนูเข้าด้วยกัน — คนละงาน คนละคนใช้ ยุบแล้วเมนูจะยาวจนหาไม่เจอ
 * ทั้งสองฝั่ง มีแค่ปุ่มเดินข้ามไปมา และล็อกอินใบเดียวกันจึงไม่ต้องล็อกอินซ้ำ
 *
 * ตอนนี้อยู่เว็บเดียวกันแล้ว หน้าร้านอยู่ที่ราก — ต้องเป็น <a> ไม่ใช่ <Link>
 * เพราะสองฝั่ง import CSS คนละชุด เดินข้ามแบบ client-side จะได้สไตล์ทับกัน
 */
const FRONTDESK = process.env.NEXT_PUBLIC_FRONTDESK_APP_URL ?? "/";

const ADMIN: Item[] = [
  { href: "/users", label: "จัดการผู้ใช้", hint: "บัญชี สิทธิ์ และตำแหน่งงาน", icon: ICON.people },
];

/** `/` matches only itself; every other section owns its subtree. */
const isCurrent = (pathname: string, href: string) => {
  const here = trimSlash(pathname);
  const there = trimSlash(stockHref(href));
  return href === "/" ? here === there : here === there || here.startsWith(`${there}/`);
};

function Group({ title, items, pathname }: { title: string; items: Item[]; pathname: string }) {
  return (
    <div className="rail-group">
      <p className="rail-group__title">{title}</p>
      <ul className="rail-list">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={stockHref(item.href)}
              className="rail-item"
              aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
              title={item.hint}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function SideRail({
  actor,
  onSignOut,
}: {
  actor: Actor;
  onSignOut: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="rail-nav" aria-label="ส่วนหลักของระบบ">
      <Link href="/stock" className="rail-brand">
        <span className="rail-brand__dot" aria-hidden="true" />
        <span className="rail-brand__text">
          คลังและต้นทุน
          <span className="rail-brand__sub">optical</span>
        </span>
      </Link>

      <div className="rail-scroll">
        <Group title="งานประจำวัน" items={DAILY} pathname={pathname} />
        <Group title="คลัง" items={STOCK} pathname={pathname} />
        {/* Staff record branch withdrawals but never see what is owed, so the
            group that is entirely about money is not in their rail at all. */}
        {can.seeBranchMoney(actor) ? (
          <Group title="เงินและสาขา" items={MONEY} pathname={pathname} />
        ) : null}
        {can.manageUsers(actor) ? <Group title="ระบบ" items={ADMIN} pathname={pathname} /> : null}

        {/* พนักงานคลังทำงานฝั่งเดียว ปุ่มข้ามฝั่งจึงไม่ขึ้นให้เขา — กดไปก็ถูก
            ส่งกลับมาที่เดิม */}
        {worksBothSides(actor) ? (
          <div className="rail-group">
            <p className="rail-group__title">ระบบอื่น</p>
            <ul className="rail-list">
              <li>
                <a
                  href={FRONTDESK}
                  className="rail-item"
                  title="เคส ลูกค้า วัดสายตา และการขายหน้าร้าน"
                >
                  {ICON.shops}
                  <span>หน้าร้าน</span>
                </a>
              </li>
              <li>
                <a href="/hub/" className="rail-item" title="กลับไปหน้าเลือกระบบ">
                  {ICON.boxes}
                  <span>เลือกระบบ</span>
                </a>
              </li>
            </ul>
          </div>
        ) : null}
      </div>

      <div className="rail-foot">
        <div className="rail-who">
          <span className="rail-who__name">{actor.displayName}</span>
          <span className="rail-who__role">{actor.roleLabel}</span>
        </div>
        <button type="button" onClick={onSignOut} className="btn btn--quiet btn--small btn--block">
          ออกจากระบบ
        </button>
      </div>
    </nav>
  );
}
