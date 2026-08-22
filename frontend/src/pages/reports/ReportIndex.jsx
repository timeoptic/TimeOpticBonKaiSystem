import { Link } from 'react-router-dom';
import { PageHead } from '../../components/ui.jsx';

const REPORTS = [
  ['📅', 'สรุปรายวัน', 'Daily Order Closed — ยอดปิดออเดอร์ / มัดจำ / ขายสินค้า แยกตามวิธีชำระ', '/reports/daily'],
  ['📈', 'รายรับรายเดือน', 'Sale Income By Month — สรุปรายรับ-รายจ่ายรายเดือน', '/reports/monthly'],
  ['📋', 'เช็คลิสต์สต็อก', 'Lens / ContactLen / Frame Checklist — นับสินค้าคงเหลือตามชื่อ', '/reports/checklist'],
  ['🏷', 'พิมพ์ป้ายราคา', 'Stock Label — ป้ายติดสินค้าพร้อมรหัสและราคา', '/reports/labels'],
  ['🕰', 'สินค้าค้างสต็อก', 'Unsold Stock — สินค้าที่รับเข้ามานานแล้วยังไม่ขาย', '/reports/unsold'],
];

export default function ReportIndex() {
  return (
    <>
      <PageHead icon="📊" title="Reports" subtitle="รายงาน" />
      <div className="tiles">
        {REPORTS.map(([ic, th, en, to]) => (
          <Link key={to} className="tile" to={to}>
            <span className="t-ic">{ic}</span>
            <span><b>{th}</b><small>{en}</small></span>
          </Link>
        ))}
      </div>
    </>
  );
}
