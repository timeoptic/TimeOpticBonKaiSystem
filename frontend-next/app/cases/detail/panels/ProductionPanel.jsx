'use client';
import { api } from '../../../../lib/apiClient.js';
import { readForm } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import {
  Check, Field, FormActions, FormGrid, Row, Stack,
} from '../../../../components/ui.jsx';
import { EmployeeSelect } from '../../../../components/Selects.jsx';
import { dtLocal } from '../../../../lib/format.js';

const PACK_ITEMS = [
  ['pack_glasses', 'แว่น'], ['pack_case', 'กล่อง'], ['pack_cloth', 'ผ้าเช็ด'],
  ['pack_warranty', 'ใบรับประกัน'], ['pack_prescription', 'ใบค่าสายตา'],
  ['pack_accessories', 'อุปกรณ์เสริม'],
];

export function ProductionPanel({ c, reload, actorId }) {
  const { ok, err } = useToast();
  const p = c.production || {};
  const ff = c.frame_fitting || {};

  const post = (endpoint, extra) => async (e) => {
    e.preventDefault();
    try {
      await api.post(endpoint, { ...readForm(e.currentTarget), case_id: c.id, order_id: c.order?.id, ...extra });
      ok('บันทึกแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const text = (name, label, source) => (
    <Field label={label}><input name={name} defaultValue={source[name] || ''} /></Field>
  );

  return (
    <Stack>
      <div className="card">
        <div className="card-head"><h2>วัดกรอบ — Frame Fitting</h2></div>
        <form
          className="card-body"
          onSubmit={post('/api/frame-fittings', { recorded_by: actorId() })}
        >
          <FormGrid>
            {text('frame_size', 'Frame size', ff)}
            {text('lens_width', 'Lens width', ff)}
            {text('bridge_width', 'Bridge', ff)}
            {text('temple_length', 'Temple', ff)}
            {text('ed', 'ED', ff)}
            {text('dbl', 'DBL', ff)}
            <Field label="ผู้วัด">
              <EmployeeSelect name="performed_by" defaultValue={ff.performed_by || ''} />
            </Field>
          </FormGrid>
          <FormActions>
            <button className="btn btn-light" type="submit">💾 บันทึกการวัดกรอบ</button>
          </FormActions>
        </form>
      </div>

      <div className="card">
        <div className="card-head"><h2>งานผลิต — Production</h2></div>
        <form
          className="card-body"
          onSubmit={post('/api/production-jobs', { employee_id: actorId() })}
        >
          <FormGrid>
            <Field label="ช่างที่รับงาน">
              <EmployeeSelect name="assigned_technician" defaultValue={p.assigned_technician || ''} />
            </Field>
            <Field label="เริ่มฝน">
              <input name="edging_started_at" type="datetime-local" defaultValue={dtLocal(p.edging_started_at)} />
            </Field>
            <Field label="ฝนเสร็จ">
              <input name="edging_finished_at" type="datetime-local" defaultValue={dtLocal(p.edging_finished_at)} />
            </Field>
            <Field label="ผู้ฝน"><EmployeeSelect name="edged_by" defaultValue={p.edged_by || ''} /></Field>
            <Field label="ตรวจจับคู่">
              <Row>
                <Check name="match_customer_ok" defaultChecked={!!Number(p.match_customer_ok)}>ตรงลูกค้า</Check>
                <Check name="match_rx_ok" defaultChecked={!!Number(p.match_rx_ok)}>ตรงค่าสายตา</Check>
              </Row>
            </Field>
            <Field label="Checklist การแพ็ค" className="full">
              <Row>
                {PACK_ITEMS.map(([k, label]) => (
                  <Check key={k} name={k} defaultChecked={!!Number(p[k])}>{label}</Check>
                ))}
              </Row>
            </Field>
            <Field label="ผู้แพ็ค"><EmployeeSelect name="packed_by" defaultValue={p.packed_by || ''} /></Field>
            <Field label="ผู้ตรวจการแพ็ค">
              <EmployeeSelect name="pack_checked_by" defaultValue={p.pack_checked_by || ''} />
            </Field>
          </FormGrid>
          <Field label="บันทึกการผลิต" className="full">
            <textarea name="edging_remark" defaultValue={p.edging_remark || ''} />
          </Field>
          <FormActions>
            <button className="btn btn-light" type="submit">💾 บันทึกงานผลิต</button>
          </FormActions>
        </form>
      </div>
    </Stack>
  );
}
