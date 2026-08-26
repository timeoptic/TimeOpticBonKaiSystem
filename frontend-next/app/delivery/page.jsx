'use client';
import { ProcessCaseList } from '../../components/ProcessCaseList.jsx';

export default function DeliveryListPage() {
  return <ProcessCaseList stageGroup="delivery" icon="📦" title="ส่งมอบ" subtitle="เคสที่รอส่งมอบ" />;
}
