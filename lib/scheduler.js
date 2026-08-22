// TimeOptic Web — background reminder loop for queue bookings
import { all, run } from './db.js';
import { send, reminderMessage, isEnabled } from './telegram.js';
import { SERVICE_TYPES } from './migrate.js';

const SERVICE_LABEL = Object.fromEntries(SERVICE_TYPES);
const TICK_MS = Number(process.env.REMINDER_TICK_MS) || 30000;
/** don't fire reminders for bookings whose slot is already this far past */
const GRACE_MINUTES = 45;

let timer = null;
let running = false;

/**
 * Find bookings whose start is within their own reminder window and that
 * have not been reminded yet.
 */
async function dueBookings() {
  return all(`
    SELECT b.*, e.employee_name AS assigned_name,
           TIMESTAMPDIFF(MINUTE, NOW(), TIMESTAMP(b.booking_date, b.booking_time)) AS mins_away
    FROM bookings b
    LEFT JOIN employees e ON e.id = b.assigned_to
    WHERE b.reminder_sent_at IS NULL
      AND b.status IN ('booked', 'confirmed')
      AND b.reminder_minutes > 0
      AND TIMESTAMP(b.booking_date, b.booking_time)
            BETWEEN NOW() - INTERVAL ? MINUTE
                AND NOW() + INTERVAL b.reminder_minutes MINUTE
    ORDER BY b.booking_date, b.booking_time
    LIMIT 20`, GRACE_MINUTES);
}

async function stepNotes(bookingId) {
  const rows = await all(
    `SELECT question, note FROM booking_notes
     WHERE booking_id = ? ORDER BY created_at LIMIT 12`, bookingId);
  return rows.map((r) => (r.question ? `• ${r.question}: ${r.note}` : `• ${r.note}`)).join('\n');
}

export async function runOnce() {
  if (!await isEnabled()) return { sent: 0, skipped: 'telegram ปิดอยู่หรือยังไม่ได้ตั้งค่า' };
  const rows = await dueBookings();
  let sent = 0;
  for (const b of rows) {
    const minutes = Math.max(0, Number(b.mins_away));
    const payload = {
      ...b,
      service_label: SERVICE_LABEL[b.service_type] || b.service_type,
      step_notes: await stepNotes(b.id),
    };
    const res = await send(reminderMessage(payload, minutes),
      { kind: 'booking_reminder', booking_id: b.id });
    if (res.ok) {
      // mark only on success so a transient failure retries on the next tick
      await run('UPDATE bookings SET reminder_sent_at = NOW() WHERE id = ?', b.id);
      sent++;
    }
  }
  return { sent, checked: rows.length };
}

async function tick() {
  if (running) return;
  running = true;
  try {
    await runOnce();
  } catch (e) {
    console.error('[reminder]', e.message);
  } finally {
    running = false;
  }
}

export function start() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  tick();
  return TICK_MS;
}

export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}
