import AppShell from "@/stockmod/components/AppShell";

/**
 * ทุกหน้าทำงานของฝั่งคลังอยู่ในโครง Workbench เดียวกัน
 *
 * แยกจาก layout ของ `/stock` หนึ่งชั้น เพราะหน้าเข้าสู่ระบบต้องใช้สไตล์ชุด
 * เดียวกันแต่ต้องไม่อยู่ใน AppShell — AppShell ถามว่าใครล็อกอินอยู่ แล้วเด้งไป
 * หน้าล็อกอินถ้าไม่มีใคร ถ้าหน้าล็อกอินอยู่ข้างในด้วยก็จะเด้งหาตัวเองไม่จบ
 */
export default function StockShellLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
