"use client";

import { useState } from "react";
import { NewOrderDialog } from "@/app/stock/(shell)/rx/page";
import { can, useActor } from "@/stockmod/components/AppShell";
import { sendToParent } from "@/stockmod/lib/embed";

/**
 * "เปิดใบสั่งตัดใหม่" — กล่องตัวเดียวกับหน้า `/stock/rx` ฝังในหน้าร้าน
 *
 * นำเข้ามาจากไฟล์ของหน้านั้นตรง ๆ ไม่ได้คัดลอกมา · ถ้าวันหนึ่งกล่องนั้นเปลี่ยน
 * ที่ฝังในหน้าร้านก็เปลี่ยนตาม ซึ่งเป็นเหตุผลทั้งหมดที่ฝังแทนที่จะเขียนใหม่
 *
 * `mayCost` ยังตัดสินจากคนที่ล็อกอินอยู่เหมือนเดิม — พนักงานขายเปิดใบสั่งได้
 * แต่ไม่เห็นช่องต้นทุนจากผู้ขาย เท่ากับที่เห็นเมื่อเปิดจากหน้าคลัง
 *
 * `lensOnly` — ในหน้าเคสถามแค่เลนส์ที่สั่ง (แบรนด์ รุ่น ชนิดเลนส์) แล้วเปิดใบเลย
 * ไม่มีขั้นค่าสายตาและขั้นใบสั่งและราคา · หน้าคลังยังถามครบสามขั้นเหมือนเดิม
 */
export default function EmbeddedRxOrder() {
  const actor = useActor();

  /* ข้างที่หน้าเคสกำลังสั่งตัดให้ (`?side=r|l`) — ร้านขอไว้ 14 ก.ย. 2026 · เดิมหัวกล่องบอก
     ข้างตาแต่ใบสั่งไม่ได้เก็บ หน้าใบสั่งตัดจึงบอกไม่ได้ว่าเลนส์ใบไหนข้างไหน · อ่านจาก
     location ไม่ใช่ useSearchParams ซึ่งหน้า static export ต้องห่อ Suspense */
  const [eyeSide] = useState<"right" | "left" | null>(() => {
    if (typeof window === "undefined") return null;
    const s = new URLSearchParams(window.location.search).get("side");
    return s === "r" ? "right" : s === "l" ? "left" : null;
  });

  return (
    <NewOrderDialog
      lensOnly
      eyeSide={eyeSide}
      mayCost={can.enterCost(actor)}
      onClose={() => sendToParent({ kind: "cancel" })}
      onSaved={(referenceDoc, awaitingCost, order) =>
        // id กับชื่อเลนส์ส่งไปด้วย — หน้าเคสขึ้นการ์ดว่าสั่งเลนส์อะไร และยกเลิกใบนี้ได้
        sendToParent({
          kind: "rx",
          id: order.id,
          referenceDoc,
          awaitingCost,
          sku: order.sku,
          name: order.name,
        })
      }
    />
  );
}
