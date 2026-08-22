/* Income / Expense — entry form + history in one page (as in the Access menus) */
import {
  api, el, frag, card, table, pageHead, field, input, listSelect, formData,
  money, fmtDate, ok, err, confirmDialog, todayISO,
} from '../core.js';

function ledgerView({ title, subtitle, icon, endpoint, typeKey, typeList, withPayType }) {
  return async function view({ refresh, query }) {
    const wrap = el('div');
    wrap.append(pageHead(icon, title, subtitle));

    /* ---- entry form ---- */
    const form = el('form.card-body');
    form.append(el('div.form-grid', {}, [
      field('วันที่ / CFDate', input('cf_date', { type: 'date', value: todayISO(), required: true })),
      field(typeKey === 'income_type' ? 'ประเภทรายรับ / IncomeType' : 'ประเภทรายจ่าย / ExpenseType',
        listSelect(typeKey, typeList, '')),
      field('สาขา / Branch', listSelect('branch', 'branch', 'Timeoptic')),
      field('จำนวนเงิน / Amount', input('amount', { type: 'number', step: '1', min: '0', value: 0, required: true })),
      withPayType ? field('ชำระด้วย / PayType', listSelect('pay_type', 'pay_type', 'Cash')) : null,
      el('div.field.full', {}, [
        el('label', { text: 'หมายเหตุ / Notes' }),
        el('textarea', { name: 'notes' }),
      ]),
    ]));
    form.append(el('div.form-actions', {}, [
      el('button.btn.btn-lg', { type: 'submit', text: '✔ Enter — บันทึก' }),
    ]));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api.post(endpoint, formData(form)); ok('บันทึกแล้ว'); refresh(); }
      catch (ex) { err(ex); }
    });
    wrap.append(el('div.card', {}, [
      el('div.card-head', {}, [el('h2', { text: 'บันทึกรายการใหม่' })]), form,
    ]));

    /* ---- history ---- */
    const search = el('input', { type: 'search', placeholder: 'ประเภท / สาขา / หมายเหตุ', value: query.q || '' });
    const from = el('input', { type: 'date', value: query.from || '' });
    const to = el('input', { type: 'date', value: query.to || '' });
    const holder = el('div');
    let timer = null;

    async function run() {
      holder.replaceChildren(el('div.loading', {}, [el('span.spin'), ' กำลังโหลด…']));
      const { rows, total } = await api.get(endpoint, {
        q: search.value.trim(), from: from.value, to: to.value, limit: 500,
      });
      const cols = [
        { label: 'ID', key: 'id', cls: 'mono' },
        { label: 'วันที่', render: (r) => fmtDate(r.cf_date), cls: 'nowrap' },
        { label: 'ประเภท', key: typeKey },
        { label: 'สาขา', key: 'branch' },
        { label: 'จำนวนเงิน', render: (r) => money(r.amount), cls: 'num' },
      ];
      if (withPayType) cols.push({ label: 'ชำระ', key: 'pay_type' });
      cols.push({ label: 'หมายเหตุ', key: 'notes' });
      cols.push({
        label: '', cls: 'nowrap', render: (r) => el('button.btn.btn-sm.btn-light', {
          text: '🗑', onclick: async () => {
            if (!await confirmDialog('ลบรายการ', `ลบรายการ #${r.id} (${money(r.amount)})?`,
              { confirmText: 'ลบ', danger: true })) return;
            try { await api.del(`${endpoint}/${r.id}`); ok('ลบแล้ว'); run(); }
            catch (ex) { err(ex); }
          },
        }),
      });
      holder.replaceChildren(card(null, [table(cols, rows, {
        empty: 'ไม่พบรายการ',
        footer: rows.length ? el('tr', {}, [
          el('td', { colspan: 4, text: `รวม ${rows.length} รายการ` }),
          el('td.num', { text: money(total) }),
          el('td', { colspan: withPayType ? 3 : 2 }),
        ]) : null,
      })], { tight: true }));
    }
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 240); });
    from.addEventListener('change', run);
    to.addEventListener('change', run);

    wrap.append(el('div.toolbar', {}, [
      el('div.field.grow', {}, [el('label', { text: 'ค้นหา' }), search]),
      field('ตั้งแต่วันที่', from),
      field('ถึงวันที่', to),
      el('button.btn.btn-light', {
        text: 'เดือนนี้',
        onclick: () => {
          const d = new Date();
          from.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
          to.value = todayISO();
          run();
        },
      }),
    ]));
    wrap.append(holder);
    run();
    return wrap;
  };
}

export const incomeView = ledgerView({
  title: 'Menu Income', subtitle: 'รายรับ', icon: '💰',
  endpoint: '/api/income', typeKey: 'income_type', typeList: 'income_type', withPayType: false,
});

export const expenseView = ledgerView({
  title: 'Expense', subtitle: 'รายจ่าย', icon: '💸',
  endpoint: '/api/expense', typeKey: 'expense_type', typeList: 'expense_type', withPayType: true,
});
