"use client";

import { useId, useState } from "react";
import { count, date, money } from "@/stockmod/lib/format";

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

/** Chart ink. Not in tokens.css because nothing else in the app draws marks. */
const INK = {
  in: "#006b2d",
  out: "#0086cf",
  scrap: "#ed3151",
  cost: "#a38300",
};

type Day = {
  day: string;
  inQty: number;
  outQty: number;
  scrapQty: number;
  cogs: number | null;
};

/* -------------------------------------------------------------------------- */

/**
 * Stock in and stock out, one bar pair per day, split by a zero line.
 *
 * Above and below the axis is the primary encoding — the direction stock moved
 * is a real polarity, not two arbitrary categories, so position carries it and
 * colour only reinforces. That also means the chart still reads if the two
 * colours are indistinguishable to the person looking at it.
 */
export function FlowChart({ days }: { days: Day[] }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);

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
            ของเข้าและออกรายวัน {days.length} วัน · สูงสุด {peak} ชิ้นต่อวัน
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
            <strong>{date(active.day)}</strong>
            <span>
              รับเข้า {count(active.inQty)} · จ่ายออก {count(active.outQty)}
            </span>
          </div>
        ) : null}
      </div>

      <div className="chart__scale" aria-hidden="true">
        <span>{date(days[0].day)}</span>
        <span>สูงสุด {count(peak)} ชิ้น/วัน</span>
        <span>{date(days[days.length - 1].day)}</span>
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
  days,
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
  const [hover, setHover] = useState<number | null>(null);

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
            {label}รายวัน · สูงสุด {format(peak)} {unit} ต่อวัน
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
            <strong>{date(active.day)}</strong>
            <span>
              {label} {format(pick(active))} {unit}
            </span>
          </div>
        ) : null}
      </div>

      <div className="chart__scale" aria-hidden="true">
        <span>{date(days[0].day)}</span>
        <span>
          สูงสุด {format(peak)} {unit}/วัน
        </span>
        <span>{date(days[days.length - 1].day)}</span>
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
}: {
  rows: { key: string; label: string; sub?: string; value: number }[];
  ink: string;
  unit: string;
}) {
  if (rows.length === 0) {
    return <p className="field__help">ช่วงนี้ยังไม่มีข้อมูล</p>;
  }

  const peak = Math.max(...rows.map((r) => r.value), 1);

  return (
    <ul className="rank">
      {rows.map((r) => (
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
  );
}

export { INK as CHART_INK, money as chartMoney };
