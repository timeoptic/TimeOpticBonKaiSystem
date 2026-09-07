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

/* สีของหกขั้นไม่ใช่หกสีที่ไม่เกี่ยวกัน แต่เป็นการไล่จากฟ้าไปเขียวตามพาเลตต์แบรนด์
   (H 211 → 146 ที่ความสว่างเท่ากันทุกขั้น) เคสจึง "สุก" จากฟ้าเป็นเขียวขึ้นเรื่อย ๆ
   ตามที่มันเดินไปข้างหน้า — กวาดตาดูกระดานแล้วรู้ทันทีว่างานกองอยู่ช่วงต้นหรือท้าย
   ทุกค่าคอนทราสต์ ≥ 4.5:1 บนพื้นขาว จึงเอาไปเป็นสีตัวหนังสือได้ ไม่ใช่แค่จุดสี */
export const CASE_PROCESSES = [
  { id: 'reception', label: 'รับลูกค้า', color: '#1D7F8F', icon: 'bellDesk', completeLabel: 'เปิดเคสเรียบร้อย' },
  { id: 'exam', label: 'วัดสายตา', color: '#1D8184', icon: 'eye', completeLabel: 'ยืนยันผลวัดสายตา' },
  { id: 'sales', label: 'ขาย/เลือกกรอบ', color: '#1D8278', icon: 'bag', completeLabel: 'ยืนยันรายการขาย' },
  { id: 'payment', label: 'ชำระเงิน', color: '#1D846B', icon: 'card', completeLabel: 'ยืนยันการชำระเงิน' },
  { id: 'centering', label: 'วัด Center', color: '#1D8658', icon: 'target', completeLabel: 'ยืนยันค่า Center' },
  { id: 'delivery', label: 'ส่งมอบ', color: '#1D8832', icon: 'box', completeLabel: 'ส่งมอบเสร็จ — ปิดเคส' },
];

/** สถานะปิดเคส — ไม่ใช่ขั้นตอน แต่กระดานงานต้องมีคอลัมน์ให้เคสที่จบแล้วไปอยู่ */
export const DONE_STAGE = { id: 'done', label: 'จบงาน', color: '#64748B', icon: 'checkCircle' };

export const processInfo = (id) =>
  CASE_PROCESSES.find((p) => p.id === id)
  || (id === DONE_STAGE.id ? DONE_STAGE : null)
  || { id, label: id || '-', color: '#64748B', icon: 'circle' };

/** the 6 statuses a process can be in — icon and colour class for the stepper */
export const PROCESS_STATE_META = {
  not_started: { label: 'ยังไม่เริ่ม', icon: 'circle', cls: '' },
  in_progress: { label: 'กำลังดำเนินการ', icon: 'circleHalf', cls: 'warn' },
  completed: { label: 'เสร็จแล้ว', icon: 'check', cls: 'done' },
  waiting: { label: 'รอ', icon: 'hourglass', cls: 'warn' },
  problem: { label: 'มีปัญหา', icon: 'warning', cls: 'danger' },
  locked: { label: 'ยังทำไม่ได้', icon: 'lock', cls: 'locked' },
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
