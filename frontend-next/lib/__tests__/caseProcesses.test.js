import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE_PROCESSES, DONE_STAGE, processInfo } from '../caseProcesses.js';
import { STAGE_GROUPS, stageInfo } from '../constants.js';

/**
 * The flow is declared here and again in api/routes/processes.php. These tests
 * pin the front-end half; if they fail, the PHP const has to move with them or
 * the board and the case screen will disagree about what step a case is on.
 */

test('the main process is the 6 steps, in flow order', () => {
  assert.deepEqual(
    CASE_PROCESSES.map((p) => p.id),
    ['reception', 'exam', 'sales', 'payment', 'centering', 'delivery']
  );
});

test('ชำระเงิน comes before วัด Center', () => {
  const ids = CASE_PROCESSES.map((p) => p.id);
  assert.ok(ids.indexOf('payment') < ids.indexOf('centering'));
});

test('the cut steps are gone from the flow', () => {
  const ids = CASE_PROCESSES.map((p) => p.id);
  for (const cut of ['lens', 'production', 'qc', 'done']) {
    assert.ok(!ids.includes(cut), `${cut} should not be a process any more`);
  }
});

test('ส่งมอบ is last, and its ✓ says the case closes', () => {
  const last = CASE_PROCESSES[CASE_PROCESSES.length - 1];
  assert.equal(last.id, 'delivery');
  assert.match(last.completeLabel, /ปิดเคส/);
});

test('every process has the fields the board and stepper read', () => {
  for (const p of CASE_PROCESSES) {
    for (const key of ['id', 'label', 'color', 'icon', 'completeLabel']) {
      assert.ok(p[key], `${p.id} is missing ${key}`);
    }
  }
});

test('the board columns are the 6 processes — จบงาน is added by the board itself', () => {
  assert.deepEqual(STAGE_GROUPS, CASE_PROCESSES.map((p) => p.id));
});

/* a case that has been closed still reports stage_group 'done', so both
   lookups have to name it rather than fall through to the '-' placeholder */
test('จบงาน still resolves to a label even though it is not a process', () => {
  assert.equal(processInfo('done').label, DONE_STAGE.label);
  assert.equal(stageInfo('done').label, DONE_STAGE.label);
});

test('an unknown id falls back instead of throwing', () => {
  assert.equal(processInfo('nope').label, 'nope');
  assert.equal(stageInfo('').label, '-');
});
