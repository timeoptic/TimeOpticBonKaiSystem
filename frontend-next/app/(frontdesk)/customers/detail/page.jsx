'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../../lib/apiClient.js';
import { useAsync } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import { useConfirm } from '../../../../components/Confirm.jsx';
import {
  Card, FormActions, Kv, Loading, OrderStatusBadge, PageHead, Split,
} from '../../../../components/ui.jsx';
import { PagedTable } from '../../../../components/Pager.jsx';
import { StatusChip } from '../../../../components/StatusChip.jsx';
import { ExamHistory } from '../../../../components/ExamHistory.jsx';
import { QueryParamPage } from '../../../../components/QueryParamPage.jsx';
import { custName, fmtDate, fmtDateTime, money } from '../../../../lib/format.js';
import { Icon } from '../../../../components/Icon.jsx';

function CustomerDetailInner() {
  const params = useSearchParams();
  const id = params.get('id');
  const router = useRouter();
  const { ok, err } = useToast();
  const confirm = useConfirm();

  const { data, loading, error } = useAsync(() => {
    if (!id) return Promise.resolve(null);
    return api.get('/api/customers/' + id);
  }, [id]);

  if (loading) return <Loading />;
  if (error) return <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>;
  if (!data || !data.id) {
    return <Card><h2>ไม่พบข้อมูลลูกค้า</h2><p className="muted">ไม่พบลูกค้ารายนี้ในระบบ</p></Card>;
  }

  const c = data;

  const remove = async () => {
    if (!await confirm('ลบลูกค้า', `ลบ "${custName(c)}" ออกจากระบบ?`, { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del('/api/customers/' + id);
      ok('ลบแล้ว');
      router.push('/customers');
    } catch (ex) {
      err(ex);
    }
  };

  return (
    <div>
      <PageHead
        icon="user"
        title={custName(c)}
        subtitle={`รหัสลูกค้า #${c.id}`}
        actions={(
          <>
            {/* ไม่มีปุ่ม "วัดสายตา" แยกแล้ว — การวัดสายตาเกิดในเคส (ขั้นที่ 2)
                ไม่ใช่ใบลอย ๆ ที่ไม่ผูกกับงานไหน */}
            <Link className="btn btn-ghost" href={`/cases/new?customer=${c.id}`}><Icon name="board" /> เปิดเคส</Link>
            <Link className="btn btn-ghost" href={`/orders/new?customer=${c.id}`}><Icon name="glasses" /> เปิดออเดอร์</Link>
            <Link className="btn btn-ghost" href={`/customers/edit?id=${c.id}`}><Icon name="pencil" /> แก้ไข</Link>
          </>
        )}
      />

      <Split>
        <Card title="ข้อมูลลูกค้า">
          <Kv rows={[
            ['ชื่อ-นามสกุล', custName(c)],
            ['เพศ', c.sex || '-'],
            ['สัญชาติ', c.nationality || '-'],
            ['วันเกิด', fmtDate(c.birth_date) || '-'],
            ['เบอร์โทร', c.phone || '-'],
            ['LINE / WhatsApp', c.line_id || '-'],
            ['อีเมล', c.email || '-'],
            ['หมายเหตุ', c.notes || '-'],
            ['ลูกค้าตั้งแต่', fmtDate(c.created_at)],
          ]}
          />
          <FormActions style={{ marginTop: 14 }}>
            <button type="button" className="btn btn-sm btn-danger" onClick={remove}><Icon name="trash" /> ลบลูกค้า</button>
          </FormActions>
        </Card>

        <Card title="เคสของลูกค้า" tight>
          <PagedTable
            columns={[
              { label: 'เคส', key: 'case_code', cls: 'mono', mobile: 'title' },
              { label: 'สถานะ', render: (k) => <StatusChip row={k} />, mobile: 'status' },
              { label: 'เปิดเมื่อ', render: (k) => fmtDate(k.opened_at), cls: 'nowrap', mobile: 'body' },
              { label: 'ยอด', render: (k) => (k.net_price === null ? '-' : money(k.net_price)), cls: 'num', mobile: 'body' },
              { label: 'ค้าง', render: (k) => (k.balance === null ? '-' : money(k.balance)), cls: 'num', mobile: 'body' },
            ]}
            rows={c.cases}
            onRowClick={(k) => router.push('/cases/detail?id=' + k.id)}
            empty="ยังไม่มีเคส"
          />
        </Card>
      </Split>

      <Card
        title="ประวัติสายตา"
        right={<span className="muted">{`${(c.exam_sessions || []).length} รอบการตรวจ`}</span>}
      >
        <ExamHistory sessions={c.exam_sessions} />
      </Card>

      <Card title="ประวัติการสั่งตัดแว่น" tight>
        <PagedTable
          columns={[
            { label: 'วันที่', render: (o) => fmtDateTime(o.order_date), cls: 'nowrap', mobile: 'body' },
            { label: 'Invoice', key: 'invoice_code', cls: 'mono', mobile: 'title' },
            { label: 'เลนส์', key: 'lens_name', mobile: 'meta' },
            { label: 'กรอบ', key: 'frame_name', mobile: 'meta' },
            { label: 'ยอดรวม', render: (o) => money(o.total_price), cls: 'num', mobile: 'body' },
            { label: 'รับแล้ว', render: (o) => money(o.paid), cls: 'num', mobile: 'meta' },
            { label: 'คงเหลือ', render: (o) => money(o.balance), cls: 'num', mobile: 'body' },
            { label: 'สถานะ', render: (o) => <OrderStatusBadge order={o} />, mobile: 'status' },
          ]}
          rows={c.orders}
          onRowClick={(o) => router.push('/orders/detail?id=' + o.id)}
          empty="ยังไม่มีออเดอร์"
        />
      </Card>
    </div>
  );
}

export default function CustomerDetailPage() {
  return (
    <QueryParamPage>
      <CustomerDetailInner />
    </QueryParamPage>
  );
}
