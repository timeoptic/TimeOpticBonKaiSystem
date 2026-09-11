'use client';
/**
 * Opening a case — the first step of the shop's workflow.
 *
 * Four things get asked here that are deliberately NOT the same question:
 *
 *   ลูกค้าเก่า / ลูกค้าใหม่  whether this person already exists in the system.
 *                          Picks a customer, or creates one — never both.
 *   ประเภทงาน               what kind of job this case is — ตัดแว่นใหม่ / เปลี่ยนเลนส์ /
 *                          ซ่อม / ตรวจสายตา. About the work, not the person.
 *   ประเภทลูกค้า             which book of work this belongs to: Sight First or the
 *                          shop's own customers. This is what splits the board.
 *   รู้จักเราจากช่องทางไหน   how they found the shop. One pick, no follow-up box:
 *                          เลือก "อื่นๆ" แล้วจบ ไม่ต้องอธิบายต่อ
 *
 * ประเภทงาน กับ ประเภทลูกค้า เคยเป็นช่องเดียวกัน ซึ่งแปลว่าเคส SIGHTFIRST หนึ่งใบ
 * บอกไม่ได้เลยว่าเป็นงานตัดแว่นใหม่หรือเปลี่ยนเลนส์ เพราะช่องถูกใช้ไปตอบอีกคำถามแล้ว
 *
 * A new customer is created inline: the customer row is saved first, this page
 * keeps it selected, and the case is opened against it — no navigating away and
 * back, and no chance of a duplicate customer being created for one case.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../../lib/apiClient.js';
import { useAsync, readForm } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import {
  Badge, Card, Field, FormActions, FormGrid, Kv, Loading, PageHead, Row,
} from '../../../../components/ui.jsx';
import { QueryParamPage } from '../../../../components/QueryParamPage.jsx';
import { Picker } from '../../../../components/Picker.jsx';
import { EmployeeSelect, ListSelect, NationalitySelect } from '../../../../components/Selects.jsx';
import { custName, fmtDate } from '../../../../lib/format.js';
import { Icon } from '../../../../components/Icon.jsx';
import { DateField } from '../../../../components/DateField.jsx';

/** ลูกค้าที่ระบบสงสัยว่าเป็นคนเดียวกัน — เลือกใช้ใบเดิม หรือยืนยันว่าคนละคน */
function DuplicateWarning({ matches, onUse, onForce, onEdit, busy }) {
  return (
    <Card>
      <div className="dup-warn">
        <p className="dup-head">
          <Icon name="warning" />
          {` มี ${matches.length} รายชื่อในระบบที่อาจเป็นคนเดียวกัน — เช็คก่อนสร้างใบใหม่`}
        </p>
        <ul className="dup-list">
          {matches.map((m) => (
            <li key={m.id}>
              <div className="dup-who">
                <b>{custName(m)}</b>
                <span className="muted">{[m.phone, m.line_id, m.email].filter(Boolean).join(' · ') || 'ไม่มีเบอร์/LINE'}</span>
                <span className="dup-why">
                  {m.why.map((w) => (
                    <Badge key={w} kind={m.strong ? 'danger' : 'warn'}>{w}</Badge>
                  ))}
                </span>
              </div>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onUse(m)}>
                <Icon name="check" /> ใช้ลูกค้ารายนี้
              </button>
            </li>
          ))}
        </ul>
        <Row style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-light" disabled={busy} onClick={onEdit}>
            <Icon name="pencil" /> กลับไปแก้ข้อมูล
          </button>
          <button type="button" className="btn btn-light" disabled={busy} onClick={onForce}>
            ยืนยันว่าเป็นคนละคน — สร้างใบใหม่
          </button>
        </Row>
      </div>
    </Card>
  );
}

/**
 * the new-customer half of step 1 — saves the customer, hands it back
 *
 * ก่อนจะสร้างใบใหม่ต้องถามระบบก่อนว่าคนนี้มีอยู่แล้วหรือยัง เพราะกรณีที่เกิดจริง
 * คือเซลล์ค้นหาไม่เจอ (พิมพ์ชื่อผิด เบอร์ใส่ขีดไม่เหมือนเดิม) แล้วกดสร้างใหม่
 * — ลูกค้าคนเดียวเลยมีสองใบ ประวัติค่าสายตาแยกกันคนละใบ ตามกลับมารวมทีหลังยาก
 *
 * เตือนแล้วให้คนตัดสินใจ ไม่ได้ห้าม — ชื่อซ้ำกันจริง ๆ ก็มี ปุ่ม "ใช้ลูกค้ารายนี้"
 * คือทางลัดที่อยากให้กดมากที่สุด แต่ "เป็นคนละคน" ต้องกดได้เสมอ
 */
function NewCustomerForm({ onCreated }) {
  const { ok, err } = useToast();
  const [busy, setBusy] = useState(false);
  const [dupes, setDupes] = useState(null);   // { matches, values } ระหว่างรอคนตัดสินใจ

  const create = async (values) => {
    setBusy(true);
    try {
      const saved = await api.post('/api/customers', values);
      ok(`บันทึกลูกค้า ${custName(saved)} แล้ว`);
      setDupes(null);
      onCreated(saved);
    } catch (ex) { err(ex); } finally { setBusy(false); }
  };

  const save = async (e) => {
    e.preventDefault();
    const values = readForm(e.currentTarget);
    setBusy(true);
    try {
      const { matches } = await api.post('/api/customers/duplicates', values);
      if (matches?.length) { setDupes({ matches, values }); return; }
    } catch {
      /* เช็คซ้ำไม่ได้ก็ไม่ควรบล็อกการเปิดเคส — ปล่อยให้บันทึกต่อ ดีกว่าค้างอยู่ตรงนี้ */
    } finally { setBusy(false); }
    await create(values);
  };

  if (dupes) {
    return (
      <DuplicateWarning
        matches={dupes.matches}
        busy={busy}
        onUse={(m) => { setDupes(null); onCreated(m); }}
        onForce={() => create(dupes.values)}
        onEdit={() => setDupes(null)}
      />
    );
  }

  return (
    <form onSubmit={save}>
      <FormGrid>
        <Field label="ชื่อ / First name"><input name="first_name" required /></Field>
        <Field label="ชื่อกลาง / Mid name"><input name="mid_name" /></Field>
        <Field label="นามสกุล / Last name"><input name="last_name" /></Field>
        <Field label="เบอร์โทร / Phone"><input name="phone" /></Field>
        {/* ช่องเดียวรับทั้งสองอย่าง — ลูกค้าต่างชาติทักมาทาง WhatsApp คนไทยทาง LINE
            แต่ร้านติดต่อกลับช่องทางไหนก็ช่องทางเดียวต่อคน จึงไม่ต้องแยกคอลัมน์ */}
        <Field label="LINE ID / WhatsApp">
          <input name="line_id" placeholder="LINE ID หรือเบอร์ WhatsApp" />
        </Field>
        <Field label="เพศ / Sex"><ListSelect name="sex" kind="sex" defaultValue="" blank="—" /></Field>
        <Field label="วันเกิด / Birth date"><DateField name="birth_date" /></Field>
        <Field label="สัญชาติ / Nationality"><NationalitySelect name="nationality" /></Field>
        <Field label="อีเมล / Email"><input name="email" type="email" /></Field>
      </FormGrid>
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
  const [busy, setBusy] = useState(false);
  /* กด "เลือกใหม่" ต้องทิ้งลูกค้าที่ติดมากับ ?customer= ด้วย ไม่งั้นเคลียร์ picked
     แล้วมันเด้งกลับมาเป็นคนเดิม — ปุ่มกดแล้วเหมือนไม่มีอะไรเกิดขึ้น */
  const [dropInitial, setDropInitial] = useState(false);

  if (loading) return <Loading />;

  const customer = created ?? picked ?? (dropInitial ? null : initial);
  const isNewCustomer = mode === 'new';

  /* กลับไปหน้าเลือก — ลูกค้าใหม่ที่บันทึกไปแล้วยังอยู่ในระบบ แค่ไม่ผูกกับเคสใบนี้ */
  const reselect = () => {
    setPicked(null);
    setCreated(null);
    setDropInitial(true);
  };

  const chooseMode = (next) => {
    if (next === mode) return;
    setMode(next);
    reselect();
  };

  const save = async (e) => {
    e.preventDefault();
    if (!customer) return err('กรุณาเลือกหรือสร้างลูกค้าก่อน');
    setBusy(true);
    try {
      const body = readForm(e.currentTarget);
      /* ฟอร์มนี้ไม่ส่ง referral_note มาแล้ว เคสใหม่จึงเปิดมาโดยช่องนั้นว่าง
         ตั้งใจให้เป็นแบบนั้น — จะกรอกก็ไปกรอกที่ขั้นรับลูกค้าของเคส */
      const saved = await api.post('/api/cases', {
        ...body,
        customer_id: customer.id,
        is_new_customer: isNewCustomer ? 1 : 0,
        recorded_by: body.received_by || null,
      });
      ok('เปิดเคส ' + saved.case_code + ' แล้ว');
      router.push('/cases/detail?id=' + saved.id + '&step=reception');
    } catch (ex) { err(ex); } finally { setBusy(false); }
    return undefined;
  };

  return (
    <>
      <PageHead icon="board" title="New Case" subtitle="เปิดเคสใหม่" />

      {/* เลือกลูกค้าได้แล้วก็ยุบทั้งขั้นตอนเหลือแค่การ์ดสรุป — ปุ่มโหมดกับช่องค้นหา
          ไม่ต้องค้างอยู่ให้เกะกะ ยังไงก็เลือกได้ทีละคน กด "เลือกใหม่" ถึงกางกลับ */}
      <Card title="1. ลูกค้ารายนี้เป็นใคร">
        {!customer && (
          <>
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

            {mode === 'existing' && (
              <Picker
                placeholder="ค้นหาลูกค้า (ชื่อ / นามสกุล / เบอร์โทร / รหัสลูกค้า)"
                fetcher={(q) => api.get('/api/customers', { q, limit: 40 })}
                label={custName}
                sub={(r) => [r.phone, r.line_id, '#' + r.id].filter(Boolean).join(' · ')}
                onPick={setPicked}
              />
            )}

            {mode === 'new' && <NewCustomerForm onCreated={setCreated} />}
          </>
        )}

        {customer && (
          <div className="ws-inset">
            <Row style={{ marginBottom: 8 }}>
              <Badge kind={isNewCustomer ? 'blue' : 'gray'}>{isNewCustomer ? 'ลูกค้าใหม่' : 'ลูกค้าเก่า'}</Badge>
              <b>{custName(customer)}</b>
              <span className="muted">{`รหัสลูกค้า #${customer.id}`}</span>
              <Link className="btn btn-sm btn-light" href={'/customers/detail?id=' + customer.id}>ดูประวัติ</Link>
              <button type="button" className="btn btn-sm btn-light" onClick={reselect}>
                เลือกใหม่
              </button>
            </Row>
            <Kv
              rows={[
                ['เบอร์โทร', customer.phone || '—'],
                ['LINE / WhatsApp', customer.line_id || '—'],
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
          {/* สี่ช่องพอดีสี่คอลัมน์ — ล็อกไว้ที่ 4 / 2 / 1 แทนที่จะปล่อย auto-fill คิดเอง
              เพราะความกว้างจริงของการ์ดให้ 3 คอลัมน์ ซึ่งทิ้งช่องว่างค้างไว้หนึ่งช่อง */}
          <FormGrid className="intake">
            <Field label="พนักงานผู้รับเรื่อง" hint="ผู้รับลูกค้าในเคสนี้ ตรวจย้อนหลังได้จากไทม์ไลน์">
              <EmployeeSelect name="received_by" defaultValue="" />
            </Field>
            <Field label="ประเภทงาน / Case Type" hint="งานชิ้นนี้คืองานอะไร">
              <ListSelect name="case_type" kind="case_type" defaultValue="" blank="— เลือกประเภทงาน —" />
            </Field>
            <Field label="ประเภทลูกค้า / Customer Category" hint="ใช้แยกสมุดงานบนกระดาน">
              <ListSelect
                name="customer_category"
                kind="customer_category"
                defaultValue=""
                blank="— เลือกประเภทลูกค้า —"
              />
            </Field>
            {/* เลือก "อื่นๆ" แล้วจบตรงนั้น ไม่มีช่องให้กรอกต่อ — ค่า other บันทึกได้เลย
                คอลัมน์ referral_note ยังอยู่และยังโชว์ที่แท็บภาพรวมของเคส แต่ไม่มี
                ฟอร์มไหนกรอกแล้ว รายการเก่าที่เคยกรอกไว้จึงยังอ่านออกเหมือนเดิม */}
            <Field label="รู้จักเราจากช่องทางไหน / Customer Source" hint="ช่องทางที่ลูกค้ารู้จักร้าน">
              <ListSelect
                name="referral_source"
                kind="referral_source"
                defaultValue=""
                blank="— ไม่ระบุ —"
              />
            </Field>
            {/* เคสใหม่เริ่มที่ "รับลูกค้า / ลงข้อมูล" เสมอ (ค่า default ของ POST /api/cases)
                ของเดิมให้เลือกได้ 30 สถานะ แต่ในทางปฏิบัติไม่มีใครเลือกอย่างอื่น
                จะข้ามขั้นก็กดเลื่อนที่แถบขั้นตอนของเคสนั้นได้อยู่แล้ว

                ความเร่งด่วนก็ไม่ถามตอนเปิดเคสเหมือนกัน และตอนนี้ไม่มีที่ไหนติ๊กแล้ว —
                is_rush ยังอ่านอยู่ (ป้าย "ด่วน" บนกระดาน/ส่งมอบ, ตัวกรองงานด่วน,
                ตัวนับหน้าแรก) แต่ค่าเข้าระบบได้ทางเดียวคือ POST /api/cases หรือ
                /api/bookings เท่านั้น */}
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
