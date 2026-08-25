'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../lib/apiClient.js';
import { useAsync, readForm } from '../../../lib/hooks.js';
import { useBookingLabels } from '../../../contexts/MetaContext.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { useConfirm } from '../../../components/Confirm.jsx';
import {
  Badge, Card, Field, FormActions, FormGrid, Kv, Loading, PageHead, Row, Split, Stack,
} from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { EmployeeSelect, Select } from '../../../components/Selects.jsx';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { BookingStatusBadge } from '../../../components/BookingStatusBadge.jsx';
import { BOOKING_STEPS, BOOKING_STEP_LABEL } from '../../../lib/constants.js';
import { bookingName, dateOnly, fmtDate, fmtDateTime, hhmm } from '../../../lib/format.js';

function BookingDetailInner() {
  const params = useSearchParams();
  const id = params.get('id');
  const router = useRouter();
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const { serviceLabel, channelLabel } = useBookingLabels();

  const { data: b, loading, error, reload } = useAsync(() => api.get('/api/bookings/' + id), [id]);
  const [actor, setActor] = useState(undefined);
  const [sending, setSending] = useState(false);

  if (loading) return <Loading />;
  if (error) return <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>;

  const actorValue = actor === undefined ? (b.assigned_to || '') : actor;
  const empId = () => Number(actorValue) || null;

  const setStatus = async (status, extra = {}) => {
    try {
      await api.post(`/api/bookings/${b.id}/status`, { status, employee_id: empId(), ...extra });
      ok('อัปเดตสถานะแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const openCase = async () => {
    const message = b.customer_id
      ? `เปิดเคสใหม่ให้ ${bookingName(b)}?`
      : `ระบบจะสร้างลูกค้าใหม่ "${bookingName(b)}" แล้วเปิดเคสให้`;
    if (!await confirm('เปิดเคส', message, { confirmText: 'เปิดเคส' })) return;
    try {
      const r = await api.post(`/api/bookings/${b.id}/open-case`, { received_by: empId() });
      ok('เปิดเคส ' + r.caseCode + ' แล้ว');
      router.push('/cases/detail?id=' + r.caseId);
    } catch (ex) { err(ex); }
  };

  const remind = async () => {
    setSending(true);
    try {
      await api.post(`/api/bookings/${b.id}/remind`);
      ok('ส่งแล้ว');
      reload();
    } catch (ex) {
      err(ex);
    } finally {
      setSending(false);
    }
  };

  const removeBooking = async () => {
    if (!await confirm('ลบการจอง', `ลบ ${b.booking_code} ถาวร?`, { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del('/api/bookings/' + b.id);
      ok('ลบแล้ว');
      router.push('/bookings');
    } catch (ex) { err(ex); }
  };

  const addNote = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await api.post(`/api/bookings/${b.id}/notes`, readForm(form));
      ok('บันทึกแล้ว');
      form.reset();
      reload();
    } catch (ex) { err(ex); }
  };

  const removeNote = async (n) => {
    try {
      await api.del(`/api/bookings/${b.id}/notes/${n.id}`);
      ok('ลบแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <div>
      <PageHead
        icon="📅"
        title={b.booking_code}
        subtitle={bookingName(b)}
        actions={(
          <>
            {b.case_id && <Link className="btn btn-ghost" href={'/cases/detail?id=' + b.case_id}>{'🗂 ' + b.case_code}</Link>}
            <Link className="btn btn-ghost" href={`/bookings/edit?id=${b.id}`}>✎ แก้ไข</Link>
            <Link className="btn btn-ghost" href={`/bookings?date=${dateOnly(b.booking_date)}`}>← ปฏิทิน</Link>
          </>
        )}
      />

      <Split>
        <Card title="ข้อมูลการจอง">
          <Row style={{ marginBottom: 12 }}>
            <BookingStatusBadge b={b} />
            {b.reminder_sent_at
              ? <Badge kind="ok">{'🔔 แจ้งเตือนแล้ว ' + fmtDateTime(b.reminder_sent_at)}</Badge>
              : <Badge kind="gray">{`🔔 จะแจ้งก่อน ${b.reminder_minutes} นาที`}</Badge>}
          </Row>

          <Kv rows={[
            ['วันเวลา', <b>{`${fmtDate(b.booking_date)} เวลา ${hhmm(b.booking_time)} น.`}</b>],
            ['ใช้เวลา', b.duration_min + ' นาที'],
            ['บริการ', serviceLabel(b.service_type)],
            ['ช่องทางจอง', channelLabel(b.channel)],
            ['ลูกค้า', b.customer_id
              ? <Link href={'/customers/detail?id=' + b.customer_id}>{bookingName(b)}</Link>
              : bookingName(b) + ' (ลูกค้าใหม่)'],
            ['เบอร์โทร', b.phone || '-'],
            ['LINE', b.line_id || '-'],
            ['ผู้ดูแล', b.assigned_name || '-'],
            ['ผู้รับจอง', b.created_by_name || '-'],
            ['ยืนยันเมื่อ', fmtDateTime(b.confirmed_at) || '-'],
            ['มาถึงเมื่อ', fmtDateTime(b.arrived_at) || '-'],
            b.cancelled_reason ? ['เหตุผล', b.cancelled_reason] : null,
            ['หมายเหตุ', b.notes || '-'],
          ]}
          />

          {b.intake_note && (
            <div style={{ marginTop: 12 }}>
              <label>บันทึกเบื้องต้น</label>
              <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{b.intake_note}</p>
            </div>
          )}
        </Card>

        <Stack>
          <Card title="การจัดการคิว">
            <FormGrid>
              <Field label="ผู้ทำรายการ">
                <EmployeeSelect value={actorValue} onChange={(e) => setActor(e.target.value)} />
              </Field>
            </FormGrid>

            <Row style={{ marginTop: 12 }}>
              {b.status === 'booked' && (
                <button type="button" className="btn btn-sm btn-accent" onClick={() => setStatus('confirmed')}>
                  ✔ ยืนยันคิว
                </button>
              )}
              {['booked', 'confirmed'].includes(b.status) && (
                <button type="button" className="btn btn-sm btn-ok" onClick={() => setStatus('arrived')}>
                  🚶 ลูกค้ามาถึง
                </button>
              )}
              {!b.case_id && ['arrived', 'confirmed', 'booked'].includes(b.status) && (
                <button type="button" className="btn btn-sm" onClick={openCase}>🗂 เปิดเคสให้ลูกค้า</button>
              )}
              {b.status !== 'done' && (
                <button type="button" className="btn btn-sm btn-light" onClick={() => setStatus('done')}>
                  ✅ เสร็จสิ้น
                </button>
              )}
              {!['cancelled', 'no_show', 'done'].includes(b.status) && (
                <button
                  type="button"
                  className="btn btn-sm btn-light"
                  onClick={async () => {
                    if (!await confirm('ไม่มาตามนัด', 'บันทึกว่าลูกค้าไม่มาตามนัด?', { confirmText: 'บันทึก' })) return;
                    setStatus('no_show');
                  }}
                >
                  👻 ไม่มาตามนัด
                </button>
              )}
              {b.status !== 'cancelled' && (
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={async () => {
                    if (!await confirm('ยกเลิกคิว', `ยกเลิกการจอง ${b.booking_code}?`,
                      { confirmText: 'ยกเลิกคิว', danger: true })) return;
                    setStatus('cancelled');
                  }}
                >
                  ✕ ยกเลิกคิว
                </button>
              )}
            </Row>

            <hr style={{ border: 0, borderTop: '1px solid var(--line-soft)', margin: '14px 0' }} />

            <Row>
              <button type="button" className="btn btn-sm btn-light" disabled={sending} onClick={remind}>
                🔔 ส่งแจ้งเตือน Telegram เดี๋ยวนี้
              </button>
              {!b.case_id && (
                <button type="button" className="btn btn-sm btn-light" onClick={removeBooking}>🗑 ลบการจอง</button>
              )}
            </Row>

            {b.notifications?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <label>ประวัติการแจ้งเตือน</label>
                <div className="stack" style={{ gap: 4, marginTop: 5 }}>
                  {b.notifications.map((n) => (
                    <div className="row" style={{ fontSize: 12.5 }} key={n.id}>
                      {Number(n.ok) ? <Badge kind="ok">✓</Badge> : <Badge kind="danger">✕</Badge>}
                      <span className="muted">{fmtDateTime(n.created_at)}</span>
                      <span className="muted">{n.kind}</span>
                      {n.error ? <span style={{ color: 'var(--danger)' }}>{n.error}</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </Stack>
      </Split>

      <div className="card">
        <div className="card-head">
          <h2>บันทึกเบื้องต้นทีละขั้นตอน</h2>
          <Badge kind="gray">{`${(b.step_notes || []).length} รายการ`}</Badge>
        </div>

        <div className="card-body tight">
          <DataTable
            columns={[
              { label: 'เมื่อ', render: (n) => fmtDateTime(n.created_at), cls: 'nowrap' },
              {
                label: 'ขั้นตอน',
                render: (n) => <Badge kind="blue">{BOOKING_STEP_LABEL[n.step] || n.step}</Badge>,
              },
              { label: 'หัวข้อ/คำถาม', key: 'question' },
              { label: 'บันทึก', key: 'note' },
              { label: 'ผู้บันทึก', key: 'recorded_by_name' },
              {
                label: '',
                cls: 'nowrap',
                render: (n) => (
                  <button type="button" className="btn btn-sm btn-light" onClick={() => removeNote(n)}>🗑</button>
                ),
              },
            ]}
            rows={b.step_notes || []}
            empty="ยังไม่มีบันทึก"
          />
        </div>

        <form className="card-body" onSubmit={addNote}>
          <FormGrid>
            <Field label="ขั้นตอน">
              <Select name="step" options={BOOKING_STEPS} defaultValue="intake" />
            </Field>
            <Field label="หัวข้อ / คำถาม">
              <input name="question" placeholder="เช่น อาการที่พบ" />
            </Field>
            <Field label="ผู้บันทึก">
              <EmployeeSelect name="recorded_by" defaultValue={b.assigned_to || ''} />
            </Field>
          </FormGrid>
          <Field label="บันทึก *" className="full">
            <textarea name="note" required placeholder="สิ่งที่ลูกค้าบอก / สิ่งที่ต้องเตรียม" />
          </Field>
          <FormActions>
            <button className="btn" type="submit">+ เพิ่มบันทึก</button>
          </FormActions>
        </form>
      </div>
    </div>
  );
}

export default function BookingDetailPage() {
  return (
    <QueryParamPage>
      <BookingDetailInner />
    </QueryParamPage>
  );
}
