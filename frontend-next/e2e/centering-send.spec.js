/**
 * ขั้นวัด Center — ปุ่ม "ส่งรูป" ส่งรูปการวัด + หมายเหตุ เข้ากลุ่ม Telegram
 *
 * ด่านจริงอยู่ที่ API (api/tests/31-centering-photo-send.test.php) ที่นี่ตรวจว่า
 * ไม่ส่งทันที · popup แสดงของจริงของเคส · ยืนยันสองชั้น · ส่งครั้งเดียวแม้กดรัว
 * · ส่งไม่ออกแล้วของเดิมไม่หาย · และใช้ได้ที่ 360 / 390 / 768 / 1024 / 1440
 *
 * รันเดี่ยวได้โดยไม่ต้องมีรหัสบัญชี test.* (API ถูกจำลองทั้งหมด):
 *   E2E_BASE_URL=http://localhost:3010 npx playwright test centering-send --project=tablet-1024 --no-deps
 * ภาพหน้าจอแต่ละขนาดไปอยู่ที่ E2E_SHOTS (ถ้าตั้งไว้)
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

const BASE_CASE = JSON.parse(readFileSync(new URL('./fixtures/case-payment.json', import.meta.url), 'utf8'));
const EMPLOYEES = [{ id: 680, employee_name: 'พนักงานทดสอบ' }];
const SALES = {
  id: 2, username: 'e2e.sales', displayName: 'พนักงานขาย', roleText: 'Sales',
  roles: ['sales'], perms: ['frontdesk.use', 'case.view_all'], home: '/', mustChangePassword: false,
};
const META = {
  lists: {}, employees: EMPLOYEES, statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '2026-09-15', now: '2026-09-15 10:00:00',
};
const NOTE = 'ลูกค้าใช้สายตาข้างขวาเป็นหลัก\nปรับความโค้งขาแว่นให้แนบขึ้นก่อนวัด';

/* PNG 1×1 — รูปย่อต้องโหลดได้จริง ไม่งั้นวัดขนาดกล่องไม่ได้ */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const photoRows = (n) => Array.from({ length: n }, (_, i) => ({
  id: 700 + n - i, case_id: BASE_CASE.id, kind: 'centering', mime_type: 'image/png',
  original_name: `center-${n - i}.png`, file_name: `photo_${n - i}.png`,
}));

function cors(route) {
  const req = route.request();
  return {
    'Access-Control-Allow-Origin': req.headers().origin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': req.headers()['access-control-request-headers'] || 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  };
}

function reply(route, body, status = 200) {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(route) });
  return route.fulfill({ status, contentType: 'application/json', headers: cors(route), body: JSON.stringify(body) });
}

/**
 * เปิดขั้นวัด Center ของเคสจำลอง
 * @param {{ photos?: number, note?: string|null, send?: (body: object) => { status: number, body: object }, delayMs?: number }} opt
 */
async function openCentering(page, opt = {}) {
  const photos = photoRows(opt.photos ?? 5);
  const state = {
    ...BASE_CASE,
    centering: { id: 4, case_id: BASE_CASE.id, r_pd: '31', l_pd: '31', center_point_note: opt.note === undefined ? NOTE : opt.note },
    frame_fitting: null,
  };
  const posts = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (p.endsWith('/api/auth/me')) return reply(route, SALES);
    if (p.endsWith('/api/meta')) return reply(route, META);
    if (p.endsWith(`/api/cases/${BASE_CASE.id}`)) return reply(route, state);
    if (/\/api\/uploads\/\d+$/.test(p)) {
      return route.fulfill({ status: 200, contentType: 'image/png', headers: cors(route), body: PNG });
    }
    if (p.endsWith('/api/uploads') && req.method() === 'GET') {
      return reply(route, url.searchParams.get('kind') === 'centering' ? photos : []);
    }
    if (p.endsWith('/api/settings')) {
      return reply(route, { telegram_targets: [{ key: 'centering', label: 'รูปวัด Center', configured: true, fallback: false, digest: false }] });
    }
    if (p.endsWith('/api/centering-photos/send') && req.method() === 'POST') {
      const body = req.postDataJSON();
      posts.push(body);
      if (opt.delayMs) await new Promise((r) => { setTimeout(r, opt.delayMs); });
      const res = opt.send ? opt.send(body) : {
        status: 200,
        body: { ok: true, case_id: BASE_CASE.id, case_code: BASE_CASE.case_code, count: body.photo_ids.length, sent_by: 'พนักงานขาย', sent_at: '2026-09-15 10:30:00' },
      };
      return reply(route, res.body, res.status);
    }
    return reply(route, []);
  });
  await page.goto(`/cases/detail/?id=${BASE_CASE.id}&step=centering`);
  await expect(page.getByRole('heading', { name: 'รูปภาพการวัด' })).toBeVisible({ timeout: 20_000 });
  return { posts, photos };
}

const sendButton = (page) => page.getByRole('button', { name: 'ส่งรูป', exact: true });
const review = (page) => page.getByRole('dialog', { name: 'ตรวจสอบก่อนส่งรูป' });
const finalAsk = (page) => page.getByRole('dialog', { name: 'ยืนยันการส่งรูป?' });

test.describe('ขั้นวัด Center — ส่งรูป', () => {
  test('ยังไม่มีรูป ปุ่มส่งรูปกดไม่ได้ และบอกให้เพิ่มรูปก่อน', async ({ page }) => {
    await openCentering(page, { photos: 0 });
    await expect(sendButton(page)).toBeDisabled();
    await expect(page.getByText('กรุณาเพิ่มรูปภาพก่อนส่ง')).toBeVisible();
    /* ปุ่มเพิ่มรูปยังอยู่แยกกัน */
    await expect(page.getByRole('button', { name: 'เพิ่มรูป' })).toBeEnabled();
  });

  test('กดส่งรูปแล้วไม่ส่งทันที — เปิด popup ตรวจสอบพร้อมรหัสเคส รูปทุกใบ และหมายเหตุแบบอ่านอย่างเดียว', async ({ page }) => {
    const { posts } = await openCentering(page);
    await sendButton(page).click();

    const dlg = review(page);
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('กรุณาตรวจสอบข้อมูลและรูปภาพก่อนยืนยันการส่ง');
    await expect(dlg).toContainText('หมายเลขเคส');
    await expect(dlg).toContainText(BASE_CASE.case_code);
    await expect(dlg).toContainText('รูปภาพที่จะส่ง 5 รูป');
    await expect(dlg.getByRole('button', { name: /ดูรูปใหญ่/ })).toHaveCount(5);
    await expect(dlg).toContainText('ลูกค้าใช้สายตาข้างขวาเป็นหลัก');
    await expect(dlg).toContainText('ปรับความโค้งขาแว่นให้แนบขึ้นก่อนวัด');
    /* แก้หมายเหตุจาก popup ไม่ได้ */
    await expect(dlg.locator('textarea, input')).toHaveCount(0);
    expect(posts).toHaveLength(0);
  });

  test('ยกเลิก ปิด popup ไม่ส่ง และหมายเหตุในหน้า Center ยังอยู่', async ({ page }) => {
    const { posts } = await openCentering(page);
    await sendButton(page).click();
    await review(page).getByRole('button', { name: 'ยกเลิก' }).click();
    await expect(review(page)).toHaveCount(0);
    expect(posts).toHaveLength(0);
    await expect(page.locator('textarea')).toHaveValue(NOTE);
  });

  test('ไม่มีหมายเหตุ ยังส่งได้ และ popup แสดง "ไม่มีหมายเหตุ"', async ({ page }) => {
    await openCentering(page, { note: null });
    await sendButton(page).click();
    await expect(review(page)).toContainText('ไม่มีหมายเหตุ');
    await expect(review(page).getByRole('button', { name: 'ยืนยันการส่ง' })).toBeEnabled();
  });

  test('หมายเหตุที่พิมพ์แต่ยังไม่บันทึก popup แสดงตามที่เห็นบนจอและเตือนไว้', async ({ page }) => {
    const { posts } = await openCentering(page);
    await page.locator('textarea').fill('แก้ใหม่ยังไม่บันทึก');
    await sendButton(page).click();
    const dlg = review(page);
    await expect(dlg).toContainText('แก้ใหม่ยังไม่บันทึก');
    await expect(dlg).toContainText('ยังไม่ได้บันทึก Draft');
    await dlg.getByRole('button', { name: 'ยืนยันการส่ง' }).click();
    await finalAsk(page).getByRole('button', { name: 'ยืนยันและส่ง' }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].note).toBe('แก้ใหม่ยังไม่บันทึก');
  });

  test('กดรูปย่อใน popup เปิดดูรูปใหญ่', async ({ page }) => {
    await openCentering(page);
    await sendButton(page).click();
    await review(page).getByRole('button', { name: /ดูรูปใหญ่/ }).first().click();
    await expect(page.locator('.lightbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.lightbox')).toHaveCount(0);
    /* Esc ปิดแค่รูปใหญ่ popup ยังอยู่ */
    await expect(review(page)).toBeVisible();
  });

  test('ยืนยันการส่ง → ถามครั้งสุดท้าย → กลับไปตรวจสอบได้ ยังไม่ส่ง', async ({ page }) => {
    const { posts } = await openCentering(page);
    await sendButton(page).click();
    await review(page).getByRole('button', { name: 'ยืนยันการส่ง' }).click();

    const ask = finalAsk(page);
    await expect(ask).toContainText(`รูปภาพจำนวน 5 รูปของเคส ${BASE_CASE.case_code} จะถูกส่งพร้อมหมายเหตุจากหน้า Center`);
    await ask.getByRole('button', { name: 'กลับไปตรวจสอบ' }).click();
    await expect(review(page)).toBeVisible();
    expect(posts).toHaveLength(0);
  });

  test('ยืนยันและส่ง — ส่งครั้งเดียวแม้กดรัว แสดงกำลังส่ง แล้วปิด popup ขึ้น toast สำเร็จ', async ({ page }) => {
    const { posts, photos } = await openCentering(page, { delayMs: 900 });
    await sendButton(page).click();
    await review(page).getByRole('button', { name: 'ยืนยันการส่ง' }).click();

    const go = finalAsk(page).getByRole('button', { name: 'ยืนยันและส่ง' });
    await go.dblclick();
    const busy = finalAsk(page).getByRole('button', { name: 'กำลังส่ง...' });
    await expect(busy).toBeDisabled();
    await expect(finalAsk(page).getByRole('button', { name: 'กลับไปตรวจสอบ' })).toBeDisabled();

    await expect(page.locator('.toast.ok')).toContainText('ส่งรูปเรียบร้อยแล้ว');
    await expect(page.locator('.toast.ok')).toContainText(`เคส ${BASE_CASE.case_code} • 5 รูป`);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({
      case_id: BASE_CASE.id,
      case_code: BASE_CASE.case_code,
      photo_ids: photos.map((p) => p.id),
      note: NOTE,
    });
  });

  test('ส่งไม่สำเร็จ ขึ้น toast error และรูปกับหมายเหตุเดิมไม่หาย', async ({ page }) => {
    const { posts } = await openCentering(page, {
      send: () => ({ status: 502, body: { error: 'ส่งรูปไม่สำเร็จ กรุณาลองอีกครั้ง', reason: 'send_failed', detail: 'Bad Request: chat not found' } }),
    });
    await sendButton(page).click();
    await review(page).getByRole('button', { name: 'ยืนยันการส่ง' }).click();
    await finalAsk(page).getByRole('button', { name: 'ยืนยันและส่ง' }).click();

    await expect(page.locator('.toast.err')).toContainText('ส่งรูปไม่สำเร็จ กรุณาลองอีกครั้ง');
    expect(posts).toHaveLength(1);
    /* กลับมาที่หน้าตรวจสอบ ของเดิมครบ กดส่งใหม่ได้ */
    await expect(review(page)).toBeVisible();
    await expect(review(page).getByRole('button', { name: /ดูรูปใหญ่/ })).toHaveCount(5);
    await expect(review(page)).toContainText('ลูกค้าใช้สายตาข้างขวาเป็นหลัก');
    await review(page).getByRole('button', { name: 'ยกเลิก' }).click();
    await expect(page.locator('.photo-grid img')).toHaveCount(5);
    await expect(page.locator('textarea')).toHaveValue(NOTE);
  });
});

/* ความกว้างที่ร้านขอให้ตรวจ — มือถือ 2 ขนาด iPad แนวตั้ง/แนวนอน และจอคอม */
const SIZES = [
  { name: '360', width: 360, height: 780 },
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 768 },
  { name: '1440', width: 1440, height: 900 },
];

test.describe('ขั้นวัด Center — popup ส่งรูปทุกขนาดจอ', () => {
  for (const size of SIZES) {
    test(`${size.name}px: ไม่มีเลื่อนแนวนอน popup อยู่ในจอ รูปเยอะเลื่อนเฉพาะส่วนรูป`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openCentering(page, { photos: 10, note: `${NOTE}\n${'หมายเหตุยาว '.repeat(40)}` });

      const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(await noSideScroll()).toBe(true);

      await sendButton(page).click();
      const dlg = review(page);
      await expect(dlg).toBeVisible();
      await expect(dlg.locator('img')).toHaveCount(10);
      await page.waitForTimeout(250); // ให้แอนิเมชันเปิดกล่องจบก่อนวัด

      expect(await noSideScroll()).toBe(true);
      const box = await dlg.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 0.5);
      expect(box.height).toBeLessThanOrEqual(size.height + 0.5);
      if (size.width >= 1024) {
        expect(box.width).toBeGreaterThanOrEqual(600);
        expect(box.width).toBeLessThanOrEqual(700);
      } else if (size.width < 560) {
        expect(box.width).toBeGreaterThanOrEqual(size.width - 24);
      }

      /* คอลัมน์รูปย่อ = จำนวนรูปที่อยู่แถวบนสุด */
      const tops = await dlg.locator('img').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      const cols = tops.filter((t) => t === tops[0]).length;
      if (size.width < 560) expect(cols).toBeGreaterThanOrEqual(2);
      if (size.width < 560) expect(cols).toBeLessThanOrEqual(3);
      else expect(cols).toBeGreaterThanOrEqual(4);

      /* ปุ่มล่างมองเห็นและกดง่าย */
      const confirm = dlg.getByRole('button', { name: 'ยืนยันการส่ง' });
      await expect(confirm).toBeInViewport();
      const cb = await confirm.boundingBox();
      expect(cb.height).toBeGreaterThanOrEqual(size.width < 1024 ? 44 : 36);

      if (process.env.E2E_SHOTS) {
        await page.screenshot({ path: `${process.env.E2E_SHOTS}/centering-send-${size.name}-review.png` });
        await confirm.click();
        await expect(finalAsk(page)).toBeVisible();
        await page.waitForTimeout(150);
        expect(await noSideScroll()).toBe(true);
        await page.screenshot({ path: `${process.env.E2E_SHOTS}/centering-send-${size.name}-confirm.png` });
      }
    });
  }
});
