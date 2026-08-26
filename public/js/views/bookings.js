/* Queue bookings — calendar, day view, booking detail, Telegram settings */
import {
  api, meta, el, frag, card, table, pageHead, field, input, select, listSelect,
  employeeSelect, formData, money, fmtDate, fmtDateTime, dateOnly, custName,
  ok, err, confirmDialog, picker, todayISO,
  addCustomerAction,
} from '../core.js';

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

const bk = () => meta.booking || {};
const labelOf = (list, code) =>
  ((list || []).find(([c]) => c === code) || [null, code])[1];
const serviceLabel = (c) => labelOf(bk().service_types, c);
const statusLabel = (c) => labelOf(bk().statuses, c);
const channelLabel = (c) => labelOf(bk().channels, c);

const STATUS_CLASS = {
  booked: 'blue', confirmed: 'blue', arrived: 'warn', in_service: 'warn',
  done: 'ok', no_show: 'danger', cancelled: 'gray',
};
const statusBadge = (b) =>
  el('span.badge', { class: STATUS_CLASS[b.status] || 'gray', text: statusLabel(b.status) });

const hhmm = (t) => String(t || '').slice(0, 5);
const bookingName = (b) =>
  [b.first_name, b.last_name].filter(Boolean).join(' ') || '(ไม่ระบุชื่อ)';

/* ============================== CALENDAR =========================== */
const TH_MON_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const iso = (y, m, d) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const addDays = (isoStr, n) => {
  const [y, m, d] = isoStr.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return iso(t.getFullYear(), t.getMonth() + 1, t.getDate());
};
/* วันอาทิตย์เป็นวันแรกของสัปดาห์ ให้ตรงกับหัวตาราง TH_DOW */
const weekStart = (isoStr) => {
  const [y, m, d] = isoStr.split('-').map(Number);
  return addDays(isoStr, -new Date(y, m - 1, d).getDay());
};

export async function bookingCalendar({ navigate, query }) {
  const wrap = el('div');
  let month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : todayISO().slice(0, 7);
  let selected = query.date || todayISO();
  let view = ['week', 'month', 'year'].includes(query.view) ? query.view : 'month';

  wrap.append(pageHead('📅', 'Queue Booking', 'ปฏิทินจองคิวลูกค้า', [
    el('a.btn.btn-ghost', { href: '#/bookings/new', text: '+ จองคิวใหม่' }),
    el('a.btn.btn-ghost', { href: '#/settings', text: '⚙️ ตั้งค่าแจ้งเตือน' }),
  ]));

  const calBox = el('div');
  const dayBox = el('div');

  const shiftMonth = (delta) => {
    const [y, m] = month.split('-').map(Number);
    const t = new Date(y, m - 1 + delta, 1);
    month = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
    drawCalendar();
  };
  const shift = (delta) => {
    if (view === 'year') { month = `${Number(month.slice(0, 4)) + delta}-${month.slice(5)}`; drawCalendar(); }
    else if (view === 'week') { selected = addDays(selected, delta * 7); month = selected.slice(0, 7); drawCalendar(); drawDay(); }
    else shiftMonth(delta);
  };
  const goToday = () => {
    month = todayISO().slice(0, 7);
    selected = todayISO();
    drawCalendar(); drawDay();
  };
  const setView = (v) => { view = v; drawCalendar(); };
  const pickDay = (d) => { selected = d; month = d.slice(0, 7); drawCalendar(); drawDay(); };

  /* ---------------- แถบหัว: ชื่อช่วงเวลา + เลื่อน + สลับมุมมอง ---------------- */
  function calHead() {
    const [y, m] = month.split('-').map(Number);
    let title;
    if (view === 'year') title = String(y + 543);
    else if (view === 'week') {
      const s = weekStart(selected), e = addDays(s, 6);
      const sm = Number(s.slice(5, 7)), em = Number(e.slice(5, 7));
      title = sm === em
        ? `${Number(s.slice(8))} – ${Number(e.slice(8))} ${TH_MONTHS[sm - 1]} ${Number(s.slice(0, 4)) + 543}`
        : `${Number(s.slice(8))} ${TH_MON_SHORT[sm - 1]} – ${Number(e.slice(8))} ${TH_MON_SHORT[em - 1]} ${Number(e.slice(0, 4)) + 543}`;
    } else title = `${TH_MONTHS[m - 1]} ${y + 543}`;

    const viewBtn = (v, label) => el('button.cal-vbtn', {
      type: 'button', class: view === v ? 'active' : '',
      text: label, onclick: () => setView(v),
    });

    return el('div.cal-head', {}, [
      el('h2.cal-title', { text: title }),
      el('div.cal-nav', {}, [
        el('button.cal-arrow', { type: 'button', title: 'ก่อนหน้า', text: '‹', onclick: () => shift(-1) }),
        el('button.cal-arrow', { type: 'button', title: 'ถัดไป', text: '›', onclick: () => shift(1) }),
      ]),
      el('button.cal-today', { type: 'button', text: 'วันนี้', onclick: goToday }),
      el('div.cal-views', {}, [
        viewBtn('week', 'สัปดาห์'), viewBtn('month', 'เดือน'), viewBtn('year', 'ปี'),
      ]),
    ]);
  }

  const dowRow = (cls = '') =>
    el('div.cal-grid.cal-dow', { class: cls }, TH_DOW.map((d, i) =>
      el('div.cal-dowcell', { class: i === 0 ? 'sun' : '', text: d })));

  /* แถบคิวหนึ่งรายการในช่องวัน — เวลา + ชื่อลูกค้า สีตามสถานะ */
  const pill = (b) => el('div.cal-ev', {
    class: STATUS_CLASS[b.status] || 'gray',
    title: `${hhmm(b.booking_time)} ${bookingName(b)} · ${statusLabel(b.status)}`,
    onclick: (e) => { e.stopPropagation(); navigate('#/bookings/' + b.id); },
  }, [
    el('span.cal-ev-t', { text: hhmm(b.booking_time) }),
    el('span.cal-ev-n', { text: bookingName(b) }),
  ]);

  /* ช่องวันหนึ่งช่องในมุมมองเดือน/สัปดาห์ */
  function dayCell(dIso, curMonth, list, today) {
    const [yy, mm, dd] = dIso.split('-').map(Number);
    const dow = new Date(yy, mm - 1, dd).getDay();
    const evs = list.slice(0, 3);
    const more = list.length - evs.length;
    return el('div.cal-cell', {
      class: [
        dIso.slice(0, 7) !== curMonth ? 'out' : '',
        dIso === today ? 'today' : '',
        dIso === selected ? 'selected' : '',
        dow === 0 || dow === 6 ? 'weekend' : '',
      ].filter(Boolean).join(' '),
      onclick: () => pickDay(dIso),
    }, [
      el('div.cal-date', { text: String(Number(dIso.slice(8))) }),
      el('div.cal-evs', {}, [
        ...evs.map(pill),
        more > 0 ? el('div.cal-more', { text: `+ อีก ${more} คิว` }) : null,
      ]),
    ]);
  }

  async function drawCalendar() {
    calBox.replaceChildren(el('div.card', {}, [
      el('div.card-body', {}, [el('div.loading', {}, [el('span.spin'), ' กำลังโหลดปฏิทิน…'])]),
    ]));
    const today = todayISO();
    const [y, m] = month.split('-').map(Number);

    if (view === 'year') {
      const { days } = await api.get('/api/bookings/calendar',
        { from: iso(y, 1, 1), to: iso(y, 12, 31) });
      const byDate = Object.fromEntries(days.map((d) => [dateOnly(d.d), Number(d.total)]));
      const months = [];
      for (let mm = 1; mm <= 12; mm++) {
        const lead = new Date(y, mm - 1, 1).getDay();
        const len = new Date(y, mm, 0).getDate();
        const cells = [];
        for (let i = 0; i < lead; i++) cells.push(el('div.mini-d.blank'));
        for (let d = 1; d <= len; d++) {
          const dIso = iso(y, mm, d);
          const n = byDate[dIso] || 0;
          cells.push(el('div.mini-d', {
            class: [
              dIso === today ? 'today' : '',
              new Date(y, mm - 1, d).getDay() === 0 ? 'sun' : '',
              n ? 'has' : '',
            ].filter(Boolean).join(' '),
            title: n ? `${n} คิว` : '',
            onclick: (e) => { e.stopPropagation(); view = 'month'; pickDay(dIso); },
          }, [String(d)]));
        }
        months.push(el('div.mini-month', {
          onclick: () => { month = `${y}-${String(mm).padStart(2, '0')}`; view = 'month'; drawCalendar(); },
        }, [
          el('div.mini-name', { class: mm === Number(todayISO().slice(5, 7)) && y === Number(todayISO().slice(0, 4)) ? 'now' : '', text: TH_MON_SHORT[mm - 1] }),
          el('div.mini-dow', {}, TH_DOW.map((d, i) => el('span', { class: i === 0 ? 'sun' : '', text: d }))),
          el('div.mini-grid', {}, cells),
        ]));
      }
      calBox.replaceChildren(el('div.card', {}, [
        el('div.card-body', {}, [calHead(), el('div.year-grid', {}, months),
          el('p.hint', { text: 'กดชื่อเดือนเพื่อเปิดเดือนนั้น หรือกดวันที่เพื่อไปที่วันนั้นเลย · วันที่มีจุดคือมีคิวจองอยู่' })]),
      ]));
      return;
    }

    /* มุมมองเดือน / สัปดาห์ — ดึงคิวจริงมาแสดงเป็นแถบสี */
    const from = view === 'week' ? weekStart(selected) : weekStart(iso(y, m, 1));
    const cellCount = view === 'week' ? 7 : 42;
    const to = addDays(from, cellCount - 1);
    const rows = await api.get('/api/bookings', { from, to, limit: 1000 });
    const byDate = {};
    for (const b of rows) (byDate[dateOnly(b.booking_date)] ||= []).push(b);

    const cells = [];
    for (let i = 0; i < cellCount; i++) {
      const dIso = addDays(from, i);
      cells.push(dayCell(dIso, month, byDate[dIso] || [], today));
    }

    calBox.replaceChildren(el('div.card', {}, [
      el('div.card-body', {}, [
        calHead(),
        dowRow(),
        el('div.cal-grid', { class: view === 'week' ? 'cal-week' : '' }, cells),
        el('div.cal-legend', {}, [
          el('span', {}, [el('i.dot.blue'), 'รอมา']),
          el('span', {}, [el('i.dot.warn'), 'มาถึง/กำลังบริการ']),
          el('span', {}, [el('i.dot.ok'), 'เสร็จสิ้น']),
          el('span', {}, [el('i.dot.danger'), 'ไม่มาตามนัด']),
        ]),
      ]),
    ]));
  }

  async function drawDay() {
    dayBox.replaceChildren(el('div.loading', {}, [el('span.spin'), ' กำลังโหลดคิว…']));
    const rows = await api.get('/api/bookings', { date: selected, limit: 200 });
    dayBox.replaceChildren(el('div.card', {}, [
      el('div.card-head', {}, [
        el('h2', { text: 'คิววันที่ ' + fmtDate(selected) }),
        el('span.badge.gray', { text: `${rows.length} คิว` }),
        el('div.right', {}, [
          el('a.btn.btn-sm.btn-accent', {
            href: `#/bookings/new?date=${selected}`, text: '+ จองคิววันนี้',
          }),
        ]),
      ]),
      el('div.card-body.tight', {}, [table([
        { label: 'เวลา', render: (b) => el('b', { text: hhmm(b.booking_time) }), cls: 'nowrap' },
        { label: 'ระยะ', render: (b) => b.duration_min + ' น.', cls: 'num' },
        { label: 'รหัส', key: 'booking_code', cls: 'mono' },
        { label: 'ลูกค้า', render: bookingName },
        { label: 'เบอร์โทร', key: 'phone', cls: 'nowrap' },
        { label: 'บริการ', render: (b) => serviceLabel(b.service_type) },
        { label: 'ช่องทาง', render: (b) => channelLabel(b.channel) },
        { label: 'ผู้ดูแล', key: 'assigned_name' },
        { label: 'สถานะ', render: statusBadge },
        {
          label: 'แจ้งเตือน', render: (b) => (b.reminder_sent_at
            ? el('span.badge.ok', { text: '✓ ส่งแล้ว' })
            : el('span.muted', { text: `ก่อน ${b.reminder_minutes} น.` })),
        },
        { label: 'บันทึกเบื้องต้น', render: (b) => (b.intake_note || '').slice(0, 60) },
        {
          label: '', cls: 'nowrap', render: (b) => (b.case_id
            ? el('a.btn.btn-sm.btn-light', { href: '#/cases/' + b.case_id, text: '🗂 ' + b.case_code })
            : el('span.muted', { text: '—' })),
        },
      ], rows, {
        onRowClick: (b) => navigate('#/bookings/' + b.id),
        empty: 'ยังไม่มีคิวในวันนี้',
      })]),
    ]));
  }

  wrap.append(calBox, dayBox);
  await drawCalendar();
  drawDay();
  return wrap;
}

/* ============================ BOOKING FORM ========================= */
export async function bookingForm({ params, query, navigate }) {
  const editing = !!params.id;
  const b = editing ? await api.get('/api/bookings/' + params.id) : {};
  let customer = null;
  if (editing && b.customer_id) customer = await api.get('/api/customers/' + b.customer_id);
  else if (query.customer) customer = await api.get('/api/customers/' + query.customer);

  const chosen = el('div.card-body');
  const newFields = el('div.form-grid');
  const drawChosen = () => {
    chosen.replaceChildren(customer
      ? el('div.row', {}, [
        el('span.badge.blue', { text: '#' + customer.id }),
        el('b', { text: custName(customer) }),
        el('span.muted', { text: customer.phone || '' }),
        el('button.btn.btn-sm.btn-light', {
          type: 'button', text: '✕ ล้าง',
          onclick: () => { customer = null; drawChosen(); },
        }),
      ])
      : el('span.muted', { text: 'ลูกค้าใหม่ — กรอกชื่อ/เบอร์ด้านล่างได้เลย' }));
    newFields.style.display = customer ? 'none' : '';
  };

  newFields.append(
    field('ชื่อ', input('first_name', { value: b.customer_id ? '' : (b.first_name || '') })),
    field('นามสกุล', input('last_name', { value: b.customer_id ? '' : (b.last_name || '') })),
    field('เบอร์โทร', input('phone', { value: b.customer_id ? '' : (b.phone || '') })),
  );
  drawChosen();

  const pick = picker({
    placeholder: 'ค้นหาลูกค้าเดิม (ชื่อ / เบอร์โทร / รหัส)',
    fetcher: (q) => api.get('/api/customers', { q, limit: 40 }),
    // ค้นไม่เจอ = ลูกค้าใหม่ ให้เพิ่มได้ตรงนั้นเลย ไม่ต้องทิ้งฟอร์มที่กรอกค้างไว้
    emptyAction: addCustomerAction(),
    label: custName,
    sub: (r) => r.phone || '',
    onPick: (r) => { customer = r; drawChosen(); },
  });

  const defaultReminder = Number(meta.lists?.reminder_default_minutes) || 10;
  const form = el('form');
  form.append(card('รายละเอียดการจอง', [
    el('div.form-grid', {}, [
      field('วันที่จอง *', input('booking_date', {
        type: 'date', required: true,
        value: dateOnly(b.booking_date) || query.date || todayISO(1),
      })),
      field('เวลา *', input('booking_time', {
        type: 'time', required: true, value: hhmm(b.booking_time) || '10:00',
      })),
      field('ใช้เวลาประมาณ (นาที)', input('duration_min', {
        type: 'number', min: '5', step: '5', value: b.duration_min ?? 30,
      })),
      field('บริการที่ต้องการ', select('service_type',
        (bk().service_types || []).map(([c, l]) => [c, l]), b.service_type || 'eye_exam')),
      field('จองผ่านช่องทาง', select('channel',
        (bk().channels || []).map(([c, l]) => [c, l]), b.channel || 'phone')),
      field('พนักงานผู้ดูแล', employeeSelect('assigned_to', b.assigned_to || '')),
      field('แจ้งเตือนล่วงหน้า (นาที)', input('reminder_minutes', {
        type: 'number', min: '0', max: '1440',
        value: b.reminder_minutes ?? defaultReminder,
      }), 'ส่งเข้า Telegram ก่อนถึงคิว · ใส่ 0 = ไม่แจ้ง'),
    ]),
    el('div.field.full', {}, [
      el('label', { text: 'หมายเหตุอื่น ๆ' }),
      el('textarea', { name: 'notes', text: b.notes || '' }),
    ]),
  ]));

  form.append(el('div.form-actions', {}, [
    el('button.btn.btn-lg', { type: 'submit', text: editing ? '💾 บันทึกการแก้ไข' : '✔ บันทึกการจอง' }),
    el('a.btn.btn-light', {
      href: editing ? '#/bookings/' + b.id : '#/bookings', text: 'ยกเลิก',
    }),
  ]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const body = { ...formData(form), customer_id: customer ? customer.id : null };
      if (customer) {
        // ข้อมูลลูกค้ามาจากทะเบียนลูกค้าแล้ว ไม่ต้องเก็บซ้ำในใบจอง
        body.first_name = null; body.last_name = null; body.phone = null; body.line_id = null;
      }
      const saved = editing
        ? await api.put('/api/bookings/' + b.id, body)
        : await api.post('/api/bookings', body);
      ok(editing ? 'บันทึกแล้ว' : 'จองคิว ' + saved.booking_code + ' เรียบร้อย');
      navigate('#/bookings/' + saved.id);
    } catch (ex) { err(ex); }
  });

  return frag([
    pageHead('📅', editing ? 'Edit Booking' : 'New Booking',
      editing ? 'แก้ไขการจองคิว' : 'จองคิวลูกค้า'),
    el('div.split', {}, [
      el('div.card', {}, [
        el('div.card-head', {}, [el('h2', { text: 'ลูกค้าเดิม (ถ้ามี)' })]),
        el('div.card-body', {}, [pick.node]),
      ]),
      el('div.card', {}, [
        el('div.card-head', {}, [el('h2', { text: 'ลูกค้าที่จอง' })]),
        chosen,
        el('div.card-body', { style: 'padding-top:0' }, [newFields]),
      ]),
    ]),
    form,
  ]);
}

/* =========================== BOOKING DETAIL ======================== */
export async function bookingDetail({ params, navigate, refresh }) {
  const b = await api.get('/api/bookings/' + params.id);
  const wrap = el('div');
  const actor = employeeSelect('actor', b.assigned_to || '');
  const empId = () => Number(actor.value) || null;

  wrap.append(pageHead('📅', b.booking_code, bookingName(b), [
    b.case_id
      ? el('a.btn.btn-ghost', { href: '#/cases/' + b.case_id, text: '🗂 ' + b.case_code })
      : null,
    el('a.btn.btn-ghost', { href: '#/bookings/' + b.id + '/edit', text: '✎ แก้ไข' }),
    el('a.btn.btn-ghost', { href: `#/bookings?date=${dateOnly(b.booking_date)}`, text: '← ปฏิทิน' }),
  ]));

  /* summary + status actions */
  const setStatus = async (status, extra = {}) => {
    try {
      await api.post(`/api/bookings/${b.id}/status`, { status, employee_id: empId(), ...extra });
      ok('อัปเดตสถานะแล้ว'); refresh();
    } catch (ex) { err(ex); }
  };

  wrap.append(el('div.split', {}, [
    card('ข้อมูลการจอง', [
      el('div.row', { style: 'margin-bottom:12px' }, [
        statusBadge(b),
        b.reminder_sent_at
          ? el('span.badge.ok', { text: '🔔 แจ้งเตือนแล้ว ' + fmtDateTime(b.reminder_sent_at) })
          : el('span.badge.gray', { text: `🔔 จะแจ้งก่อน ${b.reminder_minutes} นาที` }),
      ]),
      el('dl.kv', {}, [
        el('dt', { text: 'วันเวลา' }),
        el('dd', {}, [el('b', { text: `${fmtDate(b.booking_date)} เวลา ${hhmm(b.booking_time)} น.` })]),
        el('dt', { text: 'ใช้เวลา' }), el('dd', { text: b.duration_min + ' นาที' }),
        el('dt', { text: 'บริการ' }), el('dd', { text: serviceLabel(b.service_type) }),
        el('dt', { text: 'ช่องทางจอง' }), el('dd', { text: channelLabel(b.channel) }),
        el('dt', { text: 'ลูกค้า' }), el('dd', {}, [
          b.customer_id
            ? el('a', { href: '#/customers/' + b.customer_id, text: bookingName(b) })
            : bookingName(b) + ' (ลูกค้าใหม่)',
        ]),
        el('dt', { text: 'เบอร์โทร' }), el('dd', { text: b.phone || '-' }),
        el('dt', { text: 'LINE' }), el('dd', { text: b.line_id || '-' }),
        el('dt', { text: 'ผู้ดูแล' }), el('dd', { text: b.assigned_name || '-' }),
        el('dt', { text: 'ผู้รับจอง' }), el('dd', { text: b.created_by_name || '-' }),
        el('dt', { text: 'ยืนยันเมื่อ' }), el('dd', { text: fmtDateTime(b.confirmed_at) || '-' }),
        el('dt', { text: 'มาถึงเมื่อ' }), el('dd', { text: fmtDateTime(b.arrived_at) || '-' }),
        b.cancelled_reason ? el('dt', { text: 'เหตุผล' }) : null,
        b.cancelled_reason ? el('dd', { text: b.cancelled_reason }) : null,
        el('dt', { text: 'หมายเหตุ' }), el('dd', { text: b.notes || '-' }),
      ]),
      b.intake_note
        ? el('div', { style: 'margin-top:12px' }, [
          el('label', { text: 'บันทึกเบื้องต้น' }),
          el('p', { style: 'white-space:pre-wrap;margin:4px 0 0', text: b.intake_note }),
        ]) : null,
    ]),
    el('div.stack', {}, [
      card('การจัดการคิว', [
        el('div.form-grid', {}, [field('ผู้ทำรายการ', actor)]),
        el('div.row', { style: 'margin-top:12px' }, [
          b.status === 'booked' ? el('button.btn.btn-sm.btn-accent', {
            text: '✔ ยืนยันคิว', onclick: () => setStatus('confirmed'),
          }) : null,
          ['booked', 'confirmed'].includes(b.status) ? el('button.btn.btn-sm.btn-ok', {
            text: '🚶 ลูกค้ามาถึง', onclick: () => setStatus('arrived'),
          }) : null,
          !b.case_id && ['arrived', 'confirmed', 'booked'].includes(b.status)
            ? el('button.btn.btn-sm', {
              text: '🗂 เปิดเคสให้ลูกค้า',
              onclick: async () => {
                if (!await confirmDialog('เปิดเคส',
                  b.customer_id
                    ? `เปิดเคสใหม่ให้ ${bookingName(b)}?`
                    : `ระบบจะสร้างลูกค้าใหม่ "${bookingName(b)}" แล้วเปิดเคสให้`,
                  { confirmText: 'เปิดเคส' })) return;
                try {
                  const r = await api.post(`/api/bookings/${b.id}/open-case`,
                    { received_by: empId() });
                  ok('เปิดเคส ' + r.caseCode + ' แล้ว');
                  navigate('#/cases/' + r.caseId);
                } catch (ex) { err(ex); }
              },
            }) : null,
          b.status !== 'done' ? el('button.btn.btn-sm.btn-light', {
            text: '✅ เสร็จสิ้น', onclick: () => setStatus('done'),
          }) : null,
          !['cancelled', 'no_show', 'done'].includes(b.status) ? el('button.btn.btn-sm.btn-light', {
            text: '👻 ไม่มาตามนัด',
            onclick: async () => {
              if (!await confirmDialog('ไม่มาตามนัด', 'บันทึกว่าลูกค้าไม่มาตามนัด?',
                { confirmText: 'บันทึก' })) return;
              setStatus('no_show');
            },
          }) : null,
          !['cancelled'].includes(b.status) ? el('button.btn.btn-sm.btn-danger', {
            text: '✕ ยกเลิกคิว',
            onclick: async () => {
              if (!await confirmDialog('ยกเลิกคิว', `ยกเลิกการจอง ${b.booking_code}?`,
                { confirmText: 'ยกเลิกคิว', danger: true })) return;
              setStatus('cancelled');
            },
          }) : null,
        ]),
        el('hr', { style: 'border:0;border-top:1px solid var(--line-soft);margin:14px 0' }),
        el('div.row', {}, [
          el('button.btn.btn-sm.btn-light', {
            text: '🔔 ส่งแจ้งเตือน Telegram เดี๋ยวนี้',
            onclick: async (e) => {
              e.target.disabled = true;
              try { await api.post(`/api/bookings/${b.id}/remind`); ok('ส่งแล้ว'); refresh(); }
              catch (ex) { err(ex); e.target.disabled = false; }
            },
          }),
          !b.case_id ? el('button.btn.btn-sm.btn-light', {
            text: '🗑 ลบการจอง',
            onclick: async () => {
              if (!await confirmDialog('ลบการจอง', `ลบ ${b.booking_code} ถาวร?`,
                { confirmText: 'ลบ', danger: true })) return;
              try {
                await api.del('/api/bookings/' + b.id);
                ok('ลบแล้ว'); navigate('#/bookings');
              } catch (ex) { err(ex); }
            },
          }) : null,
        ]),
        b.notifications && b.notifications.length
          ? el('div', { style: 'margin-top:12px' }, [
            el('label', { text: 'ประวัติการแจ้งเตือน' }),
            el('div.stack', { style: 'gap:4px;margin-top:5px' }, b.notifications.map((n) =>
              el('div.row', { style: 'font-size:12.5px' }, [
                n.ok ? el('span.badge.ok', { text: '✓' }) : el('span.badge.danger', { text: '✕' }),
                el('span.muted', { text: fmtDateTime(n.created_at) }),
                el('span.muted', { text: n.kind }),
                n.error ? el('span', { style: 'color:var(--danger)', text: n.error }) : null,
              ]))),
          ]) : null,
      ]),
    ]),
  ]));

  /* step notes */
  const noteForm = el('form.card-body');
  noteForm.append(el('div.form-grid', {}, [
    field('ขั้นตอน', select('step',
      [['intake', 'รับจอง / สอบถาม'], ['confirm', 'ยืนยันคิว'], ['arrive', 'ลูกค้ามาถึง'],
        ['handoff', 'ส่งต่อให้ฝ่ายขาย'], ['followup', 'ติดตามผล'], ['other', 'อื่น ๆ']],
      'intake')),
    field('หัวข้อ / คำถาม', input('question', { placeholder: 'เช่น อาการที่พบ' })),
    field('ผู้บันทึก', employeeSelect('recorded_by', b.assigned_to || '')),
  ]));
  noteForm.append(el('div.field.full', {}, [
    el('label', { text: 'บันทึก *' }),
    el('textarea', { name: 'note', required: true, placeholder: 'สิ่งที่ลูกค้าบอก / สิ่งที่ต้องเตรียม' }),
  ]));
  noteForm.append(el('div.form-actions', {}, [
    el('button.btn', { type: 'submit', text: '+ เพิ่มบันทึก' }),
  ]));
  noteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post(`/api/bookings/${b.id}/notes`, formData(noteForm));
      ok('บันทึกแล้ว'); refresh();
    } catch (ex) { err(ex); }
  });

  const STEP_LABEL = {
    intake: 'รับจอง / สอบถาม', confirm: 'ยืนยันคิว', arrive: 'ลูกค้ามาถึง',
    handoff: 'ส่งต่อฝ่ายขาย', followup: 'ติดตามผล', other: 'อื่น ๆ',
  };
  wrap.append(el('div.card', {}, [
    el('div.card-head', {}, [
      el('h2', { text: 'บันทึกเบื้องต้นทีละขั้นตอน' }),
      el('span.badge.gray', { text: `${(b.step_notes || []).length} รายการ` }),
    ]),
    el('div.card-body.tight', {}, [table([
      { label: 'เมื่อ', render: (n) => fmtDateTime(n.created_at), cls: 'nowrap' },
      {
        label: 'ขั้นตอน',
        render: (n) => el('span.badge.blue', { text: STEP_LABEL[n.step] || n.step }),
      },
      { label: 'หัวข้อ/คำถาม', key: 'question' },
      { label: 'บันทึก', key: 'note' },
      { label: 'ผู้บันทึก', key: 'recorded_by_name' },
      {
        label: '', cls: 'nowrap', render: (n) => el('button.btn.btn-sm.btn-light', {
          text: '🗑',
          onclick: async () => {
            try {
              await api.del(`/api/bookings/${b.id}/notes/${n.id}`);
              ok('ลบแล้ว'); refresh();
            } catch (ex) { err(ex); }
          },
        }),
      },
    ], b.step_notes || [], { empty: 'ยังไม่มีบันทึก' })]),
    noteForm,
  ]));

  return wrap;
}

/* ============================== SETTINGS =========================== */
export async function settingsView({ refresh }) {
  const s = await api.get('/api/settings');
  const wrap = el('div');
  wrap.append(pageHead('⚙️', 'Settings', 'ตั้งค่าระบบแจ้งเตือน'));

  const form = el('form.card-body');
  const enabled = input('telegram_enabled', {
    type: 'checkbox', checked: s.telegram_enabled === '1',
  });
  const token = input('telegram_bot_token', {
    value: s.telegram_bot_token || '',
    placeholder: '123456789:AAF...',
    disabled: s.telegram_token_from_env,
  });
  const chat = input('telegram_chat_id', {
    value: s.telegram_chat_id || '', placeholder: '-1001234567890 หรือ 123456789',
  });

  form.append(el('div.form-grid', {}, [
    el('div.field.full', {}, [
      el('label', { text: 'เปิดใช้งาน' }),
      el('label.check', {}, [enabled, ' ส่งแจ้งเตือนคิวเข้า Telegram']),
    ]),
    el('div.field.full', {}, [
      el('label', { text: 'Bot Token' }), token,
      el('div.hint', {
        text: s.telegram_token_from_env
          ? 'กำหนดผ่าน environment variable TELEGRAM_BOT_TOKEN อยู่ — แก้ที่นี่ไม่ได้'
          : 'ได้จาก @BotFather ใน Telegram (คำสั่ง /newbot)',
      }),
    ]),
    el('div.field.full', {}, [
      el('label', { text: 'Chat ID (กลุ่มหรือคนที่จะรับแจ้งเตือน)' }), chat,
      el('div.hint', { text: 'ชวนบอทเข้ากลุ่มร้าน แล้วดู chat id ได้จาก @userinfobot หรือ @getidsbot' }),
    ]),
    field('แจ้งเตือนล่วงหน้าปริยาย (นาที)', input('reminder_default_minutes', {
      type: 'number', min: '0', max: '1440', value: s.reminder_default_minutes || 10,
    })),
    field('ชื่อร้าน', input('shop_name', { value: s.shop_name || '' })),
    field('เวลาเปิดร้าน', input('shop_open_time', { type: 'time', value: s.shop_open_time || '10:00' })),
    field('เวลาปิดร้าน', input('shop_close_time', { type: 'time', value: s.shop_close_time || '20:00' })),
  ]));
  form.append(el('div.form-actions', {}, [
    el('button.btn.btn-lg', { type: 'submit', text: '💾 บันทึกการตั้งค่า' }),
    el('button.btn.btn-light', {
      type: 'button', text: '🧪 ทดสอบส่งข้อความ',
      onclick: async (e) => {
        e.target.disabled = true;
        try {
          const r = await api.post('/api/settings/telegram/test', {
            telegram_bot_token: token.value, telegram_chat_id: chat.value,
          });
          ok(`ส่งสำเร็จ! บอท @${r.bot.username}`);
          refresh();
        } catch (ex) { err(ex); } finally { e.target.disabled = false; }
      },
    }),
    el('button.btn.btn-light', {
      type: 'button', text: '⏱ รันตัวเตือนเดี๋ยวนี้',
      onclick: async () => {
        try {
          const r = await api.post('/api/reminders/run');
          ok(r.skipped ? r.skipped : `ตรวจ ${r.checked} คิว · ส่ง ${r.sent} ข้อความ`);
          refresh();
        } catch (ex) { err(ex); }
      },
    }),
  ]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const body = formData(form);
      body.telegram_enabled = enabled.checked ? '1' : '0';
      if (s.telegram_token_from_env) delete body.telegram_bot_token;
      await api.put('/api/settings', body);
      ok('บันทึกการตั้งค่าแล้ว');
      refresh();
    } catch (ex) { err(ex); }
  });

  wrap.append(el('div.card', {}, [
    el('div.card-head', {}, [
      el('h2', { text: 'Telegram' }),
      s.telegram_configured
        ? el('span.badge.ok', { text: 'ตั้งค่าแล้ว' })
        : el('span.badge.warn', { text: 'ยังไม่ได้ตั้งค่า' }),
      s.telegram_enabled === '1'
        ? el('span.badge.blue', { text: 'เปิดใช้งาน' })
        : el('span.badge.gray', { text: 'ปิดอยู่' }),
    ]),
    form,
  ]));

  wrap.append(card('วิธีตั้งค่า Telegram', [
    el('ol', { style: 'margin:0;padding-left:20px;line-height:1.9' }, [
      el('li', { text: 'เปิด Telegram ค้นหา @BotFather แล้วพิมพ์ /newbot ตั้งชื่อบอท' }),
      el('li', { text: 'BotFather จะให้ Bot Token มา — ก็อปมาวางในช่องด้านบน' }),
      el('li', { text: 'สร้างกลุ่มของร้าน (เช่น "TimeOptic คิวลูกค้า") แล้วเชิญบอทเข้ากลุ่ม' }),
      el('li', { text: 'เชิญ @getidsbot เข้ากลุ่มเพื่อดู Chat ID (ของกลุ่มจะขึ้นต้นด้วย -100) แล้วเตะออกได้' }),
      el('li', { text: 'วาง Chat ID ติ๊กเปิดใช้งาน → บันทึก → กดปุ่มทดสอบ' }),
    ]),
  ]));

  const logs = await api.get('/api/notifications', { limit: 50 });
  wrap.append(card('ประวัติการแจ้งเตือนล่าสุด', [table([
    { label: 'เมื่อ', render: (n) => fmtDateTime(n.created_at), cls: 'nowrap' },
    { label: 'ประเภท', key: 'kind' },
    { label: 'การจอง', key: 'booking_code', cls: 'mono' },
    {
      label: 'ผล',
      render: (n) => (n.ok
        ? el('span.badge.ok', { text: 'สำเร็จ' })
        : el('span.badge.danger', { text: 'ไม่สำเร็จ' })),
    },
    { label: 'ข้อผิดพลาด', key: 'error' },
  ], logs, { empty: 'ยังไม่มีการแจ้งเตือน' })], { tight: true }));

  return wrap;
}
