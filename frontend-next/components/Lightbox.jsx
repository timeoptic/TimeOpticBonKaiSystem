'use client';
/**
 * ดูรูปขนาดใหญ่กลางจอ — ใช้กับ "รูปภาพการวัด" และรูปย่อสลิปทุกจุด
 *
 *   {viewing !== null && (
 *     <Lightbox items={images} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
 *   )}
 *
 * `items` คือ `[{ key, src, alt, name }]` · `src` ต้องเป็น URL ตัวเดียวกับรูปย่อเป๊ะ
 * เบราว์เซอร์แคชรูปไว้แล้ว (API ตอบ Cache-Control ยาวหนึ่งปี ไฟล์ที่ยังไม่อัปเป็น
 * blob URL จาก `useObjectUrls`) เปิดดูใบใหญ่จึงไม่มีการโหลดใหม่
 *
 * ── ทำไม portal ────────────────────────────────────────────────────────────
 * รูปย่ออยู่ในการ์ดที่ `overflow:hidden` และในฟอร์ม · วางไว้ที่ body จึงไม่ถูกตัดขอบ
 * และปุ่มของมันไม่ได้อยู่ใน <form> ใน DOM จริง กดแล้วไม่มีทางไป submit อะไร
 *
 * ── ทำไมหยุด event ที่ตัวเอง ────────────────────────────────────────────────
 * event ของ React ไหลผ่าน portal ขึ้นไปหาต้นไม้ของ React ด้วย ไม่ใช่ตาม DOM · คลิกใน
 * lightbox จึงไปถึงการ์ดที่ห่อรูปย่ออยู่ได้ วันที่การ์ดไหนผูกคลิกไว้เปิดโหมดแก้ไข
 * การดูรูปจะพาเข้าโหมดนั้นเอง — หยุดไว้ที่ตัวรากตรงนี้ที่เดียว
 *
 * ── คีย์บอร์ด ─────────────────────────────────────────────────────────────
 * ดักที่ window ช่วง capture แล้วหยุดเฉพาะปุ่มที่ใช้ — Esc ไม่ไปปิดกล่องอื่น ลูกศร
 * ไม่ไปเลื่อนหน้าข้างหลัง · ปุ่มอื่น (Tab, Enter) ปล่อยผ่านตามปกติ
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  clampPan,
  clampZoom,
  counterLabel,
  pinchZoom,
  stepZoom,
  swipeStep,
  wheelZoom,
  wrapIndex,
} from '../lib/lightbox.js';

/* ชุดไอคอนกลาง (lib/icons.js) ไม่มี minus กับลูกศรซ้าย-ขวา · วาดเองทั้งห้าตัวให้เส้น
   หนาเท่ากันบนพื้นเข้ม แทนที่จะผสมสองชุด */
const glyph = (path) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
);
const ICON = {
  close: glyph(<path d="M6 6l12 12M18 6L6 18" />),
  prev: glyph(<path d="M15 5l-7 7 7 7" />),
  next: glyph(<path d="M9 5l7 7-7 7" />),
  plus: glyph(<path d="M12 5v14M5 12h14" />),
  minus: glyph(<path d="M5 12h14" />),
};

/** ขยายเท่านี้เมื่อคลิกรูปที่ยังพอดีจอ */
const CLICK_ZOOM = 2;

export function Lightbox({ items, index, onIndex, onClose }) {
  const count = items.length;
  const i = wrapIndex(index, count);
  const item = items[i];

  const [zoom, setZoom] = useState(ZOOM_MIN);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  /* ตัวจัดการ touch/wheel ผูกกับ DOM ครั้งเดียว อ่านค่าล่าสุดผ่าน ref แทนการผูกใหม่
     ทุกครั้งที่ซูมขยับหนึ่งพิกเซล */
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;

  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const closeRef = useRef(null);
  const gesture = useRef(null);
  /* ลากเลื่อนรูปแล้วปล่อยเมาส์บนพื้นหลัง เบราว์เซอร์ยิง click ตามมา — ไม่ใช่การกดปิด */
  const swallowClick = useRef(false);

  /* แต่ละรูปเริ่มที่ขนาดพอดีจอ อยู่กลางจอ */
  useEffect(() => {
    setZoom(ZOOM_MIN);
    setPan({ x: 0, y: 0 });
  }, [i]);

  /* ขนาดที่รูปแสดงอยู่ก่อน scale — offsetWidth ไม่นับ transform จึงคงที่ระหว่างซูม */
  const fitted = () => ({ w: imgRef.current?.offsetWidth || 0, h: imgRef.current?.offsetHeight || 0 });

  const applyZoom = useCallback((next) => {
    const z = clampZoom(next);
    const { w, h } = fitted();
    setZoom(z);
    setPan((p) => clampPan(p.x, p.y, z, w, h));
  }, []);

  const go = useCallback((step) => {
    if (count > 1) onIndex(wrapIndex(i + step, count));
  }, [i, count, onIndex]);

  useEffect(() => {
    const onKey = (e) => {
      let used = true;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === '+' || e.key === '=') applyZoom(stepZoom(zoomRef.current, 1));
      else if (e.key === '-' || e.key === '_') applyZoom(stepZoom(zoomRef.current, -1));
      else if (e.key === '0') applyZoom(ZOOM_MIN);
      else used = false;
      if (used) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, onClose, applyZoom]);

  /* หน้าข้างหลังไม่เลื่อนตามล้อหรือนิ้ว · โฟกัสไปที่ปุ่มปิด แล้วคืนให้รูปย่อตอนปิด
     คนใช้คีย์บอร์ดจะได้กลับมาอยู่ที่เดิม */
  useEffect(() => {
    const before = document.activeElement;
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = 'hidden';
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      html.style.overflow = overflow;
      if (before instanceof HTMLElement && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, []);

  /* ล้อเมาส์กับนิ้ว — ต้องผูกเองแบบ passive:false ถึงจะ preventDefault ได้
     (React ผูก wheel/touchmove เป็น passive ให้ เรียก preventDefault แล้วไม่มีผล) */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const panFrom = (t) => ({ type: 'pan', x0: t.clientX, y0: t.clientY, px: panRef.current.x, py: panRef.current.y });

    const onWheel = (e) => {
      e.preventDefault();
      applyZoom(wheelZoom(zoomRef.current, e.deltaY));
    };

    const onStart = (e) => {
      swallowClick.current = false;
      if (e.touches.length >= 2) {
        gesture.current = { type: 'pinch', d0: dist(e.touches), z0: zoomRef.current };
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        /* ขยายอยู่ = นิ้วเดียวเลื่อนรูป · พอดีจอ = นิ้วเดียวปัดเปลี่ยนรูป */
        gesture.current = zoomRef.current > ZOOM_MIN
          ? panFrom(t)
          : { type: 'swipe', x0: t.clientX, y0: t.clientY, dx: 0, dy: 0 };
      }
    };

    const onMove = (e) => {
      const g = gesture.current;
      if (!g) return;
      e.preventDefault();
      if (g.type === 'pinch') {
        if (e.touches.length >= 2) {
          swallowClick.current = true;
          applyZoom(pinchZoom(g.z0, g.d0, dist(e.touches)));
        }
        return;
      }
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (Math.abs(dx) + Math.abs(dy) > 6) swallowClick.current = true;
      if (g.type === 'pan') {
        const { w, h } = fitted();
        setPan(clampPan(g.px + dx, g.py + dy, zoomRef.current, w, h));
      } else {
        g.dx = dx;
        g.dy = dy;
      }
    };

    const onEnd = (e) => {
      const g = gesture.current;
      if (!g) return;
      if (e.touches.length === 0) {
        if (g.type === 'swipe') {
          const step = swipeStep(g.dx, g.dy);
          if (step) go(step);
        }
        gesture.current = null;
      } else if (e.touches.length === 1 && g.type === 'pinch') {
        /* ยกนิ้วหนึ่งหลังบีบ นิ้วที่เหลือลากต่อได้เลย ไม่ต้องยกทั้งมือแล้วเริ่มใหม่ */
        gesture.current = zoomRef.current > ZOOM_MIN ? panFrom(e.touches[0]) : null;
      }
    };

    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd);
    root.addEventListener('touchcancel', onEnd);
    return () => {
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
    };
  }, [applyZoom, go]);

  /* ลากเลื่อนด้วยเมาส์ตอนขยาย — นิ้วจัดการใน touch ข้างบนแล้ว */
  const onPointerDown = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || zoomRef.current <= ZOOM_MIN) return;
    e.preventDefault();
    swallowClick.current = false;
    gesture.current = { type: 'drag', x0: e.clientX, y0: e.clientY, px: panRef.current.x, py: panRef.current.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const g = gesture.current;
    if (!g || g.type !== 'drag') return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (Math.abs(dx) + Math.abs(dy) > 3) swallowClick.current = true;
    const { w, h } = fitted();
    setPan(clampPan(g.px + dx, g.py + dy, zoomRef.current, w, h));
  };
  const onPointerUp = () => {
    if (gesture.current?.type === 'drag') gesture.current = null;
  };

  /* คลิกที่รูป: พอดีจออยู่ = ขยาย · ขยายอยู่ = กลับพอดีจอ (ถ้าไม่ได้ลากเลื่อน) */
  const onImageClick = (e) => {
    e.stopPropagation();
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    applyZoom(zoomRef.current > ZOOM_MIN ? ZOOM_MIN : CLICK_ZOOM);
  };

  /* คลิกพื้นที่นอกรูปปิด · แถบบนไม่รับคลิก (pointer-events:none) ช่องว่างในแถบจึงนับ
     เป็นพื้นหลังด้วย · ปุ่มต่าง ๆ มี target เป็นตัวเอง จึงไม่เข้าเงื่อนไขนี้ */
  const onBackdropClick = (e) => {
    e.stopPropagation();
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    if (e.target === e.currentTarget || e.target === stageRef.current) onClose();
  };

  if (!item) return null;

  return createPortal(
    <div
      ref={rootRef}
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`ดูรูป ${counterLabel(i, count)}`}
      style={{ touchAction: 'none' }}
      onClick={onBackdropClick}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="lightbox-bar">
        <span className="lightbox-count" aria-live="polite">{counterLabel(i, count)}</span>
        <span className="lightbox-name">{item.name}</span>
        <div className="lightbox-zoom">
          <button
            type="button"
            className="lightbox-btn"
            onClick={() => applyZoom(stepZoom(zoom, -1))}
            disabled={zoom <= ZOOM_MIN}
            aria-label="ย่อ"
            title="ย่อ (−)"
          >
            {ICON.minus}
          </button>
          <button
            type="button"
            className="lightbox-btn lightbox-level"
            onClick={() => applyZoom(ZOOM_MIN)}
            disabled={zoom <= ZOOM_MIN}
            aria-label="กลับขนาดพอดีจอ"
            title="กลับขนาดพอดีจอ (0)"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="lightbox-btn"
            onClick={() => applyZoom(stepZoom(zoom, 1))}
            disabled={zoom >= ZOOM_MAX}
            aria-label="ขยาย"
            title="ขยาย (+)"
          >
            {ICON.plus}
          </button>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="lightbox-btn lightbox-close"
          onClick={onClose}
          aria-label="ปิด"
          title="ปิด (Esc)"
        >
          {ICON.close}
        </button>
      </div>

      <div ref={stageRef} className="lightbox-stage">
        <img
          key={item.key ?? item.src}
          ref={imgRef}
          src={item.src}
          alt={item.alt || ''}
          draggable={false}
          decoding="async"
          className={zoom > ZOOM_MIN ? 'zoomed' : undefined}
          style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}
          onClick={onImageClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      {count > 1 ? (
        <>
          <button type="button" className="lightbox-btn lightbox-nav prev" onClick={() => go(-1)} aria-label="รูปก่อนหน้า" title="รูปก่อนหน้า (←)">
            {ICON.prev}
          </button>
          <button type="button" className="lightbox-btn lightbox-nav next" onClick={() => go(1)} aria-label="รูปถัดไป" title="รูปถัดไป (→)">
            {ICON.next}
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
