/**
 * หน้าล็อกอิน — หน้าเดียวที่ตรวจได้โดยไม่ต้องมีบัญชี
 *
 * มีค่าสองอย่าง: มันเป็นหน้าจริงที่ต้องผ่านเกณฑ์เหมือนหน้าอื่น และมันเป็นที่ที่
 * พิสูจน์ได้ว่าตัววัดใน audit.js ทำงานจริงโดยไม่ต้องรอรหัสผ่าน
 */
import { test, expect } from '@playwright/test';
import { findOverflow, findSmallTargets, findTinyInputs } from './audit.js';

/* ไม่ใช้ storageState — หน้านี้ต้องดูแบบคนที่ยังไม่ได้ล็อกอิน */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('หน้าเข้าสู่ระบบ', () => {
  test('ไม่มีอะไรล้นออกนอกจอ', async ({ page }, testInfo) => {
    await page.goto('/login/');
    await page.getByLabel('ชื่อผู้ใช้').waitFor();
    const bad = await page.evaluate(findOverflow);
    expect(bad, `ที่ ${testInfo.project.name}:\n`
      + bad.map((b) => `  ${b.el}  ขวาสุด ${b.right}px > จอ ${b.vw}px`).join('\n')).toEqual([]);
  });

  test('ช่องกรอกไม่เล็กกว่า 16px', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('tablet'), 'เกณฑ์นี้เป็นของจอโทรศัพท์');
    await page.goto('/login/');
    await page.getByLabel('ชื่อผู้ใช้').waitFor();
    const bad = await page.evaluate(findTinyInputs);
    expect(bad, bad.map((b) => `  <${b.el}> ${b.name} = ${b.size}px`).join('\n')).toEqual([]);
  });

  test('ปุ่มใหญ่พอให้นิ้วกด', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('tablet'), 'เกณฑ์นี้เป็นของจอโทรศัพท์');
    await page.goto('/login/');
    await page.getByLabel('ชื่อผู้ใช้').waitFor();
    const bad = await page.evaluate(findSmallTargets, 40);
    expect(bad, bad.map((b) => `  ${b.el}  ${b.w}×${b.h}  "${b.text}"`).join('\n')).toEqual([]);
  });
});
