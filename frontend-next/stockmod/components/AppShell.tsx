"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api, ApiError, type Actor } from "@/stockmod/lib/api";
import { homeFor, isAdminUp, mayUseStock } from "@/lib/roles.js";
import CommandPalette from "./CommandPalette";
import { ToastProvider } from "./Toaster";
import SideRail, { sectionFor } from "./SideRail";

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
 * ทุกอย่างตั้งแต่แอดมินขึ้นไปตอบเหมือนกันหมด — เงินและแคตตาล็อกเป็นสิทธิ์ชุด
 * เดียวกันในฝั่งนี้ · แยกเป็นคนละชื่อไว้เพราะจุดที่เรียกใช้อ่านรู้เรื่องกว่า
 * และวันที่กฎข้อใดข้อหนึ่งแยกออกไป จะแก้ที่เดียวโดยไม่กระทบข้ออื่น
 */
export const can = {
  enterCost: (a: Actor) => isAdminUp(a),
  editCatalog: (a: Actor) => isAdminUp(a),
  /**
   * เพิ่มของที่ยังไม่มีในแคตตาล็อก — ทำได้ทุกบทบาท ต่างจากการแก้และการลบ
   *
   * ของใหม่ถูกค้นพบตอนทำงาน ไม่ใช่ตอนจัดแคตตาล็อก · ฝั่งเซิร์ฟเวอร์ตอบด้วย
   * `Roles::addProduct` ตัวเดียวกัน ที่นี่มีไว้ไม่ให้ปุ่มหายไปจากคนที่กดได้
   */
  addProduct: (_a: Actor) => true,
  manageUsers: (a: Actor) => isAdminUp(a),
  /**
   * Seeing what stock cost us. The API already withholds those numbers from
   * anyone else, so this is not the guard — it is what stops a screen drawing an
   * empty column and an em dash where a staff member would read "ยังไม่มีต้นทุน".
   */
  seeCost: (a: Actor) => isAdminUp(a),
  seeBranchMoney: (a: Actor) => isAdminUp(a),
  manageBranches: (a: Actor) => a.role === "owner" || a.role === "superuser",
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
        /* พนักงานขายเดินมาฝั่งคลังก็ไม่มีอะไรให้ทำ ส่งกลับไปที่ทำงานของเขา */
        if (!mayUseStock(actor)) {
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
          <SideRail actor={actor} />
          <div className="work-area">
            <WorkBar actor={actor} onSignOut={signOut} />
            {children}
          </div>
        </div>
        <CommandPalette />
      </ToastProvider>
    </ActorContext.Provider>
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
          <small>{actor.roleLabel}</small>
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
