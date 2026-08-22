import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAsync } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import {
  Badge, Card, Field, Kpi, Kpis, Loading, PageHead, Row, Tabs, Toolbar,
} from '../../components/ui.jsx';
import { StatusChip } from '../../components/StatusChip.jsx';
import { EmployeeSelect, StatusSelect } from '../../components/Selects.jsx';
import { custName, fmtDate, fmtDateTime, moneyShort } from '../../lib/format.js';

import { RxPanel } from './panels/RxPanel.jsx';
import { LensPanel } from './panels/LensPanel.jsx';
import { ProductionPanel } from './panels/ProductionPanel.jsx';
import { PaymentPanel } from './panels/PaymentPanel.jsx';
import { NotifyPanel } from './panels/NotifyPanel.jsx';
import { TimelinePanel } from './panels/TimelinePanel.jsx';

const TAB_NAMES = ['ค่าสายตา', 'เลนส์', 'ผลิต & QC', 'การเงิน', 'ติดต่อลูกค้า', 'ไทม์ไลน์'];

export default function CaseDetail() {
  const { id } = useParams();
  const { ok, err } = useToast();
  const [tab, setTab] = useState(TAB_NAMES[0]);

  /* "ผู้ทำรายการ" is read by every panel when it writes, so it lives here */
  const [actor, setActor] = useState('');
  const actorId = () => Number(actor) || null;

  const [nextStatus, setNextStatus] = useState(null);

  const { data: c, loading, error, reload } = useAsync(() => api.get('/api/cases/' + id), [id]);

  if (loading) return <Loading />;
  if (error) return <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>;

  const changeStatus = async () => {
    try {
      await api.post(`/api/cases/${c.id}/status`, {
        status: nextStatus ?? c.status,
        employee_id: actorId(),
      });
      ok('เปลี่ยนสถานะแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const toggleRush = async () => {
    try {
      await api.put('/api/cases/' + c.id, { ...c, is_rush: Number(c.is_rush) ? 0 : 1 });
      reload();
    } catch (ex) { err(ex); }
  };

  const panelProps = { c, reload, actorId };
  const PANELS = {
    'ค่าสายตา': RxPanel,
    'เลนส์': LensPanel,
    'ผลิต & QC': ProductionPanel,
    'การเงิน': PaymentPanel,
    'ติดต่อลูกค้า': NotifyPanel,
    'ไทม์ไลน์': TimelinePanel,
  };
  const Panel = PANELS[tab];

  return (
    <div>
      <PageHead
        icon="🗂"
        title={c.case_code}
        subtitle={custName(c)}
        actions={(
          <>
            <Link className="btn btn-ghost" to={'/customers/' + c.customer_id}>👤 ข้อมูลลูกค้า</Link>
            {c.order && <Link className="btn btn-ghost" to={'/orders/' + c.order.id}>👓 ออเดอร์</Link>}
            {c.order && <Link className="btn btn-ghost" to={'/print/order/' + c.order.id}>🖨 ใบสั่ง</Link>}
          </>
        )}
      />

      <div className="card">
        <div className="card-body">
          <Row style={{ gap: 14, alignItems: 'center', marginBottom: 12 }}>
            <StatusChip row={c} />
            {Number(c.is_rush) ? <Badge kind="danger">🔥 งานด่วน</Badge> : null}
            {Number(c.is_waiting) ? <Badge kind="warn">สถานะรอ</Badge> : null}
            <span className="muted">{`เปิดเมื่อ ${fmtDateTime(c.opened_at)}`}</span>
            {c.received_by_name ? <span className="muted">{`รับโดย ${c.received_by_name}`}</span> : null}
            {c.phone ? <span className="muted">{'☎ ' + c.phone}</span> : null}
          </Row>

          <Toolbar>
            <Field label="ผู้ทำรายการ">
              <EmployeeSelect name="actor" value={actor} onChange={(e) => setActor(e.target.value)} />
            </Field>
            <Field label="เปลี่ยนสถานะเป็น">
              <StatusSelect
                name="to_status"
                value={nextStatus ?? c.status}
                onChange={(e) => setNextStatus(e.target.value)}
              />
            </Field>
            <button type="button" className="btn btn-accent" onClick={changeStatus}>→ เปลี่ยนสถานะ</button>
            <button type="button" className="btn btn-light" onClick={toggleRush}>
              {Number(c.is_rush) ? 'ยกเลิกงานด่วน' : '🔥 ตั้งเป็นงานด่วน'}
            </button>
          </Toolbar>
        </div>
      </div>

      {c.order && (
        <Kpis>
          <Kpi label="ราคารวม" value={moneyShort(c.order.total_price)} />
          <Kpi label="ส่วนลด" value={moneyShort(c.order.discount)} />
          <Kpi kind="ok" label="รับแล้ว" value={moneyShort(c.paid)} />
          <Kpi kind="warn" label="คงเหลือ" value={moneyShort(c.balance)} />
          <Kpi label="วันนัดรับ" value={fmtDate(c.order.appointment_date) || '—'} />
        </Kpis>
      )}

      <Tabs names={TAB_NAMES} active={tab} onSelect={setTab} />
      <Panel {...panelProps} />
    </div>
  );
}
