'use client';
/**
 * หน้าร้าน — เมนู หน้าตา และสไตล์ของฝั่งนี้ทั้งหมด
 *
 * `globals.css` ถูก import ที่นี่ ไม่ใช่ที่ layout ราก เพราะฝั่งคลัง (`/stock`)
 * มีสไตล์ของตัวเองที่ตั้งชื่อคลาสชนกันอยู่เก้าคลาส (`.btn` `.card` `.field` …)
 * และตั้งกฎให้ `body` `input` `select` คนละแบบ · Next โหลด CSS ตามหน้าที่เปิด
 * อยู่จริง ๆ วางไว้ที่นี่จึงเท่ากับสไตล์ชุดนี้ไปเฉพาะหน้าร้าน ไม่ข้ามฝั่ง
 *
 * ปุ่มข้ามฝั่งใน Shell.jsx จึงต้องเป็นการโหลดหน้าใหม่ (`<a>` ไม่ใช่ `<Link>`)
 * ถ้าเดินข้ามแบบ client-side สไตล์สองชุดจะทับกันอยู่ในหน้าเดียว
 */
import '../globals.css';
import { Providers } from '../providers.jsx';

export default function FrontdeskLayout({ children }) {
  return <Providers>{children}</Providers>;
}
