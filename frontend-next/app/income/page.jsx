'use client';
import { Ledger } from '../../components/Ledger.jsx';

export default function IncomePage() {
  return (
    <Ledger
      title="Menu Income" subtitle="รายรับ" icon="💰"
      endpoint="/api/income" typeKey="income_type" typeList="income_type" withPayType={false}
    />
  );
}
