'use client';
import { Ledger } from '../../../components/Ledger.jsx';

export default function ExpensePage() {
  return (
    <Ledger
      title="Expense" subtitle="รายจ่าย" icon="💸"
      endpoint="/api/expense" typeKey="expense_type" typeList="expense_type" withPayType
    />
  );
}
