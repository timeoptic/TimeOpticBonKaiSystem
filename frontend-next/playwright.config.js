/**
 * เกณฑ์รับงาน "ใช้บนมือถือได้" ที่วัดด้วยเครื่อง ไม่ใช่ด้วยความรู้สึก
 *
 * เทสต์ชุดนี้เปิดหน้าจริงบนเบราว์เซอร์จริงที่ความกว้างจริงหกขนาด แล้วถามสามคำถาม
 * ต่อหน้าต่อขนาด: มีอะไรล้นออกนอกจอไหม · ช่องกรอกเล็กกว่า 16px ไหม (iOS จะซูมเอง)
 * · ปุ่มเล็กกว่าเป้านิ้วไหม
 *
 * **ต้องมีของสามอย่างเปิดอยู่ก่อนรัน** — เทสต์นี้ไม่ได้ยกเซิร์ฟเวอร์ให้เอง เพราะ
 * ระบบนี้มีสามชั้น (next dev :3010 · PHP API :8095 · MySQL :3306) ที่ตั้งค่าไว้
 * นอกรีโปแล้ว การให้ Playwright ยกเองจะได้แค่ชั้นเดียวแล้วเทสต์ล้มด้วยเหตุผลที่
 * ไม่เกี่ยวกับหน้าเว็บเลย
 *
 * `E2E_USER` / `E2E_PASSWORD` มาจาก environment เท่านั้น — รหัสของบัญชี test.*
 * ไม่ได้อยู่ในรีโปและต้องไม่อยู่ · ดู e2e/auth.setup.js
 *
 * baseURL ต้องเป็นเลข IP ตัวเดียวกับที่ NEXT_PUBLIC_API_ORIGIN ใน .env.local ชี้ไว้
 * ถ้าใช้คนละชื่อ host เบราว์เซอร์จะทิ้งคุกกี้ optic_session (SameSite=Lax) แล้ว
 * ล็อกอินผ่านแต่เด้งกลับหน้า login วนไม่จบ
 */
import { defineConfig, devices } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://192.168.1.107:3010';

/* ความกว้างที่โจทย์ระบุ ทุกตัวคือเครื่องจริงที่พนักงานถืออยู่ ไม่ใช่เลขกลม ๆ */
export const VIEWPORTS = [
  { name: 'mobile-360', width: 360, height: 800 },
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-430', width: 430, height: 932 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'tablet-1024', width: 1024, height: 768 },
];

export default defineConfig({
  testDir: './e2e',
  /* หน้าเดียวกันหกขนาดไม่ได้แข่งกันเรื่อง state — ขนานได้เต็มที่ */
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
  timeout: 60_000,
  use: {
    baseURL: BASE,
    /* trailingSlash:true ใน next.config.js — ทุก URL ต้องลงท้ายด้วย / ไม่งั้นได้ 308 */
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.js/ },
    ...VIEWPORTS.map((v) => ({
      name: v.name,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: v.width, height: v.height },
        /* isMobile/hasTouch เปลี่ยนผลจริง — กฎ CSS ของระบบนี้ผูกกับ (pointer:coarse)
           อยู่หลายที่ ถ้าไม่เปิด เทสต์จะวัดหน้าที่ผู้ใช้จริงไม่ได้เห็น */
        hasTouch: v.width < 1024,
        storageState: 'e2e/.auth/state.json',
      },
    })),
  ],
});
