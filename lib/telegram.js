// TimeOptic Web — Telegram notifications
import { all, get, run } from './db.js';

let cache = null;
let cacheAt = 0;

export async function settings(force = false) {
  if (!force && cache && Date.now() - cacheAt < 15000) return cache;
  const rows = await all('SELECT `key`, `value` FROM app_settings');
  cache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  // environment always wins, so a token can be kept out of the database
  if (process.env.TELEGRAM_BOT_TOKEN) cache.telegram_bot_token = process.env.TELEGRAM_BOT_TOKEN;
  if (process.env.TELEGRAM_CHAT_ID) cache.telegram_chat_id = process.env.TELEGRAM_CHAT_ID;
  cacheAt = Date.now();
  return cache;
}
export const invalidate = () => { cache = null; };

export async function saveSettings(patch) {
  for (const [key, value] of Object.entries(patch)) {
    await run(
      'INSERT INTO app_settings (`key`, `value`) VALUES (?, ?) ' +
      'ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)', key, String(value ?? ''));
  }
  invalidate();
  return settings(true);
}

/** true when a token and chat id are present and the toggle is on */
export async function isConfigured() {
  const s = await settings();
  return !!(s.telegram_bot_token && s.telegram_chat_id);
}
export async function isEnabled() {
  const s = await settings();
  return s.telegram_enabled === '1' && !!(s.telegram_bot_token && s.telegram_chat_id);
}

/**
 * Send a Telegram message. Never throws — returns {ok, error} and always
 * writes a row to notification_log so failures are visible in the UI.
 */
export async function send(text, { kind = 'manual', booking_id = null, force = false } = {}) {
  const s = await settings();
  const token = s.telegram_bot_token;
  const chatId = s.telegram_chat_id;

  if (!token || !chatId) {
    return logged({ kind, booking_id, target: chatId, message: text, ok: 0,
      error: 'ยังไม่ได้ตั้งค่า Telegram (bot token / chat id)' });
  }
  if (!force && s.telegram_enabled !== '1') {
    return logged({ kind, booking_id, target: chatId, message: text, ok: 0,
      error: 'ปิดการแจ้งเตือน Telegram อยู่' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return logged({ kind, booking_id, target: chatId, message: text, ok: 0,
        error: (data.description || `HTTP ${res.status}`).slice(0, 250) });
    }
    return logged({ kind, booking_id, target: chatId, message: text, ok: 1, error: null });
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'หมดเวลาเชื่อมต่อ Telegram' : e.message;
    return logged({ kind, booking_id, target: chatId, message: text, ok: 0,
      error: String(msg).slice(0, 250) });
  } finally {
    clearTimeout(timer);
  }
}

async function logged(row) {
  try {
    await run(
      `INSERT INTO notification_log (channel, kind, booking_id, target, message, ok, error)
       VALUES ('telegram', ?, ?, ?, ?, ?, ?)`,
      row.kind, row.booking_id, row.target || null, row.message, row.ok, row.error);
  } catch { /* logging must never break the caller */ }
  return { ok: !!row.ok, error: row.error };
}

/** ask Telegram who the bot is — used by the "ทดสอบ" button */
export async function verifyBot() {
  const s = await settings(true);
  if (!s.telegram_bot_token) throw new Error('ยังไม่ได้ใส่ bot token');
  const res = await fetch(`https://api.telegram.org/bot${s.telegram_bot_token}/getMe`);
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || `HTTP ${res.status}`);
  return data.result;
}

/* ------------------------------------------------------------------ *
 * message templates
 * ------------------------------------------------------------------ */
const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function reminderMessage(b, minutes) {
  const name = [b.first_name, b.last_name].filter(Boolean).join(' ') || 'ลูกค้า (ไม่ระบุชื่อ)';
  const lines = [
    `⏰ <b>ใกล้ถึงคิวแล้ว — อีก ${minutes} นาที</b>`,
    '',
    `🕒 <b>${esc(String(b.booking_time).slice(0, 5))}</b> น. · ${esc(b.booking_date)}`,
    `👤 ${esc(name)}${b.phone ? ' · ☎ ' + esc(b.phone) : ''}`,
    `💼 ${esc(b.service_label || b.service_type)}`,
  ];
  if (b.assigned_name) lines.push(`🧑‍💼 ผู้ดูแล: ${esc(b.assigned_name)}`);
  if (b.customer_id) lines.push(`🗂 ลูกค้าเก่า (รหัส #${b.customer_id})`);
  else lines.push('🆕 ลูกค้าใหม่');
  if (b.intake_note) lines.push('', `📝 <b>บันทึกเบื้องต้น</b>\n${esc(b.intake_note)}`);
  if (b.step_notes) lines.push('', `📋 <b>ข้อมูลที่ถามไว้</b>\n${esc(b.step_notes)}`);
  if (b.notes) lines.push('', `ℹ️ ${esc(b.notes)}`);
  lines.push('', `รหัสจอง ${esc(b.booking_code)}`);
  return lines.join('\n');
}

export function bookingCreatedMessage(b) {
  const name = [b.first_name, b.last_name].filter(Boolean).join(' ') || 'ลูกค้า (ไม่ระบุชื่อ)';
  return [
    '🆕 <b>มีการจองคิวใหม่</b>',
    '',
    `🗓 ${esc(b.booking_date)} เวลา <b>${esc(String(b.booking_time).slice(0, 5))}</b> น.`,
    `👤 ${esc(name)}${b.phone ? ' · ☎ ' + esc(b.phone) : ''}`,
    `💼 ${esc(b.service_label || b.service_type)}`,
    b.intake_note ? `\n📝 ${esc(b.intake_note)}` : '',
    `\nรหัสจอง ${esc(b.booking_code)}`,
  ].filter(Boolean).join('\n');
}
