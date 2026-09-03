/**
 * ช่วงวันที่ของหน้ารายงาน
 *
 * แยกออกมาเป็น .js ล้วน (ไม่ใช่ JSX) เพื่อให้ `node --test` เรียกได้ตรง ๆ —
 * ขอบของ "สัปดาห์นี้" กับ "เดือนนี้" เป็นจุดที่พังเงียบที่สุดในรายงานทุกตัว
 * (ต้นสัปดาห์วันไหน · เดือนที่ข้ามปี · เดือนกุมภาพันธ์) และพังแล้วไม่มีใครเห็น
 * เพราะตัวเลขยังออกมาเป็นตัวเลข แค่ผิดช่วง
 *
 * ทุกฟังก์ชันรับ `now` เข้ามาได้เพื่อให้เทสไม่ต้องรอให้ถึงวันจันทร์
 */

const p2 = (n) => String(n).padStart(2, '0');

/** Date -> 'YYYY-MM-DD' ตามเวลาท้องถิ่น (ไม่ใช่ UTC — toISOString เลื่อนวัน) */
export const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

/**
 * ปุ่มช่วงเวลา
 *
 * มี "เดือนที่แล้ว" กับ "ปีนี้" ด้วย เพราะสามปุ่มแรกตอบได้แค่ "ตอนนี้เป็นยังไง"
 * ส่วนคำถามที่เจ้าของร้านถามจริงคือ "เทียบกับเดือนที่แล้วล่ะ" ซึ่งถ้าไม่มีปุ่มให้
 * ต้องไปไล่กรอกวันที่เอง ทุกครั้งที่อยากรู้
 */
export const PERIODS = [
  ['today', 'วันนี้'],
  ['week', 'สัปดาห์นี้'],
  ['month', 'เดือนนี้'],
  ['last_month', 'เดือนที่แล้ว'],
  ['year', 'ปีนี้'],
  ['custom', 'กำหนดเอง'],
];

export const CHANNELS = [
  ['all', 'ทั้งหมด'],
  ['main', 'Main Process'],
  ['pos', 'POS'],
];

/**
 * ทุกช่วงจบที่ "วันนี้" ไม่ใช่วันสิ้นสัปดาห์หรือวันสิ้นเดือน
 *
 * วันที่ยังไม่มาถึงไม่มียอดขายอยู่แล้ว การลากช่วงไปถึงสิ้นเดือนแปลว่ากราฟรายวัน
 * มีหางศูนย์ยาว ๆ ที่บีบแท่งจริงให้เตี้ยลง และค่าเฉลี่ยต่อวันก็เพี้ยนตาม
 *
 * สัปดาห์เริ่มวันจันทร์ ตามที่ร้านนับรอบงาน (getDay() นับวันอาทิตย์เป็น 0)
 */
export function rangeFor(period, now = new Date()) {
  const to = iso(now);

  if (period === 'week') {
    const back = (now.getDay() + 6) % 7;
    const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    return { from: iso(mon), to };
  }
  if (period === 'month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: iso(first), to };
  }
  /* เดือนที่แล้วจบที่ "วันสุดท้ายของเดือนนั้น" ไม่ใช่วันนี้ — เป็นช่วงเดียวที่
     ปิดไปแล้วทั้งเดือน · วันที่ 0 ของเดือนถัดไป = วันสุดท้ายของเดือนก่อน
     ซึ่ง Date จัดการเดือนกุมภาพันธ์และปีอธิกสุรทินให้เอง */
  if (period === 'last_month') {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: iso(first), to: iso(last) };
  }
  if (period === 'year') {
    return { from: iso(new Date(now.getFullYear(), 0, 1)), to };
  }
  return { from: to, to };
}

/**
 * ช่วงที่กำลังดูอยู่ตรงกับปุ่มไหน — ใช้ไฮไลต์ปุ่มที่เลือก
 *
 * ไม่ตรงกับปุ่มไหนเลย = 'custom' ซึ่งเป็นคำตอบที่ถูก ไม่ใช่กรณีผิดพลาด
 */
export function periodOf(from, to, now = new Date()) {
  for (const [key] of PERIODS) {
    if (key === 'custom') continue;
    const r = rangeFor(key, now);
    if (r.from === from && r.to === to) return key;
  }
  return 'custom';
}

/** ตัวกรองที่อ่านออกมาจาก URL — ไม่มีอะไรใน URL = เดือนนี้ ทุกช่องทาง */
export function readFilter(searchParams, now = new Date()) {
  const get = (k) => searchParams?.get?.(k) || '';
  const fallback = rangeFor('month', now);
  const from = get('from') || fallback.from;
  let to = get('to') || fallback.to;
  /* ส่งกลับหัวกลับหางมา (คนแก้ URL เอง หรือกดวันสิ้นสุดก่อนวันเริ่ม) — ยืดให้
     ครอบคลุมแทนที่จะคืนช่วงว่างที่อ่านว่า "ไม่มียอดขาย" */
  if (to < from) to = from;
  const channel = get('channel');
  return {
    from,
    to,
    channel: CHANNELS.some(([c]) => c === channel) ? channel : 'all',
  };
}

/** ตัวกรอง -> query string สำหรับทั้ง URL ของหน้าเว็บและคำขอที่ยิงไป API */
export function filterQuery({ from, to, channel }) {
  const p = new URLSearchParams({ from, to });
  if (channel && channel !== 'all') p.set('channel', channel);
  return p.toString();
}

const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/**
 * ป้ายสั้นใต้แกนกราฟ — สั้นที่สุดที่ยังบอกได้ว่าเป็นช่วงไหน
 *
 * API เลือกความละเอียดมาให้แล้ว (วัน/สัปดาห์/เดือน) หน้าเว็บแค่เขียนป้ายให้ตรง
 * ไม่ได้เดาเองจากจำนวนจุด — ถ้าสองที่ตัดสินใจแยกกัน วันหนึ่งจะได้กราฟรายเดือน
 * ที่ป้ายเขียนเป็นรายวัน
 */
export function bucketLabel(bucket, from, to) {
  const [y, m, d] = String(from).split('-').map(Number);
  if (bucket === 'month') return TH_MON[m - 1];
  if (bucket === 'week') {
    const e = String(to).split('-').map(Number);
    /* สัปดาห์ที่อยู่ในเดือนเดียวกันเขียนแค่เลขวัน — "31/8" กับ "6/9" ที่ต่อกัน
       ยาวเกินกว่าจะวางเรียงกันยี่สิบกว่าอันโดยไม่ทับ */
    return m === e[1] ? `${d}–${e[2]}/${m}` : `${d}/${m}`;
  }
  return `${d}/${m}`;
}

/** ป้ายเต็มในกล่องลอย — อ่านครั้งเดียวตอนชี้ ยาวได้ */
export function bucketFull(bucket, from, to) {
  const [y, m, d] = String(from).split('-').map(Number);
  const be = String(to).split('-').map(Number);
  const yr = y + 543;
  if (bucket === 'month') return `${TH_MON[m - 1]} ${yr}`;
  if (bucket === 'week') {
    return m === be[1]
      ? `${d} – ${be[2]} ${TH_MON[m - 1]} ${yr}`
      : `${d} ${TH_MON[m - 1]} – ${be[2]} ${TH_MON[be[1] - 1]} ${yr}`;
  }
  return `${d} ${TH_MON[m - 1]} ${yr}`;
}

/** คำอธิบายความละเอียดของแกน — วางไว้มุมการ์ดให้รู้ว่าหนึ่งแท่งคือเท่าไหร่ */
export const BUCKET_NAME = { day: 'รายวัน', week: 'รายสัปดาห์', month: 'รายเดือน' };

/** ข้อความบอกช่วงที่กำลังดู เช่น "1 – 30 ก.ย. 2569" */
export function rangeLabel(from, to) {
  if (!from || !to) return '';
  const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const part = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return { y: y + 543, m: TH[m - 1], d };
  };
  const a = part(from);
  const b = part(to);
  if (from === to) return `${a.d} ${a.m} ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${a.d} – ${b.d} ${b.m} ${b.y}`;
  if (a.y === b.y) return `${a.d} ${a.m} – ${b.d} ${b.m} ${b.y}`;
  return `${a.d} ${a.m} ${a.y} – ${b.d} ${b.m} ${b.y}`;
}
