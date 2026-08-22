/**
 * Income and expense share one screen shape: an entry form on top, a filtered
 * history below. Only the endpoint, the type column, and whether a payment
 * method is recorded differ.
 */
import { useState } from 'react';
import { api } from '../../api/client.js';
import { useAsync, useDebounced, onSubmit } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/Confirm.jsx';
import { Card, Field, FormActions, FormGrid, Loading, PageHead, Toolbar } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { ListSelect } from '../../components/Selects.jsx';
import { fmtDate, money, todayISO } from '../../lib/format.js';

function Ledger({ title, subtitle, icon, endpoint, typeKey, typeList, withPayType }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();

  const [term, setTerm] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useDebounced(term);

  const { data, loading, error, reload } = useAsync(
    () => api.get(endpoint, { q: q.trim(), from, to, limit: 500 }),
    [q, from, to]
  );

  const add = async (body, form) => {
    try {
      await api.post(endpoint, body);
      ok('บันทึกแล้ว');
      form.reset();
      reload();
    } catch (ex) { err(ex); }
  };

  const remove = async (r) => {
    if (!await confirm('ลบรายการ', `ลบรายการ #${r.id} (${money(r.amount)})?`,
      { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del(`${endpoint}/${r.id}`);
      ok('ลบแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const thisMonth = () => {
    const d = new Date();
    setFrom(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
    setTo(todayISO());
  };

  const columns = [
    { label: 'ID', key: 'id', cls: 'mono' },
    { label: 'วันที่', render: (r) => fmtDate(r.cf_date), cls: 'nowrap' },
    { label: 'ประเภท', key: typeKey },
    { label: 'สาขา', key: 'branch' },
    { label: 'จำนวนเงิน', render: (r) => money(r.amount), cls: 'num' },
    ...(withPayType ? [{ label: 'ชำระ', key: 'pay_type' }] : []),
    { label: 'หมายเหตุ', key: 'notes' },
    {
      label: '',
      cls: 'nowrap',
      render: (r) => (
        <button type="button" className="btn btn-sm btn-light" onClick={() => remove(r)}>🗑</button>
      ),
    },
  ];

  return (
    <div>
      <PageHead icon={icon} title={title} subtitle={subtitle} />

      <div className="card">
        <div className="card-head"><h2>บันทึกรายการใหม่</h2></div>
        <form className="card-body" onSubmit={onSubmit(add)}>
          <FormGrid>
            <Field label="วันที่ / CFDate">
              <input name="cf_date" type="date" defaultValue={todayISO()} required />
            </Field>
            <Field label={typeKey === 'income_type' ? 'ประเภทรายรับ / IncomeType' : 'ประเภทรายจ่าย / ExpenseType'}>
              <ListSelect name={typeKey} kind={typeList} defaultValue="" />
            </Field>
            <Field label="สาขา / Branch">
              <ListSelect name="branch" kind="branch" defaultValue="Timeoptic" />
            </Field>
            <Field label="จำนวนเงิน / Amount">
              <input name="amount" type="number" step="1" min="0" defaultValue={0} required />
            </Field>
            {withPayType && (
              <Field label="ชำระด้วย / PayType">
                <ListSelect name="pay_type" kind="pay_type" defaultValue="Cash" />
              </Field>
            )}
            <Field label="หมายเหตุ / Notes" className="full">
              <textarea name="notes" />
            </Field>
          </FormGrid>
          <FormActions>
            <button className="btn btn-lg" type="submit">✔ Enter — บันทึก</button>
          </FormActions>
        </form>
      </div>

      <Toolbar>
        <Field label="ค้นหา" className="grow">
          <input
            type="search"
            placeholder="ประเภท / สาขา / หมายเหตุ"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </Field>
        <Field label="ตั้งแต่วันที่">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="ถึงวันที่">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <button type="button" className="btn btn-light" onClick={thisMonth}>เดือนนี้</button>
      </Toolbar>

      {loading && <Loading />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (
        <Card tight>
          <DataTable
            columns={columns}
            rows={data.rows}
            empty="ไม่พบรายการ"
            footer={data.rows.length ? (
              <tr>
                <td colSpan={4}>{`รวม ${data.rows.length} รายการ`}</td>
                <td className="num">{money(data.total)}</td>
                <td colSpan={withPayType ? 3 : 2} />
              </tr>
            ) : null}
          />
        </Card>
      )}
    </div>
  );
}

export const IncomeView = () => (
  <Ledger
    title="Menu Income" subtitle="รายรับ" icon="💰"
    endpoint="/api/income" typeKey="income_type" typeList="income_type" withPayType={false}
  />
);

export const ExpenseView = () => (
  <Ledger
    title="Expense" subtitle="รายจ่าย" icon="💸"
    endpoint="/api/expense" typeKey="expense_type" typeList="expense_type" withPayType
  />
);
