'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '../../../lib/apiClient.js';
import { useAsync } from '../../../lib/hooks.js';
import { useToast } from '../../../components/Toast.jsx';
import {
  Badge, Card, Field, Kpi, Kpis, Kv, Loading, PageHead, Row, Split, Stack, Tabs, Toolbar,
} from '../../../components/ui.jsx';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { StatusChip } from '../../../components/StatusChip.jsx';
import { EmployeeSelect } from '../../../components/Selects.jsx';
import { useMeta } from '../../../contexts/MetaContext.jsx';
import { ACTION_LABEL, STAGE_GROUPS, stageInfo } from '../../../lib/constants.js';
import { custName, fmtDate, fmtDateTime, money, moneyShort } from '../../../lib/format.js';

import { RxPanel } from './panels/RxPanel.jsx';
import { SalesPanel } from './panels/SalesPanel.jsx';
import { CenteringPanel } from './panels/CenteringPanel.jsx';
import { LensPanel } from './panels/LensPanel.jsx';
import { ProductionPanel } from './panels/ProductionPanel.jsx';
import { QcPanel } from './panels/QcPanel.jsx';
import { DeliveryPanel } from './panels/DeliveryPanel.jsx';
import { PaymentPanel } from './panels/PaymentPanel.jsx';
import { NotifyPanel } from './panels/NotifyPanel.jsx';
import { TimelinePanel } from './panels/TimelinePanel.jsx';
import { ClosePanel } from './panels/ClosePanel.jsx';

const TAB_NAMES = [
  'ภาพรวม', 'ค่าสายตา', 'การขาย', 'Center Point', 'เลนส์', 'ผลิต',
  'QC', 'ส่งมอบ', 'การเงิน', 'ติดต่อลูกค้า', 'ไทม์ไลน์',
];

/** Which tab shows a stage's data — a step's label click opens it. Reception
 * has no dedicated tab (there is no "รับเรื่อง" panel in this port), so its
 * label opens the overview instead. */
const STAGE_TAB = {
  reception: 'ภาพรวม', exam: 'ค่าสายตา', sales: 'การขาย', centering: 'Center Point',
  payment: 'การเงิน', production: 'ผลิต', qc: 'QC', delivery: 'ส่งมอบ', done: 'ไทม์ไลน์',
};

/** The 6-state process vocabulary the shop uses on its own job board. */
const PROCESS_STATE_META = {
  done: { label: 'เสร็จแล้ว', icon: '✓', cls: 'done' },
  in_progress: { label: 'กำลังดำเนินการ', icon: '◐', cls: 'warn' },
  waiting: { label: 'รอ', icon: '⏳', cls: 'warn' },
  not_started: { label: 'ยังไม่เริ่ม', icon: '○', cls: '' },
  problem: { label: 'มีปัญหา', icon: '!', cls: 'danger' },
  sent_back: { label: 'ส่งกลับมาแก้ไข', icon: '↩', cls: 'danger' },
};

/** Per-process status, computed from the data caseDetail() already returns —
 * deliberately not a DB column: a process is "done" when its real data is
 * filled in, whatever status the case happens to be parked on. */
function processState(group, c) {
  switch (group) {
    case 'reception':
      return c.customer_id ? 'done' : 'not_started';
    case 'exam': {
      const rx = c.prescriptions || [];
      if (rx.some((r) => r.kind === 'final' || r.confirmed_at)) return 'done';
      return rx.length ? 'in_progress' : 'not_started';
    }
    case 'sales': {
      if (!c.order) return 'not_started';
      return c.order.frame_name && c.order.lens_name ? 'done' : 'in_progress';
    }
    case 'centering':
      return c.centering?.pd_total ? 'done' : (c.centering ? 'in_progress' : 'not_started');
    case 'payment': {
      if (!(c.payments || []).length) return 'not_started';
      return Number(c.balance) <= 0 ? 'done' : 'in_progress';
    }
    case 'production': {
      if (c.qc_checks?.[0]?.result === 'fail') return 'sent_back';
      if (c.production?.status === 'COMPLETED') return 'done';
      if (c.production?.status === 'WAITING_FOR_ITEM') return 'problem';
      if (c.production?.status === 'IN_PRODUCTION') return 'in_progress';
      if (c.production?.edging_finished_at) return 'done';
      return c.production ? 'in_progress' : 'not_started';
    }
    case 'qc': {
      const last = c.qc_checks?.[0];
      if (!last) return 'not_started';
      return last.result === 'pass' ? 'done' : 'sent_back';
    }
    case 'delivery': {
      if (c.production?.pickup_at) return 'done';
      return (c.notifications || []).length ? 'waiting' : 'not_started';
    }
    case 'done':
      /* closed_at is never cleared when a closed case is re-opened (Sql.php
         only ever stamps it), so the live terminal flag is the truth here. */
      return Number(c.is_terminal) ? 'done' : 'not_started';
    default:
      return 'not_started';
  }
}

const ALL_GROUPS = [...STAGE_GROUPS, 'done'];

/** Port of public/js/views/cases.js's statusesOfGroup/entryStatusOf — the
 * status a case should land on when moved into a given stage. */
const statusesOfGroup = (statuses, group) =>
  (statuses || []).filter((s) => s.stage_group === group).sort((a, b) => a.sort_order - b.sort_order);
const entryStatusOf = (statuses, group) =>
  (statuses || []).filter((s) => s.stage_group === group && !s.is_terminal)
    .sort((a, b) => a.sort_order - b.sort_order)[0] || null;

/** One picked item on the overview — frame / lens OD / lens OS. */
function ItemCard({ title, name, sub, price, inStock }) {
  return (
    <Card
      title={title}
      badge={inStock ? <Badge kind="ok">เลือกจากสต็อกแล้ว</Badge> : <Badge kind="gray">ยังไม่เลือกสต็อก</Badge>}
    >
      <Kv
        rows={[
          ['รายการ', name || '—'],
          sub ? ['รายละเอียด', sub] : null,
          ['ราคา', price === null || price === undefined || price === '' ? '—' : money(price)],
        ]}
      />
    </Card>
  );
}

function OverviewTab({ c, showTab }) {
  const o = c.order;
  const anyPayment = (c.payments || []).length > 0;

  return (
    <Stack>
      {o ? (
        anyPayment ? (
          <Kpis>
            <Kpi label="ราคารวม" value={moneyShort(o.total_price)} />
            <Kpi label="ส่วนลด" value={moneyShort(o.discount)} />
            <Kpi kind="ok" label="รับแล้ว" value={moneyShort(c.paid)} />
            <Kpi kind="warn" label="คงเหลือ" value={moneyShort(c.balance)} />
            <Kpi label="วันนัดรับ" value={fmtDate(o.appointment_date) || '—'} />
          </Kpis>
        ) : (
          <Kpis>
            <Kpi
              label="ยอดสุทธิ"
              value={moneyShort(Number(o.total_price) - Number(o.discount))}
              sub="ยังไม่ชำระ"
            />
            <Kpi label="วันนัดรับ" value={fmtDate(o.appointment_date) || '—'} />
          </Kpis>
        )
      ) : null}

      <Split>
        <Card
          title="ข้อมูลลูกค้า"
          right={(
            <Link className="btn btn-sm btn-light" href={'/customers/detail?id=' + c.customer_id}>
              เปิดประวัติ
            </Link>
          )}
        >
          <Kv
            rows={[
              ['ชื่อ', custName(c)],
              ['โทร', c.phone || '—'],
              ['LINE', c.line_id || '—'],
              ['อีเมล', c.email || '—'],
              ['วันเกิด', fmtDate(c.birth_date) || '—'],
            ]}
          />
        </Card>

        <Card title="ข้อมูลเคส">
          <Kv
            rows={[
              ['เลขเคส', c.case_code],
              ['สถานะ', c.status_label_th || c.status],
              ['เปิดเมื่อ', fmtDateTime(c.opened_at)],
              ['ผู้รับเรื่อง', c.received_by_name || '—'],
              ['ช่องทางที่รู้จัก', c.referral_source || '—'],
              ['ปิดเคสเมื่อ', c.closed_at ? fmtDateTime(c.closed_at) : '—'],
            ]}
          />
        </Card>
      </Split>

      {o ? (
        <div className="tiles">
          <ItemCard
            title="กรอบแว่น"
            name={o.frame_name}
            sub={[o.frame_brand, o.frame_model, o.frame_color].filter(Boolean).join(' · ')}
            price={o.frame_price}
            inStock={!!o.frame_product_id}
          />
          <ItemCard
            title="เลนส์ขวา (OD)"
            name={o.lens_name}
            sub={[o.lens_brand, o.lens_index, o.lens_coating].filter(Boolean).join(' · ')}
            price={o.lens_od_price}
            inStock={!!o.lens_product_id}
          />
          <ItemCard
            title="เลนส์ซ้าย (OS)"
            name={o.lens_name}
            sub={[o.lens_brand, o.lens_index, o.lens_coating].filter(Boolean).join(' · ')}
            price={o.lens_os_price}
            inStock={!!o.right_lens_product_id}
          />
        </div>
      ) : (
        <Card title="สินค้าที่เลือก">
          <p className="muted">ยังไม่มีออเดอร์ — เปิดออเดอร์ที่แท็บ การขาย</p>
        </Card>
      )}

      <Split>
        <Card title="หมายเหตุจากเคส">
          <p className={c.notes || c.reception_note ? '' : 'muted'}>
            {c.notes || c.reception_note || 'ไม่มีหมายเหตุ'}
          </p>
        </Card>

        <Card
          title="กิจกรรมล่าสุด"
          right={(
            <button type="button" className="btn btn-sm btn-light" onClick={() => showTab('ไทม์ไลน์')}>
              ดูทั้งหมด
            </button>
          )}
        >
          {(c.events || []).length ? (
            <Kv
              rows={(c.events || []).slice(0, 5).map((ev) => [
                fmtDateTime(ev.created_at),
                `${ACTION_LABEL[ev.action] || ev.action}`
                + `${ev.to_label ? ` → ${ev.to_label}` : ''}`
                + `${ev.employee_name ? ` · ${ev.employee_name}` : ''}`,
              ])}
            />
          ) : <p className="muted">ยังไม่มีกิจกรรม</p>}
        </Card>
      </Split>
    </Stack>
  );
}

function CaseDetailInner() {
  const params = useSearchParams();
  const id = params.get('id');
  const { ok, err } = useToast();
  const { meta } = useMeta();
  const [tab, setTab] = useState(TAB_NAMES[0]);
  const [closeOpen, setCloseOpen] = useState(false);

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
    'การขาย': SalesPanel,
    'Center Point': CenteringPanel,
    'เลนส์': LensPanel,
    'ผลิต': ProductionPanel,
    QC: QcPanel,
    'ส่งมอบ': DeliveryPanel,
    'การเงิน': PaymentPanel,
    'ติดต่อลูกค้า': NotifyPanel,
    'ไทม์ไลน์': TimelinePanel,
  };
  const Panel = PANELS[tab];
  const closed = !!Number(c.is_terminal);

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
            <button type="button" className="btn btn-ghost" onClick={() => setCloseOpen(true)}>
              {closed ? '✅ ดูการจบงาน' : '✅ จบงาน'}
            </button>
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

          {/* 9-process stepper. Each dot shows that process's own state
              (เสร็จ / กำลังทำ / รอ / ยังไม่เริ่ม / มีปัญหา / ส่งกลับมาแก้) computed
              from the case's real data; the ringed dot is the stage the case is
              parked on. Click a dot to move the case there; click a label to
              open that process's tab. */}
          <div className="stepper">
            {ALL_GROUPS.map((g) => {
              const info = stageInfo(g);
              const state = processState(g, c);
              const sm = PROCESS_STATE_META[state];
              const cls = `${sm.cls}${g === c.stage_group ? ' now' : ''}`;
              return (
                <div className={`step ${cls}`} key={g} style={{ '--stage': info.color }}>
                  <span className="step-line" />
                  <button
                    type="button"
                    className="step-dot icon-only"
                    title={`${info.label}: ${sm.label} — กดเพื่อย้ายเคสไปขั้นนี้`}
                    onClick={() => moveToStage(g)}
                  >
                    {state === 'not_started' ? info.icon : sm.icon}
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

          <div className="stepper-legend">
            {Object.entries(PROCESS_STATE_META).map(([k, m]) => (
              <span key={k} className={`legend-item ${m.cls}`}>{`${m.icon} ${m.label}`}</span>
            ))}
          </div>

          <p className="hint" style={{ margin: '0 0 12px', textAlign: 'center' }}>
            กดวงกลม = ย้ายเคสไปขั้นนั้น · กดชื่อขั้น = เปิดดูข้อมูลขั้นนั้น
          </p>
        </div>
      </div>

      <Tabs names={TAB_NAMES} active={tab} onSelect={setTab} />
      {tab === 'ภาพรวม' ? <OverviewTab c={c} showTab={showTab} /> : <Panel {...panelProps} />}

      {closeOpen && (
        <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) setCloseOpen(false); }}>
          <div className="modal wide">
            <h3>{`✅ จบงาน — ${c.case_code}`}</h3>
            <div className="m-body">
              <ClosePanel c={c} reload={reload} actorId={actorId} />
            </div>
            <div className="m-foot">
              <button type="button" className="btn btn-light" onClick={() => setCloseOpen(false)}>ปิด</button>
            </div>
          </div>
        </div>
      )}
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
