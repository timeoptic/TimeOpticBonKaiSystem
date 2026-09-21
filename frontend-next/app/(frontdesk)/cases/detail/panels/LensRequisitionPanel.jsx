'use client';
/**
 * แท็บ "ใบเบิกเลนส์" ของเคส (Bewell) — ใบเกิดเองตอนบันทึกขั้นขายที่เลือกเลนส์จำลอง
 * ใบเก่าที่ถูกยกเลิกยังแสดงอยู่ด้านล่าง ไว้ดูย้อนหลังว่าเคยสั่งอะไร
 */
import { api } from '../../../../../lib/apiClient.js';
import { useAsync } from '../../../../../lib/hooks.js';
import { Card, Loading } from '../../../../../components/ui.jsx';
import { LensRequisitionCard } from '../../../../../components/LensRequisitionCard.jsx';

export function LensRequisitionPanel({ c, reload }) {
  const { data, loading, error, reload: again } = useAsync(
    () => api.get(`/api/cases/${c.id}/lens-requisitions`),
    [c.id]
  );

  if (loading && !data) return <Loading />;
  if (error) return <Card><p className="muted">{error.message}</p></Card>;
  if (!data?.length) {
    return (
      <Card title="ใบเบิกเลนส์">
        <p className="muted" style={{ margin: 0 }}>
          ยังไม่มีใบเบิกเลนส์ — เลือกเลนส์ในขั้นขายแล้วกดบันทึก ระบบจะออกใบให้เอง
        </p>
      </Card>
    );
  }
  return (
    <div className="stack">
      {data.map((r) => (
        <LensRequisitionCard
          key={r.id}
          r={r}
          onChanged={() => {
            again();
            reload?.();
          }}
        />
      ))}
    </div>
  );
}
