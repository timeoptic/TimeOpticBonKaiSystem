"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Actor } from "@/stockmod/lib/api";
import { stockHref, trimSlash } from "@/stockmod/lib/paths";
import { worksBothSides } from "@/lib/roles.js";
import { can } from "./AppShell";
import useScrollLock from "@/stockmod/lib/scrollLock";

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
  { href: "/backorders", label: "สินค้ารอสั่ง", hint: "ยอดติดลบ กับของที่เหลือต่ำกว่าขั้นต่ำ", icon: ICON.cart },
];

const STOCK: Item[] = [
  { href: "/dashboard", label: "แดชบอร์ด", hint: "สรุปตามช่วงวัน ขายดี และของที่ค้างสต็อก", icon: ICON.chart },
  { href: "/movements", label: "ความเคลื่อนไหว", hint: "นำเข้า ขาย เบิก ปรับ คืน", icon: ICON.flow },
];

const MONEY: Item[] = [
  { href: "/settlements", label: "การเบิกจากสาขา", hint: "เบิกอะไรไป เป็นทุนเท่าไร", icon: ICON.money },
  { href: "/branches", label: "จัดการสาขา", hint: "รายชื่อสาขาที่มาเบิกของได้", icon: ICON.shops },
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

/**
 * จัดการผู้ใช้ไม่อยู่ในแถบนี้แล้ว
 *
 * มันย้ายออกไปอยู่ที่ `/users` ของทั้งเว็บ และทางเข้าอยู่ที่เมนูหน้าร้าน กลุ่ม
 * "ข้อมูลระบบ" ที่เดียว · บัญชีหนึ่งใบเปิดได้ทั้งสองฝั่งอยู่แล้ว ปุ่มสองที่
 * สำหรับหน้าเดียวจึงเป็นเมนูที่ยาวขึ้นโดยไม่ได้อะไรกลับมา
 */

/** `/` matches only itself; every other section owns its subtree. */
const isCurrent = (pathname: string, href: string) => {
  const here = trimSlash(pathname);
  const there = trimSlash(stockHref(href));
  return href === "/" ? here === there : here === there || here.startsWith(`${there}/`);
};

/**
 * หน้าที่ไม่มีปุ่มของตัวเองในเมนู แต่ยังต้องมีชื่อกับไอคอนบนแถบบนและหัวเพจ
 *
 * ไม่ได้อยู่ในเมนูเพราะเดินเข้ามาจากหน้าอื่นเสมอ (กดจากสินค้า กดจากล็อต) —
 * เมนูที่ยาวขึ้นสองรายการเพื่อทางเข้าที่ไม่มีใครใช้คือเมนูที่หาอะไรเจอยากขึ้น
 */
const UNLISTED: Item[] = [
  { href: "/receive", label: "รับของเข้า", hint: "", icon: ICON.in },
  { href: "/lots", label: "ล็อตและต้นทุน", hint: "", icon: ICON.layers },
];

/**
 * หมวดที่กำลังยืนอยู่ — แถบบนใช้เป็นชื่อหน้า หัวเพจใช้เป็นไอคอน
 *
 * เลือกรายการที่ href ยาวที่สุดที่ยังตรง เพื่อให้หน้าลูก (`/products/…`) ได้
 * หมวดของตัวเอง ไม่ใช่หมวดแรกที่บังเอิญขึ้นต้นเหมือนกัน · ไอคอนจึงมาจากเมนูเสมอ
 * และไม่มีวันเป็นคนละตัวกับปุ่มที่ไฮไลต์อยู่ทางซ้าย
 */
export function sectionFor(pathname: string): Item | null {
  let best: Item | null = null;
  let bestLen = -1;
  for (const item of [...DAILY, ...STOCK, ...MONEY, ...UNLISTED]) {
    if (!isCurrent(pathname, item.href)) continue;
    const len = trimSlash(stockHref(item.href)).length;
    if (len > bestLen) {
      best = item;
      bestLen = len;
    }
  }
  return best;
}

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

/** วันเวลาท้ายแถบข้าง — ที่เดียวกับหน้าร้าน อัปเดตทุกครึ่งนาที */
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    <span suppressHydrationWarning>
      {`${p(now.getDate())}/${p(now.getMonth() + 1)}/${now.getFullYear()}  ${p(now.getHours())}:${p(now.getMinutes())}`}
    </span>
  );
}

/**
 * สี่ปุ่มที่อยู่บนแถบล่างจอมือถือ
 *
 * เลือกจากงานที่เปิดวันละหลายครั้ง ไม่ใช่จากลำดับในเมนู · ที่เหลือทั้งหมดอยู่หลัง
 * ปุ่ม "เมนู" ซึ่งเปิดรายการเต็มขึ้นมา — แถบล่างที่ยัดครบทุกหน้าคือแถบที่ทุกปุ่ม
 * เล็กเท่ากันหมดและไม่มีปุ่มไหนหาเจอ
 */
/* ป้ายสั้นเฉพาะบนแถบล่าง — ช่องกว้างราว 78px บนจอ 390px คำว่า "เบิก / ตัดสต็อก"
   ที่ 11px ไม่มีทางลงหนึ่งบรรทัด · ป้ายเต็มยังใช้ในเมนูและในแถบข้างเหมือนเดิม
   ตรงนั้นมีที่พอ และเป็นที่ที่คนอ่านเพื่อ "เลือกว่าจะไปไหน" ไม่ใช่เพื่อ "รู้ว่า
   ตอนนี้อยู่ไหน" ซึ่งเป็นงานของแถบล่าง */
const TABS: { item: Item; short: string }[] = [
  /* แดชบอร์ดแทนสินค้ารอสั่ง — เป็นหน้าแรกหลังล็อกอินแล้ว ปุ่มกลับมาที่นี่จึงต้อง
     หาเจอเร็วที่สุด จึงอยู่ซ้ายสุดของแถบ · สินค้ารอสั่งยังอยู่ในเมนู และมันเป็น
     รายการที่เปิดดูเป็นรอบ ๆ ตอนจะสั่งของ ไม่ใช่ของที่กดสลับไปมาทั้งวัน */
  { item: STOCK[0], short: "แดชบอร์ด" },
  { item: DAILY[0], short: "เบิกของ" },
  { item: DAILY[1], short: "สินค้า" },
  { item: DAILY[2], short: "ใบสั่ง RX" },
];

/**
 * เมนูล่างจอสำหรับมือถือ
 *
 * แถบเลื่อนแนวนอนที่เคยใช้แทนแถบข้างมีปัญหาเดียวกับตารางที่เลื่อนข้าง: ปุ่มที่
 * ต้องการอยู่นอกจอเสมอ และไม่มีอะไรบอกว่ามันอยู่ทางไหน · แถบล่างจอตายตัวสี่ปุ่ม
 * อยู่ที่เดิมทุกครั้ง อยู่ในระยะนิ้วโป้ง และบอกได้ด้วยว่าตอนนี้ยืนอยู่หน้าไหน
 */
function PhoneTabs({ actor, pathname }: { actor: Actor; pathname: string }) {
  const [open, setOpen] = useState(false);

  /**
   * เมนูเปิดอยู่ หน้าข้างหลังห้ามเลื่อน
   *
   * แผ่นเมนูลอยอยู่เหนือหน้า แต่การไถบนแผ่นยังส่งต่อไปถึงหน้าข้างหลัง — ไถเมนู
   * แล้วหน้าข้างหลังเลื่อน พอปิดเมนูจึงไปโผล่คนละที่กับตอนกด และของที่กำลังอ่าน
   * อยู่ก่อนกดเมนูก็หายไป
   *
   * ล็อกที่ body ไม่ใช่ที่แผ่น เพราะตัวที่เลื่อนคือหน้าข้างหลัง ไม่ใช่แผ่น ·
   * คืนค่าเดิมตอนปิด ไม่ได้เซ็ตเป็นค่าว่างทับ เผื่อมีใครตั้ง overflow ไว้ก่อนแล้ว
   */
  useScrollLock(open);

  return (
    <>
      <nav className="railtabs phone-only" aria-label="เมนูหลัก">
        {TABS.slice(0, 2).map(({ item, short }) => (
          <Link
            key={item.href}
            href={stockHref(item.href)}
            className="railtab"
            aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
            title={item.label}
          >
            {item.icon}
            <span>{short}</span>
          </Link>
        ))}
        {/* เมนูอยู่ตรงกลาง ไม่ใช่ท้ายแถบ — เป็นปุ่มที่พาไปได้ทุกที่ จึงเป็นปุ่มที่
            ถูกกดบ่อยที่สุดเมื่อจะไปหน้าที่ไม่ได้อยู่ในสี่ปุ่มนี้ และกลางแถบคือที่ที่
            นิ้วโป้งไปถึงง่ายที่สุดบนจอที่ถือมือเดียว */}
        <button type="button" className="railtab" onClick={() => setOpen(true)}>
          {ICON.layers}
          <span>เมนู</span>
        </button>

        {TABS.slice(2).map(({ item, short }) => (
          <Link
            key={item.href}
            href={stockHref(item.href)}
            className="railtab"
            aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
            title={item.label}
          >
            {item.icon}
            <span>{short}</span>
          </Link>
        ))}
      </nav>

      {open ? (
        /* รายการเต็มเปิดเป็นแผ่นเลื่อนขึ้นจากล่าง ไม่ใช่ลิ้นชักจากข้าง — นิ้วที่
           เพิ่งกดปุ่ม "เมนู" อยู่ล่างจอ ของที่โผล่ขึ้นมาจึงควรโผล่ตรงนั้น */
        <div className="railsheet" role="dialog" aria-label="เมนูทั้งหมด">
          <button
            type="button"
            className="railsheet__scrim"
            aria-label="ปิดเมนู"
            onClick={() => setOpen(false)}
          />
          <div className="railsheet__panel" onClick={() => setOpen(false)}>
            <Group title="งานประจำวัน" items={DAILY} pathname={pathname} />
            <Group title="คลัง" items={STOCK} pathname={pathname} />
            {can.seeBranchMoney(actor) ? (
              <Group title="เงินและสาขา" items={MONEY} pathname={pathname} />
            ) : null}
            {worksBothSides(actor) ? (
              <div className="rail-group">
                <p className="rail-group__title">ระบบอื่น</p>
                <ul className="rail-list">
                  <li>
                    <a href={FRONTDESK} className="rail-item">
                      {ICON.shops}
                      <span>หน้าร้าน</span>
                    </a>
                  </li>
                  <li>
                    <a href="/hub/" className="rail-item">
                      {ICON.boxes}
                      <span>เลือกระบบ</span>
                    </a>
                  </li>
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function SideRail({ actor }: { actor: Actor }) {
  const pathname = usePathname();

  return (
    <>
    <PhoneTabs actor={actor} pathname={pathname} />
    <nav className="rail-nav wide-only" aria-label="ส่วนหลักของระบบ">
      <Link href="/stock" className="rail-brand">
        <span className="rail-brand__mark" aria-hidden="true">{ICON.boxes}</span>
        {/* ชื่อแบรนด์อยู่บรรทัดบน ชื่อฝั่งอยู่บรรทัดล่าง — เรียงเหมือนหน้าร้าน
            (TimeOptic / ระบบจัดการร้านแว่นตา) เพราะแบรนด์คือของที่เหมือนกัน
            ส่วนบรรทัดล่างคือสิ่งที่บอกว่ากำลังยืนอยู่ฝั่งไหนของระบบเดียวกัน */}
        <span className="rail-brand__text">
          <span className="rail-brand__name">TimeOptic</span>
          <span className="rail-brand__sub">คลังและต้นทุน</span>
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

      {/* ชื่อผู้ใช้กับปุ่มออกย้ายไปมุมขวาบนแล้ว ท้ายแถบข้างเหลือวันเวลา
          เหมือน `.sidebar-foot` ของหน้าร้าน */}
      <div className="rail-foot">
        <Clock />
      </div>
    </nav>
    </>
  );
}
