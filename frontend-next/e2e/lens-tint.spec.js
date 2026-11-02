/**
 * ขั้นขาย — ย้อมสีเลนส์ / ขั้นส่งมอบ — คนเจีย
 *
 * รันเดี่ยวได้โดยไม่ต้องมีรหัสบัญชี test.* (API ถูกจำลองทั้งหมด):
 *   E2E_BASE_URL=http://127.0.0.1:8099 npx playwright test lens-tint --project=tablet-1024 --no-deps
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

const BASE_CASE = JSON.parse(readFileSync(new URL('./fixtures/case-payment.json', import.meta.url), 'utf8'));
const SALES = {
  id: 2, username: 'e2e.sales', displayName: 'พนักงานขาย', roleText: 'Sales',
  roles: ['sales'], perms: ['frontdesk.use', 'case.view_all'], home: '/', mustChangePassword: false,
};
const META = {
  lists: {}, employees: [{ id: 9, employee_name: 'ช่างเจีย' }], statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '2026-10-30', now: '2026-10-30 10:00:00',
};

function reply(route, body) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

async function open(page, step, orderPatch = {}, onWrite = () => {}) {
  const order = { ...BASE_CASE.order, ...orderPatch };
  const kase = { ...BASE_CASE, order };
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (req.method() !== 'GET') {
      onWrite(p, req.postDataJSON());
      return reply(route, order);
    }
    if (p.endsWith('/api/auth/me')) return reply(route, SALES);
    if (p.endsWith('/api/meta')) return reply(route, META);
    if (p.endsWith(`/api/cases/${BASE_CASE.id}`)) return reply(route, kase);
    if (p.endsWith(`/api/orders/${order.id}`)) return reply(route, order);
    return reply(route, []);
  });
  await page.goto(`/cases/detail/?id=${BASE_CASE.id}&step=${step}`);
}

test('เลือกย้อมสีแล้วต้องเลือกสี และบันทึกลง lens_tint', async ({ page }) => {
  let body = null;
  await open(page, 'sales', {}, (p, b) => { if (p.includes('/api/orders')) body = b; });

  await page.getByRole('button', { name: 'เปิดการแก้ไข' }).first().click();
  const bar = page.locator('form .card', { hasText: 'ย้อมสีเลนส์' });
  await expect(bar).toContainText('ย้อมสีเลนส์ / Lens Tint (Dye)');
  await expect(bar.getByRole('radio', { name: /ไม่ย้อมสี/ })).toBeChecked();
  await expect(bar.getByRole('group', { name: 'ตัวอย่างสีย้อม' })).toHaveCount(0);

  await bar.getByRole('radio', { name: /^ย้อมสี/ }).check();
  await expect(bar.getByRole('group', { name: 'ตัวอย่างสีย้อม' }).getByRole('button')).toHaveCount(32);
  await page.locator('form button[type=submit]').click();
  await expect(page.getByText('กรุณาเลือกสีและระดับความเข้มที่จะย้อม').first()).toBeVisible();
  expect(body).toBeNull();

  await bar.getByRole('button', { name: 'น้ำตาล ระดับ 3' }).click();
  await page.locator('form button[type=submit]').click();
  await expect.poll(() => body?.lens_tint).toBe('ย้อมสี น้ำตาล ระดับ 3');
});

test('ออเดอร์ที่ย้อมไว้แล้ว เปิดกลับมาเห็นสีเดิม เปลี่ยนเป็นไม่ย้อมแล้วล้างค่า', async ({ page }) => {
  let body = null;
  await open(page, 'sales', { lens_tint: 'ย้อมสี เทา ระดับ 2' }, (p, b) => { if (p.includes('/api/orders')) body = b; });

  await page.getByRole('button', { name: 'เปิดการแก้ไข' }).first().click();
  const bar = page.locator('form .card', { hasText: 'ย้อมสีเลนส์' });
  await expect(bar.getByRole('button', { name: 'เทา ระดับ 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await bar.getByRole('radio', { name: /ไม่ย้อมสี/ }).check();
  await page.locator('form button[type=submit]').click();
  await expect.poll(() => body?.lens_tint).toBe('');
});

test('ออเดอร์เก่าสีที่เลิกใช้ ไม่มีระดับ — บันทึกซ้ำแล้วค่าเดิม', async ({ page }) => {
  let body = null;
  await open(page, 'sales', { lens_tint: 'ย้อมสี ม่วง' }, (p, b) => { if (p.includes('/api/orders')) body = b; });

  await page.getByRole('button', { name: 'เปิดการแก้ไข' }).first().click();
  await expect(page.getByText('ยังไม่มีระดับความเข้ม')).toBeVisible();
  await page.locator('form button[type=submit]').click();
  await expect.poll(() => body?.lens_tint).toBe('ย้อมสี ม่วง');
});

test('การ์ดบันทึกการส่งมอบมีช่องคนเจีย', async ({ page }) => {
  await open(page, 'delivery');
  const card = page.locator('.card', { hasText: 'บันทึกการส่งมอบ' }).last();
  await expect(card).toContainText('คนเจีย / ผู้ดำเนินการเจีย');
});
