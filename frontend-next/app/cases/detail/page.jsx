'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '../../../lib/apiClient.js';
import { useAsync } from '../../../lib/hooks.js';
import { useToast } from '../../../components/Toast.jsx';
import {
  Badge, Card, Field, Kpi, Kpis, Loading, PageHead, Row, Tabs, Toolbar,
} from '../../../components/ui.jsx';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { StatusChip } from '../../../components/StatusChip.jsx';
import { EmployeeSelect } from '../../../components/Selects.jsx';
import { useMeta } from '../../../contexts/MetaContext.jsx';
import { custName, fmtDate, fmtDateTime, moneyShort } from '../../../lib/format.js';

import { RxPanel } from './panels/RxPanel.jsx';
import { LensPanel } from './panels/LensPanel.jsx';
import { ProductionPanel } from './panels/ProductionPanel.jsx';
import { PaymentPanel } from './panels/PaymentPanel.jsx';
import { NotifyPanel } from './panels/NotifyPanel.jsx';
import { TimelinePanel } from './panels/TimelinePanel.jsx';

const TAB_NAMES = ['ค่าสายตา', 'เลนส์', 'ผลิต & QC', 'การเงิน', 'ติดต่อลูกค้า', 'ไทม์ไลน์'];

// Port of public/js/core.js's STAGE_META/stageInfo — the case-workflow stepper.
const STAGE_META = {
  reception: { label: 'รับลูกค้า', color: '#7a5cc4', icon: '🛎' },
  exam: { label: 'วัดสายตา', color: '#2f6fd0', icon: '👁' },
  sales: { label: 'ขาย/เลือกกรอบ', color: '#0f8f8f', icon: '🛍' },
  production: { label: 'ผลิต/เลนส์', color: '#c07000', icon: '🔧' },
  qc: { label: 'ตรวจ QC', color: '#b32020', icon: '🔍' },
  delivery: { label: 'ส่งมอบ', color: '#127a4a', icon: '📦' },
  done: { label: 'จบงาน', color: '#6b7a90', icon: '✅' },
};
const stageInfo = (g) => STAGE_META[g] || { label: g || '-', color: '#6b7a90', icon: '•' };
const GROUPS = ['reception', 'exam', 'sales', 'production', 'qc', 'delivery'];
const ALL_GROUPS = [...GROUPS, 'done'];

// Which tab shows a stage's data — a step's label click opens it. Reception
// has no dedicated tab in this port (frontend-next never ported a "รับเรื่อง"
// panel), so its label click is a no-op — the dot/move-to-stage action still
// works.
const STAGE_TAB = {
  reception: null, exam: 'ค่าสายตา', sales: 'การเงิน',
  production: 'เลนส์', qc: 'ผลิต & QC', delivery: 'ติดต่อลูกค้า', done: 'ไทม์ไลน์',
};

// Port of public/js/views/cases.js's STAGE_CHECKS/stageMissing — a stage is
// "done" (✔) when its real data is filled in, independent of whatever status
// is currently selected. Empty array = nothing missing = done.
const STAGE_CHECKS = {
  reception: (c) => [
    !c.customer_id && 'ข้อมูลลูกค้า',
    !c.received_by && 'ผู้รับเรื่อง',
  ],
  exam: (c) => [
    !(c.prescriptions || []).some((r) => r.kind === 'final' || r.confirmed_at) && 'ค่าสายตาที่ยืนยันแล้ว',
  ],
  sales: (c) => [
    !c.order && 'ออเดอร์',
    c.order && !c.order.frame_name && 'กรอบแว่น',
    c.order && !c.order.lens_name && 'เลนส์',
    !(c.centering && c.centering.pd_total) && 'วัดจุดศูนย์กลาง',
    c.order && !c.order.appointment_date && 'วันนัดรับ',
  ],
  production: (c) => [
    !c.lens_job && 'ใบงานเลนส์',
    c.lens_job && !(c.lens_job.received_at || c.lens_job.picked_at) && 'รับเลนส์เข้า',
    !(c.production && c.production.edging_finished_at) && 'ฝนเลนส์เสร็จ',
  ],
  qc: (c) => [
    !(c.qc_checks || []).some((q) => q.result === 'pass') && 'ผล QC ที่ผ่าน',
  ],
  delivery: (c) => [
    !(c.production && c.production.pack_glasses) && 'แพ็คสินค้า',
    !(c.notifications || []).length && 'แจ้งลูกค้า',
    Number(c.balance) > 0 && 'เก็บเงินให้ครบ',
  ],
  done: (c) => [
    !(c.closed_at || c.is_terminal) && 'ปิดเคส',
  ],
};
const stageMissing = (group, c) => ((STAGE_CHECKS[group] || (() => []))(c)).filter(Boolean);

// Port of public/js/views/cases.js's statusesOfGroup/entryStatusOf — the
// status a case should land on when moved into a given stage.
const statusesOfGroup = (statuses, group) =>
  (statuses || []).filter((s) => s.stage_group === group).sort((a, b) => a.sort_order - b.sort_order);
const entryStatusOf = (statuses, group) =>
  (statuses || []).filter((s) => s.stage_group === group && !s.is_terminal)
    .sort((a, b) => a.sort_order - b.sort_order)[0] || null;

function CaseDetailInner() {
  const params = useSearchParams();
  const id = params.get('id');
  const { ok, err } = useToast();
  const { meta } = useMeta();
  const [tab, setTab] = useState(TAB_NAMES[0]);

  /* "ผู้ทำรายการ" is read by every panel when it writes, so it lives here */
  const [actor, setActor] = useState('');
  const actorId = () => Number(actor) || null;

  const { data: c, loading, error, reload } = useAsync(() => api.get('/api/cases/' + id), [id]);

  if (loading) return <Loading />;
  if (error) return <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>;

  // Port of public/js/views/cases.js's goStatus/moveToStage — moving stages
  // happens only at the stepper (one place), not a separate dropdown+button.
  const goStatus = async (code) => {
    if (!code || code === c.status) return;
    try {
      await api.post(`/api/cases/${c.id}/status`, { status: code, employee_id: actorId() });
      ok('เปลี่ยนสถานะแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };
  const moveToStage = (g) => goStatus((entryStatusOf(meta.statuses, g) || statusesOfGroup(meta.statuses, g)[0] || {}).code);
  const showTab = (name) => { if (TAB_NAMES.includes(name)) setTab(name); };

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
            <Link className="btn btn-ghost" href={'/customers/detail?id=' + c.customer_id}>👤 ข้อมูลลูกค้า</Link>
            {c.order && <Link className="btn btn-ghost" href={'/orders/detail?id=' + c.order.id}>👓 ออเดอร์</Link>}
            {c.order && <Link className="btn btn-ghost" href={'/print/order?id=' + c.order.id}>🖨 ใบสั่ง</Link>}
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
            <button type="button" className="btn btn-light" onClick={toggleRush}>
              {Number(c.is_rush) ? 'ยกเลิกงานด่วน' : '🔥 ตั้งเป็นงานด่วน'}
            </button>
          </Toolbar>

          {/* Case-workflow stepper — port of public/js/views/cases.js. ✔ = that
              stage's real data is filled in; the ringed dot = the stage the
              case is on now. Click a dot to move the case there; click a
              label to open that stage's tab (two separate targets, per the
              legacy app's own design). */}
          <div className="stepper">
            {ALL_GROUPS.map((g) => {
              const info = stageInfo(g);
              const missing = stageMissing(g, c);
              const filled = !missing.length;
              const state = `${filled ? 'done' : 'todo'}${g === c.stage_group ? ' now' : ''}`;
              return (
                <div className={`step ${state}`} key={g} style={{ '--stage': info.color }}>
                  <span className="step-line" />
                  <button
                    type="button"
                    className="step-dot icon-only"
                    title={filled
                      ? `ข้อมูลครบแล้ว — กดเพื่อย้ายเคสไปขั้น ${info.label}`
                      : `ยังขาด: ${missing.join(', ')} — กดเพื่อย้ายเคสไปขั้น ${info.label}`}
                    onClick={() => moveToStage(g)}
                  >
                    {filled ? '✔' : info.icon}
                  </button>
                  <button
                    type="button"
                    className="step-label"
                    title={`ดูข้อมูลขั้น ${info.label}`}
                    onClick={() => showTab(STAGE_TAB[g])}
                  >
                    {info.label}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="hint" style={{ margin: '-10px 0 12px', textAlign: 'center' }}>
            ✔ = ข้อมูลขั้นนั้นกรอกครบแล้ว · กดวงกลม = ย้ายเคสไปขั้นนั้น · กดชื่อขั้น = เปิดดูข้อมูล
          </p>
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

export default function CaseDetailPage() {
  return (
    <QueryParamPage>
      <CaseDetailInner />
    </QueryParamPage>
  );
}
