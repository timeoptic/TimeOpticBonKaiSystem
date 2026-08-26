// TimeOptic Web — HTTP server (no external dependencies)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { handle, HttpError } from './lib/api.js';
import { verifyConnection, CONFIG, pool } from './lib/db.js';
import { migrate } from './lib/migrate.js';
import * as scheduler from './lib/scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 2 * 1024 * 1024) throw new HttpError(413, 'Payload too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

async function serveStatic(res, pathname) {
  const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': data.length,
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    // single-page app: unknown non-asset paths fall back to index.html
    if (!extname(rel)) {
      const data = await readFile(join(PUBLIC, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] }).end(data);
    } else {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return json(res, 405, { error: 'Method not allowed' });
    }
    return serveStatic(res, pathname);
  }

  try {
    const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
    const query = Object.fromEntries(url.searchParams);
    const result = await handle(req.method, pathname, query, body);
    json(res, 200, result === undefined ? { ok: true } : result);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(`[${req.method} ${pathname}]`, err);
    json(res, status, { error: err.message || 'Internal error' });
  }
});

let info;
try {
  info = await verifyConnection();
} catch (e) {
  console.error('\n  ✖ เชื่อมต่อฐานข้อมูลไม่ได้');
  console.error(`     ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);
  console.error(`     ${e.message}`);
  console.error('\n  ตรวจสอบว่า MySQL/MariaDB ของ XAMPP รันอยู่ (XAMPP Control Panel → MySQL → Start)\n');
  process.exit(1);
}

let created = [];
try {
  created = await migrate();
} catch (e) {
  console.error('\n  ✖ สร้างตารางสำหรับระบบจองคิวไม่สำเร็จ:', e.message, '\n');
  process.exit(1);
}

const tickMs = scheduler.start();

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  TimeOptic Web  —  ระบบจัดการร้านแว่นตา');
  console.log(`  ▶  http://localhost:${PORT}`);
  // when bound to every interface, print the addresses other devices can use
  if (HOST === '0.0.0.0' || HOST === '::') {
    for (const list of Object.values(networkInterfaces())) {
      for (const net of list ?? []) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`  ▶  http://${net.address}:${PORT}   (เครื่องอื่นในวงเดียวกัน)`);
        }
      }
    }
  }
  console.log(`  DB  MariaDB ${info.version} · ${info.db} · ${info.tables} tables`);
  if (created.length) console.log(`  ✚  สร้างตารางใหม่: ${created.join(', ')}`);
  console.log(`  ⏰ ตัวเตือนคิว Telegram ทำงานทุก ${Math.round(tickMs / 1000)} วินาที`);
  console.log('  (กด Ctrl+C เพื่อหยุดเซิร์ฟเวอร์)');
  console.log('');
});

const shutdown = async () => {
  scheduler.stop();
  await pool.end().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
