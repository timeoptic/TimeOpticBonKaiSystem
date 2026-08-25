'use client';
import { api } from '../../../../lib/apiClient.js';
import { readForm } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import { Field, FormActions, FormGrid } from '../../../../components/ui.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { EmployeeSelect, Select } from '../../../../components/Selects.jsx';
import { fmtDateTime } from '../../../../lib/format.js';

const RESULTS = [
  ['reached', 'ติดต่อได้'], ['no_answer', 'ไม่รับสาย'],
  ['left_message', 'ฝากข้อความ'], ['wrong_number', 'เบอร์ผิด'],
];

export function NotifyPanel({ c, reload }) {
  const { ok, err } = useToast();

  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/api/cases/${c.id}/notify`, readForm(e.currentTarget));
      ok('บันทึกแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>ประวัติการติดต่อลูกค้า</h2>
        {c.phone ? <a className="btn btn-sm btn-light" href={'tel:' + c.phone}>{'☎ ' + c.phone}</a> : null}
      </div>

      <div className="card-body tight">
        <DataTable
          columns={[
            { label: 'เมื่อ', render: (n) => fmtDateTime(n.contacted_at), cls: 'nowrap' },
            { label: 'ช่องทาง', key: 'channel' },
            { label: 'ผล', key: 'result' },
            { label: 'โดย', key: 'contacted_by_name' },
            { label: 'บันทึก', key: 'note' },
          ]}
          rows={c.notifications || []}
          empty="ยังไม่เคยติดต่อ"
        />
      </div>

      <form className="card-body" onSubmit={add}>
        <FormGrid>
          <Field label="ช่องทาง">
            <Select name="channel" options={['phone', 'line', 'sms', 'email', 'walk-in']} defaultValue="phone" />
          </Field>
          <Field label="ผลการติดต่อ">
            <Select name="result" options={RESULTS} defaultValue="reached" />
          </Field>
          <Field label="ผู้ติดต่อ"><EmployeeSelect name="contacted_by" defaultValue="" /></Field>
        </FormGrid>
        <Field label="บันทึก" className="full"><textarea name="note" /></Field>
        <FormActions>
          <button className="btn" type="submit">+ บันทึกการติดต่อ</button>
        </FormActions>
      </form>
    </div>
  );
}
