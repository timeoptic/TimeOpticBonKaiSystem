/**
 * ขั้นขาย — ตัวกรองเลนส์ Coating / SPH / CYL ทั้งเลนส์ขวา (R) และซ้าย (L)
 *
 * ร้านขอ 15 ก.ย. 2026: พนักงานกรอกค่าสายตาที่วัดได้แล้วต้องเห็นเฉพาะเลนส์ที่ตรงทุกค่า
 * ตัวเทียบจริงอยู่ฝั่ง API (api/tests/13-stock-lens-filter.test.php) — ที่นี่ตรวจว่าหน้าจอ
 * ส่งเงื่อนไขครบ ตรงค่า ไม่ส่งช่องที่พิมพ์ผิด และการเลือกเลนส์ยังเป็น flow เดิม
 *
 * รันเดี่ยวได้โดยไม่ต้องมีรหัสบัญชี test.* (API ถูกจำลองทั้งหมด):
 *   E2E_BASE_URL=http://localhost:3010 npx playwright test lens-filter --project=tablet-1024 --no-deps
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
  lists: {}, employees: [], statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '2026-09-15', now: '2026-09-15 10:00:00',
};
const NO_LENS = {
  lens_product_id: null, left_lens: null, right_lens_product_id: null, right_lens: null,
};

const lens = (id, coating, sph, cyl, left = 4) => ({
  id, product_id: id - 1000000, product_type: 'Lens', brand: 'G', sku: `LNS-${id}`,
  product_name: `G ${coating} Single Vision (1.50) ${sph}/${cyl}`,
  coating, lens_index: '1.50', lens_design: 'Single Vision', remaining_qty: left, lot_count: 1,
  sph, cyl,
});
const CATALOGUE = [
  lens(1003486, 'Auto', '+0.25', '-0.25'),
  lens(1003487, 'Auto', '+0.25', '-0.50'),
  lens(1003488, 'Auto', '+0.25', '-0.75'),
  lens(1003489, 'Auto', '+0.25', '-1.00'),
  lens(1003500, 'Blue', '+0.25', '-0.75'),
  lens(1003600, 'Auto-Blue', '+0.25', '-0.75', 0),
];

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

/* คลังจำลองที่กรองแบบเดียวกับ API — ทุกเงื่อนไข AND · ค่าสายตาเทียบเป็นตัวเลข */
function stockRows(params) {
  const q = (params.get('q') || '').toLowerCase();
  return CATALOGUE.filter((r) => (!params.get('coating') || r.coating === params.get('coating'))
    && (!params.has('sph') || Number(r.sph) === Number(params.get('sph')))
    && (!params.has('cyl') || Number(r.cyl) === Number(params.get('cyl')))
    && (!q || r.product_name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q)));
}

/** เปิดขั้นขายของเคสที่ยังไม่ได้เลือกเลนส์ · คืนรายการ query ของ /api/stock ที่หน้าจอส่ง */
async function openSales(page) {
  const calls = [];
  const order = { ...BASE_CASE.order, ...NO_LENS };
  const kase = { ...BASE_CASE, order };
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p.endsWith('/api/auth/me')) return reply(route, SALES);
    if (p.endsWith('/api/meta')) return reply(route, META);
    if (p.endsWith(`/api/cases/${BASE_CASE.id}`)) return reply(route, kase);
    if (p.endsWith(`/api/orders/${order.id}`)) return reply(route, order);
    if (p.endsWith('/api/stock') && route.request().method() === 'GET') {
      if (url.searchParams.get('type') === 'Lens') calls.push(url.searchParams);
      return reply(route, stockRows(url.searchParams));
    }
    return reply(route, []);
  });
  await page.goto(`/cases/detail/?id=${BASE_CASE.id}&step=sales`);
  await expect(page.getByText('เลนส์ — Lens')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'เปิดการแก้ไข', exact: true }).first().click();
  return calls;
}

const side = (page, legend) => page.locator('fieldset fieldset').filter({ has: page.getByText(legend, { exact: true }) });
const rowsOf = (box) => box.getByRole('radio');

async function chooseCoating(page, box, value) {
  await box.getByRole('button', { name: 'Coating' }).click();
  await page.getByRole('option', { name: value, exact: true }).click();
}

test.describe('ขั้นขาย — ตัวกรองเลนส์ Coating / SPH / CYL', () => {
  test('ทั้งเลนส์ขวาและซ้ายมี Coating · SPH / CYL · ช่องค้นหาเดิม', async ({ page }) => {
    await openSales(page);
    for (const legend of ['เลนส์ขวา (R)', 'เลนส์ซ้าย (L)']) {
      const box = side(page, legend);
      await expect(box.getByRole('button', { name: 'Coating' })).toBeVisible();
      await expect(box.getByRole('textbox', { name: 'SPH' })).toBeVisible();
      await expect(box.getByRole('textbox', { name: 'CYL' })).toBeVisible();
      await expect(box.getByRole('searchbox', { name: 'ค้นหาเลนส์ / ยี่ห้อ / SKU' })).toBeVisible();
      await expect(rowsOf(box)).toHaveCount(5);
    }
  });

  test('Auto + +0.25 + -0.75 — ส่งครบสามเงื่อนไข เหลือเฉพาะตัวที่ตรงทุกค่า', async ({ page }) => {
    const calls = await openSales(page);
    const box = side(page, 'เลนส์ขวา (R)');
    await chooseCoating(page, box, 'Auto');
    await box.getByRole('textbox', { name: 'SPH' }).fill('+0.25');
    await box.getByRole('textbox', { name: 'CYL' }).fill('-0.75');
    await box.getByRole('textbox', { name: 'CYL' }).blur();

    await expect(rowsOf(box)).toHaveCount(1);
    await expect(rowsOf(box).first()).toContainText('G Auto Single Vision (1.50) +0.25/-0.75');
    const last = calls.at(-1);
    expect(last.get('coating')).toBe('Auto');
    expect(last.get('sph')).toBe('0.25');
    expect(last.get('cyl')).toBe('-0.75');

    await expect(box.getByRole('button', { name: 'เอา Coating: Auto ออก' })).toBeVisible();
    await expect(box.getByRole('button', { name: 'เอา SPH: +0.25 ออก' })).toBeVisible();
    await expect(box.getByRole('button', { name: 'เอา CYL: -0.75 ออก' })).toBeVisible();

    /* ข้างซ้ายไม่ถูกกรองตามข้างขวา */
    await expect(rowsOf(side(page, 'เลนส์ซ้าย (L)'))).toHaveCount(5);
  });

  test('ค้นหาใช้ร่วมกับตัวกรอง และ Enter ไม่ส่งฟอร์มออเดอร์', async ({ page }) => {
    const calls = await openSales(page);
    const box = side(page, 'เลนส์ซ้าย (L)');
    await chooseCoating(page, box, 'Auto-Blue');
    const search = box.getByRole('searchbox', { name: 'ค้นหาเลนส์ / ยี่ห้อ / SKU' });
    await search.fill('G');
    await search.press('Enter');
    await expect(rowsOf(box)).toHaveCount(1);
    await expect(rowsOf(box).first()).toContainText('Auto-Blue');
    expect(calls.at(-1).get('q')).toBe('G');
    expect(calls.at(-1).get('coating')).toBe('Auto-Blue');
    await expect(page).toHaveURL(/step=sales/);
  });

  test('ไม่มีตัวที่ตรง — ขึ้นข้อความพร้อมปุ่มล้างตัวกรอง', async ({ page }) => {
    await openSales(page);
    const box = side(page, 'เลนส์ขวา (R)');
    await box.getByRole('textbox', { name: 'SPH' }).fill('-6.00');
    await expect(box.getByText('ไม่พบเลนส์ที่ตรงกับเงื่อนไข')).toBeVisible();
    await box.getByRole('button', { name: 'ล้างตัวกรอง' }).click();
    await expect(rowsOf(box)).toHaveCount(5);
    await expect(box.getByRole('textbox', { name: 'SPH' })).toHaveValue('');
  });

  test('SPH พิมพ์ไม่ใช่ตัวเลข — ไม่ค้นด้วยเงื่อนไขที่เหลือ', async ({ page }) => {
    const calls = await openSales(page);
    const box = side(page, 'เลนส์ขวา (R)');
    await box.getByRole('textbox', { name: 'SPH' }).fill('abc');
    await expect(box.getByRole('alert')).toContainText('SPH ต้องเป็นตัวเลข');
    await page.waitForTimeout(600);
    expect(calls.some((c) => c.has('sph'))).toBe(false);
  });

  test('เลือกเลนส์จากผลที่กรอง — ขึ้นการ์ดที่เลือกแบบเดิม', async ({ page }) => {
    await openSales(page);
    const box = side(page, 'เลนส์ขวา (R)');
    await box.getByRole('textbox', { name: 'CYL' }).fill('-0.75');
    await expect(rowsOf(box)).toHaveCount(3);
    await rowsOf(box).filter({ hasText: 'G Blue' }).click();
    await expect(box.locator('.picked-item')).toContainText('G Blue Single Vision (1.50) +0.25/-0.75');
    await expect(box.getByRole('button', { name: 'เปลี่ยน' })).toBeVisible();
  });

  test('ภาพหน้าจอ (ตรวจด้วยตา)', async ({ page }, info) => {
    await openSales(page);
    const box = side(page, 'เลนส์ขวา (R)');
    await chooseCoating(page, box, 'Auto');
    await box.getByRole('textbox', { name: 'SPH' }).fill('+0.25');
    await box.getByRole('textbox', { name: 'SPH' }).blur();
    await expect(rowsOf(box)).toHaveCount(4);
    const out = process.env.LENS_SHOT_DIR;
    if (out) {
      const card = box.locator('xpath=ancestor::*[contains(@class,"card")][1]');
      await card.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await card.screenshot({ path: `${out}/lens-${info.project.name}.png` });
      /* จอกว้างของเครื่องหน้าร้าน — ครึ่งการ์ดกว้างพอให้เป็นตาราง */
      await page.setViewportSize({ width: 1440, height: 900 });
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: `${out}/lens-${info.project.name}-wide.png` });
    }
  });
});
