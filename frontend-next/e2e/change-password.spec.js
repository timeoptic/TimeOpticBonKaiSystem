/**
 * หน้าตั้งรหัสผ่านใหม่ — ทางกลับไปหน้าเข้าสู่ระบบ
 *
 * บัญชีที่ถูกรีเซ็ตรหัสติดอยู่หน้านี้: หน้า login เห็น session ค้างแล้วพาไปหน้าแรก
 * ซึ่งพากลับมาที่นี่อีก · ปุ่มกลับจึงต้องออกจากระบบก่อน ลิงก์ไป /login/ เฉย ๆ วนไม่จบ
 *
 * จำลองคำตอบของ API ด้วย page.route — สิ่งที่ตรวจคือพฤติกรรมของหน้า ไม่ต้องมีบัญชี
 * ที่ติดธงเปลี่ยนรหัสจริงในฐาน · session จำลองยังล็อกอินอยู่จนกว่าจะมีคนเรียก logout
 * การทำปุ่มเป็นลิงก์เฉย ๆ จึงตกเทสต์นี้ด้วยเหตุผลเดียวกับที่มันพังของจริง
 *
 * รันเดี่ยวได้โดยไม่ต้องมีรหัสบัญชี test.*:
 *   E2E_BASE_URL=http://localhost:3010 npx playwright test change-password --project=mobile-390 --no-deps
 */
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

/* API อยู่คนละ origin กับหน้าเว็บ (NEXT_PUBLIC_API_ORIGIN) — คำตอบจำลองต้องผ่าน CORS ด้วย */
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

test.describe('หน้าตั้งรหัสผ่านใหม่', () => {
  test('กดกลับไปหน้าเข้าสู่ระบบ ออกจากระบบแล้วหยุดที่หน้า login', async ({ page }) => {
    let signedIn = true;
    let logoutCalls = 0;
    const actor = { id: 1, displayName: 'Bow', mustChangePassword: true, home: '/', perms: [] };

    await page.route('**/api/auth/me', (route) => reply(route, signedIn ? actor : null));
    await page.route('**/api/auth/logout', (route) => {
      if (route.request().method() === 'POST') {
        logoutCalls += 1;
        signedIn = false;
      }
      return reply(route, { ok: true });
    });

    await page.goto('/change-password/');
    await page.getByRole('button', { name: 'กลับไปหน้าเข้าสู่ระบบ' }).click();

    await expect(page).toHaveURL(/\/login\/$/);
    await expect(page.getByLabel('ชื่อผู้ใช้')).toBeVisible();
    /* หน้า login ถาม /api/auth/me อีกรอบ — ถ้ายังล็อกอินค้างจะเด้งออกไปตรงนี้ */
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/login\/$/);
    expect(logoutCalls).toBe(1);
  });
});
