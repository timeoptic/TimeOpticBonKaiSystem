'use client';
/**
 * รายการเลนส์ของ Bewell (lens_catalog) — ตัวเลือกเลนส์ในหน้าขาย แอดมินเพิ่ม/แก้/ปิดเองได้
 *
 * ไม่ใช่คลัง: ไม่มีจำนวนคงเหลือ ไม่มีรับเข้า ไม่แยกตามค่าสายตา · ไม่มีปุ่มลบ มีแต่ปิดใช้งาน
 * ใบที่ขายไปแล้วคัดลอกชื่อ ราคา และต้นทุน ณ วันขายไว้เอง แก้ที่นี่แล้วใบเก่าไม่เปลี่ยน
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/apiClient.js';
import { useAsync, onSubmit } from '../../../lib/hooks.js';
import { useAuth } from '../../../contexts/AuthContext.jsx';
import { can } from '../../../lib/roles.js';
import { useToast } from '../../../components/Toast.jsx';
import { useConfirm } from '../../../components/Confirm.jsx';
import { Badge, Card, Field, FormGrid, Loading, PageHead, Toolbar } from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { Pager } from '../../../components/Pager.jsx';
import { PAGE_SIZES } from '../../../lib/pager.js';
import { Icon } from '../../../components/Icon.jsx';
import { AdminOnly } from '../../../components/AdminOnly.jsx';
import { money } from '../../../lib/format.js';

const STATUS = [
  ['', 'ทั้งหมด'],
  ['on', 'ใช้งาน'],
  ['off', 'ปิด'],
];

/* ชนิดที่ร้านใช้บ่อย — พิมพ์ชนิดใหม่เองได้ (datalist ไม่บังคับ) */
const TYPES = ['Single Vision', 'Progressive', 'Bifocal', 'Office'];

function LensCatalogInner() {
  const { actor } = useAuth();
  const seeCost = can(actor, 'cost.view');
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const { data: rows, loading, reload } = useAsync(() => api.get('/api/lens-catalog'), []);

  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PAGE_SIZES[0]);

  const counts = useMemo(() => {
    const all = rows || [];
    const on = all.filter((r) => r.active).length;
    return { '': all.length, on, off: all.length - on };
  }, [rows]);

  const shown = useMemo(() => {
    const words = term.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (rows || []).filter((r) => {
      if (status === 'on' && !r.active) return false;
      if (status === 'off' && r.active) return false;
      const hay = [r.code, r.lens_name, r.lens_type, r.lens_index, r.coating, r.brand].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [rows, term, status]);

  useEffect(() => { setPage(1); }, [term, status, perPage]);

  /* null = ปิด · {} = เพิ่มใหม่ · แถว = แก้ไข */
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (body) => {
    setBusy(true);
    try {
      if (editing?.id) {
        await api.put('/api/lens-catalog/' + editing.id, body);
        ok('บันทึกแล้ว — ใบที่ขายไปแล้วไม่เปลี่ยนตาม');
      } else {
        await api.post('/api/lens-catalog', body);
        ok('เพิ่มเลนส์แล้ว');
      }
      setEditing(null);
      reload();
    } catch (ex) {
      err(ex);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!editing) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setEditing(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing]);

  const toggle = async (r) => {
    if (r.active && !await confirm(
      'ปิดใช้งานเลนส์',
      `${r.lens_name} จะหายจากช่องเลือกเลนส์ในหน้าขาย — ใบที่ขายไปแล้วยังอยู่ครบ`,
      { confirmText: 'ปิดใช้งาน', danger: true },
    )) return;
    try {
      await api.post(`/api/lens-catalog/${r.id}/active`, { active: !r.active });
      reload();
    } catch (ex) { err(ex); }
  };

  if (loading) return <Loading />;

  const e = editing || {};

  return (
    <>
      <PageHead
        icon="glasses"
        title="รายการเลนส์"
        subtitle="ตัวเลือกเลนส์ในหน้าขาย · ไม่ใช่สต็อก — ขายแล้วบันทึกเป็น “ใช้เลนส์” เพื่อเบิกจาก TimeOptic"
      />

      <Toolbar className="crud-tools">
        <Field label="ค้นหา" className="grow crud-search">
          <input
            type="search"
            placeholder="ชื่อเลนส์ / รหัส / ชนิด / Index / Coating"
            value={term}
            onChange={(ev) => setTerm(ev.target.value)}
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

      <Card
        title="เลนส์ที่ขายได้"
        badge={<Badge kind="gray">{`${shown.length} รายการ`}</Badge>}
        right={(
          <button type="button" className="btn btn-sm" onClick={() => setEditing({})}>
            <Icon name="plus" /> เพิ่มเลนส์
          </button>
        )}
        tight
      >
        <DataTable
          columns={[
            { label: 'รหัส', key: 'code', cls: 'mono', mobile: 'meta' },
            { label: 'ชื่อเลนส์', key: 'lens_name', mobile: 'title' },
            {
              label: 'ชนิด / Index / Coating',
              mobile: 'subtitle',
              render: (r) => [r.lens_type, r.lens_index, r.coating].filter(Boolean).join(' · '),
            },
            { label: 'ยี่ห้อ', render: (r) => r.brand || '—', mobile: 'body' },
            ...(seeCost
              ? [{ label: 'ต้นทุน/คู่', render: (r) => (r.cost_price == null ? '—' : money(r.cost_price)), cls: 'num', mobile: 'body' }]
              : []),
            { label: 'ราคาขาย/คู่', render: (r) => money(r.selling_price), cls: 'num', mobile: 'body' },
            {
              label: 'สถานะ',
              mobile: 'status',
              render: (r) => (r.active ? <Badge kind="ok">ใช้งาน</Badge> : <Badge kind="gray">ปิด</Badge>),
            },
            {
              label: '',
              mobile: 'extra',
              cls: 'nowrap',
              render: (r) => (
                <>
                  <button type="button" className="btn btn-sm btn-light" onClick={() => setEditing(r)}>แก้ไข</button>
                  {' '}
                  <button type="button" className="btn btn-sm btn-light" onClick={() => toggle(r)}>
                    {r.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                  </button>
                </>
              ),
            },
          ]}
          rows={shown}
          page={page}
          perPage={perPage}
          empty={term.trim() || status ? 'ไม่พบเลนส์ที่ตรงกับที่ค้นหา' : 'ยังไม่มีเลนส์ในรายการ'}
        />
        <Pager total={shown.length} page={page} perPage={perPage} onPage={setPage} onPerPage={setPerPage} />
      </Card>

      {editing && (
        <div className="modal-back" onClick={(ev) => { if (ev.target === ev.currentTarget) setEditing(null); }}>
          <div className="modal">
            <h3>{e.id ? `แก้ไข ${e.code}` : 'เพิ่มเลนส์'}</h3>
            <form onSubmit={onSubmit(save)} key={e.id || 'new'}>
              <div className="m-body">
                <div className="form-2col">
                  <FormGrid>
                    <Field label="ชื่อเลนส์ *" className="full">
                      <input name="lens_name" required autoFocus autoComplete="off" defaultValue={e.lens_name || ''}
                        placeholder="เช่น Single Vision 1.56 Blue Cut" />
                    </Field>
                    <Field label="รหัส *">
                      <input name="code" required autoComplete="off" defaultValue={e.code || ''}
                        placeholder="LENS-SV156-BLUE" style={{ textTransform: 'uppercase' }} />
                    </Field>
                    <Field label="ชนิดเลนส์ *">
                      <input name="lens_type" required list="lens-types" autoComplete="off" defaultValue={e.lens_type || ''} />
                      <datalist id="lens-types">
                        {TYPES.map((t) => <option key={t} value={t} />)}
                      </datalist>
                    </Field>
                    <Field label="Index">
                      <input name="lens_index" autoComplete="off" defaultValue={e.lens_index || ''} placeholder="1.56" />
                    </Field>
                    <Field label="Coating">
                      <input name="coating" autoComplete="off" defaultValue={e.coating || ''} placeholder="Blue" />
                    </Field>
                    <Field label="ยี่ห้อ (ไม่บังคับ)">
                      <input name="brand" autoComplete="off" defaultValue={e.brand || ''} />
                    </Field>
                    {/* ค่าสายตาของรุ่น — รายชื่อเดิมจากเว็บหลักแยกรุ่นตามค่าสายตา ใช้กรองในหน้าขาย
                        เว้นว่าง = ใช้ได้ทุกค่า */}
                    <Field label="SPH (ไม่บังคับ)">
                      <input name="sph" autoComplete="off" defaultValue={e.sph || ''} placeholder="-2.00" />
                    </Field>
                    <Field label="CYL (ไม่บังคับ)">
                      <input name="cyl" autoComplete="off" defaultValue={e.cyl || ''} placeholder="-0.50" />
                    </Field>
                    <Field label="ADD (ไม่บังคับ)">
                      <input name="add_power" autoComplete="off" defaultValue={e.add_power || ''} placeholder="+2.00" />
                    </Field>
                    <Field label="ลำดับในรายการ">
                      <input name="sort_order" type="number" defaultValue={e.sort_order ?? 0} />
                    </Field>
                    <Field label="ราคาขาย / คู่ (บาท) *">
                      <input name="selling_price" type="number" min="0" step="0.01" required
                        defaultValue={e.selling_price ?? ''} inputMode="decimal" />
                    </Field>
                    {seeCost ? (
                      <Field label="ต้นทุน / คู่ (บาท)">
                        <input name="cost_price" type="number" min="0" step="0.01"
                          defaultValue={e.cost_price ?? ''} inputMode="decimal" />
                      </Field>
                    ) : null}
                  </FormGrid>
                </div>
                <p className="hint">แก้ชื่อหรือราคาแล้ว ใบที่ขายไปก่อนหน้านี้ยังเป็นค่าเดิม ณ วันที่ขาย</p>
              </div>
              <div className="m-foot">
                <button type="button" className="btn btn-light" onClick={() => setEditing(null)}>ยกเลิก</button>
                <button className="btn" type="submit" disabled={busy}>
                  <Icon name="check" /> {busy ? 'กำลังบันทึก…' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default function LensCatalogPage() {
  return <AdminOnly zone="system"><LensCatalogInner /></AdminOnly>;
}
