'use client';
/** Multi-file upload + thumbnail grid for a case's attached photos. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/apiClient.js';
import { useAsync } from '../lib/hooks.js';
import { useToast } from './Toast.jsx';
import { useConfirm } from './Confirm.jsx';
import { Icon } from './Icon.jsx';
import { photoUploadPlan } from '../lib/photos.js';
import { isPreviewable } from '../lib/lightbox.js';
import { Lightbox } from './Lightbox.jsx';

/* max = null แปลว่ากล่องนี้ไม่จำกัดจำนวน (สลิปโอนเงิน, ไฟล์ส่งมอบ)
   actions / actionsHint / onPhotos ใช้เฉพาะกล่องที่มีปุ่มของตัวเองต่อท้ายปุ่มเพิ่มรูป
   (ปุ่ม "ส่งรูป" ของขั้นวัด Center) — กล่องอื่นไม่ส่งมา หน้าตาเหมือนเดิมทุกอย่าง
   sentIds = id รูปที่ส่งออกไปแล้ว ขึ้น ✓ เขียวที่มุมรูปย่อ (เฉพาะขั้นวัด Center) */
export function PhotoUpload({
  caseId, kind = 'other', centeringId = null, paymentId = null, takenBy = null, max = null,
  actions = null, actionsHint = null, onPhotos = null, sentIds = null,
}) {
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const inputRef = useRef(null);
  /* ขอเฉพาะไฟล์ชนิดเดียวกับที่กล่องนี้อัปโหลด ไม่ใช่ทุกไฟล์ของเคส
     ก่อนหน้านี้ไม่ได้ส่ง kind ไป กล่อง "รูปภาพการวัด" จึงแสดงสลิปโอนเงินที่
     แนบไว้ในขั้นชำระเงินปนมาด้วย ทั้งที่ตอนอัปโหลดแยก kind ไว้แล้ว */
  const { data: photos, loading, reload } = useAsync(
    () => api.get('/api/uploads', { case_id: caseId, kind }),
    [caseId, kind]
  );

  /* บอกเจ้าของกล่องทุกครั้งที่รายการเปลี่ยน (โหลดเสร็จ อัปโหลด ลบ) — ปุ่มส่งรูป
     ต้องส่งชุดเดียวกับที่เห็นในกล่องนี้เป๊ะ ไม่ใช่ไปดึงรายการของตัวเองอีกรอบ */
  useEffect(() => {
    if (onPhotos && photos) onPhotos(photos);
  }, [photos, onPhotos]);

  const pick = () => inputRef.current?.click();

  /* รูปทุกใบในกล่องนี้ เรียงเท่ากับรูปย่อ และใช้ URL เดียวกันเป๊ะ — เบราว์เซอร์แคช
     ไว้แล้วตั้งแต่วาดรูปย่อ เปิดดูใบใหญ่จึงไม่โหลดใหม่ · PDF ไม่อยู่ในชุดนี้ */
  const images = useMemo(
    () => (photos || [])
      .filter((p) => isPreviewable(p.mime_type))
      .map((p) => ({ key: p.id, src: api.url('/api/uploads/' + p.id), alt: p.original_name || '', name: p.original_name || '' })),
    [photos]
  );
  const [viewing, setViewing] = useState(null);

  const count = (photos || []).length;
  /* picked = 0 เพราะตรงนี้ถามแค่ว่ากล่องเต็มหรือยัง ยังไม่มีไฟล์ที่เลือก */
  const { full } = photoUploadPlan(0, count, max);

  const upload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';

    /* รับเท่าที่โควตาเหลือแทนที่จะล้มทั้งชุด — พนักงานเลือกรูปทีเดียวจากกล้อง
       การให้เลือกใหม่ทั้งหมดเพราะเกินไปสองใบเสียเวลากว่า
       ฝั่ง API บังคับลิมิตเดียวกันอีกชั้น ยิงตรงข้ามด่านนี้ไม่ได้ */
    const { accept, skipped } = photoUploadPlan(files.length, count, max);
    if (skipped > 0) {
      err(`กล่องนี้รับได้ไม่เกิน ${max} รูป — ข้ามไป ${skipped} รูป`);
    }
    if (accept < 1) return;

    for (const file of files.slice(0, accept)) {
      const form = new FormData();
      form.append('file', file);
      form.append('case_id', caseId);
      form.append('kind', kind);
      if (centeringId) form.append('centering_id', centeringId);
      if (paymentId) form.append('payment_id', paymentId);
      if (takenBy) form.append('taken_by', takenBy);
      try {
        await api.upload('/api/uploads', form);
      } catch (ex) { err(ex); }
    }
    ok('อัปโหลดรูปแล้ว');
    reload();
  };

  const remove = async (p) => {
    if (!await confirm('ลบรูป', p.original_name || '', { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del('/api/uploads/' + p.id);
      ok('ลบแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const addButton = (
    <button type="button" className="btn btn-sm btn-light" onClick={pick} disabled={full}>
      <Icon name="camera" /> เพิ่มรูป
    </button>
  );

  return (
    <div className="stack">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={upload}
      />
      {/* ตัวนับวางเป็นบรรทัดใต้ปุ่ม ห้ามใช้ .row ครอบ — ปุ่มกว้างเต็มการ์ดได้เพราะ
          align-items:stretch ของ .stack พอโดน .row ครอบมันจะหดเหลือเท่าตัวอักษร
          ตัวครอบตรงนี้จึงเป็น .stack เหมือนกัน แค่บีบ gap ให้ตัวนับติดปุ่ม
          มีปุ่มต่อท้าย: สองปุ่มแบ่งครึ่งกันเต็มความกว้างการ์ด ด้วยเหตุผลเดียวกัน */}
      <div className="stack" style={{ gap: 6 }}>
        {actions ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            {addButton}
            {actions}
          </div>
        ) : addButton}
        {max ? (
          <p className="hint" style={{ margin: 0 }}>
            {full ? `ครบ ${max} รูปแล้ว — ลบรูปเก่าก่อนถ้าจะเพิ่ม` : `แนบแล้ว ${count}/${max}`}
          </p>
        ) : null}
        {actionsHint ? <p className="hint" style={{ margin: 0 }}>{actionsHint}</p> : null}
      </div>
      {loading ? null : (
        <div className="photo-grid">
          {(photos || []).map((p) => (
            <div className="photo-thumb" key={p.id}>
              {isPreviewable(p.mime_type)
                ? (
                  <button
                    type="button"
                    className="photo-thumb-open"
                    onClick={(e) => { e.stopPropagation(); setViewing(images.findIndex((x) => x.key === p.id)); }}
                    aria-label={`ดูรูปใหญ่ ${p.original_name || ''}`.trim()}
                    title="กดเพื่อดูรูปใหญ่"
                  >
                    <img src={api.url('/api/uploads/' + p.id)} alt={p.original_name || ''} />
                  </button>
                )
                : <a href={api.url('/api/uploads/' + p.id)} target="_blank" rel="noreferrer"><Icon name="file" /> {p.original_name}</a>}
              {sentIds && sentIds.includes(Number(p.id)) ? (
                <span
                  title="ส่งแล้ว"
                  aria-label="ส่งแล้ว"
                  style={{
                    position: 'absolute', left: 2, bottom: 2, width: 20, height: 20, borderRadius: '50%',
                    background: 'var(--green-ink)', color: '#fff', display: 'grid', placeItems: 'center',
                    fontSize: 12, boxShadow: '0 0 0 2px #fff', pointerEvents: 'none',
                  }}
                >
                  <Icon name="check" />
                </span>
              ) : null}
              <button type="button" className="photo-thumb-del" onClick={() => remove(p)}><Icon name="x" /></button>
            </div>
          ))}
        </div>
      )}
      {viewing !== null && images.length > 0 ? (
        <Lightbox items={images} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      ) : null}
    </div>
  );
}
