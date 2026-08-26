/**
 * path -> breadcrumb table + lookup, matched longest-first. Detail/edit pages
 * under a domain (e.g. /customers/detail?id=5) still match their domain's
 * '/customers' entry, since the id lives in the query string, not the path.
 *
 * Kept in its own plain .js module (rather than inline in components/Shell.jsx,
 * which it's re-exported from) so it can be unit-tested with `node --test`
 * without a JSX loader — Shell.jsx is a 'use client' component file and can't
 * be imported directly by the plain Node test runner.
 */
export const TITLES = [
  ['/', 'เมนูหลัก'],
  ['/customers/new', 'ลูกค้าใหม่'],
  ['/customers/detail', 'รายละเอียดลูกค้า'],
  ['/customers/edit', 'แก้ไขลูกค้า'],
  ['/customers', 'ลูกค้า'],
  ['/prescriptions/new', 'บันทึกการวัดสายตา'],
  ['/prescriptions/edit', 'แก้ไขผลวัดสายตา'],
  ['/prescriptions', 'วัดสายตา'],
  ['/bookings/edit', 'แก้ไขการจองคิว'],
  ['/bookings/new', 'จองคิวใหม่'],
  ['/bookings/detail', 'รายละเอียดคิว'],
  ['/bookings', 'ปฏิทินจองคิว'],
  ['/settings', 'ตั้งค่า/แจ้งเตือน'],
  ['/cases/new', 'เปิดเคสใหม่'],
  ['/cases/detail', 'รายละเอียดเคส'],
  ['/cases', 'กระดานงาน'],
  ['/lens-tracker', 'ติดตามเลนส์'],
  ['/exam', 'วัดสายตา'],
  ['/case-sales', 'ขาย-เลือกกรอบ'],
  ['/centering', 'วัด Center'],
  ['/case-payments', 'ชำระเงิน'],
  ['/production', 'ผลิต'],
  ['/qc', 'QC'],
  ['/delivery', 'ส่งมอบ'],
  ['/employees', 'พนักงาน'],
  ['/orders/new', 'เปิดออเดอร์ใหม่'],
  ['/orders/detail', 'รายละเอียดออเดอร์'],
  ['/orders', 'ออเดอร์ตัดแว่น'],
  ['/sales/new', 'ขายสินค้าทั่วไป'],
  ['/sales', 'ขายสินค้า'],
  ['/stock/new', 'เพิ่มสินค้าเข้าคลัง'],
  ['/stock', 'สต็อกสินค้า'],
  ['/locations', 'ตำแหน่งสินค้า'],
  ['/suppliers', 'ซัพพลายเออร์'],
  ['/income', 'รายรับ'],
  ['/expense', 'รายจ่าย'],
  ['/reports/daily', 'สรุปรายวัน'],
  ['/reports/monthly', 'รายรับรายเดือน'],
  ['/reports/checklist', 'เช็คลิสต์สต็อก'],
  ['/reports/labels', 'พิมพ์ป้ายราคา'],
  ['/reports/unsold', 'สินค้าค้างสต็อก'],
  ['/reports', 'รายงาน'],
  ['/print/order', 'ใบสั่งตัดแว่น'],
  ['/print/prescription', 'ใบวัดสายตา'],
];

export function crumbFor(pathname) {
  if (pathname === '/') return 'เมนูหลัก';
  const hit = TITLES
    .filter(([p]) => p !== '/' && (pathname === p || pathname.startsWith(p + '/')))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? hit[1] : 'TimeOptic';
}
