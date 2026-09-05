"use client";

import { Filter, withCount } from "./FilterBar";
import { qs, useApi } from "@/stockmod/lib/useApi";
import type { LensOptions } from "@/stockmod/lib/api";

/**
 * Narrowing a list of lenses down to the drawer worth walking to.
 *
 * เคยเป็นชิป และเหตุผลเดิมคือกดครั้งเดียวแล้วเห็นคำตอบโดยไม่ต้องเปิด · พอ
 * แคตตาล็อกโตขึ้นจนมี Index ห้าค่า ชนิดเลนส์หกแบบ Coating ห้าแบบ สามแถวนั้น
 * กลายเป็นยี่สิบปุ่มคาดอยู่เหนือตาราง ซึ่งข้อดีข้อเดิมไม่เหลือ — ของที่เห็นได้
 * โดยไม่ต้องเปิด มีมากเกินกว่าจะกวาดตาอ่าน
 *
 * ดรอปดาวน์แทน และจำนวนของแต่ละค่าย้ายไปต่อท้ายชื่อในบรรทัดของมัน จึงไม่หาย
 *
 * ค่าที่ให้เลือกมาจาก `/lens-options` ของ API — สเปกที่แคตตาล็อกมีอยู่จริง
 * พิมพ์เองไม่ได้ และค่าที่ไม่มีของเลยจะไม่ถูกเสนอ เลือกผิดจนตารางว่างจึงเป็น
 * สิ่งที่ทำไม่ได้ ไม่ใช่สิ่งที่ต้องระวัง
 *
 * โผล่เฉพาะตอนที่มีเลนส์ให้กรอง — บนรายการกรอบแว่น สามช่องนี้คือช่องที่กดแล้ว
 * ไม่มีอะไรเกิดขึ้น ซึ่งแย่กว่าช่องที่ไม่มี
 */
export default function LensFilters({
  index,
  design,
  coating,
  onIndex,
  onDesign,
  onCoating,
  scope,
}: {
  index: string;
  design: string;
  coating: string;
  onIndex: (v: string) => void;
  onDesign: (v: string) => void;
  onCoating: (v: string) => void;
  /**
   * The rest of the narrowing the list under these is already under.
   *
   * Without it the counts tally the whole lens catalogue while the table below
   * shows a slice of it, and the two disagree out loud: the withdraw screen
   * lists only stock, both 1.74 lenses in the shop are made to order, and the
   * count read "1.74 · 2" above a table that could never show either of them.
   */
  scope?: { q?: string; eye?: string; make?: string };
}) {
  // The chosen index and design go too. The API drops a facet's own choice
  // before counting it, so sending them is what makes the *other* lists
  // re-tally — pick Progressive and the index counts become the Progressive
  // ones, rather than staying the counts for every lens in the shop.
  const options = useApi<LensOptions>(
    `/lens-options${qs({ ...scope, index, design, coating })}`,
  );

  if (options.status !== "ready") return null;

  const { indexes, designs, coatings } = options.data;
  if (indexes.length === 0 && designs.length === 0 && coatings.length === 0) return null;

  /**
   * ค่าที่ไม่มีของและไม่ได้ถูกเลือกอยู่ ถูกตัดออกจากลิสต์
   *
   * ชิปตัวเดิมยังวาดไว้แต่กดไม่ได้ เพราะช่องว่างในแถวชิปอ่านเป็นของหาย · ใน
   * ดรอปดาวน์ไม่มีปัญหานั้น บรรทัดที่ไม่มีก็คือไม่มี · ที่เลือกอยู่ไม่ถูกตัด
   * ไม่ว่านับได้เท่าไร ไม่งั้นค่าที่เลือกจะหายจากช่องของตัวเอง
   */
  const list = (
    facets: { value: string; count: number }[],
    chosen: string,
    allLabel: string,
  ) => [
    { value: "", label: allLabel },
    ...facets
      .filter((f) => f.count > 0 || f.value === chosen)
      .map((f) => ({ value: f.value, label: withCount(f.value, f.count) })),
  ];

  return (
    <>
      <Filter
        id="lf-index"
        label="Index"
        value={index}
        onChange={onIndex}
        options={list(indexes, index, "ทุก Index")}
      />
      <Filter
        id="lf-design"
        label="ชนิดเลนส์"
        value={design}
        onChange={onDesign}
        options={list(designs, design, "ทุกชนิดเลนส์")}
      />
      {/* Coating earns a place now that the shop stocks five of them rather
          than the open-ended list it used to be. Ordered by how much of each
          is stocked, not alphabetically: what a shop reaches for first is the
          one it sells most of, and A-to-Z would put Blue above everything. */}
      <Filter
        id="lf-coating"
        label="Coating"
        value={coating}
        onChange={onCoating}
        options={list(coatings, coating, "ทุก Coating")}
      />
    </>
  );
}
