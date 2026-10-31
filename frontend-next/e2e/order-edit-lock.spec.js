/**
 * ขั้นขาย/ชำระเงิน — ออเดอร์และวันนัดรับที่บันทึกแล้วล็อกไว้ จนกว่าจะกด "เปิดการแก้ไข"
 *
 * รันเดี่ยวได้โดยไม่ต้องมีรหัสบัญชี test.* (API ถูกจำลองทั้งหมด):
 *   E2E_BASE_URL=http://127.0.0.1:8099 npx playwright test order-edit-lock --project=tablet-1024 --no-deps
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
  lists: {}, employees: [{ id: 9, employee_name: 'ช่าง' }], statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '2026-10-30', now: '2026-10-30 10:00:00',
};
const reply = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function open(page, step, writes) {
  const order = { ...BASE_CASE.order, appointment_date: '2026-11-02', notes: 'เดิม' };
  const kase = { ...BASE_CASE, order };
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (req.method() !== 'GET') {
      writes.push({ p, body: req.postDataJSON() });
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

test('ขั้นขาย: ล็อกก่อน แก้ไม่ได้ · เปิดแล้วแก้ได้ · ยกเลิกแล้วค่าเดิมกลับมา · บันทึกแล้วล็อกกลับ', async ({ page }) => {
  const writes = [];
  await open(page, 'sales', writes);
  const notes = page.locator('textarea[name="notes"]');
  const state = page.getByTestId('order-edit-state');

  await expect(state).toContainText('ล็อกอยู่');
  await expect(notes).toBeDisabled();
  await expect(page.locator('form input[type=radio], form input[type=checkbox]').first()).toBeDisabled();
  await expect(page.locator('form fieldset').first()).toHaveCSS('pointer-events', 'none');
  await expect(page.getByRole('button', { name: 'บันทึกการแก้ไข' })).toHaveCount(0);

  await page.getByRole('button', { name: 'เปิดการแก้ไข' }).first().click();
  await expect(notes).toBeEnabled();
  await notes.fill('ค่าใหม่');
  await page.getByRole('button', { name: 'ยกเลิกการแก้ไข' }).click();
  await expect(state).toContainText('ล็อกอยู่');
  await expect(notes).toHaveValue('เดิม');
  expect(writes).toEqual([]);

  /* ปุ่มล่างอยู่ในฟอร์ม — กดแล้วต้องแค่ปลดล็อก ไม่บันทึก */
  await page.getByRole('button', { name: 'เปิดการแก้ไข' }).last().click();
  await expect(notes).toBeEnabled();
  expect(writes).toEqual([]);
  await notes.fill('ค่าใหม่');
  await page.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
  await expect(state).toContainText('ล็อกอยู่');
  expect(writes.at(-1).p).toContain('/api/orders/');
  expect(writes.at(-1).body.notes).toBe('ค่าใหม่');
  expect(writes.at(-1).body).not.toHaveProperty('appointment_date');
});

test('วันนัดรับ: ล็อกก่อน ไม่มีปุ่มล้าง · เปิดแล้วล้าง/ยกเลิกได้', async ({ page }) => {
  const writes = [];
  await open(page, 'payment', writes);
  /* เคสจำลองยังไม่ยืนยันขาย หน้าต่างเตือนเด้งบังการ์ด */
  await page.getByRole('button', { name: 'ไว้ทีหลัง' }).click();
  const card = page.locator('.pickup');
  await expect(page.locator('#pickup-date')).toBeDisabled();
  await expect(card.getByRole('button', { name: 'ล้าง' })).toHaveCount(0);

  await card.getByRole('button', { name: 'เปิดการแก้ไข' }).click();
  await expect(page.locator('#pickup-date')).toBeEnabled();
  await expect(card.getByRole('button', { name: 'ล้าง' })).toBeVisible();
  await card.getByRole('button', { name: 'ยกเลิกการแก้ไข' }).click();
  await expect(page.locator('#pickup-date')).toBeDisabled();
  expect(writes).toEqual([]);
});
