'use client';
/**
 * One list per 9-process workflow stage. Each `app/<stage>/page.jsx` is a
 * thin wrapper passing its own icon/title/subtitle + `stageGroup` filter.
 * Mirrors app/cases/page.jsx's DataTable + useAsync pattern.
 */
import { useRouter } from 'next/navigation';
import { api } from '../lib/apiClient.js';
import { useAsync } from '../lib/hooks.js';
import { PageHead, Loading, Card } from './ui.jsx';
import { DataTable } from './DataTable.jsx';
import { StatusChip } from './StatusChip.jsx';
import { custName, fmtDateTime } from '../lib/format.js';

export function ProcessCaseList({ stageGroup, icon, title, subtitle }) {
  const router = useRouter();
  const { data, loading, error } = useAsync(
    () => api.get('/api/cases', { stage_group: stageGroup, open: 1, limit: 300 }),
    [stageGroup]
  );

  return (
    <div>
      <PageHead icon={icon} title={title} subtitle={subtitle} />
      {loading && <Loading />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (
        <DataTable
          columns={[
            { label: 'เคส', key: 'case_code', cls: 'mono' },
            { label: 'ลูกค้า', render: custName },
            { label: 'สถานะ', render: (c) => <StatusChip row={c} /> },
            { label: 'เปิดเมื่อ', render: (c) => fmtDateTime(c.opened_at), cls: 'nowrap' },
          ]}
          rows={data || []}
          onRowClick={(c) => router.push('/cases/detail?id=' + c.id)}
          empty="ไม่มีเคสในขั้นนี้"
        />
      )}
    </div>
  );
}
