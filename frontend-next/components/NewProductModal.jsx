'use client';
/**
 * เพิ่มสินค้าใหม่ระหว่างขาย โดยไม่ต้องออกจากหน้า
 *
 * ลูกค้ายืนอยู่ตรงหน้าเคาน์เตอร์ กรอบที่เขาเลือกเพิ่งมาถึงร้านเมื่อเช้าและยังไม่มีใคร
 * ลงคลัง ถ้าต้องให้คนขายเปิดหน้าสต็อกไปลงของก่อนแล้วค่อยกลับมา ออเดอร์ที่กรอกค้างไว้
 * หายทั้งใบ — ที่นี่จึงลงคลังจริงผ่าน POST /api/stock ตัวเดียวกับหน้าสต็อก
 * (สร้าง products + stock_lots + inventory_logs ครบ) แล้วส่งชิ้นที่เพิ่งสร้างกลับไป
 * ให้ฟอร์มเลือกต่อทันที
 *
 * ราคาที่กรอกที่นี่คือราคาตั้งต้นของสินค้าใน master — ราคาขายจริงของออเดอร์ตั้งแยก
 * ในฟอร์มขาย และไม่ย้อนกลับมาแก้ตัวนี้
 */
import { useState } from 'react';
import { api } from '../lib/apiClient.js';
import { useToast } from './Toast.jsx';
import { Field, FormGrid } from './ui.jsx';
import { Icon } from './Icon.jsx';

const FRAME_FIELDS = [
  ['product_name', 'ชื่อกรอบ / Frame name', 'เช่น TimeOptic TS1042 Metal', true],
  ['brand', 'ยี่ห้อ / Brand', 'เช่น TimeOptic'],
  ['model', 'รุ่น / Model', 'เช่น TS1042'],
  ['color', 'สี / Color', 'เช่น ดำเงา'],
  ['size', 'ไซส์ / Size', 'เช่น 52-18-140'],
  ['sku', 'SKU', 'เว้นว่างได้ ระบบออกให้เอง'],
];

const LENS_FIELDS = [
  ['product_name', 'ชื่อเลนส์ / Lens name', 'เช่น Crizal Easy Pro 1.56', true],
  ['brand', 'ยี่ห้อ / Brand', 'เช่น Essilor'],
  ['lens_design', 'ชนิดเลนส์ / Lens type', 'เช่น Single Vision, Progressive'],
  ['lens_index', 'Index', 'เช่น 1.56'],
  ['coating', 'Coating / Option', 'เช่น BlueControl'],
  ['sku', 'SKU', 'เว้นว่างได้ ระบบออกให้เอง'],
];

export function NewProductModal({ type, onClose, onCreated }) {
  const { ok, err } = useToast();
  const isLens = type === 'Lens';
  const fields = isLens ? LENS_FIELDS : FRAME_FIELDS;
  /**
   * ลงชื่อสินค้าไว้ก่อน ของยังไม่มา — จึงไม่ถามจำนวน
   *
   * คนขายเปิดกล่องนี้ตอนลูกค้ายืนอยู่ตรงหน้าและสินค้าที่เขาเลือกยังไม่มีในระบบ
   * ซึ่งเกือบทุกครั้งแปลว่าของยังไม่ได้เข้าร้านด้วย · ถามจำนวนแล้วค่าปริยาย 1
   * คือชวนให้ตอบว่ามีของหนึ่งชิ้นทั้งที่ยังไม่มี แล้วคลังก็จะเชื่อตามนั้น
   *
   * ลงเป็นล็อตศูนย์ชิ้นแทน พอยืนยันการขาย ยอดจะกลายเป็นติดลบเท่าที่ค้างส่ง และ
   * กลับเป็นบวกเองในวันที่รับของเข้าจริง (ดู Receiving::settleShortfall)
   */
  const [form, setForm] = useState({ amount: '0' });
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!(form.product_name || '').trim()) {
      err(new Error('กรุณากรอกชื่อสินค้า'));
      return;
    }
    setBusy(true);
    try {
      const res = await api.post('/api/stock', { ...form, product_type: type });
      const lotId = (res.ids || [])[0];
      /* อ่านกลับมาเป็นแถวเดียวกับที่ช่องค้นหาใช้ ฟอร์มขายจะได้อ่านฟิลด์เดิมได้ทุกตัว
         (remaining_qty, sku, brand, model …) โดยไม่ต้องเดาว่าอะไรอยู่ตรงไหน */
      const row = lotId ? await api.get('/api/stock/' + lotId) : null;
      ok(`เพิ่ม ${form.product_name} เข้าคลังแล้ว`);
      onCreated(row);
    } catch (ex) {
      err(ex);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide">
        <h3>{isLens ? 'เพิ่มเลนส์เข้าคลัง' : 'เพิ่มกรอบเข้าคลัง'}</h3>
        <p className="hint">
          ลงชื่อไว้ก่อน ของยังไม่มา — พอยืนยันการขาย ยอดจะขึ้นเป็นค้างส่ง
          แล้วกลับเป็นบวกเองในวันที่รับของเข้าจริง
        </p>
        {/* ไม่ใช้ <form> ที่นี่ — โมดัลนี้ถูก render อยู่ข้างในฟอร์มออเดอร์ และ HTML
            ซ้อนฟอร์มไม่ได้ เบราว์เซอร์จะทิ้งฟอร์มชั้นในทิ้ง ปุ่ม submit ของโมดัลก็จะ
            กลายเป็นปุ่มบันทึกออเดอร์แทน (กดเพิ่มสินค้าแล้วออเดอร์ถูกบันทึกไปเฉย ๆ)
            จึงเป็น div กับปุ่ม type=button ที่เรียก save() เองแทน */}
        <div>
          <div className="m-body">
            <FormGrid>
              {/* ไม่มี required เพราะไม่มีฟอร์มให้เบราว์เซอร์ตรวจ — save() ตรวจชื่อสินค้าเอง
                  แล้วขึ้น toast บอก ป้ายที่จำเป็นเติม * ไว้ให้เห็นก่อนกด */}
              {fields.map(([name, label, placeholder, required]) => (
                <Field key={name} label={required ? `${label} *` : label}>
                  <input
                    name={name}
                    value={form[name] ?? ''}
                    placeholder={placeholder}
                    aria-required={required || undefined}
                    onChange={set(name)}
                  />
                </Field>
              ))}
              <Field label="ราคาทุน / Cost" hint="ไม่กรอกก็ได้">
                <input name="product_expense" type="number" min="0" step="1"
                  value={form.product_expense ?? ''} onChange={set('product_expense')} />
              </Field>
              <Field label="ราคาตั้งต้น / List price" hint="ใช้เป็นค่าเริ่มต้นของราคาขาย แก้ได้ทีหลัง">
                <input name="product_price" type="number" min="0" step="1"
                  value={form.product_price ?? ''} onChange={set('product_price')} />
              </Field>
            </FormGrid>
          </div>
          <div className="m-foot">
            <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>ยกเลิก</button>
            <button type="button" className="btn" onClick={save} disabled={busy}>
              <Icon name="check" /> เพิ่มเข้าคลังแล้วเลือกเลย
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
