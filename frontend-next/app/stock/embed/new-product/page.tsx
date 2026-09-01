"use client";

import { useSearchParams } from "next/navigation";
import ProductForm from "@/stockmod/components/ProductForm";
import { sendToParent } from "@/stockmod/lib/embed";

/**
 * "เพิ่มสินค้าใหม่แล้วรับเข้าเลย" — ฟอร์มตัวเดียวกับหน้ารับของ ฝังในหน้าร้าน
 *
 * `receive` เปิดไว้ ฟอร์มจึงถามล็อตแรกในขั้นสุดท้ายเหมือนที่ `/stock/receive`
 * ทำ · หน้าร้านส่ง `?type=Lens` มาเมื่อรู้อยู่แล้วว่ากำลังเพิ่มอะไร ฟอร์มจะข้าม
 * ขั้นเลือกชนิดให้
 *
 * ไม่มีกรอบ dialog ครอบ เพราะตัว iframe เองคือกรอบอยู่แล้ว — ซ้อนอีกชั้นจะได้
 * เงาสองชั้นกับที่ว่างรอบสองรอบ
 */
export default function EmbeddedNewProduct() {
  const type = useSearchParams().get("type") ?? undefined;

  return (
    <main className="embed-page">
      <ProductForm
        receive
        make="stock"
        presetType={type}
        /* ส่งกลับแค่ id ของสินค้า — ฟอร์มคืนเลขล็อตมาเป็นชื่อ (`lotNumber`)
           ไม่ใช่ id และหน้าร้านต้องการแถวแบบเดียวกับที่ช่องค้นหาใช้อยู่แล้ว
           หน้าแม่จึงไปอ่านเองจาก /api/stock ตามสินค้าตัวนั้น */
        onSaved={(id) => sendToParent({ kind: "product", productId: id, lotId: null })}
        onUseExisting={(id) => sendToParent({ kind: "product", productId: id, lotId: null })}
        onCancel={() => sendToParent({ kind: "cancel" })}
      />
    </main>
  );
}
