'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/apiClient.js';
import { useAsync, onSubmit } from '../../../lib/hooks.js';
import { useMeta } from '../../../contexts/MetaContext.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { Badge, Card, Field, FormGrid, Loading, PageHead, Toolbar } from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { Pager } from '../../../components/Pager.jsx';
import { PAGE_SIZES } from '../../../lib/pager.js';
import { Icon } from '../../../components/Icon.jsx';
import { AdminOnly } from '../../../components/AdminOnly.jsx';

/* เจ้าที่เลิกสั่งแล้วถูกปิดใช้งาน ไม่ได้ลบทิ้ง ของเก่าจะได้ยังอ้างชื่อได้ รายชื่อ
   จึงยาวเป็นพันเจ้าและเจ้าที่ยังสั่งอยู่ปนอยู่กับเจ้าที่เลิกไปแล้ว */
const STATUS = [
  ['', 'ทั้งหมด'],
  ['on', 'ใช้งาน'],
  ['off', 'ปิด'],
];

function SupplierListInner() {
  const { reload: reloadMeta } = useMeta();
  const { ok, err } = useToast();
  const { data: rows, loading, reload } = useAsync(() => api.get('/api/suppliers'), []);

  /* กรองในเครื่อง ไม่ยิง API ใหม่ทุกตัวอักษร — /api/suppliers คืนทั้งตารางมาอยู่แล้ว
     รอบเดียว (ไม่มีพารามิเตอร์ค้นหา) ผลจึงเปลี่ยนทันทีที่พิมพ์ ไม่ต้องหน่วงรอ */
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PAGE_SIZES[0]);

  /* ตัวเลขบนปุ่มสถานะนับจากรายชื่อทั้งหมด ไม่ใช่จากผลค้นหา — มันเป็นตัวบอกว่า
     "กดแล้วจะเจอกี่เจ้า" ถ้านับตามคำค้นด้วย ตัวเลขจะกระโดดทุกตัวอักษรที่พิมพ์ */
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
      return [r.id, r.name, r.contact_person, r.phone, r.email]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [rows, term, status]);

  /* เปลี่ยนตัวกรอง = ผลคนละชุด กลับไปหน้า 1 เสมอ ไม่งั้นค้างอยู่หน้าที่ว่างเปล่า
     (เหตุผลที่ใช้ <Pager> ตรง ๆ แทน <PagedTable> ซึ่งไม่รู้จักตัวกรองของหน้า) */
  useEffect(() => { setPage(1); }, [term, status, perPage]);

  /* ฟอร์มเพิ่มเป็นป๊อปอัป ไม่ได้กางค้างอยู่หัวหน้าเหมือนเดิม — งานประจำของหน้านี้คือ
     เปิดมาค้นว่าเจ้าไหนยังใช้อยู่ ไม่ใช่การรับซัพพลายเออร์เจ้าใหม่ ฟอร์มห้าช่องที่
     ค้างไว้ตลอดดันรายชื่อ (พันกว่าเจ้า) ลงไปพ้นจอทุกครั้งที่เปิดหน้า
     แบบเดียวกับหน้าพนักงานและหน้าตำแหน่งสินค้า · busy กันกดบันทึกซ้ำระหว่างรอ API */
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const add = async (body) => {
    setBusy(true);
    try {
      await api.post('/api/suppliers', body);
      await reloadMeta();
      ok('เพิ่มแล้ว');
      /* ปิดป๊อปอัปเมื่อบันทึกผ่าน — แถวใหม่อยู่ในตารางข้างหลังแล้ว · พลาดแล้วไม่ปิด
         ค่าที่กรอกไว้จะได้ไม่หายไปทั้งชุด */
      setAdding(false);
      reload();
    } catch (ex) {
      err(ex);
    } finally {
      setBusy(false);
    }
  };

  /* Esc ปิดป๊อปอัป — ทางออกเดียวกับกล่องยืนยันของระบบ (components/Confirm.jsx) */
  useEffect(() => {
    if (!adding) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setAdding(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [adding]);

  const toggle = async (r) => {
    try {
      await api.put('/api/suppliers/' + r.id, { ...r, active: Number(r.active) ? 0 : 1 });
      await reloadMeta();
      reload();
    } catch (ex) { err(ex); }
  };

  if (loading) return <Loading />;

  return (
    <>
      <PageHead icon="🏭" title="Suppliers" subtitle="ซัพพลายเออร์เลนส์/สินค้า" />

      <Toolbar className="crud-tools">
        <Field label="ค้นหา" className="grow crud-search">
          <input
            type="search"
            placeholder="ค้นหา ชื่อ / ผู้ติดต่อ / เบอร์โทร / อีเมล / ID"
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

      {/* ปุ่มเพิ่มยืนอยู่บนหัวของรายชื่อที่มันจะเพิ่มเข้าไป เหมือนหน้าพนักงาน */}
      <Card
        title="รายชื่อซัพพลายเออร์"
        badge={<Badge kind="gray">{`${shown.length} เจ้า`}</Badge>}
        right={(
          <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
            <Icon name="plus" /> เพิ่มซัพพลายเออร์
          </button>
        )}
        tight
      >
        <DataTable
          columns={[
            { label: 'ID', key: 'id', cls: 'mono', mobile: 'meta' },
            { label: 'ชื่อ', key: 'name', mobile: 'title' },
            { label: 'ผู้ติดต่อ', key: 'contact_person', mobile: 'subtitle' },
            { label: 'เบอร์โทร', key: 'phone', cls: 'nowrap', mobile: 'body' },
            { label: 'อีเมล', key: 'email', mobile: 'body' },
            { label: 'Lead time', render: (r) => r.default_lead_days + ' วัน', cls: 'num', mobile: 'body' },
            {
              label: 'สถานะ',
              mobile: 'status',
              render: (r) => (Number(r.active) ? <Badge kind="ok">ใช้งาน</Badge> : <Badge kind="gray">ปิด</Badge>),
            },
            {
              label: '',
              mobile: 'extra',
              cls: 'nowrap',
              render: (r) => (
                <button type="button" className="btn btn-sm btn-light" onClick={() => toggle(r)}>
                  {Number(r.active) ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                </button>
              ),
            },
          ]}
          rows={shown}
          page={page}
          perPage={perPage}
          empty={term.trim() || status ? 'ไม่พบซัพพลายเออร์ที่ตรงกับที่ค้นหา' : 'ยังไม่มีซัพพลายเออร์'}
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
            <h3>เพิ่มซัพพลายเออร์</h3>
            <form onSubmit={onSubmit(add)}>
              <div className="m-body">
                {/* ชื่อกินเต็มแถว อีกสี่ช่องจับคู่กันสองแถว ลงพอดีไม่มีช่องว่างค้าง */}
                <div className="form-2col">
                  <FormGrid>
                    <Field label="ชื่อซัพพลายเออร์ *" className="full">
                      {/* ป๊อปอัปเพิ่งเด้งมาเพราะเพิ่งกดเปิด พิมพ์ได้เลยไม่ต้องคลิกช่องอีกที */}
                      <input name="name" required autoFocus autoComplete="off" />
                    </Field>
                    <Field label="ผู้ติดต่อ"><input name="contact_person" autoComplete="off" /></Field>
                    <Field label="เบอร์โทร"><input name="phone" autoComplete="off" /></Field>
                    <Field label="อีเมล"><input name="email" type="email" autoComplete="off" /></Field>
                    <Field label="Lead time ปกติ (วัน)">
                      <input name="default_lead_days" type="number" min="0" defaultValue={7} />
                    </Field>
                  </FormGrid>
                </div>
              </div>
              <div className="m-foot">
                <button type="button" className="btn btn-light" onClick={() => setAdding(false)}>
                  ยกเลิก
                </button>
                <button className="btn" type="submit" disabled={busy}>
                  <Icon name="check" /> {busy ? 'กำลังบันทึก…' : 'เพิ่มซัพพลายเออร์'}
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
export default function SupplierList() {
  return <AdminOnly><SupplierListInner /></AdminOnly>;
}
