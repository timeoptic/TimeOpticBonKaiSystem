"use client";

import Select, { type Choice } from "./Select";

/**
 * แถวของตัวกรอง — ดรอปดาวน์เรียงกัน แทนชิปที่เคยเรียงยาวจนล้นบรรทัด
 *
 * เดิมทุกตัวเลือกเป็นชิป และเหตุผลของมันยังถูกอยู่ในวันที่มีสี่ตัวเลือก: กดครั้ง
 * เดียว และเห็นคำตอบโดยไม่ต้องเปิดอะไร · แต่พอมีสถานะหก ชนิดสินค้าหก Index ห้า
 * ชนิดเลนส์หก Coating ห้า มันกลายเป็นสามสิบปุ่มพาดหน้าจอก่อนถึงสินค้าแถวแรก
 * ซึ่งข้อดีข้อเดิมไม่เหลือแล้ว — สิ่งที่เห็นโดยไม่ต้องเปิดมีมากเกินกว่าจะอ่าน
 *
 * ดรอปดาวน์คืนพื้นที่นั้นมา และตัวที่เลือกอยู่ยังอ่านได้จากหน้าปุ่มเหมือนเดิม
 * จำนวนที่เคยอยู่บนชิปย้ายไปอยู่ในป้ายของแต่ละบรรทัด จึงไม่หายไปไหน
 *
 * ตัวกรองที่ยังไม่มีอะไรให้เลือกจะไม่ถูกวาด — ช่องที่กดแล้วไม่มีอะไรเกิดขึ้น
 * แย่กว่าช่องที่ไม่มี เพราะมันชวนให้กด
 */
export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="filterbar">{children}</div>;
}

/**
 * ตัวกรองหนึ่งช่อง พร้อมป้ายกำกับที่อ่านได้ตอนยังไม่เปิด
 *
 * ป้ายอยู่เหนือช่อง ไม่ได้อยู่ในช่อง — ป้ายที่เป็น placeholder จะหายไปทันทีที่
 * เลือกอะไรสักอย่าง แล้วแถวที่มีดรอปดาวน์ห้าช่องจะกลายเป็นค่าห้าค่าที่ไม่มีใคร
 * บอกว่าค่าไหนคือเรื่องอะไร
 */
export function Filter({
  id,
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly Choice[];
  disabled?: boolean;
}) {
  if (options.length <= 1) return null;

  return (
    <div className="filterbar__item">
      <label className="filterbar__label" htmlFor={id}>
        {label}
      </label>
      <Select
        id={id}
        className="input--inline"
        value={value}
        onChange={onChange}
        options={options}
        disabled={disabled}
      />
    </div>
  );
}

/**
 * ป้ายของหนึ่งบรรทัดในดรอปดาวน์ พร้อมจำนวน
 *
 * จำนวนเคยอยู่บนชิปเป็นตัวเลขเล็ก ๆ ข้างชื่อ · ในดรอปดาวน์ไม่มีที่ให้วางแบบนั้น
 * จึงต่อท้ายด้วยจุดกลางเหมือนที่หน้าอื่นต่อข้อมูลรอง — ศูนย์ยังเขียนว่าศูนย์
 * เพราะ "ไม่มี" เป็นคำตอบ ไม่ใช่ช่องว่าง
 */
export const withCount = (label: string, n: number | undefined): string =>
  n === undefined ? label : `${label} · ${n.toLocaleString("th-TH")}`;
