/**
 * Prescription Safety Alert — แจ้งเตือนค่าสายตาในขั้นวัดสายตา
 *
 * spec: docs/superpowers/specs/2026-10-14-rx-safety-alert-design.md
 * จำลองคำตอบของ API ด้วย page.route แบบเดียวกับ sales-unconfirmed.spec.js — ไม่แตะข้อมูลจริง
 * ตัวคำนวณตรวจละเอียดแล้วใน lib/__tests__/rxSafety.test.js ที่นี่ตรวจว่าหน้าเว็บ: เตือนในกล่อง,
 * เปิดหน้าต่างตอนยืนยัน, บังคับเหตุผลเมื่อเป็น CRITICAL, ส่งเหตุผลไปบันทึกหลัง /confirm เดิม
 *
 * รันเดี่ยวได้โดยไม่ต้องมีรหัสบัญชี test.*:
 *   E2E_BASE_URL=http://localhost:3010 npx playwright test rx-safety --project=tablet-1024 --no-deps
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

const CASE = JSON.parse(readFileSync(new URL('./fixtures/case-payment.json', import.meta.url), 'utf8'));

const ACTOR = {
  id: 1, username: 'e2e.sales', displayName: 'พนักงานทดสอบ', roleText: 'Sales',
  roles: ['sales'], perms: ['frontdesk.use'], home: '/', mustChangePassword: false,
};
const META = {
  lists: { test_for: ['Distance', 'Reading', 'Progressive', 'Bi-focal', 'Degressive', 'Computer'] },
  employees: [{ id: 680, employee_name: 'พนักงานทดสอบ' }], statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '2026-10-14', now: '2026-10-14 10:00:00',
};

const rxRow = (id, kind, values) => ({
  id, kind, case_id: CASE.id, customer_id: CASE.customer_id, test_date: '2026-10-14 09:00:00',
  r_va: '1.0', l_va: '1.0', ...values,
});
const OLD = rxRow(9001, 'old', { source: 'lensmeter', r_sphere: '-2.00', l_sphere: '-2.00' });

function reply(route, body, status = 200) {
  const req = route.request();
  const headers = {
    'Access-Control-Allow-Origin': req.headers().origin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': req.headers()['access-control-request-headers'] || 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  return route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
}

/** เปิดขั้นวัดสายตาของเคสจำลอง · คืนรายการคำขอที่หน้าเว็บยิงไป */
async function openExam(page, { old = OLD, measured }) {
  const state = { ...CASE, prescriptions: [old, measured].filter(Boolean) };
  const calls = { confirm: [], reviews: [], complete: [] };

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const m = req.method();
    if (p.endsWith('/api/auth/me')) return reply(route, ACTOR);
    if (p.endsWith('/api/meta')) return reply(route, META);
    if (p.endsWith(`/api/cases/${CASE.id}`)) return reply(route, state);
    if (p.endsWith(`/api/cases/${CASE.id}/rx-reviews`)) {
      if (m === 'POST') {
        calls.reviews.push(req.postDataJSON());
        return reply(route, { review: { id: 1 } });
      }
      return reply(route, []);
    }
    if (/\/api\/prescriptions\/\d+\/confirm$/.test(p) && m === 'POST') {
      calls.confirm.push(p);
      return reply(route, {});
    }
    if (/\/api\/prescriptions(\/\d+)?$/.test(p) && (m === 'POST' || m === 'PUT')) {
      const body = req.postDataJSON();
      return reply(route, { ...body, id: body.kind === 'final' ? 9100 : (body.kind === 'old' ? 9001 : 9002) });
    }
    if (p.endsWith('/processes/exam/complete') && m === 'POST') {
      calls.complete.push(p);
      return reply(route, state.processes);
    }
    return reply(route, []);
  });

  await page.goto(`/cases/detail/?id=${CASE.id}&step=exam`);
  await expect(page.locator('.process-card')).toBeVisible({ timeout: 30_000 });
  return calls;
}

const banner = (page) => page.getByTestId('rx-safety-banner');
const dialog = (page) => page.locator('.rxs-dialog');
const confirmExam = (page) => page.getByRole('button', { name: /ยืนยันผลวัดสายตา/ }).click();

test.describe('Prescription Safety Alert', () => {
  test('SPH เปลี่ยน 2.00 — กล่องเตือนแดง · ยืนยันต้องใส่เหตุผล · เหตุผลถูกส่งไปบันทึกหลัง /confirm', async ({ page }) => {
    const calls = await openExam(page, {
      measured: rxRow(9002, 'measured', { test_for: 'Distance', r_sphere: '-4.00', l_sphere: '-2.00' }),
    });

    await expect(banner(page)).toContainText('CRITICAL');
    await expect(banner(page)).toContainText('ตาขวา (OD)');
    await expect(banner(page).locator('.rxs-row-critical').first()).toContainText('-2.00');

    await confirmExam(page);
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText('เปลี่ยนมาก -2.00 D');
    const ok = dialog(page).getByRole('button', { name: 'ยืนยันหลังตรวจสอบ' });
    await expect(ok).toBeDisabled();

    /* หน้าต่างต้องอยู่ในจอ ไม่ล้นแนวนอน (iPad / มือถือ) */
    const box = await dialog(page).boundingBox();
    const vw = page.viewportSize().width;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);

    await dialog(page).locator('textarea').fill('ตรวจ VA ซ้ำแล้ว ลูกค้าเห็นชัด');
    await expect(ok).toBeEnabled();
    await ok.click();

    await expect.poll(() => calls.reviews.length).toBe(1);
    expect(calls.confirm).toHaveLength(1);
    expect(calls.reviews[0]).toEqual({ prescription_id: 9100, reason: 'ตรวจ VA ซ้ำแล้ว ลูกค้าเห็นชัด' });
    await expect.poll(() => calls.complete.length).toBe(1);
  });

  test('กด "ตรวจสอบอีกครั้ง" — ไม่ยืนยัน ไม่บันทึกอะไร', async ({ page }) => {
    const calls = await openExam(page, {
      measured: rxRow(9002, 'measured', { test_for: 'Distance', r_sphere: '-4.00', l_sphere: '-2.00' }),
    });
    await confirmExam(page);
    await dialog(page).getByRole('button', { name: 'ตรวจสอบอีกครั้ง' }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(calls.confirm).toHaveLength(0);
    expect(calls.complete).toHaveLength(0);
  });

  test('WARNING อย่างเดียว — ยืนยันได้โดยไม่ต้องใส่เหตุผล และไม่บันทึก review', async ({ page }) => {
    const calls = await openExam(page, {
      measured: rxRow(9002, 'measured', { test_for: 'Distance', r_sphere: '-2.75', l_sphere: '-2.00' }),
    });
    await expect(banner(page)).toContainText('WARNING');
    await confirmExam(page);
    await expect(dialog(page).locator('textarea')).toHaveCount(0);
    await dialog(page).getByRole('button', { name: 'ยืนยันหลังตรวจสอบ' }).click();
    await expect.poll(() => calls.complete.length).toBe(1);
    expect(calls.reviews).toHaveLength(0);
  });

  test('Progressive ไม่มี ADD — ปุ่มยืนยันกดไม่ได้ · คลิกรายการแล้วไปที่ช่อง ADD', async ({ page }) => {
    const calls = await openExam(page, {
      measured: rxRow(9002, 'measured', { test_for: 'Progressive', r_sphere: '-2.00', l_sphere: '-2.00' }),
    });
    await expect(banner(page)).toContainText('ต้องมี ADD');
    await confirmExam(page);
    await expect(dialog(page)).toContainText('ยังยืนยันไม่ได้');
    await expect(dialog(page).getByRole('button', { name: 'ยืนยันหลังตรวจสอบ' })).toBeDisabled();
    await dialog(page).locator('.rxs-item-btn').first().click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('input[aria-label="R / ขวา add"]').last()).toBeFocused();
    expect(calls.confirm).toHaveLength(0);
  });

  test('ไม่มีแว่นเดิม — บอกว่าเปรียบเทียบไม่ได้ และยืนยันตรงโดยไม่เปิดหน้าต่าง', async ({ page }) => {
    const calls = await openExam(page, {
      old: null,
      measured: rxRow(9002, 'measured', { test_for: 'Distance', r_sphere: '-6.00', l_sphere: '-6.00' }),
    });
    await expect(banner(page)).toContainText('ไม่มีค่าแว่นเดิม');
    await confirmExam(page);
    await expect.poll(() => calls.complete.length).toBe(1);
    await expect(dialog(page)).toHaveCount(0);
  });
});
