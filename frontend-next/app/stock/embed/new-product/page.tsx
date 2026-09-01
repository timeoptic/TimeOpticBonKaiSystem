"use client";

import { useSearchParams } from "next/navigation";
import NewProductDialog from "@/stockmod/components/NewProductDialog";
import { sendToParent } from "@/stockmod/lib/embed";

/**
 * "เพิ่มสินค้าใหม่แล้วรับเข้าเลย" — กล่องตัวเดียวกับหน้ารับของ ฝังในหน้าร้าน
 *
 * ใช้ `NewProductDialog` ทั้งกล่อง ไม่ใช่แค่ `ProductForm` ข้างใน · รอบแรกผม
 * ใส่แต่ฟอร์ม หัวเรื่องกับปุ่มท้ายกล่องเลยไม่มีกรอบให้ยึด ชิ้นส่วนหลุดลอยออกมา
 * นอกการ์ด — กรอบนั้นคือส่วนหนึ่งของกล่อง ไม่ใช่ของตกแต่งที่ตัดทิ้งได้
 *
 * `receive` เปิดไว้ กล่องจึงถามล็อตแรกในขั้นสุดท้ายเหมือนที่ `/stock/receive`
 * ทำ · หน้าร้านส่ง `?type=Lens` มาเมื่อรู้อยู่แล้วว่ากำลังเพิ่มอะไร
 */
export default function EmbeddedNewProduct() {
  const type = useSearchParams().get("type") ?? undefined;

  return (
    <NewProductDialog
      receive
      make="stock"
      presetType={type}
      /* หน้าร้านเริ่มที่ศูนย์ — สินค้าใหม่ที่นี่เกิดตอนลูกค้าสั่งของที่ร้านยังไม่มี
         ของยังไม่มาถึง ตั้งต้นเป็นหนึ่งจะกลายเป็นของบนชั้นที่ไม่มีอยู่จริง แล้ว
         ตัดขายจบที่ศูนย์แทนที่จะติดลบไปขึ้นหน้า "สินค้ารอสั่ง" · พิมพ์ทับได้
         ถ้าของอยู่ตรงหน้าจริง */
      initialQty="0"
      askQty={false}
      title="เพิ่มสินค้าใหม่แล้วรับเข้าเลย"
      onClose={() => sendToParent({ kind: "cancel" })}
      /* ส่งกลับแค่ id ของสินค้า — กล่องคืนเลขล็อตมาเป็นชื่อ ไม่ใช่ id และหน้าร้าน
         ต้องการแถวแบบเดียวกับที่ช่องค้นหาใช้ จึงไปอ่านเองจาก /api/stock */
      onSaved={(id) => sendToParent({ kind: "product", productId: id, lotId: null })}
      onUseExisting={(id) => sendToParent({ kind: "product", productId: id, lotId: null })}
    />
  );
}
