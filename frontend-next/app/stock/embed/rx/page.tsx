"use client";

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
 */
export default function EmbeddedRxOrder() {
  const actor = useActor();

  return (
    <NewOrderDialog
      mayCost={can.enterCost(actor)}
      onClose={() => sendToParent({ kind: "cancel" })}
      onSaved={(referenceDoc, awaitingCost) =>
        sendToParent({ kind: "rx", referenceDoc, awaitingCost })
      }
    />
  );
}
