import "./tokens.css";
import "./globals.css";

/**
 * คลังและต้นทุน — สไตล์ของฝั่งนี้ทั้งหมด
 *
 * import ที่นี่ ไม่ใช่ที่ layout ราก เพราะหน้าร้าน (`/`) มีสไตล์ของตัวเองที่
 * ตั้งชื่อคลาสชนกันอยู่เก้าคลาส (`.btn` `.card` `.field` …) และตั้งกฎให้ `body`
 * `input` `select` คนละแบบ · Next โหลด CSS ตามหน้าที่เปิดอยู่จริง ๆ วางไว้ที่นี่
 * จึงเท่ากับสไตล์ชุดนี้ไปเฉพาะฝั่งคลัง ไม่ข้ามไปหน้าร้าน
 *
 * ด้วยเหตุผลเดียวกัน ปุ่มข้ามฝั่งใน SideRail ต้องเป็นการโหลดหน้าใหม่
 * (`<a>` ไม่ใช่ `<Link>`) เดินข้ามแบบ client-side จะได้สไตล์สองชุดทับกัน
 */
export default function StockLayout({ children }: { children: React.ReactNode }) {
  return children;
}
