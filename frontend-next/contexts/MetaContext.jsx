'use client';
/**
 * /api/meta holds every dropdown the app needs — staff, case statuses,
 * suppliers, booking vocabulary. Fetched once at boot and shared through
 * context; reload() refreshes it after adding an employee or supplier.
 * Port of frontend/src/api/meta.jsx.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/apiClient.js';

const EMPTY = {
  lists: {}, employees: [], statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '', now: '',
};

const MetaContext = createContext({ meta: EMPTY, reload: async () => {}, ready: false, error: null });

/**
 * จำคำตอบล่าสุดไว้ในแท็บ เพื่อไม่ให้ทุกการโหลดหน้าใหม่ต้องรอเน็ตอีกรอบ
 *
 * วัดจากเครื่องจริง: การโหลดหน้าหนึ่งครั้งเสียเวลาไปกับ API สามทอดที่วิ่งต่อกัน
 * (`auth/me` → `meta` → ข้อมูลของหน้า) รวม ~210ms จาก ~277ms ที่กว่าเนื้อหาจะขึ้นจอ
 * ส่วน HTML กับ JS ใช้ไปแค่ ~60ms · `meta` คือรายการ dropdown ที่แทบไม่เปลี่ยน
 * ระหว่างวัน จึงคุ้มที่จะใช้ของเดิมวาดจอก่อนแล้วค่อยเช็กของใหม่เงียบ ๆ ข้างหลัง
 *
 * `sessionStorage` ไม่ใช่ `localStorage` โดยตั้งใจ — อายุเท่าแท็บที่เปิดอยู่
 * ปิดแท็บแล้วเริ่มใหม่หมด และไม่ข้ามไปหาคนที่มาใช้เครื่องเดียวกันต่อ
 *
 * เขียน/อ่านหุ้ม try ไว้ทั้งคู่: โหมดส่วนตัวของบางเบราว์เซอร์โยน error ตั้งแต่ตอน
 * แตะ sessionStorage และแคชที่พังต้องไม่ทำให้ทั้งหน้าเปิดไม่ได้
 */
const CACHE_KEY = 'timeoptic.meta.v1';

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    /* เต็มหรือถูกปิดไว้ — ไม่ใช้แคชรอบนี้ก็แค่ช้าเท่าเดิม */
  }
}

export function MetaProvider({ children }) {
  /* อ่านแคชตอน mount ครั้งแรกเท่านั้น ไม่ใช่ทุกครั้งที่ render — และต้องเป็น
     ฟังก์ชันใน useState ไม่งั้น sessionStorage ถูกแตะตอน SSR แล้วพัง */
  const [cached] = useState(() => (typeof window === 'undefined' ? null : readCache()));
  const [meta, setMeta] = useState(cached ?? EMPTY);
  const [ready, setReady] = useState(cached !== null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    const data = await api.get('/api/meta');
    setMeta({ ...EMPTY, ...data });
    writeCache(data);
    return data;
  }, []);

  useEffect(() => {
    let alive = true;
    reload()
      .then(() => alive && setReady(true))
      .catch((e) => {
        /* มีของเก่าอยู่แล้วก็ใช้ต่อไป ไม่ต้องขึ้นหน้าจอ error ให้คนกลางคัน —
           คำขอถัดไปที่ผู้ใช้กดจริงจะเป็นตัวบอกเองว่าเน็ตหรือ session มีปัญหา */
        if (alive && cached === null) setError(e);
      });
    return () => { alive = false; };
  }, [reload, cached]);

  return (
    <MetaContext.Provider value={{ meta, reload, ready, error }}>
      {children}
    </MetaContext.Provider>
  );
}

export const useMeta = () => useContext(MetaContext);

export function useBookingLabels() {
  const { meta } = useMeta();
  const b = meta.booking || {};
  const of = (list, code) => ((list || []).find(([c]) => c === code) || [null, code])[1];
  return {
    serviceTypes: b.service_types || [],
    statuses: b.statuses || [],
    channels: b.channels || [],
    intakeQuestions: b.intake_questions || [],
    serviceLabel: (c) => of(b.service_types, c),
    statusLabel: (c) => of(b.statuses, c),
    channelLabel: (c) => of(b.channels, c),
  };
}
