'use client';
/**
 * Case workspace.
 *
 * The 6 processes are not a wizard: any of them can be opened at any time, in
 * any order (ขาย before วัดสายตา is normal here). So this page keeps two ideas
 * apart on purpose:
 *
 *   viewing step   — which process you are looking at. Lives in the ?step=
 *                    query param and changes nothing on the server.
 *   process status — what that process's state actually is. Lives in
 *                    case_processes and only moves through the action bar in
 *                    ProcessShell.
 *
 * Switching steps never reloads the page and never refetches the case; the
 * header and the stepper stay mounted and only the content area swaps.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../../lib/apiClient.js';
import { useAsync } from '../../../../lib/hooks.js';
import {
  Badge, Card, Kpi, Kpis, Kv, Loading, PageHead, Row, Split, Stack,
} from '../../../../components/ui.jsx';
import { QueryParamPage } from '../../../../components/QueryParamPage.jsx';
import { useToast } from '../../../../components/Toast.jsx';
import { StatusChip } from '../../../../components/StatusChip.jsx';
import { CaseStepper } from '../../../../components/CaseStepper.jsx';
import { ProcessShell } from '../../../../components/ProcessShell.jsx';
import { ACTION_LABEL } from '../../../../lib/constants.js';
import { SEND_EVENT_LABEL } from '../../../../lib/centeringSend.js';
import { CUSTOMER_EVENT_LABEL } from '../../../../lib/caseCustomer.js';
import { useAuth } from '../../../../contexts/AuthContext.jsx';
import { inSystemZone } from '../../../../lib/roles.js';
import {
  CASE_PROCESSES, eventNote, paymentStatusOf, processInfo,
} from '../../../../lib/caseProcesses.js';
import { custName, fmtDate, fmtDateTime, money, moneyShort } from '../../../../lib/format.js';
import { ageTextOf, birthOrAge } from '../../../../lib/customerAge.js';

import { ReceptionPanel } from './panels/ReceptionPanel.jsx';
import { ExamPanel } from './panels/ExamPanel.jsx';
import { SalesPanel } from './panels/SalesPanel.jsx';
import { PaymentPanel } from './panels/PaymentPanel.jsx';
import { CenteringPanel } from './panels/CenteringPanel.jsx';
import { DeliveryPanel } from './panels/DeliveryPanel.jsx';
import { Icon } from '../../../../components/Icon.jsx';
import { NotifyPanel } from './panels/NotifyPanel.jsx';
import { TimelinePanel } from './panels/TimelinePanel.jsx';
import { ChangeCustomerDialog } from './panels/ChangeCustomerDialog.jsx';

/** one panel per process — ids come from lib/caseProcesses.js */
const PROCESS_PANELS = {
  reception: ReceptionPanel,
  exam: ExamPanel,
  sales: SalesPanel,
  payment: PaymentPanel,
  centering: CenteringPanel,
  delivery: DeliveryPanel,
};

/** views that are not a process — no status, no complete action */
const EXTRA_VIEWS = [
  ['overview', 'ภาพรวม'],
  ['notify', 'ติดต่อลูกค้า'],
  ['timeline', 'ไทม์ไลน์'],
];
const EXTRA_PANELS = { notify: NotifyPanel, timeline: TimelinePanel };

const isProcess = (step) => Object.prototype.hasOwnProperty.call(PROCESS_PANELS, step);
const isKnownStep = (step) => isProcess(step)
  || Object.prototype.hasOwnProperty.call(EXTRA_PANELS, step)
  || step === 'overview';

/** One picked item on the overview — frame / lens R / lens L. */
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

/**
 * ปุ่มติ๊ก "งานด่วน" — is_rush ถูกอ่านอยู่หลายที่ (ป้ายบนกระดาน/ส่งมอบ, ตัวกรอง
 * "ด่วนเท่านั้น", ลำดับ ORDER BY is_rush DESC) แต่ไม่เคยมีที่ให้ติ๊ก อยู่บนหัวเคส
 * จึงกดได้จากทุกขั้นตอน ไม่ต้องเดินไปหาขั้นตอนที่ "เป็นเจ้าของ" ค่านี้
 *
 * PUT /api/cases/:id เขียนทับทุกคอลัมน์ในคำสั่งเดียว ไม่ใช่ patch ทีละช่อง —
 * ต้องส่ง {...c} ไปด้วยเสมอ ไม่งั้น received_by / case_type / notes จะถูกล้าง
 * (รูปแบบเดียวกับที่ ReceptionPanel ใช้)
 */
function RushToggle({ c, reload }) {
  const { ok, err } = useToast();
  const [busy, setBusy] = useState(false);
  const rush = !!Number(c.is_rush);

  const toggle = async () => {
    setBusy(true);
    try {
      await api.put('/api/cases/' + c.id, { ...c, is_rush: rush ? 0 : 1 });
      ok(rush ? 'เอาออกจากงานด่วนแล้ว' : 'ตั้งเป็นงานด่วนแล้ว');
      reload();
    } catch (e) {
      err(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={`rush-toggle ${rush ? 'on' : ''}`}
      onClick={toggle}
      disabled={busy}
      aria-pressed={rush}
      title={rush ? 'กดเพื่อเอาออกจากงานด่วน' : 'กดเพื่อตั้งเป็นงานด่วน'}
    >
      <Icon name="flame" /> {rush ? 'งานด่วน' : 'ตั้งเป็นงานด่วน'}
    </button>
  );
}

function OverviewTab({ c, showTab }) {
  const o = c.order;
  const pay = paymentStatusOf(c);
  const anyPayment = (c.payments || []).length > 0;

  return (
    <Stack>
      {o ? (
        anyPayment ? (
          <Kpis>
            <Kpi label="ราคารวม" value={moneyShort(o.total_price)} />
            <Kpi label="ส่วนลด" value={moneyShort(o.discount)} />
            <Kpi kind="ok" label="รับแล้ว" value={moneyShort(c.paid)} />
            <Kpi kind="warn" label="คงเหลือ" value={moneyShort(c.balance)} sub={pay.label} />
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

      <Card title="สถานะแต่ละขั้นตอน">
        <div className="process-summary">
          {/* ขั้นที่เคสใบนี้มี มาจาก server (`process_list` — กฎอยู่ที่
              Lookups::CASE_TYPE_PROCESSES ที่เดียว) ส่วนค่าคงที่ฝั่งนี้เหลือหน้าที่
              บอกป้าย สี ไอคอน และลำดับเท่านั้น · เคสที่ server ยังไม่ส่งรายการมา
              (คำตอบเก่าที่ค้างอยู่) ให้แสดงครบเหมือนเดิม ไม่ใช่หายทั้งแถบ */}
          {CASE_PROCESSES.filter((p) => !c.process_list || c.process_list.includes(p.id)).map((p) => {
            const st = (c.processes || {})[p.id] || {};
            const reasons = [...(st.blocking || []), ...(st.missing || [])];
            return (
              <button
                type="button"
                key={p.id}
                className={`process-chip ${st.status || 'not_started'}`}
                onClick={() => showTab(p.id)}
                title={reasons.length ? `ยังขาด: ${reasons.join(', ')}` : undefined}
              >
                <b><Icon name={p.icon} /> {p.label}</b>
                <span>
                  {st.status === 'completed'
                    ? (st.completed_at ? `ยืนยัน ${fmtDateTime(st.completed_at)}` : 'ข้อมูลครบแล้ว')
                    : (reasons[0] || '')}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

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
              ['LINE / WhatsApp', c.line_id || '—'],
              ['อีเมล', c.email || '—'],
              ['วันเกิด', birthOrAge(c, fmtDate) || '—'],
            ]}
          />
        </Card>

        <Card title="ข้อมูลเคส">
          <Kv
            rows={[
              ['เลขเคส', c.case_code],
              ['สถานะ', c.status_label_th || c.status],
              ['เปิดเมื่อ', fmtDateTime(c.opened_at)],
              ['ประเภทงาน', c.case_type || '—'],
              ['ผู้รับเรื่อง', c.received_by_name || '—'],
              ['ตอนเปิดเคส', Number(c.is_new_customer) ? 'ลูกค้าใหม่' : 'ลูกค้าเก่า'],
              ['ช่องทางที่รู้จัก', c.referral_note || c.referral_source || '—'],
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
            title="เลนส์ขวา (R)"
            name={o.lens_name}
            sub={[o.lens_brand, o.lens_index, o.lens_coating].filter(Boolean).join(' · ')}
            price={o.lens_od_price}
            inStock={!!o.lens_product_id}
          />
          <ItemCard
            title="เลนส์ซ้าย (L)"
            name={o.lens_name}
            sub={[o.lens_brand, o.lens_index, o.lens_coating].filter(Boolean).join(' · ')}
            price={o.lens_os_price}
            inStock={!!o.right_lens_product_id}
          />
        </div>
      ) : (
        <Card title="สินค้าที่เลือก">
          <p className="muted">ยังไม่มีออเดอร์ — เปิดออเดอร์ที่ขั้น ขาย/เลือกกรอบ</p>
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
            <button type="button" className="btn btn-sm btn-light" onClick={() => showTab('timeline')}>
              ดูทั้งหมด
            </button>
          )}
        >
          {(c.events || []).length ? (
            <Kv
              rows={(c.events || []).slice(0, 5).map((ev) => [
                fmtDateTime(ev.created_at),
                <>
                  {ACTION_LABEL[ev.action] || SEND_EVENT_LABEL[ev.action] || CUSTOMER_EVENT_LABEL[ev.action] || ev.action}
                  {ev.to_label ? <> <Icon name="arrowRight" /> {ev.to_label}</> : null}
                  {eventNote(ev) ? ` · ${eventNote(ev)}` : ''}
                </>,
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
  const router = useRouter();
  const id = params.get('id');
  const stepParam = params.get('step');
  const step = isKnownStep(stepParam) ? stepParam : 'overview';

  const { data: c, loading, error, reload } = useAsync(() => api.get('/api/cases/' + id), [id]);

  /* Unsaved-changes guard. Any edit inside the content area marks it dirty;
     every successful reload clears it, and every panel reloads after it saves. */
  const dirty = useRef(false);
  const dirtyForm = useRef(null);
  const [pending, setPending] = useState(null);   // the step waiting behind the guard
  const [savingNav, setSavingNav] = useState(false);
  const panelActions = useRef({});                // what the open panel registered
  /* ปุ่ม "เปลี่ยนลูกค้า" — แอดมิน/เจ้าของร้านเท่านั้น (API ตรวจซ้ำเอง) */
  const { actor } = useAuth();
  const [changingCustomer, setChangingCustomer] = useState(false);

  useEffect(() => { dirty.current = false; dirtyForm.current = null; }, [c]);

  const go = useCallback((next) => {
    dirty.current = false;
    dirtyForm.current = null;
    router.replace(`/cases/detail?id=${id}&step=${next}`, { scroll: false });
  }, [id, router]);

  /* "บันทึกและไปต่อ" submits the panel's own form and leaves once the reload
     that follows lands (new data object => this effect runs). */
  useEffect(() => {
    if (!savingNav || !pending) return;
    const next = pending;
    setSavingNav(false);
    setPending(null);
    go(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c]);

  const requestStep = (next) => {
    if (next === step) return;
    if (dirty.current) { setPending(next); return; }
    go(next);
  };

  const onEdit = (e) => {
    const el = e.target;
    if (!el || !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
    dirty.current = true;
    dirtyForm.current = el.form || dirtyForm.current;
  };

  if (error) return <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>;
  if (!c) return <Loading />;

  const processes = c.processes || {};
  /* ลิงก์เก่าอาจชี้ไปขั้นที่เคสประเภทนี้ไม่มี (เช่น ?step=sales ของเคสตรวจสายตา)
     ตกกลับไปหน้าภาพรวม ดีกว่าวาดแผงของขั้นที่เคสใบนี้ไม่มีอยู่จริง ซึ่งกดยืนยัน
     แล้วจะโดน API ปฏิเสธอยู่ดี · เคสที่ server ยังไม่ส่ง process_list มา ให้ผ่านหมด */
  const view = (!isProcess(step) || !c.process_list || c.process_list.includes(step))
    ? step
    : 'overview';
  const panelProps = { c, reload, actorId: () => null };
  const ProcessPanel = PROCESS_PANELS[view];
  const ExtraPanel = EXTRA_PANELS[view];
  const info = isProcess(view) ? processInfo(view) : null;
  const pay = paymentStatusOf(c);

  const saveAndGo = async () => {
    const next = pending;
    /* a panel that registered its own save (the exam workspace has no <form>)
       owns the save; otherwise submit the form the edit came from */
    if (panelActions.current?.saveDraft) {
      setPending(null);
      try { await panelActions.current.saveDraft(); } catch { /* toast already shown */ }
      go(next);
      return;
    }
    const form = dirtyForm.current;
    if (!form) { setPending(null); go(next); return; }
    setSavingNav(true);
    form.requestSubmit();
  };

  return (
    <div>
      <PageHead
        icon="board"
        title={c.case_code}
        /* อายุอยู่บนหัวเคสที่ค้างอยู่ทุกขั้น — วัดสายตา (ค่า ADD) กับเลือกเลนส์ต้องใช้
           ไม่มีวันเกิดหรือวันเกิดผิด = ชื่ออย่างเดียว ไม่ขึ้น "— ปี" */
        subtitle={[custName(c), ageTextOf(c)].filter(Boolean).join(' · ')}
        actions={(
          <>
            <Link className="btn btn-ghost" href={'/customers/detail?id=' + c.customer_id}><Icon name="user" /> ข้อมูลลูกค้า</Link>
            {inSystemZone(actor) && (
              <button type="button" className="btn btn-ghost" onClick={() => setChangingCustomer(true)}>
                <Icon name="users" /> เปลี่ยนลูกค้า
              </button>
            )}
            {c.order && <Link className="btn btn-ghost" href={'/orders/detail?id=' + c.order.id}><Icon name="glasses" /> ออเดอร์</Link>}
            {c.order && <Link className="btn btn-ghost" href={'/print/order?id=' + c.order.id}><Icon name="printer" /> ใบสั่ง</Link>}
            {c.order && <Link className="btn btn-ghost" href={'/print/receipt?order=' + c.order.id}><Icon name="receipt" /> ใบเสร็จ</Link>}
          </>
        )}
      />

      {changingCustomer && (
        <ChangeCustomerDialog
          c={c}
          onClose={() => setChangingCustomer(false)}
          onSaved={() => { setChangingCustomer(false); reload(); }}
        />
      )}

      <div className="card">
        <div className="card-body">
          {/* ระยะห่างมาจาก .row ไม่ได้ตั้งทับด้วย inline style — ค่าที่เขียนติดกับ
              แท็กชนะ media query ของมือถือเสมอ แล้วป้ายกับปุ่มก็ห่อคนละบรรทัด */}
          <Row style={{ alignItems: 'center', marginBottom: 12 }}>
            <StatusChip row={c} />
            <RushToggle c={c} reload={reload} />
            {Number(c.is_waiting) ? <Badge kind="warn">สถานะรอ</Badge> : null}
            {c.order ? <Badge kind={pay.kind}><Icon name="card" /> {pay.label}</Badge> : null}
            <span className="muted">{`เปิดเมื่อ ${fmtDateTime(c.opened_at)}`}</span>
            {c.received_by_name ? <span className="muted">{`รับโดย ${c.received_by_name}`}</span> : null}
            {c.phone ? <span className="muted"><Icon name="phone" /> {c.phone}</span> : null}
          </Row>

          {/* `view` ไม่ใช่ `step` — ลิงก์เก่าที่ชี้ไปขั้นที่เคสนี้ไม่มี ถูกพาไปหน้าภาพรวมแล้ว
              จุดบนแถบจึงต้องไม่ไปไฮไลต์ขั้นที่ไม่ได้ถูกวาดอยู่จริง */}
          <CaseStepper processes={processes} list={c.process_list} viewing={view} onView={requestStep} />

          <p className="hint" style={{ margin: '0 0 12px', textAlign: 'center' }}>
            กดขั้นตอนเพื่อเปิดดูเท่านั้น — สถานะจะเปลี่ยนเมื่อกดปุ่มยืนยันในขั้นตอนนั้น
          </p>
        </div>
      </div>

      <div className="tabs">
        {EXTRA_VIEWS.map(([viewId, label]) => (
          <button
            type="button"
            key={viewId}
            className={step === viewId ? 'active' : ''}
            onClick={() => requestStep(viewId)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* A reload dims the content instead of replacing it: unmounting a panel
          mid-reload would throw away whatever the user has typed but not saved. */}
      <div className={loading ? 'content-busy' : ''} onInput={onEdit} onChange={onEdit}>
        {loading && <div className="content-busy-note">กำลังโหลดข้อมูลล่าสุด…</div>}
        {step === 'overview' ? (
          <OverviewTab c={c} showTab={requestStep} />
        ) : isProcess(step) ? (
          <ProcessShell
            process={info}
            state={processes[step]}
            caseId={c.id}
            reload={reload}
            actionsRef={panelActions}
            right={step === 'payment' ? <Badge kind={pay.kind}>{pay.label}</Badge> : null}
          >
            <ProcessPanel {...panelProps} />
          </ProcessShell>
        ) : <ExtraPanel {...panelProps} />}
      </div>

      {pending && (
        <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) setPending(null); }}>
          <div className="modal">
            <h3>มีข้อมูลที่ยังไม่ได้บันทึก</h3>
            <div className="m-body">
              <p>
                {`คุณกำลังกรอกข้อมูลในขั้น "${isProcess(step) ? processInfo(step).label : 'นี้'}" อยู่ ต้องการทำอะไรต่อ?`}
              </p>
            </div>
            <div className="m-foot">
              <button type="button" className="btn btn-light" onClick={() => setPending(null)}>อยู่หน้านี้ต่อ</button>
              <button
                type="button"
                className="btn btn-light"
                onClick={() => { const next = pending; setPending(null); go(next); }}
              >
                ออกโดยไม่บันทึก
              </button>
              <button type="button" className="btn" onClick={saveAndGo}>บันทึกและไปต่อ</button>
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
