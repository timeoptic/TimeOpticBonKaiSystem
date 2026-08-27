'use client';
import { api } from '../../../../lib/apiClient.js';
import { readForm } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import {
  Badge, Check, Field, FormActions, FormGrid, Row,
} from '../../../../components/ui.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { EmployeeSelect, Select } from '../../../../components/Selects.jsx';
import { fmtDateTime } from '../../../../lib/format.js';

const QC_CHECKS = [
  ['check_rx', 'ค่าสายตา'], ['check_centering', 'จุดศูนย์กลาง'],
  ['check_lens_od', 'เลนส์ OD'], ['check_lens_os', 'เลนส์ OS'],
  ['check_frame', 'กรอบ'], ['check_finish', 'ความเรียบร้อย'],
];

export function QcPanel({ c, reload }) {
  const { ok, err } = useToast();

  const saveQc = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/qc-checks', { ...readForm(e.currentTarget), case_id: c.id });
      ok('บันทึกผล QC แล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  return (
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
            <Select name="result" options={[['pass', 'ผ่าน'], ['fail', 'ไม่ผ่าน']]} defaultValue="pass" />
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
  );
}
