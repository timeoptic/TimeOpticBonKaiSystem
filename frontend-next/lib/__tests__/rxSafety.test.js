import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_RULES, evaluate, parseAxis, parseNum, transpose, mergeRules, canonical,
} from '../rxSafety.js';

/* กรณีทดสอบชุดเดียวกับฝั่ง PHP (api/tests/99-rx-safety-engine.test.php) —
   สองตัวคำนวณต้องตอบตรงกันทุกกรณี ไม่งั้นหน้าเว็บเตือนอย่างหนึ่ง audit บันทึกอีกอย่าง */
const fixture = JSON.parse(readFileSync(
  new URL('../../../api/tests/fixtures/rx-safety-cases.json', import.meta.url),
  'utf8',
));

const EYE_DEFAULT = { sphere: '-1.00', cylinder: '', axis: '', add: '', va: '1.0' };
const fill = (set) => (set ? {
  r: { ...EYE_DEFAULT, ...(set.r || {}) },
  l: { ...EYE_DEFAULT, ...(set.l || {}) },
} : null);
const key = (a) => `${a[0] ?? '-'}|${a[1]}|${a[2]}`;

for (const c of fixture.cases) {
  test(`rxSafety: ${c.name}`, () => {
    const res = evaluate({
      old: fill(c.old),
      final: fill(c.final),
      testFor: c.test_for ?? 'Distance',
      rules: mergeRules(c.rules),
    });
    const got = res.alerts.map((a) => key([a.eye, a.field, a.level])).sort();
    const want = c.expect.alerts.map(key).sort();
    assert.deepEqual(got, want, 'alerts');
    for (const [path, v] of Object.entries(c.expect.deltas || {})) {
      const [eye, k] = path.split('.');
      const row = res.compare[eye].rows.find((x) => x.key === k);
      assert.equal(row?.delta ?? null, v, `delta ${path}`);
    }
    if ('hasOld' in c.expect) assert.equal(res.hasOld, c.expect.hasOld, 'hasOld');
    for (const [eye, v] of Object.entries(c.expect.comparable || {})) {
      assert.equal(res.compare[eye].comparable, v, `comparable ${eye}`);
    }
  });
}

test('parseNum: ว่าง ≠ 0, plano = 0, รูปแบบเก่าอ่านได้', () => {
  assert.deepEqual(parseNum(''), { state: 'missing', value: null });
  assert.deepEqual(parseNum('  '), { state: 'missing', value: null });
  assert.deepEqual(parseNum(null), { state: 'missing', value: null });
  assert.deepEqual(parseNum('plano'), { state: 'ok', value: 0 });
  assert.deepEqual(parseNum('0.00'), { state: 'ok', value: 0 });
  assert.deepEqual(parseNum('+02.00'), { state: 'ok', value: 2 });
  assert.deepEqual(parseNum('-.75'), { state: 'ok', value: -0.75 });
  assert.equal(parseNum('2,00').state, 'invalid');
});

test('parseAxis: 090 = 90, ทศนิยมผิด', () => {
  assert.deepEqual(parseAxis('090'), { state: 'ok', value: 90 });
  assert.equal(parseAxis('90.5').state, 'invalid');
  assert.equal(parseAxis('').state, 'missing');
});

test('transpose: plus-cyl → minus-cyl', () => {
  assert.deepEqual(transpose({ sph: 1, cyl: 2, axis: 180 }), { sph: 3, cyl: -2, axis: 90 });
  assert.deepEqual(transpose({ sph: 1, cyl: 2, axis: 45 }), { sph: 3, cyl: -2, axis: 135 });
  assert.deepEqual(transpose({ sph: 1, cyl: -2, axis: 45 }), { sph: 1, cyl: -2, axis: 45 });
});

test('fingerprint: ค่าสมมูล (+cyl/−cyl) ได้ค่าเดียวกัน · ค่าเปลี่ยน → ต่าง', () => {
  const old = fill({ r: { sphere: '-2.00' }, l: { sphere: '-2.00' } });
  const a = evaluate({ old, final: fill({ r: { sphere: '+1.00', cylinder: '-2.00', axis: '90' } }), testFor: 'Distance', rules: DEFAULT_RULES });
  const b = evaluate({ old, final: fill({ r: { sphere: '-1.00', cylinder: '+2.00', axis: '180' } }), testFor: 'Distance', rules: DEFAULT_RULES });
  const c = evaluate({ old, final: fill({ r: { sphere: '-1.25', cylinder: '+2.00', axis: '180' } }), testFor: 'Distance', rules: DEFAULT_RULES });
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, c.fingerprint);
  assert.equal(typeof canonical, 'function');
  /* สตริงเดียวกับที่ 99-rx-safety-engine.test.php ตรวจ — review ที่ PHP บันทึกต้องจับคู่กับค่าบนหน้าเว็บได้ */
  assert.equal(
    b.fingerprint,
    '[["-2.00","0.00",null,null,"-2.00","0.00",null,null],["1.00","-2.00","90",null,"-1.00","0.00",null,null],"Distance"]',
  );
});

test('ข้อมูลผิด = blocking · WARNING/CRITICAL ไม่ blocking', () => {
  const res = evaluate({
    old: fill({ r: { sphere: '-2.00' }, l: { sphere: '-2.00' } }),
    final: fill({ r: { sphere: '-4.00' }, l: { sphere: '-2.00', cylinder: '-1.00' } }),
    testFor: 'Distance',
    rules: DEFAULT_RULES,
  });
  assert.equal(res.alerts.find((a) => a.level === 'critical').blocking, false);
  assert.equal(res.alerts.find((a) => a.level === 'error').blocking, true);
  /* ตาซ้ายข้อมูลผิดจึงไม่คำนวณผลต่าง แต่ตาขวายังคำนวณตามปกติ (sph + se) */
  assert.equal(res.counts.critical, 2);
  assert.equal(res.counts.error, 1);
  assert.equal(res.compare.l.comparable, false);
});
