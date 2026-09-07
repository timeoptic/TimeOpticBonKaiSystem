'use client';
import { ProcessCaseList } from '../../../components/ProcessCaseList.jsx';

export default function PaymentListPage() {
  return <ProcessCaseList stageGroup="payment" icon="card" title="ชำระเงิน" subtitle="เคสที่รอชำระเงิน" />;
}
