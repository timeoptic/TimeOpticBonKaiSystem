"use client";

import ProductsScreen from "@/stockmod/screens/ProductsScreen";

/** แคตตาล็อกกับสต็อกทั้งร้าน — หน้าจอตัวจริงอยู่ใน `stockmod/screens` เพราะหน้า
 *  "สินค้ารอสั่ง" ใช้หน้าจอเดียวกันนี้ โดยล็อกตัวกรองไว้ที่ของที่ยอดติดลบ */
export default function ProductsPage() {
  return <ProductsScreen bill />;
}
