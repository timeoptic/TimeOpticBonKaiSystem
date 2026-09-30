/**
 * เตือน "ยังไม่ได้ยืนยันรายการขาย" บนขั้นชำระเงิน / ส่งมอบ — หน้าต่างลอยตอนเปิดขั้น
 * แล้วเหลือแถบค้างไว้หลังกดปิด
 *
 * เหตุการณ์จริง 30 ก.ย. 2026: 70 จาก 216 เคสมีออเดอร์แต่ไม่มีใครกดยืนยันรายการขาย
 * (16 เคสส่งมอบไปแล้ว) ของจึงไม่ถูกตัดออกจากคลัง — คนกด "บันทึกการแก้ไข" แล้วเดินต่อ
 * เพราะขั้นถัดไปไม่รอขั้นขาย
 *
 * จำลองคำตอบของ API ด้วย page.route แบบเดียวกับ payment-guard.spec.js · ด่านจริงของ
 * การยืนยัน (ข้อมูลครบ, ตัดสต็อก) อยู่ที่ api/routes/processes.php ที่นี่ตรวจว่าหน้าเว็บ
 * เตือนถูกเคส ยิงยืนยันถูก endpoint และเลิกเตือนเมื่อยืนยันแล้ว
 *
 * รันเดี่ยวได้โดยไม่ต้องมีรหัสบัญชี test.*:
 *   E2E_BASE_URL=http://localhost:3010 npx playwright test sales-unconfirmed --project=tablet-1024 --no-deps
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
  lists: { pay_type: ['Cash', 'Transfer'], pay_type_labels: { Cash: 'เงินสด', Transfer: 'โอน' } },
  employees: [{ id: 680, employee_name: 'พนักงานทดสอบ' }], statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '2026-09-11', now: '2026-09-11 10:00:00',
};

const SALES = CASE.processes.sales;
/* ข้อมูลครบ ยังไม่มีแถวใน case_processes = "เสร็จแล้ว" แบบคำนวณ ยังไม่มีใครกด */
const READY = { ...SALES, status: 'completed', stored: 0, completed_at: null, missing: [] };
const CONFIRMED = { ...READY, stored: 1, started_at: '2026-09-11 10:00:00', completed_at: '2026-09-11 10:00:00' };

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

/** เปิดขั้น `step` ของเคสจำลองที่ขั้นขายเป็น `sales` · POST ยืนยันขายสำเร็จ = เคสกลายเป็นยืนยันแล้ว */
async function openCase(page, sales, step = 'payment', patch = {}) {
  const state = { ...CASE, ...patch, processes: { ...CASE.processes, sales } };
  const completes = [];

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p.endsWith('/api/auth/me')) return reply(route, ACTOR);
    if (p.endsWith('/api/meta')) return reply(route, META);
    if (p.endsWith(`/api/cases/${CASE.id}`)) return reply(route, state);
    if (p.endsWith(`/api/cases/${CASE.id}/processes/sales/complete`) && req.method() === 'POST') {
      completes.push(req.postDataJSON());
      state.processes = { ...state.processes, sales: CONFIRMED };
      return reply(route, state.processes);
    }
    return reply(route, []);
  });

  await page.goto(`/cases/detail/?id=${CASE.id}&step=${step}`);
  await expect(page.locator('.process-card')).toBeVisible({ timeout: 20_000 });
  return { completes };
}

const notice = (page) => page.locator('.process-notice');
const popup = (page) => page.locator('.sales-unconfirmed-modal');

test.describe('เตือนว่ายังไม่ได้ยืนยันรายการขาย', () => {
  test('ข้อมูลครบแต่ยังไม่ยืนยัน — หน้าต่างเด้งขึ้น กดยืนยันได้เลย แล้วคำเตือนหายทั้งหมด', async ({ page }) => {
    const { completes } = await openCase(page, READY);

    await expect(popup(page)).toContainText('ยังไม่ได้ยืนยันรายการขาย');
    await popup(page).getByRole('button', { name: 'ยืนยันรายการขาย' }).click();

    await expect(popup(page)).toHaveCount(0);
    await expect(notice(page)).toHaveCount(0);
    expect(completes).toHaveLength(1);
  });

  test('กด "ไว้ทีหลัง" — หน้าต่างปิด แถบเตือนยังค้างอยู่และกดยืนยันจากแถบได้', async ({ page }) => {
    const { completes } = await openCase(page, READY);

    await popup(page).getByRole('button', { name: 'ไว้ทีหลัง' }).click();
    await expect(popup(page)).toHaveCount(0);
    await expect(notice(page)).toContainText('ยังไม่ได้ยืนยันรายการขาย');

    await notice(page).getByRole('button', { name: 'ยืนยันรายการขาย' }).click();
    await expect(notice(page)).toHaveCount(0);
    expect(completes).toHaveLength(1);
  });

  test('รายการขายยังไม่ครบ — บอกว่าขาดอะไร ไม่มีปุ่มยืนยัน และพาไปขั้นขายได้', async ({ page }) => {
    await openCase(page, SALES, 'delivery');

    await expect(popup(page)).toContainText('รายการขายยังขาด: กรอบแว่น, เลนส์');
    await expect(popup(page).getByRole('button', { name: 'ยืนยันรายการขาย' })).toHaveCount(0);

    await popup(page).getByRole('button', { name: 'ดูรายการขาย' }).click();
    await expect(page).toHaveURL(/step=sales/);
    await expect(popup(page)).toHaveCount(0);
    await expect(notice(page)).toHaveCount(0);
  });

  test('ยืนยันรายการขายแล้ว — ไม่เตือน', async ({ page }) => {
    await openCase(page, CONFIRMED);
    await expect(popup(page)).toHaveCount(0);
    await expect(notice(page)).toHaveCount(0);
  });

  test('เคสที่นำเข้าจากระบบเก่า (OLD-) — ไม่เตือน', async ({ page }) => {
    await openCase(page, READY, 'payment', { case_code: 'OLD-010247' });
    await expect(popup(page)).toHaveCount(0);
    await expect(notice(page)).toHaveCount(0);
  });
});
