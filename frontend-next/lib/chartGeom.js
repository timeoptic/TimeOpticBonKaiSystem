/**
 * เรขาคณิตของกราฟ — คณิตศาสตร์ล้วน ไม่มี React ไม่มี DOM
 *
 * แยกจาก `components/charts.jsx` เพราะสามอย่างนี้เทสได้และควรถูกเทส: มุมของโดนัท
 * ที่ต้องบวกกันได้ 360 องศาพอดี · สเกลแท่งที่ต้องไม่หารด้วยศูนย์ · และเลขบนแกน
 * ที่ต้องกลม · ส่วนไฟล์ .jsx เทสด้วย `node --test` ไม่ได้เพราะไม่มีตัวแปลง JSX
 */

/** ตัวเลขที่คนอ่านแกนแล้วไม่สะดุด: 1 · 2 · 2.5 · 5 · 10 คูณกำลังสิบ */
export function niceMax(max) {
  if (!(max > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

/**
 * ขีดบนแกน Y รวมศูนย์เสมอ
 *
 * เริ่มที่ศูนย์ ไม่ใช่ที่ค่าต่ำสุด — แกนที่ถูกตัดหัวทำให้ผลต่าง 2% ดูเหมือน 200%
 * ซึ่งเป็นวิธีโกหกด้วยกราฟที่พบบ่อยที่สุด
 */
export function axisTicks(max, count = 4) {
  const top = niceMax(max);
  const out = [];
  for (let i = 0; i <= count; i++) out.push((top / count) * i);
  return out;
}

/**
 * แท่งของกราฟแท่ง — คืนตำแหน่งและขนาดเป็นพิกัด SVG
 *
 * `thickness` ถูกจำกัดไว้ไม่เกิน 24px ตามสเปกของมาร์ก · ช่องที่เหลือเป็นอากาศ
 * ไม่ใช่แท่งที่อ้วนจนชนกัน · ค่าทั้งชุดเป็นศูนย์ก็ยังวาดแกนได้ (สเกลตกเป็น 1)
 */
export function barLayout(values, { width, height, thickness: fixed = null } = {}) {
  const n = values.length;
  if (!n || !(width > 0) || !(height > 0)) return { bars: [], top: 1 };

  const top = niceMax(Math.max(0, ...values.map((v) => Number(v) || 0)));
  const band = width / n;
  /* ผู้เรียกกำหนดความหนามาเองได้ เพื่อให้แท่งเดี่ยวกับแท่งซ้อนหนาเท่ากันเป๊ะ —
     สองสูตรที่คิดแยกกันคือกราฟสองอันที่วางซ้อนกันแล้วขอบไม่ตรง */
  const thickness = fixed !== null
    ? Math.max(1, fixed)
    : Math.max(3, Math.min(band * 0.55, 44));

  const bars = values.map((raw, i) => {
    const v = Math.max(0, Number(raw) || 0);
    const h = top > 0 ? (v / top) * height : 0;
    return {
      i,
      value: v,
      x: i * band + (band - thickness) / 2,
      y: height - h,
      w: thickness,
      h,
      cx: i * band + band / 2,
    };
  });
  return { bars, top, band, thickness };
}

const TAU = Math.PI * 2;

/** จุดบนวงกลม โดยมุม 0 อยู่ตำแหน่ง 12 นาฬิกา แล้วเดินตามเข็ม */
function onCircle(cx, cy, r, angle) {
  return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];
}

/**
 * ชิ้นของโดนัท — คืน path ของวงแหวน ไม่ใช่ของพาย
 *
 * สามเรื่องที่ต้องดักไม่งั้นได้กราฟที่หายไปเฉย ๆ:
 *
 *   1. ยอดรวมเป็นศูนย์ → คืนอาเรย์ว่าง ให้หน้าเว็บขึ้นสถานะว่าง ไม่ใช่วาด NaN
 *      ลงใน path ซึ่งเบราว์เซอร์จะทิ้งทั้งรูปโดยไม่มี error ให้เห็น
 *   2. ชิ้นเดียว 100% → arc ที่เริ่มและจบจุดเดียวกันคือ arc ที่ยาวศูนย์ตามสเปก
 *      SVG · ต้องผ่าเป็นสองครึ่ง ไม่งั้นวงแหวนเต็มวงจะไม่ปรากฏ
 *   3. ชิ้นที่เล็กกว่าช่องไฟ → ไม่หักช่องไฟจนมุมติดลบ (path พลิกด้าน)
 *
 * ช่องไฟระหว่างชิ้นเป็น "สีพื้น" ตามสเปกของมาร์ก — เว้นที่ไว้ ไม่ใช่ตีเส้นขอบ
 */
export function donutArcs(values, {
  cx = 60, cy = 60, r = 54, thickness = 22, gap = 0.02,
} = {}) {
  const nums = values.map((v) => Math.max(0, Number(v) || 0));
  const total = nums.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];

  const rIn = Math.max(0, r - thickness);
  const live = nums.filter((v) => v > 0).length;

  let cursor = 0;
  const out = [];

  nums.forEach((v, i) => {
    if (v <= 0) return;
    const sweep = (v / total) * TAU;
    const start = cursor;
    cursor += sweep;

    /* ชิ้นเดียวเต็มวง — ไม่มีที่ให้เว้นช่องไฟ และต้องผ่าครึ่ง */
    if (live === 1) {
      const [ax, ay] = onCircle(cx, cy, r, 0);
      const [bx, by] = onCircle(cx, cy, r, Math.PI);
      const [cx2, cy2] = onCircle(cx, cy, rIn, Math.PI);
      const [dx, dy] = onCircle(cx, cy, rIn, 0);
      out.push({
        i,
        value: v,
        pct: 1,
        mid: Math.PI,
        d: `M${ax} ${ay}A${r} ${r} 0 0 1 ${bx} ${by}A${r} ${r} 0 0 1 ${ax} ${ay}`
          + `L${dx} ${dy}A${rIn} ${rIn} 0 0 0 ${cx2} ${cy2}A${rIn} ${rIn} 0 0 0 ${dx} ${dy}Z`,
      });
      return;
    }

    /* ช่องไฟกินได้มากสุดครึ่งหนึ่งของชิ้น — ชิ้นบางเฉียบจึงยังเหลือให้เห็น */
    const pad = Math.min(gap / 2, sweep / 2 - 0.0005);
    const a0 = start + pad;
    const a1 = start + sweep - pad;
    const big = a1 - a0 > Math.PI ? 1 : 0;

    const [x0, y0] = onCircle(cx, cy, r, a0);
    const [x1, y1] = onCircle(cx, cy, r, a1);
    const [x2, y2] = onCircle(cx, cy, rIn, a1);
    const [x3, y3] = onCircle(cx, cy, rIn, a0);

    out.push({
      i,
      value: v,
      pct: v / total,
      mid: start + sweep / 2,
      d: `M${x0} ${y0}A${r} ${r} 0 ${big} 1 ${x1} ${y1}`
        + `L${x2} ${y2}A${rIn} ${rIn} 0 ${big} 0 ${x3} ${y3}Z`,
    });
  });

  return out;
}

/**
 * แท่งซ้อน — คืนช่วงของแต่ละชั้นพร้อมช่องไฟสีพื้นคั่น
 *
 * ช่องไฟถูกหักจาก *ด้านบน* ของทุกชั้นยกเว้นชั้นบนสุด ผลรวมความสูงจึงยังเท่ากับ
 * สเกลเดิม (แท่งไม่ยืดออกมาเกินแกน) และชั้นที่บางกว่าช่องไฟจะไม่กลายเป็นลบ
 */
export function stackLayout(values, { height, top, gap = 2 } = {}) {
  const nums = values.map((v) => Math.max(0, Number(v) || 0));
  const scale = top > 0 ? height / top : 0;
  const live = nums.filter((v) => v > 0).length;

  let y = height;
  const out = [];
  let seen = 0;
  nums.forEach((v, i) => {
    if (v <= 0) {
      out.push(null);
      return;
    }
    seen++;
    const full = v * scale;
    const cut = seen < live ? Math.min(gap, full) : 0;
    const h = Math.max(0, full - cut);
    y -= full;
    out.push({ i, value: v, y, h });
  });
  return out;
}
