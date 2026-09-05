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
import { useMemo, useState } from 'react';
import { api } from '../../../lib/apiClient.js';
import { useAsync, useDebounced, onSubmit } from '../../../lib/hooks.js';
import { useToast } from '../../../components/Toast.jsx';
import {
  Card, CardFold, Field, FormActions, FormGrid, Kpi, Kpis, Loading, PageHead, Tabs, Toolbar,
} from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
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
  const [term, setTerm] = useState('');
  const q = useDebounced(term);
  const [view, setView] = useState(TABLE);

  /* แถวที่กำลังแก้ + ค่าที่พิมพ์ค้างไว้ — แก้ได้ทีละแถว ไม่งั้นกดบันทึกทีเดียว
     หลายแถวแล้วแถวไหนพลาดจะบอกไม่ได้ว่าอันไหน */
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState({ product_name: '', location: '' });

  const { data: rows, loading, reload } = useAsync(
    () => api.get('/api/locations', { q: q.trim() }),
    [q]
  );

  const groups = useMemo(() => groupByLocation(rows), [rows]);

  const add = async (body, form) => {
    try {
      await api.post('/api/locations', body);
      ok('เพิ่มแล้ว');
      form.reset();
      reload();
    } catch (ex) { err(ex); }
  };

  const remove = async (r) => {
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
    <div>
      <PageHead icon="📍" title="Product Location" subtitle="ตำแหน่งจัดเก็บสินค้า" />

      <div className="card loc-form">
        <div className="card-head"><h2>เพิ่มตำแหน่งสินค้า</h2></div>
        <form className="card-body" onSubmit={onSubmit(add)}>
          <FormGrid>
            <Field label="ชื่อสินค้า / ProductName *"><input name="product_name" required /></Field>
            <Field label="ตำแหน่ง / Location *">
              <input name="location" required placeholder="เช่น ตู้PRO1, Display, ข้างหลัง" />
            </Field>
          </FormGrid>
          {/* ปุ่มอยู่ใน FormActions ไม่ใช่ช่องหนึ่งของ FormGrid — ถ้ายัดเข้ากริดต้องใส่
              ป้ายกำกับปลอมเป็นช่องว่าง ซึ่งเบราว์เซอร์ยุบให้สูงศูนย์ ปุ่มจะลอยขึ้นไป
              อยู่แนวเดียวกับป้ายของช่องข้าง ๆ แทนที่จะอยู่แนวเดียวกับช่องกรอก */}
          <FormActions>
            <button className="btn" type="submit">+ เพิ่มตำแหน่ง</button>
          </FormActions>
        </form>
      </div>

      <Toolbar>
        <Field label="ค้นหา" className="loc-search grow">
          <input
            type="search"
            placeholder="ค้นหาชื่อสินค้า / ตำแหน่ง"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </Field>
      </Toolbar>

      {loading ? <Loading /> : (
        <>
          {/* ตัวเลขนับจากแถวที่โหลดมา ไม่ใช่จากทั้งฐาน — ป้ายจึงเปลี่ยนตามว่ากำลัง
              ค้นหาอยู่ไหม และมีหมายเหตุกำกับเมื่อชนเพดาน 500 ของ API */}
          <Kpis>
            <Kpi
              label={searching ? 'รายการในผลค้นหา' : 'รายการทั้งหมด'}
              value={rows?.length || 0}
              sub={capped ? `แสดงสูงสุด ${API_LIMIT} รายการ อาจมีมากกว่านี้` : null}
            />
            <Kpi
              label="ตำแหน่งที่ใช้อยู่"
              value={groups.length}
              sub={searching ? 'นับจากผลค้นหา' : null}
            />
            <Kpi
              label="ตำแหน่งที่ของเยอะสุด"
              value={groups[0]?.location ?? '—'}
              sub={groups[0] ? `${groups[0].items.length} รายการ` : null}
            />
          </Kpis>

          <Tabs names={[TABLE, GROUPED]} active={view} onSelect={setView} />

          {view === TABLE ? (
            <Card tight className="loc-table">
              <DataTable
                columns={[
                  { label: 'ID', key: 'id', cls: 'mono' },
                  { label: 'ชื่อสินค้า', render: (r) => cell(r, 'product_name', 'ชื่อสินค้า') },
                  { label: 'ตำแหน่ง', render: (r) => cell(r, 'location', 'ตำแหน่ง') },
                  {
                    label: '',
                    cls: 'nowrap',
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
                        <button type="button" className="btn btn-sm btn-light" onClick={() => startEdit(r)} title="แก้ไข">
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
                empty="ยังไม่มีข้อมูลตำแหน่งสินค้า"
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
    </div>
  );
}
