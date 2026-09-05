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

export type Rank = { label: string; sub?: string; value: number };

/**
 * แท่งอันดับ — ชื่อทางซ้าย แท่งตรงกลาง ตัวเลขทางขวา
 *
 * เรียงจากมากไปน้อยตามที่ API ส่งมา ไม่เรียงใหม่ที่นี่ · ลำดับเป็นคำตอบของ
 * คำถาม ("ขายดีที่สุด") การเรียงซ้ำที่ชั้นวาดภาพคือโอกาสให้ภาพกับตารางไม่ตรงกัน
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
    x.fillStyle = color;
    x.fillRect(trackX, y - 7, Math.max(2, (r.value / peak) * trackW), 14);

    x.fillStyle = TEXT;
    x.font = `12px ${FONT}`;
    x.textAlign = "right";
    x.fillText(`${r.value.toLocaleString("th-TH")} ${unit}`, W - 16, y);
  });

  return c.toDataURL("image/png");
}
