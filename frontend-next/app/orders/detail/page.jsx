'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../lib/apiClient.js';
import { useAsync } from '../../../lib/hooks.js';
import { useToast } from '../../../components/Toast.jsx';
import { useConfirm } from '../../../components/Confirm.jsx';
import {
  Badge, Card, FormActions, Kv, Loading, OrderStatusBadge, PageHead, Row, Split, Stack,
} from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { RX_KIND_LABEL } from '../../../lib/constants.js';
import {
  custName, fmtDateTime, money, power, rxNum,
} from '../../../lib/format.js';
import { Icon } from '../../../components/Icon.jsx';

/** one physical item line inside the order's key/value list */
const itemValue = (s) => (s
  ? <>{s.product_name} <span className="muted">{`#${s.id} · ${money(s.product_price)}`}</span></>
  : <Badge kind="warn">ยังไม่ได้เติม</Badge>);

function OrderDetailInner() {
  const params = useSearchParams();
  const id = params.get('id');
  const router = useRouter();
  const { ok, err } = useToast();
  const confirm = useConfirm();

  const { data, loading, error } = useAsync(() => {
    if (!id) return Promise.resolve(null);
    return api.get('/api/orders/' + id);
  }, [id]);

  if (loading) return <Loading />;
  if (error) return <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>;
  if (!data || !data.id) {
    return <Card><h2>ไม่พบข้อมูลออเดอร์</h2><p className="muted">ไม่พบออเดอร์รายนี้ในระบบ</p></Card>;
  }

  const o = data;
  const t = o.prescription;
  const closed = Number(o.order_closed);
  const payments = o.payment_rows || [];

  const remove = async () => {
    if (!await confirm('ลบออเดอร์', `ลบออเดอร์ ${o.invoice_code}?`, { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del('/api/orders/' + id);
      ok('ลบแล้ว');
      router.push('/orders');
    } catch (ex) {
      err(ex);
    }
  };

  return (
    <div>
      <PageHead
        icon="👓"
        title={o.invoice_code}
        subtitle={custName(o)}
        actions={(
          <>
            {!closed && <Link className="btn btn-ghost" href={`/orders/edit?id=${o.id}`}><Icon name="pencil" /> แก้ไข</Link>}
            {o.case_id && (
              <Link className="btn btn-ghost" href={'/cases/detail?id=' + o.case_id}><Icon name="board" /> {o.case_code || 'เคส'}</Link>
            )}
            <Link className="btn btn-ghost" href={'/customers/detail?id=' + o.customer_id}><Icon name="user" /> ลูกค้า</Link>
          </>
        )}
      />

      <Split>
        <Card title="ข้อมูลออเดอร์">
          <Row style={{ marginBottom: 12 }}><OrderStatusBadge order={o} /></Row>
          <Kv rows={[
            ['รหัสออเดอร์', '#' + o.id],
            ['Invoice', o.invoice_code],
            ['ลูกค้า', (
              <>
                <Link href={'/customers/detail?id=' + o.customer_id}>{custName(o)}</Link>
                {o.phone ? ` · ${o.phone}` : ''}
              </>
            )],
            ['พนักงาน', o.employee_name || '-'],
            ['วันที่สั่ง', fmtDateTime(o.order_date)],
            ['ช่องทาง', o.marketing || '-'],
            ['เลนส์', o.lens_name || '-'],
            ['กรอบ', o.frame_name || '-'],
            ['เลนส์ขวา (OD, stock)', itemValue(o.left_lens)],
            ['เลนส์ซ้าย (OS, stock)', itemValue(o.right_lens)],
            ['กรอบ (stock)', itemValue(o.frame)],
            ['หมายเหตุ', o.notes || '-'],
          ]}
          />
        </Card>

        <Stack>
          <Card title="ยอดเงิน">
            <Kv rows={[
              ['ราคากรอบ', money(o.frame_price)],
              ['ราคาเลนส์ขวา', money(o.lens_od_price)],
              ['ราคาเลนส์ซ้าย', money(o.lens_os_price)],
              ['ค่าออพชั่นเสริม', money(o.options_price)],
              ['ราคารวม', money(o.total_price)],
              ['ส่วนลด', money(o.discount)],
              ['ยอดสุทธิ', money(Number(o.total_price) - Number(o.discount))],
              ['มัดจำ', `${money(o.deposit)} (${o.deposit_pay_type || '-'})`],
              ['รับเงินแล้วรวม', money(o.paid)],
              ['คงเหลือ', <b>{money(o.balance)}</b>],
            ]}
            />
          </Card>

          {t && (
            <Card title="ผลวัดสายตาที่ใช้">
              <Kv rows={[
                ['ชนิด', RX_KIND_LABEL[t.kind] || t.kind],
                ['วัดเมื่อ', fmtDateTime(t.test_date)],
                ['ใช้สำหรับ', t.test_for || '-'],
                ['R (Sph/Cyl/Axis/Add)', `${power(t.r_sphere)} / ${power(t.r_cylinder)} / ${rxNum(t.r_axis)} / ${power(t.r_add)}`],
                ['L (Sph/Cyl/Axis/Add)', `${power(t.l_sphere)} / ${power(t.l_cylinder)} / ${rxNum(t.l_axis)} / ${power(t.l_add)}`],
              ]}
              />
              <FormActions style={{ marginTop: 10 }}>
                <Link className="btn btn-sm btn-light" href={'/print/prescription?id=' + t.id}><Icon name="printer" /> ใบวัดสายตา</Link>
              </FormActions>
            </Card>
          )}

          <Card title="การจัดการ">
            <Row>
              {!closed && <button type="button" className="btn btn-danger" onClick={remove}><Icon name="trash" /> ลบออเดอร์</button>}
              {!!closed && <span className="muted">ออเดอร์นี้ปิดการขายแล้ว จึงลบไม่ได้</span>}
            </Row>
          </Card>
        </Stack>
      </Split>

      <Card title="ประวัติการรับเงิน" tight>
        <DataTable
          columns={[
            { label: 'เมื่อ', render: (pay) => fmtDateTime(pay.paid_at), cls: 'nowrap' },
            { label: 'ประเภท', key: 'kind' },
            { label: 'วิธี', key: 'method' },
            { label: 'จำนวน', render: (pay) => money(pay.amount), cls: 'num' },
            { label: 'อ้างอิง', key: 'reference' },
            { label: 'ผู้รับ', key: 'received_by_name' },
            { label: 'หมายเหตุ', key: 'notes' },
          ]}
          rows={payments}
          empty="ยังไม่มีการรับเงิน"
        />
      </Card>
    </div>
  );
}

export default function OrderDetailPage() {
  return (
    <QueryParamPage>
      <OrderDetailInner />
    </QueryParamPage>
  );
}
