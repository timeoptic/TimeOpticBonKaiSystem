/**
 * ตั้งค่าเกณฑ์แจ้งเตือนค่าสายตา (Prescription Safety Alert) ในหน้า /settings
 *
 * spec: docs/superpowers/specs/2026-10-14-rx-safety-alert-design.md ข้อ 8.4
 * จำลองคำตอบของ API ด้วย page.route · รันเดี่ยว:
 *   E2E_BASE_URL=http://localhost:3010 npx playwright test rx-alert-rules --project=tablet-1024 --no-deps
 */
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

const ACTOR = {
  id: 1, username: 'e2e.admin', displayName: 'แอดมินทดสอบ', roleText: 'Admin',
  roles: ['admin'], perms: ['frontdesk.use', 'system.zone'], home: '/', mustChangePassword: false,
};
const META = {
  lists: {}, employees: [], statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '2026-10-14', now: '2026-10-14 10:00:00',
};
const DEFAULTS = {
  sph: { enabled: true, warn: 0.75, critical: 1.5 },
  cyl: { enabled: true, warn: 0.75, critical: 1.5 },
  se: { enabled: true, warn: 1, critical: 2 },
  add: { enabled: true, warn: 0.5, critical: 1 },
  axis: { enabled: true, warn: 20, min_cyl: 0.75 },
};
const V1 = { version: 1, rules: DEFAULTS, note: 'ค่าเริ่มต้นสำหรับทดลอง', changed_by_name: null, changed_at: '2026-10-14 09:00:00' };

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

async function open(page) {
  const puts = [];
  let history = [V1];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p.endsWith('/api/auth/me')) return reply(route, ACTOR);
    if (p.endsWith('/api/meta')) return reply(route, META);
    if (p.endsWith('/api/settings/rx-alert-rules')) {
      if (req.method() === 'PUT') {
        const body = req.postDataJSON();
        puts.push(body);
        const v = { version: 2, rules: body.rules, note: body.note, changed_by_name: 'แอดมินทดสอบ', changed_at: '2026-10-14 10:00:00' };
        history = [v, ...history];
        return reply(route, { version: 2, rules: body.rules, history });
      }
      return reply(route, { version: history[0].version, rules: history[0].rules, defaults: DEFAULTS, history });
    }
    if (p.endsWith('/api/settings')) return reply(route, { telegram_targets: [] });
    return reply(route, []);
  });
  await page.goto('/settings/');
  const card = page.getByTestId('rx-alert-rules');
  await expect(card).toBeVisible({ timeout: 30_000 });
  return { card, puts };
}

test('แก้เกณฑ์ SPH + ปิดกฎ AXIS แล้วบันทึก → ส่งเกณฑ์ใหม่ทั้งชุด และประวัติขึ้นเวอร์ชัน 2', async ({ page }) => {
  const { card, puts } = await open(page);
  await expect(card).toContainText('ค่าทดลอง');
  await card.getByLabel('SPH เตือน').fill('1.00');
  await card.getByLabel('เปิดใช้ AXIS').uncheck();
  await card.getByLabel('หมายเหตุการแก้ไข').fill('นักทัศนมาตรตรวจทานแล้ว');
  await card.getByRole('button', { name: 'บันทึกเกณฑ์' }).click();

  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0].rules.sph).toEqual({ enabled: true, warn: 1, critical: 1.5 });
  expect(puts[0].rules.axis.enabled).toBe(false);
  expect(puts[0].note).toBe('นักทัศนมาตรตรวจทานแล้ว');
  await expect(card).toContainText('v2');
  await expect(card).toContainText('แอดมินทดสอบ');
});

test('เกณฑ์ทบทวนไม่มากกว่าเกณฑ์เตือน — บันทึกไม่ได้ บอกเหตุผล', async ({ page }) => {
  const { card, puts } = await open(page);
  await card.getByLabel('CYL ทบทวน').fill('0.50');
  await expect(card).toContainText('ต้องมากกว่าเกณฑ์เตือน');
  await expect(card.getByRole('button', { name: 'บันทึกเกณฑ์' })).toBeDisabled();
  expect(puts).toHaveLength(0);
});
