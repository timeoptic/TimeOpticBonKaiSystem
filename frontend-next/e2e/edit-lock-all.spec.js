/**
 * กติกาเดียวทั้งระบบ: ข้อมูลที่บันทึกแล้วต้องกด "เปิดการแก้ไข" ก่อน
 *
 * รันเดี่ยวได้โดยไม่ต้องมีรหัสบัญชี test.* (API ถูกจำลองทั้งหมด):
 *   E2E_BASE_URL=http://127.0.0.1:8099 npx playwright test edit-lock-all --project=tablet-1024 --no-deps
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

const BASE_CASE = JSON.parse(readFileSync(new URL('./fixtures/case-payment.json', import.meta.url), 'utf8'));
const ADMIN = {
  id: 2, username: 'e2e.admin', displayName: 'แอดมิน', roleText: 'Admin',
  roles: ['admin'], perms: ['frontdesk.use', 'case.view_all', 'system.manage', 'system.zone'], home: '/', mustChangePassword: false,
};
const META = {
  lists: {}, employees: [{ id: 9, employee_name: 'ช่าง' }], statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '2026-10-30', now: '2026-10-30 10:00:00',
};
const reply = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function mock(page, extra = {}, writes = []) {
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (req.method() !== 'GET') { writes.push({ m: req.method(), p }); return reply(route, {}); }
    if (p.endsWith('/api/auth/me')) return reply(route, ADMIN);
    if (p.endsWith('/api/meta')) return reply(route, META);
    for (const [k, v] of Object.entries(extra)) if (p.endsWith(k)) return reply(route, v);
    return reply(route, []);
  });
}
const openCase = async (page, step, patch, writes) => {
  const kase = { ...BASE_CASE, ...patch };
  await mock(page, { [`/api/cases/${BASE_CASE.id}`]: kase, [`/api/orders/${BASE_CASE.order.id}`]: BASE_CASE.order }, writes);
  await page.goto(`/cases/detail/?id=${BASE_CASE.id}&step=${step}`);
  const later = page.getByRole('button', { name: 'ไว้ทีหลัง' });
  await later.click({ timeout: 4000 }).catch(() => {});
};
const unlockBtn = (page) => page.getByTestId('edit-lock-state').locator('..').getByRole('button', { name: 'เปิดการแก้ไข', exact: true });

test('รับลูกค้า: ล็อก · เปิดแล้วแก้ได้ · ยกเลิกแล้วค่าเดิมกลับ', async ({ page }) => {
  const writes = [];
  await openCase(page, 'reception', { reception_note: 'เดิม' }, writes);
  const note = page.locator('textarea[name="reception_note"]');
  await expect(note).toBeDisabled();
  await expect(page.getByRole('button', { name: 'บันทึกข้อมูลการรับเคส' })).toHaveCount(0);
  await unlockBtn(page).click();
  await expect(note).toBeEnabled();
  await note.fill('ใหม่');
  await page.getByRole('button', { name: 'ยกเลิกการแก้ไข' }).click();
  await expect(note).toHaveValue('เดิม');
  await expect(note).toBeDisabled();
  expect(writes).toEqual([]);
});

test('วัด Center: ค่าที่บันทึกแล้วล็อก ไม่มีปุ่มบันทึก Draft และเพิ่มรูปไม่ได้', async ({ page }) => {
  await openCase(page, 'centering', { centering: { id: 5, r_pd: '31', center_point_note: 'เดิม' } }, []);
  const note = page.getByPlaceholder(/ลูกค้าใช้สายตาขับรถ/);
  await expect(note).toBeDisabled();
  await expect(page.getByRole('button', { name: 'บันทึก Draft' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'เพิ่มรูป' })).toBeDisabled();
  await unlockBtn(page).click();
  await expect(note).toBeEnabled();
  await expect(page.getByRole('button', { name: 'บันทึก Draft' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'เพิ่มรูป' })).toBeEnabled();
});

test('วัด Center ที่ยังไม่เคยบันทึก: กรอกได้เลย', async ({ page }) => {
  await openCase(page, 'centering', { centering: null }, []);
  await expect(page.getByPlaceholder(/ลูกค้าใช้สายตาขับรถ/)).toBeEnabled();
  await expect(page.getByTestId('edit-lock-state')).toHaveCount(0);
});

test('งานด่วน: ต้องเปิดก่อนถึงสลับได้', async ({ page }) => {
  const writes = [];
  await openCase(page, 'reception', {}, writes);
  await expect(page.locator('button.rush-toggle')).toHaveCount(0);
  await page.getByRole('button', { name: 'เปิดการแก้ไขงานด่วน' }).click();
  await expect(page.locator('button.rush-toggle')).toBeVisible();
  expect(writes).toEqual([]);
});

test('แก้ลูกค้าจากลิงก์ตรง: ล็อกก่อน', async ({ page }) => {
  await mock(page, { '/api/customers/7': { id: 7, first_name: 'ก', notes: 'เดิม' } });
  await page.goto('/customers/edit/?id=7');
  const notes = page.locator('textarea[name="notes"]');
  await expect(notes).toBeDisabled();
  await expect(page.getByRole('button', { name: 'บันทึกการแก้ไข' })).toHaveCount(0);
  await unlockBtn(page).click();
  await expect(notes).toBeEnabled();
  await expect(page.getByRole('button', { name: 'บันทึกการแก้ไข' })).toBeVisible();
});

test('ลูกค้าใหม่: ไม่ล็อก', async ({ page }) => {
  await mock(page);
  await page.goto('/customers/new/');
  await expect(page.locator('textarea[name="notes"]')).toBeEnabled();
  await expect(page.getByTestId('edit-lock-state')).toHaveCount(0);
});

test('แก้ออเดอร์จากลิงก์ตรง: ล็อกก่อน', async ({ page }) => {
  const o = BASE_CASE.order;
  await mock(page, { [`/api/orders/${o.id}`]: { ...o, notes: 'เดิม' }, [`/api/cases/${BASE_CASE.id}`]: BASE_CASE });
  await page.goto(`/orders/edit/?id=${o.id}`);
  await expect(page.locator('textarea[name="notes"]')).toBeDisabled();
  await unlockBtn(page).click();
  await expect(page.locator('textarea[name="notes"]')).toBeEnabled();
});

test('แก้การจองจากลิงก์ตรง: ล็อกก่อน', async ({ page }) => {
  await mock(page, { '/api/bookings/3': { id: 3, booking_date: '2026-11-01', booking_time: '10:00', notes: 'เดิม' } });
  await page.goto('/bookings/edit/?id=3');
  await expect(page.locator('textarea[name="notes"]')).toBeDisabled();
  await unlockBtn(page).click();
  await expect(page.locator('textarea[name="notes"]')).toBeEnabled();
});

test('พนักงาน: ปุ่มเปิด/ปิดใช้งานซ่อนหลังเปิดการแก้ไข', async ({ page }) => {
  await mock(page, { '/api/employees': [{ id: 9, employee_name: 'ช่าง', active: 1 }] });
  await page.goto('/employees/');
  await expect(page.getByRole('button', { name: 'ปิดใช้งาน' })).toHaveCount(0);
  await page.getByRole('button', { name: 'เปิดการแก้ไข', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'ปิดใช้งาน' }).first()).toBeVisible();
});
