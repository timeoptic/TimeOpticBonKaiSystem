"use client";

import { useState } from "react";
import Select from "./Select";

export type Dir = "asc" | "desc";

/**
 * A column header that sorts.
 *
 * `aria-sort` on the `<th>` is what makes this a sortable table to a screen
 * reader rather than a row of unexplained buttons; the arrow says the same thing
 * to everyone else. Both are needed — neither is decoration for the other.
 */
export default function SortHead<K extends string>({
  label,
  col,
  sort,
  dir,
  onSort,
  num = false,
}: {
  label: string;
  col: K;
  sort: K;
  dir: Dir;
  onSort: (c: K) => void;
  /** Right-aligned, for a column of figures. */
  num?: boolean;
}) {
  const active = sort === col;

  return (
    <th
      scope="col"
      className={num ? "grid__num" : undefined}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className="sorthead"
        onClick={() => onSort(col)}
        title={`เรียงตาม${label}`}
      >
        {label}
        <span className="sorthead__arrow" aria-hidden="true">
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

/**
 * The same sort, said out loud in the toolbar.
 *
 * The arrows on the column headers are discoverable only by someone who already
 * suspects the table sorts — on a tablet there is no hover to reveal them, and
 * next to a row of filter chips they read as decoration. This names the choice
 * where the other list controls live: what it is sorted by, and which way.
 *
 * It drives the very same `useSort` state as the headers, so the two can never
 * disagree — clicking "ชนิด" here lights up the ชนิด header, and vice versa.
 */
export function SortBar<K extends string>({
  id,
  columns,
  sort,
  dir,
  onSort,
  dirToggle = true,
}: {
  /** Prefix for the field ids, so two lists on one page keep distinct labels. */
  id: string;
  columns: readonly { col: K; label: string }[];
  sort: K;
  dir: Dir;
  onSort: (c: K) => void;
  /**
   * ปุ่มกลับด้านการเรียง — ปิดได้สำหรับหน้าที่หัวตารางกดเรียงได้อยู่แล้ว
   *
   * หัวคอลัมน์ที่กดซ้ำก็กลับด้านเหมือนกัน ปุ่มนี้จึงเป็นทางที่สองไปหาสิ่งเดียวกัน
   * และมันนั่งอยู่บนแถบที่ควรตอบคำถามเดียวว่า "เรียงตามอะไร" · หน้าที่ไม่มีหัว
   * ตารางให้กดยังต้องมีมัน ค่าปริยายจึงยังเป็นเปิด
   */
  dirToggle?: boolean;
}) {
  return (
    <div className="sortbar">
      <label className="sortbar__label" htmlFor={`${id}-sort`}>
        เรียงตาม
      </label>
      <Select
        id={`${id}-sort`}
        className="sortbar__pick"
        value={sort}
        onChange={(v) => onSort(v as K)}
        options={columns.map((c) => ({ value: c.col, label: c.label }))}
      />
      {/* Re-picking the column that is already chosen is what flips direction,
          which is the rule the headers follow too. */}
      {dirToggle ? (
        <button
          type="button"
          className="chip sortbar__dir"
          onClick={() => onSort(sort)}
          aria-label={dir === "asc" ? "เรียงจากน้อยไปมาก — กดเพื่อกลับด้าน" : "เรียงจากมากไปน้อย — กดเพื่อกลับด้าน"}
        >
          {/* ลูกศรกับคำอยู่คนละ span เพราะบางที่มีที่ให้แค่ลูกศร — ป้ายเต็มยัง
              อยู่ใน aria-label เสมอ คนที่ฟังจึงได้ยินเท่าเดิมทุกที่ */}
          {dir === "asc" ? "▲" : "▼"}
          <span className="sortbar__dirtext">{dir === "asc" ? "น้อย → มาก" : "มาก → น้อย"}</span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * The sort state every list screen keeps, and the one rule they all share:
 * clicking the active column flips direction, clicking a new one starts it at
 * the direction that column is usually wanted in.
 *
 * `naturalAsc` names the columns that read best ascending — words and dates.
 * Everything else starts descending, because a figure is nearly always sorted to
 * find the largest of something.
 */
export function useSort<K extends string>(initial: K, naturalAsc: readonly K[]) {
  const dirFor = (k: K): Dir => (naturalAsc.includes(k) ? "asc" : "desc");

  const [sort, setSort] = useState<K>(initial);
  const [dir, setDir] = useState<Dir>(dirFor(initial));

  function sortBy(next: K, after?: () => void) {
    if (next === sort) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(next);
      setDir(dirFor(next));
    }
    after?.();
  }

  return { sort, dir, sortBy };
}

/**
 * Sorts rows in the browser.
 *
 * For the short lists that arrive whole — branches, people — where paging the
 * server would be building for a table that will never have thirty rows in it.
 * Anything that is paged must sort on the server instead, or a "sort" would only
 * reorder the page you happen to be looking at.
 */
export function sortRows<T>(
  rows: T[],
  value: (r: T) => string | number | null,
  dir: Dir,
): T[] {
  const sign = dir === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);

    // Nulls sort last whichever way the column is pointing — "no answer" is not
    // a small value, and letting it lead the list buries the real rows.
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;

    if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
    return String(x).localeCompare(String(y), "th") * sign;
  });
}
