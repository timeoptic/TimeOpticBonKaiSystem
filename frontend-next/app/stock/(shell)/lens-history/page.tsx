"use client";

/**
 * Bewell: ประวัติเลนส์ — เลนส์ที่ขายไปแล้ว (ใช้ / ตัดเลนส์) สำหรับเบิกจาก TimeOptic
 *
 * ไม่ใช่สต็อก: เลนส์ของ Bewell ไม่มีในคลัง ข้อมูลมาจากใบเบิกเลนส์ที่ยืนยันขั้นขายแล้ว
 * (API ฝั่งหน้าร้าน /api/lens-usage) ไม่ใช่ inventory_logs · หน้าความเคลื่อนไหวของคลังจึงไม่ถูกแตะ
 * ปุ่มในแถบข้าง (งานประจำวัน) ขึ้นเฉพาะเมื่อ NEXT_PUBLIC_LENS_SOURCE=catalog
 */
import { useState } from "react";
import { can, useActor, WorkHead } from "@/stockmod/components/AppShell";
import { Filter, FilterBar } from "@/stockmod/components/FilterBar";
import DateRangeField from "@/stockmod/components/DateRangeField";
import { qs } from "@/stockmod/lib/useApi";
import { count } from "@/stockmod/lib/format";
import { api as frontdesk } from "@/lib/apiClient";
import {
  LENS_USAGE_ON,
  LensUsageList,
  NO_LENS_FILTERS,
  lensParams,
  useFrontdesk,
  type LensFilters,
  type LensOptions,
} from "./LensUsage";

export default function LensHistoryPage() {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [range, setRange] = useState({ from: "", to: "" });
  const [f, setF] = useState<LensFilters>(NO_LENS_FILTERS);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const actor = useActor();
  const money$ = can.seeCost(actor);

  /* ชุดเดียวกันทั้งรายการ การ์ด และไฟล์ Export — ไฟล์จึงตรงกับที่เห็นบนจอเสมอ */
  const query = lensParams({ q: applied, from: range.from, to: range.to }, f);
  /* การ์ดสถานะนับตามตัวกรองอื่นทั้งหมด ยกเว้นสถานะเอง ไม่งั้นเลือก "ยกเลิก" แล้วการ์ดรอเบิกเป็น 0 */
  const noStatus = lensParams({ q: applied, from: range.from, to: range.to }, { ...f, status: "" });
  const total = useFrontdesk<{ count: number }>("/api/lens-usage/count", query);
  const pending = useFrontdesk<{ count: number }>("/api/lens-usage/count", { ...noStatus, status: "pending" });
  const received = useFrontdesk<{ count: number }>("/api/lens-usage/count", { ...noStatus, status: "received" });
  const cancelled = useFrontdesk<{ count: number }>("/api/lens-usage/count", { ...noStatus, status: "cancelled" });
  const options = useFrontdesk<LensOptions>("/api/lens-usage/options");
  const n = (s: typeof total) => (s.status === "ready" ? s.data.count : 0);

  function refine(fn: () => void) {
    fn();
    setPage(1);
    setNotice(null);
  }

  async function exportXlsx() {
    setNotice(null);
    /* ไฟล์ที่มีแต่หัวตารางดูเหมือนระบบพัง — บอกตรง ๆ ว่ายังไม่มีรายการแทน */
    if (total.status === "ready" && total.data.count === 0) {
      setNotice(
        "ยังไม่มีรายการใช้เลนส์ตามตัวกรองนี้ — รายการเกิดเมื่อเลือกเลนส์จากรายการเลนส์ในออเดอร์ แล้วกดยืนยันขั้นขายของเคส",
      );
      return;
    }
    setExporting(true);
    try {
      await frontdesk.download(`/api/lens-usage/export.xlsx${qs(query)}`, "Lens Usage - Be Well.xlsx");
    } catch (e) {
      setNotice(`Export ไม่สำเร็จ: ${e instanceof Error ? e.message : ""}`);
    } finally {
      setExporting(false);
    }
  }

  if (!LENS_USAGE_ON) {
    return (
      <main className="work-main">
        <div className="empty">
          <p className="empty__title">หน้านี้ใช้กับร้านที่เลือกเลนส์จากรายการเลนส์เท่านั้น</p>
        </div>
      </main>
    );
  }

  const list = (all: string, xs: string[] | undefined) => [
    { value: "", label: all },
    ...(xs ?? []).map((x) => ({ value: x, label: x })),
  ];
  const o = options.status === "ready" ? options.data : null;
  const set = (patch: Partial<LensFilters>) => refine(() => setF((cur) => ({ ...cur, ...patch })));

  return (
    <main className="work-main">
      <WorkHead
        title="ประวัติเลนส์"
        lede="เลนส์ที่ขายไปแล้ว (ยืนยันขั้นขาย) · ไม่ใช่สต็อก — ใช้เบิก/สั่งตัดจาก TimeOptic"
      >
        <form
          className="toolsearch"
          onSubmit={(e) => {
            e.preventDefault();
            refine(() => setApplied(q.trim()));
          }}
        >
          <label className="sr-only" htmlFor="lh-q">
            ค้นหาประวัติเลนส์
          </label>
          <input
            id="lh-q"
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="เลขออเดอร์ เลขใบเบิก รหัสเคส ชื่อลูกค้า หรือชื่อเลนส์"
            autoComplete="off"
          />
          <button type="submit" className="btn btn--primary">
            ค้นหา
          </button>
        </form>
        <button type="button" className="btn" onClick={exportXlsx} disabled={exporting}>
          {exporting ? "กำลังสร้างไฟล์…" : "Export Excel"}
        </button>
      </WorkHead>

      {notice ? (
        <p className="empty__body" role="status">
          {notice}
        </p>
      ) : null}

      <section className="readout readout--tight" aria-label="สรุปประวัติเลนส์">
        <div className="readout__cell readout__cell--lav">
          <p className="readout__label">ตรงกับเงื่อนไข</p>
          <p className="readout__figure">{count(n(total))}</p>
          <p className="readout__note">รายการใช้เลนส์</p>
        </div>
        <div className="readout__cell readout__cell--coral">
          <p className="readout__label">รอเบิก</p>
          <p className="readout__figure">{count(n(pending))}</p>
          <p className="readout__note">ยังไม่ได้ส่งรายการเบิก</p>
        </div>
        <div className="readout__cell readout__cell--mint">
          <p className="readout__label">ได้รับเลนส์แล้ว</p>
          <p className="readout__figure">{count(n(received))}</p>
          <p className="readout__note">Be Well ได้รับเลนส์</p>
        </div>
        <div className="readout__cell">
          <p className="readout__label">ยกเลิก</p>
          <p className="readout__figure">{count(n(cancelled))}</p>
          <p className="readout__note">ยกเลิกเคส / ลบออเดอร์ / ยกเลิกใบ</p>
        </div>
      </section>

      <div className="toolsband">
        <FilterBar>
          <Filter id="lh-type" label="ชนิดเลนส์" value={f.lens_type} onChange={(v) => set({ lens_type: v })}
            options={list("ทุกชนิด", o?.lens_types)} />
          <Filter id="lh-name" label="ชื่อเลนส์" value={f.lens_name} onChange={(v) => set({ lens_name: v })}
            options={list("ทุกรุ่น", o?.names)} />
          <Filter id="lh-index" label="Index" value={f.index} onChange={(v) => set({ index: v })}
            options={list("ทุก Index", o?.indexes)} />
          <Filter id="lh-coating" label="Coating" value={f.coating} onChange={(v) => set({ coating: v })}
            options={list("ทุก Coating", o?.coatings)} />
          <Filter
            id="lh-status"
            label="สถานะ"
            value={f.status}
            onChange={(v) => set({ status: v })}
            options={[{ value: "", label: "ทุกสถานะ" }, ...(o?.statuses ?? []).map((x) => ({ value: x.value, label: x.label }))]}
          />
          <Filter
            id="lh-who"
            label="ผู้ทำรายการ"
            value={f.who}
            onChange={(v) => set({ who: v })}
            options={[{ value: "", label: "ทุกคน" }, ...(o?.people ?? []).map((x) => ({ value: String(x.id), label: x.name }))]}
          />
        </FilterBar>
        <DateRangeField
          from={range.from}
          to={range.to}
          clearable
          placeholder="ทุกวัน"
          onApply={(r) => refine(() => setRange(r))}
        />
      </div>

      <LensUsageList
        query={query}
        page={page}
        onPage={setPage}
        money={money$}
        onClear={() =>
          refine(() => {
            setF(NO_LENS_FILTERS);
            setRange({ from: "", to: "" });
            setQ("");
            setApplied("");
          })
        }
      />
    </main>
  );
}
