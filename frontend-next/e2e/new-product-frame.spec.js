/**
 * เพิ่มสินค้าใหม่ — กรอบแว่นกับแว่นกันแดดถามแบรนด์ + รุ่น
 *
 * ร้านขอ (11 ก.ย. 2026): ช่องแบรนด์ของกรอบไม่ต้องมีแบรนด์ตั้งต้น (Lens G · Hitop · Hoya
 * เป็นแบรนด์เลนส์) เหลือแค่แบรนด์ที่กรอบในคลังเคยใช้ · มีช่อง "รุ่น" ข้างแบรนด์ ไม่บังคับ
 * · ชื่อสินค้าตั้งให้เองจาก แบรนด์ + รุ่น แก้ทับได้ — ทำทั้งกรอบและแว่นกันแดด
 *
 * เปิดหน้าฝัง /stock/embed/new-product ตัวเดียวกับที่หน้าร้านเปิดจากขั้นขาย · จำลอง
 * API ฝั่งคลังด้วย page.route — ชื่อที่ตั้งให้จำลองตามกฎของ Catalog::composeName
 * (แบรนด์ รุ่น สี ขนาด เว้นส่วนที่ว่าง)
 *
 * รันเดี่ยวได้โดยไม่ต้องมีรหัสบัญชี test.*:
 *   E2E_BASE_URL=http://localhost:3010 npx playwright test new-product-frame --project=tablet-1024 --no-deps
 */
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

const ACTOR = {
  id: 1, username: 'e2e.owner', displayName: 'เจ้าของทดสอบ', roles: ['owner'],
  perms: ['product.add', 'catalog.edit', 'cost.edit', 'cost.view'], home: '/', mustChangePassword: false,
};
const CATEGORIES = [
  { id: 1, code: 'Lens', name: 'Lens' },
  { id: 2, code: 'Frame', name: 'Frame' },
  { id: 3, code: 'Sunglass', name: 'Sunglass' },
];
/* แบรนด์ที่แคตตาล็อกมีอยู่แล้ว แยกตามชนิด — API จริงก็แยกตามชนิด (Inventory::hints) */
const HINTS = {
  Frame: { names: [], brands: ['Bolon', 'Rayban'], values: { model: ['BJ5028'] } },
  Sunglass: { names: [], brands: ['Oakley'], values: {} },
  Lens: { names: [], brands: ['Essilor'], values: {} },
};

/* API อยู่คนละ origin กับหน้าเว็บตอน dev — คำตอบจำลองต้องผ่าน CORS ด้วย */
function reply(route, body, status = 200) {
  const req = route.request();
  const headers = {
    'Access-Control-Allow-Origin': req.headers().origin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': req.headers()['access-control-request-headers'] || 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  return route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
}

async function openNewProduct(page, type) {
  const posts = [];
  await page.route('**/stock-api/**', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^.*\/stock-api/, '');
    const q = url.searchParams;
    if (p === '/auth/me') return reply(route, { actor: ACTOR });
    if (p === '/categories') return reply(route, { categories: CATEGORIES });
    if (p === '/products/next-sku') return reply(route, { sku: 'FRM-0006' });
    if (p === '/products/hints') return reply(route, HINTS[q.get('type')] ?? { names: [], brands: [], values: {} });
    if (p === '/products/compose-name') {
      const name = ['brand', 'model', 'color', 'size'].map((k) => (q.get(k) || '').trim()).filter(Boolean).join(' ');
      return reply(route, { name });
    }
    if (p === '/products' && req.method() === 'POST') {
      posts.push(req.postDataJSON());
      return reply(route, { product: { id: 77 } });
    }
    if (p === '/products') return reply(route, { rows: [], total: 0, page: 1, per: 500 });
    if (p === '/suppliers') return reply(route, { suppliers: [] });
    if (p === '/lots') return reply(route, { lot: { id: 5, lot_number: 'L-0001' } });
    return reply(route, {});
  });
  await page.goto(`/stock/embed/new-product/?type=${type}`);
  await expect(page.locator('#pf-brand')).toBeVisible({ timeout: 30_000 });
  return posts;
}

const brandOptions = (page) => page.locator('#pf-brand-list [role="option"]');

test.describe('เพิ่มสินค้าใหม่ — แบรนด์ + รุ่นของกรอบและแว่นกันแดด', () => {
  test('กรอบ: ช่องแบรนด์ไม่มีแบรนด์เลนส์ตั้งต้น เหลือแค่แบรนด์กรอบที่เคยใช้', async ({ page }) => {
    await openNewProduct(page, 'Frame');
    await page.locator('#pf-brand').click();
    await expect(brandOptions(page)).toHaveText(['Bolon', 'Rayban']);
  });

  test('กรอบ: ช่องรุ่นอยู่หน้าแรก ชื่อตั้งให้จากแบรนด์ + รุ่น แก้ทับได้ และรุ่นถูกบันทึกลงสินค้า', async ({ page }) => {
    const posts = await openNewProduct(page, 'Frame');
    const name = page.locator('#pf-name');

    await expect(page.locator('#pf-model')).toBeVisible();
    await page.locator('#pf-brand').fill('Bolon');
    /* ยังไม่มีรุ่น — ไม่ตั้งชื่อเป็นแค่ "Bolon" */
    await expect(name).toHaveValue('');

    await page.locator('#pf-model').fill('BJ5028');
    await expect(name).toHaveValue('Bolon BJ5028');

    /* พิมพ์ต่อท้ายแล้ว ชื่อเป็นของคนพิมพ์ — เปลี่ยนรุ่นทีหลังไม่เขียนทับ */
    await name.click();
    await name.press('End');
    await name.pressSequentially(' ดำด้าน');
    await page.locator('#pf-model').fill('BJ5029');
    await expect(name).toHaveValue('Bolon BJ5028 ดำด้าน');

    await page.getByRole('button', { name: 'ถัดไป →' }).click();
    await page.getByRole('button', { name: 'เพิ่มสินค้าและเปิดล็อตรอของ' }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({
      name: 'Bolon BJ5028 ดำด้าน',
      brand: 'Bolon',
      product_type: 'Frame',
      attributes: { brand: 'Bolon', model: 'BJ5029' },
    });
  });

  test('กรอบ: ลบรุ่นออก ชื่อที่ตั้งให้ก็หายไปด้วย ไม่ค้างเป็นชื่อแบรนด์', async ({ page }) => {
    await openNewProduct(page, 'Frame');
    const name = page.locator('#pf-name');
    await page.locator('#pf-brand').fill('Bolon');
    await page.locator('#pf-model').fill('X1');
    await expect(name).toHaveValue('Bolon X1');
    await page.locator('#pf-model').fill('');
    await expect(name).toHaveValue('');
  });

  test('แว่นกันแดด: ไม่มีแบรนด์ตั้งต้น และมีช่องรุ่นเหมือนกรอบ', async ({ page }) => {
    await openNewProduct(page, 'Sunglass');
    await expect(page.locator('#pf-model')).toBeVisible();
    await page.locator('#pf-brand').click();
    await expect(brandOptions(page)).toHaveText(['Oakley']);
  });

  test('เลนส์: ยังมีแบรนด์ตั้งต้นเหมือนเดิม และไม่มีช่องรุ่นในหน้าแรก', async ({ page }) => {
    await openNewProduct(page, 'Lens');
    await expect(page.locator('#pf-model')).toHaveCount(0);
    await page.locator('#pf-brand').click();
    await expect(page.locator('#pf-brand-list')).toContainText('Hitop');
    await expect(page.locator('#pf-brand-list')).toContainText('Essilor');
  });
});
