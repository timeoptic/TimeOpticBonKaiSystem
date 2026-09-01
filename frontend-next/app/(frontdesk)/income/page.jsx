'use client';
import { Ledger } from '../../../components/Ledger.jsx';
import { AdminOnly } from '../../../components/AdminOnly.jsx';

function IncomePageInner() {
  return (
    <Ledger
      title="Menu Income" subtitle="รายรับ" icon="💰"
      endpoint="/api/income" typeKey="income_type" typeList="income_type" withPayType={false}
    />
  );
}

/* งานของแอดมิน — พนักงานขายที่พิมพ์ URL เข้ามาตรง ๆ จะเห็นคำอธิบาย
   ไม่ใช่หน้าเปล่าหรือถูกเด้งกลับเงียบ ๆ */
export default function IncomePage() {
  return <AdminOnly><IncomePageInner /></AdminOnly>;
}
