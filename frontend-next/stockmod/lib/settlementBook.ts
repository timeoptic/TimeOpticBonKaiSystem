import type { SettlementRow } from "./api";
import type { Cell, Column, Sheet } from "./workbook";

/**
 * หน้า "การเบิกจากสาขา" ลงเป็นไฟล์ Excel — สรุปสาขาละแถว กับรายการเบิกทีละใบ
 *
 * ร้านขอไว้ 12 ก.ย. 2026: ส่งให้สาขาดูว่าเบิกอะไรไป ต้องมีชื่อเลนส์ หมายเหตุ (เลขบิลที่
 * พนักงานพิมพ์ไว้ตอนเบิก) และสาขาที่เบิก · แถวมาจาก `/settlements?all=1` ด้วยตัวกรอง
 * ชุดเดียวกับที่หน้าจอใช้ ไฟล์จึงเป็นของก้อนเดียวกับที่ตาเห็น แค่ไม่ถูกตัดเป็นหน้า
 *
 * ที่นี่แปลงแถวเป็นชีตอย่างเดียว ไม่เขียนไฟล์ — ทดสอบได้โดยไม่ต้องมีเบราว์เซอร์
 * (`lib/__tests__/settlementBook.test.js`) · การเขียนไฟล์จริงเป็นงานของ `workbook.ts`
 */

export type SettlementScope = {
  branchName: string | null;
  from: string | null;
  to: string | null;
};

/**
 * 'YYYY-MM-DD HH:MM:SS' → [วันที่, เวลาเป็นเศษส่วนของวัน]
 *
 * วันที่สร้างด้วย UTC เพราะ ExcelJS แปลง Date เป็นเลขวันของ Excel ด้วยเวลา UTC ·
 * สร้างด้วยเวลาท้องถิ่นแล้วเครื่องที่ตั้งโซนไทยจะได้วันก่อนหน้าทุกแถวที่เบิกก่อนเจ็ดโมง
 * — ตัวเลขที่ฐานเก็บเป็นเวลาไทยอยู่แล้ว ไม่ต้องแปลงอะไรอีก
 */
function moment(at: string | null): [Date | null, number | null] {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(at ?? "");
  if (!m) return [null, null];
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const time =
    m[4] === undefined ? null : (Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6] ?? 0)) / 86400;
  return [day, time];
}

const cents = (n: number): number => Math.round(n * 100) / 100;

/**
 * ก้อนตามสาขา สาขาที่เบิกก่อนขึ้นก่อน แล้วตามเวลาเบิกจากเก่าไปใหม่ — ไฟล์นี้ถูกอ่านทีละสาขา
 *
 * เคยเรียงก้อนตามชื่อสาขา วันที่จึงกระโดดทุกครั้งที่ขึ้นสาขาใหม่ (ร้านแจ้ง 22 ต.ค. 2026) ·
 * ตรรกะเดียวกับ `byFirstDate.ts` แต่เขียนซ้ำไว้ที่นี่ เพราะเทสต์ของไฟล์นี้รันด้วย node ตรง ๆ
 * ซึ่ง import ไฟล์ .ts ข้างเคียงโดยไม่มีนามสกุลไม่ได้
 */
function ordered(rows: SettlementRow[]): SettlementRow[] {
  const first = new Map<string, string>();
  for (const r of rows) {
    const k = r.branchName ?? "";
    const seen = first.get(k);
    if (seen === undefined || r.issuedAt < seen) first.set(k, r.issuedAt);
  }
  return [...rows].sort((a, b) => {
    const ka = a.branchName ?? "";
    const kb = b.branchName ?? "";
    return (
      first.get(ka)!.localeCompare(first.get(kb)!) ||
      ka.localeCompare(kb, "th") ||
      a.issuedAt.localeCompare(b.issuedAt) ||
      a.id - b.id
    );
  });
}

const SUMMARY: Column[] = [
  { header: "สาขา", width: 24 },
  { header: "ใบเบิก", width: 10, total: true },
  { header: "จำนวนชิ้น", width: 12, total: true },
  { header: "ต้นทุนรวม", width: 16, money: true, total: true },
  { header: "ชิ้นที่ยังไม่รู้ต้นทุน", width: 18, total: true },
];

const DETAIL: Column[] = [
  { header: "สาขา", width: 18 },
  { header: "วันที่เบิก", width: 12, format: "dd/mm/yyyy" },
  { header: "เวลา", width: 8, format: "hh:mm" },
  { header: "ผู้รับของ", width: 16 },
  { header: "SKU", width: 12 },
  { header: "ชื่อสินค้า / เลนส์", width: 44 },
  { header: "จำนวน", width: 9, total: true },
  { header: "ต้นทุนรวม", width: 14, money: true, total: true },
  { header: "หมายเหตุ", width: 24 },
  { header: "บันทึกโดย", width: 14 },
];

/** สองชีต: สรุปตามสาขา แล้วรายการเบิก */
export function settlementSheets(rows: SettlementRow[]): Sheet[] {
  const list = ordered(rows);

  const perBranch = new Map<string, [number, number, number, number]>();
  for (const r of list) {
    const key = r.branchName ?? "—";
    const t = perBranch.get(key) ?? [0, 0, 0, 0];
    perBranch.set(key, [t[0] + 1, t[1] + r.quantity, cents(t[2] + r.costTotal), t[3] + r.costUnknownQty]);
  }

  return [
    {
      name: "สรุปตามสาขา",
      note: "นับตามวันที่เบิก · ต้นทุนเป็นต้นทุนของร้าน ไม่ใช่ยอดที่สาขาต้องจ่าย · รายการทีละใบอยู่ชีตถัดไป",
      columns: SUMMARY,
      rows: [...perBranch].map(([branch, t]): Cell[] => [branch, ...t]),
    },
    {
      name: "รายการเบิก",
      note: "หนึ่งแถวต่อหนึ่งใบเบิก · เวลาเป็นเวลาไทย · หมายเหตุคือสิ่งที่พนักงานพิมพ์ไว้ตอนเบิก",
      columns: DETAIL,
      groupBy: 0,
      rows: list.map((r): Cell[] => {
        const [day, time] = moment(r.issuedAt);
        return [
          r.branchName ?? "—",
          day,
          time,
          r.takenBy,
          r.sku,
          r.productName ?? r.sku,
          r.quantity,
          r.costTotal,
          r.note,
          r.issuedByName,
        ];
      }),
    },
  ];
}

const safe = (s: string): string => s.replace(/[\\/:*?"<>|]/g, "-");

/** ขอบเขตที่กรองไว้ เป็นคำ — ใช้ทั้งชื่อไฟล์และหัวชีต */
function scopeWords(s: SettlementScope): [string, string] {
  return [s.branchName ?? "ทุกสาขา", s.from && s.to ? `${s.from} ถึง ${s.to}` : "ทุกช่วงเวลา"];
}

/** ชื่อไฟล์บอกสาขาและช่วงวันที่ — สองไฟล์ที่กรองต่างกันต้องไม่ชื่อชนกัน */
export function settlementFileName(s: SettlementScope): string {
  const [branch, span] = scopeWords(s);
  return safe(`การเบิกจากสาขา ${branch} ${span}`) + ".xlsx";
}

/** หัวเรื่องบนทุกชีต */
export function settlementTitle(s: SettlementScope): string {
  const [branch, span] = scopeWords(s);
  return `การเบิกจากสาขา · ${branch} · ${span}`;
}
