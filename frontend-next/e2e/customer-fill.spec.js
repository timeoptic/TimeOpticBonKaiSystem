/**
 * ขั้นรับลูกค้า — ป้าย "ข้อมูลลูกค้ายังไม่ครบ" และปุ่ม "เติมข้อมูลลูกค้า"
 *
 * ด่านจริงอยู่ที่ API (api/tests/32-customer-fill.test.php) ที่นี่ตรวจว่าป้ายขึ้นเฉพาะตอน
 * ขาดวันเกิดหรือเบอร์โทร · popup ให้กรอกเฉพาะช่องที่ว่าง · กรอกผิดส่งไม่ได้ · เบอร์ซ้ำเตือนก่อน
 * · ส่งเฉพาะช่องที่กรอก · และยกเลิกแล้วไม่ทิ้งสถานะ "มีข้อมูลยังไม่บันทึก" ไว้ในหน้าเคส
 *
 * รันเดี่ยวได้โดยไม่ต้องมีรหัสบัญชี test.* (API ถูกจำลองทั้งหมด):
 *   E2E_BASE_URL=http://localhost:3010 npx playwright test customer-fill --project=tablet-1024 --no-deps
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
  lists: { sex: ['Male', 'Female'], sex_labels: { Male: 'ชาย', Female: 'หญิง' } },
  employees: [], statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '2026-09-15', now: '2026-09-15 10:00:00',
};
const INCOMPLETE = { birth_date: null, phone: null, line_id: null, email: 'a@b.co', sex: 'Female' };
const COMPLETE = { birth_date: '1981-03-12', phone: '0812345678', line_id: 'line-x', email: 'a@b.co', sex: 'Female' };

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
 * @param {{ customer?: object, events?: object[], duplicates?: object[], fill?: (body: object) => { status: number, body: object } }} opt
 */
async function openReception(page, opt = {}) {
  const state = { ...BASE_CASE, ...(opt.customer || INCOMPLETE), events: opt.events || [] };
  const posts = [];
  const dupAsks = [];
  let caseLoads = 0;
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p.endsWith('/api/auth/me')) return reply(route, SALES);
    if (p.endsWith('/api/meta')) return reply(route, META);
    if (p.endsWith(`/api/cases/${BASE_CASE.id}`)) { caseLoads += 1; return reply(route, state); }
    if (p.endsWith('/api/customers/duplicates') && req.method() === 'POST') {
      dupAsks.push(req.postDataJSON());
      return reply(route, { matches: opt.duplicates || [] });
    }
    if (p.endsWith(`/api/customers/${BASE_CASE.customer_id}/fill`) && req.method() === 'POST') {
      const body = req.postDataJSON();
      posts.push(body);
      if (opt.fill) {
        const r = opt.fill(body);
        return reply(route, r.body, r.status);
      }
      const { case_id: _ignored, ...fields } = body;
      Object.assign(state, fields);
      return reply(route, { customer: { id: BASE_CASE.customer_id, ...fields }, filled: Object.keys(fields) });
    }
    return reply(route, []);
  });
  await page.goto(`/cases/detail/?id=${BASE_CASE.id}&step=reception`);
  await expect(page.getByRole('button', { name: 'บันทึกข้อมูลการรับเคส' })).toBeVisible({ timeout: 20_000 });
  return { posts, dupAsks, state, caseLoads: () => caseLoads };
}

const fillButton = (page) => page.getByRole('button', { name: 'เติมข้อมูลลูกค้า' });
const dialog = (page) => page.getByRole('dialog', { name: 'เติมข้อมูลลูกค้า' });
const saveButton = (page) => dialog(page).getByRole('button', { name: /^(บันทึกข้อมูลลูกค้า|บันทึกต่อ)$/ });

test.describe('ขั้นรับลูกค้า — เติมข้อมูลลูกค้า', () => {
  test('ขาดวันเกิดกับเบอร์โทร ขึ้นป้ายบอกช่องที่ขาด พร้อมปุ่มเติมข้อมูลลูกค้า', async ({ page }) => {
    await openReception(page);
    await expect(page.getByText('ข้อมูลลูกค้ายังไม่ครบ: วันเกิด, เบอร์โทร')).toBeVisible();
    await expect(fillButton(page)).toBeVisible();
  });

  test('ข้อมูลครบทุกช่อง ไม่มีป้ายและไม่มีปุ่ม', async ({ page }) => {
    await openReception(page, { customer: COMPLETE });
    await expect(page.getByText(/ข้อมูลลูกค้ายังไม่ครบ/)).toHaveCount(0);
    await expect(fillButton(page)).toHaveCount(0);
  });

  test('วันเกิดกับเบอร์ครบแล้วแต่ LINE ยังว่าง — ไม่มีป้าย แต่ยังมีปุ่มให้เติม', async ({ page }) => {
    await openReception(page, { customer: { ...COMPLETE, line_id: null } });
    await expect(page.getByText(/ข้อมูลลูกค้ายังไม่ครบ/)).toHaveCount(0);
    await expect(fillButton(page)).toBeVisible();
  });

  test('popup ให้กรอกเฉพาะช่องที่ยังว่าง', async ({ page }) => {
    await openReception(page);
    await fillButton(page).click();
    const dlg = dialog(page);
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.datef-input')).toHaveCount(1);
    await expect(dlg.getByLabel('เบอร์โทร')).toBeVisible();
    await expect(dlg.getByLabel('LINE / WhatsApp')).toBeVisible();
    await expect(dlg.getByText('อีเมล', { exact: true })).toHaveCount(0);
    await expect(dlg.getByText('เพศ', { exact: true })).toHaveCount(0);
  });

  test('กรอกผิด ปุ่มบันทึกกดไม่ได้และบอกเหตุผล · ยังไม่กรอกอะไรก็กดไม่ได้', async ({ page }) => {
    const { posts } = await openReception(page);
    await fillButton(page).click();
    await expect(saveButton(page)).toBeDisabled();
    await dialog(page).getByLabel('เบอร์โทร').fill('12-34');
    await expect(dialog(page)).toContainText('เบอร์โทรต้องมีตัวเลขอย่างน้อย 9 หลัก');
    await expect(saveButton(page)).toBeDisabled();
    expect(posts).toHaveLength(0);
  });

  test('บันทึก — ส่งเฉพาะช่องที่กรอก แล้วป้ายหายและหัวเคสขึ้นอายุ', async ({ page }) => {
    const { posts } = await openReception(page);
    await fillButton(page).click();
    const dlg = dialog(page);
    await dlg.locator('.datef-input').fill('12/03/1981');
    await dlg.locator('.datef-input').blur();
    await dlg.getByLabel('เบอร์โทร').fill('081-234-5678');
    await saveButton(page).click();

    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({ case_id: BASE_CASE.id, birth_date: '1981-03-12', phone: '081-234-5678' });
    await expect(page.locator('.toast.ok')).toContainText('บันทึกข้อมูลลูกค้าแล้ว');
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText(/ข้อมูลลูกค้ายังไม่ครบ/)).toHaveCount(0);
    await expect(page.locator('.page-head h1 span')).toHaveText(new RegExp(` · ${ageText('1981-03-12')}$`));
  });

  test('เบอร์ซ้ำกับลูกค้าคนอื่น — เตือนก่อน ต้องกดบันทึกต่ออีกครั้งถึงจะส่ง', async ({ page }) => {
    const { posts, dupAsks } = await openReception(page, {
      duplicates: [{ id: 99, first_name: 'สมหญิง', last_name: 'ซ้ำเบอร์', phone: '0812345678', why: ['เบอร์โทรตรงกัน'] }],
    });
    await fillButton(page).click();
    await dialog(page).getByLabel('เบอร์โทร').fill('081-234-5678');
    await saveButton(page).click();

    await expect(dialog(page)).toContainText('สมหญิง ซ้ำเบอร์');
    expect(dupAsks[0]).toMatchObject({ phone: '081-234-5678', exclude_id: BASE_CASE.customer_id });
    expect(posts).toHaveLength(0);
    await dialog(page).getByRole('button', { name: 'บันทึกต่อ' }).click();
    await expect.poll(() => posts.length).toBe(1);
  });

  test('มีคนกรอกช่องนั้นไปแล้ว (409) — แจ้งเหตุผลและโหลดข้อมูลเคสใหม่', async ({ page }) => {
    const ctx = await openReception(page, {
      fill: () => ({ status: 409, body: { error: 'ลูกค้ามี เบอร์โทร อยู่แล้ว — รีเฟรชหน้าแล้วดูอีกครั้ง', reason: 'already_filled' } }),
    });
    const loadsBefore = ctx.caseLoads();
    await fillButton(page).click();
    await dialog(page).getByLabel('เบอร์โทร').fill('0812345678');
    await saveButton(page).click();
    await expect(page.locator('.toast.err')).toContainText('อยู่แล้ว');
    await expect.poll(() => ctx.caseLoads()).toBeGreaterThan(loadsBefore);
  });

  test('ยกเลิก — ไม่ส่ง และเปลี่ยนขั้นตอนได้โดยไม่ถูกเตือนว่ามีข้อมูลยังไม่บันทึก', async ({ page }) => {
    const { posts } = await openReception(page);
    await fillButton(page).click();
    await dialog(page).getByLabel('เบอร์โทร').fill('0812345678');
    await dialog(page).getByRole('button', { name: 'ยกเลิก' }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(posts).toHaveLength(0);

    await page.getByRole('button', { name: 'ไทม์ไลน์' }).click();
    await expect(page).toHaveURL(/step=timeline/);
    await expect(page.getByText(/คุณกำลังกรอกข้อมูลในขั้น/)).toHaveCount(0);
  });

  test('ไทม์ไลน์แสดงเหตุการณ์ "เติมข้อมูลลูกค้า"', async ({ page }) => {
    await openReception(page, {
      events: [{ id: 501, case_id: BASE_CASE.id, action: 'customer_filled', note: 'เติมข้อมูลลูกค้า: วันเกิด', created_at: '2026-09-15 12:00:00' }],
    });
    await page.getByRole('button', { name: 'ไทม์ไลน์' }).click();
    await expect(page.locator('.tl-head b')).toHaveText('เติมข้อมูลลูกค้า');
  });

  test('มือถือ 390px — popup อยู่ในจอ ไม่มีเลื่อนแนวนอน ปุ่มบันทึกมองเห็น', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReception(page);
    await fillButton(page).click();
    const dlg = dialog(page);
    await expect(dlg).toBeVisible();
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const box = await dlg.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390.5);
    await expect(saveButton(page)).toBeInViewport();
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/customer-fill-390.png` });
  });
});
