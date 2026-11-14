/**
 * ใบเสร็จออกเมื่อกด "ออกใบเสร็จ" + ติดตามการพิมพ์ (ร้านขอ 13 ต.ค. 2026)
 *
 * ด่านจริงอยู่ที่ API (api/tests/41-receipt-numbering.test.php) ที่นี่ตรวจหน้าจอ:
 *   - เปิดหน้าใบเสร็จของบิลที่ยังไม่ออก → ไม่มีปุ่มพิมพ์ มีปุ่มออกใบเสร็จ
 *   - กดพิมพ์ → ลงประวัติ · กล่องพิมพ์ปิด → UNKNOWN · พนักงานกด "ออกแล้ว" → CONFIRMED
 *   - หน้าเคสมีส่วน "ใบเสร็จรับเงิน" ปุ่มตามสถานะ
 *
 *   E2E_BASE_URL=http://localhost:3010 npx playwright test receipt-tracking --project=tablet-1024 --no-deps
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

const CASE = JSON.parse(readFileSync(new URL('./fixtures/case-payment.json', import.meta.url), 'utf8'));
const ORDER = CASE.order;
const ACTOR = {
  id: 1, username: 'e2e.admin', displayName: 'แอดมินทดสอบ', roleText: 'Admin',
  /* receipt.issue — ปุ่มออกใบเสร็จเห็นเฉพาะคนในรายชื่อ (Pom/Tik/Bow) */
  roles: ['admin'], perms: ['frontdesk.use', 'case.view_all', 'money.zone', 'system.zone', 'receipt.issue'],
  home: '/', mustChangePassword: false,
};
const META = {
  lists: { pay_type: ['Cash'], pay_type_labels: { Cash: 'เงินสด' } },
  employees: [], statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '2026-10-13', now: '2026-10-13 10:00:00',
};
const ISSUED = {
  id: 501, receipt_no: 'Bill-2026-10-00343', order_id: ORDER.id, sale_id: null, source_type: 'CASE',
  source_id: ORDER.id, status: 'ISSUED', doc_date: '2026-10-13', total_amount: '950.00',
  issued_at: '2026-10-13 10:05:00', issued_by_name: 'แอดมินทดสอบ', print_count: 0,
  print_status: 'NOT_REQUESTED', payments: [], paid_total: 0,
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

async function mock(page, state) {
  const calls = [];
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const m = req.method();
    if (m !== 'OPTIONS' && p.includes('/api/receipt')) calls.push({ m, p, body: req.postDataJSON?.() ?? null });
    if (p.endsWith('/api/auth/me')) return reply(route, ACTOR);
    if (p.endsWith('/api/meta')) return reply(route, META);
    if (p.endsWith(`/api/orders/${ORDER.id}`)) return reply(route, ORDER);
    if (p.endsWith(`/api/cases/${CASE.id}`)) return reply(route, CASE);
    if (p.endsWith('/api/receipts/issue')) { state.rc = { ...ISSUED }; return reply(route, state.rc); }
    if (p.endsWith('/api/receipts') && m === 'POST') {
      return reply(route, state.rc || { id: null, receipt_no: null, status: 'NOT_ISSUED', print_status: 'NOT_REQUESTED' });
    }
    if (p.endsWith(`/api/receipts/${ISSUED.id}/prints`) && m === 'POST') {
      state.rc = { ...state.rc, print_count: (state.rc.print_count || 0) + 1, print_status: 'REQUESTED' };
      return reply(route, { id: 9100 + state.rc.print_count, attempt_no: state.rc.print_count, status: 'REQUESTED' });
    }
    if (p.includes('/api/receipt-prints/') && m === 'PUT') {
      state.rc = { ...state.rc, print_status: req.postDataJSON().status };
      return reply(route, { id: 1, status: req.postDataJSON().status });
    }
    if (p.endsWith('/api/receipts/for')) {
      return reply(route, [{
        source_type: 'CASE', source_id: ORDER.id, source_no: ORDER.invoice_code, bill_date: ORDER.order_date,
        bill_total: 950, receipt: state.rc || null, history: [],
      }]);
    }
    return reply(route, []);
  });
  return calls;
}

test('หน้าใบเสร็จ: ยังไม่ออก → ไม่มีปุ่มพิมพ์ · ออกใบ → พิมพ์ → ถามผล → ยืนยัน', async ({ page }) => {
  const state = {};
  const calls = await mock(page, state);
  await page.addInitScript(() => {
    window.print = () => setTimeout(() => window.dispatchEvent(new Event('afterprint')), 50);
  });
  await page.goto(`/print/receipt/?order=${ORDER.id}`);
  await expect(page.getByText('ยังไม่ได้ออกใบเสร็จ')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /พิมพ์ใบเสร็จ/ })).toHaveCount(0);
  expect(calls.some((c) => c.p.endsWith('/issue'))).toBe(false);

  await page.getByRole('button', { name: 'ออกใบเสร็จ' }).first().click();
  /* กล่องยืนยันมีช่องวันที่บนใบ ค่าเริ่มวันนี้ และบอกชุดเลขของเดือนที่เลือก */
  const modal = page.locator('.modal');
  await expect(modal.getByText('วันที่บนใบเสร็จ')).toBeVisible();
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  await expect(modal.getByText(`Bill-${ym}-xxxxx`, { exact: false })).toBeVisible();
  await modal.screenshot({ path: 'test-results/receipt-issue-date.png' });
  await modal.getByRole('button', { name: 'ออกใบเสร็จ' }).click();
  await expect(page.getByText('Bill-2026-10-00343').first()).toBeVisible();
  const issueCall = calls.find((c) => c.p.endsWith('/issue'));
  expect(issueCall.body.order_id).toBe(ORDER.id);
  expect(issueCall.body.idem_key).toBeTruthy();
  expect(issueCall.body.doc_date).toMatch(new RegExp(`^${ym}-\\d{2}$`));

  await page.getByRole('button', { name: /พิมพ์ใบเสร็จ/ }).click();
  await expect(page.getByText(/กระดาษออกมาหรือไม่/)).toBeVisible();
  expect(calls.filter((c) => c.p.endsWith('/prints')).length).toBe(1);
  expect(calls.some((c) => c.m === 'PUT' && c.body?.status === 'UNKNOWN')).toBe(true);
  expect(calls.some((c) => c.body?.status === 'CONFIRMED')).toBe(false);

  await page.getByRole('button', { name: 'ออกแล้ว' }).click();
  await expect(page.getByText(/กระดาษออกมาหรือไม่/)).toHaveCount(0);
  expect(calls.some((c) => c.m === 'PUT' && c.body?.status === 'CONFIRMED')).toBe(true);
  expect(calls.filter((c) => c.p.endsWith('/issue')).length).toBe(1);
  await page.screenshot({ path: 'test-results/receipt-print-page.png', fullPage: false });
});

test('หน้าเคส: ส่วนใบเสร็จรับเงิน ยังไม่ออก → ปุ่มออกใบเสร็จ · ออกแล้ว → ดู/พิมพ์ซ้ำ/ประวัติ', async ({ page }) => {
  const state = {};
  await mock(page, state);
  await page.goto(`/cases/detail/?id=${CASE.id}`);
  const panel = page.locator('.card', { has: page.getByText('ใบเสร็จรับเงิน', { exact: true }) });
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByRole('button', { name: 'ออกใบเสร็จ' })).toBeVisible();
  await panel.screenshot({ path: 'test-results/receipt-panel-none.png' });

  state.rc = { ...ISSUED, print_count: 2, print_status: 'UNKNOWN', last_printed_at: '2026-10-13 10:10:00' };
  await page.reload();
  await expect(panel.getByText('Bill-2026-10-00343')).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByRole('link', { name: 'ดูใบเสร็จ' })).toBeVisible();
  await expect(panel.getByRole('link', { name: /พิมพ์ซ้ำ/ })).toHaveAttribute('href', /print=1/);
  await expect(panel.getByText('ไม่ทราบผลการพิมพ์')).toBeVisible();
  await panel.screenshot({ path: 'test-results/receipt-panel-issued.png' });
});
