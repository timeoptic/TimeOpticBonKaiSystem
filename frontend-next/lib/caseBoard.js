/**
 * ตรรกะของกระดานงาน — ตัวกรองกับคอลัมน์ ไม่มี JSX
 *
 * แยกออกมาเป็น .js ด้วยเหตุผลเดียวกับ lib/pager.js: `node --test` เรียกได้ตรง ๆ
 * · ที่นี่สำคัญกว่าด้วยซ้ำ เพราะบั๊กที่พาหน้านี้มาถึงการรื้อคือ "กดชิปสามอันแล้ว
 * กระดานว่างเปล่าโดยไม่มีอะไรบอกว่าเพราะอะไร" ซึ่งเป็นบั๊กของตรรกะล้วน ๆ
 * มองไม่เห็นจากการอ่าน JSX และไม่มีอะไรกันไม่ให้มันกลับมา
 *
 * ส่วนที่เป็นหน้าตาอยู่ใน app/(frontdesk)/cases/page.jsx
 */
import { STAGE_GROUPS } from './constants.js';
import { DONE_STAGE } from './caseProcesses.js';

/** กี่ใบต่อคอลัมน์ต่อการโหลดหนึ่งครั้ง — ทั้งชุดแรกและทุกครั้งที่กด "โหลดเพิ่ม" */
export const CARD_PAGE = 20;

/**
 * ตัวกรองเคส — เลือกได้ทีละอัน กดอันใหม่แทนอันเดิม
 *
 * เดิมสามอันแรกเป็นชิปกดสะสมได้ ซึ่งอ่านไม่ออกว่ากำลังดูอะไรอยู่ และพาไปเจอชุด
 * ที่ไม่มีเคสไหนเข้าเงื่อนไขได้ง่ายมาก ("จบแล้ว + ด่วน + ค้างชำระ")
 *
 * "เคสที่จบแล้ว" อยู่กลุ่มนี้เพราะมันคือการเลือกว่าจะดูกองไหน ไม่ใช่การตั้งค่าหน้าจอ
 */
export const CASE_FILTERS = [
  ['', 'ทั้งหมด', null],
  ['rush', 'ด่วนเท่านั้น', 'flame'],
  ['unpaid', 'ค้างชำระ', 'coins'],
  ['done', 'เคสที่จบแล้ว', 'checkCircle'],
];

/**
 * ช่วงวันที่กรองด้วยวันไหนของเคส — คีย์ชุดเดียวกับ `date_field` ใน api/routes/cases.php
 *
 * "วันปิดเคส" มีความหมายเฉพาะกองเคสที่จบแล้ว เคสที่ยังทำอยู่ไม่มีวันปิดให้เทียบ
 * เลือกไว้ก็ได้กระดานว่างทุกครั้ง จึงไม่ยื่นให้เลือกนอกกองนั้น (ดู dateFieldOptions)
 */
export const DATE_FIELDS = [
  ['opened', 'วันเปิดเคส'],
  ['appointment', 'วันนัดรับ'],
  ['closed', 'วันปิดเคส'],
];

export function dateFieldOptions({ caseFilter = '' }) {
  return caseFilter === 'done' ? DATE_FIELDS : DATE_FIELDS.filter(([k]) => k !== 'closed');
}

/**
 * ตัวกรองชุดเดียวที่ทั้ง "จำนวนเคส" และ "รายการที่แสดง" ใช้ร่วมกัน
 *
 * เลขบนหัวคอลัมน์กับการ์ดในคอลัมน์นั้นต้องมาจากคำถามเดียวกันเสมอ — ถ้าสร้าง
 * เงื่อนไขแยกกันสองที่ วันหนึ่งจะได้ "แสดง 20 จาก 918" ในคอลัมน์ที่มีจริง 12 ใบ
 *
 * ค่าว่างถูก apiClient ตัดทิ้งตอนต่อ query string อยู่แล้ว จึงส่ง '' ได้ตามสบาย
 */
export function boardQuery({
  q = '', client = '', stage = '', caseFilter = '', dateField = 'opened', from = '', to = '',
}) {
  const showDone = caseFilter === 'done';
  /* ช่วงหัวกลับหาง (แก้ URL เอง) สลับให้ แทนที่จะคืนกระดานว่างที่ไม่บอกว่าเพราะอะไร */
  const [lo, hi] = from && to && to < from ? [to, from] : [from, to];
  const field = dateFieldOptions({ caseFilter }).some(([k]) => k === dateField) ? dateField : 'opened';
  return {
    paged: 1,
    q: q.trim(),
    client,
    /* เคสที่จบแล้วอยู่กองเดียว ไม่มีขั้นให้กรอง */
    stage: showDone ? '' : stage,
    rush: caseFilter === 'rush' ? 1 : '',
    unpaid: caseFilter === 'unpaid' ? 1 : '',
    closed: showDone ? 1 : '',
    date_field: lo || hi ? field : '',
    from: lo,
    to: hi,
  };
}

/**
 * คอลัมน์ไหนโผล่บนกระดาน และรวมแล้วกี่เคส
 *
 * `byStage` มาจาก API (นับจากของจริงทั้งกอง ไม่ใช่จากแถวที่โหลดมา)
 *
 * ความต่างที่ต้องไม่หายไปไหน: `stages` คือคอลัมน์ที่กระดานนี้*พูดถึง* ส่วน
 * `columns` คือคอลัมน์ที่*วาดจริง* หลัง "ซ่อนขั้นที่ว่าง" ตัดออก · `total` นับจาก
 * `stages` เสมอ เพราะ "ซ่อนขั้นที่ว่าง" ซ่อนคอลัมน์ ไม่ได้กรองเคสออกจากกระดาน
 * — ถ้านับจาก `columns` ยอดจะยังเท่ากัน (คอลัมน์ที่ถูกซ่อนมีศูนย์ใบ) แต่ความ
 * บังเอิญนั้นเป็นของที่พังเงียบ ๆ ได้ในวันที่เกณฑ์การซ่อนเปลี่ยน
 */
export function boardColumns({ byStage = {}, stage = '', caseFilter = '', hideEmpty = true }) {
  const showDone = caseFilter === 'done';
  const stages = showDone
    ? [DONE_STAGE.id]
    : (stage ? [stage] : STAGE_GROUPS);

  return {
    stages,
    columns: stages.filter((g) => !hideEmpty || (byStage[g] || 0) > 0),
    total: stages.reduce((n, g) => n + (byStage[g] || 0), 0),
  };
}

/**
 * ขั้นตอนที่เลือกได้ในช่องเลือก
 *
 * ต้องตรงกับคอลัมน์ที่กระดานใช้จริง — เคสที่จบแล้วอยู่ขั้น "จบงาน" ที่เดียว
 *
 * เผื่อขั้นที่มาจาก URL ไว้ด้วย: เคสที่เดินครบทุกขั้นแล้วแต่สถานะยังไม่ปิด นับเป็น
 * ขั้น "จบงาน" ในการ์ดหน้าเมนูหลัก ซึ่งไม่อยู่ใน STAGE_GROUPS · ถ้าไม่เผื่อไว้
 * กระดานจะกรองถูกแต่ช่องเลือกโชว์ค่าว่าง อ่านเหมือนตัวกรองไม่ทำงาน
 */
export function stageOptions({ stage = '', caseFilter = '' }) {
  const base = caseFilter === 'done' ? [DONE_STAGE.id] : STAGE_GROUPS;
  return stage && !base.includes(stage) ? [...base, stage] : base;
}
