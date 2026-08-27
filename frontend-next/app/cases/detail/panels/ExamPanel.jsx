'use client';
/**
 * Process 2 — วัดสายตา, as one workspace rather than a list that sends you to
 * another page to type anything.
 *
 * Everything on screen writes to `prescriptions`, which already stores one row
 * per (case, kind): the draft row this panel edits is the case's kind='measured'
 * row, and ✓ ยืนยันผลวัดสายตา writes a second kind='final' row holding a COPY of
 * whichever values the shop decided to use. That copy is the point — a case must
 * keep showing what it was built from even if the customer's other prescriptions
 * are edited later, so old glasses pulled from history are copied in full and the
 * row they came from is kept in based_on_id for tracing, never read live.
 *
 * Opening this step changes nothing. The process moves to กำลังดำเนินการ on the
 * first real edit (or the first draft save), never on a click of the stepper.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../../lib/apiClient.js';
import { useAsync } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import {
  Badge, Check, Field, FormGrid, Row,
} from '../../../../components/ui.jsx';
import { EmployeeSelect, ListSelect, Select } from '../../../../components/Selects.jsx';
import { useProcessActions } from '../../../../components/ProcessShell.jsx';
import { useMeta } from '../../../../contexts/MetaContext.jsx';
import { dtLocal, fmtDate, fmtDateTime, nowLocal, power, toStamp } from '../../../../lib/format.js';

const HEALTH = [
  ['health_diabetes', 'เบาหวาน'], ['health_bp', 'ความดัน'], ['health_heart', 'โรคหัวใจ'],
  ['health_cataract', 'ต้อกระจก'], ['health_eye_disease', 'โรคตาอื่น ๆ'],
  ['health_eye_surgery', 'เคยผ่าตัดตา'], ['health_drug_allergy', 'แพ้ยา'],
  ['health_medication', 'ใช้ยาประจำ'],
];

/** the measurement columns, per section — old glasses is read off a lens, so it
 * carries fewer of them than a refraction does */
const MEASURED_COLS = [
  ['sphere', 'SPH'], ['cylinder', 'CYL'], ['axis', 'AXIS'], ['add', 'ADD'],
  ['pd', 'PD'], ['va', 'VA'], ['prism', 'PRISM'], ['base', 'BASE'],
];
const OLD_COLS = [
  ['sphere', 'SPH'], ['cylinder', 'CYL'], ['axis', 'AXIS'], ['add', 'ADD'],
  ['va', 'VA'], ['pd', 'PD'],
];

const OLD_SOURCES = [
  ['history', 'ดึงจากประวัติในระบบ'],
  ['lensmeter', 'วัดจากแว่นเดิม'],
  ['external_rx', 'ใบ Prescription จากภายนอก'],
  ['', 'ไม่มีข้อมูลค่าสายตาเดิม'],
];

const FINAL_SOURCES = [
  ['measured', 'ค่าที่วัดครั้งนี้'],
  ['old', 'ค่าเดิม / ใบภายนอก'],
  ['adjusted', 'กำหนดค่าเอง (ปรับจากค่าข้างบน)'],
];

/** OD above OS, one column per measurement — the two eyes must never look alike
 * enough to be read off the wrong row */
function RxGrid({ cols, get, set, readOnly = false }) {
  const eye = (k, label) => (
    <tr key={k}>
      <th scope="row">{label}</th>
      {cols.map(([f]) => (
        <td key={f}>
          {readOnly
            ? <span>{get(k, f) || '—'}</span>
            : (
              <input
                aria-label={`${label} ${f}`}
                value={get(k, f)}
                onChange={(e) => set(k, f, e.target.value)}
              />
            )}
        </td>
      ))}
    </tr>
  );
  return (
    <div className="rx-grid-wrap">
      <table className="rx-grid">
        <thead>
          <tr>
            <th />
            {cols.map(([f, label]) => <th key={f}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {eye('r', 'OD / ขวา')}
          {eye('l', 'OS / ซ้าย')}
        </tbody>
      </table>
    </div>
  );
}

const Section = ({ n, title, hint, children, right = null }) => (
  <section className="ws-section">
    <div className="ws-head">
      <h3>{`${n}. ${title}`}</h3>
      {right}
    </div>
    {hint ? <p className="hint">{hint}</p> : null}
    {children}
  </section>
);

/** the columns a prescription row uses for one eye, as the draft form holds them */
const rxOf = (row, prefix, k) => ({
  sphere: row[`${prefix}${k}_sphere`] || '',
  cylinder: row[`${prefix}${k}_cylinder`] || '',
  axis: row[`${prefix}${k}_axis`] || '',
  add: row[`${prefix}${k}_add`] || '',
  pd: row[`${prefix}${k}_pd`] || '',
  va: row[`${prefix}${k}_va`] || '',
  prism: row[`${prefix}${k}_prism`] || '',
  base: row[`${prefix}${k}_base`] || '',
});

export function ExamPanel({ c, reload }) {
  const { ok, err } = useToast();
  const { meta } = useMeta();
  const actions = useProcessActions();
  const rows = useMemo(() => (c.prescriptions || []).filter((r) => Number(r.case_id) === Number(c.id)), [c]);
  const draftRow = useMemo(() => rows.find((r) => r.kind === 'measured') || null, [rows]);
  const finalRow = useMemo(() => rows.find((r) => r.kind === 'final') || null, [rows]);

  /* what the stored final row was built from, so re-opening this step shows the
     same answer the shop gave last time rather than defaulting to "ปรับเอง" */
  const finalSourceOf = (row) => {
    if (!row) return 'measured';
    if (row.adjust_reason) return 'adjusted';
    return ['history', 'lensmeter', 'external_rx'].includes(row.source) ? 'old' : 'measured';
  };

  const [form, setForm] = useState(() => ({ ...(draftRow || {}) }));
  const [finalSource, setFinalSource] = useState(() => finalSourceOf(finalRow));
  const [finalRx, setFinalRx] = useState(() => (finalRow ? { ...finalRow } : {}));
  const [adjustReason, setAdjustReason] = useState(finalRow?.adjust_reason || '');
  const [pickHistory, setPickHistory] = useState(false);
  const started = useRef(false);

  /* re-seed when the case reloads (a save lands, or another step wrote) */
  useEffect(() => {
    setForm({ ...(draftRow || {}) });
    if (finalRow) {
      setFinalRx({ ...finalRow });
      setAdjustReason(finalRow.adjust_reason || '');
      setFinalSource(finalSourceOf(finalRow));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftRow, finalRow]);

  /* the customer's other prescriptions — the source for "ดึงจากประวัติ" */
  const { data: history } = useAsync(
    () => (c.customer_id ? api.get('/api/prescriptions', { customer_id: c.customer_id }) : Promise.resolve([])),
    [c.customer_id],
  );

  /* §3: the first real edit is what starts the process, not opening the tab */
  const touch = () => {
    if (started.current) return;
    started.current = true;
    if (actions?.state?.status === 'not_started') {
      api.post(`/api/cases/${c.id}/processes/exam/start`, {}).then(reload).catch(() => {});
    }
  };

  const set = (name, value) => { touch(); setForm((f) => ({ ...f, [name]: value })); };
  const setEye = (prefix) => (k, f, v) => set(`${prefix}${k}_${f}`, v);
  const getEye = (prefix) => (k, f) => form[`${prefix}${k}_${f}`] ?? '';
  const field = (name, label, placeholder) => (
    <Field label={label}>
      <input value={form[name] ?? ''} placeholder={placeholder} onChange={(e) => set(name, e.target.value)} />
    </Field>
  );

  const oldSource = form.source ?? '';
  const readOnlyOld = oldSource === 'history';

  const pullFrom = (r) => {
    touch();
    setForm((f) => ({
      ...f,
      source: 'history',
      based_on_id: r.id,
      old_glasses_type: r.old_glasses_type || f.old_glasses_type || '',
      /* a copy, not a pointer — §26: this case must keep these numbers even if
         row #r.id is edited tomorrow */
      old_r_sphere: r.r_sphere || '', old_r_cylinder: r.r_cylinder || '', old_r_axis: r.r_axis || '',
      old_r_add: r.r_add || '', old_r_va: r.r_va || '', old_r_pd: r.r_pd || '',
      old_l_sphere: r.l_sphere || '', old_l_cylinder: r.l_cylinder || '', old_l_axis: r.l_axis || '',
      old_l_add: r.l_add || '', old_l_va: r.l_va || '', old_l_pd: r.l_pd || '',
    }));
    setPickHistory(false);
    ok(`ดึงค่าจากใบวันที่ ${fmtDate(r.test_date)} มาแล้ว`);
  };

  const clearOld = () => {
    touch();
    setForm((f) => {
      const next = { ...f, source: '', based_on_id: null, external_place: '', external_date: '' };
      for (const k of ['r', 'l']) {
        for (const [col] of OLD_COLS) next[`old_${k}_${col}`] = '';
      }
      return next;
    });
  };

  /** the values the case would actually use, for the chosen final source */
  const finalValues = useMemo(() => {
    if (finalSource === 'measured') return { r: rxOf(form, '', 'r'), l: rxOf(form, '', 'l') };
    if (finalSource === 'old') return { r: rxOf(form, 'old_', 'r'), l: rxOf(form, 'old_', 'l') };
    return { r: rxOf(finalRx, '', 'r'), l: rxOf(finalRx, '', 'l') };
  }, [finalSource, form, finalRx]);

  const saveDraft = async () => {
    const body = {
      ...form,
      case_id: c.id,
      customer_id: c.customer_id,
      kind: 'measured',
      test_date: toStamp(form.test_date ? dtLocal(form.test_date) : nowLocal()),
    };
    const saved = draftRow
      ? await api.put('/api/prescriptions/' + draftRow.id, body)
      : await api.post('/api/prescriptions', body);
    if (actions?.state?.status === 'not_started') {
      await api.post(`/api/cases/${c.id}/processes/exam/start`, {});
    }
    ok('บันทึกข้อมูลวัดสายตาแล้ว');
    reload();
    return saved;
  };

  /* ✓ ยืนยันผลวัดสายตา: save the draft, then write the final row the case will
     use — a real row with its own values, confirmed so the order picks it up. */
  const beforeComplete = async () => {
    if (finalSource === 'adjusted' && !adjustReason.trim()) {
      err('กรุณาระบุเหตุผลที่ปรับค่าเอง');
      return false;
    }
    const values = finalValues;
    if (!values.r.sphere && !values.l.sphere) {
      err('ยังไม่มีค่าสายตาที่จะใช้ — กรอก Measured Prescription หรือเลือกแหล่งอื่นก่อน');
      return false;
    }
    const draft = await saveDraft();
    const body = {
      case_id: c.id,
      customer_id: c.customer_id,
      kind: 'final',
      source: finalSource === 'old' ? (form.source || 'external_rx') : (form.rx_source || 'refraction'),
      based_on_id: finalSource === 'old' ? (form.based_on_id || null) : (draft?.id || draftRow?.id || null),
      adjust_reason: finalSource === 'adjusted' ? adjustReason : null,
      test_date: toStamp(nowLocal()),
      test_for: form.test_for || '',
      performed_by: form.performed_by || null,
      pd_total: form.pd_total || '',
      exam_note: form.exam_note || '',
      notes: form.notes || '',
    };
    for (const k of ['r', 'l']) {
      for (const [col] of MEASURED_COLS) body[`${k}_${col}`] = values[k][col] || '';
    }
    const saved = finalRow
      ? await api.put('/api/prescriptions/' + finalRow.id, body)
      : await api.post('/api/prescriptions', body);
    await api.post(`/api/prescriptions/${saved.id}/confirm`, {});
    return true;
  };

  /* hand both to the shell's action bar so this panel has no second one */
  const fns = useRef({});
  fns.current = { saveDraft, beforeComplete };
  const register = actions?.register;
  useEffect(() => {
    if (!register) return undefined;
    register({
      saveDraft: () => fns.current.saveDraft(),
      beforeComplete: () => fns.current.beforeComplete(),
    });
    return () => register({});
  }, [register]);

  /* Confirmed means signed off: the workspace turns into the record of what was
     used, and ✏ แก้ไขข้อมูล in the action bar is the way back in (§24/§25). */
  const st = actions?.state || {};
  const confirmed = st.status === 'completed' && !!Number(st.stored) && !!st.completed_at;
  const shownFinal = confirmed && finalRow
    ? { r: rxOf(finalRow, '', 'r'), l: rxOf(finalRow, '', 'l') }
    : finalValues;

  const compare = [
    ['OD SPH', form.old_r_sphere, form.r_sphere, shownFinal.r.sphere],
    ['OD CYL', form.old_r_cylinder, form.r_cylinder, shownFinal.r.cylinder],
    ['OS SPH', form.old_l_sphere, form.l_sphere, shownFinal.l.sphere],
    ['OS CYL', form.old_l_cylinder, form.l_cylinder, shownFinal.l.cylinder],
  ];

  return (
    <fieldset className="exam-ws" disabled={confirmed}>
      <Section n="1" title="ค่าสายตาเปล่า / Visual Acuity" hint="ค่าการมองเห็นก่อนใส่แว่น และระยะที่ลูกค้าใช้สายตาเป็นประจำ">
        <FormGrid>
          {field('va_naked_r', 'VA ตาเปล่า OD / ขวา', '20/40')}
          {field('va_naked_l', 'VA ตาเปล่า OS / ซ้าย', '20/40')}
          {field('bin_r_va', 'VA ระยะใกล้ OD / ขวา', 'N6')}
          {field('bin_l_va', 'VA ระยะใกล้ OS / ซ้าย', 'N6')}
          {field('dist_vertical_r', 'ระยะอ่านหนังสือ R (ซม.)')}
          {field('dist_vertical_l', 'ระยะอ่านหนังสือ L (ซม.)')}
          {field('dist_monitor_r', 'ระยะคอมพิวเตอร์ R (ซม.)')}
          {field('dist_monitor_l', 'ระยะคอมพิวเตอร์ L (ซม.)')}
        </FormGrid>
      </Section>

      <Section n="2" title="ประวัติสุขภาพ" hint="ติ๊กเฉพาะที่ลูกค้าแจ้งในเคสนี้ — ค่าที่ติ๊กถูกเก็บไว้กับเคส ไม่ได้อ่านจากโปรไฟล์ลูกค้าแบบสด">
        <Row style={{ gap: 16 }}>
          {HEALTH.map(([k, label]) => (
            <Check
              key={k}
              name={k}
              checked={!!Number(form[k])}
              onChange={(e) => set(k, e.target.checked ? 1 : 0)}
            >
              {label}
            </Check>
          ))}
        </Row>
        <Field label="รายละเอียด" className="full">
          <input value={form.health_note ?? ''} onChange={(e) => set('health_note', e.target.value)} />
        </Field>
      </Section>

      <Section
        n="3"
        title="Old Glasses — ค่าสายตาเดิม"
        hint="ไม่บังคับ ข้ามได้ถ้าลูกค้าไม่มีแว่นเดิม"
        right={oldSource ? <button type="button" className="btn btn-sm btn-light" onClick={clearOld}>ล้าง / ไม่มีค่าเดิม</button> : null}
      >
        <Row style={{ gap: 8, marginBottom: 10 }}>
          {OLD_SOURCES.map(([v, label]) => (
            <button
              type="button"
              key={v || 'none'}
              className={`chip-btn ${oldSource === v ? 'active' : ''}`}
              onClick={() => { if (v === '') clearOld(); else { touch(); setForm((f) => ({ ...f, source: v })); } }}
            >
              {label}
            </button>
          ))}
        </Row>

        {oldSource === 'history' && (
          <div className="ws-inset">
            <Row style={{ justifyContent: 'space-between' }}>
              <span className="muted">
                {form.based_on_id
                  ? `ดึงมาจากใบ #${form.based_on_id} — ค่าถูกคัดลอกเก็บไว้ในเคสนี้แล้ว`
                  : 'เลือกใบจากประวัติเพื่อคัดลอกค่ามาใช้'}
              </span>
              <button type="button" className="btn btn-sm btn-light" onClick={() => setPickHistory((v) => !v)}>
                {pickHistory ? 'ปิดรายการ' : '↧ เลือกจากประวัติ'}
              </button>
            </Row>
            {pickHistory && (
              <div className="rx-history">
                {(history || []).filter((r) => Number(r.id) !== Number(draftRow?.id)).map((r) => (
                  <button type="button" key={r.id} className="rx-history-row" onClick={() => pullFrom(r)}>
                    <b>{fmtDate(r.test_date)}</b>
                    <span>{`OD ${power(r.r_sphere)} / ${power(r.r_cylinder)} x ${r.r_axis || '—'}`}</span>
                    <span>{`OS ${power(r.l_sphere)} / ${power(r.l_cylinder)} x ${r.l_axis || '—'}`}</span>
                    <span className="muted">{r.kind}</span>
                  </button>
                ))}
                {!(history || []).length && <p className="muted">ลูกค้ารายนี้ยังไม่มีประวัติค่าสายตา</p>}
              </div>
            )}
          </div>
        )}

        {oldSource === 'external_rx' && (
          <FormGrid>
            {field('external_place', 'โรงพยาบาล / คลินิก / ร้าน')}
            <Field label="วันที่ในใบ Prescription">
              <input
                type="date"
                value={(form.external_date || '').slice(0, 10)}
                onChange={(e) => set('external_date', e.target.value)}
              />
            </Field>
          </FormGrid>
        )}

        {oldSource ? (
          <>
            <FormGrid>
              <Field label="แว่นเดิมเป็นแบบ">
                <ListSelect
                  name="old_glasses_type"
                  kind="old_glasses_type"
                  value={form.old_glasses_type ?? ''}
                  onChange={(e) => set('old_glasses_type', e.target.value)}
                  blank="—"
                />
              </Field>
            </FormGrid>
            <RxGrid cols={OLD_COLS} get={getEye('old_')} set={setEye('old_')} readOnly={readOnlyOld} />
            {readOnlyOld && <p className="hint">ค่าที่ดึงจากประวัติแก้ไม่ได้ ถ้าต้องการพิมพ์เอง ให้เลือก “วัดจากแว่นเดิม”</p>}
          </>
        ) : <p className="muted">ไม่มีข้อมูลค่าสายตาเดิมในเคสนี้</p>}
      </Section>

      <Section n="4" title="Measured Prescription — ค่าที่วัดครั้งนี้">
        <FormGrid>
          <Field label="ใช้สำหรับ / Test for">
            <ListSelect
              name="test_for"
              kind="test_for"
              value={form.test_for ?? ''}
              onChange={(e) => set('test_for', e.target.value)}
              blank="—"
            />
          </Field>
          <Field label="ผู้วัด">
            <EmployeeSelect
              name="performed_by"
              value={form.performed_by ?? ''}
              onChange={(e) => set('performed_by', e.target.value)}
            />
          </Field>
          <Field label="วันที่วัด">
            <input
              type="datetime-local"
              value={dtLocal(form.test_date) || nowLocal()}
              onChange={(e) => set('test_date', e.target.value)}
            />
          </Field>
          {field('pd_total', 'PD รวม')}
        </FormGrid>
        <RxGrid cols={MEASURED_COLS} get={getEye('')} set={setEye('')} />
      </Section>

      <Section n="5" title="ค่าสายตาที่ใช้ใน Case — Final Prescription" hint="เลือกว่าเคสนี้จะใช้ค่าชุดไหนจริง ระบบจะคัดลอกค่าเก็บไว้กับเคส ไม่ได้อ้างอิงใบอื่นแบบสด">
        <Row style={{ gap: 8, marginBottom: 10 }}>
          {FINAL_SOURCES.map(([v, label]) => (
            <button
              type="button"
              key={v}
              className={`chip-btn ${finalSource === v ? 'active' : ''}`}
              onClick={() => {
                touch();
                if (v === 'adjusted') {
                  const base = finalSource === 'old' ? 'old_' : '';
                  const next = {};
                  for (const k of ['r', 'l']) {
                    for (const [col] of MEASURED_COLS) next[`${k}_${col}`] = form[`${base}${k}_${col}`] || '';
                  }
                  setFinalRx(next);
                }
                setFinalSource(v);
              }}
            >
              {label}
            </button>
          ))}
        </Row>

        <RxGrid
          cols={MEASURED_COLS}
          readOnly={confirmed || finalSource !== 'adjusted'}
          get={(k, f) => (confirmed
            ? (shownFinal[k][f] || '')
            : finalSource === 'adjusted' ? (finalRx[`${k}_${f}`] ?? '') : (finalValues[k][f] || ''))}
          set={(k, f, v) => { touch(); setFinalRx((x) => ({ ...x, [`${k}_${f}`]: v })); }}
        />

        {finalSource === 'adjusted' && (
          <Field label="เหตุผลที่ปรับค่าเอง" className="full">
            <input value={adjustReason} onChange={(e) => { touch(); setAdjustReason(e.target.value); }} />
          </Field>
        )}

        <div className="rx-grid-wrap" style={{ marginTop: 12 }}>
          <table className="rx-grid compare">
            <thead>
              <tr><th /><th>OLD</th><th>MEASURED</th><th>FINAL</th></tr>
            </thead>
            <tbody>
              {compare.map(([label, o, m, f]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{o || '—'}</td>
                  <td>{m || '—'}</td>
                  <td><b>{f || '—'}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {finalRow && (
          <Row style={{ marginTop: 10 }}>
            <Badge kind="ok">FINAL</Badge>
            <span className="muted">{`บันทึกไว้เมื่อ ${fmtDateTime(finalRow.confirmed_at || finalRow.test_date)}`}</span>
            <Link className="btn btn-sm btn-light" href={'/print/prescription?id=' + finalRow.id}>🖨 พิมพ์</Link>
          </Row>
        )}
      </Section>

      <Section n="6" title="หมายเหตุ / Note">
        <FormGrid two>
          <Field label="บันทึกการตรวจ">
            <textarea value={form.exam_note ?? ''} onChange={(e) => set('exam_note', e.target.value)} />
          </Field>
          <Field label="หมายเหตุอื่น ๆ">
            <textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </FormGrid>
      </Section>

      {rows.length > 0 && (
        <Section n="7" title="ใบวัดสายตาของเคสนี้">
          <div className="rx-history">
            {rows.map((r) => (
              <div key={r.id} className="rx-history-row static">
                <b>{`${r.kind === 'final' ? 'ค่าที่ใช้จริง' : 'ค่าที่วัดได้'} — ${fmtDateTime(r.test_date)}`}</b>
                <span>{`OD ${power(r.r_sphere)} / ${power(r.r_cylinder)} x ${r.r_axis || '—'}`}</span>
                <span>{`OS ${power(r.l_sphere)} / ${power(r.l_cylinder)} x ${r.l_axis || '—'}`}</span>
                <Link className="btn btn-sm btn-light" href={'/prescriptions/edit?id=' + r.id}>✎ แก้ไขทั้งใบ</Link>
              </div>
            ))}
          </div>
        </Section>
      )}
    </fieldset>
  );
}
