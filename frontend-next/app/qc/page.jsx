'use client';
import { ProcessCaseList } from '../../components/ProcessCaseList.jsx';

export default function QcListPage() {
  return <ProcessCaseList stageGroup="qc" icon="🔍" title="QC" subtitle="เคสที่รอตรวจ QC" />;
}
