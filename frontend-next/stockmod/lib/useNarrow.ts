"use client";

import { useEffect, useState } from "react";

/**
 * จอแคบอยู่หรือเปล่า — วัดจาก media query ตัวเดียวกับที่ CSS ใช้ (40rem)
 *
 * มีไว้สำหรับของที่ CSS ตัดสินใจแทนไม่ได้ เช่น "กราฟนี้ควรมีกี่แท่ง" ซึ่งเป็น
 * เรื่องของข้อมูลที่ป้อนเข้าไป ไม่ใช่เรื่องของการจัดวาง · อะไรที่ซ่อนหรือย่อได้
 * ด้วย CSS ให้ทำใน globals.css เหมือนเดิม จะได้ไม่ต้องเรนเดอร์ใหม่ตอนหมุนจอ
 *
 * ตั้งต้นเป็น false เสมอ แล้วค่อยวัดหลัง mount — ตอน SSR ไม่มีจอให้วัด และการ
 * เดาไว้ก่อนคือการส่ง HTML ที่ไม่ตรงกับ client ออกไป
 */
export function useNarrow(query = "(max-width: 40rem)"): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const read = () => setNarrow(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, [query]);

  return narrow;
}
