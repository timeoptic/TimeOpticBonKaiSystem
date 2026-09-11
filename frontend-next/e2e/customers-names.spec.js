/**
 * ค้นหาลูกค้า — ชื่อไม่ถูกตัดทีละพยางค์บน iPad
 *
 * ร้านเจอ 11 ก.ย. 2026: iPad Air (820px) ตารางบีบคอลัมน์ชื่อจนเหลือบรรทัดละพยางค์
 * ("อารี / รัตน์ / (พี่ / หงษ์)") · ตารางที่กว้าง 100% บีบคอลัมน์ที่ตัดบรรทัดได้ก่อน
 * และภาษาไทยตัดได้ทุกคำ ส่วนเบอร์โทร/LINE ตั้ง nowrap ไว้อยู่แล้วจึงไม่หด
 *
 * ตัดสิน: ชื่อ ชื่อกลาง นามสกุล อยู่บรรทัดเดียว — ตารางกว้างกว่าจอก็เลื่อนซ้าย-ขวา
 * (ตารางนี้เลื่อนได้อยู่แล้ว) · บนโทรศัพท์เป็นการ์ด ต้องไม่ล้นจอเพราะชื่อยาว
 *
 * รันเดี่ยวได้โดยไม่ต้องมีรหัสบัญชี test.*:
 *   E2E_BASE_URL=http://localhost:3010 npx playwright test customers-names --project=tablet-1024 --no-deps
 */
import { test, expect } from '@playwright/test';
import { findOverflow } from './audit.js';

test.use({ storageState: { cookies: [], origins: [] } });

const ACTOR = {
  id: 1, username: 'e2e.sales', displayName: 'พนักงานทดสอบ', roleText: 'Sales',
  roles: ['sales'], perms: ['frontdesk.use', 'case.view_all'], home: '/', mustChangePassword: false,
};
const META = {
  lists: {}, employees: [], statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '2026-09-11', now: '2026-09-11 10:00:00',
};
/* หน้าตาเดียวกับผลค้นหา "อารีรัตน์" ในภาพที่ร้านส่งมา — ข้อมูลสมมติ */
const ROWS = [
  { id: 5480, first_name: 'อารีรัตน์', mid_name: null, last_name: 'เกตุมณี', sex: 'Female', nationality: 'Thai', phone: '0808094349', line_id: null, email: null },
  { id: 2596, first_name: 'อารีรัตน์ (พี่หงษ์)', mid_name: null, last_name: 'เจือวิจิตรจันทร์', sex: 'Female', nationality: 'Thai', phone: null, line_id: null, email: null },
  { id: 1765, first_name: 'อารีรัตน์ (พ่อพี่ตึก)', mid_name: 'ทดสอบกลาง', last_name: 'วรรณรักษ์', sex: 'Female', nationality: null, phone: '0820755093', line_id: 'tooktik', email: 'tooktik.pptt@example.com' },
];

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

async function openCustomers(page) {
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/api/auth/me')) return reply(route, ACTOR);
    if (p.endsWith('/api/meta')) return reply(route, META);
    if (p.endsWith('/api/customers')) return reply(route, ROWS);
    return reply(route, []);
  });
  await page.goto('/customers/?q=' + encodeURIComponent('อารีรัตน์'));
  await expect(page.getByRole('heading', { name: 'Customer Search' })).toBeVisible({ timeout: 20_000 });
}

/** จำนวนบรรทัดที่ข้อความในแต่ละช่องใช้ — นับจากกล่องบรรทัดของตัวอักษรจริง ไม่ใช่ความสูงช่อง */
const linesOf = (tds) => tds
  .filter((td) => td.textContent.trim() !== '')
  .map((td) => {
    const range = document.createRange();
    range.selectNodeContents(td);
    const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
    return { text: td.textContent.trim(), lines: tops.size };
  });

test.describe('ค้นหาลูกค้า — ชื่อไม่ถูกตัดทีละพยางค์', () => {
  test('iPad 820px: ชื่อ ชื่อกลาง นามสกุล อยู่บรรทัดเดียว', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await openCustomers(page);
    const body = page.locator('.table-wrap tbody');
    await expect(body.locator('tr')).toHaveCount(ROWS.length);

    /* คอลัมน์ 2-4 = ชื่อ · ชื่อกลาง · นามสกุล */
    const cells = body.locator('td:nth-child(2), td:nth-child(3), td:nth-child(4)');
    const lines = await cells.evaluateAll(linesOf);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter((l) => l.lines !== 1), JSON.stringify(lines, null, 1)).toEqual([]);
  });

  test('โทรศัพท์ 390px: การ์ดชื่อยาวไม่ล้นจอ', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCustomers(page);
    await expect(page.locator('.dt-cards .dt-card')).toHaveCount(ROWS.length);
    const bad = await page.evaluate(findOverflow);
    expect(bad, bad.map((b) => `  ${b.el}  ขวาสุด ${b.right}px > จอ ${b.vw}px  "${b.text}"`).join('\n')).toEqual([]);
  });
});
