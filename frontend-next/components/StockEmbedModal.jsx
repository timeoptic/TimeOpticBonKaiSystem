'use client';
/**
 * ฟอร์มของฝั่งคลัง เปิดเป็นป๊อบอัพในหน้าร้าน
 *
 * หน้าร้านอยากได้ฟอร์ม "เพิ่มสินค้าใหม่แล้วรับเข้าเลย" กับ "เปิดใบสั่งตัด RX"
 * ตัวเดียวกับที่ฝั่งคลังใช้ ไม่ใช่ของที่หน้าตาคล้าย ๆ กัน — กรอกง่ายกว่า และไม่
 * ต้องมาไล่แก้สองที่ทุกครั้งที่ฟอร์มเปลี่ยน
 *
 * เอาคอมโพเนนต์มาวางตรง ๆ ไม่ได้: สองฝั่งตั้งชื่อคลาสชนกันเก้าคลาส (`.btn`
 * `.field` `.modal` `.chip` …) และตั้งกฎให้ `body input select` คนละแบบ วางแล้ว
 * จะได้สไตล์สองชุดทับกันในหน้าเดียว ซึ่งเป็นสิ่งที่การแยก CSS ทั้งโครงทำมาเพื่อกัน
 *
 * จึงฝังเป็น iframe — คนละเอกสารคือคนละ CSS โดยโครงสร้าง ไม่ต้องหวังว่าใครจะ
 * ตั้งชื่อคลาสไม่ชนกัน · ข้างในคือหน้า `/stock/embed/*` ซึ่ง import ฟอร์มตัวจริง
 * ไฟล์เดียวกับที่ `/stock/receive` กับ `/stock/rx` ใช้
 *
 * ผลลัพธ์กลับมาทาง postMessage แล้วหน้านี้ค่อยไปอ่านของที่เพิ่งสร้างผ่าน API
 * ปกติ — iframe ไม่ต้องรู้จักฟอร์มขาย และฟอร์มขายไม่ต้องรู้จักข้างใน iframe
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/apiClient.js';
import { useToast } from './Toast.jsx';

const EMBED_MESSAGE = 'timeoptic:embed';

export function StockEmbedModal({ what, type, side, title, onClose, onProduct, onRx }) {
  const { err } = useToast();
  const [ready, setReady] = useState(false);
  const busy = useRef(false);

  /* `side` ('r' | 'l') — ข้างที่หน้าเคสกำลังสั่งตัดให้ ส่งต่อให้ใบสั่งบันทึกข้างตาไว้ด้วย
     (ร้านขอไว้ 14 ก.ย. 2026 · เดิมหัวกล่องบอกข้าง แต่ใบสั่งไม่ได้เก็บ) */
  const src = what === 'rx'
    ? `/stock/embed/rx/${side ? `?side=${encodeURIComponent(side)}` : ''}`
    : `/stock/embed/new-product/${type ? `?type=${encodeURIComponent(type)}` : ''}`;

  useEffect(() => {
    const onMessage = async (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== EMBED_MESSAGE) return;
      const r = e.data.result;
      if (!r || busy.current) return;

      if (r.kind === 'cancel') {
        onClose();
        return;
      }
      if (r.kind === 'rx') {
        onRx?.(r);
        return;
      }
      if (r.kind === 'product') {
        busy.current = true;
        try {
          /* อ่านกลับมาเป็นแถวเดียวกับที่ช่องค้นหาใช้ ฟอร์มขายจะได้อ่านฟิลด์เดิม
             ได้ทุกตัวโดยไม่ต้องเดาว่า iframe ส่งอะไรมาให้ · ไม่มีล็อต (กด "ใช้
             ตัวที่มีอยู่แล้ว") ก็ยังหาได้จากสินค้า */
          const row = r.lotId
            ? await api.get('/api/stock/' + r.lotId)
            : (await api.get('/api/stock', { q: '', limit: 300, group: 'product' }))
              .find((x) => Number(x.product_id) === Number(r.productId)) ?? null;
          onProduct?.(row);
        } catch (ex) {
          err(ex);
        } finally {
          busy.current = false;
        }
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onClose, onProduct, onRx, err]);

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {/* ไม่มีกรอบของตัวเอง — ฟอร์มข้างในมีหัวเรื่องกับปุ่มปิดของมันอยู่แล้ว
          ครอบอีกชั้นจะได้กล่องซ้อนกล่อง เงาสองชั้น และปุ่มปิดสองปุ่มที่ทำงาน
          เหมือนกัน · ปุ่มปิดข้างในส่ง cancel กลับมาปิดหน้าต่างนี้ให้เอง */}
      <div className="embed-modal">
        {!ready ? <p className="embed-modal__wait">กำลังเปิดฟอร์ม…</p> : null}
        <iframe
          title={title}
          src={src}
          className="embed-modal__frame"
          onLoad={() => setReady(true)}
        />
      </div>
    </div>
  );
}
