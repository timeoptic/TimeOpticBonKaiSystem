/**
 * The 6 processes a case goes through — the single place their id, label,
 * colour and "ยืนยันเสร็จ" wording live. `lib/constants.js` builds STAGE_META /
 * STAGE_GROUPS from this list, so the board, the stepper and the sidebar all
 * read the same names.
 *
 * The ids match `case_statuses.stage_group` and the `process` column of
 * `case_processes` (api/routes/processes.php) — one vocabulary, front to back.
 *
 * The workflow is deliberately NON-LINEAR: this array is display order only.
 * Nothing here says a process must wait for the one before it; what a process
 * needs is decided by its own requirements, server-side.
 *
 * ส่งมอบเป็นขั้นสุดท้ายจริง ๆ — ยืนยันแล้วเคสปิด ไม่มีขั้น "จบงาน" ให้กดซ้ำ
 */

export const CASE_PROCESSES = [
  { id: 'reception', label: 'รับลูกค้า', color: '#7a5cc4', icon: '🛎', completeLabel: 'เปิดเคสเรียบร้อย' },
  { id: 'exam', label: 'วัดสายตา', color: '#2f6fd0', icon: '👁', completeLabel: 'ยืนยันผลวัดสายตา' },
  { id: 'sales', label: 'ขาย/เลือกกรอบ', color: '#0f8f8f', icon: '🛍', completeLabel: 'ยืนยันรายการขาย' },
  { id: 'payment', label: 'ชำระเงิน', color: '#0a7a3d', icon: '💳', completeLabel: 'ยืนยันการชำระเงิน' },
  { id: 'centering', label: 'วัด Center', color: '#8a6d00', icon: '🎯', completeLabel: 'ยืนยันค่า Center' },
  { id: 'delivery', label: 'ส่งมอบ', color: '#127a4a', icon: '📦', completeLabel: 'ส่งมอบเสร็จ — ปิดเคส' },
];

/** สถานะปิดเคส — ไม่ใช่ขั้นตอน แต่กระดานงานต้องมีคอลัมน์ให้เคสที่จบแล้วไปอยู่ */
export const DONE_STAGE = { id: 'done', label: 'จบงาน', color: '#6b7a90', icon: '✅' };

export const processInfo = (id) =>
  CASE_PROCESSES.find((p) => p.id === id)
  || (id === DONE_STAGE.id ? DONE_STAGE : null)
  || { id, label: id || '-', color: '#6b7a90', icon: '•' };

/** the 6 statuses a process can be in — icon and colour class for the stepper */
export const PROCESS_STATE_META = {
  not_started: { label: 'ยังไม่เริ่ม', icon: '○', cls: '' },
  in_progress: { label: 'กำลังดำเนินการ', icon: '●', cls: 'warn' },
  completed: { label: 'เสร็จแล้ว', icon: '✓', cls: 'done' },
  waiting: { label: 'รอ', icon: '⏳', cls: 'warn' },
  problem: { label: 'มีปัญหา', icon: '⚠', cls: 'danger' },
  locked: { label: 'ยังทำไม่ได้', icon: '🔒', cls: 'locked' },
};

export const stateMeta = (status) => PROCESS_STATE_META[status] || PROCESS_STATE_META.not_started;

/**
 * case_process events carry the process id in their note ("exam", or
 * "exam — เหตุผล"). Show it in the same Thai the stepper uses.
 */
export function eventNote(ev) {
  const note = ev?.note || '';
  if (ev?.entity !== 'case_process' || !note) return note;
  const [id, ...rest] = note.split(' — ');
  const label = CASE_PROCESSES.some((p) => p.id === id) ? processInfo(id).label : id;
  return [label, ...rest].join(' — ');
}

/** money side of the payment process — a separate axis from its process status */
export function paymentStatusOf(c) {
  const paid = Number(c.paid) || 0;
  if (!c.order) return { code: 'unpaid', label: 'ยังไม่มียอด', kind: 'gray' };
  if (paid <= 0) return { code: 'unpaid', label: 'ยังไม่ชำระ', kind: 'gray' };
  return Number(c.balance) > 0
    ? { code: 'partial', label: 'ชำระบางส่วน', kind: 'warn' }
    : { code: 'paid', label: 'ชำระครบแล้ว', kind: 'ok' };
}
