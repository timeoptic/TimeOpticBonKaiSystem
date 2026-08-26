/* Case board, case detail (full workflow) and lens tracker */
import {
  api, meta, el, frag, card, table, pageHead, field, input, select, listSelect,
  employeeSelect, formData, money, moneyShort, fmtDate, fmtDateTime, dateOnly, dtLocal,
  nowLocal, custName, power, rxNum, ok, err, confirmDialog, picker, todayISO,
  stageInfo, statusChip, listLabel, glassesTypeOfLens,
  addCustomerAction,
} from '../core.js';
import { rxFormFields } from './core-views.js';

const GROUPS = ['reception', 'exam', 'sales', 'production', 'qc', 'delivery'];

/* ข้อมูลเก่าเก็บเป็นรหัส ถ้าวันหลังลบตัวเลือกออกจากรายการ ให้โชว์รหัสดิบไว้ก่อน
   ดีกว่าโชว์ค่าว่างจนดูเหมือนไม่เคยกรอก */
const referralLabel = (code) =>
  ((meta.referral_sources || []).find(([c]) => c === code) || [null, code])[1];

/* ข้อมูลที่เลือกให้แสดงได้บนการ์ดและในตาราง
   รหัสเคส ชื่อลูกค้า และขั้นตอน ไม่อยู่ในนี้เพราะขาดไม่ได้ */
const CASE_FIELDS = [
  ['invoice', 'เลข Invoice'],
  ['phone', 'เบอร์โทร'],
  ['status', 'สถานะย่อย'],
  ['item', 'เลนส์ / กรอบ'],
  ['received', 'ผู้รับเรื่อง'],
  ['opened', 'วันเปิดเคส'],
  ['age', 'อายุเคส'],
  ['appt', 'วันนัดรับ'],
  ['total', 'ยอดรวม'],
  ['paid', 'รับแล้ว'],
  ['balance', 'ยอดคงค้าง'],
  ['tags', 'ป้ายด่วน / รอของ'],
];
const FIELDS_KEY = 'timeoptic:case-fields';
const DEFAULT_FIELDS = ['invoice', 'phone', 'status', 'item', 'age', 'appt', 'balance', 'tags'];

function loadFields() {
  try {
    const raw = JSON.parse(localStorage.getItem(FIELDS_KEY));
    if (Array.isArray(raw)) return new Set(raw);
  } catch { /* อ่านไม่ได้ก็ใช้ค่าเริ่มต้น */ }
  return new Set(DEFAULT_FIELDS);
}
const saveFields = (set) => {
  try { localStorage.setItem(FIELDS_KEY, JSON.stringify([...set])); } catch { /* ไม่ใช่เรื่องคอขาดบาดตาย */ }
};

/* ============================== BOARD ============================== */
export async function caseBoard({ navigate, query }) {
  const wrap = el('div');
  wrap.append(pageHead('🗂', 'Case Board', 'กระดานงานในร้าน', [
    el('a.btn.btn-ghost', { href: '#/cases/new', text: '+ เปิดเคสใหม่' }),
    el('a.btn.btn-ghost', { href: '#/lens-tracker', text: '🔎 ติดตามเลนส์' }),
  ]));

  const search = el('input', { type: 'search', placeholder: 'ค้นหา เคส / ลูกค้า / เบอร์ / Invoice', value: query.q || '' });
  const rushOnly = el('input', { type: 'checkbox' });
  const showDone = el('input', { type: 'checkbox' });
  const holder = el('div');
  const chipBar = el('div.stage-filter');
  let timer = null;
  let stage = GROUPS.includes(query.stage) ? query.stage : '';
  let view = query.view === 'list' ? 'list' : 'board';
  const fields = loadFields();

  /* ---- เลือกเองว่าจะให้แสดงข้อมูลอะไรบ้าง ---- */
  const fieldMenu = el('div.field-menu', {}, [
    el('div.fm-head', {}, [
      el('b', { text: 'ข้อมูลที่แสดง' }),
      el('button.btn.btn-sm.btn-light', {
        type: 'button', text: 'ทั้งหมด',
        onclick: () => { CASE_FIELDS.forEach(([k]) => fields.add(k)); syncFieldMenu(); },
      }),
      el('button.btn.btn-sm.btn-light', {
        type: 'button', text: 'ล้าง',
        onclick: () => { fields.clear(); syncFieldMenu(); },
      }),
    ]),
    ...CASE_FIELDS.map(([key, label]) => el('label.check.fm-row', {}, [
      el('input', {
        type: 'checkbox', dataset: { f: key },
        onchange: (e) => {
          if (e.target.checked) fields.add(key); else fields.delete(key);
          saveFields(fields); run();
        },
      }),
      ' ' + label,
    ])),
  ]);
  function syncFieldMenu() {
    for (const box of fieldMenu.querySelectorAll('input[type=checkbox]')) {
      box.checked = fields.has(box.dataset.f);
    }
    saveFields(fields); run();
  }
  const fieldBtn = el('button.btn.btn-light', {
    type: 'button', text: '⚙ ข้อมูลที่แสดง',
    onclick: (e) => {
      e.stopPropagation();
      fieldMenu.classList.toggle('open');
    },
  });
  // แตะที่อื่นแล้วปิดเมนู ไม่งั้นบนแท็บเล็ตมันค้างบังของอื่น
  document.addEventListener('click', (e) => {
    if (!fieldMenu.contains(e.target)) fieldMenu.classList.remove('open');
  });

  /* ---- ปุ่มสลับมุมมอง ---- */
  const viewBtn = (v, label) => el('button.cal-vbtn', {
    type: 'button', class: view === v ? 'active' : '', text: label,
    onclick: () => { view = v; syncViewBtns(); run(); },
  });
  const boardBtn = viewBtn('board', 'กระดาน');
  const listBtn = viewBtn('list', 'รายการ');
  const syncViewBtns = () => {
    boardBtn.classList.toggle('active', view === 'board');
    listBtn.classList.toggle('active', view === 'list');
  };

  /* ---- แถบกรองตามขั้นตอน ---- */
  function drawChips(counts, total) {
    const chip = (g, label, icon, n) => el('button.stage-chip', {
      type: 'button',
      class: (stage === g ? 'active' : '') + (n ? '' : ' empty'),
      style: g ? `--stage:${stageInfo(g).color}` : '--stage:var(--ink-soft)',
      onclick: () => { stage = stage === g ? '' : g; run(); },
    }, [
      icon ? el('span.sc-ic', { text: icon }) : null,
      el('span', { text: label }),
      el('span.sc-n', { text: String(n) }),
    ]);
    chipBar.replaceChildren(
      chip('', 'ทั้งหมด', null, total),
      ...(showDone.checked ? [...GROUPS, 'done'] : GROUPS)
        .map((g) => chip(g, stageInfo(g).label, stageInfo(g).icon, counts[g] || 0)),
    );
  }

  async function run() {
    holder.replaceChildren(el('div.loading', {}, [el('span.spin'), ' กำลังโหลด…']));
    const rows = await api.get('/api/cases', {
      q: search.value.trim(),
      rush: rushOnly.checked ? 1 : '',
      open: showDone.checked ? 0 : '',
      limit: 500,
    });
    const byGroup = {};
    for (const r of rows) (byGroup[r.stage_group] ||= []).push(r);
    drawChips(Object.fromEntries(Object.entries(byGroup).map(([k, v]) => [k, v.length])), rows.length);

    const shown = stage ? rows.filter((r) => r.stage_group === stage) : rows;
    holder.replaceChildren(view === 'list'
      ? listView(shown, navigate, fields)
      : boardView(byGroup, showDone.checked, stage, navigate, run, fields));
  }

  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
  rushOnly.addEventListener('change', run);
  showDone.addEventListener('change', run);

  wrap.append(el('div.toolbar', {}, [
    el('div.field.grow', {}, [el('label', { text: 'ค้นหา' }), search]),
    el('label.check', {}, [rushOnly, ' ด่วนเท่านั้น 🔥']),
    el('label.check', {}, [showDone, ' แสดงเคสที่จบแล้ว']),
    el('div.cal-views', {}, [boardBtn, listBtn]),
    el('div.field-menu-wrap', {}, [fieldBtn, fieldMenu]),
    el('button.btn.btn-light', { text: '↻ รีเฟรช', onclick: run }),
  ]));
  syncFieldMenu();
  wrap.append(chipBar, holder);
  run();
  return wrap;
}

/* มุมมองกระดาน — กรองขั้นแล้วเหลือคอลัมน์เดียว */
function boardView(byGroup, withDone, stage, navigate, onMoved, fields) {
  const groups = (withDone ? [...GROUPS, 'done'] : GROUPS).filter((g) => !stage || g === stage);
  const cols = groups.map((g) => {
    const info = stageInfo(g);
    const list = byGroup[g] || [];
    // สีของขั้นตอนส่งต่อเป็นตัวแปร CSS ให้ทั้งหัวคอลัมน์และการ์ดใช้ชุดเดียวกัน
    const due = list.reduce((a, c) => a + (Number(c.balance) || 0), 0);
    return el('div.board-col', { style: `--stage:${info.color}`, dataset: { group: g } }, [
      el('div.board-head', {}, [
        el('span.bh-ic', { text: info.icon }),
        el('span.bh-name', { text: info.label }),
        el('span.bh-count', { text: String(list.length) }),
      ]),
      el('div.board-body', {}, list.length
        ? list.map((c) => caseCard(c, navigate, fields))
        : [el('div.board-empty', { text: 'ไม่มีเคสในขั้นนี้' })]),
      due > 0 ? el('div.board-foot', { text: 'ยอดค้างรวม ' + moneyShort(due) }) : null,
    ]);
  });
  const board = el('div.board', { class: cols.length === 1 ? 'board-single' : '' }, cols);
  enableCardDrag(board, onMoved);
  return board;
}

/* มุมมองรายการ — เต็มความกว้าง ข้อมูลครบทุกช่อง ไม่ตัดคำ */
function listView(rows, navigate, fields = new Set(DEFAULT_FIELDS)) {
  const on = (k) => fields.has(k);
  const due = rows.reduce((a, c) => a + (Number(c.balance) || 0), 0);
  const money0 = (v) => money(Number(v) || 0);

  /* คอลัมน์สร้างตามที่เลือกไว้ สามอันแรกขาดไม่ได้จึงอยู่นอกเงื่อนไข */
  const cols = [
    {
      label: 'เคส',
      render: (c) => el('div.lv-code', {}, [
        el('b', { text: c.case_code }),
        on('invoice') && c.invoice_code ? el('span.muted', { text: c.invoice_code }) : null,
      ]),
      cls: 'nowrap',
    },
    {
      label: 'ลูกค้า',
      render: (c) => el('div', {}, [
        el('b', { text: [c.first_name, c.last_name].filter(Boolean).join(' ') || '(ไม่ระบุชื่อ)' }),
        on('phone') && c.phone
          ? el('div.muted', { style: 'font-size:12px', text: '☎ ' + c.phone }) : null,
      ]),
    },
    {
      label: 'ขั้นตอน',
      render: (c) => {
        const st = stageInfo(c.stage_group);
        return el('span.badge', { style: `background:${st.color}1a;color:${st.color}`, text: st.label });
      },
      cls: 'nowrap',
    },
  ];
  const opt = {
    status: { label: 'สถานะ', render: (c) => `${c.stage_no} ${c.status_label_th}` },
    item: {
      label: 'เลนส์ / กรอบ',
      render: (c) => el('div', {}, [
        c.lens_name ? el('div', { text: c.lens_name }) : null,
        c.frame_name ? el('div.muted', { style: 'font-size:12px', text: c.frame_name }) : null,
        !c.lens_name && !c.frame_name ? el('span.muted', { text: '—' }) : null,
      ]),
    },
    received: { label: 'ผู้รับเรื่อง', render: (c) => c.received_by_name || '—', cls: 'nowrap' },
    opened: { label: 'เปิดเมื่อ', render: (c) => fmtDate(c.opened_at), cls: 'nowrap' },
    age: {
      label: 'อายุเคส',
      render: (c) => el('span.cc-age', {
        class: ageClass(c.age_days),
        text: c.age_days === 0 ? 'วันนี้' : `${c.age_days} วัน`,
      }),
      cls: 'nowrap',
    },
    appt: { label: 'นัดรับ', render: (c) => fmtDate(c.appointment_date) || '—', cls: 'nowrap' },
    total: { label: 'ยอดรวม', render: (c) => money0(c.total_price), cls: 'num' },
    paid: { label: 'รับแล้ว', render: (c) => money0(c.paid), cls: 'num' },
    balance: {
      label: 'คงค้าง',
      render: (c) => (Number(c.balance) > 0
        ? el('b', { style: 'color:var(--warn)', text: money0(c.balance) })
        : el('span.muted', { text: '—' })),
      cls: 'num',
    },
    tags: {
      label: 'ป้าย',
      render: (c) => el('div.row', { style: 'gap:4px' }, [
        c.is_rush ? el('span.cc-rush', { text: '🔥 ด่วน' }) : null,
        c.is_waiting ? el('span.badge.warn', { text: 'รอของ' }) : null,
      ]),
      cls: 'nowrap',
    },
  };
  for (const [key] of CASE_FIELDS) if (opt[key] && on(key)) cols.push(opt[key]);

  const balCol = cols.findIndex((x) => x.label === 'คงค้าง');
  return card(`รายการเคส ${rows.length} รายการ`, [
    table(cols, rows, {
      empty: 'ไม่มีเคสที่ตรงกับเงื่อนไข',
      onRowClick: (c) => navigate('#/cases/' + c.id),
      footer: rows.length && balCol >= 0
        ? el('tr', {}, [
          el('td', { colspan: balCol, text: `รวม ${rows.length} เคส` }),
          el('td.num', { text: money0(due) }),
          ...cols.slice(balCol + 1).map(() => el('td')),
        ])
        : null,
    }),
  ], { tight: true });
}

/* เคสค้างยิ่งนานยิ่งต้องสะดุดตา ไม่ใช่ตัวเทาเท่ากันหมด */
function ageClass(days) {
  if (days >= 14) return 'age-bad';
  if (days >= 7) return 'age-warn';
  return '';
}

function caseCard(c, navigate, fields = new Set(DEFAULT_FIELDS)) {
  const on = (k) => fields.has(k);
  const late = c.expected_arrival && new Date(c.expected_arrival) < new Date()
    && c.lens_status === 'waiting_arrival';
  const item = [c.lens_name, c.frame_name].filter(Boolean).join(' / ');
  const balance = Number(c.balance) || 0;

  return el('div.case-card', {
    class: c.is_rush ? 'rush' : '',
    dataset: { id: c.id },
    onclick: () => navigate('#/cases/' + c.id),
  }, [
    el('div.cc-top', {}, [
      el('b.cc-name', { text: [c.first_name, c.last_name].filter(Boolean).join(' ') }),
      c.is_rush ? el('span.cc-rush', { text: '🔥 ด่วน' }) : null,
    ]),
    el('div.cc-code', {
      text: c.case_code + (on('invoice') && c.invoice_code ? ' · ' + c.invoice_code : ''),
    }),
    on('status') ? el('div.cc-status', {}, [
      el('i.cc-dot'),
      el('span', { text: `${c.stage_no} ${c.status_label_th}` }),
    ]) : null,
    on('phone') && c.phone ? el('div.cc-item', { text: '☎ ' + c.phone }) : null,
    on('item') && item ? el('div.cc-item', { title: item, text: item }) : null,
    on('received') && c.received_by_name
      ? el('div.cc-item', { text: '🧑‍💼 ' + c.received_by_name }) : null,
    el('div.cc-foot', {}, [
      on('opened') ? el('span.cc-date', { text: 'เปิด ' + fmtDate(c.opened_at) }) : null,
      on('appt') && c.appointment_date
        ? el('span.cc-date', { text: '📅 ' + fmtDate(c.appointment_date) }) : null,
    ]),
    el('div.cc-foot', {}, [
      on('total') ? el('span', { text: 'รวม ' + moneyShort(c.total_price) }) : null,
      on('paid') ? el('span', { text: 'รับ ' + moneyShort(c.paid) }) : null,
      on('balance') && balance > 0
        ? el('span.cc-bal', { text: 'ค้าง ' + moneyShort(balance) }) : null,
    ]),
    el('div.cc-tags', {}, [
      on('age') ? el('span.cc-age', {
        class: ageClass(c.age_days),
        text: c.age_days === 0 ? 'เปิดวันนี้' : `เปิดมา ${c.age_days} วัน`,
      }) : null,
      on('tags') && late ? el('span.badge.danger', { text: 'เลนส์เลยกำหนด' }) : null,
      on('tags') && c.is_waiting ? el('span.badge.warn', { text: 'รอของ' }) : null,
    ]),
  ]);
}

/* ------------------------- ลากการ์ดข้ามคอลัมน์ -------------------------
 * ใช้ Pointer Events ไม่ใช่ HTML5 drag-and-drop เพราะ Safari บน iPad
 * ไม่รองรับ HTML5 drag เลย ลากไม่ติดสักครั้ง
 *
 * การ์ดตั้ง touch-action:pan-y ไว้ นิ้วปัดขึ้นลง = เลื่อนคอลัมน์ตามปกติ
 * ปัดออกข้าง = เริ่มลาก จึงไม่แย่งท่าเลื่อนหน้าจอไปจากผู้ใช้
 */

/** สถานะถัดไปตามลำดับงานจริง — คืน null เมื่อเคสจบแล้วหรือไม่มีต่อ */
/** สถานะย่อยทั้งหมดของขั้นนั้น เรียงตามลำดับงานจริง
    เอา is_terminal มาด้วย เพราะขั้น "จบงาน" มีแต่สถานะปิดเคส */
function statusesOfGroup(group) {
  return (meta.statuses || [])
    .filter((s) => s.stage_group === group)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** ขั้นตอนไหน "เสร็จแล้ว" ดูจากข้อมูลที่กรอกครบ ไม่ใช่จากสถานะที่กดไว้
    คืนรายการสิ่งที่ยังขาด ถ้าว่าง = ขั้นนั้นครบแล้ว
    เก็บเป็นข้อความไว้โชว์ตอนชี้ที่วงกลม จะได้รู้ว่าต้องไปกรอกอะไรต่อ */
const STAGE_CHECKS = {
  reception: (c) => [
    !c.customer_id && 'ข้อมูลลูกค้า',
    !c.received_by && 'ผู้รับเรื่อง',
  ],
  exam: (c) => [
    !(c.prescriptions || []).some((r) => r.kind === 'final' || r.confirmed_at)
      && 'ค่าสายตาที่ยืนยันแล้ว',
  ],
  sales: (c) => [
    !c.order && 'ออเดอร์',
    c.order && !c.order.frame_name && 'กรอบแว่น',
    c.order && !c.order.lens_name && 'เลนส์',
    !(c.centering && c.centering.pd_total) && 'วัดจุดศูนย์กลาง',
    c.order && !c.order.appointment_date && 'วันนัดรับ',
  ],
  production: (c) => [
    !c.lens_job && 'ใบงานเลนส์',
    c.lens_job && !(c.lens_job.received_at || c.lens_job.picked_at) && 'รับเลนส์เข้า',
    !(c.production && c.production.edging_finished_at) && 'ฝนเลนส์เสร็จ',
  ],
  qc: (c) => [
    !(c.qc_checks || []).some((q) => q.result === 'pass') && 'ผล QC ที่ผ่าน',
  ],
  delivery: (c) => [
    !(c.production && c.production.pack_glasses) && 'แพ็คสินค้า',
    !(c.notifications || []).length && 'แจ้งลูกค้า',
    Number(c.balance) > 0 && 'เก็บเงินให้ครบ',
  ],
  done: (c) => [
    !(c.closed_at || c.is_terminal) && 'ปิดเคส',
  ],
};

/** สิ่งที่ยังขาดของขั้นนั้น — [] แปลว่าครบ */
const stageMissing = (group, c) =>
  ((STAGE_CHECKS[group] || (() => []))(c)).filter(Boolean);

/** สถานะแรกของขั้นตอนนั้น = สถานะที่เคสควรไปอยู่เมื่อถูกย้ายเข้ามา */
function entryStatusOf(group) {
  return (meta.statuses || [])
    .filter((s) => s.stage_group === group && !s.is_terminal)
    .sort((a, b) => a.sort_order - b.sort_order)[0] || null;
}

const DRAG_THRESHOLD = 8;

function enableCardDrag(board, onMoved) {
  let st = null;

  const cleanup = () => {
    if (!st) return;
    st.ghost?.remove();
    st.card.classList.remove('dragging');
    document.body.classList.remove('board-dragging');
    board.querySelectorAll('.board-col.drop-target')
      .forEach((c) => c.classList.remove('drop-target'));
    st = null;
  };

  const colUnder = (x, y) => {
    if (st?.ghost) st.ghost.style.display = 'none';
    const hit = document.elementFromPoint(x, y);
    if (st?.ghost) st.ghost.style.display = '';
    return hit ? hit.closest('.board-col') : null;
  };

  board.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const card = e.target.closest('.case-card');
    if (!card) return;
    st = {
      card, id: card.dataset.id, from: card.closest('.board-col').dataset.group,
      x0: e.clientX, y0: e.clientY, active: false, ghost: null, target: null,
    };
  });

  board.addEventListener('pointermove', (e) => {
    if (!st) return;
    const dx = e.clientX - st.x0, dy = e.clientY - st.y0;

    if (!st.active) {
      // ต้องปัดออกข้างมากกว่าขึ้นลง ไม่งั้นถือว่าผู้ใช้ตั้งใจเลื่อนคอลัมน์
      if (Math.abs(dx) < DRAG_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
      st.active = true;
      st.card.setPointerCapture?.(e.pointerId);
      const r = st.card.getBoundingClientRect();
      st.offX = st.x0 - r.left;
      st.offY = st.y0 - r.top;
      const g = st.card.cloneNode(true);
      g.className = 'case-card card-ghost';
      g.style.width = r.width + 'px';
      document.body.append(g);
      st.ghost = g;
      st.card.classList.add('dragging');
      document.body.classList.add('board-dragging');
    }

    st.ghost.style.left = (e.clientX - st.offX) + 'px';
    st.ghost.style.top = (e.clientY - st.offY) + 'px';

    const col = colUnder(e.clientX, e.clientY);
    if (col !== st.target) {
      st.target?.classList.remove('drop-target');
      st.target = col && col.dataset.group !== st.from ? col : null;
      st.target?.classList.add('drop-target');
    }
  });

  const finish = async (e) => {
    if (!st) return;
    const { active, target, id, card } = st;
    const toGroup = target?.dataset.group;
    cleanup();
    if (!active) return;          // แค่แตะเฉยๆ ปล่อยให้ click พาไปหน้าเคส
    e.preventDefault();
    if (!toGroup) return;

    const to = entryStatusOf(toGroup);
    if (!to) { err(new Error('ขั้นตอนนี้ไม่มีสถานะให้ย้ายเข้า')); return; }

    // บอกให้ชัดว่าจะกลายเป็นสถานะอะไร ไม่เดาแทนผู้ใช้เงียบๆ
    const name = card.querySelector('.cc-name')?.textContent || 'เคสนี้';
    const okGo = await confirmDialog(
      'ย้ายเคส',
      `ย้าย "${name}" ไปขั้น ${stageInfo(toGroup).label}\nสถานะจะเปลี่ยนเป็น "${to.stage_no} ${to.label_th}"`,
      { confirmText: 'ย้ายเลย' });
    if (!okGo) return;

    try {
      await api.post(`/api/cases/${id}/status`, { status: to.code });
      ok(`ย้าย ${name} ไป ${stageInfo(toGroup).label} แล้ว`);
      onMoved();
    } catch (ex) { err(ex); }
  };

  board.addEventListener('pointerup', finish);
  board.addEventListener('pointercancel', () => cleanup());
  // ลากแล้วปล่อย ต้องไม่ให้ click เด้งไปหน้าเคส
  board.addEventListener('click', (e) => {
    if (document.body.classList.contains('board-dragging')) e.stopPropagation();
  }, true);
}

/* ============================= NEW CASE ============================ */
export async function caseForm({ query, navigate }) {
  let customer = query.customer ? await api.get('/api/customers/' + query.customer) : null;
  const chosen = el('div.card-body');
  const draw = () => chosen.replaceChildren(customer
    ? el('div.row', {}, [
      el('span.badge.blue', { text: '#' + customer.id }),
      el('b', { text: custName(customer) }),
      el('span.muted', { text: customer.phone || '' }),
    ])
    : el('span.muted', { text: 'ยังไม่ได้เลือกลูกค้า' }));
  draw();

  const pick = picker({
    placeholder: 'ค้นหาลูกค้า (ชื่อ / เบอร์โทร / รหัส)',
    fetcher: (q) => api.get('/api/customers', { q, limit: 40 }),
    // ค้นไม่เจอ = ลูกค้าใหม่ ให้เพิ่มได้ตรงนั้นเลย ไม่ต้องทิ้งฟอร์มที่กรอกค้างไว้
    emptyAction: addCustomerAction(),
    label: custName,
    sub: (r) => r.phone || '',
    onPick: (r) => { customer = r; draw(); },
  });

  const form = el('form');
  form.append(card('เปิดเคสใหม่', [
    el('div.form-grid', {}, [
      field('พนักงานผู้รับเรื่อง', employeeSelect('received_by', '')),
      field('สถานะเริ่มต้น', select('status',
        (meta.statuses || []).filter((s) => !s.is_terminal)
          .map((s) => [s.code, `${s.stage_no} ${s.label_th}`]), 'reception')),
      field('รู้จักร้านจากช่องทางไหน', select('referral_source',
        [['', '— ไม่ระบุ —'], ...(meta.referral_sources || [])], '')),
      el('div.field', {}, [
        el('label', { text: 'ประเภทงาน' }),
        el('div.row', {}, [
          el('label.check', {}, [input('is_rush', { type: 'checkbox' }), ' งานด่วน 🔥']),
          el('label.check', {}, [input('is_new_customer', { type: 'checkbox' }), ' ลูกค้าใหม่']),
        ]),
      ]),
    ]),
    el('div.field.full', {}, [
      el('label', { text: 'หมายเหตุ' }),
      el('textarea', { name: 'reception_note', placeholder: 'ลูกค้าต้องการอะไร มีอาการอย่างไร' }),
    ]),
    el('div.form-actions', {}, [
      el('button.btn.btn-lg', { type: 'submit', text: '✔ เปิดเคส' }),
      el('a.btn.btn-light', { href: '#/cases', text: 'ยกเลิก' }),
    ]),
  ]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!customer) return err('กรุณาเลือกลูกค้าก่อน');
    try {
      const saved = await api.post('/api/cases', { ...formData(form), customer_id: customer.id });
      ok('เปิดเคส ' + saved.case_code + ' แล้ว');
      navigate('#/cases/' + saved.id);
    } catch (ex) { err(ex); }
  });

  return frag([
    pageHead('🗂', 'New Case', 'เปิดเคสใหม่'),
    el('div.split', {}, [
      el('div.card', {}, [
        el('div.card-head', {}, [
          el('h2', { text: 'เลือกลูกค้า' }),
          el('div.right', {}, [el('a.btn.btn-sm.btn-light', { href: '#/customers/new', text: '+ ลูกค้าใหม่' })]),
        ]),
        el('div.card-body', {}, [pick.node]),
      ]),
      el('div.card', {}, [
        el('div.card-head', {}, [el('h2', { text: 'ลูกค้าที่เลือก' })]), chosen,
      ]),
    ]),
    form,
  ]);
}

/* ============================ CASE DETAIL ========================== */
const yn = (v) => (v ? '✔' : '—');

function rxTable(t) {
  const row = (label, k) => el('tr', {}, [
    el('td.lbl', { text: label }),
    ...[power(t[`${k}_sphere`]), power(t[`${k}_cylinder`]), rxNum(t[`${k}_axis`]),
      power(t[`${k}_add`]), rxNum(t[`${k}_pd`]), rxNum(t[`${k}_va`]),
      t[`${k}_prism`] || '—'].map((v) => el('td', { text: String(v) })),
  ]);
  /* ค่าวัดสองตาพร้อมกัน กระดาษถามแค่ SPH / ADD / VA / PD ช่องที่เหลือจึงเว้นไว้ */
  const shortRow = (label, prefix, k) => el('tr.bin', {}, [
    el('td.lbl', { text: label }),
    ...[power(t[`${prefix}${k}_sphere`]), '—', '—', power(t[`${prefix}${k}_add`]),
      rxNum(t[`${prefix}${k}_pd`]), rxNum(t[`${prefix}${k}_va`]), '—']
      .map((v) => el('td', { text: String(v) })),
  ]);
  const filled = (prefix) => ['r', 'l'].some((k) => ['sphere', 'add', 'va', 'pd']
    .some((fld) => ![null, undefined, ''].includes(t[`${prefix}${k}_${fld}`])));
  const hasBin = filled('bin_');
  const hasOld = filled('old_');

  return el('table.doc', {}, [
    el('thead', {}, [el('tr', {}, ['', 'SPH', 'CYL', 'AXIS', 'ADD', 'PD', 'VA', 'PRISM']
      .map((h) => el('th', { text: h })))]),
    el('tbody', {}, [
      row('R', 'r'), row('L', 'l'),
      ...(hasBin ? [shortRow('Bino R', 'bin_', 'r'), shortRow('Bino L', 'bin_', 'l')] : []),
      ...(hasOld ? [shortRow('แว่นเดิม R', 'old_', 'r'), shortRow('แว่นเดิม L', 'old_', 'l')] : []),
    ]),
  ]);
}

export async function caseDetail({ params, navigate, refresh }) {
  const c = await api.get('/api/cases/' + params.id);
  const wrap = el('div');
  /* ไม่มีช่อง "ผู้ทำรายการ" รวมแล้ว แต่ละแท็บที่ต้องระบุคนทำมีช่องของตัวเอง
     ที่เหลือส่ง null ไป ฝั่ง server รับได้ */
  const empId = () => null;

  wrap.append(pageHead('🗂', c.case_code, custName(c), [
    el('a.btn.btn-ghost', { href: '#/customers/' + c.customer_id, text: '👤 ข้อมูลลูกค้า' }),
    c.order ? el('a.btn.btn-ghost', { href: '#/orders/' + c.order.id, text: '👓 ออเดอร์' }) : null,
    c.order ? el('a.btn.btn-ghost', { href: '#/print/order/' + c.order.id, text: '🖨 ใบสั่ง' }) : null,
  ]));

  /* ---- status strip ----
     ย้ายขั้นทำที่แถบขั้นตอนที่เดียว ไม่มีปุ่มซ้ำอีกที่ */

  const goStatus = async (code) => {
    if (!code || code === c.status) return;
    try {
      await api.post(`/api/cases/${c.id}/status`, { status: code, employee_id: empId() });
      ok('เปลี่ยนสถานะแล้ว'); refresh();
    } catch (ex) { err(ex); }
  };

  /* แถบขั้นตอน — ✔ = ข้อมูลขั้นนั้นกรอกครบแล้ว (ดูจากข้อมูลจริง ไม่ใช่จากสถานะที่กดไว้)
     วงแหวน = ขั้นที่เคสอยู่ตอนนี้
     กดวงกลม = ย้ายเคสไปขั้นนั้นทันที · กดชื่อขั้น = เปิดดูข้อมูล แยกเป้ากดคนละจุด */
  const allGroups = [...GROUPS, 'done'];
  /* ขั้นไหนข้อมูลไปอยู่แท็บไหน */
  const STAGE_TAB = {
    reception: 'รับเรื่อง', exam: 'ค่าสายตา', sales: 'การเงิน',
    production: 'เลนส์', qc: 'ผลิต & QC', delivery: 'ติดต่อลูกค้า', done: 'ไทม์ไลน์',
  };
  let showTab = () => {};   // ผูกจริงหลังสร้างแท็บเสร็จข้างล่าง

  /* ย้ายทันทีที่กด ไม่ถามซ้ำ — เข้าที่สถานะแรกของขั้นนั้น
     ขั้น "จบงาน" มีแต่สถานะปิดเคส entryStatusOf จึงคืน null ต้องหยิบตัวแรกมาเอง */
  const moveToStage = (g) =>
    goStatus((entryStatusOf(g) || statusesOfGroup(g)[0] || {}).code);

  const stepper = el('div.stepper', {}, allGroups.map((g) => {
    const info = stageInfo(g);
    const missing = stageMissing(g, c);
    const filled = !missing.length;
    /* now = เคสอยู่ขั้นนี้, done = ข้อมูลครบ — เป็นได้พร้อมกัน คนละเรื่องกัน */
    const state = `${filled ? 'done' : 'todo'}${g === c.stage_group ? ' now' : ''}`;
    return el('div.step', {
      class: state,
      style: `--stage:${info.color}`,
    }, [
      el('span.step-line'),
      el('button.step-dot.icon-only', {
        type: 'button',
        title: filled
          ? `ข้อมูลครบแล้ว — กดเพื่อย้ายเคสไปขั้น ${info.label}`
          : `ยังขาด: ${missing.join(', ')} — กดเพื่อย้ายเคสไปขั้น ${info.label}`,
        text: filled ? '✔' : info.icon,
        onclick: () => moveToStage(g),
      }),
      el('button.step-label', {
        type: 'button',
        title: `ดูข้อมูลขั้น ${info.label}`,
        text: info.label,
        onclick: () => showTab(STAGE_TAB[g]),
      }),
    ]);
  }));

  wrap.append(el('div.card', {}, [
    el('div.card-body', {}, [
      el('div.row', { style: 'gap:14px;align-items:center;margin-bottom:12px' }, [
        statusChip(c),
        c.is_rush ? el('span.badge.danger', { text: '🔥 งานด่วน' }) : null,
        c.is_waiting ? el('span.badge.warn', { text: 'สถานะรอ' }) : null,
        el('span.muted', { text: `เปิดเมื่อ ${fmtDateTime(c.opened_at)}` }),
        c.received_by_name ? el('span.muted', { text: `รับโดย ${c.received_by_name}` }) : null,
        c.phone ? el('span.muted', { text: '☎ ' + c.phone }) : null,
        el('button.btn.btn-sm.btn-light', {
          type: 'button',
          text: c.is_rush ? 'ยกเลิกงานด่วน' : '🔥 ตั้งเป็นงานด่วน',
          onclick: async () => {
            try {
              await api.put('/api/cases/' + c.id, { ...c, is_rush: c.is_rush ? 0 : 1 });
              refresh();
            } catch (ex) { err(ex); }
          },
        }),
        c.referral_source
          ? el('span.badge.blue', { text: 'รู้จักจาก ' + referralLabel(c.referral_source) })
          : null,
      ]),
      stepper,
      el('p.hint', {
        style: 'margin:-10px 0 12px;text-align:center',
        text: '✔ = ข้อมูลขั้นนั้นกรอกครบแล้ว · กดวงกลม = ย้ายเคสไปขั้นนั้น · กดชื่อขั้น = เปิดดูข้อมูล',
      }),
    ]),
  ]));

  /* ---- money strip ---- */
  if (c.order) {
    wrap.append(el('div.kpis', {}, [
      el('div.kpi', {}, [el('div.k-label', { text: 'ราคารวม' }),
        el('div.k-value', { text: moneyShort(c.order.total_price) })]),
      el('div.kpi', {}, [el('div.k-label', { text: 'ส่วนลด' }),
        el('div.k-value', { text: moneyShort(c.order.discount) })]),
      el('div.kpi.ok', {}, [el('div.k-label', { text: 'รับแล้ว' }),
        el('div.k-value', { text: moneyShort(c.paid) })]),
      el('div.kpi.warn', {}, [el('div.k-label', { text: 'คงเหลือ' }),
        el('div.k-value', { text: moneyShort(c.balance) })]),
      el('div.kpi', {}, [el('div.k-label', { text: 'วันนัดรับ' }),
        el('div.k-value', {
          style: 'font-size:17px',
          text: fmtDate(c.order.appointment_date) || '—',
        })]),
    ]));
  }

  /* ---- tab panels ---- */
  const panels = {
    'รับเรื่อง': receptionPanel(c),
    'ค่าสายตา': rxPanel(c, refresh, empId),
    'เลนส์': lensPanel(c, refresh, empId),
    'ผลิต & QC': productionPanel(c, refresh, empId),
    'การเงิน': paymentPanel(c, refresh, empId),
    'ติดต่อลูกค้า': notifyPanel(c, refresh, empId),
    'ไทม์ไลน์': timelinePanel(c, refresh, empId),
  };
  const names = Object.keys(panels);
  const body = el('div');
  const tabs = el('div.tabs', {}, names.map((n, i) =>
    el('a', {
      href: 'javascript:void 0', class: i === 0 ? 'active' : '', text: n,
      dataset: { tab: n },
      onclick: (e) => { e.preventDefault(); showTab(n); },
    })));

  showTab = (name) => {
    if (!panels[name]) return;
    for (const a of tabs.children) a.classList.toggle('active', a.dataset.tab === name);
    body.replaceChildren(panels[name]);
    // กดจากแถบขั้นตอนแล้วเนื้อหาอยู่ต่ำกว่าจอ ต้องเลื่อนไปให้เห็น
    tabs.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // เปิดหน้ามาให้อยู่แท็บของขั้นที่เคสอยู่ตอนนี้เลย ไม่ต้องไล่หาเอง
  showTab(STAGE_TAB[c.stage_group] || names[0]);
  wrap.append(tabs, body);
  return wrap;
}

/* ---------------------------- rx panel ---------------------------- */
/* ข้อมูลที่บันทึกไว้ตอนเปิดเคส — เดิมกรอกแล้วไม่มีที่ดูเลย */
function receptionPanel(c) {
  const row = (label, value) => (value
    ? frag([el('dt', { text: label }), el('dd', { text: value })])
    : null);
  return card('ข้อมูลตอนรับเรื่อง', [
    el('dl.kv', {}, [
      row('เปิดเคสเมื่อ', fmtDateTime(c.opened_at)),
      row('พนักงานผู้รับเรื่อง', c.received_by_name),
      row('รู้จักร้านจาก', c.referral_source ? referralLabel(c.referral_source) : null),
      row('ประเภทลูกค้า', c.is_new_customer ? 'ลูกค้าใหม่' : 'ลูกค้าเก่า'),
      row('เบอร์โทร', c.phone),
      row('LINE', c.line_id),
      row('อีเมล', c.email),
    ]),
    c.reception_note
      ? el('div', { style: 'margin-top:14px' }, [
        el('label', { text: 'หมายเหตุ' }),
        el('p', { style: 'white-space:pre-wrap;margin:4px 0 0', text: c.reception_note }),
      ])
      : el('p.hint', { style: 'margin-top:12px', text: 'ไม่ได้บันทึกหมายเหตุไว้ตอนเปิดเคส' }),
  ]);
}

function rxPanel(c, refresh, empId) {
  const rows = c.prescriptions || [];
  const KIND = { old: 'ค่าเดิม', measured: 'ที่วัดได้', final: 'ที่ใช้จริง' };
  const box = el('div.stack');

  for (const t of rows) {
    box.append(card(`${KIND[t.kind] || t.kind} — ${fmtDateTime(t.test_date)}`, [
      rxTable(t),
      el('div.row', {}, [
        t.test_for ? el('span.badge.gray', { text: t.test_for }) : null,
        t.source ? el('span.badge.blue', { text: listLabel('rx_source', t.source) }) : null,
        t.old_glasses_type
          ? el('span.badge.gray', { text: listLabel('old_glasses_type', t.old_glasses_type) })
          : null,
        (t.va_naked_r || t.va_naked_l)
          ? el('span.muted', { text: `ตาเปล่า R ${t.va_naked_r || '—'} / L ${t.va_naked_l || '—'}` })
          : null,
        t.performed_by_name ? el('span.muted', { text: 'ผู้วัด ' + t.performed_by_name }) : null,
        t.confirmed_at ? el('span.badge.ok', { text: 'ยืนยันแล้ว' }) : null,
      ]),
      [t.health_cataract && 'ต้อกระจก', t.health_eye_surgery && 'เคยผ่าตัดตา',
        t.health_diabetes && 'เบาหวาน', t.health_bp && 'ความดัน', t.health_heart && 'หัวใจ']
        .filter(Boolean).length
        ? el('p', {}, [el('b', { text: 'สุขภาพ: ' }),
          [t.health_cataract && 'ต้อกระจก', t.health_eye_surgery && 'เคยผ่าตัดตา',
            t.health_diabetes && 'เบาหวาน', t.health_bp && 'ความดัน', t.health_heart && 'หัวใจ']
            .filter(Boolean).join(', '), t.health_note ? ' — ' + t.health_note : ''])
        : null,
      t.exam_note ? el('p.muted', { text: t.exam_note }) : null,
      el('div.row', {}, [
        el('a.btn.btn-sm.btn-light', { href: '#/prescriptions/' + t.id, text: '✎ แก้ไข' }),
        el('a.btn.btn-sm.btn-light', { href: '#/print/prescription/' + t.id, text: '🖨 พิมพ์' }),
        t.kind !== 'final' ? el('button.btn.btn-sm.btn-accent', {
          text: '✔ ใช้ค่านี้เป็นค่าจริง',
          onclick: async () => {
            try {
              await api.post(`/api/prescriptions/${t.id}/confirm`, { employee_id: empId() });
              ok('ยืนยันค่าสายตาแล้ว'); refresh();
            } catch (ex) { err(ex); }
          },
        }) : null,
      ]),
    ], { badge: t.kind === 'final' ? el('span.badge.ok', { text: 'FINAL' }) : null }));
  }
  /* กรอกใบวัดสายตาตรงนี้ได้เลย ไม่ต้องเด้งไปอีกหน้าแล้วเดินกลับมา
     ลูกค้ากับเคสรู้อยู่แล้วจากหน้านี้ จึงไม่ต้องถามซ้ำ
     วันที่วัดไม่ต้องถาม ฝั่ง server เติมเวลาปัจจุบันให้ */
  const rxForm = el('form.card-body');
  /* ใบล่าสุดของลูกค้าจากเคสอื่น = ค่าที่อยู่ในแว่นที่ใส่มาวันนี้
     โหลดตอนกดเลือก "ดึงจากประวัติ" เท่านั้น ไม่ต้องยิงทุกครั้งที่เปิดแท็บ */
  const historyRx = () => api.get('/api/prescriptions', { customer_id: c.customer_id })
    .then((all) => {
      const other = (all || []).filter((r) => r.case_id !== c.id);
      return other.find((r) => r.kind === 'final') || other[0] || null;
    })
    .catch(() => null);

  /* แว่นที่ลูกค้าใส่มา = แว่นที่เราตัดให้รอบก่อน ชนิดจึงดูจากเลนส์ในออเดอร์เก่าได้ */
  const historyGlasses = () => api.get('/api/orders', { customer_id: c.customer_id })
    .then((rows) => {
      const o = (rows || []).find((x) => x.case_id !== c.id);
      const type = o ? glassesTypeOfLens(o.lens_type) : '';
      return type ? { type, lens_type: o.lens_type } : null;
    })
    .catch(() => null);

  rxForm.append(rxFormFields({}, {
    kindField: false, headerRow: 'compact', historyRx, historyGlasses,
  }));
  rxForm.append(el('div.form-actions', { style: 'margin-top:14px' }, [
    el('button.btn.btn-accent.btn-lg', { type: 'submit', text: '✔ บันทึกค่าสายตา' }),
  ]));
  rxForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const body = formData(rxForm);
      /* ใบเดียวเก็บทั้งค่าแว่นเดิม (old_*) และค่าที่วัดรอบนี้ (r_* / l_* / bin_*)
         เหมือนใบกระดาษหนึ่งแผ่น จึงบันทึกเป็นชนิด "ค่าที่วัดได้" เสมอ
         ส่วนช่อง "ที่มาของค่า" อธิบายเฉพาะว่าค่าแว่นเดิมได้มาจากไหน */
      await api.post('/api/prescriptions', {
        ...body,
        kind: 'measured',
        case_id: c.id,
        customer_id: c.customer_id,
        recorded_by: Number(body.recorded_by) || empId(),
      });
      ok('บันทึกค่าสายตาแล้ว'); refresh();
    } catch (ex) { err(ex); }
  });
  box.append(el('div.card', {}, [
    el('div.card-head', {}, [el('h2', { text: 'บันทึกค่าสายตาใหม่' })]),
    rxForm,
  ]));
  return box;
}

/* --------------------------- lens panel --------------------------- */
function lensPanel(c, refresh, empId) {
  const j = c.lens_job;
  const box = el('div.stack');

  const form = el('form.card-body');
  const source = select('source', [['stock', 'มีในสต็อก (หยิบได้เลย)'], ['order', 'ต้องสั่งซัพพลายเออร์']],
    j?.source || 'stock');
  const supplierWrap = el('div.form-grid');
  const drawSupplier = () => {
    supplierWrap.style.display = source.value === 'order' ? '' : 'none';
  };
  source.addEventListener('change', drawSupplier);

  supplierWrap.append(
    field('ซัพพลายเออร์', select('supplier_id',
      [['', '— เลือก —'], ...(meta.suppliers || []).map((s) => [s.id, s.name])],
      j?.supplier_id || '')),
    field('เลขที่ใบสั่ง', input('supplier_order_no', { value: j?.supplier_order_no || '' })),
    field('วันที่สั่ง', input('order_date', { type: 'date', value: dateOnly(j?.order_date) || todayISO() })),
    field('Lead time (วัน)', input('lead_time_days', { type: 'number', min: '0', value: j?.lead_time_days ?? 7 })),
    field('คาดว่าจะถึง (ETA)', input('expected_arrival', { type: 'date', value: dateOnly(j?.expected_arrival) })),
  );

  form.append(el('div.form-grid', {}, [
    field('แหล่งเลนส์ / Source', source),
    field('ผู้หยิบ/ผู้ตรวจ', employeeSelect('picked_by', j?.picked_by || '')),
    el('div.field', {}, [
      el('label', { text: 'ตรวจสอบ' }),
      el('div.row', {}, [
        el('label.check', {}, [input('rx_checked', { type: 'checkbox', checked: !!j?.rx_checked }), ' ตรวจค่าสายตา']),
        el('label.check', {}, [input('lens_checked', { type: 'checkbox', checked: !!j?.lens_checked }), ' ตรวจเลนส์']),
      ]),
    ]),
  ]));
  form.append(supplierWrap);
  form.append(el('div.field.full', {}, [
    el('label', { text: 'หมายเหตุ' }),
    el('textarea', { name: 'notes', text: j?.notes || '' }),
  ]));
  form.append(el('div.form-actions', {}, [
    el('button.btn', { type: 'submit', text: j ? '💾 บันทึกงานเลนส์' : '+ สร้างงานเลนส์' }),
    j && j.status !== 'ready' ? el('button.btn.btn-ok', {
      type: 'button', text: '📦 เลนส์มาถึงแล้ว',
      onclick: async () => {
        try {
          await api.post(`/api/lens-jobs/${j.id}/receive`, { received_by: empId() });
          ok('บันทึกรับเลนส์แล้ว'); refresh();
        } catch (ex) { err(ex); }
      },
    }) : null,
  ]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/lens-jobs', {
        ...formData(form), case_id: c.id, order_id: c.order?.id,
        recorded_by: empId(),
      });
      ok('บันทึกงานเลนส์แล้ว'); refresh();
    } catch (ex) { err(ex); }
  });
  drawSupplier();

  box.append(el('div.card', {}, [
    el('div.card-head', {}, [
      el('h2', { text: 'งานเลนส์ — Lens Job' }),
      j ? el('span.badge', {
        class: j.status === 'ready' ? 'ok' : 'warn',
        text: j.status === 'ready' ? 'พร้อมแล้ว' : 'รอเลนส์มา',
      }) : null,
    ]),
    form,
  ]));

  /* follow-ups */
  if (j) {
    const fu = el('form.card-body');
    fu.append(el('div.form-grid', {}, [
      field('ผู้ติดต่อ', employeeSelect('contacted_by', '')),
      field('ช่องทาง', select('channel', ['phone', 'line', 'email', 'walk-in'], 'phone')),
      field('ETA เดิม', input('previous_eta_display', { value: dateOnly(j.expected_arrival) || '-', disabled: true })),
      field('ETA ใหม่', input('new_eta', { type: 'date' })),
      field('วันนัดใหม่ (ถ้าต้องเลื่อน)', input('new_appointment_date', { type: 'date' })),
      el('div.field', {}, [
        el('label', { text: 'ผลกระทบ' }),
        el('div.row', {}, [
          el('label.check', {}, [input('affects_appointment', { type: 'checkbox' }), ' กระทบวันนัด']),
          el('label.check', {}, [input('customer_notified', { type: 'checkbox' }), ' แจ้งลูกค้าแล้ว']),
        ]),
      ]),
    ]));
    fu.append(el('div.field.full', {}, [
      el('label', { text: 'คำตอบจากซัพพลายเออร์ / บันทึก' }),
      el('textarea', { name: 'supplier_reply' }),
    ]));
    fu.append(el('div.form-actions', {}, [
      el('button.btn.btn-light', { type: 'submit', text: '+ บันทึกการติดตาม' }),
    ]));
    fu.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const b = formData(fu);
        delete b.previous_eta_display;
        await api.post(`/api/lens-jobs/${j.id}/followup`, b);
        ok('บันทึกการติดตามแล้ว'); refresh();
      } catch (ex) { err(ex); }
    });

    box.append(el('div.card', {}, [
      el('div.card-head', {}, [
        el('h2', { text: 'ติดตามเลนส์ — Follow-up' }),
        el('span.badge.gray', { text: `${j.follow_up_count || 0} ครั้ง` }),
      ]),
      el('div.card-body.tight', {}, [table([
        { label: '#', key: 'seq', cls: 'num' },
        { label: 'เมื่อ', render: (f) => fmtDateTime(f.contacted_at), cls: 'nowrap' },
        { label: 'โดย', key: 'contacted_by_name' },
        { label: 'ช่องทาง', key: 'channel' },
        { label: 'ETA เดิม', render: (f) => fmtDate(f.previous_eta), cls: 'nowrap' },
        { label: 'ETA ใหม่', render: (f) => fmtDate(f.new_eta), cls: 'nowrap' },
        { label: 'กระทบนัด', render: (f) => yn(f.affects_appointment) },
        { label: 'แจ้งลูกค้า', render: (f) => yn(f.customer_notified) },
        { label: 'บันทึก', render: (f) => f.supplier_reply || f.note || '' },
      ], j.followups || [], { empty: 'ยังไม่มีการติดตาม' })]),
      fu,
    ]));
  }
  return box;
}

/* ------------------------ production panel ------------------------ */
function productionPanel(c, refresh, empId) {
  const p = c.production || {};
  const box = el('div.stack');

  /* frame fitting + centering */
  const ff = c.frame_fitting || {};
  const ce = c.centering || {};
  const fitForm = el('form.card-body');
  fitForm.append(el('div.form-grid', {}, [
    field('Frame size', input('frame_size', { value: ff.frame_size || '' })),
    field('Lens width', input('lens_width', { value: ff.lens_width || '' })),
    field('Bridge', input('bridge_width', { value: ff.bridge_width || '' })),
    field('Temple', input('temple_length', { value: ff.temple_length || '' })),
    field('ED', input('ed', { value: ff.ed || '' })),
    field('DBL', input('dbl', { value: ff.dbl || '' })),
    field('ผู้วัด', employeeSelect('performed_by', ff.performed_by || '')),
  ]));
  fitForm.append(el('div.form-actions', {}, [
    el('button.btn.btn-light', { type: 'submit', text: '💾 บันทึกการวัดกรอบ' })]));
  fitForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/frame-fittings',
        { ...formData(fitForm), case_id: c.id, order_id: c.order?.id, recorded_by: empId() });
      ok('บันทึกแล้ว'); refresh();
    } catch (ex) { err(ex); }
  });

  const ctForm = el('form.card-body');
  ctForm.append(el('div.form-grid', {}, [
    field('R PD', input('r_pd', { value: ce.r_pd || '' })),
    field('L PD', input('l_pd', { value: ce.l_pd || '' })),
    field('PD รวม', input('pd_total', { value: ce.pd_total || '' })),
    field('R Height', input('r_height', { value: ce.r_height || '' })),
    field('L Height', input('l_height', { value: ce.l_height || '' })),
    field('Vertex', input('vertex_distance', { value: ce.vertex_distance || '' })),
    field('Pantoscopic tilt', input('pantoscopic_tilt', { value: ce.pantoscopic_tilt || '' })),
    field('Wrap angle', input('wrap_angle', { value: ce.wrap_angle || '' })),
    field('ผู้วัด', employeeSelect('performed_by', ce.performed_by || '')),
  ]));
  ctForm.append(el('div.form-actions', {}, [
    el('button.btn.btn-light', { type: 'submit', text: '💾 บันทึกจุดศูนย์กลาง' })]));
  ctForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/centerings',
        { ...formData(ctForm), case_id: c.id, order_id: c.order?.id, recorded_by: empId() });
      ok('บันทึกแล้ว'); refresh();
    } catch (ex) { err(ex); }
  });

  box.append(el('div.split', {}, [
    el('div.card', {}, [el('div.card-head', {}, [el('h2', { text: 'วัดกรอบ — Frame Fitting' })]), fitForm]),
    el('div.card', {}, [el('div.card-head', {}, [el('h2', { text: 'จุดศูนย์กลาง — Centering' })]), ctForm]),
  ]));

  /* production job */
  const prod = el('form.card-body');
  prod.append(el('div.form-grid', {}, [
    field('ช่างที่รับงาน', employeeSelect('assigned_technician', p.assigned_technician || '')),
    field('เริ่มฝน', input('edging_started_at', { type: 'datetime-local', value: dtLocal(p.edging_started_at) })),
    field('ฝนเสร็จ', input('edging_finished_at', { type: 'datetime-local', value: dtLocal(p.edging_finished_at) })),
    field('ผู้ฝน', employeeSelect('edged_by', p.edged_by || '')),
    el('div.field', {}, [
      el('label', { text: 'ตรวจจับคู่' }),
      el('div.row', {}, [
        el('label.check', {}, [input('match_customer_ok', { type: 'checkbox', checked: !!p.match_customer_ok }), ' ตรงลูกค้า']),
        el('label.check', {}, [input('match_rx_ok', { type: 'checkbox', checked: !!p.match_rx_ok }), ' ตรงค่าสายตา']),
      ]),
    ]),
    el('div.field.full', {}, [
      el('label', { text: 'Checklist การแพ็ค' }),
      el('div.row', {}, [
        ['pack_glasses', 'แว่น'], ['pack_case', 'กล่อง'], ['pack_cloth', 'ผ้าเช็ด'],
        ['pack_warranty', 'ใบรับประกัน'], ['pack_prescription', 'ใบค่าสายตา'],
        ['pack_accessories', 'อุปกรณ์เสริม'],
      ].map(([k, label]) =>
        el('label.check', {}, [input(k, { type: 'checkbox', checked: !!p[k] }), ' ' + label]))),
    ]),
    field('ผู้แพ็ค', employeeSelect('packed_by', p.packed_by || '')),
    field('ผู้ตรวจการแพ็ค', employeeSelect('pack_checked_by', p.pack_checked_by || '')),
  ]));
  prod.append(el('div.field.full', {}, [
    el('label', { text: 'บันทึกการผลิต' }),
    el('textarea', { name: 'edging_remark', text: p.edging_remark || '' }),
  ]));
  prod.append(el('div.form-actions', {}, [
    el('button.btn.btn-light', { type: 'submit', text: '💾 บันทึกงานผลิต' })]));
  prod.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/production-jobs',
        { ...formData(prod), case_id: c.id, order_id: c.order?.id, employee_id: empId() });
      ok('บันทึกแล้ว'); refresh();
    } catch (ex) { err(ex); }
  });
  box.append(el('div.card', {}, [
    el('div.card-head', {}, [el('h2', { text: 'งานผลิต — Production' })]), prod]));

  /* QC */
  const qc = el('form.card-body');
  qc.append(el('div.form-grid', {}, [
    field('ผลตรวจ', select('result', [['pass', '✅ ผ่าน'], ['fail', '❌ ไม่ผ่าน']], 'pass')),
    field('ผู้ตรวจ', employeeSelect('checked_by', '')),
    field('การแก้ไขที่ทำ', input('action_taken', { placeholder: 'เช่น ฝนใหม่, สั่งเลนส์ใหม่' })),
    el('div.field.full', {}, [
      el('label', { text: 'รายการตรวจ' }),
      el('div.row', {}, [
        ['check_rx', 'ค่าสายตา'], ['check_centering', 'จุดศูนย์กลาง'], ['check_lens', 'เลนส์'],
        ['check_frame', 'กรอบ'], ['check_finish', 'ความเรียบร้อย'],
      ].map(([k, label]) => el('label.check', {}, [input(k, { type: 'checkbox' }), ' ' + label]))),
    ]),
  ]));
  qc.append(el('div.field.full', {}, [
    el('label', { text: 'ข้อบกพร่องที่พบ' }),
    el('textarea', { name: 'defects' }),
  ]));
  qc.append(el('div.form-actions', {}, [
    el('button.btn', { type: 'submit', text: '+ บันทึกผล QC' })]));
  qc.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/qc-checks', { ...formData(qc), case_id: c.id });
      ok('บันทึกผล QC แล้ว'); refresh();
    } catch (ex) { err(ex); }
  });

  box.append(el('div.card', {}, [
    el('div.card-head', {}, [
      el('h2', { text: 'QC' }),
      el('span.badge.gray', { text: `${(c.qc_checks || []).length} รอบ` }),
    ]),
    el('div.card-body.tight', {}, [table([
      { label: 'รอบ', key: 'attempt', cls: 'num' },
      {
        label: 'ผล', render: (r) => el('span.badge', {
          class: r.result === 'pass' ? 'ok' : 'danger',
          text: r.result === 'pass' ? 'ผ่าน' : 'ไม่ผ่าน',
        }),
      },
      { label: 'เมื่อ', render: (r) => fmtDateTime(r.checked_at), cls: 'nowrap' },
      { label: 'ผู้ตรวจ', key: 'checked_by_name' },
      { label: 'ข้อบกพร่อง', key: 'defects' },
      { label: 'แก้ไข', key: 'action_taken' },
    ], c.qc_checks || [], { empty: 'ยังไม่มีการตรวจ QC' })]),
    qc,
  ]));
  return box;
}

/* -------------------------- payment panel ------------------------- */
function paymentPanel(c, refresh, empId) {
  const form = el('form.card-body');
  form.append(el('div.form-grid', {}, [
    field('ประเภท', select('kind', [['deposit', 'มัดจำ'], ['partial', 'จ่ายบางส่วน'],
      ['final', 'ชำระส่วนที่เหลือ'], ['full', 'ชำระเต็ม']],
    c.paid > 0 ? 'final' : 'deposit')),
    field('จำนวนเงิน', input('amount', {
      type: 'number', step: '1', min: '1', value: c.balance > 0 ? c.balance : '', required: true,
    })),
    field('วิธีชำระ', listSelect('method', 'pay_type', 'Cash')),
    field('อ้างอิง (เลขที่โอน)', input('reference')),
    field('ผู้รับเงิน', employeeSelect('received_by', '')),
    field('เมื่อ', input('paid_at', { type: 'datetime-local', value: nowLocal() })),
  ]));
  form.append(el('div.form-actions', {}, [
    el('button.btn', { type: 'submit', text: '+ บันทึกการรับเงิน' })]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const b = formData(form);
      b.paid_at = (b.paid_at || '').replace('T', ' ');
      await api.post('/api/payments', { ...b, case_id: c.id, order_id: c.order?.id });
      ok('บันทึกการรับเงินแล้ว'); refresh();
    } catch (ex) { err(ex); }
  });

  return el('div.stack', {}, [
    el('div.card', {}, [
      el('div.card-head', {}, [
        el('h2', { text: 'ประวัติการรับเงิน' }),
        el('span.badge.ok', { text: 'รับแล้ว ' + money(c.paid) }),
      ]),
      el('div.card-body.tight', {}, [table([
        { label: 'เมื่อ', render: (p) => fmtDateTime(p.paid_at), cls: 'nowrap' },
        { label: 'ประเภท', key: 'kind' },
        { label: 'วิธี', key: 'method' },
        { label: 'จำนวน', render: (p) => money(p.amount), cls: 'num' },
        { label: 'อ้างอิง', key: 'reference' },
        { label: 'ผู้รับ', key: 'received_by_name' },
        { label: 'หมายเหตุ', key: 'notes' },
        {
          label: '', cls: 'nowrap', render: (p) => el('button.btn.btn-sm.btn-light', {
            text: '🗑', onclick: async () => {
              if (!await confirmDialog('ลบรายการรับเงิน',
                `ลบ ${money(p.amount)} (${p.kind})?`, { confirmText: 'ลบ', danger: true })) return;
              try { await api.del('/api/payments/' + p.id); ok('ลบแล้ว'); refresh(); }
              catch (ex) { err(ex); }
            },
          }),
        },
      ], c.payments || [], {
        empty: 'ยังไม่มีการรับเงิน',
        footer: (c.payments || []).length ? el('tr', {}, [
          el('td', { colspan: 3, text: 'รวม' }),
          el('td.num', { text: money(c.paid) }),
          el('td', { colspan: 4 }),
        ]) : null,
      })]),
      form,
    ]),
  ]);
}

/* --------------------------- notify panel ------------------------- */
function notifyPanel(c, refresh, empId) {
  const form = el('form.card-body');
  form.append(el('div.form-grid', {}, [
    field('ช่องทาง', select('channel', ['phone', 'line', 'sms', 'email', 'walk-in'], 'phone')),
    field('ผลการติดต่อ', select('result',
      [['reached', 'ติดต่อได้'], ['no_answer', 'ไม่รับสาย'], ['left_message', 'ฝากข้อความ'],
        ['wrong_number', 'เบอร์ผิด']], 'reached')),
    field('ผู้ติดต่อ', employeeSelect('contacted_by', '')),
  ]));
  form.append(el('div.field.full', {}, [
    el('label', { text: 'บันทึก' }), el('textarea', { name: 'note' })]));
  form.append(el('div.form-actions', {}, [
    el('button.btn', { type: 'submit', text: '+ บันทึกการติดต่อ' })]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post(`/api/cases/${c.id}/notify`, formData(form));
      ok('บันทึกแล้ว'); refresh();
    } catch (ex) { err(ex); }
  });

  return el('div.card', {}, [
    el('div.card-head', {}, [
      el('h2', { text: 'ประวัติการติดต่อลูกค้า' }),
      c.phone ? el('a.btn.btn-sm.btn-light', { href: 'tel:' + c.phone, text: '☎ ' + c.phone }) : null,
    ]),
    el('div.card-body.tight', {}, [table([
      { label: 'เมื่อ', render: (n) => fmtDateTime(n.contacted_at), cls: 'nowrap' },
      { label: 'ช่องทาง', key: 'channel' },
      { label: 'ผล', key: 'result' },
      { label: 'โดย', key: 'contacted_by_name' },
      { label: 'บันทึก', key: 'note' },
    ], c.notifications || [], { empty: 'ยังไม่เคยติดต่อ' })]),
    form,
  ]);
}

/* -------------------------- timeline panel ------------------------ */
function timelinePanel(c, refresh, empId) {
  const noteForm = el('form.card-body');
  noteForm.append(el('div.row', {}, [
    el('div.field.grow', {}, [
      el('label', { text: 'เพิ่มบันทึกลงไทม์ไลน์' }),
      input('note', { placeholder: 'พิมพ์บันทึก…', required: true }),
    ]),
    el('button.btn', { type: 'submit', text: '+ บันทึก' }),
  ]));
  noteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post(`/api/cases/${c.id}/note`,
        { ...formData(noteForm), employee_id: empId() });
      ok('บันทึกแล้ว'); refresh();
    } catch (ex) { err(ex); }
  });

  const items = (c.events || []).map((ev) => el('div.tl-item', {}, [
    el('div.tl-dot'),
    el('div.tl-body', {}, [
      el('div.tl-head', {}, [
        el('b', { text: ACTION_LABEL[ev.action] || ev.action }),
        ev.to_label ? el('span.badge.blue', { text: `→ ${ev.to_label}` }) : null,
        el('span.muted', { text: fmtDateTime(ev.created_at) }),
        ev.employee_name ? el('span.muted', { text: '· ' + ev.employee_name }) : null,
      ]),
      ev.note ? el('div.tl-note', { text: ev.note }) : null,
    ]),
  ]));

  return el('div.card', {}, [
    el('div.card-head', {}, [
      el('h2', { text: 'ไทม์ไลน์เคส' }),
      el('span.badge.gray', { text: `${(c.events || []).length} เหตุการณ์` }),
    ]),
    noteForm,
    el('div.card-body', {}, items.length
      ? [el('div.timeline', {}, items)]
      : [el('div.empty', { text: 'ยังไม่มีเหตุการณ์' })]),
  ]);
}

const ACTION_LABEL = {
  case_opened: 'เปิดเคส',
  status_change: 'เปลี่ยนสถานะ',
  note: 'บันทึก',
  prescription_added: 'บันทึกค่าสายตา',
  prescription_confirmed: 'ยืนยันค่าสายตา',
  order_created: 'เปิดออเดอร์',
  order_filled: 'เติมของเข้าออเดอร์',
  order_closed: 'ปิดการขาย',
  order_reopened: 'เปิดออเดอร์อีกครั้ง',
  payment: 'รับเงิน',
  payment_deleted: 'ลบรายการรับเงิน',
  lens_job_saved: 'บันทึกงานเลนส์',
  lens_followup: 'ติดตามเลนส์',
  lens_received: 'รับเลนส์เข้าร้าน',
  centering_saved: 'บันทึกจุดศูนย์กลาง',
  frame_fitting_saved: 'บันทึกการวัดกรอบ',
  production_saved: 'บันทึกงานผลิต',
  qc_pass: 'QC ผ่าน',
  qc_fail: 'QC ไม่ผ่าน',
  customer_notified: 'ติดต่อลูกค้า',
};

/* =========================== LENS TRACKER ========================== */
export async function lensTracker({ navigate, query }) {
  const wrap = el('div');
  wrap.append(pageHead('🔎', 'Lens Tracker', 'ติดตามเลนส์ที่สั่งซัพพลายเออร์', [
    el('a.btn.btn-ghost', { href: '#/cases', text: '← กระดานงาน' }),
  ]));

  const risk = select('risk', [['', 'ทุกระดับ'], ['late', 'เลย ETA'], ['soon', 'ใกล้ถึง'],
    ['ok', 'ปกติ']], query.risk || '');
  const threat = el('input', { type: 'checkbox' });
  const holder = el('div');

  async function run() {
    holder.replaceChildren(el('div.loading', {}, [el('span.spin'), ' กำลังโหลด…']));
    const rows = await api.get('/api/lens-tracker', {
      risk: risk.value, threatens: threat.checked ? 1 : '',
    });
    holder.replaceChildren(card(null, [table([
      { label: 'เคส', key: 'case_code', cls: 'mono' },
      {
        label: '', render: (r) => (r.is_rush
          ? el('span.badge.danger', { text: '🔥' }) : ''),
      },
      { label: 'ลูกค้า', render: custName },
      { label: 'เบอร์', key: 'phone', cls: 'nowrap' },
      { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
      { label: 'เลนส์', key: 'lens_name' },
      { label: 'ซัพพลายเออร์', key: 'supplier_name' },
      { label: 'เลขที่สั่ง', key: 'supplier_order_no' },
      { label: 'สั่งเมื่อ', render: (r) => fmtDate(r.order_date), cls: 'nowrap' },
      { label: 'ETA', render: (r) => fmtDate(r.expected_arrival), cls: 'nowrap' },
      {
        label: 'เหลือ (วัน)', cls: 'num',
        render: (r) => (r.days_to_eta === null ? '—' : String(r.days_to_eta)),
      },
      {
        label: 'ความเสี่ยง', render: (r) => el('span.badge', {
          class: r.risk_level === 'late' ? 'danger' : r.risk_level === 'soon' ? 'warn' : 'ok',
          text: r.risk_level,
        }),
      },
      { label: 'ตามแล้ว', key: 'follow_up_count', cls: 'num' },
      { label: 'วันนัด', render: (r) => fmtDate(r.appointment_date), cls: 'nowrap' },
      {
        label: 'กระทบนัด', render: (r) => (r.threatens_appointment
          ? el('span.badge.danger', { text: 'เสี่ยงเลื่อน' }) : ''),
      },
    ], rows, {
      onRowClick: (r) => navigate('#/cases/' + r.case_id),
      empty: 'ไม่มีเลนส์ที่กำลังรอ',
    })], { tight: true }));
  }
  risk.addEventListener('change', run);
  threat.addEventListener('change', run);

  wrap.append(el('div.toolbar', {}, [
    field('ระดับความเสี่ยง', risk),
    el('label.check', {}, [threat, ' เฉพาะที่กระทบวันนัด']),
    el('button.btn.btn-light', { text: '↻ รีเฟรช', onclick: run }),
  ]));
  wrap.append(holder);
  run();
  return wrap;
}
