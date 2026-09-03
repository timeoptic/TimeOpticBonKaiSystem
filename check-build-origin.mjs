/**
 * Gate before publishing: the built web must talk to the API at its OWN origin.
 *
 *   node check-build-origin.mjs
 *
 * A static export bakes NEXT_PUBLIC_API_ORIGIN into the JavaScript at build
 * time. Get that wrong and nothing complains: the export builds, every page
 * loads, `curl` against the server passes - and then a browser anywhere but the
 * shop LAN quietly fails every call, because the URL it was handed points at a
 * private address only the shop can reach.
 *
 * That has happened once already. `start-public.ps1` used to clear the variable
 * with `$env:NEXT_PUBLIC_API_ORIGIN = ''`, which in PowerShell DELETES the
 * variable rather than emptying it, so the build fell through to .env.local and
 * baked the LAN IP in. Windows cannot express an empty environment variable at
 * all, which is why the value now lives in .env.production.local instead.
 *
 * So this looks at what was actually built rather than at what was intended:
 * no absolute API origin, and no reference to the API port, may survive in the
 * client bundles. Both halves must come out as relative paths.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHUNKS = path.join(ROOT, 'frontend-next', 'out', '_next', 'static', 'chunks');

/** ค่าที่ห้ามโผล่ในบันเดิลฝั่งเบราว์เซอร์ พร้อมคำอธิบายว่ามันแปลว่าอะไร */
const FORBIDDEN = [
  [/:8095/g, 'พอร์ต API ตรง ๆ — เบราว์เซอร์นอกวง LAN ยิงไม่ถึง เพราะ tunnel เปิดให้พอร์ตเดียว'],
  [/https?:\/\/192\.168\.\d+\.\d+/g, 'เลข IP วง LAN — เครื่องคนอื่นตีความว่าเป็นเครื่องตัวเอง'],
  [/https?:\/\/(localhost|127\.0\.0\.1)/g, 'localhost — บนเครื่องผู้ชม ไม่ใช่เครื่องเรา'],
];

if (!fs.existsSync(CHUNKS)) {
  console.error(`\n  X ไม่พบ ${CHUNKS}\n    build ก่อน: cd frontend-next && npx next build\n`);
  process.exit(1);
}

const hits = [];
for (const name of fs.readdirSync(CHUNKS)) {
  if (!name.endsWith('.js')) continue;
  const file = path.join(CHUNKS, name);
  const text = fs.readFileSync(file, 'utf8');
  for (const [re, why] of FORBIDDEN) {
    const found = text.match(re);
    if (found) hits.push({ name, sample: found[0], count: found.length, why });
  }
}

if (hits.length === 0) {
  console.log('\n  OK  บันเดิลเรียก API แบบ path สัมพัทธ์ล้วน — เปิดออกเน็ตได้\n');
  process.exit(0);
}

console.error('\n  X บันเดิลฝังที่อยู่ API แบบตายตัวไว้ เปิดออกเน็ตแล้วหน้าเว็บจะยิงไม่ถึง:\n');
const seen = new Set();
for (const h of hits) {
  if (!seen.has(h.why)) {
    console.error(`    ${h.sample}   ${h.why}`);
    seen.add(h.why);
  }
}
console.error(`\n    รวม ${hits.length} จุด ใน ${new Set(hits.map((h) => h.name)).size} ไฟล์`);
console.error('    แก้: build ใหม่โดยให้ NEXT_PUBLIC_API_ORIGIN เป็นค่าว่าง');
console.error('         (frontend-next/.env.production.local — อย่าตั้งผ่าน $env: ใน PowerShell)\n');
process.exit(1);
