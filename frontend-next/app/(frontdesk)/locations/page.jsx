'use client';
/**
 * ตำแหน่งจัดเก็บสินค้า — "ของชิ้นนี้อยู่ตู้ไหน"
 *
 * ผูกกับ product_name ไม่ใช่ stock id (ดูคอมเมนต์หัว api/routes/locations.php)
 * หนึ่งชื่อสินค้าจึงมีได้หลายแถวถ้าวางไว้หลายที่ ซึ่งเป็นเรื่องปกติของหน้าร้าน
 *
 * สองมุมมองบนข้อมูลชุดเดียวกัน ไม่ได้ยิง API คนละเส้น:
 *   ตาราง      — ค้นหา แก้ไข ลบ ทีละแถว (ค่าเริ่มต้น เหมือนที่เคยเป็นมา)
 *   จัดกลุ่ม   — "ตู้นี้มีอะไรบ้าง" สำหรับตอนเดินเช็กของจริงหน้าร้าน
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/apiClient.js';
import { useAsync, useDebounced, onSubmit } from '../../../lib/hooks.js';
import { PAGE_SIZES } from '../../../lib/pager.js';
import { useToast } from '../../../components/Toast.jsx';
import { useConfirm } from '../../../components/Confirm.jsx';
import {
  Card, CardFold, Field, FormGrid, Kpi, Kpis, Loading, PageHead, Tabs, Toolbar,
} from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { Pager } from '../../../components/Pager.jsx';
import { Icon } from '../../../components/Icon.jsx';

const TABLE = 'ตาราง';
const GROUPED = 'จัดกลุ่มตามตำแหน่ง';

/* API ตัดที่ 500 แถว — ถ้าโหลดมาได้เท่านี้พอดี แปลว่าอาจมีมากกว่านี้ที่ยังไม่เห็น
   ตัวเลขสรุปด้านบนจึงต้องบอกออกไปตรง ๆ ไม่ใช่แสดง 500 เฉย ๆ เหมือนเป็นยอดจริง */
const API_LIMIT = 500;

const LOC_UNSET = '(ไม่ระบุตำแหน่ง)';

/**
 * รวมแถวเป็นกลุ่มตามตำแหน่ง เรียงตู้ที่ของเยอะสุดขึ้นก่อน
 *
 * ตำแหน่งว่างไม่ถูกทิ้ง แต่ถูกรวบเป็นกลุ่ม "(ไม่ระบุตำแหน่ง)" — ของที่ยังไม่รู้ว่า
 * อยู่ไหนคือสิ่งที่ต้องเห็น ไม่ใช่สิ่งที่ควรหายไปจากหน้าจอ
 */
function groupByLocation(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const key = String(r.location ?? '').trim() || LOC_UNSET;
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(r);
  }
  return [...m.entries()]
    .map(([location, items]) => ({ location, items }))
    .sort((a, b) => b.items.length - a.items.length || a.location.localeCompare(b.location, 'th'));
}

export default function LocationsPage() {
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const [term, setTerm] = useState('');
  const q = useDebounced(term);
  const [view, setView] = useState(TABLE);

  /* ฟอร์มเพิ่มเป็นป๊อปอัป ไม่ได้กางค้างอยู่บนหน้า — งานหลักของหน้านี้คือ "เปิดมาดู
     ว่าของอยู่ตู้ไหน" ไม่ใช่การเพิ่มแถว ฟอร์มที่ค้างไว้ตลอดดันตารางกับตัวเลขสรุป
     ลงไปโดยเปล่าประโยชน์ · busy กันกดบันทึกซ้ำระหว่างรอ API ไม่งั้นได้แถวซ้ำ */
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  /* แถวที่กำลังแก้ + ค่าที่พิมพ์ค้างไว้ — แก้ได้ทีละแถว ไม่งั้นกดบันทึกทีเดียว
     หลายแถวแล้วแถวไหนพลาดจะบอกไม่ได้ว่าอันไหน */
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState({ product_name: '', location: '' });

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PAGE_SIZES[0]);

  const { data: rows, loading, reload } = useAsync(
    () => api.get('/api/locations', { q: q.trim() }),
    [q]
  );

  /* คำค้นเปลี่ยน = ผลคนละชุด · แท็บ "รายการ"/"จัดกลุ่ม" ไม่ต้องรีเซ็ต เพราะแท็บกลุ่ม
     ไม่ได้ใช้เลขหน้า กลับมาแท็บรายการแล้วยังอยู่หน้าเดิมคือสิ่งที่คนคาดหวัง */
  useEffect(() => { setPage(1); }, [q, perPage]);

  const groups = useMemo(() => groupByLocation(rows), [rows]);

  const add = async (body) => {
    setBusy(true);
    try {
      await api.post('/api/locations', body);
      ok('เพิ่มแล้ว');
      /* ปิดป๊อปอัปเมื่อบันทึกผ่าน — แถวที่เพิ่งเพิ่มอยู่ในตารางข้างหลัง ถ้าค้างไว้
         ก็บังของที่ตัวเองเพิ่งทำ · พลาดแล้วไม่ปิด ค่าที่กรอกไว้จะได้ไม่หาย */
      setAdding(false);
      reload();
    } catch (ex) { err(ex); } finally { setBusy(false); }
  };

  /* Esc ปิดป๊อปอัป — เหมือนกล่องยืนยันของระบบ (components/Confirm.jsx) */
  useEffect(() => {
    if (!adding) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setAdding(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [adding]);

  /* ถามก่อนลบ — ปุ่มถังขยะอยู่ติดปุ่มแก้ไขในแถวเดียวกัน กดพลาดได้ง่าย และแถวที่ลบไป
     แล้วไม่มีทางเรียกคืน ต้องพิมพ์ชื่อสินค้ากับตำแหน่งใหม่ทั้งคู่ */
  const remove = async (r) => {
    const where = String(r.location ?? '').trim();
    if (!await confirm(
      'ลบตำแหน่งสินค้า',
      where ? `ลบ "${r.product_name}" ออกจากตำแหน่ง "${where}"?` : `ลบ "${r.product_name}" ออกจากรายการ?`,
      { confirmText: 'ลบ', danger: true },
    )) return;
    try {
      await api.del('/api/locations/' + r.id);
      ok('ลบแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const startEdit = (r) => {
    setEditId(r.id);
    setDraft({ product_name: r.product_name || '', location: r.location || '' });
  };

  const saveEdit = async () => {
    try {
      await api.put('/api/locations/' + editId, draft);
      ok('บันทึกแล้ว');
      setEditId(null);
      reload();
    } catch (ex) { err(ex); }
  };

  /* ปิดปุ่มบันทึกไว้ก่อนถึงจะยิงไม่ได้ — ฝั่ง API ก็กันค่าว่างไว้อีกชั้น
     ด่านหน้าเว็บมีไว้ให้รู้ตัวก่อนกด ไม่ใช่แทนการตรวจของจริง */
  const canSave = draft.product_name.trim() !== '' && draft.location.trim() !== '';

  const searching = q.trim() !== '';
  const capped = (rows?.length || 0) >= API_LIMIT;

  const cell = (r, key, label) => (editId === r.id ? (
    <input
      value={draft[key]}
      aria-label={label}
      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
    />
  ) : (r[key] ?? ''));

  return (
    <div className="loc-page">
      <PageHead icon="pin" title="Product Location" subtitle="ตำแหน่งจัดเก็บสินค้า" />

      {/* ตัวเลขสรุปอยู่เหนือช่องค้นหา — เปิดหน้ามาเห็นก่อนว่ามีของกี่รายการ กระจายกี่ตู้
          แล้วค่อยลงมือค้นหา ไม่ใช่รู้ทีหลังตอนเลื่อนผ่านไปแล้ว
          ตัวเลขนับจากแถวที่โหลดมา ไม่ใช่จากทั้งฐาน — ป้ายจึงเปลี่ยนตามว่ากำลังค้นหา
          อยู่ไหม และมีหมายเหตุกำกับเมื่อชนเพดาน 500 ของ API
          ค้างไว้ระหว่างรอผลค้นหารอบใหม่ ไม่งั้นช่องค้นหาที่อยู่ใต้มันเด้งขึ้นลงทุกตัวอักษร */}
      {rows && (
        <Kpis className="loc-kpis">
          <Kpi
            label={searching ? 'รายการในผลค้นหา' : 'รายการทั้งหมด'}
            value={rows.length}
            sub={capped ? `แสดงสูงสุด ${API_LIMIT} รายการ อาจมีมากกว่านี้` : null}
          />
          <Kpi
            label="ตำแหน่งที่ใช้อยู่"
            value={groups.length}
            sub={searching ? 'นับจากผลค้นหา' : null}
          />
          <Kpi
            kind="loc-top"
            label="ตำแหน่งที่ของเยอะสุด"
            value={groups[0]?.location ?? '—'}
            sub={groups[0] ? `${groups[0].items.length} รายการ` : null}
          />
        </Kpis>
      )}

      <Toolbar className="loc-tools">
        <Field label="ค้นหา" className="loc-search grow">
          <input
            type="search"
            placeholder="ค้นหาชื่อสินค้า / ตำแหน่ง"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </Field>
        {/* ปุ่มเพิ่มอยู่ท้ายแถวค้นหา ชิดขวาสุด แบบเดียวกับแถบเครื่องมือของหน้าบัญชี
            — ช่องค้นหา .grow ดันมาให้เอง ไม่ต้องมีกฎ CSS เพิ่ม */}
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          <Icon name="plus" /> เพิ่มตำแหน่งสินค้า
        </button>
      </Toolbar>

      {/* โหลดครั้งแรกเท่านั้นที่ขึ้น "กำลังโหลด" — ค้นหารอบถัด ๆ ไปคงผลเดิมไว้ก่อน
          ทั้งหน้าจะได้ไม่กะพริบหายทุกตัวอักษรที่พิมพ์ */}
      {loading && !rows ? <Loading /> : (
        <>
          <Tabs names={[TABLE, GROUPED]} active={view} onSelect={setView} />

          {view === TABLE ? (
            <Card tight className="loc-table">
              <DataTable
                columns={[
                  { label: 'ID', key: 'id', cls: 'mono', mobile: 'meta' },
                  { label: 'ชื่อสินค้า', render: (r) => cell(r, 'product_name', 'ชื่อสินค้า'), mobile: 'title' },
                  { label: 'ตำแหน่ง', render: (r) => cell(r, 'location', 'ตำแหน่ง'), mobile: 'body' },
                  {
                    label: '',
                    cls: 'nowrap',
                    mobile: 'extra',
                    render: (r) => (editId === r.id ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={saveEdit}
                          disabled={!canSave}
                          title="บันทึก"
                        >
                          <Icon name="check" />
                        </button>{' '}
                        <button type="button" className="btn btn-sm btn-light" onClick={() => setEditId(null)} title="ยกเลิก">
                          <Icon name="x" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="btn btn-sm btn-light" onClick={() => startEdit(r)} title="เปิดการแก้ไข" aria-label="เปิดการแก้ไข">
                          <Icon name="pencil" />
                        </button>{' '}
                        <button type="button" className="btn btn-sm btn-light" onClick={() => remove(r)} title="ลบ">
                          <Icon name="trash" />
                        </button>
                      </>
                    )),
                  },
                ]}
                rows={rows}
                page={page}
                perPage={perPage}
                empty="ยังไม่มีข้อมูลตำแหน่งสินค้า"
              />

              <Pager
                total={(rows || []).length}
                page={page}
                perPage={perPage}
                onPage={setPage}
                onPerPage={setPerPage}
              />
            </Card>
          ) : (
            <div className="loc-groups">
              {groups.length ? groups.map((g, i) => (
                <CardFold
                  key={g.location}
                  title={g.location}
                  count={`${g.items.length} รายการ`}
                  defaultOpen={i === 0}
                  tight
                >
                  <ul className="loc-items">
                    {g.items.map((r) => <li key={r.id}>{r.product_name}</li>)}
                  </ul>
                </CardFold>
              )) : <Card><p className="muted">ยังไม่มีข้อมูลตำแหน่งสินค้า</p></Card>}
            </div>
          )}
        </>
      )}

      {adding && (
        <div
          className="modal-back"
          onClick={(e) => { if (e.target === e.currentTarget) setAdding(false); }}
        >
          <div className="modal">
            <h3>เพิ่มตำแหน่งสินค้า</h3>
            <form onSubmit={onSubmit(add)}>
              <div className="m-body">
                <div className="loc-form">
                  <FormGrid>
                    <Field label="ชื่อสินค้า / ProductName *">
                      {/* ป๊อปอัปเพิ่งเด้งมาเพราะเพิ่งกดเปิด พิมพ์ได้เลยไม่ต้องคลิกช่องอีกที
                          autoComplete ปิดไว้ ไม่งั้นกล่องจำค่าเก่าของเบราว์เซอร์ทับปุ่ม */}
                      <input name="product_name" required autoFocus autoComplete="off" />
                    </Field>
                    <Field label="ตำแหน่ง / Location *">
                      {/* รายชื่อตู้ที่ใช้อยู่จริงเป็นตัวเลือกให้เลือก — พิมพ์เองทุกครั้งแล้ว
                          "ตู้PRO1 / ตู้ PRO1 / PRO1" กลายเป็นสามตู้คนละกลุ่มในหน้าจัดกลุ่ม
                          (ระหว่างค้นหาอยู่ ตัวเลือกจะเหลือเท่าที่อยู่ในผลค้นหา) */}
                      <input
                        name="location"
                        required
                        list="loc-known"
                        autoComplete="off"
                        placeholder="เช่น ตู้PRO1, Display, ข้างหลัง"
                      />
                      <datalist id="loc-known">
                        {groups.filter((g) => g.location !== LOC_UNSET)
                          .map((g) => <option key={g.location} value={g.location} />)}
                      </datalist>
                    </Field>
                  </FormGrid>
                </div>
              </div>
              <div className="m-foot">
                <button type="button" className="btn btn-light" onClick={() => setAdding(false)}>
                  ยกเลิก
                </button>
                <button className="btn" type="submit" disabled={busy}>
                  <Icon name="check" /> {busy ? 'กำลังบันทึก…' : 'เพิ่มตำแหน่ง'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
