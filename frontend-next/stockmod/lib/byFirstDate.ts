/**
 * เรียงแถวเป็นก้อนตาม `key` โดยก้อนที่เกิดก่อนขึ้นก่อน แล้วเรียงตามเวลาในก้อน
 *
 * ร้านแจ้ง 22 ต.ค. 2026: ชีตที่จัดกลุ่มตามออเดอร์/สาขาเคยเรียงก้อนตามชื่อ — เลขออเดอร์
 * เทียบเป็นข้อความ ("10451" ก่อน "2026-00032", "2722" ก่อน "59181") คอลัมน์วันที่จึงกระโดด
 * ไปมาทั้งชีต · เรียงก้อนตามวันแรกของก้อนแทน วันที่ไล่ลงมาตามลำดับ แถวของออเดอร์เดียวกัน
 * ยังอยู่ติดกันและมียอดรวมย่อยเหมือนเดิม
 *
 * `at` ต้องเป็นข้อความที่เรียงได้ตามเวลา ('YYYY-MM-DD HH:MM:SS')
 */
export function byFirstDate<T>(rows: T[], key: (r: T) => string, at: (r: T) => string): T[] {
  const first = new Map<string, string>();
  for (const r of rows) {
    const k = key(r);
    const t = at(r);
    const seen = first.get(k);
    if (seen === undefined || t < seen) first.set(k, t);
  }
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return (
      first.get(ka)!.localeCompare(first.get(kb)!) ||
      ka.localeCompare(kb, "th") ||
      at(a).localeCompare(at(b))
    );
  });
}
