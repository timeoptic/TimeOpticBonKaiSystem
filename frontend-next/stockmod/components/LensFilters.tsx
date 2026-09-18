"use client";

import { useRef } from "react";
import { withCount } from "./FilterBar";
import Select from "./Select";
import { qs, useApi } from "@/stockmod/lib/useApi";
import type { LensFacet, LensOptions } from "@/stockmod/lib/api";

/**
 * Narrowing a list of lenses down to the drawer worth walking to.
 *
 * Index / ชนิดเลนส์ / Coating กลับมาเป็นชิป แต่เลือกได้หลายตัวในแถวเดียว ·
 * รอบก่อนเปลี่ยนเป็นดรอปดาวน์เพราะชิปยี่สิบปุ่มกวาดตาอ่านไม่ไหว แต่ดรอปดาวน์
 * ตอบได้ทีละค่า ขณะที่คำถามจริงหน้าร้านคือ "1.56 หรือ 1.60 ก็ได้ ขอ Blue" ·
 * ชิปที่ไม่มีของเลยถูกซ่อน (เว้นตัวที่เลือกอยู่) จึงเหลือแค่ของที่มีจริง ซึ่งสั้น
 * กว่ายี่สิบมาก
 *
 * SPH / CYL / ADD เป็นดรอปดาวน์ค่าเดียว (ร้านขอ 18 ก.ย. 2026 — แบบช่วงตั้งแต่–ถึงใช้ยาก)
 * ค่าสายตามีหลายสิบค่า เป็นชิปไม่ได้ · พิมพ์ค้นในดรอปดาวน์ได้ · ADD โผล่เฉพาะตอนมีเลนส์ที่มี ADD
 *
 * ทุกค่าที่ให้เลือกมาจาก `/lens-options` — สเปกที่แคตตาล็อกมีอยู่จริง นับภายใต้
 * ตัวกรองอื่นที่ใช้อยู่ เลือกผิดจนตารางว่างจึงเป็นสิ่งที่ทำไม่ได้
 *
 * โผล่เฉพาะตอนที่มีเลนส์ให้กรอง — บนรายการกรอบแว่น ช่องพวกนี้กดแล้วไม่มีอะไร
 * เกิดขึ้น ซึ่งแย่กว่าช่องที่ไม่มี
 */

export type LensPick = {
  index: string[];
  design: string[];
  coating: string[];
  sph: string;
  cyl: string;
  add: string;
};

export const NO_LENS: LensPick = {
  index: [], design: [], coating: [], sph: "", cyl: "", add: "",
};

/** หลายค่าในช่องเดียวส่งเป็น `1.56|1.60` — API อ่านแบบ "ตัวไหนก็ได้" */
export const lensParams = (l: LensPick) => ({
  index: l.index.join("|"),
  design: l.design.join("|"),
  coating: l.coating.join("|"),
  // ค่าเดียว = ช่วงที่หัวกับท้ายเป็นค่าเดียวกัน — API ตัวเดิมรับแบบช่วงอยู่แล้ว
  sph_from: l.sph,
  sph_to: l.sph,
  cyl_from: l.cyl,
  cyl_to: l.cyl,
  add_from: l.add,
  add_to: l.add,
});

/** ค่าสายตาอย่างที่เขียนบนซอง — +1.00, 0.00, -2.25 */
const power = (v: string): string => {
  const n = Number(v);
  return n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
};

export default function LensFilters({
  value,
  onChange,
  scope,
}: {
  value: LensPick;
  onChange: (next: LensPick) => void;
  /**
   * The rest of the narrowing the list under these is already under.
   *
   * Without it the counts tally the whole lens catalogue while the table below
   * shows a slice of it, and the two disagree out loud: the withdraw screen
   * lists only stock, both 1.74 lenses in the shop are made to order, and the
   * count read "1.74 · 2" above a table that could never show either of them.
   */
  scope?: { q?: string; eye?: string; make?: string; from?: string; to?: string };
}) {
  // The current choices go too. The API drops a facet's own choice before
  // counting it, so sending them is what makes the *other* rows re-tally —
  // pick Progressive and the index counts become the Progressive ones.
  const options = useApi<LensOptions>(`/lens-options${qs({ ...scope, ...lensParams(value) })}`);

  /* ทุกครั้งที่กดชิป ตัวเลขถูกถามใหม่ · ระหว่างรอ ใช้ชุดเดิมไปก่อน ไม่งั้นทั้งแถว
     หายแล้วโผล่กลับ ตารางข้างล่างกระโดดขึ้นลงทุกครั้งที่กด */
  const last = useRef<LensOptions | null>(null);
  if (options.status === "ready") last.current = options.data;
  const data = last.current;
  if (data === null) return null;

  const { indexes, designs, coatings, sphs = [], cyls = [], adds = [] } = data;

  const toggle = (key: "index" | "design" | "coating", v: string) => {
    const on = value[key];
    onChange({ ...value, [key]: on.includes(v) ? on.filter((x) => x !== v) : [...on, v] });
  };

  /* ค่าที่นับได้ศูนย์และไม่ได้เลือกอยู่ถูกซ่อน · ตัวที่เลือกอยู่ไม่ถูกซ่อนไม่ว่า
     นับได้เท่าไร ไม่งั้นมันจะหายไปทั้งที่ยังกรองอยู่ และกดยกเลิกไม่ได้ */
  const shown = (facets: LensFacet[], chosen: string[]) =>
    facets.filter((f) => f.count > 0 || chosen.includes(f.value));

  const groups = [
    { key: "index" as const, label: "Index", facets: shown(indexes, value.index) },
    { key: "design" as const, label: "ชนิดเลนส์", facets: shown(designs, value.design) },
    { key: "coating" as const, label: "Coating", facets: shown(coatings, value.coating) },
  ].filter((g) => g.facets.length > 0);

  const single = (key: "sph" | "cyl" | "add", label: string, facets: LensFacet[]) => {
    const chosen = value[key];
    // ค่าที่เลือกไว้แต่ไม่อยู่ในลิสต์แล้ว (ตัวกรองอื่นเปลี่ยน) ยังต้องอ่านได้บนหน้าปุ่ม
    const list = chosen && !facets.some((f) => f.value === chosen) ? [...facets, { value: chosen, count: 0 }] : facets;
    if (list.length === 0) return null;
    return (
      <div className="filterbar__item filterbar__item--range">
        <label className="filterbar__label" htmlFor={`lf-${key}`}>{label}</label>
        <span className="lensrange">
          <Select
            id={`lf-${key}`}
            className="input--inline lensrange__end"
            value={chosen}
            onChange={(v) => onChange({ ...value, [key]: v })}
            options={[
              { value: "", label: "ทุกค่า" },
              ...[...list]
                .sort((a, b) => Number(a.value) - Number(b.value))
                .map((f) => ({ value: f.value, label: withCount(power(f.value), f.count) })),
            ]}
            placeholder="ทุกค่า"
          />
        </span>
      </div>
    );
  };

  if (groups.length === 0 && sphs.length === 0 && cyls.length === 0 && adds.length === 0) return null;

  return (
    <>
      {single("sph", "SPH", sphs)}
      {single("cyl", "CYL", cyls)}
      {single("add", "ADD", adds)}
      {groups.length > 0 ? (
        <div className="filterbar__item filterbar__item--chips">
          <div className="chipbar lenschips">
            {groups.map((g, i) => (
              <span key={g.key} className="lenschips__group" role="group" aria-label={g.label}>
                {i > 0 ? <span className="chipbar__sep" aria-hidden="true" /> : null}
                <span className="filterbar__label">{g.label}</span>
                <span className="chips chips--tight">
                  {g.facets.map((f) => {
                    const on = value[g.key].includes(f.value);
                    return (
                      <button
                        key={f.value}
                        type="button"
                        className="chip"
                        aria-pressed={on}
                        onClick={() => toggle(g.key, f.value)}
                        title={withCount(f.value, f.count)}
                      >
                        {f.value}
                        <span className="chip__count">{f.count.toLocaleString("th-TH")}</span>
                      </button>
                    );
                  })}
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
