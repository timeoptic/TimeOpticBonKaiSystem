/* TimeOptic Web — กราฟแท่ง SVG เขียนเอง ไม่มี dependency ไม่ต้องต่อเน็ต
 *
 * สีสองชุดนี้ผ่านการตรวจด้วยเครื่องมือแล้ว ไม่ได้เลือกด้วยสายตา:
 *   ระยะห่างสำหรับตาปกติ ΔE 27.1 · ตาบอดสีเขียว-แดง ΔE 13.7 · คอนทราสต์กับพื้นขาว ผ่าน 3:1
 * ถ้าจะเปลี่ยนสี ต้องรันตัวตรวจใหม่ อย่าเปลี่ยนด้วยความรู้สึก
 */
export const SERIES_COLORS = ['#0d9488', '#c2410c'];

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) n.setAttribute(k, String(v));
  }
  return n;
};

/** เลขกลมๆ สำหรับเส้นแกน เช่น 0 / 5,000 / 10,000 */
function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const out = [];
  for (let v = 0; v <= Math.ceil(max / step) * step + 1e-6; v += step) out.push(v);
  return out;
}

/** แท่งปลายมน 4px เฉพาะด้านบน ฐานติดเส้นศูนย์เสมอ */
function barPath(x, y, w, h, r = 4) {
  const rr = Math.min(r, w / 2, h);
  if (h <= 0.5) return `M${x} ${y + h}h${w}`;
  return `M${x} ${y + h}V${y + rr}a${rr} ${rr} 0 0 1 ${rr} ${-rr}h${w - rr * 2}`
    + `a${rr} ${rr} 0 0 1 ${rr} ${rr}V${y + h}Z`;
}

/**
 * วาดกราฟแท่งคู่ลงใน host และวาดใหม่เองเมื่อความกว้างเปลี่ยน
 * @param {HTMLElement} host
 * @param {{categories:string[], series:{name:string,values:number[]}[],
 *          format?:(n:number)=>string, height?:number}} opt
 */
export function groupedBars(host, opt) {
  const { categories, series, format = (n) => String(n), height = 300 } = opt;
  let lastW = -1;

  const draw = () => {
    const W = Math.max(320, Math.round(host.clientWidth));
    if (W === lastW) return;
    lastW = W;

    const H = height;
    const padL = 66, padR = 12, padT = 14, padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const flat = series.flatMap((s) => s.values);
    const ticks = niceTicks(Math.max(0, ...flat));
    const top = ticks[ticks.length - 1] || 1;
    const yOf = (v) => padT + plotH - (v / top) * plotH;

    const svg = svgEl('svg', {
      width: W, height: H, viewBox: `0 0 ${W} ${H}`,
      role: 'img', class: 'chart-svg',
    });

    /* เส้นตารางจางๆ ให้ถอยหลังไปเป็นฉาก ไม่แย่งสายตากับแท่ง */
    for (const t of ticks) {
      const y = yOf(t);
      svg.append(svgEl('line', {
        x1: padL, x2: W - padR, y1: y, y2: y,
        stroke: t === 0 ? 'var(--line)' : 'var(--line-soft)', 'stroke-width': 1,
      }));
      const lab = svgEl('text', {
        x: padL - 9, y: y + 4, 'text-anchor': 'end',
        class: 'chart-axis',
      });
      lab.textContent = format(t);
      svg.append(lab);
    }

    /* จำกัดความกว้างต่อกลุ่มไว้ ไม่งั้นพอมีไม่กี่เดือนแท่งจะลอยห่างกันคนละมุมจอ
       แล้วจัดกลุ่มทั้งก้อนไว้กลางพื้นที่วาด */
    const n = Math.max(1, categories.length);
    const groupW = Math.min(plotW / n, 150);
    const originX = padL + (plotW - groupW * n) / 2;
    const inner = Math.min(groupW * 0.62, 64);
    const gap = 2;                                   // ช่องว่างระหว่างแท่งที่ติดกัน
    const barW = Math.max(3, (inner - gap * (series.length - 1)) / series.length);

    categories.forEach((cat, i) => {
      const gx = originX + groupW * i + (groupW - inner) / 2;
      series.forEach((s, si) => {
        const v = Number(s.values[i]) || 0;
        const y = yOf(v);
        const x = gx + si * (barW + gap);
        const bar = svgEl('path', {
          d: barPath(x, y, barW, padT + plotH - y),
          fill: SERIES_COLORS[si % SERIES_COLORS.length],
          class: 'chart-bar',
        });
        const t = svgEl('title');
        t.textContent = `${cat} · ${s.name} ${format(v)}`;
        bar.append(t);
        svg.append(bar);
      });

      const lab = svgEl('text', {
        x: originX + groupW * i + groupW / 2, y: H - 12,
        'text-anchor': 'middle', class: 'chart-axis',
      });
      lab.textContent = cat;
      svg.append(lab);
    });

    host.replaceChildren(svg);
  };

  draw();
  // ความกว้างเปลี่ยน (ย่อ/กาง sidebar, หมุนจอ) ต้องวาดใหม่ ไม่งั้นแท่งจะเพี้ยน
  if (typeof ResizeObserver === 'function') new ResizeObserver(draw).observe(host);
}
