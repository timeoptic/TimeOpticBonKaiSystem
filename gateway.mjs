/**
 * Gateway — เสิร์ฟเว็บกับ API จาก "พอร์ตเดียว" เพื่อเอาไปต่อ tunnel ออกเน็ต
 *
 *   node gateway.mjs [port]        ค่าตั้งต้น 8099
 *
 * ปกติเว็บอยู่ 3010 (next dev) และ API อยู่ 8095 คนละพอร์ต = คนละ origin
 * ในวง LAN ยังพอไหวเพราะ CORS เปิดให้เลข IP ส่วนตัว แต่พอ tunnel ออกเน็ต
 * จะได้คนละ hostname กัน เบราว์เซอร์นับเป็นคนละ site แล้วทิ้งคุกกี้
 * optic_session (SameSite=Lax) → ล็อกอินผ่านแต่เด้งกลับหน้า login ไม่จบ
 *
 * ไฟล์นี้เลยรวมสองฝั่งไว้หลังพอร์ตเดียว:
 *
 *   /api/*  /stock-api/*  ->  proxy ไป 127.0.0.1:8095 (PHP)
 *   ที่เหลือทั้งหมด        ->  ไฟล์ static จาก frontend-next/out
 *
 * ใช้ static export ไม่ใช่ next dev เพราะ dev server ของ Next 16 บล็อก /_next/*
 * ที่มาจาก origin นอก allowedDevOrigins ซึ่งชื่อ tunnel เดาล่วงหน้าไม่ได้
 * ต้อง build ก่อนทุกครั้งที่แก้โค้ดหน้าเว็บ:
 *
 *   cd frontend-next && NEXT_PUBLIC_API_ORIGIN= npx next build
 *
 * ค่า NEXT_PUBLIC_API_ORIGIN ต้องว่าง เพื่อให้ apiClient ยิงเป็น path สัมพัทธ์
 * (/api/...) ซึ่งวิ่งกลับมาที่พอร์ตนี้เอง = same origin คุกกี้จึงติดไปด้วย
 */
import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(ROOT, 'frontend-next', 'out');
const PORT = Number(process.argv[2] || process.env.GATEWAY_PORT || 8099);
const API = { host: '127.0.0.1', port: Number(process.env.API_PORT || 8095) };

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

const isApi = (p) => p === '/api' || p === '/stock-api' ||
  p.startsWith('/api/') || p.startsWith('/stock-api/');

/* ส่งต่อไปหา PHP ตรง ๆ ทั้ง header และ body — สตรีมทั้งขาไปขากลับ เพราะ
   /api/uploads/:id คายรูปออกมาเป็นไฟล์ ไม่ใช่ JSON ก้อนเล็ก ๆ */
function proxy(req, res) {
  const headers = { ...req.headers, host: `${API.host}:${API.port}` };
  const fwd = req.socket.remoteAddress || '';
  headers['x-forwarded-for'] = req.headers['x-forwarded-for'] || fwd;
  headers['x-forwarded-host'] = req.headers['host'] || '';

  const up = http.request(
    { host: API.host, port: API.port, method: req.method, path: req.url, headers },
    (r) => {
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    },
  );
  up.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: `API ไม่ตอบที่ ${API.host}:${API.port} — ${e.code || e.message}` }));
  });
  req.pipe(up);
}

/**
 * ที่อยู่บนดิสก์ของ RSC payload ที่ Next ใช้ prefetch หน้าถัดไป
 *
 * Next 16 ขอไฟล์พวกนี้เป็นชื่อเดียวยาว ๆ คั่นด้วยจุด แต่ตอน export มันเขียนลง
 * ดิสก์เป็นโฟลเดอร์ซ้อนกัน จุดแรกหลัง `__next` เป็นส่วนหนึ่งของชื่อโฟลเดอร์
 * จุดที่เหลือคือตัวคั่นชั้น:
 *
 *   /stock/products/__next.stock.!KHNoZWxsKQ.products.__PAGE__.txt
 *   -> stock/products/__next.stock/!KHNoZWxsKQ/products/__PAGE__.txt
 *
 * ไม่แปลงให้ ไฟล์พวกนี้ 404 หมด · หน้าเว็บยังใช้ได้เพราะกดแล้วมันโหลดเต็มหน้า
 * แทน แต่การกดข้ามหน้าในฝั่งคลังจะสะดุดทุกครั้งแทนที่จะไหลลื่น
 * (`__next._full.txt` กับ `__next._tree.txt` มีจุดเดียว กฎนี้จึงไม่แตะ)
 */
function rscPath(urlPath) {
  const dir = path.posix.dirname(urlPath);
  const base = path.posix.basename(urlPath);
  if (!base.startsWith('__next.') || !base.endsWith('.txt')) return null;
  const parts = base.slice(0, -'.txt'.length).split('.');
  if (parts.length < 3) return null;
  const nested = [`${parts[0]}.${parts[1]}`, ...parts.slice(2)].join('/') + '.txt';
  return resolveSafe(path.posix.join(dir, nested));
}

/* กัน path traversal: ผลลัพธ์ต้องยังอยู่ใต้ WEB เท่านั้น */
function resolveSafe(urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(WEB, clean);
  return full.startsWith(WEB) ? full : null;
}

async function serveFile(res, file, status = 200) {
  const stat = await fsp.stat(file);
  res.writeHead(status, {
    'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': stat.size,
    /* ไฟล์ใน /_next/static มีแฮชอยู่ในชื่อ แคชยาวได้ ที่เหลือห้ามแคช
       ไม่งั้นแก้หน้าเว็บแล้ว build ใหม่ เครื่องที่เคยเปิดจะเห็นของเก่า */
    'cache-control': file.includes(`_next${path.sep}static`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  if (isApi(urlPath)) return proxy(req, res);

  const file = resolveSafe(urlPath);
  if (!file) {
    res.writeHead(400).end('bad path');
    return;
  }

  try {
    /* export ตั้ง trailingSlash: true ไว้ ทุกหน้าจึงเป็น <route>/index.html
       ขอมาแบบไม่มี / ท้าย ให้เด้งไปตัวมี / เพื่อให้ path สัมพัทธ์ในหน้าไม่เพี้ยน */
    const stat = await fsp.stat(file).catch(() => null);
    if (stat?.isDirectory()) {
      if (!urlPath.endsWith('/')) {
        /* ต้องพก ?query ไปด้วย — เดิมเด้งแค่ path ลิงก์ /cases/detail?id=9430 จึงไปจบที่
           /cases/detail/ เปล่า ๆ หน้าเคสขึ้น "ไม่พบข้อมูล" (ร้านเจอ 26 ก.ย. 2026 จากหน้าประวัติเลนส์) */
        const query = (req.url || '').slice(urlPath.length);
        res.writeHead(308, { location: urlPath + '/' + query }).end();
        return;
      }
      return await serveFile(res, path.join(file, 'index.html'));
    }
    if (stat?.isFile()) return await serveFile(res, file);

    const rsc = rscPath(urlPath);
    if (rsc && (await fsp.stat(rsc).catch(() => null))?.isFile()) {
      return await serveFile(res, rsc);
    }
    return await serveFile(res, path.join(WEB, '404.html'), 404);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      .end('ไม่พบหน้านี้ — build หน้าเว็บแล้วหรือยัง? (cd frontend-next && npx next build)');
  }
});

if (!fs.existsSync(WEB)) {
  console.error(`\n  X ยังไม่มี ${WEB}`);
  console.error('    build ก่อน:  cd frontend-next && NEXT_PUBLIC_API_ORIGIN= npx next build\n');
  process.exit(1);
}

/* กันพอร์ตชนแบบเงียบ ๆ — เคสจริงที่เสียเวลาไปแล้วครั้งหนึ่ง
   Windows ให้ bind 0.0.0.0:PORT สำเร็จ ทั้งที่มีอีกโปรเซส bind 127.0.0.1:PORT
   ค้างอยู่ แล้วเวลาต่อเข้ามาทาง localhost เคอร์เนลเลือกตัวที่เจาะจงกว่า คือตัวเก่า
   — gateway ขึ้นปกติ ไม่มี error แต่คนที่เข้าเว็บไปเจอ API ตัวอื่นตอบแทน
   (ngrok ก็ต่อเข้า localhost) เช็กก่อนว่ามีใครรับสายที่พอร์ตนี้อยู่ไหม */
const inUse = await new Promise((resolve) => {
  const probe = net.connect({ host: '127.0.0.1', port: PORT });
  probe.setTimeout(700);
  probe.on('connect', () => { probe.destroy(); resolve(true); });
  probe.on('timeout', () => { probe.destroy(); resolve(false); });
  probe.on('error', () => resolve(false));
});
if (inUse) {
  console.error(`\n  X มีโปรเซสอื่นรับสายที่ 127.0.0.1:${PORT} อยู่แล้ว`);
  console.error('    ถ้าปล่อยไว้ ตัวนั้นจะเป็นคนตอบคนที่เข้าเว็บ ไม่ใช่ไฟล์นี้');
  console.error(`    หาตัวมันด้วย:  netstat -ano | findstr :${PORT}\n`);
  process.exit(1);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  gateway  http://127.0.0.1:${PORT}`);
  console.log(`    web      ${WEB}`);
  console.log(`    api      -> ${API.host}:${API.port}  (/api, /stock-api)\n`);
});
