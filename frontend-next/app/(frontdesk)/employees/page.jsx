'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/apiClient.js';
import { useAsync, onSubmit } from '../../../lib/hooks.js';
import { useMeta } from '../../../contexts/MetaContext.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { useConfirm } from '../../../components/Confirm.jsx';
import { Badge, Card, Field, FormGrid, Loading, PageHead, Toolbar } from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { Pager } from '../../../components/Pager.jsx';
import { PAGE_SIZES } from '../../../lib/pager.js';
import { ListSelect } from '../../../components/Selects.jsx';
import { fmtDate } from '../../../lib/format.js';
import { Icon } from '../../../components/Icon.jsx';
import { EditGate } from '../../../components/EditLock.jsx';
import { AdminOnly } from '../../../components/AdminOnly.jsx';
import { DateField } from '../../../components/DateField.jsx';

/* คนที่ลาออกไปแล้วไม่ถูกลบทิ้ง (ดูคอมเมนต์หัว api/routes/employees.php) รายชื่อ
   จึงยาวขึ้นเรื่อย ๆ และคนที่ยังทำงานอยู่ปนอยู่กับคนที่ออกไปแล้ว */
const STATUS = [
  ['', 'ทั้งหมด'],
  ['on', 'ทำงานอยู่'],
  ['off', 'ลาออก'],
];

function EmployeeListInner() {
  const { reload: reloadMeta } = useMeta();
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const { data: rows, loading, reload } = useAsync(() => api.get('/api/employees'), []);

  /* กรองในเครื่อง ไม่ยิง API ใหม่ทุกตัวอักษร — /api/employees คืนทั้งตารางมาอยู่แล้ว
     รอบเดียว (ไม่มีพารามิเตอร์ค้นหา) ของที่จะกรองจึงอยู่ในมือครบตั้งแต่ต้น
     ผลจึงเปลี่ยนทันทีที่พิมพ์ ไม่ต้องหน่วงรอเหมือนช่องค้นหาที่ยิงเซิร์ฟเวอร์ */
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PAGE_SIZES[0]);

  /* ตัวเลขบนปุ่มสถานะนับจากรายชื่อทั้งหมด ไม่ใช่จากผลค้นหา — มันเป็นตัวบอกว่า
     "กดแล้วจะเจอกี่คน" ถ้านับตามคำค้นด้วย ตัวเลขจะกระโดดทุกตัวอักษรที่พิมพ์ */
  const counts = useMemo(() => {
    const all = rows || [];
    const on = all.filter((r) => Number(r.active)).length;
    return { '': all.length, on, off: all.length - on };
  }, [rows]);

  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (status === 'on' && !Number(r.active)) return false;
      if (status === 'off' && Number(r.active)) return false;
      if (!q) return true;
      /* ค้นได้ทั้งชื่อเล่น ชื่อจริง นามสกุล หน้าที่ และเลข ID — คนหน้าร้านจำพนักงาน
         ด้วยชื่อเล่น ส่วนเอกสารเก่าอ้างด้วย ID */
      return [r.id, r.employee_name, r.first_name, r.last_name, r.roles]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [rows, term, status]);

  /* เปลี่ยนตัวกรอง = ผลคนละชุด กลับไปหน้า 1 เสมอ ไม่งั้นค้างอยู่หน้า 4 ที่ว่างเปล่า
     (นี่คือเหตุผลที่หน้านี้ใช้ <Pager> ตรง ๆ แทน <PagedTable> ซึ่งไม่รู้จักตัวกรอง) */
  useEffect(() => { setPage(1); }, [term, status, perPage]);

  /* ฟอร์มเพิ่มเป็นป๊อปอัป ไม่ได้กางค้างอยู่หัวหน้าเหมือนเดิม — งานประจำของหน้านี้คือ
     "เปิดมาดูว่าใครยังทำงานอยู่บ้าง" ไม่ใช่การรับคนใหม่ ซึ่งปีหนึ่งเกิดไม่กี่ครั้ง
     ฟอร์มหกช่องที่ค้างไว้ตลอดดันรายชื่อลงไปพ้นจอไปเปล่า ๆ ทุกครั้งที่เปิดหน้า
     (แบบเดียวกับหน้าตำแหน่งสินค้า /locations) · busy กันกดบันทึกซ้ำระหว่างรอ API
     ไม่งั้นได้พนักงานชื่อซ้ำสองแถว */
  /* ป๊อปอัปเดียวใช้ทั้งเพิ่มและแก้ไข: null = ปิด, {} = เพิ่มใหม่, แถวพนักงาน = แก้ไขคนนั้น */
  const [editing, setEditing] = useState(null);
  const adding = editing !== null;
  const isEdit = Boolean(editing && editing.id);
  const setAdding = (v) => setEditing(v ? {} : null);
  const [busy, setBusy] = useState(false);

  const save = async (body) => {
    setBusy(true);
    try {
      if (isEdit) {
        /* PUT เขียนทับทุกช่องรวม active — ส่งสถานะเดิมไปด้วย ไม่งั้นแก้ชื่อแล้วกลายเป็นลาออก */
        await api.put('/api/employees/' + editing.id, { ...body, active: Number(editing.active) ? 1 : 0 });
        ok('บันทึกการแก้ไขแล้ว');
      } else {
        await api.post('/api/employees', body);
        ok('เพิ่มพนักงานแล้ว');
      }
      await reloadMeta();
      /* ปิดป๊อปอัปเมื่อบันทึกผ่าน — แถวใหม่อยู่ในตารางข้างหลังแล้ว ถ้าค้างไว้ก็บัง
         ของที่ตัวเองเพิ่งเพิ่ม · พลาดแล้วไม่ปิด ค่าที่กรอกไว้จะได้ไม่หายไปทั้งชุด */
      setEditing(null);
      reload();
    } catch (ex) {
      err(ex);
    } finally {
      setBusy(false);
    }
  };

  /* ลบจริงได้เฉพาะคนที่ยังไม่มีประวัติในระบบ (เช่น เพิ่มผิด) — ถ้ามีประวัติแล้ว
     เซิร์ฟเวอร์ปฏิเสธพร้อมบอกให้ใช้ "ปิดใช้งาน" แทน ข้อความนั้นขึ้นเป็น toast */
  const remove = async (r) => {
    if (!await confirm(
      'ลบพนักงาน',
      `ลบ ${r.employee_name || r.first_name || `ID ${r.id}`} ออกจากระบบถาวร — ลบได้เฉพาะคนที่ยังไม่มีประวัติการใช้งาน`,
      { confirmText: 'ลบ', danger: true },
    )) return;
    try {
      await api.del('/api/employees/' + r.id);
      await reloadMeta();
      ok('ลบพนักงานแล้ว');
      reload();
    } catch (ex) {
      err(ex);
    }
  };

  /* Esc ปิดป๊อปอัป — ทางออกเดียวกับกล่องยืนยันของระบบ (components/Confirm.jsx) */
  useEffect(() => {
    if (!adding) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setAdding(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [adding]);

  /* ปิดใช้งาน = เอาชื่อออกจากช่องเลือกพนักงานทุกหน้า ซึ่งเป็นสิ่งที่ใกล้เคียง
     การลบที่สุดในหน้านี้ · เปิดกลับไม่ต้องถาม ไม่มีอะไรหายไป */
  const toggle = async (r) => {
    if (Number(r.active) && !await confirm(
      'ปิดใช้งานพนักงาน',
      `${r.employee_name || r.first_name || `ID ${r.id}`} จะหายจากช่องเลือกพนักงานทุกหน้า — ประวัติเดิมยังอยู่ครบ`,
      { confirmText: 'ปิดใช้งาน', danger: true },
    )) return;
    try {
      await api.put('/api/employees/' + r.id, { ...r, active: Number(r.active) ? 0 : 1 });
      await reloadMeta();
      reload();
    } catch (ex) {
      err(ex);
    }
  };

  if (loading) return <Loading />;

  return (
    <>
      <PageHead icon="employee" title="Employee" subtitle="พนักงาน" />

      <Toolbar className="crud-tools">
        <Field label="ค้นหา" className="grow crud-search">
          <input
            type="search"
            placeholder="ค้นหา ชื่อเล่น / ชื่อจริง / นามสกุล / หน้าที่ / ID"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </Field>
        <div className="seg seg-sm">
          {STATUS.map(([value, label]) => (
            <button
              type="button"
              key={value || 'all'}
              className={status === value ? 'active' : ''}
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
            >
              {label}
              <Badge kind="gray">{counts[value] ?? 0}</Badge>
            </button>
          ))}
        </div>
      </Toolbar>

      {/* ปุ่มเพิ่มยืนอยู่บนหัวของรายชื่อที่มันจะเพิ่มเข้าไป — แบบเดียวกับปุ่ม
          "+ จองคิววันนี้" บนหัวการ์ดคิวของหน้าจองคิว */}
      <Card
        title="รายชื่อพนักงาน"
        badge={<Badge kind="gray">{`${shown.length} คน`}</Badge>}
        right={(
          <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
            <Icon name="plus" /> เพิ่มพนักงาน
          </button>
        )}
        tight
      >
        <DataTable
          columns={[
            { label: 'ID', key: 'id', cls: 'mono', mobile: 'meta' },
            { label: 'ชื่อเล่น', key: 'employee_name', mobile: 'title' },
            { label: 'ชื่อจริง', key: 'first_name', mobile: 'subtitle' },
            { label: 'นามสกุล', key: 'last_name', mobile: 'subtitle' },
            { label: 'เพศ', key: 'sex', mobile: 'meta' },
            { label: 'หน้าที่', key: 'roles', mobile: 'body' },
            { label: 'วันเกิด', render: (r) => fmtDate(r.birth_date), cls: 'nowrap', mobile: 'body' },
            {
              label: 'สถานะ',
              mobile: 'status',
              render: (r) => (Number(r.active)
                ? <Badge kind="ok">ทำงานอยู่</Badge>
                : <Badge kind="gray">ลาออก</Badge>),
            },
            {
              label: '',
              mobile: 'extra',
              cls: 'nowrap',
              render: (r) => (
                <EditGate>
                  {(close) => (
                    <>
                      <button type="button" className="btn btn-sm" onClick={() => { close(); setEditing(r); }}>
                        <Icon name="pencil" /> แก้ไข
                      </button>
                      <button type="button" className="btn btn-sm btn-light" onClick={() => { close(); toggle(r); }}>
                        {Number(r.active) ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                      </button>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => { close(); remove(r); }}>
                        <Icon name="trash" /> ลบ
                      </button>
                    </>
                  )}
                </EditGate>
              ),
            },
          ]}
          rows={shown}
          page={page}
          perPage={perPage}
          /* กระดานว่างเพราะยังไม่มีพนักงาน กับว่างเพราะตัวกรองไม่เข้าเงื่อนไข
             เป็นคนละเรื่อง — บอกให้ตรงว่าอันไหน */
          empty={term.trim() || status ? 'ไม่พบพนักงานที่ตรงกับที่ค้นหา' : 'ยังไม่มีพนักงาน'}
        />

        <Pager
          total={shown.length}
          page={page}
          perPage={perPage}
          onPage={setPage}
          onPerPage={setPerPage}
        />
      </Card>

      {adding && (
        <div
          className="modal-back"
          onClick={(e) => { if (e.target === e.currentTarget) setAdding(false); }}
        >
          <div className="modal">
            <h3>{isEdit ? `แก้ไขพนักงาน · ID ${editing.id}` : 'เพิ่มพนักงานใหม่'}</h3>
            {/* key ตาม id — สลับจากคนหนึ่งไปอีกคน ช่อง defaultValue จะได้โหลดค่าใหม่ */}
            <form key={editing.id || 'new'} onSubmit={onSubmit(save)}>
              <div className="m-body">
                {/* สองคอลัมน์ในกล่อง ไม่ใช่สามแบบค่าตั้งต้นของ .modal — ช่องกว้าง 160px
                    แคบเกินกว่าจะอ่านป้าย "ชื่อเล่น / Nickname" ได้จบในบรรทัดเดียว
                    ชื่อเล่นกับหน้าที่กินเต็มแถว หกช่องจึงลงพอดีสี่แถวโดยไม่มีช่องว่างค้าง */}
                <div className="form-2col">
                  <FormGrid>
                    <Field label="ชื่อเล่น / Nickname *" className="full">
                      {/* ป๊อปอัปเพิ่งเด้งมาเพราะเพิ่งกดเปิด พิมพ์ได้เลยไม่ต้องคลิกช่องอีกที */}
                      <input name="employee_name" required autoFocus autoComplete="off" defaultValue={editing.employee_name || ''} />
                    </Field>
                    <Field label="ชื่อจริง"><input name="first_name" autoComplete="off" defaultValue={editing.first_name || ''} /></Field>
                    <Field label="นามสกุล"><input name="last_name" autoComplete="off" defaultValue={editing.last_name || ''} /></Field>
                    <Field label="เพศ"><ListSelect name="sex" kind="sex" defaultValue={isEdit ? (editing.sex || '') : 'Female'} /></Field>
                    <Field label="วันเกิด"><DateField name="birth_date" defaultValue={String(editing.birth_date || '').slice(0, 10)} /></Field>
                    <Field label="หน้าที่ / Roles" className="full">
                      <input name="roles" autoComplete="off" placeholder="เช่น sales, optometrist, technician" defaultValue={editing.roles || ''} />
                    </Field>
                  </FormGrid>
                </div>
              </div>
              <div className="m-foot">
                <button type="button" className="btn btn-light" onClick={() => setAdding(false)}>
                  ยกเลิก
                </button>
                <button className="btn" type="submit" disabled={busy}>
                  <Icon name="check" /> {busy ? 'กำลังบันทึก…' : (isEdit ? 'บันทึกการแก้ไข' : 'เพิ่มพนักงาน')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* งานของแอดมิน — พนักงานขายที่พิมพ์ URL เข้ามาตรง ๆ จะเห็นคำอธิบาย
   ไม่ใช่หน้าเปล่าหรือถูกเด้งกลับเงียบ ๆ */
export default function EmployeeList() {
  return <AdminOnly zone="system"><EmployeeListInner /></AdminOnly>;
}
