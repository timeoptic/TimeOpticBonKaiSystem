'use client';
/**
 * กราฟของหน้ารายงาน — SVG เขียนเอง ไม่มี dependency
 *
 * ทั้งโปรเจกต์มีสาม dependency (next · react · react-dom) และกราฟที่หน้ารายงาน
 * ต้องใช้มีสี่แบบ · การลากไลบรารีกราฟเข้ามาเพื่อสี่แบบนี้แลกมาด้วยบันเดิลที่ใหญ่ขึ้น
 * มาก สีที่ต้องไปดัดให้เข้าธีม และ CSS ของมันเองที่ทับกับของเรา
 *
 * `globals.css` มีคลาสของกราฟรออยู่แล้วตั้งแต่แอปเดิม (`.chart-box` `.chart-svg`
 * `.chart-axis` `.chart-bar` `.chart-legend`) รวมถึงกฎ `@media print` ที่ทำให้
 * แกนเป็นสีดำตอนพิมพ์ — ไฟล์นี้ใช้ชื่อเดิมทั้งหมด ไม่ตั้งชื่อใหม่ซ้อน
 *
 * ─────────────────────────────────────────────────────────────────────────
 * จานสี
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ชุดหกสีข้างล่างผ่านเครื่องตรวจของ dataviz แล้วบนพื้นขาว (การ์ดของระบบนี้เป็น
 * สีขาวล้วน): ผ่านทั้งย่านความสว่าง ความอิ่มสี ระยะห่างของคู่ที่ติดกันสำหรับคน
 * ตาบอดสี (ΔE 9.1) และระยะห่างสำหรับสายตาปกติ (ΔE 19.6)
 *
 * **ห้ามสลับลำดับ** — ลำดับคือกลไกที่ทำให้คู่ที่อยู่ติดกันในกราฟแยกออกจากกันได้
 * ไม่ใช่เรื่องความสวย · สลับแล้วต้องรันเครื่องตรวจใหม่
 *
 * สามสีในชุดนี้คอนทราสต์ต่ำกว่า 3:1 บนพื้นขาว จึงมีเงื่อนไขติดมา: ทุกกราฟที่ใช้
 * จานนี้ต้องมีป้ายกำกับที่อ่านได้ (legend พร้อมตัวเลข) หรือมีตารางตัวเลขชุดเดียวกัน
 * อยู่ในหน้าเดียวกัน — ในหน้ารายงานมีครบทั้งสองอย่างทุกกราฟ
 *
 * กราฟที่มีชุดข้อมูลเดียว (ยอดรายวัน · ยอดตามพนักงาน) ใช้สีแบรนด์ `--accent`
 * ไม่ใช่สีที่ 1 ของจาน — ชุดเดียวไม่มีคู่ให้แยก จึงไม่มีข้อจำกัดเรื่องนี้ และ
 * สีแบรนด์ทำให้กราฟอยู่ในภาษาเดียวกับหน้าจอที่เหลือ
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { axisTicks, barLayout, donutArcs, niceMax, stackLayout } from '../lib/chartGeom.js';
import { moneyShort } from '../lib/format.js';

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];

/** สีของชุดที่ n — เกินจานแล้ววนกลับ (หน้ารายงานไม่มีกราฟไหนเกินหกชุด) */
export const seriesColor = (i) => SERIES[i % SERIES.length];

/**
 * ความกว้าง viewBox ที่ใช้ก่อนวัดกล่องได้จริง (เรนเดอร์รอบแรก / ฝั่งเซิร์ฟเวอร์)
 * — เท่ากับความกว้างการ์ดบนจอคอมทั่วไป ภาพจึงไม่กระโดดตอนวัดเสร็จ
 */
const VIEW_W = 1200;
const PAD_R = 14;

/**
 * ขนาดของ viewBox คิดจากความกว้างจริงของกล่อง — หนึ่งหน่วย viewBox = หนึ่ง px
 *
 * ของเดิม viewBox กว้าง 1200 ตายตัวแล้วปล่อยให้ `.chart-svg{width:100%}` ย่อขยาย
 * เอาเอง ซึ่งได้ผลเฉพาะตอนการ์ดกว้างราว 1500px (อัตราส่วน 4.8:1 ทำให้สูงราว 310px
 * พอดีกับ `min-height:300px` ของ `.chart-box`) · พอการ์ดแคบลง ทุกอย่างถูกย่อตาม
 * ความกว้างทั้งก้อน — บนการ์ดกว้าง 265px ของจอโทรศัพท์ กราฟเหลือสูง 55px
 * ตัวหนังสือบนแกนเหลือ 2.5px และมีที่ว่างค้างใต้กราฟอีก 245px
 *
 * ผูก viewBox กับความกว้างจริงแทน ตัวหนังสือจึงได้ขนาดที่ CSS สั่งไว้เสมอ
 * (11.5px) ไม่ว่าการ์ดจะกว้างเท่าไหร่ ส่วนความสูงเลือกเองตามความกว้าง
 * ไม่ได้ผูกกับอัตราส่วนอีกต่อไป
 *
 * กล่องลอยบอกค่าคิดตำแหน่งจากชุดตัวเลขเดียวกันนี้ — สองที่ที่คิดเลขเองแยกกัน
 * คือกล่องลอยที่ชี้ไม่ตรงแท่ง
 */
function chartMetrics(boxW) {
  const viewW = Math.max(240, Math.round(boxW || VIEW_W));
  /* ที่กันไว้ให้ตัวเลขแกน Y — 76px บนการ์ดกว้าง แต่บนการ์ด 265px นั่นคือ 29%
     ของทั้งกราฟ · "฿1.2M" ที่ 11.5px กว้างราว 40px จึงพอที่ 46px เป็นอย่างต่ำ */
  const padL = Math.round(Math.min(76, Math.max(46, viewW * 0.14)));
  /* สูงราว 18% ของความกว้างเหมือนเดิมบนจอคอม (การ์ด 1460px → 263px เท่าของเดิม)
     แต่มีพื้นล่างที่ 180px ไม่งั้นการ์ดแคบได้กราฟแบนจนอ่านไม่ออก */
  const plotH = Math.round(Math.min(300, Math.max(180, viewW * 0.18)));
  return { viewW, padL, plotW: viewW - padL - PAD_R, plotH };
}

/** ตำแหน่งของช่องที่ i คิดเป็น % ของความกว้าง SVG ทั้งอัน (ไม่ใช่ของพื้นที่วาด) */
const tipAt = (i, n, m) => ((m.padL + ((i + 0.5) / n) * m.plotW) / m.viewW) * 100;

/* useLayoutEffect เตือนตอนเรนเดอร์ฝั่งเซิร์ฟเวอร์ — วัดก่อนวาดได้เฉพาะบนเบราว์เซอร์
   อยู่แล้ว ฝั่งเซิร์ฟเวอร์จึงใช้ useEffect ที่ไม่มีวันถูกเรียก */
const useIsoEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * ความกว้างจริงของกล่องกราฟ
 *
 * วัดด้วย ResizeObserver ไม่ใช่ window.innerWidth — การ์ดใบเดียวกันกว้างไม่เท่ากัน
 * ในแต่ละหน้า (เต็มแถว vs ครึ่งแถวใน .report-split) และแถบข้างพับเก็บได้ด้วย
 *
 * วัดใน useLayoutEffect = ได้ค่าก่อนเฟรมแรกถูกวาด กราฟจึงไม่กระพริบจากขนาด
 * ตั้งต้นไปขนาดจริง
 */
function useBoxWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);

  useIsoEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setW(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, w];
}

/**
 * ความหนาของแท่ง — 55% ของช่อง จำกัดไว้ที่ 55px
 *
 * สเปกของมาร์กบอกว่าแท่งไม่ควรเกิน 24px ที่วาดออกมาจริง · เพดานนี้เกินสเปก
 * และตั้งใจให้เกิน — กราฟรายเดือนมี 9 แท่งบนกราฟกว้างพันกว่า px แท่งละ 24px
 * จะกลายเป็นจุดเล็ก ๆ เก้าจุดลอยบนพื้นว่าง ซึ่งอ่านยากกว่าแท่งที่หนาเกินสเปก
 * · เพดาน 55% ของช่องยังคงเจตนาเดิมของสเปกไว้ คือไม่ให้แท่งเต็มช่องจนชนกัน
 *
 * เดิมเขียนไว้ 44 "หน่วย viewBox" ซึ่งตอนนั้นถูกขยาย 1.25 เท่าเป็นราว 55px
 * บนจอ · ตอนนี้หนึ่งหน่วย = หนึ่ง px แล้ว เลขจึงเป็น 55 ตรง ๆ ภาพเท่าเดิม
 */
const barThickness = (band) => Math.max(3, Math.min(band * 0.55, 55));

/**
 * แท่งที่ปลายบนมน ฐานเหลี่ยม
 *
 * `rect rx=4` มนทั้งสี่มุมรวมมุมที่ติดแกน ซึ่งทำให้แท่งดูลอยไม่ติดเส้นฐาน
 * แท่งที่เตี้ยกว่ารัศมีจะได้รัศมีเท่าความสูงตัวเอง ไม่งั้นเส้นโค้งจะพลิกกลับด้าน
 */
function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const k = Math.min(r, w / 2, h);
  return `M${x} ${y + h}V${y + k}A${k} ${k} 0 0 1 ${x + k} ${y}`
    + `H${x + w - k}A${k} ${k} 0 0 1 ${x + w} ${y + k}V${y + h}Z`;
}

/**
 * กล่องลอยบอกค่าตอนชี้เมาส์
 *
 * วางด้วย % ของกล่องกราฟ แล้วดึงกลับครึ่งหนึ่งของตัวเอง — ไม่ต้องวัดความกว้าง
 * จริงของข้อความ · ตัวที่อยู่ริมซ้าย/ขวาสุดถูกหนีบไม่ให้ล้นออกนอกการ์ด
 */
function Tip({ at, children }) {
  if (!at) return null;
  const left = Math.min(92, Math.max(8, at));
  return (
    <div className="chart-tip" style={{ left: `${left}%` }}>{children}</div>
  );
}

const EmptyChart = ({ text = 'ยังไม่มีข้อมูลในช่วงนี้' }) => (
  <div className="chart-empty">{text}</div>
);

/* ------------------------------------------------------------------ */
/* โดนัท — สัดส่วนของก้อนเดียวที่รวมกันเป็น 100%                        */
/* ------------------------------------------------------------------ */

/**
 * items: [{ label, value, color?, sub? }]
 *
 * ตัวเลขตรงกลางคือยอดรวม เพราะคำถามแรกของโดนัทคือ "ทั้งหมดเท่าไหร่" เสมอ
 * ส่วน legend มีตัวเลขและเปอร์เซ็นต์ของทุกชิ้นครบ — ไม่ต้องกวาดสายตากลับไปมา
 * ระหว่างสีในรูปกับสีในคำอธิบาย และเป็นตัวที่ทำให้จานสีคอนทราสต์ต่ำใช้ได้
 */
export function Donut({ items, total, totalLabel = 'รวม', format = moneyShort, size = 168 }) {
  const [hover, setHover] = useState(null);
  const live = (items || []).filter((d) => Number(d.value) > 0);
  const sum = total ?? live.reduce((a, d) => a + Number(d.value || 0), 0);

  if (!live.length || sum <= 0) return <EmptyChart />;

  const r = size / 2 - 6;
  /* ช่องไฟ 0.028 เรเดียน ที่รัศมี ~78px คิดเป็นระยะจริงราว 2px ตามสเปกของมาร์ก
     — ช่องไฟเป็นที่ว่างสีพื้น ไม่ใช่เส้นขอบที่ตีรอบชิ้น */
  const arcs = donutArcs(live.map((d) => d.value), {
    cx: size / 2, cy: size / 2, r, thickness: Math.round(size * 0.19), gap: 0.028,
  });

  return (
    <div className="chart-donut">
      <div className="donut-ring">
        <svg
          className="chart-svg"
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          height={size}
          role="img"
          aria-label={`สัดส่วน ${live.map((d) => `${d.label} ${d.value}`).join(', ')}`}
        >
          {arcs.map((a) => {
            const item = live[a.i];
            const on = hover === a.i;
            return (
              <path
                key={a.i}
                d={a.d}
                fill={item.color || seriesColor(a.i)}
                opacity={hover === null || on ? 1 : 0.45}
                onMouseEnter={() => setHover(a.i)}
                onMouseLeave={() => setHover(null)}
                style={{ transition: 'opacity .12s' }}
              />
            );
          })}
          <text className="donut-total" x={size / 2} y={size / 2 - 2} textAnchor="middle">
            {format(hover === null ? sum : live[hover].value)}
          </text>
          <text className="donut-cap" x={size / 2} y={size / 2 + 16} textAnchor="middle">
            {hover === null ? totalLabel : live[hover].label}
          </text>
        </svg>
      </div>

      <ul className="donut-legend">
        {live.map((d, i) => (
          <li
            key={d.label}
            className={hover === i ? 'on' : ''}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="sw" style={{ background: d.color || seriesColor(i) }} />
            <span className="lg-label">{d.label}</span>
            <span className="lg-val">{format(d.value)}</span>
            <span className="lg-pct">{sum > 0 ? Math.round((d.value / sum) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* แท่งตั้ง — ยอดตามวัน                                                 */
/* ------------------------------------------------------------------ */

/**
 * data: [{ label, value, key? }] — ชุดเดียว ใช้สีแบรนด์
 *
 * ป้ายใต้แกนถูกทำให้บางลงเมื่อวันเยอะ (`every`) — ป้ายที่ทับกันจนอ่านไม่ออกแย่กว่า
 * ป้ายที่มีห่าง ๆ · ค่าไม่ถูกเขียนกำกับทุกแท่ง มีแค่แท่งที่สูงสุดกับแท่งที่ชี้อยู่
 * เพราะตัวเลขบนทุกแท่งคือตัวเลขที่ไม่มีใครอ่าน
 */
export function Bars({ data, format = moneyShort, color = 'var(--accent)' }) {
  const [hover, setHover] = useState(null);
  const [boxRef, boxW] = useBoxWidth();
  const rows = data || [];
  if (!rows.length) return <EmptyChart />;

  const values = rows.map((d) => Number(d.value) || 0);
  if (!values.some((v) => v > 0)) return <EmptyChart text="ช่วงนี้ยังไม่มียอดขาย" />;

  const padB = 26;
  const padT = 12;
  const m = chartMetrics(boxW);
  const { plotW, plotH: height } = m;
  const { bars, top } = barLayout(values, {
    width: plotW, height, thickness: barThickness(plotW / values.length),
  });
  const ticks = axisTicks(Math.max(...values));
  const peak = values.indexOf(Math.max(...values));
  const every = Math.max(1, Math.ceil(rows.length / 12));

  return (
    <div className="chart-box">
      <div className="chart-plot" ref={boxRef}>
        {/* ไม่ใส่ preserveAspectRatio="none" — การยืดแกน X อย่างเดียวจะยืด
            ตัวอักษรบนแกนไปด้วยจนตัวหนังสือแบนผิดรูป · viewBox เท่ากับความกว้าง
            จริงของกล่องอยู่แล้ว จึงไม่มีการย่อขยายให้ต้องกังวล */}
        <svg
          className="chart-svg"
          viewBox={`0 0 ${m.viewW} ${height + padT + padB}`}
          role="img"
          aria-label="ยอดขายรายวัน"
        >
          <g transform={`translate(${m.padL} ${padT})`}>
            {ticks.map((t) => {
              const y = height - (top > 0 ? (t / top) * height : 0);
              return (
                <g key={t}>
                  <line className="chart-grid" x1={0} x2={plotW} y1={y} y2={y} />
                  <text className="chart-axis" x={-10} y={y + 4} textAnchor="end">
                    {format(t)}
                  </text>
                </g>
              );
            })}

            {bars.map((b) => (
              <g key={b.i}>
                {/* พื้นที่รับเมาส์กว้างเต็มช่อง — แท่งเตี้ย ๆ ชี้โดนยาก */}
                <rect
                  x={b.cx - (plotW / rows.length) / 2}
                  y={0}
                  width={plotW / rows.length}
                  height={height}
                  fill="transparent"
                  onMouseEnter={() => setHover(b.i)}
                  onMouseLeave={() => setHover(null)}
                />
                <path
                  className="chart-bar"
                  d={barPath(b.x, b.y, b.w, b.h)}
                  fill={color}
                  opacity={hover === null || hover === b.i ? 1 : 0.4}
                  pointerEvents="none"
                />
                {b.i === peak && b.h > 0 ? (
                  <text className="chart-peak" x={b.cx} y={b.y - 6} textAnchor="middle">
                    {format(b.value)}
                  </text>
                ) : null}
              </g>
            ))}

            <line className="chart-base" x1={0} x2={plotW} y1={height} y2={height} />

            {bars.map((b) => (b.i % every === 0 ? (
              <text
                key={`x${b.i}`}
                className="chart-axis"
                x={b.cx}
                y={height + 17}
                textAnchor="middle"
              >
                {rows[b.i].label}
              </text>
            ) : null))}
          </g>
        </svg>

        <Tip at={hover === null ? null : tipAt(hover, rows.length, m)}>
          {hover !== null ? (
            <>
              <b>{rows[hover].full || rows[hover].label}</b>
              <span>{format(rows[hover].value)}</span>
            </>
          ) : null}
        </Tip>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* แท่งนอน — จัดอันดับหมวด/พนักงาน                                      */
/* ------------------------------------------------------------------ */

/**
 * ชื่อหมวดสินค้าและชื่อคนไทยยาวเกินกว่าจะวางใต้แกนของแท่งตั้งได้โดยไม่เอียงหรือ
 * ตัดคำ · แท่งนอนอ่านชื่อได้เต็มและเรียงอันดับได้ในตัว
 *
 * ตัวเลขวางที่ปลายแท่ง ไม่ใช่ข้างใน — ข้างในแท่งสั้น ๆ ใส่ไม่ลงและถูกตัดครึ่ง
 */
export function HBars({ data, format = moneyShort, color = 'var(--accent)', max = 8 }) {
  const rows = (data || []).slice(0, max);
  if (!rows.length) return <EmptyChart />;
  const top = niceMax(Math.max(...rows.map((d) => Number(d.value) || 0)));
  if (!(top > 0)) return <EmptyChart text="ช่วงนี้ยังไม่มียอดขาย" />;

  return (
    <ul className="hbars">
      {rows.map((d, i) => (
        <li key={d.label}>
          <span className="hb-label" title={d.label}>{d.label}</span>
          <span className="hb-track">
            <span
              className="hb-fill"
              style={{
                width: `${Math.max(1, ((Number(d.value) || 0) / top) * 100)}%`,
                background: d.color || color,
              }}
            />
          </span>
          <span className="hb-val">{format(d.value)}</span>
          {d.sub ? <span className="hb-sub">{d.sub}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* แท่งซ้อน — ต้นทุนกับกำไรในแท่งเดียวกัน                                */
/* ------------------------------------------------------------------ */

/**
 * data:   [{ label, parts: [n, n, …] }]
 * series: [{ label, color }]
 *
 * ซ้อนกันได้เพราะสองชั้นรวมกันแล้วมีความหมาย (ต้นทุน + กำไร = ยอดขาย) —
 * ถ้าชั้นบวกกันแล้วไม่ได้อะไร ต้องเป็นแท่งคู่ ไม่ใช่แท่งซ้อน
 */
export function StackedBars({ data, series, format = moneyShort }) {
  const [hover, setHover] = useState(null);
  const [boxRef, boxW] = useBoxWidth();
  const rows = data || [];
  if (!rows.length) return <EmptyChart />;

  const totals = rows.map((d) => d.parts.reduce((a, b) => a + (Number(b) || 0), 0));
  if (!totals.some((v) => v > 0)) return <EmptyChart text="ช่วงนี้ยังไม่มีข้อมูลต้นทุน" />;

  const padB = 26;
  const padT = 12;
  const m = chartMetrics(boxW);
  const { plotW, plotH: height } = m;
  const top = niceMax(Math.max(...totals));
  const band = plotW / rows.length;
  const thickness = barThickness(band);
  const ticks = axisTicks(Math.max(...totals));
  const every = Math.max(1, Math.ceil(rows.length / 12));

  return (
    <div className="chart-box">
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.label}>
            <i className="sw" style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>

      <div className="chart-plot" ref={boxRef}>
        <svg
          className="chart-svg"
          viewBox={`0 0 ${m.viewW} ${height + padT + padB}`}
          role="img"
          aria-label="ต้นทุนและกำไรรายวัน"
        >
          <g transform={`translate(${m.padL} ${padT})`}>
            {ticks.map((t) => {
              const y = height - (top > 0 ? (t / top) * height : 0);
              return (
                <g key={t}>
                  <line className="chart-grid" x1={0} x2={plotW} y1={y} y2={y} />
                  <text className="chart-axis" x={-10} y={y + 4} textAnchor="end">
                    {format(t)}
                  </text>
                </g>
              );
            })}

            {rows.map((row, i) => {
              const segs = stackLayout(row.parts, { height, top });
              const x = i * band + (band - thickness) / 2;
              return (
                <g key={row.label}>
                  <rect
                    x={i * band}
                    y={0}
                    width={band}
                    height={height}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  />
                  {segs.map((s, j) => (s ? (
                    <path
                      key={j}
                      /* ชั้นบนสุดเท่านั้นที่ปลายมน ชั้นล่างเหลี่ยมเพราะมีชั้นทับอยู่ */
                      d={j === segs.length - 1 || !segs.slice(j + 1).some(Boolean)
                        ? barPath(x, s.y, thickness, s.h)
                        : `M${x} ${s.y}h${thickness}v${s.h}h${-thickness}Z`}
                      fill={series[j]?.color || seriesColor(j)}
                      opacity={hover === null || hover === i ? 1 : 0.4}
                      pointerEvents="none"
                    />
                  ) : null))}
                </g>
              );
            })}

            <line className="chart-base" x1={0} x2={plotW} y1={height} y2={height} />

            {rows.map((row, i) => (i % every === 0 ? (
              <text
                key={`x${row.label}`}
                className="chart-axis"
                x={i * band + band / 2}
                y={height + 17}
                textAnchor="middle"
              >
                {row.label}
              </text>
            ) : null))}
          </g>
        </svg>

        <Tip at={hover === null ? null : tipAt(hover, rows.length, m)}>
          {hover !== null ? (
            <>
              <b>{rows[hover].full || rows[hover].label}</b>
              {series.map((s, j) => (
                <span key={s.label}>
                  <i className="sw" style={{ background: s.color }} />
                  {s.label} {format(rows[hover].parts[j])}
                </span>
              ))}
            </>
          ) : null}
        </Tip>
      </div>
    </div>
  );
}
