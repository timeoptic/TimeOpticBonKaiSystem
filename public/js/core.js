/* TimeOptic Web — shared front-end helpers */
import { emojiToNodes } from './icons.js';

/* ---------------------------- API client -------------------------- */
async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}
const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== '' && v !== null && v !== undefined) p.set(k, v);
  }
  const s = p.toString();
  return s ? '?' + s : '';
};
export const api = {
  get: (path, query) => request('GET', path + qs(query)),
  post: (path, body) => request('POST', path, body || {}),
  put: (path, body) => request('PUT', path, body || {}),
  del: (path) => request('DELETE', path),
};

/* ------------------------- shared meta cache ---------------------- */
export const meta = {
  lists: {}, employees: [], statuses: [], suppliers: [], today: '', now: '',
};
export async function loadMeta() {
  Object.assign(meta, await api.get('/api/meta'));
  return meta;
}

/* --------------------------- DOM helpers -------------------------- */
export function el(tag, attrs = {}, children = []) {
  const parts = tag.split(/([.#])/);
  const node = document.createElement(parts[0] || 'div');
  for (let i = 1; i < parts.length; i += 2) {
    if (parts[i] === '.') node.classList.add(parts[i + 1]);
    else node.id = parts[i + 1];
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className += (node.className ? ' ' : '') + v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') setText(node, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'value') node.value = v;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    if (c instanceof Node) node.append(c);
    else node.append(...toNodes(String(c)));
  }
  return node;
}

/* อิโมจิที่รู้จักถูกเปลี่ยนเป็นไอคอน SVG ตรงนี้จุดเดียว ทุกหน้าจึงได้ไปพร้อมกัน
   โดยไม่ต้องแก้ที่เรียกใช้ทีละจุด (ดู public/js/icons.js) */
function toNodes(str) {
  const parts = emojiToNodes(str);
  if (!parts) return [document.createTextNode(str)];
  return parts.map((p) => (p instanceof Node ? p : document.createTextNode(p)));
}

function setText(node, value) {
  node.replaceChildren(...toNodes(String(value)));
}
export const frag = (children) => {
  const f = document.createDocumentFragment();
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    if (c instanceof Node) f.append(c);
    else f.append(...toNodes(String(c)));
  }
  return f;
};
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* --------------------------- formatting --------------------------- */
export const money = (n) =>
  '฿' + Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const moneyShort = (n) =>
  '฿' + Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 });
export const numFmt = (n, d = 2) => Number(n || 0).toFixed(d);
/**
 * Prescription values are VARCHAR in the schema — they may hold '-1.25', '+2.00',
 * 'plano', '' or null. Format numbers as signed 2dp; pass anything else through.
 */
export function power(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return (n > 0 ? '+' : '') + n.toFixed(2);
}
/** integer-ish prescription value (axis, pd) */
export const rxNum = (v) =>
  (v === null || v === undefined || v === '' ? '—' : String(v));

export function fmtDate(v) {
  if (!v) return '';
  const s = String(v).replace(' ', 'T');
  const d = new Date(s);
  if (isNaN(d)) return String(v);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
export function fmtDateTime(v) {
  if (!v) return '';
  const s = String(v).replace(' ', 'T');
  const d = new Date(s);
  if (isNaN(d)) return String(v);
  const p = (x) => String(x).padStart(2, '0');
  return `${fmtDate(v)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const dateOnly = (v) => (v ? String(v).slice(0, 10) : '');
/** value for <input type="datetime-local"> */
export const dtLocal = (v) => (v ? String(v).replace(' ', 'T').slice(0, 16) : '');
export const custName = (r) =>
  [r.first_name, r.last_name].filter(Boolean).join(' ') || '(ไม่มีชื่อ)';

/** current local time, formatted for <input type="datetime-local"> */
export function nowLocal() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------------------------- feedback ---------------------------- */
export function toast(message, kind = '') {
  const t = el('div.toast', { class: kind, text: message });
  $('#toasts').append(t);
  setTimeout(() => {
    t.style.transition = 'opacity .25s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 260);
  }, kind === 'err' ? 5200 : 2800);
}
export const ok = (m) => toast(m, 'ok');
export const err = (e) => toast(typeof e === 'string' ? e : (e.message || 'เกิดข้อผิดพลาด'), 'err');

export function confirmDialog(title, message, { confirmText = 'ยืนยัน', danger = false } = {}) {
  return new Promise((resolve) => {
    const close = (v) => { back.remove(); resolve(v); };
    const back = el('div.modal-back', {
      onclick: (e) => { if (e.target === back) close(false); },
    }, [
      el('div.modal', {}, [
        el('h3', { text: title }),
        el('div.m-body', {}, [el('p', { text: message, style: 'margin:0' })]),
        el('div.m-foot', {}, [
          el('button.btn.btn-light', { text: 'ยกเลิก', onclick: () => close(false) }),
          el('button.btn', {
            class: danger ? 'btn-danger' : 'btn-accent',
            text: confirmText, onclick: () => close(true),
          }),
        ]),
      ]),
    ]);
    $('#modal-root').append(back);
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', esc); close(false); }
    });
  });
}

/**
 * เพิ่มลูกค้าใหม่จากในกล่องเด้ง โดยไม่ต้องออกจากฟอร์มที่กรอกค้างอยู่
 * เดาให้ว่าคำที่พิมพ์ค้นหาเป็นเบอร์โทรหรือชื่อ แล้วเติมช่องให้เลย
 * @returns {Promise<object|null>} ลูกค้าที่สร้าง หรือ null เมื่อยกเลิก
 */
export function newCustomerDialog(term = '') {
  return new Promise((resolve) => {
    const t = String(term).trim();
    const looksLikePhone = /^[\d\s()+-]{6,}$/.test(t);
    const words = looksLikePhone ? [] : t.split(/\s+/).filter(Boolean);

    const first = el('input', { value: words[0] || '', placeholder: 'เช่น สมชาย' });
    const last = el('input', { value: words.slice(1).join(' '), placeholder: 'เช่น ใจกว้าง' });
    const phone = el('input', { type: 'tel', value: looksLikePhone ? t : '', placeholder: '08x-xxx-xxxx' });
    const msg = el('p.hint', { style: 'color:var(--danger);min-height:1em;margin:0' });
    const saveBtn = el('button.btn.btn-accent', { text: 'เพิ่มลูกค้า' });

    const close = (v) => { back.remove(); document.removeEventListener('keydown', esc); resolve(v); };
    function esc(e) { if (e.key === 'Escape') close(null); }

    const save = async () => {
      if (!first.value.trim() && !last.value.trim()) {
        msg.textContent = 'กรุณากรอกชื่อหรือนามสกุลอย่างน้อยหนึ่งช่อง';
        first.focus();
        return;
      }
      saveBtn.disabled = true;
      msg.textContent = '';
      try {
        close(await request('POST', '/api/customers', {
          first_name: first.value.trim(),
          last_name: last.value.trim(),
          phone: phone.value.trim(),
        }));
      } catch (e) {
        msg.textContent = e.message;
        saveBtn.disabled = false;
      }
    };
    saveBtn.addEventListener('click', save);
    for (const inp of [first, last, phone]) {
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    }

    const back = el('div.modal-back', {
      onclick: (e) => { if (e.target === back) close(null); },
    }, [
      el('div.modal', {}, [
        el('h3', { text: 'เพิ่มลูกค้าใหม่' }),
        el('div.m-body', {}, [
          el('div.form-grid', {}, [
            field('ชื่อ', first),
            field('นามสกุล', last),
            field('เบอร์โทร', phone),
          ]),
          el('p.hint', { text: 'กรอกเท่านี้ก่อนได้ ข้อมูลอื่นไปเพิ่มทีหลังที่หน้าลูกค้า' }),
          msg,
        ]),
        el('div.m-foot', {}, [
          el('button.btn.btn-light', { text: 'ยกเลิก', onclick: () => close(null) }),
          saveBtn,
        ]),
      ]),
    ]);
    $('#modal-root').append(back);
    document.addEventListener('keydown', esc);
    first.focus();
  });
}

/** ปุ่ม "เพิ่มลูกค้าใหม่" สำหรับส่งให้ picker ใช้ตอนค้นไม่เจอ */
export const addCustomerAction = (onAdded) => (term, choose) =>
  el('button.btn.btn-accent.btn-sm.p-empty-btn', {
    type: 'button', text: '+ เพิ่มลูกค้าใหม่',
    onclick: async () => {
      const c = await newCustomerDialog(term);
      if (!c) return;
      choose(c);
      if (onAdded) onAdded(c);
    },
  });

/* --------------------------- UI builders -------------------------- */
export function pageHead(icon, title, subtitle, actions = []) {
  return el('div.page-head', {}, [
    el('div.ph-icon.icon-only', { text: icon }),
    el('h1', {}, [title, subtitle ? el('span', { text: subtitle }) : null]),
    actions.length ? el('div.ph-actions', {}, actions) : null,
  ]);
}

export function card(title, bodyChildren, { right = [], tight = false, badge = null } = {}) {
  return el('div.card', {}, [
    title ? el('div.card-head', {}, [
      el('h2', { text: title }),
      badge,
      right.length ? el('div.right', {}, right) : null,
    ]) : null,
    el('div.card-body', { class: tight ? 'tight' : '' }, bodyChildren),
  ]);
}

/**
 * columns: [{ label, key?, render?(row), cls?, footer? }]
 */
export function table(columns, rows, { onRowClick = null, empty = 'ไม่มีข้อมูล', footer = null } = {}) {
  if (!rows || !rows.length) return el('div.empty', { text: empty });
  const body = el('tbody', {}, rows.map((row, i) => {
    const tr = el('tr', { class: onRowClick ? 'clickable' : '' },
      columns.map((c) => {
        const v = c.render ? c.render(row, i) : row[c.key];
        return el('td', { class: c.cls || '' }, [v instanceof Node ? v : (v ?? '')]);
      }));
    if (onRowClick) {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('a,button,input,select')) return;
        onRowClick(row);
      });
    }
    return tr;
  }));
  return el('div.table-wrap', {}, [
    el('table.grid', {}, [
      el('thead', {}, [el('tr', {}, columns.map((c) =>
        el('th', { class: c.cls || '', text: c.label })))]),
      body,
      footer ? el('tfoot', {}, [footer]) : null,
    ]),
  ]);
}

export function field(label, control, hint) {
  return el('div.field', {}, [
    el('label', { text: label }),
    control,
    hint ? el('div.hint', { text: hint }) : null,
  ]);
}

export function input(name, opts = {}) {
  return el('input', { name, ...opts });
}

export function select(name, options, value, opts = {}) {
  const s = el('select', { name, ...opts });
  for (const o of options) {
    const [val, label] = Array.isArray(o) ? o : [o, o];
    s.append(el('option', { value: val, text: label, selected: String(val) === String(value ?? '') }));
  }
  if (value !== undefined && value !== null) s.value = String(value);
  return s;
}

export const employeeSelect = (name, value, { blank = '— เลือกพนักงาน —' } = {}) =>
  select(name, [['', blank], ...meta.employees.map((e) => [e.id, e.employee_name])], value ?? '');

export const listSelect = (name, kind, value, { blank = null } = {}) =>
  select(name, [...(blank ? [['', blank]] : []), ...(meta.lists[kind] || [])], value ?? '');

/** read a <form> into a plain object */
export function formData(form) {
  const out = {};
  for (const elm of form.elements) {
    if (!elm.name || elm.disabled) continue;
    out[elm.name] = elm.type === 'checkbox' ? (elm.checked ? 1 : 0) : elm.value;
  }
  return out;
}

export const loading = (text = 'กำลังโหลด…') =>
  el('div.loading', {}, [el('span.spin'), ' ' + text]);

export const statusBadge = (o) => {
  if (o.order_closed) return el('span.badge.ok', { text: 'ปิดการขายแล้ว' });
  const unfilled = !o.lens_product_id || !o.right_lens_product_id || !o.frame_product_id;
  return unfilled
    ? el('span.badge.warn', { text: 'รอของ / ยังไม่เติม' })
    : el('span.badge.blue', { text: 'รอลูกค้ารับ' });
};

/* ------------------------- case workflow helpers ------------------ */
export const STAGE_META = {
  reception: { label: 'รับลูกค้า', color: '#7a5cc4', icon: '🛎' },
  exam: { label: 'วัดสายตา', color: '#2f6fd0', icon: '👁' },
  sales: { label: 'ขาย/เลือกกรอบ', color: '#0f8f8f', icon: '🛍' },
  production: { label: 'ผลิต/เลนส์', color: '#c07000', icon: '🔧' },
  qc: { label: 'ตรวจ QC', color: '#b32020', icon: '🔍' },
  delivery: { label: 'ส่งมอบ', color: '#127a4a', icon: '📦' },
  done: { label: 'จบงาน', color: '#6b7a90', icon: '✅' },
};
export const stageInfo = (g) =>
  STAGE_META[g] || { label: g || '-', color: '#6b7a90', icon: '•' };

export function statusChip(row) {
  const s = stageInfo(row.stage_group);
  return el('span.badge', {
    style: `background:${s.color}1a;color:${s.color}`,
    text: `${row.stage_no || ''} ${row.status_label_th || row.status}`.trim(),
  });
}

/** ป้ายของรายการที่เก็บเป็นคู่ [รหัส, ป้าย] เช่น rx_source / old_glasses_type
    ไม่รู้จักรหัสไหนก็คืนรหัสดิบ ดีกว่าโชว์ว่างจนดูเหมือนไม่เคยกรอก */
export const listLabel = (kind, code) => {
  if (!code) return '';
  const hit = ((meta.lists || {})[kind] || [])
    .find((o) => Array.isArray(o) && String(o[0]) === String(code));
  return hit ? hit[1] : String(code);
};

/** ชนิดเลนส์ที่สั่งตัดไว้ -> ชนิดแว่นที่ลูกค้าใส่อยู่
    เลนส์ออฟฟิศกับ "อื่น ๆ" เทียบไม่ได้ตรง ๆ คืน '' ให้คนกรอกเลือกเอง */
export const glassesTypeOfLens = (lensType) => ({
  SVDistance: 'single',
  SVReading: 'single',
  Bifocal: 'bifocal',
  Progressive: 'progressive',
}[lensType] || '');

export const caseStatuses = () => meta.statuses || [];
export const statusByCode = (code) =>
  (meta.statuses || []).find((s) => s.code === code) || null;

export const linkBtn = (href, text, cls = 'btn-light') =>
  el('a.btn.btn-sm', { class: cls, href, text });

/* ----------------------- search-picker widget --------------------- */
/**
 * Renders a search box + result list. onPick(row) fires on click.
 * fetcher(term) -> Promise<rows>;  label(row) -> string
 */
/**
 * ช่องค้นหา + รายการให้เลือก
 * @param emptyAction (term, pick) => Node|null — สิ่งที่จะโชว์แทนเมื่อค้นไม่เจอ
 *        เรียก pick(row) เพื่อเลือกรายการที่เพิ่งสร้างเข้ามาเลย
 */
export function picker({ placeholder, fetcher, label, sub, onPick, autoLoad = true, emptyAction = null }) {
  const box = el('div.stack');
  const search = el('input', { type: 'search', placeholder, autocomplete: 'off' });
  const list = el('div.picker');
  let timer = null, selected = null;

  async function refresh(term) {
    list.replaceChildren(el('div.p-row', {}, [el('span.spin'), ' กำลังค้นหา…']));
    try {
      const rows = await fetcher(term || '');
      if (!rows.length) {
        const t = String(term || '').trim();
        const choose = (r) => { selected = r; onPick(r); };
        list.replaceChildren(el('div.p-empty', {}, [
          el('div.p-empty-msg', { text: t ? `ไม่พบรายการที่ตรงกับ “${t}”` : 'ไม่พบข้อมูล' }),
          emptyAction ? emptyAction(t, choose) : null,
        ].filter(Boolean)));
        return;
      }
      list.replaceChildren(...rows.map((r) => {
        const row = el('div.p-row', {
          onclick: () => {
            selected = r;
            [...list.children].forEach((c) => c.classList.remove('sel'));
            row.classList.add('sel');
            onPick(r);
          },
        }, [
          el('span.p-main', {}, [
            el('b', { text: label(r) }),
            sub ? el('span.muted', { text: '  ' + sub(r) }) : null,
          ]),
          el('span.p-id', { text: '#' + r.id }),
        ]);
        return row;
      }));
    } catch (e) {
      list.replaceChildren(el('div.p-row', { text: e.message }));
    }
  }
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => refresh(search.value), 220);
  });
  box.append(search, list);
  if (autoLoad) refresh('');
  return { node: box, refresh, get selected() { return selected; }, search };
}
