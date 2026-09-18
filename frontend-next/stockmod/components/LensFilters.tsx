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
 * SPH / CYL เป็นดรอปดาวน์ช่วง "ตั้งแต่–ถึง" — ค่าสายตามีหลายสิบค่า เป็นชิปไม่ได้
 * และคนถือค่าที่วัดมาแล้วอยากได้ "แถว ๆ นี้" มากกว่าค่าเดียวเป๊ะ
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
  sphFrom: string;
  sphTo: string;
  cylFrom: string;
  cylTo: string;
};

export const NO_LENS: LensPick = {
  index: [], design: [], coating: [], sphFrom: "", sphTo: "", cylFrom: "", cylTo: "",
};

/** หลายค่าในช่องเดียวส่งเป็น `1.56|1.60` — API อ่านแบบ "ตัวไหนก็ได้" */
export const lensParams = (l: LensPick) => ({
  index: l.index.join("|"),
  design: l.design.join("|"),
  coating: l.coating.join("|"),
  sph_from: l.sphFrom,
  sph_to: l.sphTo,
  cyl_from: l.cylFrom,
  cyl_to: l.cylTo,
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

  const { indexes, designs, coatings, sphs = [], cyls = [] } = data;

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

  const range = (
    key: "sph" | "cyl",
    label: string,
    facets: LensFacet[],
  ) => {
    const from = key === "sph" ? "sphFrom" : "cylFrom";
    const to = key === "sph" ? "sphTo" : "cylTo";
    // ค่าที่เลือกไว้แต่ไม่มีในลิสต์แล้ว (ตัวกรองอื่นเปลี่ยน) ยังต้องอ่านได้บนหน้าปุ่ม
    const values = [...new Set([...facets.map((f) => f.value), value[from], value[to]].filter(Boolean))]
      .sort((a, b) => Number(a) - Number(b));
    if (values.length === 0) return null;
    const choices = (all: string) => [
      { value: "", label: all },
      ...values.map((v) => ({ value: v, label: power(v) })),
    ];
    return (
      <div className="filterbar__item filterbar__item--range">
        <span className="filterbar__label" id={`lf-${key}`}>{label}</span>
        <span className="lensrange" role="group" aria-labelledby={`lf-${key}`}>
          <Select
            className="input--inline lensrange__end"
            value={value[from]}
            onChange={(v) => onChange({ ...value, [from]: v })}
            options={choices("ตั้งแต่")}
            placeholder="ตั้งแต่"
          />
          <span aria-hidden="true">–</span>
          <Select
            className="input--inline lensrange__end"
            value={value[to]}
            onChange={(v) => onChange({ ...value, [to]: v })}
            options={choices("ถึง")}
            placeholder="ถึง"
          />
        </span>
      </div>
    );
  };

  if (groups.length === 0 && sphs.length === 0 && cyls.length === 0) return null;

  return (
    <>
      {range("sph", "SPH", sphs)}
      {range("cyl", "CYL", cyls)}
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
