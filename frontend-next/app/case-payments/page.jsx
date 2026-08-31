'use client';
import { ProcessCaseList } from '../../components/ProcessCaseList.jsx';

export default function PaymentListPage() {
  return <ProcessCaseList stageGroup="payment" icon="💳" title="ชำระเงิน" subtitle="เคสที่รอชำระเงิน" />;
}
