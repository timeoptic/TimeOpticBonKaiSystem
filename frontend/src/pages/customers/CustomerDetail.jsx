import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAsync } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/Confirm.jsx';
import {
  Badge, Card, FormActions, Kv, Loading, OrderStatusBadge, PageHead, Split,
} from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { StatusChip } from '../../components/StatusChip.jsx';
import { custName, fmtDate, fmtDateTime, money, power, rxNum } from '../../lib/format.js';

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { ok, err } = useToast();
  const confirm = useConfirm();

  const { data: c, loading, error } = useAsync(() => api.get('/api/customers/' + id), [id]);

  if (loading) return <Loading />;
  if (error) return <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>;

  const remove = async () => {
    if (!await confirm('ลบลูกค้า', `ลบ "${custName(c)}" ออกจากระบบ?`, { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del('/api/customers/' + c.id);
      ok('ลบแล้ว');
      navigate('/customers');
    } catch (ex) {
      err(ex);
    }
  };

  return (
    <div>
      <PageHead
        icon="👤"
        title={custName(c)}
        subtitle={`รหัสลูกค้า #${c.id}`}
        actions={(
          <>
            <Link className="btn btn-ghost" to={`/cases/new?customer=${c.id}`}>🗂 เปิดเคส</Link>
            <Link className="btn btn-ghost" to={`/prescriptions/new?customer=${c.id}`}>👁 วัดสายตา</Link>
            <Link className="btn btn-ghost" to={`/orders/new?customer=${c.id}`}>👓 เปิดออเดอร์</Link>
            <Link className="btn btn-ghost" to={`/customers/${c.id}/edit`}>✎ แก้ไข</Link>
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
            ['LINE', c.line_id || '-'],
            ['อีเมล', c.email || '-'],
            ['หมายเหตุ', c.notes || '-'],
            ['ลูกค้าตั้งแต่', fmtDate(c.created_at)],
          ]}
          />
          <FormActions style={{ marginTop: 14 }}>
            <button type="button" className="btn btn-sm btn-danger" onClick={remove}>🗑 ลบลูกค้า</button>
          </FormActions>
        </Card>

        <Card title="เคสของลูกค้า" tight>
          <DataTable
            columns={[
              { label: 'เคส', key: 'case_code', cls: 'mono' },
              { label: 'สถานะ', render: (k) => <StatusChip row={k} /> },
              { label: 'เปิดเมื่อ', render: (k) => fmtDate(k.opened_at), cls: 'nowrap' },
              { label: 'ยอด', render: (k) => (k.net_price === null ? '-' : money(k.net_price)), cls: 'num' },
              { label: 'ค้าง', render: (k) => (k.balance === null ? '-' : money(k.balance)), cls: 'num' },
            ]}
            rows={c.cases}
            onRowClick={(k) => navigate('/cases/' + k.id)}
            empty="ยังไม่มีเคส"
          />
        </Card>
      </Split>

      <Card title="ประวัติค่าสายตา" tight>
        <DataTable
          columns={[
            { label: 'วันที่', render: (t) => fmtDateTime(t.test_date), cls: 'nowrap' },
            { label: 'ชนิด', render: (t) => <Badge kind={t.kind === 'final' ? 'ok' : 'gray'}>{t.kind}</Badge> },
            {
              label: 'R (Sph/Cyl/Axis/Add)',
              cls: 'nowrap',
              render: (t) => `${power(t.r_sphere)} / ${power(t.r_cylinder)} / ${rxNum(t.r_axis)} / ${power(t.r_add)}`,
            },
            {
              label: 'L (Sph/Cyl/Axis/Add)',
              cls: 'nowrap',
              render: (t) => `${power(t.l_sphere)} / ${power(t.l_cylinder)} / ${rxNum(t.l_axis)} / ${power(t.l_add)}`,
            },
            { label: 'ใช้สำหรับ', key: 'test_for' },
            { label: 'ผู้วัด', key: 'employee_name' },
            {
              label: '',
              cls: 'nowrap',
              render: (t) => (
                <>
                  <Link className="btn btn-sm btn-light" to={'/prescriptions/' + t.id}>✎</Link>{' '}
                  <Link className="btn btn-sm btn-light" to={'/print/prescription/' + t.id}>🖨</Link>
                </>
              ),
            },
          ]}
          rows={c.prescriptions}
          empty="ยังไม่มีประวัติการวัดสายตา"
        />
      </Card>

      <Card title="ประวัติการสั่งตัดแว่น" tight>
        <DataTable
          columns={[
            { label: 'วันที่', render: (o) => fmtDateTime(o.order_date), cls: 'nowrap' },
            { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
            { label: 'เลนส์', key: 'lens_name' },
            { label: 'กรอบ', key: 'frame_name' },
            { label: 'ยอดรวม', render: (o) => money(o.total_price), cls: 'num' },
            { label: 'รับแล้ว', render: (o) => money(o.paid), cls: 'num' },
            { label: 'คงเหลือ', render: (o) => money(o.balance), cls: 'num' },
            { label: 'สถานะ', render: (o) => <OrderStatusBadge order={o} /> },
          ]}
          rows={c.orders}
          onRowClick={(o) => navigate('/orders/' + o.id)}
          empty="ยังไม่มีออเดอร์"
        />
      </Card>
    </div>
  );
}
