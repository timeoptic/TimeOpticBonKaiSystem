'use client';
/**
 * โครงร่วมของรายงานทั้งหกหน้า — หัวเพจ กับแถบแท็บ
 *
 * ตัวกรอง (`<ReportFilter>`) ไม่ได้อยู่ที่นี่ทั้งที่ทุกหน้าใช้เหมือนกัน เพราะปุ่ม
 * ส่งออก Excel ที่อยู่ในแถบเดียวกันต้องรู้ว่ากำลังส่งออกตารางไหนของหน้าไหน —
 * ให้ layout ถือแล้วส่ง callback ขึ้นมาจากหน้าลูก แปลว่าต้องมี context ทั้งชุด
 * เพื่อประหยัดหกบรรทัด · แต่ละหน้าจึงวางตัวกรองเอง
 *
 * แท็บพาตัวกรองไปด้วย: กดจากหน้าภาพรวมที่กำลังดู "เดือนนี้ · เฉพาะ POS" ไปหน้า
 * รายงาน POS แล้วต้องได้ช่วงเดิม ไม่ใช่เด้งกลับไปค่าตั้งต้น
 */
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { AdminOnly } from '../../../components/AdminOnly.jsx';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { PageHead } from '../../../components/ui.jsx';
import { filterQuery, readFilter } from '../../../lib/reportRange.js';

const TABS = [
  ['/reports', 'ภาพรวม'],
  ['/reports/main-process', 'งานตัดแว่น'],
  ['/reports/pos', 'ขายหน้าร้าน'],
  ['/reports/channels', 'ช่องทางลูกค้า'],
  ['/reports/payments', 'การรับเงิน'],
  ['/reports/profit', 'กำไร'],
  ['/reports/employees', 'พนักงาน'],
];

function ReportTabs() {
  const pathname = usePathname();
  const params = useSearchParams();
  const q = filterQuery(readFilter(params));
  /* trailingSlash ทำให้ path เป็น "/reports/pos/" — ตัดก่อนเทียบ */
  const here = pathname.replace(/\/+$/, '') || '/reports';

  return (
    <div className="tabs no-print">
      {TABS.map(([to, label]) => (
        <Link key={to} href={`${to}?${q}`} className={here === to ? 'active' : ''}>
          {label}
        </Link>
      ))}
    </div>
  );
}

export default function ReportsLayout({ children }) {
  return (
    <AdminOnly>
      <PageHead icon="chart" title="รายงาน" subtitle="ยอดขายและผลประกอบการ" />
      {/* `reports-wide` เป็นตะขอให้ CSS รู้ว่าอยู่ในหน้ารายงาน — การ์ด KPI
          ยืดเต็มความกว้างและกราฟสูงขึ้นบนจอคอม โดยไม่กระทบหน้าอื่นที่ใช้
          คลาสเดียวกันแต่ตั้งใจให้การ์ดขนาดคงที่ */}
      <div className="reports-wide">
        <QueryParamPage>
          <ReportTabs />
          {children}
        </QueryParamPage>
      </div>
    </AdminOnly>
  );
}
