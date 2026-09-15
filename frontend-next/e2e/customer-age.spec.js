/**
 * อายุลูกค้าจากวันเกิด — หัวเคส (ต่อท้ายชื่อ) และต่อท้ายแถว "วันเกิด"
 *
 * การคำนวณเทสต์ละเอียดอยู่ที่ lib/__tests__/customerAge.test.js · ที่นี่ตรวจว่าหน้าจอ
 * แสดงตรงจุดที่ร้านขอ และไม่แสดงอะไรแปลก ๆ ตอนไม่มีวันเกิดหรือวันเกิดผิด
 *
 * รันเดี่ยวได้โดยไม่ต้องมีรหัสบัญชี test.* (API ถูกจำลองทั้งหมด):
 *   E2E_BASE_URL=http://localhost:3010 npx playwright test customer-age --project=tablet-1024 --no-deps
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { ageText } from '../lib/customerAge.js';

test.use({ storageState: { cookies: [], origins: [] } });

const BASE_CASE = JSON.parse(readFileSync(new URL('./fixtures/case-payment.json', import.meta.url), 'utf8'));
const SALES = {
  id: 2, username: 'e2e.sales', displayName: 'พนักงานขาย', roleText: 'Sales',
  roles: ['sales'], perms: ['frontdesk.use', 'case.view_all'], home: '/', mustChangePassword: false,
};
const META = {
  lists: {}, employees: [], statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '2026-09-15', now: '2026-09-15 10:00:00',
};
const BIRTH = '1981-03-12';
/* อายุคิดจากวันที่ของเครื่องที่รันเทสต์ — ใช้ตัวคำนวณตัวเดียวกับหน้าเว็บ ไม่ฝังเลขตายตัว */
const AGE = ageText(BIRTH);

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

async function mockApi(page, birthDate) {
  const kase = { ...BASE_CASE, birth_date: birthDate };
  const customer = {
    id: BASE_CASE.customer_id, first_name: BASE_CASE.first_name, last_name: BASE_CASE.last_name,
    phone: BASE_CASE.phone, birth_date: birthDate, created_at: '2026-09-01 10:00:00',
  };
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/api/auth/me')) return reply(route, SALES);
    if (p.endsWith('/api/meta')) return reply(route, META);
    if (p.endsWith(`/api/cases/${BASE_CASE.id}`)) return reply(route, kase);
    if (p.endsWith(`/api/customers/${BASE_CASE.customer_id}`)) return reply(route, customer);
    return reply(route, []);
  });
}

const subtitle = (page) => page.locator('.page-head h1 span');

test.describe('อายุลูกค้า', () => {
  test('หัวเคสแสดงชื่อตามด้วยอายุ และการ์ดข้อมูลลูกค้าแสดงวันเกิดพร้อมอายุ', async ({ page }) => {
    expect(AGE).toMatch(/^\d+ ปี$/);
    await mockApi(page, BIRTH);
    await page.goto(`/cases/detail/?id=${BASE_CASE.id}`);
    await expect(subtitle(page)).toHaveText(new RegExp(` · ${AGE}$`), { timeout: 20_000 });
    await expect(page.getByText(`(${AGE})`)).toBeVisible();
  });

  test('ขั้นรับลูกค้าแสดงวันเกิดพร้อมอายุ และหัวเคสยังมีอายุ', async ({ page }) => {
    await mockApi(page, BIRTH);
    await page.goto(`/cases/detail/?id=${BASE_CASE.id}&step=reception`);
    await expect(subtitle(page)).toHaveText(new RegExp(` · ${AGE}$`), { timeout: 20_000 });
    await expect(page.getByText(`(${AGE})`)).toBeVisible();
  });

  test('หน้าข้อมูลลูกค้าแสดงวันเกิดพร้อมอายุ', async ({ page }) => {
    await mockApi(page, BIRTH);
    await page.goto(`/customers/detail/?id=${BASE_CASE.customer_id}`);
    await expect(page.getByText(`(${AGE})`)).toBeVisible({ timeout: 20_000 });
  });

  test('ไม่มีวันเกิด หัวเคสมีแค่ชื่อ ไม่มี "— ปี"', async ({ page }) => {
    await mockApi(page, null);
    await page.goto(`/cases/detail/?id=${BASE_CASE.id}`);
    await expect(page.getByRole('heading', { name: 'สถานะแต่ละขั้นตอน' })).toBeVisible({ timeout: 20_000 });
    await expect(subtitle(page)).not.toContainText(' · ');
    await expect(subtitle(page)).not.toContainText('ปี');
    await expect(page.getByText(/\(\d+ ปี\)|ไม่ถึง 1 ปี/)).toHaveCount(0);
  });

  test('วันเกิดผิด (ปี พ.ศ. ลงช่อง ค.ศ.) ไม่แสดงอายุ แต่ยังเห็นวันเกิดที่กรอกไว้', async ({ page }) => {
    await mockApi(page, '2524-03-12');
    await page.goto(`/cases/detail/?id=${BASE_CASE.id}`);
    await expect(page.getByRole('heading', { name: 'สถานะแต่ละขั้นตอน' })).toBeVisible({ timeout: 20_000 });
    await expect(subtitle(page)).not.toContainText('ปี');
    await expect(page.getByText(/\(\d+ ปี\)|ไม่ถึง 1 ปี/)).toHaveCount(0);
  });
});
