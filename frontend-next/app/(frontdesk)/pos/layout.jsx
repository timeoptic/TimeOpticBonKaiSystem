/**
 * โหลด CSS ของ POS ให้ทั้งสามหน้า (/pos, /pos/history, /pos/detail)
 *
 * อยู่ที่ layout ของกลุ่มนี้ ไม่ใช่ที่ layout ราก — เหตุผลเดียวกับที่ฝั่งคลังแยก CSS
 * ของตัวเอง (ดู MERGE-NOTES): สไตล์ของโมดูลต้องมีผลเฉพาะหน้าของโมดูลนั้น
 * ธีมส้มจึงไม่มีทางหลุดไปโผล่ในหน้าอื่นของหน้าร้าน
 */
import './pos.css';

export default function PosLayout({ children }) {
  return children;
}
