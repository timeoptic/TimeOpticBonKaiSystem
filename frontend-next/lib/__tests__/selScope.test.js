import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/*
 * `sel` เป็นชื่อคลาสสองความหมาย: กล่อง <Select> (`.sel` ที่มี `.sel-trigger` อยู่ข้างใน)
 * กับสถานะ "ตัวที่เลือกอยู่" ของปฏิทิน ตัวเลือกเวลา และรายการตัวเลือก (`.datef-day.sel`
 * `.timef-opt.sel` `.sel-opt.sel` …)
 *
 * กฎที่ตั้งขนาดกล่องเลือกตามที่อยู่ เช่น `.report-filter .sel{min-width:126px}` จึงไปโดน
 * วันที่ที่เลือกในปฏิทินที่วางอยู่ในแถบเดียวกันด้วย — คอลัมน์ของวันนั้นถ่างเป็น 126px
 * ปฏิทินทั้งแผ่นเบี้ยว (ร้านเจอ 14 ก.ย. 2026 บนหน้ารายงาน)
 *
 * กฎ: กฎที่เลือก `.sel` ผ่านตัวครอบ ต้องระบุว่าหมายถึงกล่อง Select ด้วย `:has(>.sel-trigger)`
 */
const css = fs.readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const selectorsOf = (source) => source
  .split('}')
  .map((rule) => rule.split('{').slice(-2, -1)[0] || '')
  .flatMap((sel) => sel.split(','))
  .map((s) => s.trim())
  .filter(Boolean);

test('กฎที่ตั้งขนาด .sel ผ่านตัวครอบ เจาะจงกล่อง Select ไม่ใช่ทุกตัวที่ถูกเลือก', () => {
  const leaking = selectorsOf(css).filter((s) => /\s\.sel(?![-\w])(?!:has\(>\.sel-trigger\))/.test(s)
    && !/\.sel[.:]open|\.sel\.open/.test(s));
  assert.deepEqual(leaking, []);
});
