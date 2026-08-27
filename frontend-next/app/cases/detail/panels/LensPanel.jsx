'use client';
import { useState } from 'react';
import { api } from '../../../../lib/apiClient.js';
import { readForm } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import {
  Badge, Card, Check, Field, FormActions, FormGrid, Row, Stack,
} from '../../../../components/ui.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { EmployeeSelect, Select, SupplierSelect } from '../../../../components/Selects.jsx';
import { dateOnly, fmtDate, fmtDateTime, todayISO } from '../../../../lib/format.js';
import { Icon } from '../../../../components/Icon.jsx';

const yn = (v) => (Number(v) ? <Icon name="check" /> : '—');

export function LensPanel({ c, reload, actorId }) {
  const { ok, err } = useToast();
  const j = c.lens_job;

  /* the supplier block only applies when the lenses are being ordered in */
  const [source, setSource] = useState(j?.source || 'stock');

  const saveJob = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/lens-jobs', {
        ...readForm(e.currentTarget),
        case_id: c.id,
        order_id: c.order?.id,
        recorded_by: actorId(),
      });
      ok('บันทึกงานเลนส์แล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const receive = async () => {
    try {
      await api.post(`/api/lens-jobs/${j.id}/receive`, { received_by: actorId() });
      ok('บันทึกรับเลนส์แล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const addFollowup = async (e) => {
    e.preventDefault();
    const body = readForm(e.currentTarget);
    delete body.previous_eta_display;
    try {
      await api.post(`/api/lens-jobs/${j.id}/followup`, body);
      ok('บันทึกการติดตามแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <Stack>
      <div className="card">
        <div className="card-head">
          <h2>งานเลนส์ — Lens Job</h2>
          {j ? (
            <Badge kind={j.status === 'ready' ? 'ok' : 'warn'}>
              {j.status === 'ready' ? 'พร้อมแล้ว' : 'รอเลนส์มา'}
            </Badge>
          ) : null}
        </div>

        <form className="card-body" onSubmit={saveJob}>
          <FormGrid>
            <Field label="แหล่งเลนส์ / Source">
              <Select
                name="source"
                options={[['stock', 'มีในสต็อก (หยิบได้เลย)'], ['order', 'ต้องสั่งซัพพลายเออร์']]}
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </Field>
            <Field label="ผู้หยิบ/ผู้ตรวจ">
              <EmployeeSelect name="picked_by" defaultValue={j?.picked_by || ''} />
            </Field>
            <Field label="ตรวจสอบ">
              <Row>
                <Check name="rx_checked" defaultChecked={!!Number(j?.rx_checked)}>ตรวจค่าสายตา</Check>
                <Check name="lens_checked" defaultChecked={!!Number(j?.lens_checked)}>ตรวจเลนส์</Check>
              </Row>
            </Field>
          </FormGrid>

          <div className="form-grid" style={{ display: source === 'order' ? '' : 'none' }}>
            <Field label="ซัพพลายเออร์">
              <SupplierSelect name="supplier_id" defaultValue={j?.supplier_id || ''} blank="— เลือก —" />
            </Field>
            <Field label="เลขที่ใบสั่ง">
              <input name="supplier_order_no" defaultValue={j?.supplier_order_no || ''} />
            </Field>
            <Field label="วันที่สั่ง">
              <input name="order_date" type="date" defaultValue={dateOnly(j?.order_date) || todayISO()} />
            </Field>
            <Field label="Lead time (วัน)">
              <input name="lead_time_days" type="number" min="0" defaultValue={j?.lead_time_days ?? 7} />
            </Field>
            <Field label="คาดว่าจะถึง (ETA)">
              <input name="expected_arrival" type="date" defaultValue={dateOnly(j?.expected_arrival)} />
            </Field>
          </div>

          <Field label="หมายเหตุ" className="full">
            <textarea name="notes" defaultValue={j?.notes || ''} />
          </Field>

          <FormActions>
            <button className="btn" type="submit">
            {j ? <><Icon name="save" /> บันทึกงานเลนส์</> : '+ สร้างงานเลนส์'}
          </button>
            {j && j.status !== 'ready' && (
              <button type="button" className="btn btn-ok" onClick={receive}><Icon name="box" /> เลนส์มาถึงแล้ว</button>
            )}
          </FormActions>
        </form>
      </div>

      {j && (
        <div className="card">
          <div className="card-head">
            <h2>ติดตามเลนส์ — Follow-up</h2>
            <Badge kind="gray">{`${j.follow_up_count || 0} ครั้ง`}</Badge>
          </div>

          <div className="card-body tight">
            <DataTable
              columns={[
                { label: '#', key: 'seq', cls: 'num' },
                { label: 'เมื่อ', render: (f) => fmtDateTime(f.contacted_at), cls: 'nowrap' },
                { label: 'โดย', key: 'contacted_by_name' },
                { label: 'ช่องทาง', key: 'channel' },
                { label: 'ETA เดิม', render: (f) => fmtDate(f.previous_eta), cls: 'nowrap' },
                { label: 'ETA ใหม่', render: (f) => fmtDate(f.new_eta), cls: 'nowrap' },
                { label: 'กระทบนัด', render: (f) => yn(f.affects_appointment) },
                { label: 'แจ้งลูกค้า', render: (f) => yn(f.customer_notified) },
                { label: 'บันทึก', render: (f) => f.supplier_reply || f.note || '' },
              ]}
              rows={j.followups || []}
              empty="ยังไม่มีการติดตาม"
            />
          </div>

          <form className="card-body" onSubmit={addFollowup}>
            <FormGrid>
              <Field label="ผู้ติดต่อ"><EmployeeSelect name="contacted_by" defaultValue="" /></Field>
              <Field label="ช่องทาง">
                <Select name="channel" options={['phone', 'line', 'email', 'walk-in']} defaultValue="phone" />
              </Field>
              <Field label="ETA เดิม">
                <input name="previous_eta_display" defaultValue={dateOnly(j.expected_arrival) || '-'} disabled />
              </Field>
              <Field label="ETA ใหม่"><input name="new_eta" type="date" /></Field>
              <Field label="วันนัดใหม่ (ถ้าต้องเลื่อน)">
                <input name="new_appointment_date" type="date" />
              </Field>
              <Field label="ผลกระทบ">
                <Row>
                  <Check name="affects_appointment">กระทบวันนัด</Check>
                  <Check name="customer_notified">แจ้งลูกค้าแล้ว</Check>
                </Row>
              </Field>
            </FormGrid>
            <Field label="คำตอบจากซัพพลายเออร์ / บันทึก" className="full">
              <textarea name="supplier_reply" />
            </Field>
            <FormActions>
              <button className="btn btn-light" type="submit">+ บันทึกการติดตาม</button>
            </FormActions>
          </form>
        </div>
      )}
    </Stack>
  );
}
