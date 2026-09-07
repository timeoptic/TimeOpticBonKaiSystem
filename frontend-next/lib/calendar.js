/**
 * Pure month-grid date math for the booking calendar. Extracted from
 * frontend/src/pages/bookings/BookingCalendar.jsx, where this logic lived
 * inline in JSX and so could never be unit tested.
 */

/**
 * Number of days in `month` (1-based). `new Date(year, month, 0)` looks 0-based, but
 * because JS Date months are internally 0-based, passing our 1-based `month` as the
 * 0-based slot means "day 0 of the following month" — i.e. the last day of the month
 * we actually want — which is exactly the day count we're after.
 */
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** Day of week (0=Sun..6=Sat) the month's 1st falls on — how many blank lead cells a grid needs. */
export function leadOffset(year, month) {
  return new Date(year, month - 1, 1).getDay();
}

/** 'YYYY-MM' shifted by delta months, e.g. shiftMonth('2026-12', 1) -> '2027-01'. */
export function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' · ค่าว่างหรืออ่านไม่ออกคืนค่าว่าง ไม่ใช่ 'NaN/NaN/NaN' */
export function toDisplayDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').slice(0, 10));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/**
 * อ่านวันที่ที่คนพิมพ์เอง แล้วคืน 'YYYY-MM-DD' — อ่านไม่ออกหรือไม่มีวันนั้นจริงคืน null
 *
 * รับตัวคั่นอะไรก็ได้ที่ไม่ใช่ตัวเลข (4/9/2026 · 04-09-2026 · 4.9.69) และรับแบบ
 * ไม่มีตัวคั่นเลย (04092026) เพราะคนกรอกเร็ว ๆ พิมพ์รวดเดียวไม่กดทับ
 *
 * ปีรับได้ทั้ง ค.ศ. และ พ.ศ. — คนที่ร้านเขียนใบเสร็จเป็น พ.ศ. แต่ฐานข้อมูลเก็บ ค.ศ.
 * ถ้าไม่รับ พ.ศ. คนพิมพ์ 2569 จะได้วันที่ในอีกห้าร้อยปีข้างหน้าโดยไม่มีอะไรเตือน
 * ปีสองหลัก (69) ถือเป็น พ.ศ. ย่อ ซึ่งเป็นวิธีเขียนที่ใช้กันจริงบนใบเสร็จ
 *
 * ตรวจว่าวันนั้นมีจริงด้วย ไม่ใช่แค่ตัวเลขอยู่ในช่วง — 31/02 ผ่านการเช็คช่วงได้
 * แต่ไม่มีในปฏิทิน ถ้าปล่อยไปจะกลายเป็น 03/03 เงียบ ๆ ตอนที่ Date ปัดให้เอง
 */
export function parseTypedDate(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  let d;
  let mo;
  let y;
  const parts = raw.split(/[^0-9]+/).filter(Boolean);
  if (parts.length === 3 && parts[0].length === 4) {
    /* วางทับมาจากที่อื่นเป็น 2026-09-04 ก็อ่านออก — ก้อนสี่หลักนำหน้าคือปี ไม่ใช่วันที่ */
    [y, mo, d] = parts.map(Number);
  } else if (parts.length === 3) {
    [d, mo, y] = parts.map(Number);
  } else if (parts.length === 1 && parts[0].length === 8) {
    d = Number(parts[0].slice(0, 2));
    mo = Number(parts[0].slice(2, 4));
    y = Number(parts[0].slice(4));
  } else {
    return null;
  }
  if (!d || !mo || !y) return null;

  if (y < 100) y += 2500;
  if (y > 2400) y -= 543;
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > daysInMonth(y, mo)) return null;

  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * อ่านเวลาที่คนพิมพ์เอง แล้วคืน 'HH:MM' — อ่านไม่ออกหรือไม่มีเวลานั้นจริงคืน null
 *
 * กติกาเดียวกับ parseTypedDate: ตัวคั่นเป็นอะไรก็ได้ที่ไม่ใช่ตัวเลข (9:30 · 9.30 ·
 * 9 30) และไม่มีตัวคั่นเลยก็ได้ (930 · 0930) เพราะคนกรอกพิมพ์รวดเดียวแล้ว Tab ต่อ
 * ตัวเลขก้อนเดียวสั้น ๆ คือชั่วโมงล้วน — พิมพ์ 9 แล้วออกจากช่องได้ 09:00
 *
 * คืน null เมื่ออ่านไม่ออก ไม่ใช่ปัดให้ใกล้เคียง — 25:00 ที่ถูกปัดเป็น 23:59 เงียบ ๆ
 * คือนัดที่ผิดเวลาโดยไม่มีอะไรเตือน
 */
export function parseTypedTime(text) {
  const parts = String(text ?? '').trim().split(/[^0-9]+/).filter(Boolean);
  if (!parts.length) return null;

  let h;
  let mi;
  if (parts.length >= 2) {
    [h, mi] = parts.map(Number);
  } else if (parts[0].length <= 2) {
    h = Number(parts[0]);
    mi = 0;
  } else if (parts[0].length === 3 || parts[0].length === 4) {
    h = Number(parts[0].slice(0, parts[0].length - 2));
    mi = Number(parts[0].slice(-2));
  } else {
    return null;
  }

  if (!Number.isInteger(h) || !Number.isInteger(mi)) return null;
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** ทุกเวลาในหนึ่งวันห่างกันทีละ `step` นาที — รายการที่ TimeField กางออกมาให้เลือก */
export function timeOptions(step = 15) {
  const out = [];
  for (let m = 0; m < 24 * 60; m += step) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}

/** 'HH:MM' -> จำนวนนาทีนับจากเที่ยงคืน · อ่านไม่ออกคืน null (ใช้หาตัวเลือกที่ใกล้ที่สุด) */
export function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * แยกค่าแบบที่ <input type="datetime-local"> เคยส่งออก เป็น ['YYYY-MM-DD', 'HH:MM']
 *
 * รับค่าที่มีวินาทีต่อท้ายและค่าที่คั่นด้วยเว้นวรรคด้วย เพราะค่าที่อ่านกลับมาจาก API
 * เป็น '2026-09-05 14:30:00' ตามที่ MySQL เก็บ ไม่ใช่รูปแบบที่ช่องเคยส่งไป
 */
export function splitLocal(value) {
  const raw = String(value ?? '').trim();
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(raw);
  if (!m) return ['', ''];
  return [m[1], m[2] || ''];
}

/** ประกอบกลับเป็น 'YYYY-MM-DDTHH:MM' — ไม่มีวันที่ก็ไม่มีค่า เวลาที่ลอยอยู่เดี่ยว ๆ ไม่มีความหมาย */
export function joinLocal(date, time) {
  if (!date) return '';
  return `${date}T${time || '00:00'}`;
}
