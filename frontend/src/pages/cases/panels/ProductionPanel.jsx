import { api } from '../../../api/client.js';
import { readForm } from '../../../lib/hooks.js';
import { useToast } from '../../../components/Toast.jsx';
import {
  Badge, Card, Check, Field, FormActions, FormGrid, Row, Split, Stack,
} from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { EmployeeSelect, Select } from '../../../components/Selects.jsx';
import { dtLocal, fmtDateTime } from '../../../lib/format.js';

const PACK_ITEMS = [
  ['pack_glasses', 'แว่น'], ['pack_case', 'กล่อง'], ['pack_cloth', 'ผ้าเช็ด'],
  ['pack_warranty', 'ใบรับประกัน'], ['pack_prescription', 'ใบค่าสายตา'],
  ['pack_accessories', 'อุปกรณ์เสริม'],
];

const QC_CHECKS = [
  ['check_rx', 'ค่าสายตา'], ['check_centering', 'จุดศูนย์กลาง'], ['check_lens', 'เลนส์'],
  ['check_frame', 'กรอบ'], ['check_finish', 'ความเรียบร้อย'],
];

export function ProductionPanel({ c, reload, actorId }) {
  const { ok, err } = useToast();
  const p = c.production || {};
  const ff = c.frame_fitting || {};
  const ce = c.centering || {};

  const post = (endpoint, extra) => async (e) => {
    e.preventDefault();
    try {
      await api.post(endpoint, { ...readForm(e.currentTarget), case_id: c.id, order_id: c.order?.id, ...extra });
      ok('บันทึกแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const saveQc = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/qc-checks', { ...readForm(e.currentTarget), case_id: c.id });
      ok('บันทึกผล QC แล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const text = (name, label, source) => (
    <Field label={label}><input name={name} defaultValue={source[name] || ''} /></Field>
  );

  return (
    <Stack>
      <Split>
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
          <div className="card-head"><h2>จุดศูนย์กลาง — Centering</h2></div>
          <form
            className="card-body"
            onSubmit={post('/api/centerings', { recorded_by: actorId() })}
          >
            <FormGrid>
              {text('r_pd', 'R PD', ce)}
              {text('l_pd', 'L PD', ce)}
              {text('pd_total', 'PD รวม', ce)}
              {text('r_height', 'R Height', ce)}
              {text('l_height', 'L Height', ce)}
              {text('vertex_distance', 'Vertex', ce)}
              {text('pantoscopic_tilt', 'Pantoscopic tilt', ce)}
              {text('wrap_angle', 'Wrap angle', ce)}
              <Field label="ผู้วัด">
                <EmployeeSelect name="performed_by" defaultValue={ce.performed_by || ''} />
              </Field>
            </FormGrid>
            <FormActions>
              <button className="btn btn-light" type="submit">💾 บันทึกจุดศูนย์กลาง</button>
            </FormActions>
          </form>
        </div>
      </Split>

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

      <div className="card">
        <div className="card-head">
          <h2>QC</h2>
          <Badge kind="gray">{`${(c.qc_checks || []).length} รอบ`}</Badge>
        </div>

        <div className="card-body tight">
          <DataTable
            columns={[
              { label: 'รอบ', key: 'attempt', cls: 'num' },
              {
                label: 'ผล',
                render: (r) => (
                  <Badge kind={r.result === 'pass' ? 'ok' : 'danger'}>
                    {r.result === 'pass' ? 'ผ่าน' : 'ไม่ผ่าน'}
                  </Badge>
                ),
              },
              { label: 'เมื่อ', render: (r) => fmtDateTime(r.checked_at), cls: 'nowrap' },
              { label: 'ผู้ตรวจ', key: 'checked_by_name' },
              { label: 'ข้อบกพร่อง', key: 'defects' },
              { label: 'แก้ไข', key: 'action_taken' },
            ]}
            rows={c.qc_checks || []}
            empty="ยังไม่มีการตรวจ QC"
          />
        </div>

        <form className="card-body" onSubmit={saveQc}>
          <FormGrid>
            <Field label="ผลตรวจ">
              <Select name="result" options={[['pass', '✅ ผ่าน'], ['fail', '❌ ไม่ผ่าน']]} defaultValue="pass" />
            </Field>
            <Field label="ผู้ตรวจ"><EmployeeSelect name="checked_by" defaultValue="" /></Field>
            <Field label="การแก้ไขที่ทำ">
              <input name="action_taken" placeholder="เช่น ฝนใหม่, สั่งเลนส์ใหม่" />
            </Field>
            <Field label="รายการตรวจ" className="full">
              <Row>
                {QC_CHECKS.map(([k, label]) => <Check key={k} name={k}>{label}</Check>)}
              </Row>
            </Field>
          </FormGrid>
          <Field label="ข้อบกพร่องที่พบ" className="full">
            <textarea name="defects" />
          </Field>
          <FormActions>
            <button className="btn" type="submit">+ บันทึกผล QC</button>
          </FormActions>
        </form>
      </div>
    </Stack>
  );
}
