'use client';
import { api } from '../../../../lib/apiClient.js';
import { readForm } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import {
  Badge, Field, FormActions, FormGrid, Kv, Row, Stack,
} from '../../../../components/ui.jsx';
import { EmployeeSelect } from '../../../../components/Selects.jsx';
import { useMeta } from '../../../../contexts/MetaContext.jsx';
import { fmtDateTime, money, nowLocal, toStamp } from '../../../../lib/format.js';
import { Icon } from '../../../../components/Icon.jsx';

/** One readiness row — a green check or an amber warning, never a hard block. */
function Ready({ ok: passed, children }) {
  return (
    <Row style={{ gap: 8, alignItems: 'center' }}>
      <Badge kind={passed ? 'ok' : 'warn'}><Icon name={passed ? 'check' : 'warning'} /></Badge>
      <span className={passed ? '' : 'muted'}>{children}</span>
    </Row>
  );
}

export function DeliveryPanel({ c, reload, actorId }) {
  const { ok, err } = useToast();
  const { meta } = useMeta();
  const p = c.production || {};
  const qc = (c.qc_checks || [])[0];
  const empName = (id) => (meta.employees.find((e) => Number(e.id) === Number(id)) || {}).employee_name || '—';

  const delivered = !!p.pickup_at;

  const deliver = async (e) => {
    e.preventDefault();
    const body = readForm(e.currentTarget);
    body.pickup_at = toStamp(body.pickup_at);
    if (!body.handed_over_by) body.handed_over_by = actorId();
    try {
      await api.post(`/api/production-jobs/${p.id}/deliver`, body);
      ok('บันทึกการส่งมอบแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <Stack>
      <div className="card">
        <div className="card-head">
          <h2>ความพร้อมก่อนส่งมอบ</h2>
          <Badge kind={delivered ? 'ok' : 'gray'}>{delivered ? 'ส่งมอบแล้ว' : 'ยังไม่ส่งมอบ'}</Badge>
        </div>
        <div className="card-body">
          <Stack>
            <Ready ok={p.status === 'COMPLETED' || delivered}>งานผลิตเสร็จแล้ว</Ready>
            <Ready ok={qc?.result === 'pass'}>
              {qc ? (qc.result === 'pass' ? 'QC ผ่าน' : 'QC ไม่ผ่าน — ต้องแก้ไขก่อน') : 'ยังไม่ได้ตรวจ QC'}
            </Ready>
            <Ready ok={!!Number(p.pack_glasses)}>แพ็คสินค้าเรียบร้อย</Ready>
            <Ready ok={Number(c.balance) <= 0}>
              {Number(c.balance) <= 0 ? 'ชำระเงินครบแล้ว' : `ค้างชำระ ${money(c.balance)}`}
            </Ready>
            <Ready ok={(c.notifications || []).length > 0}>แจ้งลูกค้าให้มารับแล้ว</Ready>
          </Stack>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>ส่งมอบ — Delivery</h2></div>
        {delivered ? (
          <div className="card-body">
            <Kv
              rows={[
                ['ส่งมอบเมื่อ', fmtDateTime(p.pickup_at)],
                ['ผู้รับสินค้า', p.received_by_customer_name || '—'],
                ['ผู้ส่งมอบ', empName(p.handed_over_by)],
              ]}
            />
          </div>
        ) : !p.id ? (
          <div className="card-body">
            <p className="hint">ยังไม่มีงานผลิต — เริ่มผลิตที่แท็บ “ผลิต” ก่อนจึงจะบันทึกการส่งมอบได้</p>
          </div>
        ) : (
          <form className="card-body" onSubmit={deliver}>
            <FormGrid>
              <Field label="ผู้มารับสินค้า" hint="ชื่อคนที่มารับจริง (ลูกค้าหรือผู้รับแทน)">
                <input name="received_by_customer_name" required />
              </Field>
              <Field label="ผู้ส่งมอบ">
                <EmployeeSelect name="handed_over_by" defaultValue={actorId() || ''} />
              </Field>
              <Field label="ส่งมอบเมื่อ">
                <input name="pickup_at" type="datetime-local" defaultValue={nowLocal()} />
              </Field>
            </FormGrid>
            <FormActions>
              <button className="btn" type="submit"><Icon name="box" /> บันทึกการส่งมอบ</button>
            </FormActions>
          </form>
        )}
      </div>
    </Stack>
  );
}
