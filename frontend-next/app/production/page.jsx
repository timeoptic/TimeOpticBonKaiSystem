'use client';
import { ProcessCaseList } from '../../components/ProcessCaseList.jsx';

export default function ProductionListPage() {
  return <ProcessCaseList stageGroup="production" icon="🔧" title="ผลิต" subtitle="เคสที่อยู่ระหว่างผลิต" />;
}
