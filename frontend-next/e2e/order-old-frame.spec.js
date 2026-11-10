/**
 * ขั้นขาย — ติ๊ก "ใช้กรอบเก่าของลูกค้า"
 *
 * ร้านเจอ 15 ก.ย. 2026 (เคส CASE-2026-00001): ออเดอร์ที่บันทึกเป็น oldframe ไปแล้ว
 * เปิดมาใหม่ ติ๊กเอาออกไม่ได้ · ต้นเหตุ: สถานะติ๊กอ่านจากออเดอร์เฉพาะตอนที่ `items`
 * ยังไม่ถูกแตะ แต่การเอาติ๊กออกไม่ได้แตะ `items` ค่าจึงเด้งกลับไปเป็นของออเดอร์
 * และในทางกลับกัน แตะช่องอื่น (ล้างเลนส์) ติ๊กจะหายเองทั้งที่ไม่มีใครกด
 *
 * รันเดี่ยวได้โดยไม่ต้องมีรหัสบัญชี test.* (API ถูกจำลองทั้งหมด):
 *   E2E_BASE_URL=http://localhost:3010 npx playwright test order-old-frame --project=tablet-1024 --no-deps
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
const LENS = {
  id: 555, product_id: 55, product_name: 'Lens ทดสอบ 1.56', sku: 'LENS-TEST', brand: 'TestBrand',
  product_type: 'Lens', product_price: '1200.00', qty: 1,
};
const STOCK_FRAME = {
  id: 777, product_id: 77, product_name: 'กรอบทดสอบ', sku: 'FRAME-TEST', brand: 'TestFrame',
  product_type: 'Frame', product_price: '2500.00', qty: 1,
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

/** เปิดขั้นขายของเคสที่มีออเดอร์ตาม patch */
async function openSales(page, orderPatch) {
  const order = { ...BASE_CASE.order, ...orderPatch };
  const kase = { ...BASE_CASE, order };
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/api/auth/me')) return reply(route, SALES);
    if (p.endsWith('/api/meta')) return reply(route, META);
    if (p.endsWith(`/api/cases/${BASE_CASE.id}`)) return reply(route, kase);
    if (p.endsWith(`/api/orders/${order.id}`)) return reply(route, order);
    return reply(route, []);
  });
  await page.goto(`/cases/detail/?id=${BASE_CASE.id}&step=sales`);
  await expect(page.getByText('กรอบแว่น — Frame')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'เปิดการแก้ไข', exact: true }).first().click();
}

const OLD_FRAME_ORDER = {
  frame_name: 'oldframe', frame_product_id: null, frame: null, frame_price: '0.00',
  lens_product_id: LENS.id, left_lens: LENS, right_lens_product_id: null, right_lens: null,
};
const oldFrameBox = (page) => page.getByRole('checkbox', { name: /ใช้กรอบเก่าของลูกค้า/ });
const oldFrameNote = (page) => page.getByText('บันทึกในใบสั่งว่า');

test.describe('ขั้นขาย — ใช้กรอบเก่าของลูกค้า', () => {
  test('ออเดอร์ที่บันทึกเป็นกรอบเก่า เปิดมาติ๊กอยู่ และเอาติ๊กออกได้', async ({ page }) => {
    await openSales(page, OLD_FRAME_ORDER);
    await expect(oldFrameBox(page)).toBeChecked();
    await oldFrameBox(page).click();
    await expect(oldFrameBox(page)).not.toBeChecked();
    await expect(oldFrameNote(page)).toHaveCount(0);
  });

  test('เอาติ๊กออกแล้ว ติ๊กกลับได้', async ({ page }) => {
    await openSales(page, OLD_FRAME_ORDER);
    await oldFrameBox(page).click();
    await expect(oldFrameBox(page)).not.toBeChecked();
    await oldFrameBox(page).click();
    await expect(oldFrameBox(page)).toBeChecked();
    await expect(oldFrameNote(page)).toBeVisible();
  });

  test('ออเดอร์กรอบเก่า กดล้างเลนส์ — ติ๊กกรอบเก่ายังอยู่ ไม่หายเอง', async ({ page }) => {
    await openSales(page, OLD_FRAME_ORDER);
    await expect(oldFrameBox(page)).toBeChecked();
    await page.getByRole('button', { name: 'ล้าง', exact: true }).first().click();
    await expect(oldFrameBox(page)).toBeChecked();
    await expect(oldFrameNote(page)).toBeVisible();
  });

  test('ออเดอร์กรอบจากสต็อก เริ่มไม่ติ๊ก · ติ๊กแล้วเอาออกได้', async ({ page }) => {
    await openSales(page, {
      frame_name: STOCK_FRAME.product_name, frame_product_id: STOCK_FRAME.id, frame: STOCK_FRAME, frame_price: '2500.00',
    });
    await expect(oldFrameBox(page)).not.toBeChecked();
    await oldFrameBox(page).click();
    await expect(oldFrameBox(page)).toBeChecked();
    await oldFrameBox(page).click();
    await expect(oldFrameBox(page)).not.toBeChecked();
  });
});
