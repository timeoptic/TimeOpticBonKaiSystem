/**
 * เกณฑ์รับงานมือถือ — หนึ่งเทสต์ต่อหนึ่งหน้า รันซ้ำทุกความกว้างที่ประกาศไว้ใน
 * playwright.config.js
 *
 * เทสต์นี้ตรวจ "หน้าเว็บที่วาดออกมาแล้ว" ไม่ใช่ CSS ที่เขียนไว้ — กฎ CSS ที่ถูก
 * กฎอื่นทับจนไม่มีผลจะผ่านการอ่านโค้ด แต่ไม่ผ่านที่นี่
 */
import { test, expect } from '@playwright/test';
import { ROUTES } from './routes.js';
import {
  findNestedScrollers, findOverflow, findSmallTargets, findTinyInputs, findVisibleTables,
} from './audit.js';

/** รอให้หน้าวาดข้อมูลเสร็จ — ทุกหน้าโหลดข้อมูลจาก API หลัง hydrate */
async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
  /* "กำลังโหลด…" คือ <Loading> ของ ui.jsx · หายเมื่อไหร่แปลว่าข้อมูลมาแล้ว
     บางหน้าไม่มีตัวนี้เลย จึงรอแบบไม่บังคับ */
  await page.locator('.loading').first().waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
  /* ปล่อยให้ layout นิ่งก่อนวัด — วัดกลางการเปลี่ยนขนาดจะได้ตัวเลขที่ไม่มีอยู่จริง */
  await page.waitForTimeout(400);
}

for (const [path, title] of ROUTES) {
  test.describe(`${title} (${path})`, () => {
    test('ไม่มีอะไรล้นออกนอกจอ', async ({ page }, testInfo) => {
      await page.goto(path);
      await settle(page);
      const bad = await page.evaluate(findOverflow);
      expect(bad, `${title} ที่ ${testInfo.project.name}: มี element ล้นขอบขวา\n`
        + bad.map((b) => `  ${b.el}  ขวาสุด ${b.right}px > จอ ${b.vw}px  "${b.text}"`).join('\n')).toEqual([]);
    });

    test('ช่องกรอกไม่เล็กกว่า 16px', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.startsWith('tablet'), 'เกณฑ์นี้เป็นของจอโทรศัพท์');
      await page.goto(path);
      await settle(page);
      const bad = await page.evaluate(findTinyInputs);
      expect(bad, `${title}: ช่องกรอกที่ iPhone จะซูมใส่\n`
        + bad.map((b) => `  <${b.el}> ${b.name} = ${b.size}px`).join('\n')).toEqual([]);
    });

    test('ไม่มีกล่องเลื่อนซ้อนในหน้า', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.startsWith('tablet'), 'เกณฑ์นี้เป็นของจอโทรศัพท์');
      await page.goto(path);
      await settle(page);
      const bad = await page.evaluate(findNestedScrollers);
      expect(bad, `${title}: กล่องที่เลื่อนได้ซ้อนอยู่ในหน้าที่เลื่อนได้\n`
        + bad.map((b) => `  ${b.el}  สูง ${b.h}px แต่เนื้อใน ${b.scroll}px`).join('\n')).toEqual([]);
    });

    test('ตารางกว้างกลายเป็นการ์ด', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.startsWith('tablet'), 'แท็บเล็ตยังใช้ตารางตามแบบ');
      await page.goto(path);
      await settle(page);
      const bad = await page.evaluate(findVisibleTables);
      expect(bad, `${title}: ยังมีตารางตั้งแต่ 4 คอลัมน์ขึ้นไปแสดงอยู่บนจอโทรศัพท์\n`
        + bad.map((b) => `  ${b.el} (${b.cols} คอลัมน์)`).join('\n')).toEqual([]);
    });

    test('ปุ่มใหญ่พอให้นิ้วกด', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.startsWith('tablet'), 'เกณฑ์นี้เป็นของจอโทรศัพท์');
      await page.goto(path);
      await settle(page);
      /* 40 ไม่ใช่ 44 — 44 คือเป้าที่ตั้งไว้ ส่วน 40 คือเส้นที่ยังกดโดนด้วยนิ้วโป้ง
         ปุ่มที่ต่ำกว่านี้คือปุ่มที่ต้องเล็งด้วยปลายเล็บ */
      const bad = await page.evaluate(findSmallTargets, 40);
      expect(bad, `${title}: ปุ่มที่เล็กกว่า 40px\n`
        + bad.map((b) => `  ${b.el}  ${b.w}×${b.h}  "${b.text}"`).join('\n')).toEqual([]);
    });
  });
}

/** แถบข้างต้องเป็นลิ้นชักที่เปิด-ปิดได้ ไม่ใช่แถบที่กินจอตลอดเวลา (ข้อ 6, 7) */
test('แถบเมนูเป็นลิ้นชัก เปิดปิดได้ และไม่กินจอตอนปิด', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'tablet-1024', '1024px ขึ้นไปให้แถบข้างยืนถาวรตามแบบ');
  await page.goto('/');
  await settle(page);

  const sidebar = page.locator('#sidebar');
  const vw = testInfo.project.use.viewport.width;

  /* ตอนปิด: อยู่นอกจอทางซ้าย ไม่ใช่แค่มองไม่เห็น */
  const closed = await sidebar.boundingBox();
  expect(closed.x + closed.width, 'แถบข้างต้องถูกเลื่อนออกนอกจอตอนปิด').toBeLessThanOrEqual(1);

  await page.locator('#menu-toggle').click();
  await page.waitForTimeout(300);
  const open = await sidebar.boundingBox();
  expect(open.x, 'กด ☰ แล้วแถบข้างต้องเลื่อนเข้ามา').toBeGreaterThanOrEqual(-1);
  expect(open.width, 'แถบข้างต้องไม่กว้างกว่าจอ').toBeLessThan(vw);

  /* ปิดด้วยการแตะพื้นที่ด้านนอก — ข้อ 6 ระบุไว้ */
  /* แตะทางขวาสุด — ฉากมืดคลุมทั้งจอก็จริง แต่ตัวลิ้นชักลอยอยู่เหนือมันทางซ้าย
     แตะมุมซ้ายบนจะไปโดนลิ้นชักแทน */
  await page.locator('.sidebar-overlay').click({ position: { x: vw - 8, y: 300 } });
  await page.waitForTimeout(300);
  const again = await sidebar.boundingBox();
  expect(again.x + again.width, 'แตะพื้นที่ด้านนอกแล้วต้องปิด').toBeLessThanOrEqual(1);
});
