'use client';
/**
 * Opening a case — the first step of the shop's workflow.
 *
 * Three things get asked here that are deliberately NOT the same question:
 *
 *   ลูกค้าเก่า / ลูกค้าใหม่  whether this person already exists in the system.
 *                          Picks a customer, or creates one — never both.
 *   ประเภทงาน               what kind of job this case is (SIGHTFIRST, ตัดแว่นใหม่ …).
 *                          An existing customer can perfectly well open a
 *                          SIGHTFIRST case, so it is stored on the case.
 *   ผู้รับเรื่อง              which member of staff took the customer in.
 *
 * A new customer is created inline: the customer row is saved first, this page
 * keeps it selected, and the case is opened against it — no navigating away and
 * back, and no chance of a duplicate customer being created for one case.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../lib/apiClient.js';
import { useAsync, readForm } from '../../../lib/hooks.js';
import { useToast } from '../../../components/Toast.jsx';
import {
  Badge, Card, Check, Field, FormActions, FormGrid, Kv, Loading, PageHead, Row,
} from '../../../components/ui.jsx';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { Picker } from '../../../components/Picker.jsx';
import { EmployeeSelect, ListSelect, StatusSelect } from '../../../components/Selects.jsx';
import { NATIONALITIES } from '../../../lib/constants.js';
import { custName, fmtDate } from '../../../lib/format.js';
import { Icon } from '../../../components/Icon.jsx';

/** the new-customer half of step 1 — saves the customer, hands it back */
function NewCustomerForm({ onCreated }) {
  const { ok, err } = useToast();
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await api.post('/api/customers', readForm(e.currentTarget));
      ok(`บันทึกลูกค้า ${custName(saved)} แล้ว`);
      onCreated(saved);
    } catch (ex) { err(ex); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={save}>
      <FormGrid>
        <Field label="ชื่อ / First name"><input name="first_name" required /></Field>
        <Field label="นามสกุล / Last name"><input name="last_name" /></Field>
        <Field label="เบอร์โทร / Phone"><input name="phone" /></Field>
        <Field label="LINE ID"><input name="line_id" /></Field>
        <Field label="เพศ / Sex"><ListSelect name="sex" kind="sex" defaultValue="" blank="—" /></Field>
        <Field label="วันเกิด / Birth date"><input name="birth_date" type="date" /></Field>
        <Field label="สัญชาติ / Nationality"><input name="nationality" list="nat-list" /></Field>
        <Field label="อีเมล / Email"><input name="email" type="email" /></Field>
      </FormGrid>
      <datalist id="nat-list">
        {NATIONALITIES.map((n) => <option key={n} value={n} />)}
      </datalist>
      <FormActions>
        <button className="btn" type="submit" disabled={busy}><Icon name="check" /> บันทึกลูกค้าใหม่</button>
      </FormActions>
    </form>
  );
}

function CaseFormInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { ok, err } = useToast();
  const queryCustomer = params.get('customer');

  const { data: initial, loading } = useAsync(
    () => (queryCustomer ? api.get('/api/customers/' + queryCustomer) : Promise.resolve(null)),
    [queryCustomer],
  );

  /* 'existing' = pick someone already in the system, 'new' = create one here.
     It is also what gets recorded on the case as the customer's status at the
     moment it was opened. */
  const [mode, setMode] = useState(queryCustomer ? 'existing' : null);
  const [picked, setPicked] = useState(null);
  const [created, setCreated] = useState(null);
  const [channel, setChannel] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;

  const customer = created ?? picked ?? initial;
  const isNewCustomer = mode === 'new';

  const chooseMode = (next) => {
    if (next === mode) return;
    setMode(next);
    setPicked(null);
    setCreated(null);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!customer) return err('กรุณาเลือกหรือสร้างลูกค้าก่อน');
    setBusy(true);
    try {
      const body = readForm(e.currentTarget);
      const saved = await api.post('/api/cases', {
        ...body,
        customer_id: customer.id,
        is_new_customer: isNewCustomer ? 1 : 0,
        recorded_by: body.received_by || null,
        referral_note: body.referral_source === 'other' ? body.referral_note : '',
      });
      ok('เปิดเคส ' + saved.case_code + ' แล้ว');
      router.push('/cases/detail?id=' + saved.id + '&step=reception');
    } catch (ex) { err(ex); } finally { setBusy(false); }
    return undefined;
  };

  return (
    <>
      <PageHead icon="🗂" title="New Case" subtitle="เปิดเคสใหม่" />

      <Card title="1. ลูกค้ารายนี้เป็นใคร">
        <Row style={{ gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            className={`chip-btn ${mode === 'existing' ? 'active' : ''}`}
            onClick={() => chooseMode('existing')}
          >
            <Icon name="user" /> ลูกค้าเก่า — มีข้อมูลในระบบแล้ว
          </button>
          <button
            type="button"
            className={`chip-btn ${mode === 'new' ? 'active' : ''}`}
            onClick={() => chooseMode('new')}
          >
            <Icon name="sparkle" /> ลูกค้าใหม่ — ยังไม่เคยมีข้อมูล
          </button>
        </Row>

        {mode === null && <p className="muted">เลือกก่อนว่าเป็นลูกค้าเก่าหรือลูกค้าใหม่</p>}

        {mode === 'existing' && !created && (
          <Picker
            placeholder="ค้นหาลูกค้า (ชื่อ / นามสกุล / เบอร์โทร / รหัสลูกค้า)"
            fetcher={(q) => api.get('/api/customers', { q, limit: 40 })}
            label={custName}
            sub={(r) => [r.phone, r.line_id, '#' + r.id].filter(Boolean).join(' · ')}
            selectedId={customer?.id}
            onPick={setPicked}
          />
        )}

        {mode === 'new' && !created && <NewCustomerForm onCreated={setCreated} />}

        {customer && (
          <div className="ws-inset" style={{ marginTop: 12 }}>
            <Row style={{ marginBottom: 8 }}>
              <Badge kind={isNewCustomer ? 'blue' : 'gray'}>{isNewCustomer ? 'ลูกค้าใหม่' : 'ลูกค้าเก่า'}</Badge>
              <b>{custName(customer)}</b>
              <span className="muted">{`รหัสลูกค้า #${customer.id}`}</span>
              <Link className="btn btn-sm btn-light" href={'/customers/detail?id=' + customer.id}>ดูประวัติ</Link>
              {!created && (
                <button type="button" className="btn btn-sm btn-light" onClick={() => setPicked(null)}>
                  เลือกใหม่
                </button>
              )}
            </Row>
            <Kv
              rows={[
                ['เบอร์โทร', customer.phone || '—'],
                ['LINE', customer.line_id || '—'],
                ['วันเกิด', fmtDate(customer.birth_date) || '—'],
                ['อีเมล', customer.email || '—'],
                customer.notes ? ['หมายเหตุลูกค้า', customer.notes] : null,
              ].filter(Boolean)}
            />
          </div>
        )}
      </Card>

      <form onSubmit={save}>
        <Card title="2. ข้อมูลการเปิดเคส">
          <FormGrid>
            <Field label="พนักงานผู้รับเรื่อง" hint="ผู้รับลูกค้าในเคสนี้ ตรวจย้อนหลังได้จากไทม์ไลน์">
              <EmployeeSelect name="received_by" defaultValue="" />
            </Field>
            <Field label="ประเภทงาน / Case type" hint="เป็นข้อมูลของเคส ไม่ใช่ของลูกค้า">
              <ListSelect name="case_type" kind="case_type" defaultValue="" blank="— เลือกประเภทงาน —" />
            </Field>
            <Field label="รู้จักเราจากช่องทางไหน">
              <ListSelect
                name="referral_source"
                kind="referral_source"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                blank="— ไม่ระบุ —"
              />
            </Field>
            {channel === 'other' && (
              <Field label="ระบุช่องทาง">
                <input name="referral_note" placeholder="เช่น ป้ายหน้าห้าง, งานอีเวนต์" />
              </Field>
            )}
            <Field label="สถานะเริ่มต้น">
              <StatusSelect name="status" openOnly defaultValue="reception" />
            </Field>
            <Field label="ความเร่งด่วน">
              <Check name="is_rush"><Icon name="flame" /> งานด่วน</Check>
            </Field>
            <Field label="หมายเหตุความเร่งด่วน"><input name="priority_note" /></Field>
          </FormGrid>

          <Field label="หมายเหตุ / Note" className="full" hint="ความต้องการของลูกค้า อาการที่แจ้ง รายละเอียดนัดหมายหรือโครงการ ข้อมูลที่ต้องส่งต่อขั้นถัดไป">
            <textarea name="reception_note" rows={3} />
          </Field>

          <FormActions>
            <button className="btn btn-lg" type="submit" disabled={busy || !customer}><Icon name="check" /> เปิดเคส</button>
            <Link className="btn btn-light" href="/cases">ยกเลิก</Link>
            {!customer && <span className="muted">เลือกลูกค้าก่อนจึงจะเปิดเคสได้</span>}
          </FormActions>
        </Card>
      </form>
    </>
  );
}

export default function CaseFormPage() {
  return (
    <QueryParamPage>
      <CaseFormInner />
    </QueryParamPage>
  );
}
