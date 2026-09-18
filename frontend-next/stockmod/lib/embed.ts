/**
 * ข้อความที่หน้าฝังส่งกลับไปหาหน้าที่ฝังมัน
 *
 * หน้าร้านเปิดฟอร์มของฝั่งคลังใน iframe (ดู `app/stock/embed/layout.tsx`) แล้ว
 * รอฟังผลทางนี้ · ส่งกลับเฉพาะสิ่งที่หน้าแม่ต้องใช้ต่อจริง ๆ — เลขล็อตที่เพิ่ง
 * สร้าง หรือใบสั่งที่เพิ่งเปิด — ไม่ใช่ทั้งฟอร์ม
 *
 * `targetOrigin` เป็น origin ของตัวเองเสมอ ไม่ใช่ `"*"` — สองฝั่งอยู่โดเมน
 * เดียวกัน การส่งแบบเปิดกว้างจึงไม่ได้อะไรเพิ่ม นอกจากทำให้หน้าอื่นที่บังเอิญ
 * ฝังเราอยู่อ่านได้ด้วย
 */

export const EMBED_MESSAGE = "timeoptic:embed";

export type EmbedResult =
  | { kind: "product"; productId: number; lotId: number | null }
  | { kind: "rx"; id: number; referenceDoc: string; awaitingCost: boolean; sku: string; name: string }
  | { kind: "cancel" };

export function sendToParent(result: EmbedResult): void {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage({ type: EMBED_MESSAGE, result }, window.location.origin);
}
