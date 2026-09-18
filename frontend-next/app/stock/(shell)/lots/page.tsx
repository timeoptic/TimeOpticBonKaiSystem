"use client";

import { useState } from "react";
import { can, useActor, WorkHead } from "@/stockmod/components/AppShell";
import { useToast } from "@/stockmod/components/Toaster";
import Paginator from "@/stockmod/components/Paginator";
import SortHead, { SortBar, useSort } from "@/stockmod/components/SortHead";
import LotEditDialog from "@/stockmod/components/LotEditDialog";
import DateRangeField from "@/stockmod/components/DateRangeField";
import RecordCard, { CardList } from "@/stockmod/components/RecordCard";
import { qs, useApi } from "@/stockmod/lib/useApi";
import { count, date, money, shortName } from "@/stockmod/lib/format";
import type { LotRow, Page, Summary } from "@/stockmod/lib/api";

type Counts = { all: number; onhand: number; empty: number; nocost: number; expiring: number };
type List = Page<LotRow> & { counts: Counts };

type SortKey = "received" | "lot" | "product" | "supplier" | "initial" | "remaining" | "cost" | "value" | "expiry";
const NATURAL_ASC: readonly SortKey[] = ["lot", "product", "supplier", "expiry"];

/**
 * The sort chooser in the toolbar, which is where ผู้ขาย, รับเข้า and มูลค่า
 * still live now that the table draws them inside another column rather than in
 * columns of their own. A sort that has no header has to be reachable somewhere,
 * or slimming the table would quietly remove it.
 *
 * The two money sorts are only offered to someone allowed to see money — the
 * API refuses the figures anyway, so a chooser that offers them would be
 * offering a way to sort by a column of dashes.
 */
function sorts(money: boolean): readonly { col: SortKey; label: string }[] {
  return [
    { col: "received", label: "วันที่รับเข้า" },
    { col: "product", label: "สินค้า" },
    { col: "expiry", label: "วันหมดอายุ" },
    { col: "initial", label: "จำนวนที่รับเข้า" },
    { col: "remaining", label: "คงเหลือ" },
    ...(money
      ? ([
          { col: "cost", label: "ต้นทุน/ชิ้น" },
          { col: "value", label: "มูลค่าคงเหลือ" },
        ] as const)
      : []),
  ];
}

const STATES = [
  { key: "all", label: "ทั้งหมด", countKey: "all" },
  { key: "onhand", label: "มีของ", countKey: "onhand" },
  { key: "empty", label: "หมดแล้ว", countKey: "empty" },
  { key: "nocost", label: "ยังไม่มีต้นทุน", countKey: "nocost" },
  { key: "expiring", label: "ใกล้หมดอายุ", countKey: "expiring" },
] as const;

export default function LotsPage() {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [state, setState] = useState<string>("all");
  const [page, setPage] = useState(1);
  /** ช่วงวันรับเข้า — ว่างทั้งคู่ = ทุกวัน */
  const [range, setRange] = useState({ from: "", to: "" });
  const { sort, dir, sortBy } = useSort<SortKey>("received", NATURAL_ASC);

  /**
   * The lot being corrected, if any.
   *
   * This page is where a lot waiting on its invoice is actually seen — the
   * "รอต้นทุน" tint is right here — so it is where the cost gets filled in.
   * Before this, the only editor lived in the catalogue's product drawer, and
   * people reached for the receiving form instead and were told the quantity
   * must be at least one. They were not receiving anything.
   */
  const [editing, setEditing] = useState<LotRow | null>(null);
  const toast = useToast();

  const money$ = can.seeCost(useActor());
  const list = useApi<List>(
    `/lots${qs({ state: state === "all" ? "" : state, q: applied, from: range.from, to: range.to, sort, dir, page })}`,
  );
  const summary = useApi<Summary>("/summary");

  const rows = list.status === "ready" ? list.data.rows : [];

  // Changing what is being looked for starts again from the top — page 7 of a
  // different result set is a page that means nothing.
  function refine(fn: () => void) {
    fn();
    setPage(1);
  }

  const pick = (c: SortKey) => sortBy(c, () => setPage(1));

  return (
    <main className="work-main">
      <WorkHead
        title="ล็อตสต็อก"
        lede="ล็อตล่าสุดอยู่บนสุด — กดหัวคอลัมน์ “วันที่” เพื่อสลับเป็นลำดับ FIFO"
      >
        <form
          className="toolsearch"
          onSubmit={(e) => {
            e.preventDefault();
            refine(() => setApplied(q.trim()));
          }}
        >
          <label className="sr-only" htmlFor="lot-q">
            ค้นหาล็อต
          </label>
          <input
            id="lot-q"
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="SKU หรือชื่อสินค้า"
            autoComplete="off"
          />
          <button type="submit" className="btn btn--primary">
            ค้นหา
          </button>
        </form>
      </WorkHead>

      {/* Every figure here counts the whole set, never the page on screen. A
          total that changes when you turn the page is not a total. */}
      <section className="readout readout--tight" aria-label="สรุปตัวเลขคลัง">
        <div className="readout__cell readout__cell--pear">
          <p className="readout__label">ตรงกับเงื่อนไข</p>
          <p className="readout__figure">
            {count(list.status === "ready" ? list.data.total : 0)}
          </p>
          <p className="readout__note">
            จาก {count(list.status === "ready" ? list.data.counts.all : 0)} ล็อตทั้งหมด
          </p>
        </div>
        <div className="readout__cell readout__cell--mint">
          <p className="readout__label">คงเหลือทั้งคลัง</p>
          <p className="readout__figure">
            {count(summary.status === "ready" ? summary.data.onHand : 0)}
          </p>
          <p className="readout__note">ชิ้น</p>
        </div>
        {money$ ? (
          <div className="readout__cell readout__cell--cyan">
            <p className="readout__label">มูลค่าต้นทุนทั้งคลัง</p>
            <p className="readout__figure">
              {money(summary.status === "ready" ? (summary.data.stockValue ?? 0) : 0)}
            </p>
            <p className="readout__note">บาท · นับเฉพาะล็อตที่รู้ต้นทุน</p>
          </div>
        ) : null}
        <div className="readout__cell readout__cell--coral">
          <p className="readout__label">ยังไม่มีต้นทุน</p>
          <p
            className={
              list.status === "ready" && list.data.counts.nocost > 0
                ? "readout__figure readout__figure--signal"
                : "readout__figure"
            }
          >
            {count(list.status === "ready" ? list.data.counts.nocost : 0)}
          </p>
          <p className="readout__note">ล็อตที่รอใบกำกับ</p>
        </div>
      </section>

      <div className="chips chips--bar" role="group" aria-label="กรองตามสถานะล็อต">
        {STATES.map((s) => (
          <button
            key={s.key}
            type="button"
            className="chip"
            aria-current={state === s.key ? "true" : undefined}
            onClick={() => refine(() => setState(s.key))}
          >
            {s.label}
            {list.status === "ready" ? (
              <span className="chip__count">{count(list.data.counts[s.countKey])}</span>
            ) : null}
          </button>
        ))}
        {state === "expiring" ? <span className="chips__note">ภายใน 120 วัน</span> : null}
      </div>

      <div className="listtools">
        <DateRangeField
          from={range.from}
          to={range.to}
          clearable
          placeholder="รับเข้าทุกวัน"
          onApply={(r) => refine(() => setRange(r))}
        />
        <SortBar id="lots" columns={sorts(money$)} sort={sort} dir={dir} onSort={pick} />
      </div>

      {list.status === "loading" ? <div className="skeleton" /> : null}

      {list.status === "error" ? (
        <div className="empty">
          <p className="empty__title">โหลดรายการล็อตไม่ได้</p>
          <p className="empty__body">{list.error}</p>
          <button type="button" className="btn" onClick={list.reload}>
            ลองใหม่
          </button>
        </div>
      ) : null}

      {list.status === "ready" && rows.length === 0 ? (
        <div className="empty">
          <p className="empty__title">ไม่มีล็อตที่ตรงกับเงื่อนไขนี้</p>
          <button
            type="button"
            className="btn"
            onClick={() =>
              refine(() => {
                setState("all");
                setQ("");
                setApplied("");
              })
            }
          >
            ล้างตัวกรอง
          </button>
        </div>
      ) : null}

      {editing !== null ? (
        <LotEditDialog
          lot={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.success({ text: `แก้ล็อต ${editing.lotNumber} แล้ว`, detail: editing.productName });
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}

      {rows.length > 0 ? (
        <>
        {/* บนมือถือ ล็อตหนึ่งใบ = การ์ดหนึ่งใบ · ผู้ขายขึ้นเป็นบรรทัดรองไม่ใช่
            หัวการ์ด เพราะคนที่ไถหาล็อตหาด้วยชื่อสินค้า ไม่ใช่ชื่อผู้ขาย */}
        <CardList label="ล็อตสต็อก">
          {rows.map((r) => (
            <RecordCard
              key={r.id}
              tone={money$ && r.costPerUnit === null ? "pending" : undefined}
              head={
                r.remainingQty === 0 ? (
                  <span className="status status--out">หมด</span>
                ) : (
                  <>
                    <span className="reccard__money">{count(r.remainingQty)}</span>
                    <span className="reccard__when">รับเข้า {count(r.initialQty)}</span>
                  </>
                )
              }
              title={shortName(r.productName)}
              sub={`${r.sku} · ${r.supplierName ?? "ไม่ระบุผู้ขาย"}`}
              fields={[
                money$
                  ? {
                      label: "ต้นทุน/ชิ้น",
                      value:
                        r.costPerUnit === null ? (
                          <span className="status status--pending">รอต้นทุน</span>
                        ) : (
                          money(r.costPerUnit)
                        ),
                    }
                  : null,
                money$ && r.value !== null ? { label: "มูลค่าคงเหลือ", value: money(r.value) } : null,
                { label: "วันที่รับเข้า", value: date(r.receivedDate) },
                r.expiryDate
                  ? {
                      label: "หมดอายุ",
                      value: (
                        <span className={r.expiringSoon ? "grid__sub--warn" : undefined}>
                          {date(r.expiryDate)}
                        </span>
                      ),
                    }
                  : null,
              ]}
              actions={
                <button type="button" className="btn btn--small" onClick={() => setEditing(r)}>
                  {r.costPerUnit === null && money$ ? "ลงต้นทุน" : "แก้ไขล็อต"}
                </button>
              }
            />
          ))}
        </CardList>

        <div className="tablewrap wide-only">
          <table className="grid">
            <caption className="sr-only">ล็อตสต็อกเรียงจากล็อตล่าสุดไปเก่าสุด</caption>
            <thead>
              <tr>
                {/* Five columns, not eight. รับเข้า sits under what is left of
                    the lot and มูลค่า under the unit cost it is computed from —
                    each next to the figure it qualifies rather than a column
                    away from it. Both still sort, from the chooser above.

                    The lot number is not among them. It is issued by the system
                    so the ledger can point at one delivery; nobody reads it off
                    a shelf, and a column of codes only crowds out the supplier
                    and the count, which are what the row is actually asked. */}
                <SortHead label="ผู้ขาย" col="supplier" sort={sort} dir={dir} onSort={pick} />
                <SortHead label="สินค้า" col="product" sort={sort} dir={dir} onSort={pick} />
                <SortHead label="คงเหลือ" col="remaining" sort={sort} dir={dir} onSort={pick} num />
                {money$ ? <SortHead label="ต้นทุน/ชิ้น" col="cost" sort={sort} dir={dir} onSort={pick} num /> : null}
                <SortHead label="วันที่" col="received" sort={sort} dir={dir} onSort={pick} />
                <th scope="col">
                  <span className="sr-only">แก้ไข</span>
                </th>
              </tr>
            </thead>
            {/* The "awaiting invoice" tint means a missing cost. Without
                permission to see costs there is no missing cost to point at, so
                every row would light up for no reason. */}
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={
                    money$ && r.costPerUnit === null ? "grid__row grid__row--pending" : "grid__row"
                  }
                >
                  <th scope="row">
                    <span className="grid__name">{r.supplierName ?? "ไม่ระบุผู้ขาย"}</span>
                  </th>
                  <td>
                    <span className="grid__name">{shortName(r.productName)}</span>
                    <span className="grid__sub">{r.sku}</span>
                  </td>
                  <td className="grid__num">
                    {r.remainingQty === 0 ? (
                      <span className="status status--out">หมด</span>
                    ) : (
                      <span className="grid__name">{count(r.remainingQty)}</span>
                    )}
                    <span className="grid__sub">รับเข้า {count(r.initialQty)}</span>
                  </td>
                  {money$ ? (
                    <td className="grid__num">
                      {r.costPerUnit === null ? (
                        <span className="status status--pending">รอต้นทุน</span>
                      ) : (
                        <>
                          <span className="grid__name">{money(r.costPerUnit)}</span>
                          {r.value === null ? null : (
                            <span className="grid__sub">มูลค่า {money(r.value)}</span>
                          )}
                        </>
                      )}
                    </td>
                  ) : null}
                  <td className="grid__muted">
                    <span className="grid__name">{date(r.receivedDate)}</span>
                    {r.expiryDate ? (
                      <span className={r.expiringSoon ? "grid__sub grid__sub--warn" : "grid__sub"}>
                        หมดอายุ {date(r.expiryDate)}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--quiet btn--small"
                      onClick={() => setEditing(r)}
                    >
                      {r.costPerUnit === null && money$ ? "ลงต้นทุน" : "แก้ไข"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {list.status === "ready" ? (
          <Paginator
            page={list.data.page}
            perPage={list.data.perPage}
            total={list.data.total}
            onPage={setPage}
            label="ล็อต"
          />
        ) : null}
        </>
      ) : null}
    </main>
  );
}
