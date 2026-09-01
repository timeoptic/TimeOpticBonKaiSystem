"use client";

import { useEffect, useState } from "react";
import { api, type Actor } from "@/stockmod/lib/api";
import { ActorProvider } from "@/stockmod/components/AppShell";
import { ToastProvider } from "@/stockmod/components/Toaster";

/**
 * หน้าที่ถูกฝังในหน้าร้าน — ฟอร์มของฝั่งคลัง โดยไม่มีเมนูของฝั่งคลัง
 *
 * หน้าร้านอยากได้ป๊อบอัพ "เพิ่มสินค้าเข้าคลัง" กับ "เปิดใบสั่งตัด RX" ตัวเดียว
 * กับที่ฝั่งคลังใช้ ไม่ใช่ของที่หน้าตาคล้ายกัน · เอาคอมโพเนนต์ไปวางในหน้าร้าน
 * ตรง ๆ ไม่ได้ เพราะสองฝั่งตั้งชื่อคลาสชนกันเก้าคลาส (`.btn` `.field` `.modal`
 * …) วางแล้วจะได้สไตล์สองชุดทับกัน ซึ่งเป็นสิ่งที่ทั้งโครงสร้างนี้ออกแบบมาเพื่อกัน
 *
 * ฝังเป็นเอกสารแยกใน iframe แทน — คนละเอกสารคือคนละ CSS โดยโครงสร้าง ไม่ต้อง
 * เชื่อว่าใครจะตั้งชื่อคลาสไม่ชนกัน และฟอร์มที่ได้คือตัวจริง ไฟล์เดียวกับที่
 * `/stock/receive` กับ `/stock/rx` ใช้ แก้ที่เดียวเปลี่ยนทั้งสองที่
 *
 * ผลลัพธ์ส่งกลับหาหน้าแม่ด้วย `postMessage` (ดู `stockmod/lib/embed.ts`)
 *
 * อยู่ใต้ `/stock` จึงได้ CSS ของฝั่งคลังจาก layout ของกลุ่มนั้นมาแล้ว ที่นี่
 * เติมสองอย่างที่ AppShell เคยเติมให้: คนที่ล็อกอินอยู่ กับที่วางข้อความ toast
 */
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  const [actor, setActor] = useState<Actor | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<{ actor: Actor | null }>("/auth/me")
      .then(({ actor }) => {
        if (!alive) return;
        if (actor === null) {
          setProblem("ยังไม่ได้เข้าสู่ระบบ — เปิดหน้าร้านใหม่อีกครั้ง");
          return;
        }
        setActor(actor);
      })
      .catch((e: unknown) => {
        if (alive) setProblem(e instanceof Error ? e.message : "เปิดฟอร์มไม่ได้");
      });
    return () => {
      alive = false;
    };
  }, []);

  if (problem !== null) {
    return <p className="notice notice--error" role="alert">{problem}</p>;
  }
  if (actor === null) {
    return <p className="field__help">กำลังเปิดฟอร์ม…</p>;
  }

  return (
    <ActorProvider actor={actor}>
      {/* พื้นของเอกสารนี้ต้องใส — หน้าที่ฝังเรามีฉากมืดของมันเองอยู่แล้ว ถ้า
          ปล่อยให้ทาสีพื้นจะได้สี่เหลี่ยมสว่างรอบกล่อง เห็นขอบ iframe ชัด ๆ */}
      {/* พื้นของเอกสารนี้ต้องใส และฉากมืดของกล่องก็ต้องดับด้วย
          `<dialog>` ทาฉากมืดของมันเองผ่าน `::backdrop` ซึ่งในเอกสารที่ถูกฝัง
          จะเต็มแค่กรอบ iframe ไม่ใช่เต็มจอ — ได้สี่เหลี่ยมเทาขอบคมรอบกล่อง
          ซ้อนอยู่บนฉากมืดของหน้าแม่อีกที · หน้าแม่มีฉากมืดของมันอยู่แล้ว
          ที่นี่จึงเหลือแค่ตัวกล่อง */}
      {/* `.drawer::backdrop` ไม่ใช่ `dialog::backdrop` — คลาสชนะตัวเลือกธาตุ
          เขียนผิดชั้นแล้วฉากมืดยังอยู่ครบ เห็นเป็นแผ่นเทาเต็มกรอบ iframe */}
      <style>{"body{background:transparent}.drawer::backdrop{background:transparent}"}</style>
      <ToastProvider>{children}</ToastProvider>
    </ActorProvider>
  );
}
