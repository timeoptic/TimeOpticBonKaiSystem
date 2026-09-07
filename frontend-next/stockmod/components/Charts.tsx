"use client";

import { useId, useState } from "react";
import { count, date, money } from "@/stockmod/lib/format";
import { useNarrow } from "@/stockmod/lib/useNarrow";

/**
 * The charts on the dashboard, drawn as inline SVG.
 *
 * No chart library. Three shapes are needed and each is a dozen lines of
 * arithmetic; a dependency would be larger than the code it replaced and would
 * bring its own colours, fonts and tooltips to fight with the design system.
 *
 * Colours come from `tokens.css` hues, stepped darker so a mark reads against
 * cream paper. They were checked rather than eyeballed — every pair that shares
 * a chart clears the colourblind separation and 3:1 contrast thresholds. The
 * consequence is visible in the shapes below: stock in and stock out share one
 * chart because they pass together, while scrap and cost of goods each get their
 * own chart because green-against-red does not survive protanopia.
 *
 * Every chart here has a table of the same numbers directly beneath it on the
 * page. The picture is for spotting the odd day; the table is the record.
 */

/**
 * Chart ink. Not in tokens.css because nothing else in the app draws marks.
 *
 * ปรับตามกระดาษที่เปลี่ยนจากครีมเป็นเย็นอ่อน — ค่าเดิมเลือกไว้ให้อ่านออกบนครีม
 * ทั้งสี่ยังเข้มพอผ่าน 3:1 บนกระดาษใหม่ และคู่ที่อยู่ในกราฟเดียวกัน (เข้า/ออก)
 * ยังเป็นเขียวกับน้ำเงิน ซึ่งเป็นคู่ที่รอดตาบอดสีแบบ protanopia
 */
const INK = {
  in: "oklch(45% 0.15 150)",
  out: "oklch(46% 0.22 268)",
  scrap: "oklch(52% 0.20 20)",
  cost: "oklch(52% 0.13 70)",
};

type Day = {
  day: string;
  inQty: number;
  outQty: number;
  scrapQty: number;
  cogs: number | null;
  /** วันสุดท้ายของช่วง เมื่อแท่งนี้เป็นหลายวันรวมกัน — ดู `bucket()` */
  end?: string;
};

/* -------------------------------------------------------------------------- */

/**
 * รวมหลายวันเป็นแท่งเดียว จนกว่าจำนวนแท่งจะไม่เกิน `max`
 *
 * ช่วง 30 วันบนจอโทรศัพท์คือแท่งกว้างแท่งละ 4px ซึ่งแตะไม่โดน อ่านไม่ออก และ
 * เบียดกันจนภาพรวมหายไปพร้อมกับรายละเอียด · รวมเป็นก้อนละ 2-3 วันแล้วภาพรวม
 * กลับมา ส่วนตัวเลขรายวันจริง ๆ ยังอยู่ครบในตารางใต้กราฟและในไฟล์ Excel
 *
 * ก้อนสุดท้ายสั้นกว่าเพื่อนได้ ไม่ได้เติมวันปลอมให้เต็มก้อน — วันที่ยังไม่เกิด
 * ขึ้นจะอ่านเป็นวันที่ยอดเป็นศูนย์
 */
function bucket(days: Day[], max: number): Day[] {
  if (days.length <= max) return days;

  const size = Math.ceil(days.length / max);
  const out: Day[] = [];
  for (let i = 0; i < days.length; i += size) {
    const group = days.slice(i, i + size);
    /* ต้นทุนเป็น null ได้เมื่อยังไม่รู้ต้นทุน — ก้อนที่ไม่มีวันไหนรู้เลยต้องยัง
       เป็น null ไม่ใช่ 0 เพราะศูนย์แปลว่า "ขายแล้วไม่มีต้นทุน" ซึ่งคนละเรื่อง */
    const costed = group.filter((d) => d.cogs !== null);
    out.push({
      day: group[0].day,
      end: group[group.length - 1].day,
      inQty: group.reduce((n, d) => n + d.inQty, 0),
      outQty: group.reduce((n, d) => n + d.outQty, 0),
      scrapQty: group.reduce((n, d) => n + d.scrapQty, 0),
      cogs: costed.length === 0 ? null : costed.reduce((n, d) => n + (d.cogs ?? 0), 0),
    });
  }
  return out;
}

/** ชื่อของแท่ง — วันเดียวบอกวันนั้น หลายวันบอกเป็นช่วง */
const spanOf = (d: Day) => (d.end && d.end !== d.day ? `${date(d.day)} – ${date(d.end)}` : date(d.day));

/**
 * แท่งกี่แท่งถึงจะยังอ่านออกบนจอที่กำลังถืออยู่
 *
 * โทรศัพท์กว้างราว 360px หักขอบเหลือราว 330px · 14 แท่งคือแท่งละ 23px ซึ่งกว้าง
 * พอให้เห็นเป็นแท่งและแตะโดน · จอกว้างไม่ต้องรวมอะไรเลย ปล่อยเป็นรายวันตามเดิม
 */
const PHONE_BARS = 14;

/**
 * Stock in and stock out, one bar pair per day, split by a zero line.
 *
 * Above and below the axis is the primary encoding — the direction stock moved
 * is a real polarity, not two arbitrary categories, so position carries it and
 * colour only reinforces. That also means the chart still reads if the two
 * colours are indistinguishable to the person looking at it.
 */
export function FlowChart({ days: all }: { days: Day[] }) {
  const id = useId();
  const narrow = useNarrow();
  const [hover, setHover] = useState<number | null>(null);

  const days = narrow ? bucket(all, PHONE_BARS) : all;

  if (days.length === 0) {
    return <p className="field__help">ช่วงนี้ไม่มีความเคลื่อนไหว</p>;
  }

  const W = 100;
  const H = 46;
  const peak = Math.max(1, ...days.map((d) => Math.max(d.inQty, d.outQty)));
  const step = W / days.length;
  // A 2px surface gap between neighbouring bars, expressed in the viewBox's own
  // units so it survives the scale to whatever width the section ends up.
  const gap = Math.min(step * 0.3, 1.2);
  const bw = Math.max((step - gap) / 2, 0.6);
  const mid = H / 2;
  const scale = (v: number) => (v / peak) * (H / 2 - 3);

  const active = hover === null ? null : days[hover];

  return (
    <figure className="chart">
      <figcaption className="chart__legend">
        <span className="chart__key">
          <span className="chart__swatch" style={{ background: INK.in }} aria-hidden="true" />
          รับเข้า (เหนือเส้น)
        </span>
        <span className="chart__key">
          <span className="chart__swatch" style={{ background: INK.out }} aria-hidden="true" />
          จ่ายออก (ใต้เส้น)
        </span>
      </figcaption>

      <div className="chart__plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="chart__svg"
          role="img"
          aria-labelledby={`${id}-t`}
          onMouseLeave={() => setHover(null)}
        >
          <title id={`${id}-t`}>
            ของเข้าและออก {all.length} วัน · สูงสุด {peak} ชิ้นต่อแท่ง
          </title>

          <line x1="0" y1={mid} x2={W} y2={mid} className="chart__axis" />

          {days.map((d, i) => {
            const x = i * step + gap / 2;
            return (
              <g key={d.day} onMouseEnter={() => setHover(i)}>
                {/* A full-height target so the pointer does not have to find a
                    3px bar to get the day's numbers. */}
                <rect x={i * step} y="0" width={step} height={H} fill="transparent" />
                {hover === i ? (
                  <rect x={i * step} y="0" width={step} height={H} className="chart__hit" />
                ) : null}
                {d.inQty > 0 ? (
                  <rect
                    x={x}
                    y={mid - scale(d.inQty)}
                    width={bw}
                    height={scale(d.inQty)}
                    fill={INK.in}
                    rx="0.4"
                  />
                ) : null}
                {d.outQty > 0 ? (
                  <rect
                    x={x + bw}
                    y={mid}
                    width={bw}
                    height={scale(d.outQty)}
                    fill={INK.out}
                    rx="0.4"
                  />
                ) : null}
              </g>
            );
          })}
        </svg>

        {active ? (
          <div className="chart__tip" role="status">
            <strong>{spanOf(active)}</strong>
            <span>
              รับเข้า {count(active.inQty)} · จ่ายออก {count(active.outQty)}
            </span>
          </div>
        ) : null}
      </div>

      {/* หัวท้ายอ่านจากช่วงจริง ไม่ใช่จากแท่งแรก/แท่งสุดท้าย — แท่งที่รวมหลายวัน
          ถือวันแรกของก้อนไว้ ปลายสเกลจึงจะขาดไปสองสามวันถ้าอ่านจากตัวมัน */}
      <div className="chart__scale" aria-hidden="true">
        <span>{date(all[0].day)}</span>
        <span>สูงสุด {count(peak)} ชิ้น/{days.length === all.length ? "วัน" : "แท่ง"}</span>
        <span>{date(all[all.length - 1].day)}</span>
      </div>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * One measure a day, as bars from a baseline.
 *
 * A lone series, so no legend — the heading above it already names what is being
 * counted, and a one-row legend explaining a single colour is furniture.
 */
export function DayBars({
  days: all,
  pick,
  label,
  ink,
  format = count,
  unit,
}: {
  days: Day[];
  pick: (d: Day) => number;
  label: string;
  ink: string;
  format?: (n: number) => string;
  unit: string;
}) {
  const id = useId();
  const narrow = useNarrow();
  const [hover, setHover] = useState<number | null>(null);

  const days = narrow ? bucket(all, PHONE_BARS) : all;
  const values = days.map(pick);
  const peak = Math.max(...values, 0);

  if (days.length === 0 || peak === 0) {
    return <p className="field__help">ช่วงนี้ไม่มี{label}</p>;
  }

  const W = 100;
  const H = 30;
  const step = W / days.length;
  const gap = Math.min(step * 0.3, 1.2);
  const bw = Math.max(step - gap, 0.6);

  const active = hover === null ? null : days[hover];

  return (
    <figure className="chart">
      <div className="chart__plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="chart__svg"
          role="img"
          aria-labelledby={`${id}-t`}
          onMouseLeave={() => setHover(null)}
        >
          <title id={`${id}-t`}>
            {label} {all.length} วัน · สูงสุด {format(peak)} {unit} ต่อแท่ง
          </title>

          <line x1="0" y1={H} x2={W} y2={H} className="chart__axis" />

          {days.map((d, i) => {
            const v = pick(d);
            const h = (v / peak) * (H - 2);
            return (
              <g key={d.day} onMouseEnter={() => setHover(i)}>
                <rect x={i * step} y="0" width={step} height={H} fill="transparent" />
                {hover === i ? (
                  <rect x={i * step} y="0" width={step} height={H} className="chart__hit" />
                ) : null}
                {v > 0 ? (
                  <rect
                    x={i * step + gap / 2}
                    y={H - h}
                    width={bw}
                    height={h}
                    fill={ink}
                    rx="0.4"
                  />
                ) : null}
              </g>
            );
          })}
        </svg>

        {active ? (
          <div className="chart__tip" role="status">
            <strong>{spanOf(active)}</strong>
            <span>
              {label} {format(pick(active))} {unit}
            </span>
          </div>
        ) : null}
      </div>

      <div className="chart__scale" aria-hidden="true">
        <span>{date(all[0].day)}</span>
        <span>
          สูงสุด {format(peak)} {unit}/{days.length === all.length ? "วัน" : "แท่ง"}
        </span>
        <span>{date(all[all.length - 1].day)}</span>
      </div>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A ranked list as horizontal bars, longest first.
 *
 * Bars run along the reading direction so the labels sit where they are read,
 * and every bar carries its own number — with ten of them there is no counting
 * gridlines, and the value is what the reader came for.
 */
export function RankBars({
  rows,
  ink,
  unit,
  phoneRows = 5,
}: {
  rows: { key: string; label: string; sub?: string; value: number }[];
  ink: string;
  unit: string;
  /** กี่แถวถึงจะพอบนจอโทรศัพท์ ก่อนจะต้องกดขอดูเพิ่ม */
  phoneRows?: number;
}) {
  const narrow = useNarrow();
  const [all, setAll] = useState(false);

  if (rows.length === 0) {
    return <p className="field__help">ช่วงนี้ยังไม่มีข้อมูล</p>;
  }

  /* ยอดสูงสุดคิดจากทุกแถวเสมอ ไม่ใช่เฉพาะแถวที่โชว์ — แท่งที่ยาวเต็มรางเพราะ
     แถวที่ยาวกว่าถูกซ่อนอยู่ คือแท่งที่โกหกว่าอันนี้คือที่หนึ่ง */
  const peak = Math.max(...rows.map((r) => r.value), 1);

  /* บนโทรศัพท์แต่ละแถวกินสามบรรทัด (ชื่อ · รายละเอียด · แท่ง) สิบแถวคือเกือบ
     สองจอต่อหนึ่งแผง และมีสามแผงเรียงกัน · ห้าอันดับแรกคือสิ่งที่คนเปิดมาดู
     ที่เหลือยังกดเรียกได้ ไม่ได้หายไป */
  const shown = narrow && !all ? rows.slice(0, phoneRows) : rows;

  return (
    <>
    <ul className="rank">
      {shown.map((r) => (
        <li className="rank__row" key={r.key}>
          <span className="rank__label">
            {r.label}
            {r.sub ? <span className="rank__sub">{r.sub}</span> : null}
          </span>
          <span className="rank__track">
            <span
              className="rank__bar"
              style={{ inlineSize: `${(r.value / peak) * 100}%`, background: ink }}
            />
          </span>
          <span className="rank__value">
            {count(r.value)} {unit}
          </span>
        </li>
      ))}
    </ul>

    {shown.length < rows.length ? (
      <button type="button" className="btn btn--quiet btn--small" onClick={() => setAll(true)}>
        ดูอีก {count(rows.length - shown.length)} รายการ
      </button>
    ) : null}
    </>
  );
}

export { INK as CHART_INK, money as chartMoney };
