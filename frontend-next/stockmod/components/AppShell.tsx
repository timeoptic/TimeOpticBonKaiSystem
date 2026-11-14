"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api, ApiError, type Actor } from "@/stockmod/lib/api";
import { can as allowed, homeFor, mayUseStock, mustChangePassword } from "@/lib/roles.js";
import CommandPalette from "./CommandPalette";
import { ToastProvider } from "./Toaster";
import SideRail, { sectionFor } from "./SideRail";
import TaskDialog from "./TaskDialog";
import { stockHref, trimSlash } from "@/stockmod/lib/paths";

const ActorContext = createContext<Actor | null>(null);

/**
 * ผู้ใช้ที่ล็อกอินอยู่ สำหรับหน้าที่ไม่ได้อยู่ใน AppShell
 *
 * หน้าฝัง (`/stock/embed/*`) ใช้ฟอร์มตัวเดียวกับหน้าคลัง แต่ไม่มีเมนูซ้ายและ
 * ไม่มีโครงของ AppShell — ฟอร์มยังต้องรู้ว่าใครกำลังกรอกอยู่เพื่อตัดสินว่าจะ
 * โชว์ช่องต้นทุนไหม จึงต้องมีที่จ่าย actor ให้แยกต่างหาก
 */
export function ActorProvider({ actor, children }: { actor: Actor; children: React.ReactNode }) {
  return <ActorContext.Provider value={actor}>{children}</ActorContext.Provider>;
}

/**
 * The signed-in person, for screens that show or hide by permission.
 *
 * Hiding a control the API would refuse is a courtesy, not a security boundary —
 * the API checks every request again regardless. This exists so a technician is
 * never shown a cost field that will only reject them.
 */
export function useActor(): Actor {
  const actor = useContext(ActorContext);
  if (actor === null) {
    throw new Error("useActor ต้องอยู่ภายใน AppShell");
  }
  return actor;
}

/**
 * สิทธิ์ที่หน้าจอฝั่งนี้ถาม — ทุกตัวอ่านจาก `actor.perms` ที่ API ส่งมา
 *
 * เมื่อก่อนแต่ละตัวคำนวณจากยศเอง (`isAdminUp`) ซึ่งเป็นสำเนาของกฎที่ต้องแก้ให้
 * ตรงกับ PHP ทุกครั้ง · ตอนนี้เป็นการถามชื่อสิทธิ์ตรง ๆ ชื่อเดียวกับที่ API ใช้
 * บังคับจริง จึงขัดกันไม่ได้ · ยังแยกเป็นคนละชื่อไว้เพราะจุดที่เรียกใช้อ่านรู้เรื่อง
 * กว่าการเขียน `can(a, "cost.view")` กระจายอยู่ทั่วไฟล์
 *
 * ทั้งหมดนี้เป็นมารยาท ไม่ใช่ด่าน — API ตรวจซ้ำทุกคำขอไม่ว่าหน้าจอจะวาดอะไร
 * ที่มันมีอยู่คือเพื่อไม่ให้ช่างเห็นช่องต้นทุนที่กดแล้วโดนปฏิเสธอยู่ดี
 */
export const can = {
  /** ต้นทุนแยกสองข้อ: เห็น กับ กรอก — แอดมินอยู่คนละฝั่งของสองข้อนี้ */
  enterCost: (a: Actor) => allowed(a, "cost.edit"),
  seeCost: (a: Actor) => allowed(a, "cost.view"),
  editCatalog: (a: Actor) => allowed(a, "catalog.edit"),
  /**
   * เพิ่มของที่ยังไม่มีในแคตตาล็อก — ทำได้ทุกบทบาท ต่างจากการแก้และการลบ
   *
   * ของใหม่ถูกค้นพบตอนทำงาน ไม่ใช่ตอนจัดแคตตาล็อก · ฝั่งเซิร์ฟเวอร์ตอบด้วย
   * `Roles::addProduct` ตัวเดียวกัน ที่นี่มีไว้ไม่ให้ปุ่มหายไปจากคนที่กดได้
   */
  addProduct: (a: Actor) => allowed(a, "product.add"),
  manageUsers: (a: Actor) => allowed(a, "users.manage"),
  seeBranchMoney: (a: Actor) => allowed(a, "branch.money"),
  manageBranches: (a: Actor) => allowed(a, "branch.manage"),
  /**
   * ลงชื่อ "คนอื่น" ว่าเป็นคนทำของเสีย
   *
   * ตัดของเสียทำได้ทุกบทบาท และตัดของที่ตัวเองทำเสียก็ไม่ต้องขอใคร ที่กันไว้
   * คือการลงชื่อเพื่อนร่วมงาน ซึ่งแดชบอร์ดเอาไปรวมเป็นยอดรายคน · ด่านจริงอยู่
   * ที่ `StockGate::blamed` ตรงนี้แค่ไม่วาดปุ่มที่จะโดนปฏิเสธอยู่ดี
   */
  blameScrap: (a: Actor) => allowed(a, "scrap.blame"),
};

/**
 * Workbench shell — permanent rail on the left, working surface on the right.
 *
 * The session lives in a cookie the PHP API owns, so the browser is the only
 * thing that can ask who is signed in. Every screen renders inside this, which
 * means the answer is fetched once per navigation rather than once per screen.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const [actor, setActor] = useState<Actor | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string>("");
  /** คำขอจากสาขาที่รอตรวจ — ป้ายตัวเลขบนเมนู (เฉพาะคนที่ถือ `issue.approve`) */
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let alive = true;

    /* หน้าล็อกอินกับหน้าเลือกฝั่งอยู่คนละกลุ่ม CSS จึงเดินด้วยการโหลดหน้าใหม่
       (`location.assign`) ไม่ใช่ router — client-side จะได้สไตล์สองชุดทับกัน */
    api
      .get<{ actor: Actor | null }>("/auth/me")
      .then(({ actor }) => {
        if (!alive) return;
        if (actor === null) {
          location.assign("/login/");
          return;
        }
        /* รหัสที่คนอื่นตั้งให้ ใช้ได้ครั้งเดียวเพื่อเข้ามาตั้งรหัสจริง — API ปฏิเสธ
           ทุกเส้นด้วย 403 อยู่แล้ว ถ้าไม่เด้ง หน้าจอจะขึ้นมาแล้วพังทุกการ์ดพร้อมกัน */
        if (mustChangePassword(actor)) {
          location.assign("/change-password/");
          return;
        }
        /* บัญชีสาขามีหน้าเดียวในฝั่งนี้ คือหน้าขอตัดเลนส์ — หน้าอื่นส่งกลับไปที่นั่น */
        if (!mayUseStock(actor) && allowed(actor, "issue.request")) {
          if (!trimSlash(location.pathname).startsWith(trimSlash(stockHref("/requests")))) {
            location.assign(stockHref("/requests/"));
            return;
          }
        } else if (!mayUseStock(actor)) {
          /* พนักงานขายเดินมาฝั่งคลังก็ไม่มีอะไรให้ทำ ส่งกลับไปที่ทำงานของเขา */
          location.assign(homeFor(actor));
          return;
        }
        setActor(actor);
        setState("ready");
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (ApiError.is(e) && e.isAuth) {
          location.assign("/login/");
          return;
        }
        setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาดที่ไม่รู้จัก");
        setState("error");
      });

    return () => {
      alive = false;
    };
  }, []);

  async function signOut() {
    try {
      await api.post("/auth/logout");
    } finally {
      location.assign("/login/");
    }
  }

  if (state === "error") {
    return (
      <main className="work-main">
        <div className="empty">
          <p className="empty__title">เปิดระบบไม่ได้</p>
          <p className="empty__body">{error}</p>
          <button type="button" className="btn" onClick={() => location.reload()}>
            ลองใหม่
          </button>
        </div>
      </main>
    );
  }

  // Nothing is rendered until we know who is here — showing a rail and then
  // bouncing to sign-in reads as a glitch.
  if (state === "loading" || actor === null) {
    return (
      <main className="work-main">
        <p className="field__help">กำลังตรวจสอบสิทธิ์…</p>
      </main>
    );
  }

  return (
    <ActorContext.Provider value={actor}>
      <ToastProvider>
        <div className="app">
          <SideRail actor={actor} pending={pending} />
          <div className="work-area">
            <WorkBar actor={actor} onSignOut={signOut} />
            {children}
          </div>
        </div>
        {mayUseStock(actor) ? <CommandPalette /> : null}
        {allowed(actor, "issue.approve") ? <RequestAlert onCount={setPending} /> : null}
      </ToastProvider>
    </ActorContext.Provider>
  );
}

/**
 * ป๊อปอัพเตือนคำขอตัดเลนส์ใหม่จากสาขา — ร้านขอไว้ 27 ต.ค. 2026
 *
 * ถามทุก 30 วินาที และทุกครั้งที่กลับมาที่แท็บ · เด้งเมื่อมีคำขอที่ใหม่กว่าใบล่าสุดที่เคยเด้ง
 * (จำไว้ใน sessionStorage) และไม่เด้งบนหน้าคำขอเอง เพราะกำลังดูรายการอยู่แล้ว
 */
const SEEN_KEY = "issue-requests-seen";

function RequestAlert({ onCount }: { onCount: (n: number) => void }) {
  const pathname = usePathname();
  const [show, setShow] = useState<{ pending: number; latestId: number } | null>(null);
  const onRequests = trimSlash(pathname).startsWith(trimSlash(stockHref("/requests")));

  useEffect(() => {
    let alive = true;
    const seen = () => {
      try {
        return Number(sessionStorage.getItem(SEEN_KEY) ?? 0);
      } catch {
        return 0;
      }
    };
    const check = () => {
      api
        .get<{ pending: number; latestId: number }>("/issue-requests/pending-count")
        .then((r) => {
          if (!alive) return;
          onCount(r.pending);
          if (r.pending > 0 && r.latestId > seen()) setShow(r);
        })
        .catch(() => undefined);
    };
    check();
    const t = setInterval(check, 30000);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [onCount]);

  function dismiss() {
    if (show) {
      try {
        sessionStorage.setItem(SEEN_KEY, String(show.latestId));
      } catch {
        /* เก็บไม่ได้ก็แค่เด้งซ้ำรอบหน้า */
      }
    }
    setShow(null);
  }

  if (show === null || onRequests) return null;

  return (
    <TaskDialog eyebrow="คำขอจากสาขา" title={`มีคำขอรอตรวจ ${show.pending} รายการ`} onClose={dismiss}>
      <p className="field__help">สาขาส่งคำขอเบิกเลนส์ / สั่งตัด RX เข้ามา — ตรวจ แก้ แล้วกดยืนยันได้ที่หน้าคำขอ</p>
      <div className="wizard__nav">
        <button type="button" className="btn btn--quiet" onClick={dismiss}>
          ไว้ทีหลัง
        </button>
        <Link href={stockHref("/requests")} className="btn btn--primary" onClick={dismiss}>
          ไปตรวจ
        </Link>
      </div>
    </TaskDialog>
  );
}

/**
 * แถบบน — อยู่ตรงไหนของระบบ กับใครกำลังใช้เครื่องนี้
 *
 * ฝั่งคลังเคยไม่มีแถบนี้เลย ชื่อหน้าอยู่ในเนื้อหน้าอย่างเดียว · พอสองฝั่งใช้
 * เมนูซ้ายหน้าตาเดียวกันแล้ว การที่ฝั่งหนึ่งมีแถบบนอีกฝั่งไม่มีคือสิ่งแรกที่
 * บอกว่า "คนละเว็บ" ก่อนจะทันอ่านอะไรอย่างอื่น
 */
function WorkBar({ actor, onSignOut }: { actor: Actor; onSignOut: () => void }) {
  const pathname = usePathname();
  const here = sectionFor(pathname);
  const crumb = here?.label ?? "คลังและต้นทุน";

  useEffect(() => {
    document.title = `${crumb} — TimeOptic`;
  }, [crumb]);

  /* อักษรย่อจากชื่อที่แสดง — ชื่อไทยไม่มีนามสกุลแยกเสมอไป จึงเอาตัวแรกของคำแรก
     ตัวเดียว ไม่ใช่พยายามหาชื่อ-สกุลแบบฝรั่งแล้วได้ตัวอักษรมั่ว ๆ */
  const initial = (actor.displayName ?? "").trim().charAt(0) || "?";

  return (
    <header className="workbar">
      <div className="workbar__crumb">{crumb}</div>
      <div className="workbar__spacer" />
      <div className="whoami">
        <span className="whoami-mark" aria-hidden="true">{initial}</span>
        <span className="whoami-text">
          <b>{actor.displayName}</b>
          <small>{actor.roleText}</small>
        </span>
        <button type="button" className="btn btn--quiet btn--small" onClick={onSignOut} title="ออกจากระบบ">
          ออก
        </button>
      </div>
    </header>
  );
}

/**
 * The standard head of a working surface: title on the left, the page's one
 * primary action on the right. Same place on every page, per design.md.
 */
export function WorkHead({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children?: React.ReactNode;
}) {
  /* แผ่นไอคอนมาจากเมนูของหมวดที่ยืนอยู่ ไม่ใช่จากที่แต่ละหน้าส่งเข้ามา — หน้าไหน
     ลืมส่งก็จะไม่มีไอคอน และไอคอนกับปุ่มเมนูที่ไฮไลต์อยู่ก็จะเป็นคนละตัวได้
     หน้าที่ไม่มีหมวด (ยังไม่เคยเกิด แต่เป็นไปได้) แค่ไม่มีแผ่นไอคอน ไม่พัง */
  const icon = sectionFor(usePathname())?.icon ?? null;

  return (
    <header className="workhead">
      {icon ? <span className="workhead__icon" aria-hidden="true">{icon}</span> : null}
      <div className="workhead__text">
        <h1 className="workhead__title">{title}</h1>
        {lede ? <p className="workhead__lede">{lede}</p> : null}
      </div>
      {children ? <div className="workhead__tools">{children}</div> : null}
    </header>
  );
}
