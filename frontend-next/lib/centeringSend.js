/**
 * ปุ่ม "ส่งรูป" ของขั้นวัด Center — ข้อมูลที่ส่งไป API และข้อความบนจอ
 * แยกออกมาจาก CenteringSendModal.jsx เพื่อให้เทสต์ได้โดยไม่ต้อง mount React
 *
 * ของที่ส่งออกไปจริงฝั่ง API อ่านจากฐานเองทั้งหมด (POST /api/centering-photos/send)
 * หน้าเว็บส่งแค่ "ชุดที่ผู้ใช้ตรวจแล้ว" ไปให้เทียบ ถ้าไม่ตรงกัน API ปฏิเสธทั้งชุด
 */

/**
 * @typedef {{ id: number, mime_type?: string|null, original_name?: string|null }} CasePhoto
 * @typedef {{ case_id: number, case_code: string, photo_ids: number[], note: string|null }} CenteringSendBody
 * @typedef {{ ok: true, case_id: number, case_code: string, count: number, sent_by: string, sent_at: string }} CenteringSendResult
 * @typedef {{ title: string, detail: string|null, refresh: boolean }} CenteringSendFailure
 */

export const NO_NOTE = 'ไม่มีหมายเหตุ';

/* ป้ายของสองเหตุการณ์ที่ปุ่มนี้ลงไทม์ไลน์เคส — อยู่ที่นี่ ไม่ได้อยู่ใน ACTION_LABEL
   ของ lib/constants.js เพราะไฟล์นั้นอยู่ใน chunk ที่แทบทุกหน้าโหลด เพิ่มสองบรรทัดที่นั่น
   = ต้องขึ้นหน้าเว็บใหม่ทุกหน้า (ดู deploy/README.md) · ผู้อ่าน: TimelinePanel, หน้าเคส */
export const SEND_EVENT_LABEL = {
  centering_photos_sent: 'ส่งรูปวัด Center',
  centering_photos_send_failed: 'ส่งรูปวัด Center ไม่สำเร็จ',
};

export const SEND_FAILED = 'ส่งรูปไม่สำเร็จ กรุณาลองอีกครั้ง';

/* เหตุผลจาก API ที่ข้อความของมันบอกคนกดได้ว่าต้องทำอะไรต่อ — อย่างอื่น (500, เน็ตหลุด)
   ข้อความเป็นเรื่องเทคนิคที่คนหน้าร้านเอาไปทำอะไรไม่ได้ จึงแสดงแค่ข้อความหลัก */
const TOLD = new Set(['no_photos', 'case_changed', 'photos_changed', 'file_missing', 'sending', 'not_configured']);

const clean = (note) => (typeof note === 'string' ? note.trim() : '');

/**
 * @param {{ caseId: number, caseCode: string, photos: CasePhoto[], note?: string|null }} p
 * @returns {CenteringSendBody}
 */
export function sendPayload({ caseId, caseCode, photos, note }) {
  return {
    case_id: caseId,
    case_code: caseCode,
    photo_ids: photos.map((p) => p.id),
    note: clean(note) || null,
  };
}

/** @param {number} count */
export const photoCountText = (count) => `รูปภาพที่จะส่ง ${count} รูป`;

/** @param {{ caseCode: string, count: number, hasNote: boolean }} p */
export function confirmText({ caseCode, count, hasNote }) {
  const head = `รูปภาพจำนวน ${count} รูปของเคส ${caseCode} จะถูกส่ง`;
  return hasNote ? `${head}พร้อมหมายเหตุจากหน้า Center` : `${head} (${NO_NOTE})`;
}

/** @param {{ caseCode: string, count: number }} p */
export const sentToast = ({ caseCode, count }) => ({
  title: 'ส่งรูปเรียบร้อยแล้ว',
  detail: `เคส ${caseCode} • ${count} รูป`,
});

/**
 * หมายเหตุในช่องยังไม่ตรงกับที่บันทึก Draft ไว้ — ส่งตามที่เห็นบนจอ แต่บอกให้รู้
 * @param {string|null|undefined} current
 * @param {string|null|undefined} saved
 */
export const noteUnsaved = (current, saved) => clean(current) !== clean(saved);

/**
 * รูปที่เคยส่งสำเร็จแล้ว อ่านจากไทม์ไลน์เคส (c.events) — API ลงทุกครั้งที่ส่งสำเร็จ
 * พร้อม id รูปใน payload.centerImages · รีเฟรชหน้าหรือเปิดจากอีกเครื่องก็ยังรู้ว่าส่งแล้ว
 * @param {Array<{ action?: string, payload?: unknown, created_at?: string }>|null|undefined} events
 * @returns {{ ids: number[], last: { at: string, count: number } | null }}
 */
export function sentHistory(events) {
  const ids = new Set();
  let last = null;
  for (const ev of events || []) {
    if (ev?.action !== 'centering_photos_sent') continue;
    let p = ev.payload;
    if (typeof p === 'string') {
      try { p = JSON.parse(p); } catch { p = null; }
    }
    if (!p || p.ok === false) continue;
    const imgs = Array.isArray(p.centerImages) ? p.centerImages.map(Number) : [];
    imgs.forEach((id) => ids.add(id));
    const at = p.sentAt || ev.created_at || '';
    if (!last || at > last.at) last = { at, count: imgs.length };
  }
  return { ids: [...ids], last };
}

/** '2026-10-28 14:38:05' → '14:38' ถ้าเป็นวันนี้ ไม่งั้น '27/10 14:38' */
export function sentStamp(at, today) {
  const s = String(at || '');
  if (s.length < 16) return '';
  const time = s.slice(11, 16);
  return s.slice(0, 10) === today ? time : `${s.slice(8, 10)}/${s.slice(5, 7)} ${time}`;
}

/**
 * หน้าตาปุ่ม "ส่งรูป" — คนหน้าร้านต้องรู้ได้จากปุ่มเลยว่าส่งไปแล้วหรือยัง
 *   first = ยังไม่เคยส่ง (เขียว) · sent = ส่งครบทุกใบแล้ว (เทา ยังกดส่งซ้ำได้)
 *   more  = ส่งไปแล้วแต่มีรูปใหม่ในกล่อง (เขียว) — API ส่งทั้งกล่องเสมอ จึงบอกตรงๆ ว่าส่งทั้งชุด
 * @param {{ photos: CasePhoto[]|null, sent: { ids: number[], last: { at: string, count: number } | null }, today: string }} p
 * @returns {{ tone: 'first'|'sent'|'more', label: string, hint: string|null }}
 */
export function sendButtonState({ photos, sent, today }) {
  const list = photos || [];
  if (list.length === 0) {
    return { tone: 'first', label: 'ส่งรูป', hint: photos ? 'กรุณาเพิ่มรูปภาพก่อนส่ง' : null };
  }
  if (!sent.last) return { tone: 'first', label: 'ส่งรูป', hint: null };
  const done = new Set(sent.ids);
  const fresh = list.filter((p) => !done.has(Number(p.id))).length;
  const when = sentStamp(sent.last.at, today);
  if (fresh === 0) {
    return {
      tone: 'sent',
      label: `ส่งแล้ว ${list.length} รูป${when ? ` · ${when}` : ''}`,
      hint: 'ส่งครบแล้ว — กดอีกครั้งได้ถ้าต้องการส่งซ้ำ',
    };
  }
  return {
    tone: 'more',
    label: `ส่งอีกครั้ง · มีรูปใหม่ ${fresh} รูป`,
    hint: `ส่งล่าสุด ${when || '—'} · กดแล้วจะส่งทั้งชุด ${list.length} รูป`,
  };
}

/**
 * @param {unknown} ex  ข้อผิดพลาดจาก api.post (มี status / reason / data)
 * @returns {CenteringSendFailure}
 */
export function sendFailure(ex) {
  const e = /** @type {{ message?: string, reason?: string|null, data?: { detail?: string } }} */ (ex || {});
  const reason = e.reason || null;
  let detail = null;
  if (reason === 'send_failed') detail = e.data?.detail || null;
  else if (TOLD.has(reason)) detail = e.message || null;
  return { title: SEND_FAILED, detail, refresh: reason === 'photos_changed' };
}
