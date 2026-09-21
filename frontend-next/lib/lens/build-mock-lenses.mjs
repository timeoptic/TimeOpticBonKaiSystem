/**
 * สร้าง lib/lens/mockLenses.js จากไฟล์ Export "สินค้าและสต็อก" ของระบบ TimeOptic (เว็บหลัก)
 *
 *   node lib/lens/build-mock-lenses.mjs "<ไฟล์ timeoptic-สินค้าและสต็อก-*.xlsx>"
 *
 * เอาเฉพาะแถวชนิด "เลนส์" · ชื่อซ้ำเก็บตัวแรก · ตัด "NO LENS" ทิ้ง (Bewell ไม่เลือกเลนส์ = ไม่มีเลนส์อยู่แล้ว)
 * ผลลัพธ์เป็นข้อมูลจำลอง ไม่ลงฐาน bewell — ดู lensSource.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const src = process.argv[2];
if (!src) {
  console.error('ใช้: node lib/lens/build-mock-lenses.mjs <ไฟล์ xlsx>');
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(src);
const ws = wb.worksheets[0];

/* หาแถวหัวตาราง (แถวที่ช่องแรกเป็น "SKU") แล้วอ่านคอลัมน์ตามชื่อ ไม่ยึดตำแหน่ง */
let headRow = null;
ws.eachRow((row, n) => {
  if (headRow === null && String(row.getCell(1).value ?? '').trim() === 'SKU') headRow = n;
});
if (headRow === null) {
  console.error('ไม่พบหัวตาราง (ช่อง SKU) ในชีตแรก');
  process.exit(1);
}
const col = {};
ws.getRow(headRow).eachCell((c, i) => { col[String(c.value).trim()] = i; });
for (const need of ['SKU', 'สินค้า', 'แบรนด์', 'ชนิด', 'Index', 'ชนิดเลนส์', 'Coating', 'SPH', 'CYL', 'ADD']) {
  if (!col[need]) {
    console.error(`ไม่พบคอลัมน์ "${need}"`);
    process.exit(1);
  }
}

const text = (row, name) => {
  const v = row.getCell(col[name]).value;
  return v === null || v === undefined ? '' : String(v).trim();
};
const power = (row, name) => {
  const t = text(row, name);
  return t === '' ? '' : Number(t).toFixed(2);
};

const seen = new Set();
const out = [];
for (let n = headRow + 1; n <= ws.rowCount; n++) {
  const row = ws.getRow(n);
  if (text(row, 'ชนิด') !== 'เลนส์') continue;
  const name = text(row, 'สินค้า');
  if (!name || name === 'NO LENS' || seen.has(name)) continue;
  seen.add(name);
  out.push([
    text(row, 'SKU'), name, text(row, 'แบรนด์'), text(row, 'Index'), text(row, 'ชนิดเลนส์'),
    text(row, 'Coating'), power(row, 'SPH'), power(row, 'CYL'), text(row, 'ADD'),
  ]);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const body = `/**
 * เลนส์จำลองของ Bewell — รายชื่อเลนส์จากระบบ TimeOptic (เว็บหลัก) · ไม่ใช่สต็อกของ Bewell
 * ไม่มีจำนวนคงเหลือ และไม่อยู่ในฐานข้อมูล · ไฟล์นี้สร้างอัตโนมัติ ห้ามแก้มือ
 *
 *   ที่มา: ${path.basename(src)}
 *   สร้างใหม่: node lib/lens/build-mock-lenses.mjs "<ไฟล์ xlsx>"
 *
 * แต่ละแถว: [SKU เดิม, ชื่อ, แบรนด์, Index, ชนิดเลนส์, Coating, SPH, CYL, ADD]
 */
const ROWS = [
${out.map((r) => '  ' + JSON.stringify(r)).join(',\n')},
];

export const MOCK_LENSES = ROWS.map(([sku, name, brand, index, type, coating, sph, cyl, add]) => ({
  mock_code: sku,
  name,
  brand,
  lens_index: index,
  lens_type: type,
  coating,
  sph,
  cyl,
  add,
}));
`;
fs.writeFileSync(path.join(here, 'mockLenses.js'), body);
console.log(`เขียน lib/lens/mockLenses.js แล้ว: เลนส์ ${out.length} รายการ`);
