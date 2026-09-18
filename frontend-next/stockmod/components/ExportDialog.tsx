"use client";

import { useState } from "react";
import TaskDialog from "./TaskDialog";
import DateRangeField from "./DateRangeField";
import { useToast } from "./Toaster";
import { download, type Sheet } from "@/stockmod/lib/workbook";
import { api } from "@/stockmod/lib/api";
import { count } from "@/stockmod/lib/format";

export type Range = { from: string; to: string };

/** หนึ่งบรรทัดของ /report/lines */
export type Line = {
  kind: "IN" | "OUT" | "SCRAP";
  at: string;
  doc: string | null;
  branch: string | null;
  sku: string | null;
  name: string | null;
  lot: string | null;
  expiry: string | null;
  supplier: string | null;
  qty: number;
  unitCost: number | null;
  total: number | null;
  who: string | null;
  keyedBy: string | null;
  note: string | null;
};

export type SheetChoice = { name: string; hint: string };

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthStart = () => {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth(), 1));
};

/**
 * ปุ่ม Export ของหน้าคลัง — ร้านขอ 18 ก.ย. 2026 ("ปุ่ม export ทุกหน้า เลือกวันได้ แยกตามออเดอร์และสาขา")
 *
 * กล่องเดียวใช้ทุกหน้า: เลือกช่วงวัน (ปฏิทินตัวเดียวกับหน้าอื่น) ติ๊กชีตที่ต้องการ แล้วสร้างไฟล์ในเบราว์เซอร์ ·
 * แต่ละหน้าบอกแค่ว่ามีชีตอะไร และประกอบชีตจากช่วงวันอย่างไร (`build`)
 */
export default function ExportDialog({
  title,
  file,
  sheets,
  build,
  onClose,
}: {
  /** หัวไฟล์ เช่น "เบิก / ตัดสต็อก" */
  title: string;
  /** ชื่อไฟล์ส่วนหน้า เช่น "timeoptic-เบิก" */
  file: string;
  sheets: SheetChoice[];
  build: (range: Range, chosen: string[], say: (s: string) => void) => Promise<Sheet[]>;
  onClose: () => void;
}) {
  const toast = useToast();
  const [range, setRange] = useState<Range>({ from: monthStart(), to: iso(new Date()) });
  const [chosen, setChosen] = useState<string[]>(sheets.map((s) => s.name));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setProblem(null);
    try {
      const book = (await build(range, chosen, setStatus)).filter((s) => chosen.includes(s.name) && s.rows.length > 0);
      if (book.length === 0) {
        setProblem(`ชีตที่เลือกไม่มีรายการใน ${range.from} ถึง ${range.to} — ลองขยายช่วงวัน`);
        return;
      }
      setStatus("กำลังเขียนไฟล์…");
      await download(`${file}-${range.from}-ถึง-${range.to}.xlsx`, `${title} ${range.from} ถึง ${range.to}`, book);
      toast.success({ text: "สร้างไฟล์ Excel แล้ว", detail: `${count(book.length)} ชีต` });
      onClose();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "สร้างไฟล์ไม่สำเร็จ");
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <TaskDialog eyebrow="Export Excel" title={title} onClose={onClose}>
      <div className="field">
        <span className="field__label">ช่วงวันที่</span>
        <DateRangeField from={range.from} to={range.to} onApply={setRange} disabled={busy} />
      </div>
      <div className="field">
        <span className="field__label">ชีตในไฟล์</span>
        {/* กล่องติ๊กแบบเดียวกับ Export ของแดชบอร์ด */}
        <div className="sheetpick">
          <ul className="sheetpick__list">
            {sheets.map((s) => {
              const on = chosen.includes(s.name);
              return (
                <li key={s.name}>
                  <label className="sheetpick__row">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={busy}
                      onChange={() =>
                        setChosen((c) => (on ? c.filter((x) => x !== s.name) : [...c, s.name]))
                      }
                    />
                    <span>
                      <span className="sheetpick__name">{s.name}</span>
                      <span className="sheetpick__hint">{s.hint}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      {status ? <p className="field__help">{status}</p> : null}
      {problem ? (
        <div className="notice notice--error" role="alert">
          {problem}
        </div>
      ) : null}
      <div className="chips">
        <button type="button" className="btn btn--primary" onClick={() => void run()} disabled={busy || chosen.length === 0}>
          {busy ? "กำลังสร้างไฟล์…" : `สร้างไฟล์ · ${count(chosen.length)} ชีต`}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onClose} disabled={busy}>
          ปิด
        </button>
      </div>
    </TaskDialog>
  );
}

/* ------------------------------------------------------------ ของใช้ร่วม */

/** รายการรับเข้า / จ่ายออก / ของเสีย ทีละบรรทัดในช่วงวัน */
export async function fetchLines(range: Range): Promise<Line[]> {
  const q = new URLSearchParams({ from: range.from, to: range.to });
  return (await api.get<{ rows: Line[] }>(`/report/lines?${q}`)).rows;
}

/** ดึงทุกหน้าของรายการที่แบ่งหน้า (ครั้งละ 100) — `path` รับเลขหน้า */
export async function fetchAll<T>(
  path: (page: number) => string,
  say: (s: string) => void,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 200; page++) {
    const r = await api.get<{ rows: T[]; total: number }>(path(page));
    out.push(...r.rows);
    say(`กำลังดึงข้อมูล ${count(out.length)} / ${count(r.total)}`);
    if (r.rows.length === 0 || out.length >= r.total) break;
  }
  return out;
}

export const orderOf = (l: { doc: string | null; branch: string | null }) =>
  l.doc ?? (l.branch ? `สาขา ${l.branch}` : "ไม่ระบุเอกสาร");
export const branchOf = (b: string | null) => b ?? "TimeOptic (ร้าน)";
export const when = (s: string) => new Date(s.replace(" ", "T"));
const th = (a: string, b: string) => a.localeCompare(b, "th");

/** จ่ายออก / ตัดเสีย ทีละบรรทัด จัดกลุ่มตาม key (ออเดอร์ หรือ สาขา) มียอดรวมย่อยทุกกลุ่ม */
export function outSheet(name: string, note: string, lines: Line[], key: (l: Line) => string, money: boolean): Sheet {
  const cost = (v: number | null) => (money ? v : null);
  const rows = lines
    .filter((l) => l.kind !== "IN")
    .sort((a, b) => th(key(a), key(b)) || a.at.localeCompare(b.at));
  return {
    name,
    note,
    groupBy: 0,
    columns: [
      { header: name.includes("สาขา") ? "สาขา" : "ออเดอร์ / เอกสาร", width: 22 },
      { header: name.includes("สาขา") ? "ออเดอร์ / เอกสาร" : "สาขา", width: 20 },
      { header: "วันที่", width: 18, format: "dd/mm/yyyy hh:mm" },
      { header: "รายการ", width: 10 },
      { header: "SKU", width: 12 },
      { header: "สินค้า", width: 40 },
      { header: "ล็อต", width: 14 },
      { header: "จำนวน", total: true },
      { header: "ทุน/ชิ้น", money: true },
      { header: "รวมทุน", money: true, total: true },
      { header: "ผู้เบิก / คนทำเสีย", width: 18 },
      { header: "หมายเหตุ", width: 36 },
    ],
    rows: rows.map((l) => [
      key(l),
      name.includes("สาขา") ? orderOf(l) : branchOf(l.branch),
      when(l.at),
      l.kind === "SCRAP" ? "ตัดเสีย" : "จ่ายออก",
      l.sku,
      l.name,
      l.lot,
      l.qty,
      cost(l.unitCost),
      cost(l.total),
      l.who,
      l.note,
    ]),
  };
}

/** รับเข้าทีละล็อต จัดกลุ่มตามวัน */
export function inSheet(lines: Line[], money: boolean): Sheet {
  const cost = (v: number | null) => (money ? v : null);
  return {
    name: "รับเข้ารายวัน",
    note: "ทุกล็อตที่รับเข้าในช่วงนี้ มียอดรวมย่อยทุกวัน",
    groupBy: 0,
    columns: [
      { header: "วันที่", width: 12 },
      { header: "เวลา", width: 8 },
      { header: "เลขที่บิล / เอกสาร", width: 20 },
      { header: "SKU", width: 12 },
      { header: "สินค้า", width: 40 },
      { header: "ล็อต", width: 14 },
      { header: "หมดอายุ", width: 12 },
      { header: "ผู้ขาย", width: 18 },
      { header: "จำนวน", total: true },
      { header: "ทุน/ชิ้น", money: true },
      { header: "รวมทุน", money: true, total: true },
      { header: "หมายเหตุ", width: 28 },
      { header: "ผู้บันทึก", width: 14 },
    ],
    rows: lines
      .filter((l) => l.kind === "IN")
      .map((l) => [
        l.at.slice(0, 10),
        l.at.slice(11, 16),
        l.doc,
        l.sku,
        l.name,
        l.lot,
        l.expiry,
        l.supplier,
        l.qty,
        cost(l.unitCost),
        cost(l.total),
        l.note,
        l.keyedBy,
      ]),
  };
}
