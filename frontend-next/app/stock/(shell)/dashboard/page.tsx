"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { can, useActor, WorkHead } from "@/stockmod/components/AppShell";
import Select from "@/stockmod/components/Select";
import { CHART_INK, DayBars, FlowChart, RankBars } from "@/stockmod/components/Charts";
import { qs, useApi } from "@/stockmod/lib/useApi";
import { count, date, money } from "@/stockmod/lib/format";
import { PRODUCT_TYPE_LABEL, PRODUCT_TYPES, type BranchRow, type Movers } from "@/stockmod/lib/api";
import DateRangeField from "@/stockmod/components/DateRangeField";
import TaskDialog from "@/stockmod/components/TaskDialog";
import { useToast } from "@/stockmod/components/Toaster";
import RecordCard, { CardList } from "@/stockmod/components/RecordCard";
import { IconChart } from "@/stockmod/components/Icon";
import { download, type Sheet } from "@/stockmod/lib/workbook";
import { daysPng, INK, piePng, rankPng } from "@/stockmod/lib/chartimage";
import Paginator from "@/stockmod/components/Paginator";

/**
 * ตารางในหน้านี้ที่ยาวได้ไม่จำกัด — แบ่งหน้าให้ทีละ 25 แถว
 *
 * สามตารางล่างของหน้านี้ยาวตามข้อมูลจริง ไม่ใช่ top-N เหมือนกราฟข้างบน: สาขา
 * เดียวเบิกของเดือนละร้อยรายการเป็นเรื่องปกติ และ "ค้างสต๊อกนาน" ยิ่งร้านเก่ายิ่ง
 * ยาว · หน้าที่ต้องเลื่อนผ่านตารางหนึ่งพันแถวเพื่อไปดูหัวข้อถัดไปคือหน้าที่ไม่มี
 * ใครเลื่อนจนถึงท้าย
 *
 * เก็บเลขหน้าไว้ในตัวเอง เพราะกล่องพับของแต่ละสาขาต้องนับหน้าแยกกัน — ยกขึ้นไป
 * ไว้ที่หน้าแม่แปลว่าต้องถือ state เป็นราย branchId
 *
 * ไม่ต้องมี effect รีเซ็ตตอนเปลี่ยนช่วงวันที่: `current` หนีบให้อยู่ในช่วงเสมอ
 * ค้างอยู่หน้า 9 แล้วข้อมูลชุดใหม่มี 2 หน้า จะได้หน้า 2 ไม่ใช่ตารางโล่ง
 */
function Paged<T>({
  rows,
  label,
  perPage = 25,
  children,
}: {
  rows: T[];
  label: string;
  perPage?: number;
  children: (shown: T[]) => ReactNode;
}) {
  const [page, setPage] = useState(1);
  const last = Math.max(1, Math.ceil(rows.length / perPage));
  const current = Math.min(page, last);

  return (
    <>
      {children(rows.slice((current - 1) * perPage, current * perPage))}
      <Paginator
        page={current}
        perPage={perPage}
        total={rows.length}
        onPage={setPage}
        label={label}
      />
    </>
  );
}

type Slot = { rows: number; qty: number; value: number | null; qtyNoCost: number };

type Report = {
  from: string;
  to: string;
  in: Slot;
  out: Slot;
  scrap: Slot;
  return: Slot;
  adjust: Slot;
  rxOrder: Slot;
  byDay: { day: string; inQty: number; outQty: number; scrapQty: number; cogs: number | null }[];
  topProducts: { id: number; sku: string; name: string; qty: number; cost: number | null }[];
  topPeople: { name: string; qty: number; rows: number }[];
  /**
   * ของเสีย แยกตามคนที่ถูกระบุว่าเป็นคนทำ
   *
   * ไม่ใช่คนที่กดบันทึก — นับเฉพาะชื่อที่ลงไว้ในช่อง "คนที่ทำของเสีย" ตอนตัด
   * ใบที่ไม่ได้ระบุใครไว้จะไม่ขึ้นในตารางนี้เลย ดีกว่าเดาแล้วไปโทษคนคีย์
   */
  scrapPeople: { name: string; qty: number; rows: number; cost: number | null }[];
  /**
   * สาขาไหนเบิกอะไรไปบ้าง แยกเป็นสินค้าทีละรายการ
   *
   * `branch` ข้างล่างตอบว่าค้างเงินอยู่เท่าไร — คำถามของคนเก็บเงิน · ตัวนี้ตอบ
   * ว่าของอะไรออกไปที่ไหนบ้าง — คำถามของคนคุมของ
   */
  branchDraws: {
    branchId: number;
    branch: string;
    draws: number;
    qty: number;
    qtyNoCost: number;
    cost: number | null;
    items: {
      sku: string;
      name: string;
      type: string | null;
      lensDesign: string | null;
      lensIndex: string | null;
      coating: string | null;
      draws: number;
      qty: number;
      qtyNoCost: number;
      cost: number | null;
    }[];
  }[];
  /**
   * ใบสั่งตัด RX แยกตามคนสั่ง แยกเป็นสินค้าทีละรายการ
   *
   * คนละคำถามกับ `branchDraws`: นั่นคือของที่ออกจากชั้นไป นี่คือของที่ต้องไปสั่ง
   * จากผู้ขายมาให้ · สาขาที่เบิกน้อยแต่สั่งตัดเยอะเป็นคนละเรื่องกันทั้งเรื่องงาน
   * และเรื่องเงิน
   *
   * ร้านเองอยู่ในตารางเดียวกันในชื่อ TimeOptic และมี `branchId` เป็น null —
   * ตารางที่มีแต่สาขาตอบไม่ได้ว่างานสั่งตัดทั้งหมดแบ่งกันอย่างไร
   */
  rxBranches: {
    branchId: number | null;
    branch: string;
    orders: number;
    qty: number;
    awaitingCost: number;
    cost: number | null;
    revenue: number | null;
    items: {
      sku: string;
      name: string;
      type: string | null;
      lensDesign: string | null;
      lensIndex: string | null;
      coating: string | null;
      orders: number;
      qty: number;
      awaitingCost: number;
      cost: number | null;
      revenue: number | null;
    }[];
  }[];
  branch: {
    issuedCount: number;
    issuedCost: number | null;
    /* สามค่านี้ API ยังส่งมาเหมือนเดิม แต่หน้านี้ไม่ได้วาดแล้ว — การ์ด
       "รับเงินจากสาขา" กับ "กำไรจากสาขา" ถูกแทนด้วยยอดขายและกำไรของทั้งร้าน
       เงินฝั่งสาขาอ่านได้ครบที่หน้าค้างรับ ซึ่งเป็นที่ของมันอยู่แล้ว */
    settledCount: number;
    settledAmount: number | null;
    settledProfit: number | null;
    owingCount: number;
    owingCost: number | null;
  };
  /**
   * ยอดขายและกำไรเท่าที่สมุดคลังรู้ — บรรทัดที่ของออกจากคลังและมีราคาขายติดอยู่
   *
   * `costed`/`uncosted` นับเป็นใบ ไม่ใช่เป็นชิ้น และ `margin` ถูกคิดจากยอดขาย
   * ของใบที่รู้ต้นทุนเท่านั้น — หน้าจอจึงต้องเขียนฐานนั้นไว้ข้างเปอร์เซ็นต์เสมอ
   * ดูเหตุผลเต็มที่ `Reports::sales` ฝั่ง API
   */
  sales: {
    bills: number;
    costed: number;
    uncosted: number;
    revenue: number | null;
    profit: number | null;
    margin: number | null;
  };
};

/* ------------------------------------------------------------------ dates */

const iso = (d: Date) => d.toISOString().slice(0, 10);

function shift(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return iso(d);
}

/** First and last day of a "YYYY-MM" month, which is what `<input type=month>` gives. */
function monthRange(m: string): { from: string; to: string } {
  const [y, mm] = m.split("-").map(Number);
  // Day 0 of the next month is the last day of this one, leap years included.
  return { from: `${m}-01`, to: iso(new Date(Date.UTC(y, mm, 0))) };
}

/**
 * ชีตทั้งหมดที่ไฟล์ Excel ออกได้ และคำอธิบายว่าแต่ละใบตอบคำถามอะไร
 *
 * ถามตอนกด ไม่ใช่ตั้งค้างไว้ในแถบ — คนที่เปิดหน้านี้มาดูตัวเลขไม่ได้กำลังจะสร้าง
 * ไฟล์ ช่องเลือกชีตที่นั่งอยู่ในแถบตลอดเวลาจึงกินความกว้างของแถบเพื่อคำถามที่วัน
 * หนึ่งถูกถามครั้งเดียว · พอย้ายมาอยู่ในกล่องที่เปิดตอนกด มันได้ที่พอจะเขียน
 * คำอธิบายของแต่ละชีตด้วย ซึ่งในดรอปดาวน์แคบ ๆ เขียนไม่ลง
 */
const SHEETS: readonly { value: string; label: string; hint: string }[] = [
  { value: "สรุปรายการ", label: "สรุปรายการ", hint: "รับเข้า จ่ายออก ของเสีย คืน ปรับยอด RX" },
  { value: "รายวัน", label: "รายวัน", hint: "เข้า–ออก–เสีย และต้นทุนขาย ทีละวัน" },
  { value: "ต้นทุนรวมแยกตามสาขา", label: "ต้นทุนรวมแยกตามสาขา", hint: "สาขาละแถว เอาไปดูว่าใครเบิกหนักสุด" },
  { value: "สาขาเบิกอะไรไป", label: "สาขาเบิกอะไรไป", hint: "แถวละสินค้า มีแถวรวมย่อยของแต่ละสาขา" },
  { value: "ใครสั่งตัด RX", label: "ใครสั่งตัด RX", hint: "ใบสั่งตัดแยกตามคนสั่ง รวม TimeOptic" },
  { value: "สินค้าจ่ายออกมากสุด", label: "สินค้าจ่ายออกมากสุด", hint: "สิบอันดับแรกของช่วงนี้" },
  { value: "ใครเบิกมากสุด", label: "ใครเบิกมากสุด", hint: "นับทั้งการเบิกและการตัดของเสีย" },
  { value: "ของเสียแยกตามคน", label: "ของเสียแยกตามคน", hint: "เฉพาะใบที่ระบุชื่อคนทำไว้" },
];

const PRESETS = [
  { key: "today", label: "วันนี้", range: () => ({ from: shift(0), to: shift(0) }) },
  { key: "yesterday", label: "เมื่อวาน", range: () => ({ from: shift(-1), to: shift(-1) }) },
  { key: "7d", label: "7 วัน", range: () => ({ from: shift(-6), to: shift(0) }) },
  { key: "30d", label: "30 วัน", range: () => ({ from: shift(-29), to: shift(0) }) },
  {
    key: "month",
    label: "เดือนนี้",
    range: () => ({ from: iso(new Date()).slice(0, 7) + "-01", to: shift(0) }),
  },
  {
    key: "lastmonth",
    label: "เดือนที่แล้ว",
    range: () => {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - 1);
      return monthRange(iso(d).slice(0, 7));
    },
  },
  {
    key: "year",
    label: "ปีนี้",
    range: () => ({ from: `${new Date().getFullYear()}-01-01`, to: shift(0) }),
  },
] as const;

/**
 * How long something may sit before it counts as stuck.
 *
 * Left to the reader rather than fixed, because the answer differs by trade
 * within one shop: three months of stillness is remarkable for a stock lens and
 * unremarkable for a rimless titanium frame that sells four a year.
 */
const IDLE = [
  { value: "30", label: "ไม่ขยับเกิน 1 เดือน" },
  { value: "90", label: "ไม่ขยับเกิน 3 เดือน" },
  { value: "180", label: "ไม่ขยับเกิน 6 เดือน" },
  { value: "365", label: "ไม่ขยับเกิน 1 ปี" },
] as const;

/** "8 เดือน" reads; "243 วัน" has to be divided before it does. */
function span(days: number): string {
  if (days < 60) return `${count(days)} วัน`;
  const months = Math.round(days / 30);
  return months < 24 ? `${count(months)} เดือน` : `${count(Math.round(days / 365))} ปี`;
}

/**
 * The ledger, added up and drawn.
 *
 * Everything here answers the same question at different resolutions — what
 * moved, when, and what it was worth — so one date range governs the whole page
 * rather than each section carrying its own.
 *
 * Two dates are deliberately not the same, and the tiles say which is which:
 * stock and its cost are dated by the day the goods moved, while money back from
 * a branch is dated by the day it arrived. A withdrawal in one month settled in
 * the next belongs to the cost of one and the profit of the other.
 */
export default function DashboardPage() {
  const actor = useActor();
  const money$ = can.seeCost(actor);
  const toast = useToast();

  /**
   * เปิดมาเห็น 30 วันล่าสุด ไม่ใช่ "เดือนนี้"
   *
   * "เดือนนี้" อ่านดูเข้าท่า จนถึงวันที่ 1 ของเดือน — วันนั้นช่วงที่เลือกยาว
   * วันเดียวคือวันที่ยังไม่มีอะไรเกิดขึ้น ทั้งหน้าจึงเป็นศูนย์ และคนเปิดจะอ่าน
   * ว่าระบบพัง ไม่ใช่ว่าเดือนเพิ่งเริ่ม · ต้นเดือนกับเช้าวันที่ยังไม่ได้ขายอะไร
   * เป็นเวลาที่คนเปิดแดชบอร์ดพอดี ค่าตั้งต้นจึงต้องทนกับสองเวลานั้นให้ได้
   *
   * 30 วันล่าสุดตอบเหมือนกันทุกวันของเดือน ปุ่ม "เดือนนี้" ยังอยู่ให้กดเมื่อ
   * ต้องการยอดตามปฏิทินจริง ๆ
   */
  const [preset, setPreset] = useState<string>("30d");
  const [from, setFrom] = useState(() => PRESETS[3].range().from);
  const [to, setTo] = useState(() => PRESETS[3].range().to);

  /**
   * How still is still. Applies to the bottom table only — see the note there.
   */
  const [idle, setIdle] = useState("90");

  /**
   * กำลังเขียนไฟล์อยู่
   *
   * การเขียน .xlsx เกิดในเบราว์เซอร์ ไม่ใช่ที่เซิร์ฟเวอร์ — ช่วงยาว ๆ ใช้เวลา
   * หลายวินาที ปุ่มที่ไม่บอกอะไรระหว่างนั้นจะถูกกดซ้ำแล้วได้ไฟล์ซ้อนกันสามใบ
   */
  const [saving, setSaving] = useState(false);
  const [exportProblem, setExportProblem] = useState<string | null>(null);

  /** กล่องเลือกชีตเปิดอยู่ไหม — เปิดตอนกดปุ่ม Excel ไม่ได้ค้างอยู่ในแถบ */
  const [picking, setPicking] = useState(false);

  /**
   * แถบเครื่องมือกางอยู่ไหม — เรื่องของมือถือเท่านั้น
   *
   * บนจอกว้างแถบนี้ยาวบรรทัดเดียวและอ่านได้ทั้งแถบ · บนจอ 390px มันคือชิปเจ็ดใบ
   * ช่องวันสองช่อง ดรอปดาวน์สองช่อง — ห้าบรรทัดก่อนถึงตัวเลขตัวแรก ทั้งที่คนเปิด
   * แดชบอร์ดมาดูตัวเลข ไม่ได้มาตั้งช่วงวัน (ช่วงตั้งต้น 30 วันล่าสุดใช้ได้ทุกวัน)
   */
  const [tools, setTools] = useState(false);

  /* ติ๊กไว้ครบตอนเริ่ม เพราะคนที่ยังไม่รู้ว่ามีอะไรบ้างจะได้เห็นทั้งหมดก่อนแล้วค่อย
     ตัดออก — ตรงข้ามกับเริ่มจากว่าง ซึ่งกดปุ่มแล้วได้ไฟล์เปล่า · จำไว้ทั้งรอบที่
     เปิดหน้าอยู่ คนที่เอาแค่สองชีตมักเอาสองชีตเดิมทุกครั้ง */
  const [exSheets, setExSheets] = useState<string[]>(() => SHEETS.map((s) => s.value));

  /**
   * ตัวกรองของทั้งหน้า — จอกับไฟล์ใช้ตัวเดียวกัน
   *
   * เคยเป็นตัวกรองของไฟล์ Excel อย่างเดียว จอข้างบนแสดงทั้งร้านเสมอ · แยกกัน
   * แบบนั้นแปลว่าไฟล์กับจอตอบคนละคำถามทั้งที่คนกดคิดว่าถามอันเดียวกัน แล้วรู้ตัว
   * ตอนเอาไฟล์ไปเทียบกับจอแล้วเลขไม่ตรง
   *
   * ตอนนี้ทั้งคู่ยิงไปที่ API พร้อมตัวกรอง ตัวเลขบนจอกับในไฟล์จึงมาจากคำถาม
   * เดียวกันเสมอ
   *
   * **เลือกสาขาแล้วบางการ์ดจะเป็นศูนย์** — การรับของเข้า ปรับยอด คืนของ และ
   * ตัดของเสีย ไม่ผูกกับสาขาใด ของเข้าคลังกลาง ไม่ได้เข้าของสาขาไหน · การ์ดพวก
   * นั้นถูกหรี่ลงพร้อมป้ายบอก แทนที่จะปล่อยให้อ่านเหมือนข้อมูลหาย
   */
  const [branch, setBranch] = useState("");
  const [ptype, setPtype] = useState("");

  /** จริงไหมว่ากำลังมองสาขาเดียว — ใช้ตัดสินว่าการ์ดไหนต้องหรี่ */
  const scopedToBranch = branch !== "";


  const report = useApi<Report>(`/report${qs({ from, to, branch, type: ptype })}`);
  const movers = useApi<Movers>(`/movers${qs({ from, to, idle, branch, type: ptype })}`);

  /**
   * รายชื่อสาขาสำหรับดรอปดาวน์ — ถามแยก ไม่ได้ดึงจากผลลัพธ์ที่กรองแล้ว
   *
   * เดิมตัวเลือกประกอบจากสาขาที่โผล่ในรายงาน ซึ่งใช้ได้ตอนรายงานเป็นทั้งร้าน ·
   * พอรายงานถูกกรองเหลือสาขาเดียว ตัวเลือกจะเหลือสาขาเดียวตามไปด้วย แล้วจะกลับ
   * ไปเลือกสาขาอื่นไม่ได้อีกเลย
   */
  const branches = useApi<{ branches: BranchRow[] }>("/branches");

  /**
   * ขอบเขตที่กรองอยู่ เขียนเป็นคำ — "สาขาบ่อนไก่ · เลนส์"
   *
   * คิดที่เดียวเพราะมันไปโผล่สองที่: ในกล่องเลือกชีต และใต้ชื่อชีตทุกใบในไฟล์ ·
   * สองที่ที่เขียนคำเดียวกันคนละที่ คือสองคำที่วันหนึ่งจะไม่ตรงกัน
   */
  const scopeWords = [
    branch === ""
      ? null
      : branch === "self"
        ? "TimeOptic"
        : ((branches.status === "ready"
            ? branches.data.branches.find((b) => String(b.id) === branch)?.name
            : undefined) ?? "สาขา"),
    ptype === "" ? null : (PRODUCT_TYPE_LABEL[ptype] ?? ptype),
  ]
    .filter(Boolean)
    .join(" · ");


  function useRange(next: { from: string; to: string }, key: string) {
    setFrom(next.from);
    setTo(next.to);
    setPreset(key);
  }


  /**
   * ทั้งหน้า ลงเป็นไฟล์ Excel — ชีตละเรื่อง มีแถวรวม
   *
   * ประกอบจากตัวเลขชุดเดียวกับที่วาดอยู่บนจอ ไม่ใช่ยิงถามใหม่ — ไฟล์ที่ได้จึง
   * ตรงกับสิ่งที่คนกดกำลังมองอยู่เสมอ แม้ข้อมูลจะเปลี่ยนไปแล้วในวินาทีนั้น
   *
   * ราคาทุนลงไฟล์เฉพาะคนที่เห็นมันบนจอ · API ตัดตัวเลขพวกนี้ออกจากคำตอบให้คน
   * อื่นอยู่แล้ว ตรงนี้จึงไม่ใช่ด่าน แต่ถ้าไม่เช็คก็จะได้คอลัมน์เปล่า ๆ ที่อ่าน
   * เหมือนของฟรีทั้งคลัง
   */
  async function exportBook() {
    if (report.status !== "ready" || saving) return;
    /* ปุ่มไม่โผล่ให้คนที่ไม่มีสิทธิ์เห็นต้นทุนอยู่แล้ว · ที่เช็คซ้ำตรงนี้เพราะ
       กล่องเลือกชีตเปิดค้างอยู่ได้ข้ามการเปลี่ยนสิทธิ์ และ "ปุ่มหายไป" ไม่ใช่
       สิ่งเดียวกับ "กดไม่ได้" */
    if (!money$) return;
    const d = report.data;

    setSaving(true);
    setExportProblem(null);
    try {
      // ตัวเลขดิบ ไม่ผ่านตัวจัดรูปแบบ — Excel ต้องได้จำนวนไว้บวก ไม่ใช่ข้อความ
      // ที่มีลูกน้ำคั่นหลักแล้วรวมไม่ได้ · คนที่ไม่มีสิทธิ์เห็นทุนได้ช่องว่าง
      const cost$ = (v: number | null) => (money$ && v !== null ? v : null);
      const day = (s: string) => s.slice(5).replace("-", "/");

      /* ไม่มีการกรองซ้ำตรงนี้อีกแล้ว — API กรองมาให้ตั้งแต่ต้นทางด้วยตัวกรอง
         ชุดเดียวกับที่หน้าจอใช้ · กรองสองรอบคนละที่คือสองกฎที่ต้องตรงกันตลอดไป
         และวันที่มันเพี้ยน ไฟล์กับจอจะบอกคนละเลขโดยไม่มีอะไรเตือน */
      const draws = d.branchDraws;
      const rx = d.rxBranches;

      /* ทุกชีตในไฟล์ถูกกรองมาแล้วเท่ากัน จึงไม่มีชีตไหนต้องถูกตัดออกเพราะ
         "กรองไม่ได้" อีก · ที่เหลือคือบอกบนหัวชีตว่าไฟล์ใบนี้แคบแค่ไหน */
      const scoped = branch !== "" || ptype !== "";

      const scopeNote = scopeWords === "" ? "" : ` · เฉพาะ ${scopeWords}`;

      /* หกชนิดการเคลื่อนไหวของชีตสรุป — ตารางกับกราฟอ่านจากรายการเดียวกัน จะได้
         ไม่มีวันหลุดจากกันตอนใครสักคนเพิ่มชนิดที่เจ็ด · สีตามชนิด ไม่ใช่สีเดียว
         ทั้งใบ เพราะ "รับเข้า 300 ชิ้น" กับ "ตัดของเสีย 300 ชิ้น" ยาวเท่ากันแต่
         ไม่ใช่ข่าวแบบเดียวกัน · ปรับยอดไม่มีทิศ จึงเป็นสีกลาง */
      const summary = [
        { label: "รับเข้า", s: d.in, color: INK.in },
        { label: "จ่ายออก", s: d.out, color: INK.out },
        { label: "ตัดของเสีย", s: d.scrap, color: INK.scrap },
        { label: "คืนของ", s: d.return, color: INK.in },
        { label: "ปรับยอด", s: d.adjust, color: INK.flat },
        { label: "ใบสั่งตัด RX", s: d.rxOrder, color: INK.cost },
      ];

      const sheets: Sheet[] = [
        {
          name: "สรุปรายการ",
          note: "นับตามวันที่ของเคลื่อนไหว — ไม่ใช่วันที่เงินเข้า",
          columns: [
            { header: "รายการ", width: 20 },
            { header: "จำนวนใบ", total: true },
            { header: "จำนวนชิ้น", total: true },
            { header: "มูลค่า (บาท)", money: true, total: true },
            { header: "ชิ้นที่ยังไม่รู้ต้นทุน", width: 20, total: true },
          ],
          rows: summary.map((m) => [m.label, m.s.rows, m.s.qty, cost$(m.s.value), m.s.qtyNoCost]),
          /* เรียงตามลำดับของตาราง ไม่ได้เรียงจากมากไปน้อย — หกแถวนี้ไม่ใช่อันดับ
             แต่เป็นวงจรของของในคลัง (เข้า ออก เสีย คืน ปรับ สั่งตัด) การสลับที่
             ให้แท่งยาวขึ้นก่อนคือการทำให้ภาพกับตารางข้างบนอ่านคนละลำดับ */
          charts: [
            rankPng(
              summary.map((m) => ({
                label: m.label,
                sub: `${m.s.rows} ใบ`,
                value: m.s.qty,
                color: m.color,
              })),
              INK.out,
              "ชิ้น",
              "แต่ละรายการเคลื่อนไหวไปกี่ชิ้น",
            ),
          ],
        },
        {
          name: "รายวัน",
          columns: [
            { header: "วันที่", width: 14 },
            { header: "รับเข้า (ชิ้น)", total: true },
            { header: "จ่ายออก (ชิ้น)", total: true },
            { header: "ของเสีย (ชิ้น)", total: true },
            { header: "ต้นทุนขาย (บาท)", money: true, total: true },
          ],
          rows: d.byDay.map((r) => [r.day, r.inQty, r.outQty, r.scrapQty, cost$(r.cogs)]),
          charts: [
            daysPng(
              d.byDay.map((r) => day(r.day)),
              [
                { label: "รับเข้า", color: INK.in, values: d.byDay.map((r) => r.inQty) },
                { label: "จ่ายออก", color: INK.out, values: d.byDay.map((r) => r.outQty) },
                { label: "ของเสีย", color: INK.scrap, values: d.byDay.map((r) => r.scrapQty) },
              ],
              `ความเคลื่อนไหวรายวัน ${d.from} ถึง ${d.to}`,
            ),
          ],
        },
        {
          /* สรุปสาขาละแถว มาก่อนชีตรายการ — คำถาม "สาขาไหนเบิกไปเป็นทุนเท่าไร"
             ตอบได้จากชีตรายการก็จริง แต่ต้อง pivot ก่อน · ตัวเลขชุดนี้ตรงกับที่
             หน้าจอแสดง จึงเทียบกันได้โดยไม่ต้องเชื่อว่าใครบวกถูก */
          name: "ต้นทุนรวมแยกตามสาขา",
          note: "สาขาละแถว — รายละเอียดว่าเบิกอะไรไปอยู่ชีตถัดไป",
          columns: [
            { header: "สาขา", width: 24 },
            { header: "ใบเบิก", total: true },
            { header: "จำนวน (ชิ้น)", total: true },
            { header: "ต้นทุนรวม (บาท)", money: true, total: true },
            { header: "ชิ้นที่ยังไม่รู้ต้นทุน", width: 20, total: true },
          ],
          rows: draws.map((b) => [
            b.branch,
            b.draws,
            b.qty,
            cost$(b.cost),
            b.qtyNoCost,
          ]),
          charts: [
            rankPng(
              draws.map((b) => ({ label: b.branch, sub: `${b.draws} ใบ`, value: b.qty })),
              INK.out,
              "ชิ้น",
              "สาขาไหนเบิกไปเท่าไร",
            ),
            piePng(
              draws.map((b) => ({ label: b.branch, sub: `${b.draws} ใบ`, value: b.qty })),
              "สัดส่วนของที่แต่ละสาขาเบิกไป",
              "ชิ้น",
            ),
          ],
        },
        {
          name: "สาขาเบิกอะไรไป",
          // สาขาละก้อน มีแถวรวมย่อยคั่น — ไฟล์นี้ถูกอ่านทีละสาขา ไม่ใช่ทั้งใบ
          groupBy: 0,
          note: "ทุกใบที่ออกไปในช่วงนี้ ไม่ว่ารับเงินแล้วหรือยัง — ยกเว้นใบที่ยกเลิก",
          columns: [
            { header: "สาขา" },
            { header: "รหัสสินค้า", width: 14 },
            { header: "สินค้า", width: 40 },
            { header: "ชนิด", width: 12 },
            { header: "ชนิดเลนส์", width: 16 },
            { header: "Index", width: 10 },
            { header: "Coating", width: 14 },
            { header: "ครั้งที่เบิก", total: true },
            { header: "จำนวน (ชิ้น)", total: true },
            { header: "ต้นทุนรวม (บาท)", money: true, total: true },
            { header: "ชิ้นที่ยังไม่รู้ต้นทุน", width: 20, total: true },
          ],
          // แบนเป็นแถวเดียวต่อหนึ่งสินค้าของหนึ่งสาขา ชื่อสาขาซ้ำทุกแถว —
          // ไฟล์นี้จะถูกเอาไป pivot ต่อ และ pivot ต้องการคอลัมน์ที่เต็มทุกแถว
          rows: draws.flatMap((b) =>
            b.items.map((it) => [
              b.branch,
              it.sku,
              it.name,
              it.type,
              it.lensDesign,
              it.lensIndex,
              it.coating,
              it.draws,
              it.qty,
              cost$(it.cost),
              it.qtyNoCost,
            ]),
          ),
          charts: [
            rankPng(
              draws.map((b) => ({ label: b.branch, sub: `${b.draws} ใบ`, value: b.qty })),
              INK.out,
              "ชิ้น",
              "สาขาเบิกไปเท่าไร",
            ),
            piePng(
              draws.map((b) => ({ label: b.branch, sub: `${b.draws} ใบ`, value: b.qty })),
              "สัดส่วนของที่แต่ละสาขาเบิกไป",
              "ชิ้น",
            ),
          ],
        },
        {
          name: "ใครสั่งตัด RX",
          groupBy: 0,
          note: "ใบสั่งตัดที่เปิดในช่วงนี้ ยกเว้นใบที่ยกเลิก — TimeOptic คือใบที่ร้านสั่งเอง",
          columns: [
            { header: "ผู้สั่ง", width: 18 },
            { header: "รหัสสินค้า", width: 14 },
            { header: "เลนส์", width: 40 },
            { header: "ชนิด", width: 12 },
            { header: "ชนิดเลนส์", width: 16 },
            { header: "Index", width: 10 },
            { header: "Coating", width: 14 },
            { header: "ใบสั่ง", total: true },
            { header: "จำนวน (ชิ้น)", total: true },
            { header: "รอลงต้นทุน", total: true },
            { header: "ต้นทุนรวม (บาท)", money: true, total: true },
            { header: "ราคาขายรวม (บาท)", money: true, total: true },
          ],
          // แบนเหมือนชีตสาขาเบิก ด้วยเหตุผลเดียวกัน — ไฟล์นี้ถูกเอาไป pivot ต่อ
          rows: rx.flatMap((b) =>
            b.items.map((it) => [
              b.branch,
              it.sku,
              it.name,
              it.type,
              it.lensDesign,
              it.lensIndex,
              it.coating,
              it.orders,
              it.qty,
              it.awaitingCost,
              cost$(it.cost),
              cost$(it.revenue),
            ]),
          ),
          charts: [
            rankPng(
              rx.map((b) => ({ label: b.branch, sub: `${b.qty} ชิ้น`, value: b.orders })),
              INK.cost,
              "ใบ",
              "ใครสั่งตัด RX ไปกี่ใบ",
            ),
            piePng(
              rx.map((b) => ({ label: b.branch, sub: `${b.qty} ชิ้น`, value: b.orders })),
              "สัดส่วนใบสั่งตัด RX แยกตามผู้สั่ง",
              "ใบ",
            ),
          ],
        },
        {
          name: "สินค้าจ่ายออกมากสุด",
          columns: [
            { header: "รหัสสินค้า", width: 14 },
            { header: "สินค้า", width: 44 },
            { header: "จำนวน (ชิ้น)", total: true },
            { header: "ต้นทุนรวม (บาท)", money: true, total: true },
          ],
          rows: d.topProducts.map((p) => [p.sku, p.name, p.qty, cost$(p.cost)]),
          charts: [
            rankPng(
              d.topProducts.map((p) => ({ label: p.name, sub: p.sku, value: p.qty })),
              INK.out,
              "ชิ้น",
              "สินค้าที่จ่ายออกมากที่สุด",
            ),
            piePng(
              d.topProducts.map((p) => ({ label: p.name, sub: p.sku, value: p.qty })),
              "สัดส่วนใน 10 อันดับแรกที่จ่ายออกมากสุด",
              "ชิ้น",
            ),
          ],
        },
        {
          name: "ใครเบิกมากสุด",
          note: "นับทั้งการเบิกและการตัดของเสีย",
          columns: [
            { header: "ชื่อ", width: 26 },
            { header: "จำนวนรายการ", total: true },
            { header: "จำนวน (ชิ้น)", total: true },
          ],
          rows: d.topPeople.map((p) => [p.name, p.rows, p.qty]),
          charts: [
            rankPng(
              d.topPeople.map((p) => ({ label: p.name, sub: `${p.rows} รายการ`, value: p.qty })),
              INK.in,
              "ชิ้น",
              "ใครเบิกมากที่สุด",
            ),
            piePng(
              d.topPeople.map((p) => ({ label: p.name, sub: `${p.rows} รายการ`, value: p.qty })),
              "สัดส่วนใน 10 อันดับแรกของคนที่เบิกมากสุด",
              "ชิ้น",
            ),
          ],
        },
        {
          name: "ของเสียแยกตามคน",
          note: "เฉพาะใบที่ระบุชื่อคนทำไว้ — ใบที่ไม่ได้ระบุไม่ถูกเดาให้ใคร",
          columns: [
            { header: "ชื่อ", width: 26 },
            { header: "จำนวนรายการ", total: true },
            { header: "จำนวน (ชิ้น)", total: true },
            { header: "มูลค่า (บาท)", money: true, total: true },
          ],
          rows: d.scrapPeople.map((p) => [p.name, p.rows, p.qty, cost$(p.cost)]),
          charts: [
            rankPng(
              d.scrapPeople.map((p) => ({ label: p.name, sub: `${p.rows} รายการ`, value: p.qty })),
              INK.scrap,
              "ชิ้น",
              "ของเสีย แยกตามคนที่ทำ",
            ),
            piePng(
              d.scrapPeople.map((p) => ({ label: p.name, sub: `${p.rows} รายการ`, value: p.qty })),
              "สัดส่วนของเสียใน 10 อันดับแรก",
              "ชิ้น",
            ),
          ],
        },
      ];

      /* ไม่มีชีตไหนถูกตัดออกเพราะ "กรองไม่ได้" อีกแล้ว — ทุกชีตประกอบจากข้อมูล
         ที่ API กรองมาให้ชุดเดียวกัน · ชีตที่กรองแล้วไม่เหลือแถวยังตัดออกเหมือน
         เดิม เพราะแผ่นเปล่าที่มีแต่หัวตารางอ่านเหมือนไฟล์เสีย ไม่ใช่คำตอบว่า
         "ช่วงนี้ไม่มีรายการ" */
      const book = sheets
        // ที่ติ๊กไว้ในกล่องก่อน — ทุกอย่างหลังจากนี้คือการตัดออกด้วยเหตุผลอื่น
        .filter((s) => exSheets.includes(s.name))
        .filter((s) => s.rows.length > 0)
        // ตัวกรองเขียนไว้ใต้ชื่อชีตทุกใบ — ไฟล์ที่ถูกส่งต่อไปอีกสองมือต้องบอก
        // ตัวเองได้ว่ามันคือข้อมูลของอะไร โดยไม่ต้องถามคนที่กดปุ่ม
        .map((s) => ({ ...s, note: `${s.note ?? ""}${scopeNote}`.trim() || undefined }));

      if (book.length === 0) {
        setExportProblem(
          `ชีตที่เลือกไว้ไม่มีข้อมูลใน ${d.from} ถึง ${d.to}${scopeNote} — ลองเลือกชีตเพิ่ม ขยายช่วงวัน หรือเอาตัวกรองออก`,
        );
        return;
      }

      /* ตัวกรองอยู่ในชื่อไฟล์ด้วย — สองช่วงที่กรองคนละแบบให้ชื่อเดียวกันคือสอง
         ไฟล์ที่ Chrome ต่อท้ายเป็น (1) (2) แล้วเปิดมาแยกไม่ออกว่าอันไหนคืออะไร */
      const tag = scopeWords === "" ? "" : `-${scopeWords.replace(/ · /g, "-")}`;

      await download(
        `timeoptic-dashboard-${d.from}-ถึง-${d.to}${tag}.xlsx`,
        `แดชบอร์ด ${d.from} ถึง ${d.to}${scopeNote}`,
        book,
      );
    } catch (e) {
      const why = e instanceof Error ? e.message : "สร้างไฟล์ไม่สำเร็จ";
      setExportProblem(why);
      toast.error({ text: "สร้างไฟล์ Excel ไม่สำเร็จ", detail: why });
    } finally {
      setSaving(false);
    }
  }

  const days = report.status === "ready" ? report.data.byDay : [];
  const spanDays =
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000 +
    1;

  return (
    <main className="work-main">
      {/* The per-row ledger lives on its own screen, reached from the menu.
          It used to be repeated at the foot of this page under the very charts
          drawn from it, which made the dashboard scroll past its own summary to
          show the rows the summary was for. */}
      <WorkHead
        title="แดชบอร์ด"
        lede="สรุปความเคลื่อนไหวตามช่วงวันที่ จบด้วยของที่ควรสั่งเพิ่มและของที่กองอยู่เฉย ๆ"
      />

      {exportProblem ? (
        <div className="notice notice--error" role="alert">
          {exportProblem}
        </div>
      ) : null}

      {/* ------------------------------------------------------------ range */}

      {/* แถบเดียวจบ — ช่วงเวลา ตัวกรอง และช่วงที่กำลังดูอยู่ อยู่บรรทัดเดียวกัน
          เดิมเป็นสามชั้นซ้อนกัน: ชิปแถวหนึ่ง ช่องวันที่แถวหนึ่ง ตัวกรองอีกแถวหนึ่ง
          รวมกันสูงเกือบครึ่งจอก่อนถึงตัวเลขตัวแรก · ทุกอย่างยังทำได้เหมือนเดิม
          แค่ยืนอยู่บรรทัดเดียวกันและห่อบรรทัดเองตอนจอแคบ */}
      {/* สองก้อน ไม่ใช่แถบเดียว — ข้างบนเปลี่ยนสิ่งที่เห็นบนจอ ข้างล่างเปลี่ยน
          เฉพาะสิ่งที่ลงไฟล์ · เดิมยืนปนกันบนบรรทัดเดียว แล้วช่อง "สาขา" อ่านเหมือน
          จะกรองตัวเลขบนจอด้วย ทั้งที่ไม่ได้ทำ — คำอธิบายใต้แถบแก้เรื่องนี้ไม่ได้
          เพราะไม่มีใครอ่านคำอธิบายก่อนกด */}
      <section className="task task--wide toolbar">
        <div className="toolbar__row">
          {/* ปุ่มพับ/กางของมือถือ · จอกว้างไม่มีปุ่มนี้ และกล่องข้างล่างเป็น
              display:contents ซึ่งแปลว่าไม่มีตัวมันอยู่ในผังเลย แถบจึงเรียงตัว
              เหมือนเดิมทุกประการ */}
          <button
            type="button"
            className="btn btn--small filterfold phone-only"
            onClick={() => setTools((v) => !v)}
            aria-expanded={tools}
          >
            {tools ? "ซ่อนตัวกรอง" : `ตัวกรอง · ${count(Math.max(1, Math.round(spanDays)))} วัน`}
          </button>

          <div className={tools ? "toolbar__tools" : "toolbar__tools toolbar__tools--folded"}>
          {/* ไม่มีป้ายหัวแถบแล้ว — ป้ายท้ายแถวบอกช่วงที่ได้จริง ซึ่งเป็นสิ่งเดียว
              ที่ต้องอ่าน · คำว่า "ดูข้อมูลช่วง" กินความกว้างเท่าชิปสองใบเพื่อบอก
              สิ่งที่ปุ่มข้าง ๆ มันบอกอยู่แล้ว */}
          <div className="chips chips--tight toolbar__presets" role="group" aria-label="ช่วงเวลาที่ใช้บ่อย">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className="chip chip--flat"
                aria-current={preset === p.key ? "true" : undefined}
                onClick={() => useRange(p.range(), p.key)}
              >
                {p.label}
              </button>
            ))}
            {/* ไม่มีชิป "กำหนดเอง" แล้ว — มันไม่ได้ตั้งช่วงเอง หน้าที่เดียวของมันคือ
                เปิดปฏิทิน ซึ่งสองช่องวันที่ที่อยู่ถัดไปอีกนิดเดียวก็เปิดให้อยู่แล้ว ·
                ปุ่มที่ทำสิ่งเดียวกับของที่อยู่ข้าง ๆ คือความกว้างที่จ่ายไปฟรี ๆ และ
                แถบนี้ต้องพอดีบรรทัดเดียว */}
          </div>

          <DateRangeField
            split
            id="db-range"
            from={from}
            to={to}
            onApply={(r) => useRange(r, "custom")}
          />

          {/* สาขากับชนิดสินค้าอยู่แถวเดียวกับช่วงวันที่ เพราะทั้งสามตัวตัดขอบเขต
              ของทั้งหน้าเหมือนกัน · ป้ายอยู่ข้างช่อง ไม่ใช่เหนือช่อง — แถวเดียว
              ที่มีป้ายลอยเหนือทุกช่องจะสูงเป็นสองเท่าโดยไม่ได้บอกอะไรเพิ่ม */}
          <div className="toolbar__pair">
            <span className="toolbar__lead">สาขา</span>
            <Select
              id="db-branch"
              className="input--inline"
              value={branch}
              onChange={setBranch}
              disabled={branches.status !== "ready"}
              options={[
                { value: "", label: "ทุกสาขา" },
                { value: "self", label: "TimeOptic (ร้านนี้เอง)" },
                ...(branches.status === "ready"
                  ? branches.data.branches.map((b) => ({ value: String(b.id), label: b.name }))
                  : []),
              ]}
            />
          </div>

          <div className="toolbar__pair">
            <span className="toolbar__lead">ชนิด</span>
            <Select
              id="db-type"
              className="input--inline"
              value={ptype}
              onChange={setPtype}
              options={[
                { value: "", label: "ทุกชนิด" },
                ...PRODUCT_TYPES.map((t) => ({ value: t, label: PRODUCT_TYPE_LABEL[t] })),
              ]}
            />
          </div>

          {/* เหลือแค่จำนวนวัน ไม่ใช่ป้ายที่พิมพ์ช่วงซ้ำอีกรอบ — สองช่องข้าง ๆ บอก
              วันที่ต้นและวันที่ท้ายอยู่แล้ว สิ่งเดียวที่ป้ายเคยบอกเพิ่มคือช่วงนั้น
              ยาวกี่วัน ซึ่งเป็นตัวเลขที่คิดเองในหัวไม่ทันตอนกวาดตา */}
          <span className="toolbar__span">
            {count(Math.max(1, Math.round(spanDays)))} วัน
          </span>

          </div>

          {/* ปุ่มเดียว ได้ตารางล้วน — เคยมีสามปุ่ม (ข้อมูล / ข้อมูล+กราฟ / กราฟ)
              ซึ่งเป็นคำถามที่คนกดไม่ได้อยากตอบ · แล้วกราฟในไฟล์ก็ถูกถอดออกทั้งหมด
              เพราะมันคือตัวเลขชุดเดิมที่ถูกตัดเหลือ 20 แถวแล้ววาดซ้ำใต้ตาราง
              คำถามที่เหลืออยู่จริงคือ "เอาชีตไหนบ้าง" ซึ่งถามในกล่องตอนกด */}
          {/* ไฟล์ที่ออกไปคือแดชบอร์ดทั้งหน้าในรูปตาราง — ต้นทุนขาย ต้นทุนรวม
              รายสาขา มูลค่าของเสีย · คนที่ดูตัวเลขพวกนี้บนจอไม่ได้ ก็ไม่ควรมี
              ปุ่มที่พาไปหามันในไฟล์ · เดิมปุ่มขึ้นให้ทุกคนแล้วค่อยเว้นคอลัมน์
              ต้นทุนไว้ว่าง ซึ่งเป็นไฟล์ที่อ่านเหมือนของไม่มีต้นทุนทั้งคลัง */}
          {report.status === "ready" && money$ ? (
            <button
              type="button"
              className="btn btn--primary btn--small btn--icon toolbar__export"
              onClick={() => {
                setExportProblem(null);
                setPicking(true);
              }}
              disabled={saving}
            >
              <IconChart />
              Export Excel
            </button>
          ) : null}
        </div>

        {scopedToBranch ? (
          <p className="field__help toolbar__note">
            เลือกสาขาแล้ว — <strong>รับเข้า · ตัดของเสีย · ปรับยอด · คืนของ</strong> ไม่มีมิติสาขา
            ให้กรอง (ของเข้าคลังกลาง ไม่ได้เข้าของสาขาไหน) การ์ดพวกนั้นจึงถูกหรี่ไว้
          </p>
        ) : null}

      </section>

      {/* กล่องเลือกชีต — เปิดตอนกด Excel ไม่ได้นั่งอยู่ในแถบตลอดเวลา
          ติ๊กไว้ครบเป็นค่าเริ่มต้น กดสร้างไฟล์ทันทีก็ได้ทั้งเล่ม · คนที่อยากได้แค่
          บางชีตค่อยแกะออก ซึ่งเป็นคนส่วนน้อยแต่เป็นคนที่การเลือกมีค่ากับเขาจริง */}
      {picking ? (
        <TaskDialog
          eyebrow="ส่งออกไฟล์ Excel"
          title="เอาชีตไหนบ้าง"
          head={
            <p className="field__help">
              ตารางทั้งหมดในไฟล์เดียว · ช่วง {date(from)} – {date(to)}
              {scopeWords === "" ? "" : ` · เฉพาะ ${scopeWords}`}
            </p>
          }
          onClose={() => setPicking(false)}
        >
          <div className="sheetpick">
            <ul className="sheetpick__list">
              {SHEETS.map((sheet) => {
                const on = exSheets.includes(sheet.value);
                return (
                  <li key={sheet.value}>
                    <label className="sheetpick__row">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={saving}
                        onChange={() =>
                          setExSheets((chosen) =>
                            on
                              ? chosen.filter((v) => v !== sheet.value)
                              : [...chosen, sheet.value],
                          )
                        }
                      />
                      <span>
                        <span className="sheetpick__name">{sheet.label}</span>
                        <span className="sheetpick__hint">{sheet.hint}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="chips">
              {/* ปุ่มเดียวสลับสองทาง ไม่ใช่สองปุ่มข้างกัน — "เลือกทั้งหมด" ที่กดแล้ว
                  ไม่มีอะไรเปลี่ยนเพราะเลือกครบอยู่แล้ว คือปุ่มที่สอนว่ากดไปก็เท่านั้น */}
              <button
                type="button"
                className="btn btn--small sheetpick__all"
                onClick={() =>
                  setExSheets(exSheets.length === SHEETS.length ? [] : SHEETS.map((x) => x.value))
                }
                disabled={saving}
              >
                {exSheets.length === SHEETS.length ? "ไม่เอาสักชีต" : "เอาทุกชีต"}
              </button>
              <span className="sheetpick__count">
                เลือกไว้ {count(exSheets.length)} จาก {count(SHEETS.length)}
              </span>
            </div>

            {exportProblem ? (
              <div className="notice notice--error" role="alert">
                {exportProblem}
              </div>
            ) : null}

            <div className="chips sheetpick__go">
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => setPicking(false)}
                disabled={saving}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="btn btn--primary btn--icon"
                onClick={() => void exportBook()}
                disabled={saving || exSheets.length === 0}
              >
                <IconChart />
                {saving ? "กำลังสร้างไฟล์…" : `สร้างไฟล์ · ${count(exSheets.length)} ชีต`}
              </button>
            </div>
          </div>
        </TaskDialog>
      ) : null}

      {report.status === "loading" ? <div className="skeleton" /> : null}

      {report.status === "error" ? (
        <div className="empty">
          <p className="empty__title">โหลดสรุปไม่ได้</p>
          <p className="empty__body">{report.error}</p>
          <button type="button" className="btn" onClick={report.reload}>
            ลองใหม่
          </button>
        </div>
      ) : null}

      {report.status === "ready" ? (
        <>
          {/* --------------------------------------------------------- tiles */}

          <section className="readout" aria-label="สรุปสต็อกในช่วงนี้">
            <div className="readout__cell readout__cell--cyan">
              <p className="readout__label">จ่ายออก</p>
              <p className="readout__figure">{count(report.data.out.qty)}</p>
              <p className="readout__note">ชิ้น · {count(report.data.out.rows)} รายการ</p>
            </div>
            {/* สองการ์ดนี้ไม่มีมิติสาขา — ของเข้าคลังกลาง และของเสียเกิดที่นี่
                เลือกสาขาแล้วจึงหรี่ลงพร้อมบอกเหตุผล ดีกว่าปล่อยให้เลขศูนย์อ่าน
                เหมือนสาขานั้นไม่เคยรับของเข้าเลย ซึ่งไม่ใช่สิ่งที่มันแปล */}
            <div
              className={
                scopedToBranch
                  ? "readout__cell readout__cell--mint readout__cell--na"
                  : "readout__cell readout__cell--mint"
              }
            >
              <p className="readout__label">รับเข้า</p>
              <p className="readout__figure">
                {count(report.data.in.qty + report.data.return.qty)}
              </p>
              <p className="readout__note">
                {scopedToBranch
                  ? "การรับของเข้าไม่ผูกกับสาขา — ตัวเลขนี้กรองตามสาขาไม่ได้"
                  : `ชิ้น · รับเข้า ${count(report.data.in.rows)} · รับคืน ${count(report.data.return.rows)}`}
              </p>
            </div>
            <div
              className={
                scopedToBranch
                  ? "readout__cell readout__cell--coral readout__cell--na"
                  : "readout__cell readout__cell--coral"
              }
            >
              <p className="readout__label">ของเสีย</p>
              <p
                className={
                  report.data.scrap.qty > 0 && !scopedToBranch
                    ? "readout__figure readout__figure--signal"
                    : "readout__figure"
                }
              >
                {count(report.data.scrap.qty)}
              </p>
              <p className="readout__note">
                {scopedToBranch
                  ? "การตัดของเสียไม่ผูกกับสาขา — ตัวเลขนี้กรองตามสาขาไม่ได้"
                  : "ชิ้น · ไม่นับเป็นต้นทุนขาย"}
              </p>
            </div>
            {money$ ? (
              <div className="readout__cell readout__cell--pear">
                <p className="readout__label">ต้นทุนขาย</p>
                <p className="readout__figure">{money(report.data.out.value ?? 0)}</p>
                <p className="readout__note">
                  บาท · ลงตามวันที่ของออก
                  {report.data.out.qtyNoCost > 0
                    ? ` · อีก ${count(report.data.out.qtyNoCost)} ชิ้นยังไม่รู้ต้นทุน`
                    : ""}
                </p>
              </div>
            ) : (
              <div className="readout__cell readout__cell--pear">
                <p className="readout__label">สั่งตัด RX</p>
                <p className="readout__figure">{count(report.data.rxOrder.rows)}</p>
                <p className="readout__note">ใบสั่งที่เปิดในช่วงนี้</p>
              </div>
            )}
          </section>

          {money$ ? (
            <section className="readout" aria-label="ยอดขาย กำไร และหนี้ค้างรับ">
              {/* ยอดขายกับกำไรมาก่อนเสมอ และมาคู่กัน — ตัวเลขกำไรที่ไม่มียอดขาย
                  ยืนอยู่ข้าง ๆ คือตัวเลขที่ตรวจไม่ได้ว่าสมเหตุสมผลไหม · หน้านี้มี
                  "ต้นทุนขาย" อยู่แถวบนแล้ว สามตัวจึงครบสมการพอดี */}
              <div className="readout__cell readout__cell--mint">
                <p className="readout__label">ยอดขาย</p>
                <p className="readout__figure">{money(report.data.sales.revenue ?? 0)}</p>
                <p className="readout__note">
                  {report.data.sales.bills === 0
                    ? "บาท · ยังไม่มีรายการที่บันทึกราคาขายไว้ในช่วงนี้"
                    : `บาท จาก ${count(report.data.sales.bills)} รายการที่บันทึกราคาขายไว้`}
                </p>
              </div>

              <div className="readout__cell readout__cell--pear">
                <p className="readout__label">กำไร</p>
                <p className="readout__figure">
                  {report.data.sales.costed > 0 ? money(report.data.sales.profit ?? 0) : "—"}
                </p>
                <p className="readout__note">
                  {report.data.sales.costed === 0 ? (
                    report.data.sales.bills === 0
                      ? "ยังไม่มีรายการให้คิด"
                      : "ยังไม่มีรายการไหนที่รู้ทั้งราคาขายและต้นทุน — คิดกำไรไม่ได้"
                  ) : (
                    <>
                      {/* ฐานที่คิดต้องเดินคู่กับเปอร์เซ็นต์เสมอ — เปอร์เซ็นต์ที่ลอย
                          อยู่ข้างยอดขายจะถูกอ่านว่าเป็นอัตรากำไรของทั้งก้อน ทั้งที่
                          มันคิดจากยอดขายของเฉพาะใบที่รู้ต้นทุน */}
                      บาท · จาก {count(report.data.sales.costed)} รายการที่รู้ต้นทุน
                      {report.data.sales.margin !== null
                        ? ` (อัตรากำไร ${report.data.sales.margin}%)`
                        : ""}
                      {report.data.sales.uncosted > 0
                        ? ` · อีก ${count(report.data.sales.uncosted)} รายการยังไม่รู้ต้นทุน จึงไม่ได้นับ`
                        : ""}
                    </>
                  )}
                </p>
              </div>

              <div className="readout__cell readout__cell--coral">
                <p className="readout__label">ค้างรับอยู่ตอนนี้</p>
                <p
                  className={
                    report.data.branch.owingCount > 0
                      ? "readout__figure readout__figure--signal"
                      : "readout__figure"
                  }
                >
                  {count(report.data.branch.owingCount)}
                </p>
                <p className="readout__note">
                  รายการ · ต้นทุน {money(report.data.branch.owingCost ?? 0)} บาท ·{" "}
                  <Link href="/stock/settlements" className="grid__link">
                    เปิดดู
                  </Link>
                </p>
              </div>
            </section>
          ) : null}

          {/* -------------------------------------------------------- charts */}

          <div className="panels">
            <section className="panel">
              <div className="panel__head">
                <h2 className="panel__title">ของเข้า–ออกรายวัน</h2>
                <span className="panel__note">เหนือเส้นคือเข้า ใต้เส้นคือออก</span>
              </div>
              <FlowChart days={days} />
            </section>

            <section className="panel">
              <div className="panel__head">
                <h2 className="panel__title">ของเสียรายวัน</h2>
                <span className="panel__note">แยกจากต้นทุนขาย</span>
              </div>
              {/* Its own chart rather than a third line on the one above: green
                  against red is the pair colourblind readers lose first, so the
                  two are never asked to share a plot. */}
              <DayBars
                days={days}
                pick={(d) => d.scrapQty}
                label="ของเสีย"
                ink={CHART_INK.scrap}
                unit="ชิ้น"
              />
            </section>

            {money$ ? (
              <section className="panel">
                <div className="panel__head">
                  <h2 className="panel__title">ต้นทุนขายรายวัน</h2>
                  <span className="panel__note">บาท · ลงตามวันที่ของออก</span>
                </div>
                {/* Money and pieces never share an axis — two scales on one plot
                    is the chart mistake that makes both unreadable. */}
                <DayBars
                  days={days}
                  pick={(d) => d.cogs ?? 0}
                  label="ต้นทุนขาย"
                  ink={CHART_INK.cost}
                  format={money}
                  unit="บาท"
                />
              </section>
            ) : null}

            <section className="panel">
              <div className="panel__head">
                <h2 className="panel__title">สินค้าขายดี</h2>
                <span className="panel__note">สูงสุด 10 รายการ · พร้อมยอดที่เหลือตอนนี้</span>
              </div>
              {/* Read from `/movers` rather than from the report's own
                  `topProducts`, which counts the same thing. The two agree, but
                  only one of them also knows what is left on the shelf — and
                  "sold thirty, four left, minimum is ten" is a buying decision
                  where "sold thirty" is only a fact. */}
              <RankBars
                ink={CHART_INK.out}
                unit="ชิ้น"
                rows={(movers.status === "ready" ? movers.data.best : []).slice(0, 10).map((p) => {
                  const low = p.onHand <= p.minStock;
                  return {
                    key: String(p.id),
                    label: p.name,
                    sub:
                      `${p.sku} · เหลือ ${count(p.onHand)}` +
                      (low ? (p.minStock > 0 ? ` · ต่ำกว่าขั้นต่ำ ${count(p.minStock)}` : " · ของหมด") : "") +
                      (money$ && p.cost ? ` · ต้นทุน ${money(p.cost)}` : ""),
                    value: p.qty,
                  };
                })}
              />
            </section>

            <section className="panel">
              <div className="panel__head">
                <h2 className="panel__title">ใครเบิกมากที่สุด</h2>
                <span className="panel__note">นับทั้งเบิกและตัดของเสีย</span>
              </div>
              <RankBars
                ink={CHART_INK.in}
                unit="ชิ้น"
                rows={report.data.topPeople.map((p) => ({
                  key: p.name,
                  label: p.name,
                  sub: `${count(p.rows)} รายการ`,
                  value: p.qty,
                }))}
              />
            </section>

            {/* ของเสียแยกออกมาเป็นแผงของตัวเอง ไม่รวมกับแผงข้างบน — ของที่เบิก
                ออกไปคืองานที่ทำ ยิ่งเยอะยิ่งดี ส่วนของเสียคือของที่หายไปจาก
                ร้าน สองอย่างนี้อ่านคนละความหมาย รวมเป็นแท่งเดียวเมื่อไหร่คน
                ขายเก่งกับคนทำแตกบ่อยจะขึ้นหัวตารางเดียวกัน

                ไม่มีของเสียในช่วงที่เลือก = ไม่ต้องมีแผงนี้ · แผงเปล่าที่เขียน
                ว่า "ไม่มีข้อมูล" อ่านเหมือนระบบเสีย ทั้งที่เป็นข่าวดี */}
            {report.data.scrapPeople.length > 0 ? (
              <section className="panel">
                <div className="panel__head">
                  <h2 className="panel__title">ของเสีย แยกตามคนที่ทำ</h2>
                  <span className="panel__note">
                    เฉพาะใบที่ระบุชื่อคนทำไว้ · เจ้าของร้านเป็นคนระบุตอนตัด
                  </span>
                </div>
                <RankBars
                  ink={CHART_INK.scrap}
                  unit="ชิ้น"
                  rows={report.data.scrapPeople.map((p) => ({
                    key: p.name,
                    label: p.name,
                    sub:
                      `${count(p.rows)} รายการ` +
                      (money$ && p.cost ? ` · มูลค่า ${money(p.cost)}` : ""),
                    value: p.qty,
                  }))}
                />
              </section>
            ) : null}
          </div>

          {/* --------------------------------------- what each branch took */}

          {/* ยอดรวมของฝั่งสาขาอยู่ในการ์ดข้างบนแล้ว — ตรงนี้คือของจริงที่ออกไป
              แยกทีละสาขาทีละรายการ · ก่อนหน้านี้คำถาม "เดือนนี้สาขานี้ขอเลนส์
              อะไรไปบ้าง" ตอบได้ที่เดียวคือเปิดหน้าค้างรับแล้วไล่อ่านทีละใบ

              ไม่มีสาขาเบิกในช่วงที่เลือก = ไม่ต้องมีตาราง · ตารางเปล่าที่เขียน
              ว่า "ไม่มีข้อมูล" กินที่เท่าตารางจริงและไม่ได้บอกอะไรเพิ่ม */}
          {report.status === "ready" && report.data.branchDraws.length > 0 ? (
            <section className="task task--wide">
              <div className="tasktools">
                <h2 className="drawer__legend">สาขาเบิกอะไรไปบ้าง</h2>
              </div>
              <p className="field__help">
                นับทุกใบที่ออกไปในช่วงนี้ ไม่ว่ารับเงินแล้วหรือยัง — ยกเว้นใบที่ยกเลิก
                เพราะของกลับเข้าคลังไปแล้ว
              </p>

              {report.data.branchDraws.map((b) => (
                /* กางไว้ก็ต่อเมื่อมีสาขาเดียว — สิบสาขาที่กางหมดคือหน้าที่ต้อง
                   เลื่อนผ่านทุกสาขาเพื่อดูสาขาเดียว · หัวที่พับอยู่ยังบอกยอดรวม
                   ครบ คนที่ถามแค่ "สาขาไหนเบิกเยอะ" จึงไม่ต้องกางอะไรเลย */
                <details className="fold" key={b.branchId} open={report.data.branchDraws.length === 1}>
                  {/* ชื่อสาขาเป็นหัวข้อเหนือตาราง ไม่ใช่ <caption> ในตาราง —
                      caption ที่มองเห็นได้จะถูกจัดกึ่งกลางตามค่าปริยายของ
                      เบราว์เซอร์ และลอยอยู่เหนือหัวคอลัมน์แบบไม่มีที่ยึด
                      ผิดจากหัวข้ออื่นทั้งหน้าซึ่งชิดซ้ายเสมอ */}
                  <summary className="fold__head">
                    <h3 className="panel__title">{b.branch}</h3>
                    <span className="panel__note">
                      {count(b.draws)} ใบ · {count(b.qty)} ชิ้น
                      {money$ && b.cost !== null ? ` · ต้นทุนรวม ${money(b.cost)}` : ""}
                      {b.qtyNoCost > 0 ? ` · ${count(b.qtyNoCost)} ชิ้นยังไม่รู้ต้นทุน` : ""}
                    </span>
                  </summary>
                  <CardList label={`สินค้าที่ ${b.branch} เบิกไป`}>
                    {b.items.map((it) => (
                      <RecordCard
                        key={`m-${b.branchId}-${it.sku}`}
                        head={<span className="reccard__money">{count(it.qty)}</span>}
                        title={it.name}
                        sub={it.sku}
                        fields={[
                          { label: "ชนิด", value: PRODUCT_TYPE_LABEL[it.type ?? ""] ?? it.type ?? "—" },
                          { label: "เบิกไปกี่ครั้ง", value: count(it.draws) },
                          money$ && it.cost !== null ? { label: "ต้นทุนรวม", value: money(it.cost) } : null,
                          it.qtyNoCost > 0
                            ? { label: "ยังไม่รู้ต้นทุน", value: `${count(it.qtyNoCost)} ชิ้น` }
                            : null,
                        ]}
                      />
                    ))}
                  </CardList>

                  <Paged rows={b.items} label="รายการ">
                  {(items) => (
                  <div className="tablewrap wide-only">
                  <table className="grid">
                    <caption className="sr-only">{`สินค้าที่ ${b.branch} เบิกไป`}</caption>
                    <thead>
                      <tr>
                        <th scope="col">สินค้า</th>
                        <th scope="col">ชนิด</th>
                        <th scope="col">สเปกเลนส์</th>
                        <th scope="col" className="grid__num">ครั้ง</th>
                        <th scope="col" className="grid__num">จำนวน</th>
                        {money$ ? <th scope="col" className="grid__num">ต้นทุนรวม</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={`${b.branchId}-${it.sku}`} className="grid__row">
                          <td>
                            {it.name}
                            <span className="grid__sub">{it.sku}</span>
                          </td>
                          <td>{it.type ? PRODUCT_TYPE_LABEL[it.type] ?? it.type : "—"}</td>
                          {/* ชนิดเลนส์ · index · coating — สามอย่างที่ทำให้เลนส์
                              สองตัวคนละตัวกัน ต่อกันด้วยจุดกลางเหมือนที่อื่น */}
                          <td>
                            {[it.lensDesign, it.lensIndex, it.coating].filter(Boolean).join(" · ") ||
                              "—"}
                          </td>
                          <td className="grid__num">{count(it.draws)}</td>
                          <td className="grid__num">
                            {count(it.qty)}
                            {it.qtyNoCost > 0 ? (
                              <span className="grid__sub">{count(it.qtyNoCost)} ยังไม่รู้ต้นทุน</span>
                            ) : null}
                          </td>
                          {money$ ? (
                            <td className="grid__num">
                              {it.cost === null ? <span className="grid__muted">—</span> : money(it.cost)}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                  )}
                  </Paged>
                </details>
              ))}
            </section>
          ) : null}

          {/* ------------------------------------ what each branch ordered */}

          {/* คู่กับตารางข้างบน และตั้งใจให้หน้าตาเหมือนกัน: ข้างบนคือของที่ออก
              จากชั้นไป ตรงนี้คือของที่ต้องไปสั่งมาให้ · TimeOptic อยู่ในลิสต์
              เดียวกับสาขา เพราะคำถามคือ "งานสั่งตัดทั้งหมดแบ่งกันอย่างไร" ซึ่ง
              ตอบไม่ได้ถ้าก้อนที่ใหญ่ที่สุดไม่อยู่ในตาราง */}
          {report.status === "ready" && report.data.rxBranches.length > 0 ? (
            <section className="task task--wide">
              <div className="tasktools">
                <h2 className="drawer__legend">ใครสั่งตัด RX ไปเท่าไร</h2>
              </div>
              <p className="field__help">
                ใบสั่งตัดที่เปิดในช่วงนี้ ยกเว้นใบที่ยกเลิก — TimeOptic คือใบที่ร้านสั่งเอง
              </p>

              {report.data.rxBranches.map((b) => (
                <details
                  className="fold"
                  key={b.branchId ?? "self"}
                  open={report.data.rxBranches.length === 1}
                >
                  <summary className="fold__head">
                    <h3 className="panel__title">{b.branch}</h3>
                    <span className="panel__note">
                      {count(b.orders)} ใบ · {count(b.qty)} ชิ้น
                      {money$ && b.cost !== null ? ` · ต้นทุนรวม ${money(b.cost)}` : ""}
                      {money$ && b.revenue !== null ? ` · ราคาขายรวม ${money(b.revenue)}` : ""}
                      {b.awaitingCost > 0 ? ` · ${count(b.awaitingCost)} ใบยังไม่ลงต้นทุน` : ""}
                    </span>
                  </summary>
                  <CardList label={`เลนส์ที่ ${b.branch} สั่งตัด`}>
                    {b.items.map((it) => (
                      <RecordCard
                        key={`mr-${b.branchId}-${it.sku}`}
                        head={<span className="reccard__money">{count(it.qty)}</span>}
                        title={it.name}
                        sub={it.sku}
                        fields={[
                          { label: "ชนิด", value: PRODUCT_TYPE_LABEL[it.type ?? ""] ?? it.type ?? "—" },
                          { label: "ใบสั่ง", value: count(it.orders) },
                          money$ && it.cost !== null ? { label: "ต้นทุนรวม", value: money(it.cost) } : null,
                          money$ && it.revenue !== null ? { label: "ราคาขายรวม", value: money(it.revenue) } : null,
                          it.awaitingCost > 0
                            ? { label: "ยังไม่ลงต้นทุน", value: `${count(it.awaitingCost)} ใบ` }
                            : null,
                        ]}
                      />
                    ))}
                  </CardList>

                  <Paged rows={b.items} label="รายการ">
                  {(items) => (
                  <div className="tablewrap wide-only">
                  <table className="grid">
                    <caption className="sr-only">{`เลนส์ที่ ${b.branch} สั่งตัด`}</caption>
                    <thead>
                      <tr>
                        <th scope="col">เลนส์</th>
                        <th scope="col">ชนิด</th>
                        <th scope="col">สเปกเลนส์</th>
                        <th scope="col" className="grid__num">ใบสั่ง</th>
                        <th scope="col" className="grid__num">จำนวน</th>
                        {money$ ? <th scope="col" className="grid__num">ต้นทุนรวม</th> : null}
                        {money$ ? <th scope="col" className="grid__num">ราคาขายรวม</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={`${b.branchId ?? "self"}-${it.sku}`} className="grid__row">
                          <td>
                            {it.name}
                            <span className="grid__sub">{it.sku}</span>
                          </td>
                          <td>{it.type ? PRODUCT_TYPE_LABEL[it.type] ?? it.type : "—"}</td>
                          <td>
                            {[it.lensDesign, it.lensIndex, it.coating].filter(Boolean).join(" · ") ||
                              "—"}
                          </td>
                          <td className="grid__num">
                            {count(it.orders)}
                            {it.awaitingCost > 0 ? (
                              <span className="grid__sub">{count(it.awaitingCost)} รอลงต้นทุน</span>
                            ) : null}
                          </td>
                          <td className="grid__num">{count(it.qty)}</td>
                          {money$ ? (
                            <td className="grid__num">
                              {it.cost === null ? <span className="grid__muted">—</span> : money(it.cost)}
                            </td>
                          ) : null}
                          {money$ ? (
                            <td className="grid__num">
                              {it.revenue === null ? (
                                <span className="grid__muted">—</span>
                              ) : (
                                money(it.revenue)
                              )}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                  )}
                  </Paged>
                </details>
              ))}
            </section>
          ) : null}

          {/* ------------------------------------------- what to buy next */}

          {/* The one question the charts above cannot answer. Every one of
              them is about the days on screen; this is about the shelf as it
              stands, and no date range makes a drawer that has not moved since
              January any fresher. */}

          <section className="task task--wide">
            <div className="tasktools">
              <h2 className="drawer__legend">ค้างสต๊อกนาน</h2>
              <div className="sortbar">
                <label className="sortbar__label" htmlFor="db-idle">
                  นับว่าค้างเมื่อ
                </label>
                <Select
                  id="db-idle"
                  className="sortbar__pick"
                  value={idle}
                  onChange={setIdle}
                  options={IDLE}
                />
              </div>
            </div>

            {movers.status === "loading" ? <div className="skeleton" /> : null}

            {movers.status === "error" ? (
              <div className="notice notice--error" role="alert">
                {movers.error}
              </div>
            ) : null}

            {/* The one section on this page the date range does not govern, and
                it says so out loud. Something that has not moved since January
                is not made fresh by looking at March, so tying this to the
                picker at the top would make the answer depend on which month
                someone happened to be reading. */}
            <p className="field__help">
              ส่วนนี้ไม่ขึ้นกับช่วงวันที่ด้านบน — ของที่นิ่งมาตั้งแต่มกราไม่ได้สดขึ้นเพราะไปมองเดือนมีนาคม
            </p>

            {movers.status === "ready" ? (
              movers.data.slow.length === 0 ? (
                <p className="field__help">
                  ไม่มีสินค้าไหนค้างเกิน {span(movers.data.idleDays)} — ของในคลังหมุนอยู่
                </p>
              ) : (
                <>
                <CardList label="สินค้าที่มีของแต่ไม่ได้จ่ายออกมานาน">
                  {movers.data.slow.map((r) => (
                    <RecordCard
                      key={`slow-${r.id}`}
                      head={
                        <>
                          <span className="reccard__money">{span(r.idleDays)}</span>
                          <span className="reccard__when">ไม่ขยับ</span>
                        </>
                      }
                      title={r.name}
                      sub={[r.sku, r.brand].filter(Boolean).join(" · ")}
                      fields={[
                        { label: "ชนิด", value: PRODUCT_TYPE_LABEL[r.productType] ?? r.productType },
                        { label: "คงเหลือ", value: count(r.onHand) },
                        money$ && r.stockValue !== null
                          ? { label: "จมทุนอยู่", value: money(r.stockValue) }
                          : null,
                        {
                          label: "จ่ายออกครั้งสุดท้าย",
                          value: r.lastOut ? date(r.lastOut) : <span className="grid__muted">ยังไม่เคยขาย</span>,
                        },
                      ]}
                    />
                  ))}
                </CardList>

                <Paged rows={movers.data.slow} label="รายการ">
                {(items) => (
                <div className="tablewrap wide-only">
                  <table className="grid">
                    <caption className="sr-only">
                      สินค้าที่มีของแต่ไม่ได้จ่ายออกมานาน
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">สินค้า</th>
                        <th scope="col">ชนิด</th>
                        <th scope="col" className="grid__num">คงเหลือ</th>
                        {money$ ? <th scope="col" className="grid__num">จมทุนอยู่</th> : null}
                        <th scope="col">จ่ายออกครั้งสุดท้าย</th>
                        <th scope="col" className="grid__num">ค้างมาแล้ว</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((r) => (
                        <tr key={r.id} className="grid__row">
                          <th scope="row">
                            <span className="grid__name">{r.name}</span>
                            <span className="grid__sub">{r.sku}</span>
                          </th>
                          <td>{PRODUCT_TYPE_LABEL[r.productType] ?? r.productType}</td>
                          <td className="grid__num">{count(r.onHand)}</td>
                          {money$ ? (
                            <td className="grid__num">
                              {money(r.stockValue ?? 0)}
                              {/* Part of this row's money is unknown rather than
                                  zero. Saying so stops the total reading as the
                                  answer when it is only the part that is known. */}
                              {r.lotsMissingCost > 0 ? (
                                <span className="grid__floor">
                                  อีก {count(r.lotsMissingCost)} ล็อตยังไม่รู้ต้นทุน
                                </span>
                              ) : null}
                            </td>
                          ) : null}
                          <td>
                            {r.lastOut === null ? (
                              // Never sold since it arrived — the worst case
                              // here, and the one a date column would hide.
                              <span className="status status--low">ยังไม่เคยขายเลย</span>
                            ) : (
                              date(r.lastOut)
                            )}
                          </td>
                          <td className="grid__num">
                            <span className="grid__num--signal">{span(r.idleDays)}</span>
                            {r.oldestLot ? (
                              <span className="grid__floor">รับเข้า {date(r.oldestLot)}</span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                )}
                </Paged>
                </>
              )
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
