'use client';
import { api } from '../../../../lib/apiClient.js';
import { readForm } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import { useConfirm } from '../../../../components/Confirm.jsx';
import { Badge, Field, FormActions, FormGrid } from '../../../../components/ui.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { EmployeeSelect, ListSelect, Select } from '../../../../components/Selects.jsx';
import { fmtDateTime, money, nowLocal, toStamp } from '../../../../lib/format.js';
import { Icon } from '../../../../components/Icon.jsx';

const KINDS = [
  ['deposit', 'มัดจำ'], ['partial', 'จ่ายบางส่วน'],
  ['final', 'ชำระส่วนที่เหลือ'], ['full', 'ชำระเต็ม'],
];

export function PaymentPanel({ c, reload }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();

  const add = async (e) => {
    e.preventDefault();
    const body = readForm(e.currentTarget);
    body.paid_at = toStamp(body.paid_at);
    try {
      await api.post('/api/payments', { ...body, case_id: c.id, order_id: c.order?.id });
      ok('บันทึกการรับเงินแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const remove = async (p) => {
    if (!await confirm('ลบรายการรับเงิน', `ลบ ${money(p.amount)} (${p.kind})?`,
      { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del('/api/payments/' + p.id);
      ok('ลบแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const payments = c.payments || [];

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <h2>ประวัติการรับเงิน</h2>
          <Badge kind="ok">{'รับแล้ว ' + money(c.paid)}</Badge>
        </div>

        <div className="card-body tight">
          <DataTable
            columns={[
              { label: 'เมื่อ', render: (p) => fmtDateTime(p.paid_at), cls: 'nowrap' },
              { label: 'ประเภท', key: 'kind' },
              { label: 'วิธี', key: 'method' },
              { label: 'จำนวน', render: (p) => money(p.amount), cls: 'num' },
              { label: 'อ้างอิง', key: 'reference' },
              { label: 'ผู้รับ', key: 'received_by_name' },
              { label: 'หมายเหตุ', key: 'notes' },
              {
                label: '',
                cls: 'nowrap',
                render: (p) => (
                  <button type="button" className="btn btn-sm btn-light" onClick={() => remove(p)}><Icon name="trash" /></button>
                ),
              },
            ]}
            rows={payments}
            empty="ยังไม่มีการรับเงิน"
            footer={payments.length ? (
              <tr>
                <td colSpan={3}>รวม</td>
                <td className="num">{money(c.paid)}</td>
                <td colSpan={4} />
              </tr>
            ) : null}
          />
        </div>

        <form className="card-body" onSubmit={add}>
          <FormGrid>
            <Field label="ประเภท">
              <Select name="kind" options={KINDS} defaultValue={Number(c.paid) > 0 ? 'final' : 'deposit'} />
            </Field>
            <Field label="จำนวนเงิน">
              <input
                name="amount"
                type="number"
                step="1"
                min="1"
                required
                defaultValue={Number(c.balance) > 0 ? c.balance : ''}
              />
            </Field>
            <Field label="วิธีชำระ"><ListSelect name="method" kind="pay_type" defaultValue="Cash" /></Field>
            <Field label="อ้างอิง (เลขที่โอน)"><input name="reference" /></Field>
            <Field label="ผู้รับเงิน"><EmployeeSelect name="received_by" defaultValue="" /></Field>
            <Field label="เมื่อ">
              <input name="paid_at" type="datetime-local" defaultValue={nowLocal()} />
            </Field>
          </FormGrid>
          <FormActions>
            <button className="btn" type="submit">+ บันทึกการรับเงิน</button>
          </FormActions>
        </form>
      </div>
    </div>
  );
}
