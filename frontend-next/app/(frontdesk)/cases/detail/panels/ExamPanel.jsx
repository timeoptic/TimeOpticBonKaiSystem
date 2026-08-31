'use client';
/**
 * Process 2 — วัดสายตา, as one workspace rather than a list that sends you to
 * another page to type anything.
 *
 * One case is one round of testing, and a round holds three value sets that
 * must never overwrite each other:
 *
 *   ค่าเดิม   kind='old'       what the customer walked in wearing
 *   ค่าที่วัด  kind='measured'  what was measured today — the raw finding
 *   ค่าที่ใช้  kind='final'     what this case decided to build glasses from
 *
 * Each is its own row in `prescriptions`, all sharing this case_id, so the
 * round can be read back years later exactly as it was recorded. Values pulled
 * from an earlier round are COPIED in; based_on_id keeps the trail back to the
 * row they came from but is never read live, so editing that old row cannot
 * rewrite what this case was built from.
 *
 * Opening this step changes nothing. The process moves to กำลังดำเนินการ on the
 * first real edit (or the first draft save), never on a click of the stepper.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../../../lib/apiClient.js';
import { useAsync } from '../../../../../lib/hooks.js';
import { useToast } from '../../../../../components/Toast.jsx';
import {
  Badge, Check, Field, FormGrid, Row,
} from '../../../../../components/ui.jsx';
import { EmployeeSelect, ListSelect } from '../../../../../components/Selects.jsx';
import { useProcessActions } from '../../../../../components/ProcessShell.jsx';
import { dtLocal, fmtDate, fmtDateTime, nowLocal, power, toStamp } from '../../../../../lib/format.js';
import { Icon } from '../../../../../components/Icon.jsx';

const HEALTH = [
  ['health_diabetes', 'เบาหวาน'], ['health_bp', 'ความดัน'], ['health_heart', 'โรคหัวใจ'],
  ['health_cataract', 'ต้อกระจก'], ['health_eye_disease', 'โรคตาอื่น ๆ'],
  ['health_eye_surgery', 'เคยผ่าตัดตา'], ['health_drug_allergy', 'แพ้ยา'],
  ['health_medication', 'ใช้ยาประจำ'],
];

/* PD ไม่มีในตารางนี้แล้ว — วัดที่ขั้น "วัด Center" ที่เดียว (centerings) แล้วดึงมาแสดง
   อ่านอย่างเดียว ค่าที่กรอกได้สองที่คือค่าที่ขัดกันเองได้ */
const FULL_COLS = [
  ['sphere', 'SPH'], ['cylinder', 'CYL'], ['axis', 'AXIS'], ['add', 'ADD'],
  ['va', 'VA'], ['prism', 'PRISM'], ['base', 'BASE'],
];
/* แว่นเดิมมี PD ให้กรอกเองได้ — เป็นค่าที่วัดจากแว่นที่ลูกค้าใส่มา ไม่ใช่ค่าที่จะตัดแว่นใหม่
   จึงไม่เกี่ยวกับขั้น "วัด Center" และเก็บไว้กับแถว kind='old' ของรอบนี้ */
const OLD_COLS = [
  ['sphere', 'SPH'], ['cylinder', 'CYL'], ['axis', 'AXIS'], ['add', 'ADD'], ['va', 'VA'],
  ['pd', 'PD'],
];
/* ตารางค่าสายตาแสดง PD ต่อข้างไว้ท้ายแถวด้วย — อ่านอย่างเดียว ค่ามาจากขั้น "วัด Center"
   เท่านั้น จึงไม่อยู่ใน FULL_COLS ที่ใช้ตอนบันทึกและตอนคัดลอกค่าไป Adjusted */
const SHOWN_COLS = [...FULL_COLS, ['pd', 'PD']];
/* คอลัมน์ที่แก้ไม่ได้แม้ตารางจะกรอกได้ */
const LOCKED_COLS = ['pd'];

/** ค่าที่ Final ต้องมีครบทั้งสองตา ถึงจะยืนยันได้ — ADD / PRISM / BASE ไม่บังคับ */
const FINAL_REQUIRED = [['sphere', 'SPH'], ['cylinder', 'CYL'], ['axis', 'AXIS'], ['va', 'VA']];

const EYE_LABEL = { r: 'R / ขวา', l: 'L / ซ้าย' };

const OLD_SOURCES = [
  ['history', 'ดึงจากประวัติในระบบ'],
  ['lensmeter', 'วัดจากแว่นเดิม'],
  ['external_rx', 'ใบ Prescription จากภายนอก'],
  ['', 'ไม่มีข้อมูลค่าสายตาเดิม'],
];

const FINAL_SOURCES = [
  ['measured', 'ใช้ค่าจาก Measured'],
  ['old', 'ใช้ค่าจาก Old Glasses'],
  ['adjusted', 'ปรับค่าเอง / Adjusted'],
];

/** R above L, one column per measurement — the two eyes must never look alike
 * enough to be read off the wrong row. A blank stays blank: 0.00 is a real
 * power, so it can never stand in for "ไม่มีข้อมูล".
 *
 * `missing` marks the cells a save is waiting on, so "กรุณากรอก SPH" points at
 * a box rather than leaving the reader to hunt for which of eight it meant. */
function RxGrid({ cols, get, set, readOnly = false, lockedCols = [], missing = null }) {
  const eye = (k) => (
    <tr key={k}>
      <th scope="row">{EYE_LABEL[k]}</th>
      {cols.map(([f]) => {
        const bad = !!missing?.[`${k}_${f}`];
        /* ล็อกไว้แต่ยังเป็น <input> ตัวเดียวกัน คอลัมน์จะได้กว้างและวางตัวเลขตรงกับช่องอื่น */
        const locked = lockedCols.includes(f);
        return (
          <td key={f}>
            {readOnly
              ? <span>{get(k, f) || '—'}</span>
              : (
                <input
                  aria-label={`${EYE_LABEL[k]} ${f}`}
                  aria-invalid={bad || undefined}
                  className={bad ? 'rx-missing' : undefined}
                  disabled={locked || undefined}
                  readOnly={locked || undefined}
                  title={locked ? 'มาจากขั้น “วัด Center” — แก้ที่นี่ไม่ได้' : undefined}
                  value={locked ? (get(k, f) || '—') : get(k, f)}
                  onChange={locked ? undefined : (e) => set(k, f, e.target.value)}
                />
              )}
          </td>
        );
      })}
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
          {eye('r')}
          {eye('l')}
        </tbody>
      </table>
    </div>
  );
}

const Section = ({ n, title, sub, hint, children, right = null }) => (
  <section className="ws-section">
    <div className="ws-head">
      <h3>{`${n}. ${title}`}{sub ? <small>{sub}</small> : null}</h3>
      {right}
    </div>
    {hint ? <p className="hint">{hint}</p> : null}
    {children}
  </section>
);

/** one eye's values off a prescription row */
const eyeOf = (row, k) => ({
  sphere: row?.[`${k}_sphere`] || '',
  cylinder: row?.[`${k}_cylinder`] || '',
  axis: row?.[`${k}_axis`] || '',
  add: row?.[`${k}_add`] || '',
  pd: row?.[`${k}_pd`] || '',
  va: row?.[`${k}_va`] || '',
  prism: row?.[`${k}_prism`] || '',
  base: row?.[`${k}_base`] || '',
});
const bothEyes = (row) => ({ r: eyeOf(row, 'r'), l: eyeOf(row, 'l') });
const hasValues = (row) => ['r_sphere', 'l_sphere', 'r_cylinder', 'l_cylinder', 'r_add', 'l_add']
  .some((k) => (row?.[k] ?? '') !== '');

/** rows written before old glasses had their own row kept them in old_* columns */
function legacyOldOf(measured) {
  if (!measured) return null;
  const seed = {};
  let any = false;
  for (const k of ['r', 'l']) {
    for (const [f] of OLD_COLS) {
      const v = measured[`old_${k}_${f}`] || '';
      if (v) any = true;
      seed[`${k}_${f}`] = v;
    }
  }
  if (!any) return null;
  return {
    ...seed,
    source: measured.source || 'lensmeter',
    based_on_id: measured.based_on_id || null,
    old_glasses_type: measured.old_glasses_type || '',
    external_place: measured.external_place || '',
    external_date: measured.external_date || '',
  };
}

export function ExamPanel({ c, reload }) {
  const { ok, err } = useToast();
  const actions = useProcessActions();

  const rows = useMemo(
    () => (c.prescriptions || []).filter((r) => Number(r.case_id) === Number(c.id)),
    [c],
  );
  const draftRow = useMemo(() => rows.find((r) => r.kind === 'measured') || null, [rows]);
  const oldRow = useMemo(() => rows.find((r) => r.kind === 'old') || null, [rows]);
  const finalRow = useMemo(() => rows.find((r) => r.kind === 'final') || null, [rows]);

  const finalSourceOf = (row) => {
    if (!row) return 'measured';
    if (row.source === 'adjusted' || row.adjust_reason) return 'adjusted';
    return ['history', 'lensmeter', 'external_rx'].includes(row.source) ? 'old' : 'measured';
  };

  const [form, setForm] = useState(() => ({ ...(draftRow || {}) }));
  const [oldForm, setOldForm] = useState(() => ({ ...(oldRow || legacyOldOf(draftRow) || {}) }));
  const [finalSource, setFinalSource] = useState(() => finalSourceOf(finalRow));
  const [finalRx, setFinalRx] = useState(() => ({ ...(finalRow || {}) }));
  const [adjustReason, setAdjustReason] = useState(finalRow?.adjust_reason || '');
  const [pickHistory, setPickHistory] = useState(false);
  const started = useRef(false);

  /* re-seed when the case reloads (a save lands, or another step wrote) */
  useEffect(() => {
    setForm({ ...(draftRow || {}) });
    setOldForm({ ...(oldRow || legacyOldOf(draftRow) || {}) });
    if (finalRow) {
      setFinalRx({ ...finalRow });
      setAdjustReason(finalRow.adjust_reason || '');
      setFinalSource(finalSourceOf(finalRow));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftRow, oldRow, finalRow]);

  /* the customer's earlier rounds — where "ดึงจากประวัติ" copies from */
  const { data: sessions } = useAsync(
    () => (c.customer_id
      ? api.get(`/api/customers/${c.customer_id}/exam-sessions`)
      : Promise.resolve([])),
    [c.customer_id],
  );
  const otherRounds = (sessions || []).filter((s) => Number(s.case_id) !== Number(c.id));

  /* §4: the first real edit is what starts the process, not opening the tab */
  const touch = () => {
    if (started.current) return;
    started.current = true;
    if (actions?.state?.status === 'not_started') {
      api.post(`/api/cases/${c.id}/processes/exam/start`, {}).then(reload).catch(() => {});
    }
  };

  const set = (name, value) => { touch(); setForm((f) => ({ ...f, [name]: value })); };

  /**
   * ระยะที่ใช้สายตาเป็นค่าเดียวต่อคน แต่ schema เก็บเป็นสองคอลัมน์ (_r / _l) มาแต่เดิม
   * และ §11 บอกว่าอย่า rename ตาราง จึงเขียนค่าเดียวกันลงทั้งสองช่อง แถวจะได้ไม่ขัดกันเอง
   * ไม่ว่าใครอ่านช่องไหน ส่วนตอนอ่านก็รับค่าจากแถวเก่าที่กรอกไว้ข้างเดียวได้
   */
  const distanceOf = (base) => form[`${base}_r`] || form[`${base}_l`] || '';
  const setWorkingDistance = (base, value) => {
    touch();
    setForm((f) => ({ ...f, [`${base}_r`]: value, [`${base}_l`]: value }));
  };
  const readingDistance = distanceOf('dist_vertical');
  const computerDistance = distanceOf('dist_monitor');

  /* PD มาจากขั้น "วัด Center" ที่เดียว — ที่นี่อ่านอย่างเดียว ห้ามมีที่กรอกซ้ำ */
  const centering = c.centering || null;
  /** PD ของตาข้างเดียว สำหรับคอลัมน์ PD ในตาราง Final — ว่างไว้ถ้ายังไม่ได้วัด Center */
  const pdOf = (k) => (centering?.[`${k}_pd`] ?? '') === '' ? '' : String(centering[`${k}_pd`]);
  const setOld = (name, value) => { touch(); setOldForm((f) => ({ ...f, [name]: value })); };
  const field = (name, label, placeholder) => (
    <Field label={label}>
      <input value={form[name] ?? ''} placeholder={placeholder} onChange={(e) => set(name, e.target.value)} />
    </Field>
  );

  const oldSource = oldForm.source ?? '';
  const readOnlyOld = oldSource === 'history';

  const pullFrom = (session) => {
    const src = session.final || session.measured;
    if (!src) { err('รอบนั้นไม่มีค่าสายตาให้ดึง'); return; }
    touch();
    const next = {
      source: 'history',
      based_on_id: src.id,
      old_glasses_type: src.old_glasses_type || oldForm.old_glasses_type || '',
      external_place: '',
      external_date: '',
      source_case_code: session.case_code || '',
    };
    for (const k of ['r', 'l']) {
      for (const [f] of OLD_COLS) next[`${k}_${f}`] = src[`${k}_${f}`] || '';
    }
    setOldForm(next);
    setPickHistory(false);
    ok(`คัดลอกค่าจากรอบวันที่ ${fmtDate(session.exam_date)} มาเป็นค่าเดิมแล้ว`);
  };

  const clearOld = () => {
    touch();
    const blank = { source: '', based_on_id: null, external_place: '', external_date: '', old_glasses_type: '' };
    for (const k of ['r', 'l']) {
      for (const [f] of OLD_COLS) blank[`${k}_${f}`] = '';
    }
    setOldForm(blank);
  };

  /** what the case would use, for the chosen final source */
  const finalValues = useMemo(() => {
    if (finalSource === 'measured') return bothEyes(form);
    if (finalSource === 'old') return bothEyes(oldForm);
    return bothEyes(finalRx);
  }, [finalSource, form, oldForm, finalRx]);

  const st = actions?.state || {};
  const confirmed = st.status === 'completed' && !!Number(st.stored) && !!st.completed_at;
  const shownFinal = confirmed && finalRow ? bothEyes(finalRow) : finalValues;

  /**
   * ค่าที่ Final ยังขาด — คิดจากชุดที่กำลังจะถูกใช้จริง ไม่ใช่จากช่องที่พิมพ์อยู่
   * เพราะเลือก "ใช้ค่าจาก Measured" แล้วช่องที่ว่างคือช่องใน Measured
   *
   * SPH / CYL / AXIS / VA ต้องครบทั้งสองตา ส่วน ADD / PRISM / BASE ไม่บังคับ
   * — 0.00 เป็นค่าจริง คนไม่มีสายตาเอียงก็กรอก 0.00 ได้ ระบบไม่เดาให้
   */
  const missingFinal = useMemo(() => {
    const cells = {};
    const short = new Set();
    for (const k of ['r', 'l']) {
      for (const [f, label] of FINAL_REQUIRED) {
        if (String(finalValues[k][f] ?? '').trim() === '') {
          cells[`${k}_${f}`] = true;
          short.add(label);
        }
      }
    }
    return {
      cells,
      labels: [...short].map((label) => `กรุณากรอก ${label}`),
    };
  }, [finalValues]);

  const saveDraft = async () => {
    const stamp = toStamp(form.test_date ? dtLocal(form.test_date) : nowLocal());
    const measuredBody = {
      ...form,
      case_id: c.id,
      customer_id: c.customer_id,
      kind: 'measured',
      test_date: stamp,
    };
    const measured = draftRow
      ? await api.put('/api/prescriptions/' + draftRow.id, measuredBody)
      : await api.post('/api/prescriptions', measuredBody);

    /* the old glasses are their own row — kept even when blanked, so "เคยมีค่าเดิม
       แล้วลบทิ้ง" stays visible in the case's history rather than vanishing */
    let old = oldRow;
    if (oldSource || oldRow || hasValues(oldForm)) {
      const oldBody = {
        ...oldForm,
        case_id: c.id,
        customer_id: c.customer_id,
        kind: 'old',
        performed_by: form.performed_by || null,
        test_date: stamp,
      };
      delete oldBody.source_case_code;
      old = oldRow
        ? await api.put('/api/prescriptions/' + oldRow.id, oldBody)
        : await api.post('/api/prescriptions', oldBody);
    }

    if (actions?.state?.status === 'not_started') {
      await api.post(`/api/cases/${c.id}/processes/exam/start`, {});
    }
    ok('บันทึกข้อมูลวัดสายตาแล้ว');
    reload();
    return { measured, old };
  };

  /* <Icon name="check" /> ยืนยันผลวัดสายตา: save the round, then write the final row this case will
     build from — a copy of the chosen set, never a pointer at it. */
  const beforeComplete = async () => {
    if (finalSource === 'adjusted' && !adjustReason.trim()) {
      err('กรุณาระบุเหตุผลที่ปรับค่าเอง');
      return false;
    }
    const values = finalValues;
    /* ค่าสายตาที่จะเอาไปสั่งตัดต้องครบ ไม่ใช่แค่มี SPH — ใบที่ขาด AXIS หรือ VA
       ไปโผล่ที่ห้องผลิตแล้วต้องโทรกลับมาถามคือสิ่งที่กันตรงนี้ */
    if (missingFinal.labels.length) {
      err(missingFinal.labels.join('\n'));
      return false;
    }
    const saved = await saveDraft();
    const originId = finalSource === 'old'
      ? (saved.old?.id || oldRow?.id || null)
      : (saved.measured?.id || draftRow?.id || null);

    const body = {
      case_id: c.id,
      customer_id: c.customer_id,
      kind: 'final',
      /* the final row says where its numbers came from in its own right —
         'adjusted' is not a measuring method, it is a decision */
      source: finalSource === 'adjusted'
        ? 'adjusted'
        : finalSource === 'old' ? (oldForm.source || 'external_rx') : 'refraction',
      based_on_id: originId,
      adjust_reason: finalSource === 'adjusted' ? adjustReason : null,
      test_date: toStamp(nowLocal()),
      test_for: form.test_for || '',
      performed_by: form.performed_by || null,
      /* ไม่ส่ง pd_total / r_pd / l_pd — PD เป็นของขั้นวัด Center (ตาราง centerings)
         ใบสายตาถือค่านั้นไม่ได้ ไม่งั้นจะมีสองแหล่งที่ขัดกันได้ */
      exam_note: form.exam_note || '',
      notes: form.notes || '',
    };
    for (const k of ['r', 'l']) {
      for (const [col] of FULL_COLS) body[`${k}_${col}`] = values[k][col] || '';
    }
    const final = finalRow
      ? await api.put('/api/prescriptions/' + finalRow.id, body)
      : await api.post('/api/prescriptions', body);
    await api.post(`/api/prescriptions/${final.id}/confirm`, {});
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

  /* คอลัมน์ = ค่าสายตาแต่ละช่อง, แถว = ที่มาของค่า อ่านเทียบ เก่า -> วัดได้ -> ที่ใช้จริง ได้ทีละบรรทัด
     เรียงตาม "ค่า" ก่อน แล้วค่อยแยกตา (SPH ทั้งคู่ แล้วค่อย CYL ทั้งคู่) ให้ลำดับตรงกับ
     ตาราง MEASURED / FINAL ข้างบนที่ไล่ SPH → CYL → ... ไม่ใช่จับกลุ่มตาขวาให้หมดก่อน
     — คนอ่านกวาดตาลงมาจากตารางบนแล้วเจอค่าเดียวกันเรียงลำดับเดิม */
  const compareCols = [
    ['R SPH', oldForm.r_sphere, form.r_sphere, shownFinal.r.sphere],
    ['L SPH', oldForm.l_sphere, form.l_sphere, shownFinal.l.sphere],
    ['R CYL', oldForm.r_cylinder, form.r_cylinder, shownFinal.r.cylinder],
    ['L CYL', oldForm.l_cylinder, form.l_cylinder, shownFinal.l.cylinder],
  ];
  const compareRows = [['OLD GLASSES', 1], ['MEASURED', 2], ['FINAL', 3]];

  return (
    <fieldset className="exam-ws" disabled={confirmed}>
      <Section n="1" title="ค่าสายตาเปล่า / Visual Acuity" hint="ค่าการมองเห็นก่อนใส่แว่น และระยะที่ลูกค้าใช้สายตาเป็นประจำ">
        {/* ตาเปล่าแยกซ้ายขวาเพราะสองตาเห็นไม่เท่ากัน ส่วนระยะที่ใช้สายตาเป็นระยะจาก
            หน้าไปหนังสือหรือจอ — ตัวเดียวต่อคน ไม่ใช่ต่อตา จึงไม่แยก R / L */}
        <div className="va-row">
          <fieldset className="va-eyes">
            <legend>ตาเปล่า</legend>
            {field('va_naked_r', 'R', '20/40')}
            {field('va_naked_l', 'L', '20/40')}
          </fieldset>
          <fieldset className="va-dist">
            <legend>ระยะที่ใช้สายตา</legend>
            <Field label="ระยะอ่านหนังสือ / Reading">
              <div className="unit-input">
                <input
                  inputMode="decimal"
                  value={readingDistance}
                  placeholder="40"
                  onChange={(e) => setWorkingDistance('dist_vertical', e.target.value)}
                />
                <span>CM</span>
              </div>
            </Field>
            <Field label="ระยะคอมพิวเตอร์ / Computer">
              <div className="unit-input">
                <input
                  inputMode="decimal"
                  value={computerDistance}
                  placeholder="60"
                  onChange={(e) => setWorkingDistance('dist_monitor', e.target.value)}
                />
                <span>CM</span>
              </div>
            </Field>
          </fieldset>
        </div>
      </Section>

      <Section n="2" title="ประวัติสุขภาพ" hint="ติ๊กเฉพาะที่ลูกค้าแจ้งในเคสนี้ — ค่าที่ติ๊กถูกเก็บไว้กับรอบนี้ ไม่ได้อ่านจากโปรไฟล์ลูกค้าแบบสด">
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
        title="OLD GLASSES"
        sub="ค่าสายตาเดิมที่ลูกค้าใช้อยู่ก่อนเคสนี้"
        hint="ไม่บังคับ ข้ามได้ถ้าลูกค้าไม่มีแว่นเดิม — เก็บเป็นค่าของรอบนี้ ไม่ทับค่าที่วัดครั้งนี้"
        right={oldSource ? <button type="button" className="btn btn-sm btn-light" onClick={clearOld}>ล้างค่าเดิม</button> : null}
      >
        <Row style={{ gap: 8, marginBottom: 10 }}>
          {OLD_SOURCES.map(([v, label]) => (
            <button
              type="button"
              key={v || 'none'}
              className={`chip-btn ${oldSource === v ? 'active' : ''}`}
              onClick={() => { if (v === '') clearOld(); else { touch(); setOldForm((f) => ({ ...f, source: v })); } }}
            >
              {label}
            </button>
          ))}
        </Row>

        {oldSource === 'history' && (
          <div className="ws-inset">
            <Row style={{ justifyContent: 'space-between' }}>
              <span className="muted">
                {oldForm.based_on_id
                  ? `คัดลอกมาจากใบ #${oldForm.based_on_id}${oldForm.source_case_code ? ` (${oldForm.source_case_code})` : ''} — ค่าถูกเก็บไว้ในรอบนี้แล้ว`
                  : 'เลือกรอบการตรวจเก่าเพื่อคัดลอกค่ามาใช้'}
              </span>
              <button type="button" className="btn btn-sm btn-light" onClick={() => setPickHistory((v) => !v)}>
                {pickHistory ? 'ปิดรายการ' : <><Icon name="download" /> เลือกจากประวัติ</>}
              </button>
            </Row>
            {pickHistory && (
              <div className="rx-history">
                {otherRounds.map((s) => {
                  const src = s.final || s.measured;
                  return (
                    <button type="button" key={s.key} className="rx-history-row" onClick={() => pullFrom(s)}>
                      <b>{`${fmtDate(s.exam_date)}${s.case_code ? ` · ${s.case_code}` : ''}`}</b>
                      <span>{`R ${power(src?.r_sphere)} / ${power(src?.r_cylinder)} x ${src?.r_axis || '—'}`}</span>
                      <span>{`L ${power(src?.l_sphere)} / ${power(src?.l_cylinder)} x ${src?.l_axis || '—'}`}</span>
                      <span className="muted">{s.final ? 'ค่าที่ใช้จริง' : 'ค่าที่วัดได้'}</span>
                    </button>
                  );
                })}
                {!otherRounds.length && <p className="muted">ลูกค้ารายนี้ยังไม่มีรอบการตรวจอื่น</p>}
              </div>
            )}
          </div>
        )}

        {oldSource === 'external_rx' && (
          <FormGrid>
            <Field label="โรงพยาบาล / คลินิก / ร้าน">
              <input value={oldForm.external_place ?? ''} onChange={(e) => setOld('external_place', e.target.value)} />
            </Field>
            <Field label="วันที่ในใบ Prescription">
              <input
                type="date"
                value={(oldForm.external_date || '').slice(0, 10)}
                onChange={(e) => setOld('external_date', e.target.value)}
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
                  value={oldForm.old_glasses_type ?? ''}
                  onChange={(e) => setOld('old_glasses_type', e.target.value)}
                  blank="— เลือกแบบแว่นเดิม —"
                />
              </Field>
            </FormGrid>
            <RxGrid
              cols={OLD_COLS}
              readOnly={readOnlyOld}
              get={(k, f) => oldForm[`${k}_${f}`] ?? ''}
              set={(k, f, v) => setOld(`${k}_${f}`, v)}
            />
            {readOnlyOld && <p className="hint">ค่าที่ดึงจากประวัติแก้ไม่ได้ ถ้าต้องการพิมพ์เอง ให้เลือก “วัดจากแว่นเดิม”</p>}
          </>
        ) : <p className="muted">— ไม่มีข้อมูลค่าสายตาเดิม</p>}
      </Section>

      <Section n="4" title="MEASURED PRESCRIPTION" sub="ค่าที่วัดได้ในการตรวจครั้งนี้" hint="ค่าดิบที่วัดได้จริง — ถ้าจะใช้ค่าอื่นกับงาน ให้ไปปรับที่ Final ข้างล่าง ไม่ต้องแก้ตรงนี้">
        {/* ไม่มี "ใช้สำหรับ / Test for" ตรงนี้แล้ว — ค่าที่เพิ่งวัดได้ยังไม่ได้ถูกสั่งให้ใช้
            กับอะไร คำถามนั้นเป็นของ Final ข้างล่าง */}
        <FormGrid>
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
        </FormGrid>
        {/* PD ไม่มีช่องรวมตรงนี้แล้ว — เป็นคอลัมน์ท้ายตาราง แยกตาม R / L และอ่านอย่างเดียว */}
        <RxGrid
          cols={SHOWN_COLS}
          lockedCols={LOCKED_COLS}
          get={(k, f) => (f === 'pd' ? pdOf(k) : form[`${k}_${f}`] ?? '')}
          set={(k, f, v) => set(`${k}_${f}`, v)}
        />
      </Section>

      <Section n="5" title="FINAL PRESCRIPTION" sub="ค่าสายตาที่ใช้จริงในเคสนี้" hint="เลือกว่าจะใช้ค่าชุดไหน ระบบจะคัดลอกค่าเก็บเป็นของรอบนี้ — ปรับตรงนี้ไม่กระทบค่าที่วัดได้">
        {/* "ใช้สำหรับ" อยู่ที่นี่ ไม่ใช่ที่ Measured — มันบอกว่าค่าชุดที่ตัดสินใจใช้แล้วนี้
            ถูกสั่งไว้ให้ใช้ทำอะไร ซึ่งเป็นการตัดสินใจ ไม่ใช่ผลการวัด */}
        {/* PD ไม่มีช่องรวมตรงนี้แล้ว — อยู่เป็นคอลัมน์ท้ายตารางข้างล่าง แยกตาม R / L */}
        <FormGrid two>
          <Field label="ใช้สำหรับ / Test For">
            <ListSelect
              name="test_for"
              kind="test_for"
              value={form.test_for ?? ''}
              onChange={(e) => set('test_for', e.target.value)}
              blank="— เลือกการใช้งาน —"
            />
          </Field>
        </FormGrid>

        <Row style={{ gap: 8, marginBottom: 10 }}>
          {FINAL_SOURCES.map(([v, label]) => (
            <button
              type="button"
              key={v}
              className={`chip-btn ${finalSource === v ? 'active' : ''}`}
              onClick={() => {
                touch();
                if (v === 'adjusted') {
                  const from = finalSource === 'old' ? oldForm : form;
                  const next = {};
                  for (const k of ['r', 'l']) {
                    for (const [col] of FULL_COLS) next[`${k}_${col}`] = from[`${k}_${col}`] || '';
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
          cols={SHOWN_COLS}
          lockedCols={LOCKED_COLS}
          readOnly={confirmed || finalSource !== 'adjusted'}
          missing={confirmed ? null : missingFinal.cells}
          get={(k, f) => (f === 'pd'
            ? pdOf(k)
            : confirmed
              ? (shownFinal[k][f] || '')
              : finalSource === 'adjusted' ? (finalRx[`${k}_${f}`] ?? '') : (finalValues[k][f] || ''))}
          set={(k, f, v) => { touch(); setFinalRx((x) => ({ ...x, [`${k}_${f}`]: v })); }}
        />

        {!confirmed && missingFinal.labels.length > 0 && (
          <p className="rx-missing-note">
            <Icon name="warning" />
            {` ยังยืนยันไม่ได้ — ${missingFinal.labels.join(' · ')}`}
            {finalSource !== 'adjusted' ? ' (แก้ที่ชุดค่าที่เลือกไว้ หรือกด “ปรับค่าเอง”)' : ''}
          </p>
        )}

        {finalSource === 'adjusted' && (
          <Field label="เหตุผลที่ปรับค่าเอง" className="full">
            <input
              value={adjustReason}
              placeholder="เช่น ลดกำลังเพื่อให้ใส่สบายขึ้น"
              onChange={(e) => { touch(); setAdjustReason(e.target.value); }}
            />
          </Field>
        )}

        <div className="rx-grid-wrap" style={{ marginTop: 12 }}>
          <table className="rx-grid compare">
            <thead>
              <tr>
                <th />
                {compareCols.map(([label]) => <th key={label}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {compareRows.map(([label, i]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  {compareCols.map((col) => (
                    <td key={col[0]}>
                      {i === 3 ? <b>{col[i] || '—'}</b> : (col[i] || '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {finalRow && (
          <Row style={{ marginTop: 10 }}>
            <Badge kind="ok">FINAL</Badge>
            <span className="muted">{`บันทึกไว้เมื่อ ${fmtDateTime(finalRow.confirmed_at || finalRow.test_date)}`}</span>
            <Link className="btn btn-sm btn-light" href={'/print/prescription?id=' + finalRow.id}><Icon name="printer" /> พิมพ์</Link>
          </Row>
        )}
      </Section>

      {/* ช่องเดียว — "บันทึกการตรวจ" กับ "หมายเหตุอื่น ๆ" เป็นคำถามเดียวกันถามสองครั้ง
          คนกรอกต้องเดาทุกครั้งว่าอันไหนควรลงช่องไหน คอลัมน์ notes ยังอยู่และของเก่า
          ยังอ่านออกที่ประวัติการตรวจ แค่ไม่มีที่พิมพ์ใหม่แล้ว */}
      <Section n="6" title="หมายเหตุ / Note">
        <Field label="บันทึกการตรวจ" className="full">
          <textarea value={form.exam_note ?? ''} onChange={(e) => set('exam_note', e.target.value)} />
        </Field>
      </Section>

      {/* ไม่มีหัวข้อ "ค่าสายตาที่บันทึกไว้ในรอบนี้" แล้ว — มันเคยมีเหตุผลตอนที่เป็นทาง
          เดียวที่จะเข้าถึงใบดิบผ่านปุ่ม "แก้ไขทั้งใบ" พอปุ่มนั้นหายไป มันเหลือแค่พิมพ์
          SPH/CYL/AXIS ซ้ำจากหัวข้อ 3/4/5 ที่แสดงครบทุกคอลัมน์อยู่แล้ว บวกตารางเทียบ
          ท้ายหัวข้อ 5 ที่วางค่าทั้งสามชุดเรียงข้างกัน */}
    </fieldset>
  );
}
