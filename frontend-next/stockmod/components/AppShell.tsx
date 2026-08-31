"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type Actor } from "@/stockmod/lib/api";
import CommandPalette from "./CommandPalette";
import { ToastProvider } from "./Toaster";
import SideRail from "./SideRail";

const ActorContext = createContext<Actor | null>(null);

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

export const can = {
  enterCost: (a: Actor) => a.role === "owner" || a.role === "accountant",
  editCatalog: (a: Actor) => a.role === "owner" || a.role === "accountant",
  manageUsers: (a: Actor) => a.role === "owner",
  /**
   * Seeing what stock cost us. The API already withholds those numbers from
   * anyone else, so this is not the guard — it is what stops a screen drawing an
   * empty column and an em dash where a staff member would read "ยังไม่มีต้นทุน".
   */
  seeCost: (a: Actor) => a.role === "owner" || a.role === "accountant",
  seeBranchMoney: (a: Actor) => a.role === "owner" || a.role === "accountant",
};

/**
 * Workbench shell — permanent rail on the left, working surface on the right.
 *
 * The session lives in a cookie the PHP API owns, so the browser is the only
 * thing that can ask who is signed in. Every screen renders inside this, which
 * means the answer is fetched once per navigation rather than once per screen.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [actor, setActor] = useState<Actor | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let alive = true;

    api
      .get<{ actor: Actor | null }>("/auth/me")
      .then(({ actor }) => {
        if (!alive) return;
        if (actor === null) {
          router.replace("/stock/login");
          return;
        }
        setActor(actor);
        setState("ready");
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (ApiError.is(e) && e.isAuth) {
          router.replace("/stock/login");
          return;
        }
        setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาดที่ไม่รู้จัก");
        setState("error");
      });

    return () => {
      alive = false;
    };
  }, [router]);

  async function signOut() {
    try {
      await api.post("/auth/logout");
    } finally {
      router.replace("/stock/login");
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
          <SideRail actor={actor} onSignOut={signOut} />
          <div className="work-area">{children}</div>
        </div>
        <CommandPalette />
      </ToastProvider>
    </ActorContext.Provider>
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
  return (
    <header className="workhead">
      <div className="workhead__text">
        <h1 className="workhead__title">{title}</h1>
        {lede ? <p className="workhead__lede">{lede}</p> : null}
      </div>
      {children ? <div className="workhead__tools">{children}</div> : null}
    </header>
  );
}
