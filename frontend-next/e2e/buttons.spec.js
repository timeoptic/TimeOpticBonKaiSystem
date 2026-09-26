/**
 * กวาดปุ่มทุกปุ่มในทุกหน้า — "กดแล้วพังไหม" ไม่ใช่ "กดแล้วได้ผลถูกไหม"
 *
 * เกณฑ์ผ่านมีสามข้อ ต่อหนึ่งปุ่ม:
 *   1. ปุ่มมีป้ายกำกับที่คนอ่านออก (ปุ่มไม่มีชื่อ = คนใช้เดาไม่ได้ และ screen reader ก็อ่านไม่ได้)
 *   2. กดแล้วไม่มี error ขึ้นใน console
 *   3. กดแล้วไม่มีคำขอไหนตอบ 5xx
 *
 * **ทำไมไม่กดทุกปุ่มจริง ๆ** — ฐานข้อมูลนี้เป็นข้อมูลร้านจริงสามปี ปุ่มอย่าง "ลบ"
 * "บันทึก" "ส่งมอบ" เขียนทับของจริง เทสต์ชุดนี้จึงกดเฉพาะปุ่มที่ไม่เขียนอะไรลงฐาน
 * (เปิดกล่อง เปลี่ยนแท็บ กรอง ค้นหา) แล้ว *นับ* ปุ่มที่เหลือไว้ในรายงานว่าข้ามเพราะอะไร
 * ปุ่มที่เขียนข้อมูลถูกตรวจในเส้นทางจริงที่ flows.spec.js เดินบนเคสทดสอบที่สร้างเอง
 *
 * รันหน้าจอเดียวพอ (tablet-1024) — ปุ่มชุดเดียวกันทั้งหกขนาด สิ่งที่ต่างกันตามขนาด
 * คือ "ใหญ่พอให้นิ้วกดไหม" ซึ่ง mobile.spec.js ตรวจอยู่แล้ว
 */
import { test, expect } from '@playwright/test';
import { ROUTES } from './routes.js';

/* ปุ่มที่กดไม่ได้ในเทสต์ พร้อมเหตุผลที่จะขึ้นในรายงาน */
const SKIP = [
  /* ปุ่มบนแถบบนเขียนแค่ "ออก" — ไม่กันไว้ เทสต์กดออกจากระบบเองแล้วทุกปุ่มหลังจากนั้นตกหมด */
  [/^ออก$|ออกจากระบบ|ล็อกเอาต์/, 'จะทำให้เทสต์ที่เหลือหลุดล็อกอิน'],
  [/พิมพ์|print/i, 'เปิดกล่องพิมพ์ของระบบปฏิบัติการซึ่งปิดเองไม่ได้'],
  [/^ลบ|ลบ$|ลบทิ้ง|ยกเลิกบิล|void/i, 'ลบข้อมูลจริง'],
  [/บันทึก|ยืนยัน|สร้าง(?!ใหม่)|ออกใบ|ส่งมอบ|ตัดจ่าย|รับเงิน|จ่ายเงิน|ปิดเคส|ปิดงาน/, 'เขียนข้อมูลลงฐาน'],
  [/ส่งแจ้งเตือน|ทดสอบการแจ้งเตือน|ส่งข้อความ|remind/i, 'ยิง Telegram เข้ากลุ่มจริง'],
  [/รีเซ็ตรหัส|เปลี่ยนรหัส|ระงับ|เพิกถอน/, 'แตะบัญชีผู้ใช้จริง'],
  [/นำออก|ส่งออก|export|xlsx|ดาวน์โหลด/i, 'สั่งดาวน์โหลดไฟล์'],
];

const skipReason = (label) => SKIP.find(([re]) => re.test(label))?.[1] ?? null;

/** ปุ่มทุกตัวที่ผู้ใช้เห็นและกดได้ พร้อมป้ายกำกับที่ใช้อ้างถึงมัน */
const collectButtons = () => {
  const sel = 'button, [role="button"], input[type="submit"], input[type="button"], a[class*="btn"]';
  /* i = ลำดับในเอกสารทั้งหมด (ก่อนกรองตัวที่มองไม่เห็น) — ต้องตรงกับ locator(...).nth(i)
     ที่นับทุกตัว · เคยนับหลังกรอง ปุ่มเมนูมือถือที่ซ่อนอยู่หน้าสุดทำให้เลื่อนไปหนึ่งช่อง
     แล้วทุกครั้งที่ตั้งใจกดปุ่มที่สอง ไปโดนปุ่ม "ออก" จนหลุดล็อกอินทั้งชุด */
  return [...document.querySelectorAll(sel)]
    .map((el, i) => ({ el, i }))
    .filter(({ el }) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    })
    .map(({ el, i }) => ({
      i,
      label: (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().replace(/\s+/g, ' '),
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      tag: el.tagName.toLowerCase(),
    }));
};

test.describe('ปุ่มทุกปุ่มกดแล้วไม่พัง', () => {
  for (const [path, name] of ROUTES) {
    test(`${name}  ${path}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'tablet-1024', 'ปุ่มชุดเดียวกันทุกขนาดจอ — ตรวจครั้งเดียวพอ');

      const errors = [];
      const server5xx = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('response', (r) => {
        if (r.status() >= 500) server5xx.push(`${r.status()} ${r.request().method()} ${r.url()}`);
      });

      await page.goto(path);
      await page.waitForLoadState('domcontentloaded');
      /* หน้าพวกนี้ยิง API ตอน mount — รอให้คำขอชุดแรกจบก่อนค่อยนับปุ่ม
         ไม่ใช้ networkidle เพราะหลายหน้ามีนาฬิกา/โพลลิ่งที่ไม่มีวันเงียบ */
      await page.waitForTimeout(1500);

      const buttons = await page.evaluate(collectButtons);
      const report = [];
      const unnamed = [];

      for (const b of buttons) {
        if (!b.label) { unnamed.push(`<${b.tag}> ลำดับที่ ${b.i} ไม่มีป้ายกำกับ`); continue; }
        const why = skipReason(b.label);
        if (why) { report.push(`  ⤳ ข้าม "${b.label}" — ${why}`); continue; }
        if (b.disabled) { report.push(`  · "${b.label}" ปิดใช้งานอยู่`); continue; }

        const before = errors.length;
        const before5 = server5xx.length;
        /* ลำดับปุ่มเลื่อนได้หลังกดปุ่มก่อนหน้า (กล่องเปิดค้าง แท็บเปลี่ยน รายการโหลดเพิ่ม) —
           กดตามลำดับเดิมโดยไม่ดูชื่อเคยไปโดนปุ่ม "ออก" แล้วหลุดล็อกอินทั้งชุด
           จึงเช็กชื่อก่อนทุกครั้ง ไม่ตรงก็เปิดหน้าใหม่แล้วเช็กอีกรอบ */
        const now = () => page.evaluate(collectButtons).then((all) => all.find((x) => x.i === b.i) ?? null);
        let cur = await now();
        if (cur?.label !== b.label) {
          await page.goto(path);
          await page.waitForTimeout(1500);
          cur = await now();
          if (cur?.label !== b.label) {
            report.push(`  ⤳ ข้าม "${b.label}" — ตำแหน่งปุ่มเปลี่ยนหลังเปิดหน้าใหม่`);
            continue;
          }
        }
        /* ปุ่มที่กดก่อนหน้าปิดปุ่มนี้ไปแล้ว (เช่นกดหน้าสุดท้ายแล้ว "หน้าถัดไป" ถูกปิด) — ถูกต้อง ไม่ใช่พัง */
        if (cur.disabled) { report.push(`  · "${b.label}" ปิดใช้งานอยู่ (หลังกดปุ่มก่อนหน้า)`); continue; }
        const el = page.locator(
          'button, [role="button"], input[type="submit"], input[type="button"], a[class*="btn"]',
        ).nth(b.i);
        try {
          await el.click({ timeout: 5000, trial: false });
          await page.waitForTimeout(400);
        } catch (e) {
          report.push(`  ✗ "${b.label}" กดไม่ได้: ${String(e).split('\n')[0]}`);
          continue;
        }

        const newErrs = errors.slice(before);
        const new5 = server5xx.slice(before5);
        if (newErrs.length || new5.length) {
          report.push(`  ✗ "${b.label}" → ${[...new5, ...newErrs].join(' | ')}`);
        } else {
          report.push(`  ✓ "${b.label}"`);
        }

        /* กลับสู่สภาพเดิมก่อนกดปุ่มถัดไป: ปิดกล่องที่เพิ่งเปิด แล้วถ้าหลุดไปหน้าอื่น
           ให้เดินกลับมา — ไม่งั้นลำดับปุ่มที่เก็บไว้จะไม่ตรงกับหน้าที่อยู่ */
        await page.keyboard.press('Escape').catch(() => {});
        /* เทียบ pathname ตรงตัว — includes('/') เป็นจริงทุกหน้า หน้าแรกจึงไม่เคยเดินกลับ */
        if (new URL(page.url()).pathname !== path) {
          await page.goto(path);
          await page.waitForTimeout(800);
        }
      }

      testInfo.annotations.push({ type: 'ปุ่ม', description: `\n${report.join('\n')}` });

      expect(unnamed, `ปุ่มไม่มีป้ายกำกับที่ ${path}:\n${unnamed.join('\n')}`).toEqual([]);
      const broke = report.filter((l) => l.startsWith('  ✗'));
      expect(broke, `ปุ่มที่กดแล้วมีปัญหาที่ ${path}:\n${broke.join('\n')}`).toEqual([]);
    });
  }
});
