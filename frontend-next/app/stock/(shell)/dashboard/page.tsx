"use client";

import { useState } from "react";
import Link from "next/link";
import { can, useActor, WorkHead } from "@/stockmod/components/AppShell";
import Select from "@/stockmod/components/Select";
import { CHART_INK, DayBars, FlowChart, RankBars } from "@/stockmod/components/Charts";
import { qs, useApi } from "@/stockmod/lib/useApi";
import { count, date, money } from "@/stockmod/lib/format";
import { PRODUCT_TYPE_LABEL, PRODUCT_TYPES, type Movers } from "@/stockmod/lib/api";
import DateRangeField from "@/stockmod/components/DateRangeField";
import PickList from "@/stockmod/components/PickList";
import { IconCalendar, IconChart } from "@/stockmod/components/Icon";
import { Filter, FilterBar } from "@/stockmod/components/FilterBar";
import { download, type Mode, type Sheet } from "@/stockmod/lib/workbook";
import { daysPng, INK, rankPng } from "@/stockmod/lib/chartimage";

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
 * มีรายการนี้เพราะการกดปุ่มเดียวแล้วได้แปดชีตคือการส่งของที่ไม่มีใครขอไปเจ็ดใบ
 * คนที่ขอไฟล์ขอเป็นเรื่อง — "เดือนนี้สาขาไหนเบิกอะไรไป" ไม่ใช่ "ทุกอย่าง"
 *
 * `whole` คือชีตที่เป็นคำถามของทั้งร้าน ไม่มีคอลัมน์สาขาหรือชนิดสินค้าให้กรอง
 * พอเลือกตัวกรองแล้วมันจะหลุดออกจากไฟล์เอง ดูเหตุผลตอนประกอบไฟล์
 */
const SHEETS: readonly { value: string; label: string; hint: string; whole?: true }[] = [
  { value: "สรุปรายการ", label: "สรุปรายการ", hint: "รับเข้า จ่ายออก ของเสีย คืน ปรับยอด RX", whole: true },
  { value: "รายวัน", label: "รายวัน", hint: "เข้า–ออก–เสีย และต้นทุนขาย ทีละวัน", whole: true },
  { value: "ต้นทุนรวมแยกตามสาขา", label: "ต้นทุนรวมแยกตามสาขา", hint: "สาขาละแถว เอาไปดูว่าใครเบิกหนักสุด" },
  { value: "สาขาเบิกอะไรไป", label: "สาขาเบิกอะไรไป", hint: "แถวละสินค้า มีแถวรวมย่อยของแต่ละสาขา" },
  { value: "ใครสั่งตัด RX", label: "ใครสั่งตัด RX", hint: "ใบสั่งตัดแยกตามคนสั่ง รวม TimeOptic" },
  { value: "สินค้าจ่ายออกมากสุด", label: "สินค้าจ่ายออกมากสุด", hint: "สิบอันดับแรกของช่วงนี้", whole: true },
  { value: "ใครเบิกมากสุด", label: "ใครเบิกมากสุด", hint: "นับทั้งการเบิกและการตัดของเสีย", whole: true },
  { value: "ของเสียแยกตามคน", label: "ของเสียแยกตามคน", hint: "เฉพาะใบที่ระบุชื่อคนทำไว้", whole: true },
];
const PRESETS = [
  { key: "today", label: "วันนี้", range: () => ({ from: shift(0), to: shift(0) }) },
  { key: "yesterday", label: "เมื่อวาน", range: () => ({ from: shift(-1), to: shift(-1) }) },
  { key: "7d", label: "7 วันล่าสุด", range: () => ({ from: shift(-6), to: shift(0) }) },
  { key: "30d", label: "30 วันล่าสุด", range: () => ({ from: shift(-29), to: shift(0) }) },
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
   * การเขียน .xlsx เกิดในเบราว์เซอร์ ไม่ใช่ที่เซิร์ฟเวอร์ — ช่วงยาว ๆ ที่มีกราฟ
   * ด้วยใช้เวลาหลายวินาที ปุ่มที่ไม่บอกอะไรระหว่างนั้นจะถูกกดซ้ำแล้วได้ไฟล์
   * ซ้อนกันสามใบ
   */
  const [saving, setSaving] = useState(false);
  const [exportProblem, setExportProblem] = useState<string | null>(null);

  /**
   * ตัวกรองของไฟล์ Excel — ไม่ใช่ของหน้าจอ
   *
   * ช่วงวันที่อยู่ข้างบนแล้วและมีผลกับทั้งหน้า · สองตัวนี้ต่างออกไป: มันแคบลง
   * เฉพาะตอนสร้างไฟล์ เพราะคนที่ขอไฟล์มักขอเป็นเรื่อง ๆ ("เดือนนี้สาขาบ่อนไก่
   * เอาเลนส์ไปเท่าไร") ส่วนคนที่เปิดหน้านี้อยากเห็นทั้งร้านพร้อมกัน
   *
   * เลือกแล้วชีตที่ตอบคำถามนั้นไม่ได้จะไม่อยู่ในไฟล์ ไม่ใช่อยู่แบบไม่กรอง —
   * สมุดที่ครึ่งหนึ่งเชื่อฟังตัวกรองและอีกครึ่งไม่เชื่อ คือสมุดที่บวกข้ามชีตแล้ว
   * ได้เลขที่ไม่ตรงกับอะไรเลย
   */
  const [exBranch, setExBranch] = useState("");
  const [exType, setExType] = useState("");
  /* เลือกไว้ครบตอนเริ่ม เพราะคนที่ยังไม่รู้ว่ามีอะไรบ้างจะได้เห็นทั้งหมดก่อน
     แล้วค่อยตัดออก — ตรงข้ามกับเริ่มจากว่าง ซึ่งกดปุ่มแล้วได้ไฟล์เปล่า */
  const [exSheets, setExSheets] = useState<string[]>(() => SHEETS.map((s) => s.value));

  const report = useApi<Report>(`/report${qs({ from, to })}`);
  const movers = useApi<Movers>(`/movers${qs({ from, to, idle })}`);


  function useRange(next: { from: string; to: string }, key: string) {
    setFrom(next.from);
    setTo(next.to);
    setPreset(key);
  }


  /**
   * ทั้งหน้า ลงเป็นไฟล์ Excel — ชีตละเรื่อง มีแถวรวม เลือกได้ว่าจะเอากราฟด้วยไหม
   *
   * ประกอบจากตัวเลขชุดเดียวกับที่วาดอยู่บนจอ ไม่ใช่ยิงถามใหม่ — ไฟล์ที่ได้จึง
   * ตรงกับสิ่งที่คนกดกำลังมองอยู่เสมอ แม้ข้อมูลจะเปลี่ยนไปแล้วในวินาทีนั้น
   *
   * ราคาทุนลงไฟล์เฉพาะคนที่เห็นมันบนจอ · API ตัดตัวเลขพวกนี้ออกจากคำตอบให้คน
   * อื่นอยู่แล้ว ตรงนี้จึงไม่ใช่ด่าน แต่ถ้าไม่เช็คก็จะได้คอลัมน์เปล่า ๆ ที่อ่าน
   * เหมือนของฟรีทั้งคลัง
   *
   * กราฟถูกวาดตอนกด ไม่ได้เตรียมไว้ล่วงหน้า — คนส่วนใหญ่กดโหลดข้อมูลอย่างเดียว
   * และการวาดภาพเจ็ดใบทิ้งไว้เผื่อทุกครั้งที่เปิดหน้าคือการทำงานที่ไม่มีใครขอ
   */
  async function exportBook(mode: Mode) {
    if (report.status !== "ready" || saving) return;
    const d = report.data;

    setSaving(true);
    setExportProblem(null);
    try {
      // ตัวเลขดิบ ไม่ผ่านตัวจัดรูปแบบ — Excel ต้องได้จำนวนไว้บวก ไม่ใช่ข้อความ
      // ที่มีลูกน้ำคั่นหลักแล้วรวมไม่ได้ · คนที่ไม่มีสิทธิ์เห็นทุนได้ช่องว่าง
      const cost$ = (v: number | null) => (money$ && v !== null ? v : null);
      const wantCharts = mode !== "data";
      const day = (s: string) => s.slice(5).replace("-", "/");

      /**
       * ตัวกรองของไฟล์ ตัดข้อมูลก่อนสร้างชีต
       *
       * `exBranch` เป็น id ของสาขา หรือ "self" สำหรับใบที่ TimeOptic สั่งเอง
       * ซึ่งไม่มี id เพราะร้านตัวเองไม่ใช่สาขา
       */
      const keepBranch = (id: number | null) =>
        exBranch === "" || (exBranch === "self" ? id === null : String(id) === exBranch);
      const keepType = (t: string | null) => exType === "" || t === exType;

      /* สาขาละก้อน โดยข้างในเหลือเฉพาะสินค้าชนิดที่เลือก · ยอดรวมของก้อนถูกบวก
         ใหม่จากรายการที่เหลือ ไม่ใช่ยอดเดิมที่ API ส่งมา — ยอดเดิมคือทั้งสาขา
         และวางไว้บนตารางที่กรองแล้วคือตัวเลขที่บวกจากแถวข้างล่างไม่ได้ */
      const draws = d.branchDraws
        .filter((b) => keepBranch(b.branchId))
        .map((b) => {
          const items = b.items.filter((it) => keepType(it.type));
          return {
            ...b,
            items,
            draws: items.reduce((n, it) => n + it.draws, 0),
            qty: items.reduce((n, it) => n + it.qty, 0),
            qtyNoCost: items.reduce((n, it) => n + it.qtyNoCost, 0),
            cost: items.reduce<number | null>(
              (n, it) => (n === null || it.cost === null ? null : n + it.cost),
              0,
            ),
          };
        })
        .filter((b) => b.items.length > 0);

      const rx = d.rxBranches
        .filter((b) => keepBranch(b.branchId))
        .map((b) => {
          const items = b.items.filter((it) => keepType(it.type));
          return {
            ...b,
            items,
            orders: items.reduce((n, it) => n + it.orders, 0),
            qty: items.reduce((n, it) => n + it.qty, 0),
            awaitingCost: items.reduce((n, it) => n + it.awaitingCost, 0),
            cost: items.reduce<number | null>(
              (n, it) => (n === null || it.cost === null ? null : n + it.cost),
              0,
            ),
            revenue: items.reduce<number | null>(
              (n, it) => (n === null || it.revenue === null ? null : n + it.revenue),
              0,
            ),
          };
        })
        .filter((b) => b.items.length > 0);

      /* ชีตที่ไม่มีมิติสาขาหรือชนิดสินค้าอยู่ในตัว — สรุปรายการ รายวัน สินค้า
         ขายดี ใครเบิก ของเสียแยกตามคน · พวกนี้ตอบคำถามของทั้งร้าน กรองไม่ได้
         และการปล่อยให้อยู่ในไฟล์ที่กรองแล้วคือการบอกว่ามันถูกกรองด้วย */
      const scoped = exBranch !== "" || exType !== "";

      const branchLabel =
        exBranch === "" ? null
          : exBranch === "self" ? "TimeOptic"
          : (d.branchDraws.find((b) => String(b.branchId) === exBranch)?.branch
             ?? d.rxBranches.find((b) => String(b.branchId) === exBranch)?.branch
             ?? "สาขา");
      const typeLabel = exType === "" ? null : (PRODUCT_TYPE_LABEL[exType] ?? exType);
      const scope = [branchLabel, typeLabel].filter(Boolean).join(" · ");
      const scopeNote = scope === "" ? "" : ` · เฉพาะ ${scope}`;

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
          rows: (
            [
              ["รับเข้า", d.in],
              ["จ่ายออก", d.out],
              ["ตัดของเสีย", d.scrap],
              ["คืนของ", d.return],
              ["ปรับยอด", d.adjust],
              ["ใบสั่งตัด RX", d.rxOrder],
            ] as const
          ).map(([label, s]) => [label, s.rows, s.qty, cost$(s.value), s.qtyNoCost]),
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
          chart: wantCharts
            ? daysPng(
                d.byDay.map((r) => day(r.day)),
                [
                  { label: "รับเข้า", color: INK.in, values: d.byDay.map((r) => r.inQty) },
                  { label: "จ่ายออก", color: INK.out, values: d.byDay.map((r) => r.outQty) },
                  { label: "ของเสีย", color: INK.scrap, values: d.byDay.map((r) => r.scrapQty) },
                ],
                `ความเคลื่อนไหวรายวัน ${d.from} ถึง ${d.to}`,
              )
            : undefined,
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
          chart: wantCharts
            ? rankPng(
                draws.map((b) => ({
                  label: b.branch,
                  sub: `${b.draws} ใบ`,
                  value: b.qty,
                })),
                INK.out,
                "ชิ้น",
                "สาขาไหนเบิกไปเท่าไร",
              )
            : undefined,
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
          chart: wantCharts
            ? rankPng(
                draws.map((b) => ({
                  label: b.branch,
                  sub: `${b.draws} ใบ`,
                  value: b.qty,
                })),
                INK.out,
                "ชิ้น",
                "สาขาเบิกไปเท่าไร",
              )
            : undefined,
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
          chart: wantCharts
            ? rankPng(
                rx.map((b) => ({
                  label: b.branch,
                  sub: `${b.qty} ชิ้น`,
                  value: b.orders,
                })),
                INK.cost,
                "ใบ",
                "ใครสั่งตัด RX ไปกี่ใบ",
              )
            : undefined,
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
          chart: wantCharts
            ? rankPng(
                d.topProducts.map((p) => ({ label: p.name, sub: p.sku, value: p.qty })),
                INK.out,
                "ชิ้น",
                "สินค้าที่จ่ายออกมากที่สุด",
              )
            : undefined,
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
          chart: wantCharts
            ? rankPng(
                d.topPeople.map((p) => ({ label: p.name, sub: `${p.rows} รายการ`, value: p.qty })),
                INK.in,
                "ชิ้น",
                "ใครเบิกมากที่สุด",
              )
            : undefined,
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
          chart: wantCharts
            ? rankPng(
                d.scrapPeople.map((p) => ({
                  label: p.name,
                  sub: `${p.rows} รายการ`,
                  value: p.qty,
                })),
                INK.scrap,
                "ชิ้น",
                "ของเสีย แยกตามคนที่ทำ",
              )
            : undefined,
        },
      ];

      /* ห้าชีตนี้เป็นคำถามของทั้งร้าน — ไม่มีคอลัมน์สาขาและไม่มีคอลัมน์ชนิดสินค้า
         ให้กรอง · ตอนไม่ได้เลือกอะไรมันคือครึ่งหนึ่งของประโยชน์ของไฟล์ ตอนเลือก
         แล้วมันคือตัวเลขทั้งร้านที่นั่งอยู่ข้างตัวเลขที่กรองแล้ว ซึ่งอ่านผิดง่าย
         กว่าไม่มี · ชีตที่กรองแล้วไม่เหลือแถวก็ตัดออกด้วยเหตุผลเดียวกัน */
      const wholeShop = SHEETS.filter((s) => s.whole).map((s) => s.value);
      const book = sheets
        // ที่ผู้ใช้เลือกไว้ก่อน — ทุกอย่างหลังจากนี้คือการตัดออกด้วยเหตุผลอื่น
        .filter((s) => exSheets.includes(s.name))
        .filter((s) => (scoped ? !wholeShop.includes(s.name) : true))
        .filter((s) => s.rows.length > 0)
        // ตัวกรองเขียนไว้ใต้ชื่อชีตทุกใบ — ไฟล์ที่ถูกส่งต่อไปอีกสองมือต้องบอก
        // ตัวเองได้ว่ามันคือข้อมูลของอะไร โดยไม่ต้องถามคนที่กดปุ่ม
        .map((s) => ({ ...s, note: `${s.note ?? ""}${scopeNote}`.trim() || undefined }));

      if (book.length === 0) {
        setExportProblem(
          exSheets.length === 0
            ? "ยังไม่ได้เลือกว่าจะเอาชีตไหน — เลือกอย่างน้อยหนึ่งอย่างที่ช่อง \"เอาอะไรลงไฟล์\""
            : `ไม่มีข้อมูลใน ${d.from} ถึง ${d.to}${scopeNote} — ลองขยายช่วงวัน เอาตัวกรองออก หรือเลือกชีตเพิ่ม`,
        );
        return;
      }

      /* ชื่อไฟล์บอกโหมดด้วย — สามปุ่มที่ให้ชื่อเดียวกันคือสามไฟล์ที่ Chrome ต่อ
         ท้ายเป็น (1) (2) แล้วเปิดมาแยกไม่ออกว่าอันไหนมีกราฟ ทั้งที่ข้างในต่างกัน
         ตัวกรองก็อยู่ในชื่อด้วย ด้วยเหตุผลเดียวกัน */
      const suffix = { data: "ข้อมูล", both: "ข้อมูล+กราฟ", charts: "กราฟ" }[mode];
      const tag = scope === "" ? "" : `-${scope.replace(/ · /g, "-")}`;

      await download(
        `timeoptic-dashboard-${d.from}-ถึง-${d.to}${tag}-${suffix}.xlsx`,
        `แดชบอร์ด ${d.from} ถึง ${d.to}${scopeNote}`,
        book,
        mode,
      );
    } catch (e) {
      setExportProblem(e instanceof Error ? e.message : "สร้างไฟล์ไม่สำเร็จ");
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
      <WorkHead
        title="แดชบอร์ด"
        lede="สรุปความเคลื่อนไหวตามช่วงวันที่ จบด้วยของที่ควรสั่งเพิ่มและของที่กองอยู่เฉย ๆ"
      >
        {/* The per-row ledger lives on its own screen. It used to be repeated
            at the foot of this page under the very charts drawn from it, which
            made the dashboard scroll past its own summary to show the rows the
            summary was for. */}
        <Link href="/stock/movements" className="btn">
          ดูความเคลื่อนไหวรายการ
        </Link>
      </WorkHead>

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
          <span className="toolbar__title">ดูข้อมูลช่วง</span>

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
            {/* ชิปที่ไม่ได้ตั้งช่วงเอง แค่บอกว่าตอนนี้ช่วงมาจากปฏิทิน ไม่ได้มาจาก
                ปุ่มสำเร็จรูป · กดแล้วเปิดปฏิทินให้เลย เพราะคนที่กดคำว่า "กำหนดเอง"
                กำลังจะเลือกวันอยู่แล้ว */}
            <button
              type="button"
              className="chip chip--flat"
              aria-current={preset === "custom" ? "true" : undefined}
              onClick={() => document.getElementById("db-range")?.click()}
            >
              กำหนดเอง
            </button>
          </div>

          <DateRangeField
            split
            id="db-range"
            from={from}
            to={to}
            onApply={(r) => useRange(r, "custom")}
          />

          {/* ป้ายท้ายแถวบอกช่วงที่ได้จริง — ชิปกับปฏิทินตั้งค่าได้จากสามทาง และ
              ป้ายนี้คือที่เดียวที่บอกว่าผลลัพธ์คืออะไร */}
          <span className="toolbar__now">
            <IconCalendar />
            {date(from)} – {date(to)} · {count(Math.max(1, Math.round(spanDays)))} วัน
          </span>
        </div>

        {report.status === "ready" ? (
          <div className="toolbar__row toolbar__row--file">
            <span className="toolbar__title">ส่งออกไฟล์ Excel</span>

            <div className="toolbar__pair">
              <span className="toolbar__lead">เอาอะไร</span>
              <PickList
                id="ex-sheets"
                items={SHEETS.map((s) => ({ value: s.value, label: s.label, hint: s.hint }))}
                chosen={exSheets}
                onChange={setExSheets}
                allLabel={`ทุกชีต · ${SHEETS.length}`}
              />
            </div>

            <div className="toolbar__pair">
              <span className="toolbar__lead">สาขา</span>
              <Select
                id="ex-branch"
                className="input--inline"
                value={exBranch}
                onChange={setExBranch}
                options={[
                  { value: "", label: "ทุกสาขา" },
                  ...(report.data.rxBranches.some((b) => b.branchId === null)
                    ? [{ value: "self", label: "TimeOptic" }]
                    : []),
                  ...Array.from(
                    new Map(
                      [...report.data.branchDraws, ...report.data.rxBranches]
                        .filter((b) => b.branchId !== null)
                        .map((b) => [String(b.branchId), b.branch]),
                    ),
                  ).map(([value, label]) => ({ value, label })),
                ]}
              />
            </div>

            <div className="toolbar__pair">
              <span className="toolbar__lead">ชนิด</span>
              <Select
                id="ex-type"
                className="input--inline"
                value={exType}
                onChange={setExType}
                options={[
                  { value: "", label: "ทุกชนิด" },
                  ...PRODUCT_TYPES.map((t) => ({ value: t, label: PRODUCT_TYPE_LABEL[t] })),
                ]}
              />
            </div>

            <div className="toolbar__go">
              {(
                [
                  ["data", "Excel: ข้อมูล"],
                  ["both", "Excel: ข้อมูล + กราฟ"],
                  ["charts", "Excel: กราฟ"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className="btn btn--primary btn--small"
                  onClick={() => void exportBook(mode)}
                  disabled={saving || exSheets.length === 0}
                >
                  <IconChart />
                  {saving ? "กำลังสร้างไฟล์…" : `${label} · ${exSheets.length} ชีต`}
                </button>
              ))}
            </div>

            {exBranch !== "" || exType !== "" ? (
              <p className="field__help toolbar__note">
                สาขากับชนิดสินค้าแคบเฉพาะไฟล์ หน้าจอข้างบนยังแสดงทั้งร้าน · ชีตที่ไม่มี
                คอลัมน์พวกนี้ให้กรอง (สรุปรายการ · รายวัน · สินค้าจ่ายออกมากสุด ·
                ใครเบิกมากสุด · ของเสียแยกตามคน) จะไม่อยู่ในไฟล์ที่กรองแล้ว
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

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
            <div className="readout__cell readout__cell--mint">
              <p className="readout__label">รับเข้า</p>
              <p className="readout__figure">
                {count(report.data.in.qty + report.data.return.qty)}
              </p>
              <p className="readout__note">
                ชิ้น · รับเข้า {count(report.data.in.rows)} · รับคืน {count(report.data.return.rows)}
              </p>
            </div>
            <div className="readout__cell readout__cell--coral">
              <p className="readout__label">ของเสีย</p>
              <p
                className={
                  report.data.scrap.qty > 0
                    ? "readout__figure readout__figure--signal"
                    : "readout__figure"
                }
              >
                {count(report.data.scrap.qty)}
              </p>
              <p className="readout__note">ชิ้น · ไม่นับเป็นต้นทุนขาย</p>
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
                  const low = p.minStock > 0 && p.onHand < p.minStock;
                  return {
                    key: String(p.id),
                    label: p.name,
                    sub:
                      `${p.sku} · เหลือ ${count(p.onHand)}` +
                      (low ? ` · ต่ำกว่าขั้นต่ำ ${count(p.minStock)}` : "") +
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
                  <div className="tablewrap">
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
                      {b.items.map((it) => (
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
                  <div className="tablewrap">
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
                      {b.items.map((it) => (
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
                <div className="tablewrap">
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
                      {movers.data.slow.map((r) => (
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
              )
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
