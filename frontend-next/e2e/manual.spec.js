/**
 * คู่มือการใช้งาน — เข้าได้จากเมนูด้านข้าง และอ่านได้บนทุกขนาดจอที่ร้านใช้
 *
 * จำลองคำตอบของ API ด้วย page.route (บัญชีพนักงานขายสมมติ) — หน้าคู่มือเป็นข้อความ
 * ล้วนไม่ยิง API ของตัวเอง สิ่งที่ต้องมีคือ auth/me กับ meta ให้กรอบหน้าร้านวาดขึ้น
 *
 * รันเดี่ยวได้โดยไม่ต้องมีรหัสบัญชี test.*:
 *   E2E_BASE_URL=http://localhost:3010 npx playwright test manual --no-deps
 */
import { test, expect } from '@playwright/test';
import { findOverflow, findSmallTargets } from './audit.js';

test.use({ storageState: { cookies: [], origins: [] } });

const ACTOR = {
  id: 1, username: 'e2e.sales', displayName: 'พนักงานทดสอบ', roleText: 'Sales',
  roles: ['sales'], perms: ['frontdesk.use'], home: '/', mustChangePassword: false,
};
const META = {
  lists: {}, employees: [], statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '2026-09-11', now: '2026-09-11 10:00:00',
};

/* API อยู่คนละ origin กับหน้าเว็บตอน dev — คำตอบจำลองต้องผ่าน CORS ด้วย */
function reply(route, body) {
  const req = route.request();
  const headers = {
    'Access-Control-Allow-Origin': req.headers().origin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': req.headers()['access-control-request-headers'] || 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
}

async function openManual(page) {
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/api/auth/me')) return reply(route, ACTOR);
    if (p.endsWith('/api/meta')) return reply(route, META);
    return reply(route, []);
  });
  await page.goto('/manual/');
  await expect(page.getByRole('heading', { level: 1, name: 'คู่มือการใช้งาน' })).toBeVisible({ timeout: 20_000 });
}

test.describe('คู่มือการใช้งาน', () => {
  test('เมนูด้านข้างมีคู่มือการใช้งาน และไฮไลต์เมื่ออยู่หน้านั้น', async ({ page }) => {
    await openManual(page);
    const toggle = page.locator('#menu-toggle');
    if (await toggle.isVisible()) await toggle.click();
    const link = page.locator('#nav').getByRole('link', { name: 'คู่มือการใช้งาน' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('aria-current', 'page');
  });

  test('สารบัญพาไปหัวข้อที่เลือก', async ({ page }) => {
    await openManual(page);
    await page.locator('.manual-toc').getByRole('link', { name: 'ชำระเงิน' }).click();
    await expect(page).toHaveURL(/#payment$/);
    await expect(page.locator('#payment')).toBeInViewport();
  });

  test('ไม่มีอะไรล้นออกนอกจอ', async ({ page }, testInfo) => {
    await openManual(page);
    const bad = await page.evaluate(findOverflow);
    expect(bad, `ที่ ${testInfo.project.name}:\n`
      + bad.map((b) => `  ${b.el}  ขวาสุด ${b.right}px > จอ ${b.vw}px  "${b.text}"`).join('\n')).toEqual([]);
  });

  test('ปุ่มใหญ่พอให้นิ้วกด', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('tablet'), 'เกณฑ์นี้เป็นของจอโทรศัพท์');
    await openManual(page);
    /* วัดเฉพาะเนื้อหาของหน้าคู่มือ (#view) — ปุ่มของกรอบร่วม เช่น ☰ บนแถบบน
       เป็นของทุกหน้า และถูกวัดใน mobile.spec.js อยู่แล้ว */
    const bad = await page.evaluate(findSmallTargets, { min: 40, root: '#view' });
    expect(bad, bad.map((b) => `  ${b.el}  ${b.w}×${b.h}  "${b.text}"`).join('\n')).toEqual([]);
  });
});
