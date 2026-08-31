"use client";

import { useState } from "react";
import Link from "next/link";
import { can, useActor, WorkHead } from "@/stockmod/components/AppShell";
import Select from "@/stockmod/components/Select";
import { CHART_INK, DayBars, FlowChart, RankBars } from "@/stockmod/components/Charts";
import { qs, useApi } from "@/stockmod/lib/useApi";
import { count, date, money } from "@/stockmod/lib/format";
import { PRODUCT_TYPE_LABEL, type Movers } from "@/stockmod/lib/api";
import DateField from "@/stockmod/components/DateField";

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
  branch: {
    issuedCount: number;
    issuedCost: number | null;
    settledCount: number;
    settledAmount: number | null;
    settledProfit: number | null;
    owingCount: number;
    owingCost: number | null;
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

  const [preset, setPreset] = useState<string>("month");
  const [from, setFrom] = useState(() => PRESETS[4].range().from);
  const [to, setTo] = useState(() => PRESETS[4].range().to);

  /**
   * How still is still. Applies to the bottom table only — see the note there.
   */
  const [idle, setIdle] = useState("90");

  const report = useApi<Report>(`/report${qs({ from, to })}`);
  const movers = useApi<Movers>(`/movers${qs({ from, to, idle })}`);

  function useRange(next: { from: string; to: string }, key: string) {
    setFrom(next.from);
    setTo(next.to);
    setPreset(key);
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

      {/* ------------------------------------------------------------ range */}

      <section className="task task--wide">
        <div className="chips chips--bar" role="group" aria-label="ช่วงเวลาที่ใช้บ่อย">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className="chip"
              aria-current={preset === p.key ? "true" : undefined}
              onClick={() => useRange(p.range(), p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="formgrid">
          <div className="field">
            <label className="field__label" htmlFor="db-month">
              เลือกทั้งเดือน
            </label>
            <input
              id="db-month"
              className="input"
              type="month"
              value={from.slice(0, 7)}
              onChange={(e) => {
                if (e.target.value) useRange(monthRange(e.target.value), "custom");
              }}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="db-from">
              ตั้งแต่วันที่
            </label>
            <DateField
              id="db-from"
              value={from}
              max={to}
              clearable={false}
              onChange={(v) => useRange({ from: v, to }, "custom")}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="db-to">
              ถึงวันที่
            </label>
            <DateField
              id="db-to"
              value={to}
              min={from}
              clearable={false}
              onChange={(v) => useRange({ from, to: v }, "custom")}
            />
          </div>
        </div>

        <p className="field__help">
          กำลังดู {date(from)} ถึง {date(to)} · รวม {count(Math.max(1, Math.round(spanDays)))} วัน
        </p>
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
            <section className="readout" aria-label="สรุปเงินจากสาขาในช่วงนี้">
              <div className="readout__cell readout__cell--mint">
                <p className="readout__label">รับเงินจากสาขา</p>
                <p className="readout__figure">{money(report.data.branch.settledAmount ?? 0)}</p>
                <p className="readout__note">
                  บาท จาก {count(report.data.branch.settledCount)} รายการ · ตามวันที่เงินเข้า
                </p>
              </div>
              <div className="readout__cell readout__cell--pear">
                <p className="readout__label">กำไรจากสาขา</p>
                <p className="readout__figure">{money(report.data.branch.settledProfit ?? 0)}</p>
                <p className="readout__note">บาท · เฉพาะรายการที่เงินเข้าแล้วในช่วงนี้</p>
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
          </div>

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
