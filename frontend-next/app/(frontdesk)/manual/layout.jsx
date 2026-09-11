/**
 * โหลด CSS ของหน้าคู่มือ — อยู่ที่ layout ของหน้านี้ ไม่ใช่ globals.css
 * เหตุผลเดียวกับ pos/layout.jsx: สไตล์ของหน้าต้องมีผลเฉพาะหน้านั้น
 */
import './manual.css';

export default function ManualLayout({ children }) {
  return children;
}
