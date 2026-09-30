/**
 * ขั้นชำระเงิน — กันบันทึกรับเงินเกิน / ซ้ำ
 *
 * เหตุการณ์จริง 11 ก.ย. 2026: ออเดอร์เดียวถูกบันทึก ฿2,900 สามครั้งห่างกันไม่กี่วินาที
 * เพราะปุ่มไม่ล็อกระหว่างส่ง จำนวนเงินค้างอยู่หลังบันทึก และคำเตือนรับเกินหายไปตอนยอดครบ
 *
 * จำลองคำตอบของ API ด้วย page.route — เคสมาจาก GET /api/cases/:id ของจริง (fixture ที่
 * สร้างใน transaction แล้ว rollback ทิ้ง ดู fixtures/case-payment.json) · ด่านจริงของ
 * รับเกินยอดและรายการซ้ำอยู่ที่ API (api/tests/95-payment-guards.test.php) ที่นี่ตรวจว่า
 * หน้าเว็บถาม ล็อก และส่งซ้ำพร้อมคำยืนยันถูกต้อง
 *
 * รันเดี่ยวได้โดยไม่ต้องมีรหัสบัญชี test.*:
 *   E2E_BASE_URL=http://localhost:3010 npx playwright test payment-guard --project=tablet-1024 --no-deps
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

const CASE = JSON.parse(readFileSync(new URL('./fixtures/case-payment.json', import.meta.url), 'utf8'));
const EMPLOYEE = { id: 680, employee_name: 'พนักงานทดสอบ' };

const ACTOR = {
  id: 1, username: 'e2e.sales', displayName: 'พนักงานทดสอบ', roleText: 'Sales',
  roles: ['sales'], perms: ['frontdesk.use'], home: '/', mustChangePassword: false,
};
const META = {
  lists: { pay_type: ['Cash', 'Transfer'], pay_type_labels: { Cash: 'เงินสด', Transfer: 'โอน' } },
  employees: [EMPLOYEE], statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '2026-09-11', now: '2026-09-11 10:00:00',
};

const DUPLICATE = {
  error: 'เพิ่งบันทึกรับเงิน 950.00 บาท ไปเมื่อ 4 วินาทีก่อน — ถ้าไม่ใช่รายการซ้ำ ให้ยืนยันแล้วบันทึกอีกครั้ง',
  reason: 'possible_duplicate',
  duplicate: { id: 9001, amount: 950, seconds_ago: 4, received_by_name: EMPLOYEE.employee_name },
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

/**
 * เปิดขั้นชำระเงินของเคสจำลอง · `onPay(body, n)` ตอบ POST /api/payments ครั้งที่ n
 * (คืน [status, body]) · ยอดของเคสขยับตามการรับเงินที่ผ่าน เหมือน API จริง
 */
async function openPayment(page, { patch = {}, onPay } = {}) {
  const state = {
    ...CASE,
    ...patch,
    order: { ...CASE.order, ...(patch.order || {}) },
    /* ขั้นขายยืนยันแล้ว — ไม่งั้นหน้าต่าง "ยังไม่ได้ยืนยันรายการขาย" เด้งมาบังฟอร์มรับเงิน
       (เรื่องนั้นตรวจใน sales-unconfirmed.spec.js) */
    processes: {
      ...CASE.processes,
      sales: {
        ...CASE.processes.sales, status: 'completed', stored: 1, missing: [],
        started_at: '2026-09-11 10:00:00', completed_at: '2026-09-11 10:00:00',
      },
    },
  };
  const posts = [];

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p.endsWith('/api/auth/me')) return reply(route, ACTOR);
    if (p.endsWith('/api/meta')) return reply(route, META);
    if (p.endsWith(`/api/cases/${CASE.id}`)) return reply(route, state);
    if (p.endsWith('/api/payments') && req.method() === 'POST') {
      const body = req.postDataJSON();
      posts.push(body);
      const [status, res] = await onPay(body, posts.length);
      if (status === 200) {
        const amount = Number(body.amount);
        state.paid = Number(state.paid) + amount;
        state.balance = Math.max(0, Number(state.balance) - amount);
        state.payments = [{
          id: res.id, amount, kind: body.kind, method: body.method, paid_at: '2026-09-11 10:00:00',
          received_by_name: EMPLOYEE.employee_name, cancelled_at: null,
        }, ...(state.payments || [])];
      }
      return reply(route, res, status);
    }
    return reply(route, []);
  });

  await page.goto(`/cases/detail/?id=${CASE.id}&step=payment`);
  await expect(page.getByRole('heading', { name: 'รับเงินเข้ามาใหม่' })).toBeVisible({ timeout: 20_000 });
  return { posts, state };
}

const saveButton = (page) => page.locator('.pay-actions button[type="submit"]');
const amountInput = (page) => page.locator('.pay-amount-input input');
const dialog = (page) => page.locator('.modal');

async function pickReceiver(page) {
  await page.locator('.sel-trigger').filter({ hasText: 'เลือกพนักงาน' }).click();
  await page.getByRole('option', { name: EMPLOYEE.employee_name }).click();
}

test.describe('ขั้นชำระเงิน — กันบันทึกเกินและซ้ำ', () => {
  test('ถามยืนยันพร้อมสรุปก่อนส่ง · ระหว่างส่งปุ่มล็อก · เสร็จแล้วล้างจำนวนเงินและปุ่มกลายเป็น "ชำระครบแล้ว"', async ({ page }) => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { posts } = await openPayment(page, {
      onPay: async () => { await gate; return [200, { id: 9001 }]; },
    });

    await pickReceiver(page);
    await expect(amountInput(page)).toHaveValue('950');

    /* ยกเลิกในกล่องสรุป = ไม่มีอะไรถูกส่ง */
    await saveButton(page).click();
    await expect(dialog(page).getByRole('heading', { name: 'ยืนยันบันทึกการรับเงิน' })).toBeVisible();
    await expect(dialog(page)).toContainText(EMPLOYEE.employee_name);
    await expect(dialog(page)).toContainText('เงินสด');
    await dialog(page).getByRole('button', { name: 'ยกเลิก' }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(posts).toHaveLength(0);

    await saveButton(page).click();
    await dialog(page).getByRole('button', { name: /^ยืนยันบันทึก/ }).click();

    /* คำขอยังค้างอยู่ — ปุ่มต้องกดซ้ำไม่ได้ */
    await expect(saveButton(page)).toBeDisabled();
    await expect(saveButton(page)).toContainText('กำลังบันทึก');
    await saveButton(page).click({ force: true });
    expect(posts).toHaveLength(1);

    release();
    await expect(saveButton(page)).toContainText('ชำระครบแล้ว');
    await expect(saveButton(page)).toBeDisabled();
    await expect(amountInput(page)).toHaveValue('');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ amount: '950', received_by: String(EMPLOYEE.id), case_id: CASE.id, order_id: CASE.order.id });
    expect(posts[0].confirm_duplicate).toBeUndefined();
  });

  test('API ตอบว่าอาจซ้ำ → ถามอีกครั้ง แล้วส่งใหม่พร้อม confirm_duplicate', async ({ page }) => {
    const { posts } = await openPayment(page, {
      onPay: async (body) => (body.confirm_duplicate ? [200, { id: 9002 }] : [409, DUPLICATE]),
    });

    await pickReceiver(page);
    await saveButton(page).click();
    await dialog(page).getByRole('button', { name: /^ยืนยันบันทึก/ }).click();

    await expect(dialog(page).getByRole('heading', { name: 'อาจเป็นรายการซ้ำ' })).toBeVisible();
    await expect(dialog(page)).toContainText('4 วินาที');
    await dialog(page).getByRole('button', { name: 'ไม่ซ้ำ — บันทึกอีกรายการ' }).click();

    await expect(saveButton(page)).toContainText('ชำระครบแล้ว');
    expect(posts).toHaveLength(2);
    expect(posts[1].confirm_duplicate).toBe(true);
  });

  test('อาจซ้ำ แล้วกดยกเลิก → ไม่ส่งซ้ำ ฟอร์มยังอยู่ให้แก้', async ({ page }) => {
    const { posts } = await openPayment(page, { onPay: async () => [409, DUPLICATE] });

    await pickReceiver(page);
    await saveButton(page).click();
    await dialog(page).getByRole('button', { name: /^ยืนยันบันทึก/ }).click();
    await dialog(page).getByRole('button', { name: 'ยกเลิก' }).click();

    await expect(dialog(page)).toHaveCount(0);
    await expect(saveButton(page)).toBeEnabled();
    await expect(amountInput(page)).toHaveValue('950');
    expect(posts).toHaveLength(1);
  });

  test('ใส่เกินยอดคงเหลือ → ปุ่มปิดพร้อมบอกเหตุผล', async ({ page }) => {
    const { posts } = await openPayment(page, { onPay: async () => [200, { id: 1 }] });

    await pickReceiver(page);
    await amountInput(page).fill('1000');
    await expect(saveButton(page)).toBeDisabled();
    await expect(page.locator('.pay-actions .process-blockers')).toContainText('รับเกินยอดคงเหลือไม่ได้');
    await expect(page.locator('.pay-after')).toContainText('รับไม่ได้');

    await amountInput(page).fill('950');
    await expect(saveButton(page)).toBeEnabled();
    expect(posts).toHaveLength(0);
  });

  test('ชำระครบแล้วตั้งแต่เปิดหน้า → ปุ่มปิด รับเพิ่มไม่ได้', async ({ page }) => {
    await openPayment(page, {
      patch: { paid: 950, balance: 0 },
      onPay: async () => [200, { id: 1 }],
    });

    await pickReceiver(page);
    await amountInput(page).fill('100');
    await expect(saveButton(page)).toBeDisabled();
    await expect(saveButton(page)).toContainText('ชำระครบแล้ว');
    await expect(page.locator('.pay-after')).toContainText('ชำระครบแล้ว');
  });

  test('ออเดอร์ยังไม่มีราคา → รับมัดจำได้', async ({ page }) => {
    const { posts } = await openPayment(page, {
      patch: { balance: 0, order: { total_price: 0, discount: 0 } },
      onPay: async () => [200, { id: 9003 }],
    });

    await pickReceiver(page);
    await expect(page.locator('.pay-after')).toContainText('ออเดอร์ยังไม่มีราคา');
    await amountInput(page).fill('500');
    await expect(saveButton(page)).toBeEnabled();
    await saveButton(page).click();
    await expect(dialog(page)).toContainText('ออเดอร์ยังไม่มีราคา');
    await dialog(page).getByRole('button', { name: /^ยืนยันบันทึก/ }).click();
    await expect(amountInput(page)).toHaveValue('');
    expect(posts).toHaveLength(1);
  });
});
