import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAsync, onSubmit } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/Confirm.jsx';
import { Badge, Field, FormActions, FormGrid, Loading, PageHead } from '../../components/ui.jsx';
import { ListSelect, SupplierSelect } from '../../components/Selects.jsx';
import { BRANDS } from '../../lib/constants.js';
import { fmtDate } from '../../lib/format.js';

export default function StockForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const { ok, err } = useToast();
  const confirm = useConfirm();

  const { data, loading, reload } = useAsync(async () => {
    const [s, names] = await Promise.all([
      editing ? api.get('/api/stock/' + id) : Promise.resolve(null),
      api.get('/api/stock/names'),
    ]);
    return { s, names };
  }, [id]);

  if (loading) return <Loading />;

  const { s, names } = data;

  const save = async (body, form) => {
    try {
      if (editing) {
        await api.put('/api/stock/' + s.id, body);
        ok('บันทึกแล้ว');
        navigate('/stock');
      } else {
        const r = await api.post('/api/stock', body);
        ok(`รับสินค้าเข้าคลัง ${r.count} ชิ้น (รหัส ${r.ids[0]}${r.count > 1 ? '–' + r.ids.at(-1) : ''})`);
        form.reset();
        reload();
      }
    } catch (ex) {
      err(ex);
    }
  };

  const remove = async () => {
    if (!await confirm('ลบสินค้า', `ลบ "${s.product_name}" (#${s.id})?`, { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del('/api/stock/' + s.id);
      ok('ลบแล้ว');
      navigate('/stock');
    } catch (ex) {
      err(ex);
    }
  };

  const uniqueNames = [...new Set(names.map((n) => n.product_name))];

  return (
    <>
      <PageHead
        icon="📦"
        title={editing ? 'Edit Stock Item' : 'Add to Stock'}
        subtitle={editing ? `แก้ไขสินค้า #${s.id}` : 'เพิ่มสินค้าเข้าคลัง'}
        actions={editing && Number(s.sold)
          ? <Badge kind="gray">{'ขายแล้ว ' + fmtDate(s.clear_date)}</Badge>
          : null}
      />

      <div className="card">
        <form className="card-body" onSubmit={onSubmit(save)}>
          <FormGrid>
            <Field label="ประเภทสินค้า / ProductType">
              <ListSelect name="product_type" kind="product_type" defaultValue={s?.product_type || 'Frame'} />
            </Field>
            <Field label="แบรนด์ / Brand">
              <input name="brand" defaultValue={s?.brand || ''} list="brand-list" />
            </Field>
            <Field label="รุ่น / Model"><input name="model" defaultValue={s?.model || ''} /></Field>
            <Field label="สี / Color"><input name="color" defaultValue={s?.color || ''} /></Field>
            <Field label="ขนาด / Size"><input name="size" defaultValue={s?.size || ''} /></Field>
            <Field label="SKU"><input name="sku" defaultValue={s?.sku || ''} /></Field>
            <Field label="Lens index"><input name="lens_index" defaultValue={s?.lens_index || ''} /></Field>
            <Field label="Coating"><input name="coating" defaultValue={s?.coating || ''} /></Field>
            <Field label="ซัพพลายเออร์">
              <SupplierSelect name="supplier_id" defaultValue={s?.supplier_id || ''} />
            </Field>

            <Field label="ชื่อสินค้า / ProductName *" className="full">
              <input name="product_name" defaultValue={s?.product_name || ''} required list="name-list" />
            </Field>

            <Field label="ราคาขาย / ProductPrice">
              <input name="product_price" type="number" step="1" min="0" defaultValue={s?.product_price ?? 0} />
            </Field>
            <Field label="ต้นทุน / ProductExpense">
              <input name="product_expense" type="number" step="1" min="0" defaultValue={s?.product_expense ?? 0} />
            </Field>
            <Field label="ผู้ขาย / VendorName">
              <input name="vendor_name" defaultValue={s?.vendor_name || ''} />
            </Field>

            {!editing && (
              <Field label="จำนวน / Amount" hint="สร้างเป็นสินค้ารายชิ้น ชิ้นละ 1 รหัส">
                <input name="amount" type="number" min="1" max="500" defaultValue={1} />
              </Field>
            )}

            <Field label="หมายเหตุ / Notes" className="full">
              <textarea name="notes" defaultValue={s?.notes || ''} />
            </Field>
          </FormGrid>

          <datalist id="name-list">
            {uniqueNames.map((n) => <option key={n} value={n} />)}
          </datalist>
          <datalist id="brand-list">
            {BRANDS.map((n) => <option key={n} value={n} />)}
          </datalist>

          <FormActions>
            <button className="btn btn-lg" type="submit">
              {editing ? '💾 บันทึก' : '✔ Enter — รับเข้าคลัง'}
            </button>
            {editing && !Number(s.sold) && (
              <button type="button" className="btn btn-danger" onClick={remove}>🗑 ลบ</button>
            )}
            <Link className="btn btn-light" to="/stock">ยกเลิก</Link>
          </FormActions>
        </form>
      </div>
    </>
  );
}
