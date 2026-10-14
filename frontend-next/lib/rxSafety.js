/**
 * Prescription Safety Alert — ตัวคำนวณการแจ้งเตือนค่าสายตา (ฟังก์ชันล้วน ไม่มี React)
 *
 * spec: docs/superpowers/specs/2026-10-14-rx-safety-alert-design.md
 *
 * มีคู่แฝดฝั่ง PHP (`api/services/RxSafety.php`) ที่ใช้บันทึก audit จากค่าในฐานข้อมูล
 * สองตัวรันกรณีทดสอบไฟล์เดียวกัน (`api/tests/fixtures/rx-safety-cases.json`) —
 * แก้กฎที่นี่ต้องแก้ที่นั่นด้วย ไม่งั้นหน้าเว็บเตือนอย่างหนึ่ง แต่ audit บันทึกอีกอย่าง
 *
 * หลักที่ห้ามหลุด:
 *   - ช่องว่าง = ไม่มีข้อมูล ไม่ใช่ 0 · `0.00` / `plano` = 0 จริง
 *   - CYL ว่าง + AXIS ว่าง = เลนส์ทรงกลม (ธรรมเนียมร้าน: ไม่มีค่าเอียงก็ไม่กรอก)
 *   - เทียบหลังแปลงเป็น minus-cyl เสมอ แต่ไม่แก้ค่าต้นฉบับ
 *   - ระบบ "ชวนให้ตรวจสอบ" ไม่ได้ตัดสินว่าค่าผิด
 */

/* เกณฑ์ของร้าน (ผู้ใช้กำหนด 14 ต.ค. 2026): SPH/CYL/ADD เหลือง ≥ 0.50 แดง ≥ 0.75 ·
   AXIS เหลือง ≥ 10° แดง ≥ 20° (เฉพาะเมื่อ |CYL| ทั้งสองชุด ≥ min_cyl) · SE ปิดไว้ แต่ยังแสดงค่าในตาราง */
export const DEFAULT_RULES = Object.freeze({
  sph: { enabled: true, warn: 0.5, critical: 0.75 },
  cyl: { enabled: true, warn: 0.5, critical: 0.75 },
  se: { enabled: false, warn: 1.0, critical: 2.0 },
  add: { enabled: true, warn: 0.5, critical: 0.75 },
  axis: { enabled: true, warn: 10, critical: 20, min_cyl: 0.75 },
});

/** เลนส์หลายระยะ — ต้องมี ADD */
export const MULTIFOCAL = ['Progressive', 'Bi-focal', 'Degressive'];

export const EYE_NAME = { r: 'ตาขวา (OD)', l: 'ตาซ้าย (OS)' };

const FIELD_LABEL = {
  sphere: 'SPH', cylinder: 'CYL', axis: 'AXIS', add: 'ADD', va: 'VA', se: 'SE', test_for: 'ใช้สำหรับ / Test For',
};
/* key ของแถวเทียบ → ช่อง (field) ที่ alert ชี้ */
const ROW_FIELD = { sph: 'sphere', cyl: 'cylinder', axis: 'axis', se: 'se', add: 'add' };

/** เติมเกณฑ์ที่ส่งมาทับค่าเริ่มต้นทีละกฎ — เกณฑ์ที่บันทึกไว้ขาดกฎไหนก็ยังได้ค่าเริ่มต้นของกฎนั้น */
export function mergeRules(rules) {
  const out = {};
  for (const k of Object.keys(DEFAULT_RULES)) {
    out[k] = { ...DEFAULT_RULES[k], ...((rules && rules[k]) || {}) };
  }
  return out;
}

/** ปัดสองตำแหน่งแบบสมมาตร (−0.875 → −0.88) — ให้ตรงกับ round() ของ PHP */
export const round2 = (x) => (x == null ? null : (Math.sign(x) * Math.round(Math.abs(x) * 100)) / 100 + 0);

const blank = (raw) => raw === undefined || raw === null || String(raw).trim() === '';

/** SPH / CYL / ADD → ตัวเลข · ว่าง = missing (ไม่ใช่ 0) */
export function parseNum(raw) {
  if (blank(raw)) return { state: 'missing', value: null };
  const s = String(raw).trim().toLowerCase();
  if (s === 'plano' || s === 'pl') return { state: 'ok', value: 0 };
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(s)) return { state: 'invalid', value: null };
  return { state: 'ok', value: Number(s) + 0 };
}

/** AXIS → จำนวนเต็ม (`090` → 90) */
export function parseAxis(raw) {
  if (blank(raw)) return { state: 'missing', value: null };
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return { state: 'invalid', value: null };
  return { state: 'ok', value: Number(s) };
}

/** plus-cyl → minus-cyl · ค่าที่เป็น minus อยู่แล้วคืนเดิม */
export function transpose({ sph, cyl, axis }) {
  if (!(cyl > 0)) return { sph, cyl, axis };
  return {
    sph: round2(sph + cyl),
    cyl: round2(-cyl),
    axis: axis == null ? null : (axis > 90 ? axis - 90 : axis + 90),
  };
}

/**
 * อ่านตาหนึ่งข้าง → ค่าตัวเลข + ปัญหาของข้อมูล
 * @returns {{sph:?number, cyl:?number, axis:?number, add:?number, sphMissing:boolean, problems:Array<{field,rule,level,message}>}}
 */
export function eyeRx(eye) {
  const e = eye || {};
  const problems = [];
  const sph = parseNum(e.sphere);
  const cyl = parseNum(e.cylinder);
  const axis = parseAxis(e.axis);
  const add = parseNum(e.add);
  const bad = (field, rule, message) => problems.push({ field, rule, level: 'error', message });

  if (sph.state === 'invalid') bad('sphere', 'invalid', 'SPH ไม่ใช่ตัวเลขที่ถูกต้อง');
  if (cyl.state === 'invalid') bad('cylinder', 'invalid', 'CYL ไม่ใช่ตัวเลขที่ถูกต้อง');
  if (add.state === 'invalid') bad('add', 'invalid', 'ADD ไม่ใช่ตัวเลขที่ถูกต้อง');

  let cylV = null;
  let axisV = null;
  if (cyl.state === 'missing') {
    if (axis.state === 'missing') cylV = 0; // ทรงกลม
    else bad('cylinder', 'axis_without_cyl', `มี AXIS ${String(e.axis).trim()} แต่ยังไม่กรอก CYL`);
  } else if (cyl.state === 'ok') {
    cylV = cyl.value;
    if (cylV !== 0) {
      if (axis.state === 'missing') bad('axis', 'cyl_without_axis', `มี CYL ${String(e.cylinder).trim()} แต่ยังไม่กรอก AXIS`);
      else if (axis.state === 'invalid') bad('axis', 'invalid', 'AXIS ต้องเป็นจำนวนเต็ม');
      else if (axis.value > 180) bad('axis', 'axis_range', `AXIS ${axis.value}° อยู่นอกช่วง 0–180°`);
      /* 0° กับ 180° คือแกนเดียวกัน — ระบบเดิม (normAxis) ยอมรับ 0 จึงไม่บล็อก แค่นับเป็น 180 ตอนเทียบ */
      else axisV = axis.value === 0 ? 180 : axis.value;
    }
  }

  const ok = !problems.some((p) => p.field === 'sphere' || p.field === 'cylinder' || p.field === 'axis');
  const base = ok && sph.state === 'ok' && cylV !== null
    ? transpose({ sph: sph.value, cyl: cylV, axis: axisV })
    : null;
  return {
    sph: base ? base.sph : null,
    cyl: base ? base.cyl : null,
    axis: base ? base.axis : null,
    add: add.state === 'ok' ? add.value : null,
    sphMissing: sph.state === 'missing',
    usable: !!base,
    transposed: !!base && cylV > 0,
    problems,
  };
}

const hasAny = (set) => !!set && ['r', 'l'].some((k) => {
  const e = set[k] || {};
  return ['sphere', 'cylinder', 'axis', 'add'].some((f) => !blank(e[f]));
});

const fmtD = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`);
const fmtV = (k, v) => (v == null ? '—' : k === 'axis' ? `${v}°` : fmtD(v));

function changeMessage(eye, k, level, row) {
  const label = FIELD_LABEL[ROW_FIELD[k]];
  if (k === 'axis') {
    return level === 'critical'
      ? `แกน AXIS ${EYE_NAME[eye]} ต่างจากแว่นเดิมมาก ${row.delta}° (${row.old}° → ${row.final}°) กรุณาตรวจสอบผลการวัดและความสบายของลูกค้าก่อนยืนยัน`
      : `แกน AXIS ${EYE_NAME[eye]} ต่างจากแว่นเดิม ${row.delta}° (${row.old}° → ${row.final}°) กรุณาตรวจสอบผลการวัดอีกครั้ง`;
  }
  const head = level === 'critical'
    ? `ค่าสายตา${EYE_NAME[eye]} ${label} เปลี่ยนมาก ${fmtD(row.delta)} D`
    : `ค่าสายตา${EYE_NAME[eye]} ${label} เปลี่ยนจากแว่นเดิม ${fmtD(row.delta)} D`;
  const tail = level === 'critical'
    ? 'กรุณาตรวจสอบผลการวัด VA และความสบายของลูกค้าก่อนยืนยัน'
    : 'กรุณาพิจารณาผลการวัดและความสบายของลูกค้าอีกครั้ง';
  return `${head} (${fmtD(row.old)} → ${fmtD(row.final)}) ${tail}`;
}

const levelOf = (abs, rule) => {
  if (!rule || !rule.enabled) return null;
  const eps = 1e-9;
  if (rule.critical != null && abs + eps >= rule.critical) return 'critical';
  if (rule.warn != null && abs + eps >= rule.warn) return 'warning';
  return null;
};

/** สตริงที่บอกว่า "ค่าชุดนี้" คือชุดไหน — review ผูกกับมัน แก้ค่าแม้ช่องเดียวต้องทบทวนใหม่ */
export function canonical(oldEyes, finalEyes, testFor) {
  const vec = (eyes) => (eyes ? ['r', 'l'].flatMap((k) => {
    const x = eyes[k];
    return [
      x.sph == null ? null : x.sph.toFixed(2),
      x.cyl == null ? null : x.cyl.toFixed(2),
      x.axis == null ? null : String(x.axis),
      x.add == null ? null : x.add.toFixed(2),
    ];
  }) : null);
  return JSON.stringify([vec(oldEyes), vec(finalEyes), String(testFor ?? '').trim()]);
}

/**
 * @param {{old: ?{r,l}, final: {r,l}, testFor: string, rules?: object}} input
 *   ค่าตาเป็นค่าดิบ `{sphere, cylinder, axis, add, va}` แบบที่อยู่ในฟอร์ม/ฐานข้อมูล
 */
export function evaluate({ old, final, testFor, rules }) {
  const R = mergeRules(rules);
  const alerts = [];
  const push = (a) => alerts.push({
    eye: null, old: null, final: null, delta: null, ...a,
    blocking: a.level === 'error' || a.level === 'info',
  });

  const tf = String(testFor ?? '').trim();
  if (tf === '') push({ field: 'test_for', rule: 'required', level: 'info', message: 'ยังไม่ได้เลือก ใช้สำหรับ / Test For' });
  const multifocal = MULTIFOCAL.includes(tf);

  const hasOld = hasAny(old);
  const fin = {};
  const odl = {};
  const compare = {};

  for (const eye of ['r', 'l']) {
    const raw = (final && final[eye]) || {};
    const f = eyeRx(raw);
    fin[eye] = f;
    for (const p of f.problems) push({ ...p, eye, message: `${EYE_NAME[eye]}: ${p.message}` });
    if (f.sphMissing) push({ eye, field: 'sphere', rule: 'required', level: 'info', message: `${EYE_NAME[eye]}: ยังไม่ได้กรอก SPH` });
    if (blank(raw.va)) push({ eye, field: 'va', rule: 'required', level: 'info', message: `${EYE_NAME[eye]}: ยังไม่ได้กรอก VA` });
    if (multifocal && blank(raw.add)) {
      push({ eye, field: 'add', rule: 'required', level: 'info', message: `${EYE_NAME[eye]}: เลนส์ ${tf} ต้องมี ADD` });
    }

    const o = hasOld ? eyeRx(old[eye]) : null;
    odl[eye] = o;
    const rows = [];
    let comparable = false;
    let note = null;
    if (!hasOld) note = 'ไม่มีค่าแว่นเดิม เปรียบเทียบไม่ได้';
    else if (!o.usable) note = o.sphMissing ? 'แว่นเดิมไม่มีค่าตานี้ เปรียบเทียบไม่ได้' : 'ค่าแว่นเดิมอ่านไม่ได้ เปรียบเทียบไม่ได้';
    else if (!f.usable) note = 'ค่าที่จะจ่ายยังไม่ครบ/ไม่ถูกต้อง ยังเปรียบเทียบไม่ได้';
    else comparable = true;

    if (comparable) {
      const seO = o.sph + o.cyl / 2;
      const seF = f.sph + f.cyl / 2;
      rows.push({ key: 'sph', old: o.sph, final: f.sph, delta: round2(f.sph - o.sph) });
      rows.push({ key: 'cyl', old: o.cyl, final: f.cyl, delta: round2(f.cyl - o.cyl) });
      const axisRow = { key: 'axis', old: o.axis, final: f.axis, delta: null };
      if (o.axis != null && f.axis != null) {
        const d = Math.abs(o.axis - f.axis);
        axisRow.delta = Math.min(d, 180 - d);
      }
      rows.push(axisRow);
      rows.push({ key: 'se', old: round2(seO), final: round2(seF), delta: round2(seF - seO) });
      const addRow = { key: 'add', old: o.add, final: f.add, delta: null };
      if (o.add != null && f.add != null) addRow.delta = round2(f.add - o.add);
      else if (f.add != null && o.add == null) addRow.note = 'แว่นเดิมไม่มี ADD';
      rows.push(addRow);

      for (const row of rows) {
        row.level = null;
        if (row.delta == null) continue;
        if (row.key === 'axis') {
          const rule = R.axis;
          const bigCyl = Math.abs(o.cyl) + 1e-9 >= rule.min_cyl && Math.abs(f.cyl) + 1e-9 >= rule.min_cyl;
          /* ไม่เตือนจากองศาอย่างเดียว — ค่าเอียงเล็ก แกนเปลี่ยนแทบไม่มีผลต่อการมองเห็น */
          row.level = bigCyl ? levelOf(row.delta, rule) : null;
        } else {
          row.level = levelOf(Math.abs(row.delta), R[row.key]);
        }
        if (row.level) {
          push({
            eye, field: ROW_FIELD[row.key], rule: row.key, level: row.level,
            old: row.old, final: row.final, delta: row.delta,
            message: changeMessage(eye, row.key, row.level, row),
          });
        }
      }
    }
    compare[eye] = {
      comparable, note, rows,
      transposed: { old: !!o?.transposed, final: f.transposed },
    };
  }

  const counts = { info: 0, warning: 0, critical: 0, error: 0 };
  for (const a of alerts) counts[a.level] += 1;
  return {
    alerts,
    compare,
    hasOld,
    counts,
    blocking: alerts.some((a) => a.blocking),
    fingerprint: canonical(hasOld ? odl : null, fin, tf),
  };
}

/** รูปแบบค่าสำหรับแสดงในตาราง */
export const fmtRxValue = fmtV;
