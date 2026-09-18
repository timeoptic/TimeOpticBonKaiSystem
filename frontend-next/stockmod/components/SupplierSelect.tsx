"use client";

import Select from "./Select";
import { api } from "@/stockmod/lib/api";

type Supplier = { id: number; name: string };

/**
 * ช่องผู้ขายที่พิมพ์ชื่อใหม่ได้ — ร้านขอ 18 ก.ย. 2026 ("ดรอปดาวน์ผู้ขายพิมพ์เพื่อเพิ่มไม่ได้")
 *
 * ค่าที่ส่งออกยังเป็นแบบเดิมของฟอร์ม: "" = ไม่ระบุ · "12" = id ผู้ขายที่มีอยู่ · ชื่อที่ยังไม่มี
 * ส่งเป็น "new:ชื่อ" แล้วค่อยสร้างตอนกดบันทึก (supplierIdOf) — สร้างทุกตัวอักษรที่พิมพ์คือ
 * ผู้ขายชื่อ "ส" "สห" "สหม" ค้างเต็มตาราง · พิมพ์ตรงกับชื่อที่มีอยู่ (ไม่สนตัวพิมพ์) ได้ id เดิม
 */
export default function SupplierSelect({
  id,
  value,
  onChange,
  suppliers,
  disabled = false,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  suppliers: Supplier[];
  disabled?: boolean;
}) {
  const text = value.startsWith("new:")
    ? value.slice(4)
    : (suppliers.find((s) => String(s.id) === value)?.name ?? "");

  return (
    <Select
      id={id}
      free
      value={text}
      onChange={(t) => {
        const name = t.trim();
        if (name === "") return onChange("");
        const hit = suppliers.find((s) => s.name.trim().toLowerCase() === name.toLowerCase());
        onChange(hit ? String(hit.id) : `new:${t}`);
      }}
      disabled={disabled}
      placeholder="ไม่ระบุ — พิมพ์ชื่อใหม่ได้"
      options={suppliers.map((s) => ({ value: s.name, label: s.name }))}
    />
  );
}

/** ค่าจากช่องผู้ขาย → supplier_id ที่ส่งให้ API · ชื่อใหม่ถูกสร้างตรงนี้ (มีอยู่แล้วได้ตัวเดิม) */
export async function supplierIdOf(value: string): Promise<number | null> {
  if (value === "") return null;
  if (!value.startsWith("new:")) return Number(value);
  const name = value.slice(4).trim();
  if (name === "") return null;
  const { supplier } = await api.post<{ supplier: { id: number } }>("/suppliers", { name });
  return supplier.id;
}
