/**
 * กราฟสำหรับใส่ลงไฟล์ Excel — วาดใหม่บน canvas ไม่ใช่ถ่ายภาพหน้าจอ
 *
 * กราฟบนหน้าจอเป็นได้ทั้ง `<svg>` (รายวัน) และ `<ul>` ธรรมดา (อันดับ) การจะ
 * "ถ่าย" ทั้งสองแบบต้องพึ่ง html2canvas ซึ่งเป็นไลบรารีอีกตัวและได้ภาพที่เป็น
 * ภาพหน้าเว็บ — มีเงา มีมุมโค้ง มีฟอนต์ของธีม และกว้างเท่าที่จอบังเอิญกว้าง
 *
 * วาดจากตัวเลขโดยตรงได้ภาพที่ทำมาเพื่อกระดาษ: ขนาดคงที่ อ่านออกตอนพิมพ์ และไม่
 * ขึ้นกับว่าตอนกดจอกว้างเท่าไรหรือธีมเป็นสีอะไร · ไม่ต้องลงอะไรเพิ่มด้วย
 *
 * ทุกอย่างวาดที่ความละเอียดสองเท่าแล้วย่อ — ตัวอักษรใน Excel จะได้ไม่แตกตอนซูม
 */

/** ขนาดจริงของภาพ (จุดต่อภาพ = SCALE เท่าของขนาดที่ออกแบบไว้) */
const SCALE = 2;

/** สีเดียวกับกราฟบนหน้าจอ (ดู `CHART_INK` ใน Charts.tsx) */
export const INK = {
  in: "#1f7a4d",
  out: "#3a46c8",
  scrap: "#c0392b",
  cost: "#9a6a1b",
  /* ไม่มีคู่บนจอ — สำหรับแถวที่ไม่มีทิศ (ปรับยอด) ในกราฟที่แถวอื่นมีทิศ · เทา
     อมเขียวไม่ใช่เทาล้วน เพราะเทาล้วนข้างสี่สีนี้อ่านเหมือนแท่งที่ยังโหลดไม่เสร็จ */
  flat: "#6f7b76",
};

const AXIS = "#c9c9c9";
const TEXT = "#333333";
const MUTED = "#777777";
const FONT = "'Segoe UI', 'Noto Sans Thai', sans-serif";

function surface(w: number, h: number): { c: HTMLCanvasElement; x: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = w * SCALE;
  c.height = h * SCALE;
  const x = c.getContext("2d");
  if (x === null) throw new Error("วาดกราฟไม่ได้ — เบราว์เซอร์ไม่ให้ canvas");
  x.scale(SCALE, SCALE);
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, w, h);
  x.textBaseline = "middle";
  return { c, x };
}

/** ตัวเลขบนแกน — ย่อหลักพันเป็น k เพราะแกนแคบและตัวเลขคลังเป็นหมื่นได้ */
function tick(n: number): string {
  if (Math.abs(n) >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(Math.round(n * 100) / 100);
}

/** ตัดข้อความที่ยาวเกินความกว้างที่ให้ แล้วปิดท้ายด้วยจุดไข่ปลา */
function clip(x: CanvasRenderingContext2D, text: string, max: number): string {
  if (x.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && x.measureText(`${cut}…`).width > max) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

export type Series = { label: string; color: string; values: number[] };

/**
 * แท่งรายวัน — หลายชุดเรียงชิดกันในหนึ่งวัน
 *
 * แกนตั้งเริ่มที่ศูนย์เสมอ ไม่ใช่ที่ค่าต่ำสุด · แกนที่ถูกตัดหัวทำให้ความต่าง
 * 2% ดูเหมือน 200% ซึ่งเป็นเรื่องที่คนอ่านรายงานคลังไม่ควรต้องคอยระวัง
 */
export function daysPng(labels: string[], series: Series[], title: string): string {
  const W = 900;
  const H = 320;
  const pad = { top: 44, right: 16, bottom: 40, left: 56 };
  const { c, x } = surface(W, H);

  x.fillStyle = TEXT;
  x.font = `600 15px ${FONT}`;
  x.fillText(title, pad.left, 18);

  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const peak = Math.max(1, ...series.flatMap((s) => s.values));

  // เส้นแนวนอนสี่เส้น พอให้กะค่าได้โดยไม่กลายเป็นตาราง
  x.strokeStyle = AXIS;
  x.lineWidth = 1;
  x.font = `11px ${FONT}`;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH * i) / 4;
    x.beginPath();
    x.moveTo(pad.left, y);
    x.lineTo(pad.left + plotW, y);
    x.stroke();
    x.fillStyle = MUTED;
    x.textAlign = "right";
    x.fillText(tick((peak * (4 - i)) / 4), pad.left - 8, y);
  }

  const slot = plotW / Math.max(1, labels.length);
  const barW = Math.max(2, (slot * 0.7) / series.length);

  labels.forEach((label, i) => {
    series.forEach((s, k) => {
      const v = s.values[i] ?? 0;
      const h = (v / peak) * plotH;
      x.fillStyle = s.color;
      x.fillRect(pad.left + i * slot + slot * 0.15 + k * barW, pad.top + plotH - h, barW, h);
    });
  });

  // ป้ายวันที่เท่าที่ใส่ได้ — ทุกวันเมื่อช่วงสั้น ทุก n วันเมื่อช่วงยาว
  const every = Math.ceil(labels.length / 12);
  x.fillStyle = MUTED;
  x.font = `11px ${FONT}`;
  x.textAlign = "center";
  labels.forEach((label, i) => {
    if (i % every !== 0) return;
    x.fillText(label, pad.left + i * slot + slot / 2, H - pad.bottom + 14);
  });

  // คำอธิบายสี บรรทัดบนสุด
  let legendX = pad.left;
  x.textAlign = "left";
  series.forEach((s) => {
    x.fillStyle = s.color;
    x.fillRect(legendX, 32, 10, 10);
    x.fillStyle = TEXT;
    x.font = `12px ${FONT}`;
    x.fillText(s.label, legendX + 15, 37);
    legendX += 25 + x.measureText(s.label).width;
  });

  return c.toDataURL("image/png");
}

export type Rank = {
  label: string;
  sub?: string;
  value: number;
  /** สีเฉพาะแถวนี้ — ใช้ตอนแต่ละแถวคนละชนิดกัน ไม่ใช่ของชุดเดียวกันที่เรียงอันดับ */
  color?: string;
};

/**
 * แท่งอันดับ — ชื่อทางซ้าย แท่งตรงกลาง ตัวเลขทางขวา
 *
 * เรียงจากมากไปน้อยตามที่ API ส่งมา ไม่เรียงใหม่ที่นี่ · ลำดับเป็นคำตอบของ
 * คำถาม ("ขายดีที่สุด") การเรียงซ้ำที่ชั้นวาดภาพคือโอกาสให้ภาพกับตารางไม่ตรงกัน
 *
 * `color` ที่ส่งมาเป็นสีของทั้งใบ · แถวไหนตั้ง `color` ของตัวเองไว้ก็ใช้ของตัวเอง
 * — ชีตสรุปเอาหกชนิดการเคลื่อนไหวมาเทียบกันในใบเดียว รับเข้ากับตัดของเสียเป็นสี
 * เดียวกันไม่ได้ ต่างจากชีตอันดับที่ทุกแถวเป็นของชนิดเดียวกันอยู่แล้ว
 */
export function rankPng(rows: Rank[], color: string, unit: string, title: string): string {
  const W = 900;
  const rowH = 30;
  const H = 56 + Math.max(1, rows.length) * rowH + 12;
  const labelW = 260;
  const valueW = 110;
  const { c, x } = surface(W, H);

  x.fillStyle = TEXT;
  x.font = `600 15px ${FONT}`;
  x.textAlign = "left";
  x.fillText(title, 16, 20);

  if (rows.length === 0) {
    x.fillStyle = MUTED;
    x.font = `12px ${FONT}`;
    x.fillText("ช่วงนี้ยังไม่มีข้อมูล", 16, 56);
    return c.toDataURL("image/png");
  }

  const peak = Math.max(1, ...rows.map((r) => r.value));
  const trackX = 16 + labelW;
  const trackW = W - trackX - valueW - 16;

  rows.forEach((r, i) => {
    const y = 48 + i * rowH + rowH / 2;

    x.fillStyle = TEXT;
    x.font = `12px ${FONT}`;
    x.textAlign = "left";
    x.fillText(clip(x, r.label, labelW - 12), 16, r.sub ? y - 6 : y);
    if (r.sub) {
      x.fillStyle = MUTED;
      x.font = `10px ${FONT}`;
      x.fillText(clip(x, r.sub, labelW - 12), 16, y + 8);
    }

    x.fillStyle = "#eeeeee";
    x.fillRect(trackX, y - 7, trackW, 14);
    x.fillStyle = r.color ?? color;
    x.fillRect(trackX, y - 7, Math.max(2, (r.value / peak) * trackW), 14);

    x.fillStyle = TEXT;
    x.font = `12px ${FONT}`;
    x.textAlign = "right";
    x.fillText(`${r.value.toLocaleString("th-TH")} ${unit}`, W - 16, y);
  });

  return c.toDataURL("image/png");
}

/**
 * จานสีของกราฟวงกลม
 *
 * สิบสีเรียงไว้ให้ชิ้นที่ติดกันบนวงต่างกันมากที่สุด ไม่ได้ไล่โทนเดียวกัน — วง
 * ที่ไล่เขียวอ่อนไปเขียวเข้มสวยกว่า แต่ชิ้นที่ 4 กับ 5 แยกกันไม่ออกบนกระดาษ
 * ขาวดำ ซึ่งเป็นสภาพที่ไฟล์นี้ถูกพิมพ์ออกมาจริงบ่อยกว่าที่คิด
 */
const SLICE = [
  "#1f7a4d", "#3a46c8", "#c0392b", "#9a6a1b", "#2f8fa8",
  "#7d3c98", "#b8860b", "#4b8b3b", "#8d6e63", "#546e7a",
];

/**
 * วงกลมสัดส่วน — ชิ้นไหนกินกี่เปอร์เซ็นต์ของก้อนนี้
 *
 * คู่กับ `rankPng` ไม่ใช่แทนกัน · แท่งอันดับตอบว่า "ใครมากที่สุด" ซึ่งเป็น
 * คำถามของคนที่จะไปคุยกับสาขานั้น · วงกลมตอบว่า "สาขานี้กินไปเท่าไรของทั้งหมด"
 * ซึ่งเป็นคำถามของคนที่กำลังตัดสินใจว่าจะสั่งของเพิ่มเท่าไร — เลขเดียวกัน คนละ
 * คำถาม และแท่งที่ยาวที่สุดไม่ได้บอกว่ามันคือครึ่งหนึ่งของทั้งก้อนหรือแค่ 12%
 *
 * เป็นโดนัทไม่ใช่วงตัน เพราะรูตรงกลางคือที่ของยอดรวม — ตัวเลขที่เปอร์เซ็นต์ทุก
 * ชิ้นอ้างถึง และถ้าไม่เขียนไว้ก็ต้องไปหาจากแถวรวมท้ายตารางอีกชีต
 *
 * ชิ้นที่เล็กกว่า 3% ไม่มีป้ายบนวง — ป้ายที่ทับกันสามอันอ่านไม่ออกทั้งสามอัน
 * ค่าของมันยังอยู่ครบในคำอธิบายสีทางขวา ซึ่งเป็นที่ที่คนอ่านเลขจริง ๆ อยู่แล้ว
 */
export function piePng(rows: Rank[], title: string, unit: string): string {
  const W = 900;
  const parts = rows.filter((r) => Number.isFinite(r.value) && r.value > 0);
  const H = Math.max(300, 72 + Math.max(1, parts.length) * 22 + 24);
  const { c, x } = surface(W, H);

  x.fillStyle = TEXT;
  x.font = `600 15px ${FONT}`;
  x.textAlign = "left";
  x.fillText(title, 16, 20);

  if (parts.length === 0) {
    x.fillStyle = MUTED;
    x.font = `12px ${FONT}`;
    x.fillText("ช่วงนี้ยังไม่มีข้อมูล", 16, 56);
    return c.toDataURL("image/png");
  }

  const sum = parts.reduce((n, r) => n + r.value, 0);
  const cx = 170;
  const cy = 48 + (H - 60) / 2;
  const outer = Math.min(112, (H - 96) / 2);
  const inner = outer * 0.52;

  let angle = -Math.PI / 2;
  parts.forEach((r, i) => {
    const sweep = (r.value / sum) * Math.PI * 2;
    x.beginPath();
    x.moveTo(cx, cy);
    x.arc(cx, cy, outer, angle, angle + sweep);
    x.closePath();
    x.fillStyle = SLICE[i % SLICE.length];
    x.fill();
    /* เส้นคั่นสีขาวบาง ๆ ระหว่างชิ้น — สองชิ้นที่สีใกล้กันเพราะวนจานสีรอบสอง
       จะยังเห็นเป็นสองชิ้น ไม่ใช่ชิ้นเดียวที่ใหญ่ผิดปกติ */
    x.strokeStyle = "#ffffff";
    x.lineWidth = 2;
    x.stroke();

    const pct = (r.value / sum) * 100;
    if (pct >= 3) {
      const mid = angle + sweep / 2;
      const at = (outer + inner) / 2;
      x.fillStyle = "#ffffff";
      x.font = `600 11px ${FONT}`;
      x.textAlign = "center";
      x.fillText(`${Math.round(pct)}%`, cx + Math.cos(mid) * at, cy + Math.sin(mid) * at);
    }

    angle += sweep;
  });

  // รูตรงกลาง แล้วเขียนยอดรวมลงไป — ฐานที่ทุกเปอร์เซ็นต์บนวงอ้างถึง
  x.beginPath();
  x.arc(cx, cy, inner, 0, Math.PI * 2);
  x.fillStyle = "#ffffff";
  x.fill();

  x.textAlign = "center";
  x.fillStyle = TEXT;
  x.font = `600 15px ${FONT}`;
  x.fillText(sum.toLocaleString("th-TH"), cx, cy - 6);
  x.fillStyle = MUTED;
  x.font = `11px ${FONT}`;
  x.fillText(`${unit} · ทั้งหมด`, cx, cy + 12);

  // คำอธิบายสีทางขวา — ชื่อ ค่า และเปอร์เซ็นต์ อยู่บรรทัดเดียวกันเสมอ
  const legendX = 320;
  const valueX = W - 16;
  let y = 52;
  x.textAlign = "left";
  parts.forEach((r, i) => {
    x.fillStyle = SLICE[i % SLICE.length];
    x.fillRect(legendX, y - 5, 10, 10);

    x.fillStyle = TEXT;
    x.font = `12px ${FONT}`;
    x.fillText(clip(x, r.label, 300), legendX + 16, y);

    x.textAlign = "right";
    x.fillStyle = MUTED;
    x.font = `12px ${FONT}`;
    x.fillText(
      `${r.value.toLocaleString("th-TH")} ${unit} · ${(Math.round((r.value / sum) * 1000) / 10).toFixed(1)}%`,
      valueX,
      y,
    );
    x.textAlign = "left";
    y += 22;
  });

  return c.toDataURL("image/png");
}
