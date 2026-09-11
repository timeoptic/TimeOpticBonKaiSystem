'use client';
import { Ledger } from '../../../components/Ledger.jsx';
import { AdminOnly } from '../../../components/AdminOnly.jsx';

function ExpensePageInner() {
  return (
    <Ledger
      title="Expense" subtitle="รายจ่าย" icon="banknote"
      endpoint="/api/expense" typeKey="expense_type" typeList="expense_type" withPayType
    />
  );
}

/* งานของแอดมิน — พนักงานขายที่พิมพ์ URL เข้ามาตรง ๆ จะเห็นคำอธิบาย
   ไม่ใช่หน้าเปล่าหรือถูกเด้งกลับเงียบ ๆ */
export default function ExpensePage() {
  return <AdminOnly zone="money"><ExpensePageInner /></AdminOnly>;
}
