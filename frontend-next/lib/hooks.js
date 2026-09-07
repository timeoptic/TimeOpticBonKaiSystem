'use client';

/** Small hooks shared across pages. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { nowLocal } from './format.js';

/** Delay a fast-changing value (search boxes). */
export function useDebounced(value, ms = 240) {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

/**
 * Run an async loader and track its state.
 *
 * `deps` behaves like a useEffect dependency list. `reload()` re-runs it, which
 * is how pages refresh after a write. Results from a superseded run are
 * discarded so a slow response cannot overwrite a newer one.
 *
 * The loader is handed an AbortSignal; pass it to `api.get(path, query, signal)`
 * and a superseded request is actually **cancelled**, not merely ignored.
 * ทิ้งผลลัพธ์อย่างเดียวไม่พอตอนที่คำขอหนักจริง: พิมพ์ค้นหาบนกระดานงานเร็ว ๆ
 * ห้าตัวอักษร = ห้าคำขอที่เบราว์เซอร์ยังโหลดต่อจนจบทุกใบ แย่งช่องต่อกับคำขอ
 * ล่าสุดซึ่งเป็นใบเดียวที่จะได้แสดงผล · loader ที่ไม่รับ signal ยังใช้ได้เหมือนเดิม
 */
export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  const runId = useRef(0);

  useEffect(() => {
    const my = ++runId.current;
    let alive = true;
    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    Promise.resolve()
      .then(() => loader(ctl.signal))
      .then((data) => {
        if (!alive || my !== runId.current) return;
        setState({ data, error: null, loading: false });
      })
      .catch((error) => {
        if (!alive || my !== runId.current) return;
        /* ยกเลิกเองไม่ใช่ความผิดพลาดที่ต้องเอาไปแสดง — และเกิดตอนที่มีคำขอใหม่
           มาแทนอยู่แล้ว ปล่อย loading ค้างไว้ให้คำขอนั้นเป็นคนปิด */
        if (error?.name === 'AbortError') return;
        setState({ data: null, error, loading: false });
      });
    return () => { alive = false; ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

/**
 * เวลาปัจจุบันรูปแบบ 'YYYY-MM-DDTHH:MM' ที่เดินเอง
 *
 * มีไว้ให้ช่องเวลาที่ระบบเป็นคนประทับ ไม่ใช่คนกรอก — ถ้าค้างไว้ที่เวลาตอนเปิดหน้า
 * คนที่เปิดฟอร์มคาไว้ครึ่งชั่วโมงจะเห็นเวลาหนึ่งบนจอ แต่ที่ถูกบันทึกลงไปตอนกดบันทึก
 * เป็นอีกเวลาหนึ่ง · สิ่งที่เห็นกับสิ่งที่บันทึกต้องเป็นค่าเดียวกันเสมอ
 *
 * ส่ง active=false เมื่อมีเวลาที่บันทึกไว้แล้ว — นาฬิกาหยุดเดินและไม่มี interval
 * ค้างอยู่เปล่า ๆ (ค่าที่คืนยังใช้ได้ แต่ที่เรียกจะเอาค่าจากฐานไปแสดงแทนอยู่แล้ว)
 */
export function useNowLocal(active = true) {
  const [now, setNow] = useState(nowLocal);
  useEffect(() => {
    if (!active) return undefined;
    setNow(nowLocal());
    /* เดินทุก 15 วินาที ไม่ใช่ทุก 60 — จังหวะ 60 วินาทีที่ไม่ตรงกับหัวนาทีทำให้
       เวลาบนจอตามหลังนาฬิกาจริงได้เกือบเต็มนาที ซึ่งมองเห็นได้ด้วยตา */
    const t = setInterval(() => setNow(nowLocal()), 15000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/**
 * Uncontrolled-form helper: read a <form> into a plain object, the same way
 * the old formData() did — checkboxes become 1/0.
 */
export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    out[el.name] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
  }
  return out;
}

/** Wrap a submit handler with preventDefault + form reading. */
export function onSubmit(handler) {
  return (e) => {
    e.preventDefault();
    handler(readForm(e.currentTarget), e.currentTarget);
  };
}
