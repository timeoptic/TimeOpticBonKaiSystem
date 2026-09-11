/**
 * ประวัติการรับเงิน — ปุ่ม "แก้ไข" เฉพาะ Admin/Owner
 *
 * ร้านขอ 11 ก.ย. 2026: แอดมินขึ้นไปแก้รายการรับเงินได้ผ่านป๊อปอัป · บังคับใส่เหตุผล
 * · แก้เวลารับได้ · แก้จนเกินยอดคงเหลือไม่ได้ (ไม่นับรายการที่กำลังแก้) · ด่านจริงอยู่ที่
 * API (api/tests/97-payment-edit.test.php) ที่นี่ตรวจว่าใครเห็นปุ่ม และป๊อปอัปส่งอะไร
 *
 * รันเดี่ยวได้โดยไม่ต้องมีรหัสบัญชี test.*:
 *   E2E_BASE_URL=http://localhost:3010 npx playwright test payment-edit --project=tablet-1024 --no-deps
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

const CASE = JSON.parse(readFileSync(new URL('./fixtures/case-payment.json', import.meta.url), 'utf8'));
const EMPLOYEES = [{ id: 680, employee_name: 'พนักงานทดสอบ' }, { id: 681, employee_name: 'Tik' }];

const SALES = {
  id: 2, username: 'e2e.sales', displayName: 'พนักงานขาย', roleText: 'Sales',
  roles: ['sales'], perms: ['frontdesk.use', 'case.view_all'], home: '/', mustChangePassword: false,
};
const ADMIN = {
  id: 1, username: 'e2e.admin', displayName: 'แอดมินทดสอบ', roleText: 'Admin',
  roles: ['admin'], perms: ['frontdesk.use', 'case.view_all', 'money.zone', 'system.zone', 'users.manage'],
  home: '/', mustChangePassword: false,
};
const META = {
  lists: { pay_type: ['Cash', 'Transfer'], pay_type_labels: { Cash: 'เงินสด', Transfer: 'โอน' } },
  employees: EMPLOYEES, statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '2026-09-11', now: '2026-09-11 10:00:00',
};

/* เคส 950 บาท รับมัดจำไปแล้ว 950 หนึ่งรายการ และมีอีกรายการที่ยกเลิกไปแล้ว */
const PAYMENT = {
  id: 9001, amount: '950.00', kind: 'deposit', method: 'Cash', reference: null,
  received_by: 680, received_by_name: 'พนักงานทดสอบ', paid_at: '2026-09-11 10:00:00', cancelled_at: null,
};
const CANCELLED = {
  id: 9000, amount: '950.00', kind: 'deposit', method: 'Cash', reference: null,
  received_by: 680, received_by_name: 'พนักงานทดสอบ', paid_at: '2026-09-11 09:59:00', cancelled_at: '2026-09-11 10:05:00',
};

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

async function openPayment(page, actor) {
  const state = { ...CASE, paid: 950, balance: 0, payments: [PAYMENT, CANCELLED] };
  const puts = [];
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p.endsWith('/api/auth/me')) return reply(route, actor);
    if (p.endsWith('/api/meta')) return reply(route, META);
    if (p.endsWith(`/api/cases/${CASE.id}`)) return reply(route, state);
    if (p.endsWith(`/api/payments/${PAYMENT.id}`) && req.method() === 'PUT') {
      const body = req.postDataJSON();
      puts.push(body);
      state.payments = [{ ...PAYMENT, amount: String(body.amount), method: body.method }, CANCELLED];
      state.paid = Number(body.amount);
      state.balance = 950 - Number(body.amount);
      return reply(route, { ...PAYMENT, ...body });
    }
    return reply(route, []);
  });
  await page.goto(`/cases/detail/?id=${CASE.id}&step=payment`);
  await expect(page.getByRole('heading', { name: 'ประวัติการรับเงิน' })).toBeVisible({ timeout: 20_000 });
  return { puts };
}

const feed = (page) => page.locator('.pay-feed');
const editDialog = (page) => page.locator('.modal').filter({ has: page.getByRole('heading', { name: 'แก้ไขรายการรับเงิน' }) });

test.describe('ประวัติการรับเงิน — แก้ไขเฉพาะ Admin/Owner', () => {
  test('พนักงานขายไม่เห็นปุ่มแก้ไข', async ({ page }) => {
    await openPayment(page, SALES);
    await expect(feed(page).locator('.pay-ev')).toHaveCount(2);
    await expect(feed(page).getByRole('button', { name: 'แก้ไข' })).toHaveCount(0);
  });

  test('แอดมินเห็นปุ่มแก้ไข เฉพาะรายการที่ยังไม่ยกเลิก', async ({ page }) => {
    await openPayment(page, ADMIN);
    await expect(feed(page).getByRole('button', { name: 'แก้ไข' })).toHaveCount(1);
    await expect(feed(page).locator('.pay-ev.cancelled').getByRole('button', { name: 'แก้ไข' })).toHaveCount(0);
  });

  test('แอดมินแก้จำนวนและวิธีชำระ — ต้องใส่เหตุผล ยืนยันสรุปก่อน แล้วส่งค่าที่แก้', async ({ page }) => {
    const { puts } = await openPayment(page, ADMIN);
    await feed(page).getByRole('button', { name: 'แก้ไข' }).click();

    const dlg = editDialog(page);
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('#pe-amount')).toHaveValue('950');
    await expect(dlg).toContainText('พนักงานทดสอบ');

    await dlg.locator('#pe-amount').fill('900');
    await dlg.getByRole('button', { name: /โอน/ }).click();
    const save = dlg.getByRole('button', { name: 'บันทึกการแก้ไข' });
    /* ยังไม่ใส่เหตุผล */
    await expect(save).toBeDisabled();
    await dlg.locator('#pe-reason').fill('กดจำนวนผิด');
    await expect(save).toBeEnabled();
    await save.click();

    const sure = page.locator('.modal').filter({ has: page.getByRole('heading', { name: 'ยืนยันแก้ไขรายการรับเงิน' }) });
    await expect(sure).toContainText('฿950.00');
    await expect(sure).toContainText('฿900.00');
    await expect(sure).toContainText('กดจำนวนผิด');
    await sure.getByRole('button', { name: 'ยืนยันแก้ไข' }).click();

    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]).toMatchObject({
      amount: '900', method: 'Transfer', kind: 'deposit', received_by: '680',
      paid_at: '2026-09-11 10:00:00', reason: 'กดจำนวนผิด',
    });
    await expect(page.locator('.modal')).toHaveCount(0);
    await expect(feed(page)).toContainText('฿900.00');
  });

  test('แก้จนเกินยอดคงเหลือ ปุ่มบันทึกปิด', async ({ page }) => {
    const { puts } = await openPayment(page, ADMIN);
    await feed(page).getByRole('button', { name: 'แก้ไข' }).click();
    const dlg = editDialog(page);
    await dlg.locator('#pe-reason').fill('ทดสอบ');
    /* ออเดอร์ 950 และไม่มีรายการอื่นที่ยังไม่ยกเลิก — แก้ได้ไม่เกิน 950 */
    await dlg.locator('#pe-amount').fill('951');
    await expect(dlg).toContainText('เกินยอด');
    await expect(dlg.getByRole('button', { name: 'บันทึกการแก้ไข' })).toBeDisabled();
    await dlg.locator('#pe-amount').fill('950');
    /* ค่ากลับมาเท่าเดิมทุกช่อง — ไม่มีอะไรให้บันทึก */
    await expect(dlg.getByRole('button', { name: 'บันทึกการแก้ไข' })).toBeDisabled();
    expect(puts).toHaveLength(0);
  });
});
