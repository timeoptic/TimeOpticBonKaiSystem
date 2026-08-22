// TimeOptic Web — data layer (MariaDB / MySQL via mysql2)
import mysql from 'mysql2/promise';

export const CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'timeoptic',
  charset: 'utf8mb4',
  // keep DATE/DATETIME as 'YYYY-MM-DD HH:mm:ss' strings — no timezone surprises
  dateStrings: true,
  // DECIMAL(12,2) as JS numbers so arithmetic works everywhere
  decimalNumbers: true,
  connectionLimit: 10,
  waitForConnections: true,
  multipleStatements: false,
};

export const pool = mysql.createPool(CONFIG);

/* ------------------------------------------------------------------ *
 * query helpers — same surface the rest of the app already uses
 * ------------------------------------------------------------------ */
export const all = async (sql, ...p) => (await pool.query(sql, p))[0];
export const get = async (sql, ...p) => (await pool.query(sql, p))[0][0] ?? null;
export const run = async (sql, ...p) => (await pool.query(sql, p))[0];

/**
 * Run fn inside a transaction. fn receives scoped {all,get,run} bound to the
 * transaction's connection — always use those, never the module-level ones.
 */
export async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const q = {
      all: async (sql, ...p) => (await conn.query(sql, p))[0],
      get: async (sql, ...p) => (await conn.query(sql, p))[0][0] ?? null,
      run: async (sql, ...p) => (await conn.query(sql, p))[0],
    };
    const out = await fn(q);
    await conn.commit();
    return out;
  } catch (err) {
    try { await conn.rollback(); } catch { /* connection already gone */ }
    throw err;
  } finally {
    conn.release();
  }
}

/* ------------------------------------------------------------------ *
 * date / code helpers
 * ------------------------------------------------------------------ */
const p2 = (n) => String(n).padStart(2, '0');

export function nowStamp(d = new Date()) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ` +
    `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}
export const today = () => nowStamp().slice(0, 10);

/** Invoice code in the shop's Access format: C + yyMMddHHmmss */
export function invoiceCode(d = new Date()) {
  return 'C' + p2(d.getFullYear() % 100) + p2(d.getMonth() + 1) + p2(d.getDate()) +
    p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
}

/** Next sequential code for a year-scoped series, e.g. CASE-2026-0008 */
export async function nextCode(prefix, table, column) {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const row = await get(
    `SELECT MAX(CAST(SUBSTRING_INDEX(\`${column}\`, '-', -1) AS UNSIGNED)) AS n
     FROM \`${table}\` WHERE \`${column}\` LIKE ?`, like);
  return `${prefix}-${year}-${String((row?.n || 0) + 1).padStart(4, '0')}`;
}

/* ------------------------------------------------------------------ *
 * lookup lists — the schema keeps them in list_* tables
 * ------------------------------------------------------------------ */
const LIST_TABLES = {
  sex: 'list_sex',
  marketing: 'list_marketing',
  pay_type: 'list_pay_type',
  product_type: 'list_product_type',
  len_type: 'list_len_type',
};

export async function lists() {
  const out = {};
  for (const [kind, table] of Object.entries(LIST_TABLES)) {
    const rows = await all(
      `SELECT code, label_th FROM \`${table}\` ORDER BY sort_order, code`);
    out[kind] = rows.map((r) => r.code);
    out[kind + '_labels'] = Object.fromEntries(rows.map((r) => [r.code, r.label_th]));
  }
  // free-text columns — offer whatever has actually been used before
  out.expense_type = (await all(
    `SELECT DISTINCT expense_type c FROM expenses
     WHERE expense_type IS NOT NULL AND expense_type <> '' ORDER BY c`)).map((r) => r.c);
  out.income_type = (await all(
    `SELECT DISTINCT income_type c FROM incomes
     WHERE income_type IS NOT NULL AND income_type <> '' ORDER BY c`)).map((r) => r.c);
  out.branch = [...new Set([
    ...(await all(`SELECT DISTINCT branch c FROM expenses WHERE branch <> '' ORDER BY c`)).map((r) => r.c),
    ...(await all(`SELECT DISTINCT branch c FROM incomes  WHERE branch <> '' ORDER BY c`)).map((r) => r.c),
  ])];
  if (!out.expense_type.length) {
    out.expense_type = ['เลนส์', 'ค่าขนส่ง', 'จิปาถะ', 'ตกแต่ง', 'สินค้าแว่น',
      'คอนแทคเลนส์', 'ซ่อมบำรุง', 'ค่าเช่า', 'ค่าทำบัญชี', 'Internet', 'โทรศัพท์', 'เงินเดือน'];
  }
  if (!out.income_type.length) out.income_type = ['ค่าเช่า', 'ประกันสังคม', 'อื่นๆ'];
  if (!out.branch.length) out.branch = ['Timeoptic', 'ส่วนตัว'];

  out.test_for = ['Distance', 'Reading', 'Progressive', 'Bi-focal'];
  out.payment_kind = ['deposit', 'partial', 'final', 'full'];
  out.lens_source = ['stock', 'order'];
  return out;
}

export const caseStatuses = () => all(
  `SELECT code, stage_no, label_th, label_en, stage_group, sort_order,
          is_waiting, is_terminal
   FROM case_statuses ORDER BY sort_order`);

/* ------------------------------------------------------------------ *
 * startup check — fail loudly with a useful message
 * ------------------------------------------------------------------ */
export async function verifyConnection() {
  const conn = await pool.getConnection();
  try {
    const [[v]] = await conn.query('SELECT VERSION() AS version, DATABASE() AS db');
    const [tables] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?`,
      [CONFIG.database]);
    return { ...v, tables: tables[0].n };
  } finally {
    conn.release();
  }
}
