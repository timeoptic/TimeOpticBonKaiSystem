'use client';
/**
 * Process 5 — ชำระเงิน.
 *
 * Every payment can carry its slip: the transfer screenshot or the receipt photo
 * that proves it happened. The file is attached to the payment row it belongs to
 * (case_photos.payment_id), not just to the case, so a row and its evidence
 * cannot drift apart — and a payment recorded without one says so plainly.
 */
import { useRef, useState } from 'react';
import { api } from '../../../../lib/apiClient.js';
import { useAsync, readForm } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import { useConfirm } from '../../../../components/Confirm.jsx';
import { Badge, Field, FormActions, FormGrid, Row } from '../../../../components/ui.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { EmployeeSelect, ListSelect, Select } from '../../../../components/Selects.jsx';
import { Icon } from '../../../../components/Icon.jsx';
import { fmtDateTime, money, nowLocal, toStamp } from '../../../../lib/format.js';

const KINDS = [
  ['deposit', 'มัดจำ'], ['partial', 'จ่ายบางส่วน'],
  ['final', 'ชำระส่วนที่เหลือ'], ['full', 'ชำระเต็ม'],
];

const SLIP_KIND = 'payment_slip';
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export function PaymentPanel({ c, reload }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const slipRef = useRef(null);
  const rowSlipRef = useRef(null);
  const [slips, setSlips] = useState([]);          // files chosen for the new payment
  const [attachTo, setAttachTo] = useState(null);  // payment a slip is being added to

  /* every file on the case; the ones with a payment_id are the slips */
  const { data: files, reload: reloadFiles } = useAsync(
    () => api.get('/api/uploads', { case_id: c.id }),
    [c.id],
  );
  const slipsOf = (paymentId) =>
    (files || []).filter((f) => Number(f.payment_id) === Number(paymentId));

  const sendSlip = async (file, paymentId) => {
    const form = new FormData();
    form.append('file', file);
    form.append('case_id', c.id);
    form.append('payment_id', paymentId);
    form.append('kind', SLIP_KIND);
    await api.upload('/api/uploads', form);
  };

  const add = async (e) => {
    e.preventDefault();
    const body = readForm(e.currentTarget);
    body.paid_at = toStamp(body.paid_at);
    try {
      const saved = await api.post('/api/payments', { ...body, case_id: c.id, order_id: c.order?.id });
      for (const file of slips) await sendSlip(file, saved.id);
      setSlips([]);
      if (slipRef.current) slipRef.current.value = '';
      ok(slips.length ? `บันทึกการรับเงินและแนบสลิป ${slips.length} ไฟล์แล้ว` : 'บันทึกการรับเงินแล้ว');
      reload();
      reloadFiles();
    } catch (ex) { err(ex); }
  };

  /* adding a slip to a payment that was recorded earlier */
  const attachToRow = (p) => { setAttachTo(p.id); rowSlipRef.current?.click(); };
  const onRowSlip = async (e) => {
    const chosen = Array.from(e.target.files || []);
    e.target.value = '';
    if (!chosen.length || !attachTo) return;
    try {
      for (const file of chosen) await sendSlip(file, attachTo);
      ok('แนบสลิปแล้ว');
      reloadFiles();
    } catch (ex) { err(ex); } finally { setAttachTo(null); }
  };

  const removeSlip = async (f) => {
    if (!await confirm('ลบสลิป', f.original_name || '', { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del('/api/uploads/' + f.id);
      ok('ลบสลิปแล้ว');
      reloadFiles();
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
      <input
        ref={rowSlipRef}
        type="file"
        accept={ACCEPT}
        multiple
        style={{ display: 'none' }}
        onChange={onRowSlip}
      />

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
              {
                label: 'สลิป',
                cls: 'nowrap',
                render: (p) => {
                  const rows = slipsOf(p.id);
                  return (
                    <Row style={{ gap: 6 }}>
                      {rows.map((f) => (
                        <span className="slip-chip" key={f.id}>
                          <a href={api.url('/api/uploads/' + f.id)} target="_blank" rel="noreferrer">
                            {f.mime_type === 'application/pdf'
                              ? <Icon name="file" />
                              : <img src={api.url('/api/uploads/' + f.id)} alt={f.original_name || 'สลิป'} />}
                          </a>
                          <button type="button" onClick={() => removeSlip(f)} title="ลบสลิป">
                            <Icon name="x" />
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        className="btn btn-sm btn-light"
                        onClick={() => attachToRow(p)}
                        title="แนบสลิปเพิ่ม"
                      >
                        <Icon name="camera" />
                      </button>
                    </Row>
                  );
                },
              },
              { label: 'หมายเหตุ', key: 'notes' },
              {
                label: '',
                cls: 'nowrap',
                render: (p) => (
                  <button type="button" className="btn btn-sm btn-light" onClick={() => remove(p)}>
                    <Icon name="trash" />
                  </button>
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

          <Field label="สลิป / หลักฐานการโอน" hint="แนบได้หลายไฟล์ · รูปหรือ PDF — จะถูกผูกกับรายการรับเงินนี้">
            <input
              ref={slipRef}
              type="file"
              accept={ACCEPT}
              multiple
              onChange={(e) => setSlips(Array.from(e.target.files || []))}
            />
          </Field>
          {slips.length > 0 && (
            <Row style={{ marginTop: 6 }}>
              <Badge kind="blue">{`เลือกไว้ ${slips.length} ไฟล์`}</Badge>
              <span className="muted">{slips.map((f) => f.name).join(', ')}</span>
            </Row>
          )}

          <FormActions>
            <button className="btn" type="submit">+ บันทึกการรับเงิน</button>
          </FormActions>
        </form>
      </div>
    </div>
  );
}
