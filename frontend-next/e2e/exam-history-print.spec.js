/**
 * พิมพ์ใบสายตาจากประวัติสายตาของลูกค้า — รวมรอบเก่าที่ไม่ผูกเคส
 *
 * เหตุการณ์จริง 30 ก.ย. 2026: ลูกค้า #7517 มีค่าสายตาจากระบบเดิม (ไม่ผูกเคส) บนหน้า
 * ลูกค้า แต่ไม่มีปุ่มพิมพ์ — ปุ่มพิมพ์มีอยู่แค่ในขั้นวัดสายตาของเคส ซึ่งรอบพวกนี้ไม่มี
 * และใบพิมพ์ของรอบที่ไม่ผูกเคสขึ้นชื่อลูกค้าเป็นขีด เพราะอ่านชื่อจากเคสอย่างเดียว
 *
 * จำลองคำตอบของ API ด้วย page.route · รันเดี่ยวได้โดยไม่ต้องมีรหัสบัญชี test.*:
 *   E2E_BASE_URL=http://localhost:3010 npx playwright test exam-history-print --project=tablet-1024 --no-deps
 */
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

const ACTOR = {
  id: 1, username: 'e2e.sales', displayName: 'พนักงานทดสอบ', roleText: 'Sales',
  roles: ['sales'], perms: ['frontdesk.use'], home: '/', mustChangePassword: false,
};
const META = {
  lists: {}, employees: [], statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '2026-09-30', now: '2026-09-30 17:00:00',
};

const RX = {
  id: 9001, customer_id: 7517, case_id: null, kind: 'measured', test_date: '2026-09-05 10:00:00',
  test_for: 'Distance', first_name: 'ลูกค้า', last_name: 'ทดสอบ',
  r_sphere: '-0.75', r_cylinder: '-0.25', r_axis: '180',
  l_sphere: '0.00', l_cylinder: '-1.50', l_axis: '145',
};
const CUSTOMER = {
  id: 7517, first_name: 'ลูกค้า', last_name: 'ทดสอบ', phone: '0800000000',
  created_at: '2026-09-10 10:00:00', cases: [], orders: [],
  exam_sessions: [{
    key: 'rx-9001', case_id: null, case_code: null, exam_date: '2026-09-05 10:00:00',
    examiner: 'Yean', old: null, measured: RX, final: null,
  }],
};

/* API อยู่คนละ origin กับหน้าเว็บตอน dev — คำตอบจำลองต้องผ่าน CORS ด้วย */
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

async function mock(page) {
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/api/auth/me')) return reply(route, ACTOR);
    if (p.endsWith('/api/meta')) return reply(route, META);
    if (p.endsWith(`/api/customers/${CUSTOMER.id}`)) return reply(route, CUSTOMER);
    if (p.endsWith(`/api/prescriptions/${RX.id}`)) return reply(route, RX);
    return reply(route, []);
  });
}

test.describe('พิมพ์ใบสายตาจากประวัติสายตาของลูกค้า', () => {
  test('รอบที่ไม่ผูกเคสมีปุ่มพิมพ์ กดแล้วไปหน้าใบสายตาที่ขึ้นชื่อลูกค้าและค่าสายตา', async ({ page }) => {
    await mock(page);
    await page.goto(`/customers/detail/?id=${CUSTOMER.id}`);

    const round = page.locator('.exam-round').first();
    await expect(round).toContainText('ไม่ผูกเคส', { timeout: 20_000 });
    await round.getByRole('link', { name: 'พิมพ์' }).click();

    await expect(page).toHaveURL(/\/print\/prescription\/?\?id=9001/);
    await expect(page.locator('.slip-name .v')).toHaveText('ลูกค้า ทดสอบ', { timeout: 20_000 });
    await expect(page.locator('.slip-rx')).toContainText('-0.75');
    await expect(page.getByRole('link', { name: 'กลับไปที่ลูกค้า' })).toBeVisible();
  });
});
