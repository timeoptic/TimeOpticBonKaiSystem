"use client";

import type { ProductRow } from "@/lib/api";
import { diopter } from "@/lib/format";

/**
 * Just the lens keys, so this takes a catalogue row and an opened product alike
 * without either having to be the other.
 */
type LensBearing = Pick<
  ProductRow,
  "lensIndex" | "lensDesign" | "coating" | "eyeSide" | "sph" | "cyl" | "axis" | "add"
>;

/** One lens attribute, or nothing if this product never had it filled in. */
type Fact = { label: string; value: string };

/**
 * Everything recorded about a lens, each figure said by its own name.
 *
 * The two lens columns in the tables are for telling one row from forty others.
 * This is the other job: the product is already chosen, and the only question
 * left is "is this the right lens" — asked against a job sheet that names the
 * values, so the answer has to name them too. `SPH −4.50` can be checked against
 * a job sheet; `−4.50` has to be counted into position first.
 *
 * Nothing is invented for a key that was never filled in — a lens with no
 * recorded CYL is not a lens with no cylinder, so the pair is simply absent
 * rather than drawn as a dash. Powers are checked for being numbers rather than
 * for being non-null: a key the API leaves out entirely must read as missing,
 * not as a plano lens.
 *
 * Returns null for anything that is not a lens, so a caller can drop the whole
 * block rather than framing an empty one.
 */
export default function LensDetail({ row }: { row: LensBearing }) {
  const facts: Fact[] = [];

  const add = (label: string, value: string | null) => {
    if (value) facts.push({ label, value });
  };

  const power = (v: number | null) => (typeof v === "number" ? diopter(v) : null);

  add("Index", row.lensIndex);
  add("ชนิดเลนส์", row.lensDesign);
  add("Coating", row.coating);
  add(
    "ข้างตา",
    row.eyeSide === "left" ? "L · ตาซ้าย" : row.eyeSide === "right" ? "R · ตาขวา" : null,
  );
  // The powers, written the way the job sheet writes them — always signed,
  // because +1.50 and −1.50 are different lenses.
  add("SPH", power(row.sph));
  add("CYL", power(row.cyl));
  add("AXIS", typeof row.axis === "number" ? String(row.axis) : null);
  add("ADD", row.add);

  if (facts.length === 0) return null;

  return (
    <dl className="lensfacts">
      {facts.map((f) => (
        <div key={f.label} className="lensfacts__item">
          <dt className="lensfacts__label">{f.label}</dt>
          <dd className="lensfacts__value">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
