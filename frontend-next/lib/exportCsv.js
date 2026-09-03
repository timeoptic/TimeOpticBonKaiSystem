/**
 * ส่งออกตารางเป็นไฟล์ .csv ที่ Excel เปิดแล้วภาษาไทยไม่เพี้ยน
 *
 * **BOM คือทั้งหมดของเรื่องนี้** — Excel บน Windows เดาการเข้ารหัสจากไบต์แรกของ
 * ไฟล์ ไม่มี BOM มันจะอ่านเป็น cp874/cp1252 แล้วภาษาไทยกลายเป็นขยะทั้งไฟล์
 * ผู้ใช้จะรายงานว่า "ระบบส่งออกไฟล์เสีย" ทั้งที่ข้อมูลถูกทุกไบต์
 *
 * ใช้ CRLF ด้วยเหตุผลเดียวกัน — Excel รุ่นเก่าบน Windows ไม่แยกบรรทัดที่ LF เดี่ยว
 */

/**
 * ครอบค่าหนึ่งช่องตามกฎ RFC 4180
 *
 * ครอบเมื่อมีจุลภาค อัญประกาศ ขึ้นบรรทัด หรือช่องว่างหัวท้าย (ช่องว่างหัวท้าย
 * ที่ไม่ได้ครอบจะถูกโปรแกรมอ่าน CSV บางตัวตัดทิ้ง) · อัญประกาศข้างในกลายเป็นคู่
 */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s === '') return '';
  const needsQuote = /[",\r\n]/.test(s) || s !== s.trim();
  return needsQuote ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * columns: [{ label, value(row) }] — ตัวเดียวกับที่ตารางบนหน้าจอใช้ได้
 *
 * ตั้งใจให้ `value` คืน "ตัวเลขดิบ" ไม่ใช่ข้อความที่จัดรูปแล้ว — '฿1,234.00'
 * ใน Excel เป็นข้อความ บวกลบไม่ได้ ซึ่งทำให้ไฟล์ที่ส่งออกไปไร้ประโยชน์
 */
export function toCsv(columns, rows) {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  const body = (rows || []).map(
    (row, i) => columns.map((c) => csvCell(c.value(row, i))).join(','),
  );
  return [head, ...body].join('\r\n');
}

/** ชื่อไฟล์ที่ Windows ยอมรับ — อักขระต้องห้ามกลายเป็นขีด ไม่ใช่ถูกลบจนชื่อติดกัน */
export function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
}

/** สร้างไฟล์แล้วสั่งดาวน์โหลด — เรียกได้เฉพาะฝั่งเบราว์เซอร์ */
export function downloadCsv(filename, columns, rows) {
  const csv = toCsv(columns, rows);
  /* '﻿' นำหน้า = BOM ของ UTF-8 หลังผ่าน TextEncoder ของ Blob */
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName(filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* คืนหน่วยความจำของ blob — ไม่ปล่อยแล้วไฟล์ค้างอยู่จนกว่าจะปิดแท็บ */
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
