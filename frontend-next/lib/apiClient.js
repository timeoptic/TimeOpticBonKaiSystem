'use client';
/**
 * API client. Port of frontend/src/api/client.js, with one addition: every
 * call is prefixed with NEXT_PUBLIC_API_ORIGIN (set in .env.local during
 * development, left empty in production) since a static export has no dev
 * proxy the way Vite's server.proxy did.
 */

import { fileNameFromDisposition, saveBlob } from './download.js';
import { shrinkImage } from './shrinkImage.js';

function apiOrigin() {
  return process.env.NEXT_PUBLIC_API_ORIGIN || '';
}

const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== '' && v !== null && v !== undefined) p.set(k, v);
  }
  const s = p.toString();
  return s ? '?' + s : '';
};

async function request(method, path, body, signal) {
  const res = await fetch(apiOrigin() + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
    /* คุกกี้ optic_session ต้องไปด้วยทุกครั้ง ไม่งั้น API ตอบ 401 ทั้งที่ล็อกอินแล้ว
       — หน้าเว็บกับ API อยู่คนละพอร์ต เบราว์เซอร์จึงไม่แนบให้เองถ้าไม่บอก */
    credentials: 'include',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw apiError(res.status, data);
  return data;
}

/**
 * ข้อผิดพลาดที่พกรหัสสถานะ รหัสเหตุผล และตัวคำตอบไปด้วย
 *
 * ยังเป็น Error ที่ `message` คือข้อความภาษาไทยเหมือนเดิม — ที่เรียกอยู่แล้วไม่ต้องแก้
 * ส่วนหน้าที่ต้องแตกเงื่อนไข (เช่นรับเงิน "อาจซ้ำ" ที่ถามยืนยันแล้วส่งใหม่ได้) อ่าน
 * `reason` แทนการเทียบข้อความ ซึ่งเปลี่ยนคำเมื่อไหร่ก็พังเงียบ
 */
function apiError(status, data) {
  const e = new Error(errorText(data) || `HTTP ${status}`);
  e.status = status;
  e.reason = (data && data.reason) || null;
  e.data = data;
  return e;
}

/**
 * ข้อความปฏิเสธจาก API ทั้งสองฝั่ง
 *
 * ฝั่งหน้าร้านตอบ `{error}` ส่วนฝั่งคลัง (`/stock-api/*`) ตอบ `{reason, message}`
 * — หน้าผู้ใช้และสิทธิ์เรียกข้ามไปฝั่งนั้น เพราะตาราง `admins` กับกฎสิทธิ์อยู่ที่
 * โน่น · อ่านแค่ `error` อย่างเดียวจะได้ "HTTP 409" แทนคำอธิบายภาษาไทยที่ API
 * อุตส่าห์เขียนมาให้ ซึ่งเป็นข้อความที่คนกดปุ่มเอาไปทำอะไรต่อไม่ได้เลย
 */
function errorText(data) {
  if (!data) return '';
  return data.error || data.message || '';
}

/* ย่อรูปตรงนี้จุดเดียว — ทุกกล่องแนบไฟล์ (รูปการวัด สลิปโอนเงิน ไฟล์ส่งมอบ) ส่ง
   ผ่าน upload() หมด กล่องที่เพิ่มทีหลังจึงได้รูปที่ย่อแล้วโดยไม่ต้องจำ */
async function upload(path, formData) {
  const file = formData.get('file');
  if (file && typeof file === 'object') {
    const small = await shrinkImage(file);
    if (small !== file) formData.set('file', small, small.name);
  }
  const res = await fetch(apiOrigin() + path, { method: 'POST', body: formData, credentials: 'include' });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

/**
 * โหลดไฟล์ที่ API สร้างให้ (เช่นรายงาน .xlsx) แล้วบันทึกลงเครื่อง
 *
 * ทำไมไม่ใช้ `<a href>` ชี้ไปที่ API ตรง ๆ ทั้งที่สั้นกว่า — หน้าเว็บกับ API อยู่
 * คนละพอร์ต คุกกี้ `optic_session` เป็น SameSite=Lax จึงไม่ถูกแนบไปกับการโหลด
 * ข้ามที่อยู่แบบนั้น ผลคือดาวน์โหลดได้ไฟล์ที่ข้างในเป็น JSON ว่า "ต้องเข้าสู่ระบบ
 * ก่อน" · fetch พร้อม credentials คือทางเดียวที่ได้ทั้งคุกกี้และข้อความผิดพลาด
 * ที่เอาไปแสดงต่อได้
 */
async function download(path, fallbackName) {
  const res = await fetch(apiOrigin() + path, { credentials: 'include' });
  if (!res.ok) {
    /* คำตอบที่ผิดพลาดยังเป็น JSON เหมือนเส้นอื่น — อ่านข้อความจริงมาโยนต่อ
       ไม่ใช่บอกแค่ HTTP 403 ซึ่งคนกดปุ่มเอาไปทำอะไรไม่ได้ */
    let message = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data && data.error) message = data.error;
    } catch {
      /* ไม่ใช่ JSON ก็ใช้รหัสสถานะไปตามเดิม */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  saveBlob(blob, fileNameFromDisposition(res.headers.get('content-disposition')) || fallbackName);
}

export const api = {
  get: (path, query, signal) => request('GET', path + qs(query), null, signal),
  post: (path, body) => request('POST', path, body || {}),
  put: (path, body) => request('PUT', path, body || {}),
  del: (path) => request('DELETE', path),
  upload: (path, formData) => upload(path, formData),
  download: (path, fallbackName) => download(path, fallbackName),
  url: (path) => apiOrigin() + path,
};
