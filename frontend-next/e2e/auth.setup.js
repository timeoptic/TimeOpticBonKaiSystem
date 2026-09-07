/**
 * ล็อกอินหนึ่งครั้ง เก็บคุกกี้ไว้ให้เทสต์ทุกตัวใช้ร่วมกัน
 *
 * รหัสผ่านของบัญชี test.* **ไม่ได้อยู่ในรีโปและต้องไม่อยู่** — มันถูกเปลี่ยนจาก
 * ค่าเริ่มต้นตอนเปิดให้เข้าจากภายนอก · ส่งเข้ามาทาง environment ตอนรัน:
 *
 *   E2E_USER=test.owner E2E_PASSWORD='xxxx-xxxx-xxxx-xxxx' npx playwright test
 *
 * ต้องใช้บัญชีระดับแอดมินขึ้นไป (test.admin / test.owner) เพราะรายการหน้าที่ต้อง
 * ตรวจมีกลุ่ม "การเงิน" กับ "ข้อมูลระบบ" ซึ่ง role sales มองไม่เห็น — ล็อกอินด้วย
 * test.sales แล้วหน้าพวกนั้นจะตอบการ์ด "ไม่มีสิทธิ์" ซึ่งผ่านเทสต์ได้โดยไม่ได้
 * ตรวจอะไรเลย
 */
import fs from 'node:fs';
import { test as setup, expect } from '@playwright/test';

/**
 * อีกทางหนึ่งของการส่งรหัส: เขียนใส่ไฟล์นี้เอง บรรทัดเดียว ไม่ต้องพิมพ์ลง
 * บรรทัดคำสั่ง (ซึ่งค้างอยู่ในประวัติของเชลล์) · โฟลเดอร์ e2e/.auth/ ถูก
 * gitignore ไว้แล้วทั้งก้อน
 */
const PASS_FILE = 'e2e/.auth/password.txt';
const fromFile = () => {
  try {
    return fs.readFileSync(PASS_FILE, 'utf8').trim() || null;
  } catch {
    return null;
  }
};

const USER = process.env.E2E_USER || 'test.owner';
const PASS = process.env.E2E_PASSWORD || fromFile();

setup('ล็อกอิน', async ({ page }) => {
  if (!PASS) {
    throw new Error(
      'ไม่มีรหัสผ่าน — บัญชี test.* ไม่ได้เก็บรหัสไว้ในรีโปโดยตั้งใจ\n'
      + "  วิธีที่ 1:  E2E_PASSWORD='...' npx playwright test\n"
      + `  วิธีที่ 2:  เขียนรหัสบรรทัดเดียวลงไฟล์ ${PASS_FILE}`,
    );
  }

  await page.goto('/login/');

  /* ช่องกรอกในหน้านี้ไม่มี name/id — ผูกด้วยป้ายกำกับที่คนอ่านเห็น ซึ่งเป็นสิ่ง
     เดียวกับที่ผู้ใช้ใช้หาช่อง และไม่พังเมื่อโครง DOM ข้างในเปลี่ยน */
  await page.getByLabel('ชื่อผู้ใช้').fill(USER);
  await page.getByLabel('รหัสผ่าน').fill(PASS);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();

  /* หน้าแรกหลังล็อกอินคือ /hub/ (เลือกระบบ) หรือ / แล้วแต่สิทธิ์ — ที่ยืนยันได้
     ทั้งสองทางคือ "ไม่ได้อยู่ที่ /login แล้ว" · รอ networkidle ไม่ได้เพราะหน้านี้
     มีนาฬิกาที่เดินตลอด */
  await expect(page).not.toHaveURL(/\/login\//, { timeout: 20_000 });

  await page.context().storageState({ path: 'e2e/.auth/state.json' });
});
