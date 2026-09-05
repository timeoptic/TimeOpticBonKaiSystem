'use client';
/**
 * สมุดรายรับ/รายจ่าย — หน้าเดียวใช้ได้ทั้งสองฝั่ง ต่างกันแค่ปลายทาง ชื่อคอลัมน์ประเภท
 * และรายจ่ายที่ต้องบอกว่าจ่ายด้วยอะไร (app/income/page.jsx, app/expense/page.jsx)
 *
 * หน้านี้เรียงตามลำดับที่คนเปิดมาใช้จริง:
 *
 *   1  สรุป      เปิดมาเห็นยอดก่อน — คำถามแรกของคนเปิดสมุดเงินคือ "ช่วงนี้เท่าไหร่"
 *   2  ตัวกรอง   เปลี่ยนช่วงแล้วเลขข้างบนขยับตาม เป็นเครื่องมือของกล่องสรุป ไม่ใช่ของตาราง
 *   3  รายการ    รายละเอียดสำหรับคนที่อยากรู้ว่ายอดนั้นมาจากไหน
 *
 * การกรอกเป็นงานที่นาน ๆ ทำที จึงอยู่หลังปุ่มแทนที่จะกางค้างไว้บนสุด — ฟอร์มที่กางค้าง
 * ดันของที่คนมาดูจริง ๆ ลงไปใต้จอทุกครั้งที่เปิดหน้า
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/apiClient.js';
import { useAsync, useDebounced, onSubmit } from '../lib/hooks.js';
import { useToast } from './Toast.jsx';
import { useConfirm } from './Confirm.jsx';
import {
  Card, Field, FormGrid, Kpi, Kpis, Loading, PageHead, Toolbar,
} from './ui.jsx';
import { DataTable } from './DataTable.jsx';
import { ComboList, ListSelect } from './Selects.jsx';
import { DateField } from './DateField.jsx';
import { fmtDate, money, todayISO } from '../lib/format.js';
import { Icon } from './Icon.jsx';

/** กี่ประเภทที่กล่องสรุปใบที่สามรับไหวโดยยังอ่านออก */
const TOP_TYPES = 3;

/** สาขาที่ร้านใช้จริงอยู่ที่เดียว — ไม่ถามตอนกรอก แต่ยังเขียนลงแถวให้ตรงกับของเดิม */
const HOME_BRANCH = 'Timeoptic';

/**
 * คำอธิบายใต้ยอด — บอกว่ายอดนี้เป็นยอดของอะไร
 *
 * ตัวเลขก้อนเดียวไม่มีคำกำกับคือตัวเลขที่ถูกอ่านผิดได้ คนเห็น ฿30,038 แล้วนึกว่าเป็นยอด
 * ทั้งหมดของร้าน ทั้งที่เป็นยอดของเดือนมกราคมที่กรองค้างไว้
 */
function rangeLabel(from, to) {
  if (from && to) return `${fmtDate(from)} – ${fmtDate(to)}`;
  if (from) return `ตั้งแต่ ${fmtDate(from)}`;
  if (to) return `ถึง ${fmtDate(to)}`;
  return 'ทั้งหมด';
}

export function Ledger({ title, subtitle, icon, endpoint, typeKey, typeList, withPayType }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();

  const [term, setTerm] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const q = useDebounced(term);

  const { data, loading, error, reload } = useAsync(
    () => api.get(endpoint, { q: q.trim(), from, to, limit: 500 }),
    [q, from, to]
  );

  /* Esc ปิดกล่องได้ เป็นสิ่งที่คนคาดหวังจากกล่องลอยทุกใบ และเป็นทางออกเดียว
     ของคนที่ใช้คีย์บอร์ดอย่างเดียว */
  useEffect(() => {
    if (!adding) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setAdding(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [adding]);

  const add = async (body) => {
    setBusy(true);
    try {
      await api.post(endpoint, body);
      ok('บันทึกแล้ว');
      setAdding(false);
      reload();
    } catch (ex) { err(ex); } finally { setBusy(false); }
  };

  const remove = async (r) => {
    if (!await confirm('ลบรายการ', `ลบรายการ #${r.id} (${money(r.amount)})?`,
      { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del(`${endpoint}/${r.id}`);
      ok('ลบแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const thisMonth = () => {
    const d = new Date();
    setFrom(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
    setTo(todayISO());
  };

  const clearRange = () => { setFrom(''); setTo(''); };
  const clearAll = () => { setTerm(''); clearRange(); };
  /* มีตัวกรองค้างอยู่ไหม — จอว่างเพราะ "ยังไม่เคยบันทึก" กับเพราะ "กรองจนไม่เหลือ"
     เป็นคนละเรื่อง และทางออกก็คนละทาง */
  const filtered = !!(q.trim() || from || to);

  /* count/total/by_type คิดมาจากทุกแถวที่เข้าเงื่อนไข ส่วน rows ถูกตัดที่ 500
     — อย่าเอา rows.length มาแทน count เด็ดขาด สองอย่างนี้ไม่เท่ากันเมื่อรายการเยอะ */
  const { rows = [], total = 0, count = 0, by_type: byType = [] } = data || {};
  const top = byType.slice(0, TOP_TYPES);
  const rest = byType.length - top.length;
  const capped = rows.length < count;
  const showBranch = new Set(rows.map((r) => r.branch || '')).size > 1;

  const columns = [
    { label: 'ID', key: 'id', cls: 'mono' },
    { label: 'วันที่', render: (r) => fmtDate(r.cf_date), cls: 'nowrap' },
    { label: 'ประเภท', key: typeKey },
    /* โผล่เฉพาะตอนที่แถวในจอไม่ได้เป็นสาขาเดียวกันหมด — คอลัมน์ที่ทุกแถวเขียนเหมือนกัน
       ไม่ได้บอกอะไร มีแต่เบียดที่ของคอลัมน์ที่บอก ส่วนแถวเก่าที่เป็น "ส่วนตัว" หรือ
       "ถูกดี" ปนอยู่ คอลัมน์จะกลับมาเองโดยไม่ต้องมีใครไปเปิด */
    ...(showBranch ? [{ label: 'สาขา', key: 'branch' }] : []),
    { label: 'จำนวนเงิน', render: (r) => money(r.amount), cls: 'num' },
    ...(withPayType ? [{ label: 'ชำระ', key: 'pay_type' }] : []),
    { label: 'หมายเหตุ', key: 'notes' },
    {
      label: '',
      cls: 'nowrap',
      render: (r) => (
        <button
          type="button"
          className="btn btn-sm btn-light"
          title={`ลบรายการ #${r.id}`}
          onClick={() => remove(r)}
        >
          <Icon name="trash" />
        </button>
      ),
    },
  ];

  const addLabel = `เพิ่ม${subtitle}`;

  return (
    <div>
      <PageHead icon={icon} title={title} subtitle={subtitle} />

      {!error && (
        <Kpis className="ledger-sum">
          <Kpi
            label={`ยอดรวม${subtitle}`}
            value={loading ? '…' : money(total)}
            sub={rangeLabel(from, to)}
          />
          <Kpi
            label="จำนวนรายการ"
            value={loading ? '…' : count.toLocaleString('th-TH')}
            /* บอกเฉพาะตอนที่ตารางข้างล่างแสดงไม่ครบ — "แสดงครบทุกรายการ" ใต้เลข 0
               เป็นคำที่ไม่ได้บอกอะไรเลย มีแต่ทำให้กล่องรก */
            sub={capped ? `ตารางข้างล่างแสดง ${rows.length.toLocaleString('th-TH')} รายการล่าสุด` : null}
          />
          {/* ใบนี้ตอบคำถามที่ยอดรวมตอบไม่ได้: เงินก้อนนั้นไปกองอยู่ที่ประเภทไหน */}
          <Kpi
            kind="breakdown"
            label="แยกตามประเภท"
            value={(
              <span className="kpi-breakdown">
                {top.length === 0
                  ? <span className="muted">ยังไม่มีรายการ</span>
                  : top.map((t) => (
                    <span className="kb-row" key={t.type}>
                      <span className="kb-name" title={t.type}>{t.type}</span>
                      <span className="kb-val">{money(t.total)}</span>
                    </span>
                  ))}
              </span>
            )}
            sub={rest > 0 ? `และอีก ${rest} ประเภท` : null}
          />
        </Kpis>
      )}

      <Toolbar className="ledger-tools">
        <Field label="ค้นหา" className="grow">
          <input
            type="search"
            placeholder="ประเภท / สาขา / หมายเหตุ"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </Field>
        <Field label="ตั้งแต่วันที่">
          <DateField value={from} onChange={setFrom} />
        </Field>
        <Field label="ถึงวันที่">
          <DateField value={to} onChange={setTo} />
        </Field>
        <button type="button" className="btn btn-light" onClick={thisMonth}>เดือนนี้</button>
        {(from || to) && (
          <button type="button" className="btn btn-light" onClick={clearRange}>ล้างช่วงวันที่</button>
        )}
        {/* อยู่ท้ายแถวเดียวกับตัวกรอง ชิดขวาสุด — หัวเพจเหลือไว้บอกว่านี่หน้าอะไรอย่างเดียว */}
        <button type="button" className="btn ledger-add" onClick={() => setAdding(true)}>
          <Icon name="plus" /> {addLabel}
        </button>
      </Toolbar>

      {loading && <Loading />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (
        <Card tight>
          <DataTable
            columns={columns}
            rows={rows}
            empty={(
              <div className="ledger-empty">
                <p className="le-title">
                  {filtered ? `ไม่มี${subtitle}ที่ตรงกับตัวกรองนี้` : `ยังไม่มี${subtitle}ในสมุดนี้`}
                </p>
                <p className="le-sub">
                  {filtered
                    ? 'ลองขยายช่วงวันที่ หรือล้างคำค้นแล้วดูใหม่'
                    : 'บันทึกรายการแรกได้เลย'}
                </p>
                {filtered ? (
                  <button type="button" className="btn btn-light" onClick={clearAll}>
                    ล้างตัวกรอง
                  </button>
                ) : (
                  <button type="button" className="btn" onClick={() => setAdding(true)}>
                    <Icon name="plus" /> {addLabel}
                  </button>
                )}
              </div>
            )}
            footer={rows.length ? (
              <tr>
                {/* ช่องซ้ายทั้งหมดก่อนคอลัมน์เงิน แล้วที่เหลือหลังจากนั้น — คิดจากจำนวนคอลัมน์จริง
                    ไม่ใช่เลขที่เขียนตายไว้ ไม่งั้นวันที่คอลัมน์สาขาหายไปยอดรวมจะเลื่อนไปผิดช่อง */}
                <td colSpan={showBranch ? 4 : 3}>
                  {`รวม ${rows.length.toLocaleString('th-TH')} รายการที่แสดง`}
                </td>
                <td className="num">{money(rows.reduce((a, r) => a + Number(r.amount || 0), 0))}</td>
                <td colSpan={withPayType ? 3 : 2} />
              </tr>
            ) : null}
          />
        </Card>
      )}

      {adding && (
        <div
          className="modal-back"
          onClick={(e) => { if (e.target === e.currentTarget) setAdding(false); }}
        >
          <div className="modal">
            <h3>{addLabel}</h3>
            <form onSubmit={onSubmit(add)}>
              <div className="m-body">
                <div className="ledger-form">
                  {/* จำนวนเงินคือเหตุผลที่รายการนี้ถูกบันทึก ให้เป็นของที่ตาไปตกก่อนและพิมพ์ได้ทันที
                      ใช้ช่องเงินแบบเดียวกับหน้าชำระเงิน จะได้ไม่มีหน้าตาที่สามในระบบ
                      ปล่อยว่างไว้แทนที่จะใส่ 0 — 0 ที่ต้องลบก่อนพิมพ์คือขั้นตอนที่ไม่ต้องมี */}
                  <Field label="จำนวนเงิน">
                    <div className="pay-amount-input">
                      <span>฿</span>
                      <input
                        name="amount"
                        type="number"
                        step="1"
                        min="0"
                        placeholder="0"
                        required
                        autoFocus
                      />
                    </div>
                  </Field>
                  {/* ร้านมีที่เดียว เลยไม่ถามแล้ว แต่ยังเขียนค่าลงไปเหมือนเดิม — ปล่อยว่างไว้
                      แถวใหม่จะกลายเป็นกลุ่ม "(ว่าง)" ที่ปนกับ 2,728 แถวเดิมที่เป็น Timeoptic
                      แล้วรายงานที่แยกเงินร้าน/เงินส่วนตัวจะนับไม่ตรงตั้งแต่วันนี้เป็นต้นไป */}
                  <input type="hidden" name="branch" value={HOME_BRANCH} />
                  <FormGrid>
                    <Field label="วันที่">
                      <DateField name="cf_date" defaultValue={todayISO()} required />
                    </Field>
                    {/* พิมพ์ประเภทใหม่ได้เลย ไม่ต้องรอให้ใครไปเพิ่มตัวเลือกให้ก่อน */}
                    <Field label="ประเภท" hint="ไม่มีในรายการก็พิมพ์ใหม่ได้">
                      <ComboList name={typeKey} kind={typeList} placeholder="เช่น ค่าเช่า" />
                    </Field>
                    {withPayType && (
                      <Field label="ชำระด้วย">
                        <ListSelect name="pay_type" kind="pay_type" defaultValue="Cash" />
                      </Field>
                    )}
                    <Field label="หมายเหตุ" className="full">
                      <textarea name="notes" rows={2} placeholder="ไม่บังคับ" />
                    </Field>
                  </FormGrid>
                </div>
              </div>
              <div className="m-foot">
                <button type="button" className="btn btn-light" onClick={() => setAdding(false)}>
                  ยกเลิก
                </button>
                <button className="btn" type="submit" disabled={busy}>
                  <Icon name="check" /> {busy ? 'กำลังบันทึก…' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
