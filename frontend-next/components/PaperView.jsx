'use client';
/**
 * กรอบสำหรับ "กระดาษขนาดคงที่" บนจอที่แคบกว่ากระดาษ
 *
 * ใบสั่งซื้อ / ใบเสร็จ / ใบสายตา วาดด้วยหน่วย mm ตายตัว (210×297, 297×210,
 * 180×55) เพราะมันต้องออกมาตรงกับกระดาษจริงเป๊ะ ๆ ตอนพิมพ์ · แต่บนโทรศัพท์
 * กระดาษกว้าง 297mm = 1123px ซึ่งกว้างกว่าจอ 390px เกือบสามเท่า
 *
 * แล้วทำไมถึง "เลื่อนดูไม่ได้" ทั้งที่มันล้นออกไป — `globals.css` ตั้ง
 * `html,body{overflow-x:clip}` ไว้เป็นตาข่ายกันตกของทั้งเว็บ (กันหน้าเพจ
 * ไถซ้าย-ขวาเพราะการ์ดใบเดียวกว้างเกิน) `clip` ไม่สร้าง scroll container
 * ส่วนที่ล้นจึงถูก "ตัดทิ้ง" ไม่ใช่ "เลื่อนไปดูได้" · สองในสามของใบเสร็จ
 * เลยหายไปเฉย ๆ บนมือถือ โดยไม่มีแถบเลื่อนให้กดด้วยซ้ำ
 *
 * ห้ามแก้ด้วยการปลด overflow-x:clip ทิ้ง — มันคุมทั้งเว็บอยู่ และ e2e/audit.js
 * อ้างอิงมันตรง ๆ (ดูคอมเมนต์ของ findOverflow) · ทางแก้คือให้กระดาษที่กว้าง
 * เกินจอมีที่เลื่อนของตัวเอง ซึ่งเป็น scroll container ซ้อนที่ `clip` ของ
 * html/body ไม่เกี่ยว
 *
 * สองโหมด โผล่เฉพาะตอนจอแคบกว่ากระดาษจริง ๆ (เดสก์ท็อปไม่เห็นอะไรเปลี่ยน):
 *   ย่อพอดีจอ (ค่าตั้งต้น)  ย่อทั้งใบด้วย transform:scale ให้เห็นครบทั้งแผ่น
 *                          ตัวหนังสือเล็กมาก แต่ถีบสองนิ้วซูมอ่านได้ตามปกติ —
 *                          การซูมแบบนั้นเป็นของ visual viewport ซึ่ง
 *                          overflow-x:clip ไม่ได้ห้ามไว้
 *   ขนาดจริง               ใบขนาดเต็ม อยู่ในกล่องที่ไถซ้าย-ขวาได้ อ่านทีละส่วน
 *
 * ทำไมต้องวัดด้วย JS แทนที่จะเขียน CSS อย่างเดียว: อัตราส่วนย่อคือ
 * "ความกว้างจอ ÷ ความกว้างกระดาษ" ซึ่งเป็นตัวเลขไร้หน่วย CSS คำนวณจาก
 * ความยาวสองค่าให้ไม่ได้ (`calc(100% / 297mm)` ไม่ใช่ค่าที่ scale รับ)
 *
 * ตอนพิมพ์ทั้งก้อนนี้ต้องไม่มีผล — กฎ `.paper-view` ทั้งหมดอยู่ใน @media screen
 * และมี @media print คอยล้าง height/transform ที่ติดมากับ inline style
 * ไม่งั้นกดพิมพ์จากมือถือแล้วจะได้กระดาษที่ย่อเหลือ 35%
 */
import { useEffect, useRef, useState } from 'react';

export function PaperView({ children }) {
  const boxRef = useRef(null);
  /** อัตราส่วนย่อ 1 = จอกว้างพอ ไม่ต้องย่อ (เดสก์ท็อป) */
  const [fit, setFit] = useState(1);
  /** ความสูงจริงของกระดาษเป็น px — transform ไม่กินที่ ต้องตั้งความสูงกรอบเอง */
  const [paperH, setPaperH] = useState(0);
  const [whole, setWhole] = useState(true);

  useEffect(() => {
    const box = boxRef.current;
    const paper = box?.firstElementChild;
    if (!box || !paper) return undefined;

    /* offsetWidth/Height เป็นขนาด layout ซึ่ง transform ไม่แตะ — วัดตอนย่ออยู่
       ก็ยังได้ขนาดกระดาษจริง จึงไม่เกิดวงวนกับ ResizeObserver */
    const measure = () => {
      const avail = box.clientWidth;
      const w = paper.offsetWidth;
      if (!avail || !w) return;
      setFit(Math.min(1, avail / w));
      setPaperH(paper.offsetHeight);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    ro.observe(paper);
    return () => ro.disconnect();
  }, []);

  /* 0.999 ไม่ใช่ 1 — clientWidth เป็นจำนวนเต็มที่ปัดมาแล้ว จอที่กว้างพอดีเป๊ะ
     จึงได้ค่าอย่าง 0.9997 ซึ่งไม่ควรนับว่า "แคบเกิน" */
  const tight = fit < 0.999;
  const shrink = tight && whole;

  const style = shrink
    ? { '--paper-fit': String(fit), height: `${Math.ceil(paperH * fit)}px` }
    : undefined;

  return (
    <>
      {tight ? (
        <div className="paper-zoom no-print">
          <span>กระดาษกว้างกว่าจอ</span>
          <button
            type="button"
            className={`btn btn-sm ${whole ? 'btn-light' : ''}`}
            onClick={() => setWhole(true)}
          >
            ย่อพอดีจอ
          </button>
          <button
            type="button"
            className={`btn btn-sm ${whole ? '' : 'btn-light'}`}
            onClick={() => setWhole(false)}
          >
            ขนาดจริง
          </button>
        </div>
      ) : null}

      <div
        ref={boxRef}
        className={`paper-view${shrink ? ' is-fit' : ''}${tight && !whole ? ' is-pan' : ''}`}
        style={style}
      >
        {children}
      </div>

      {shrink ? (
        <p className="paper-zoom-note no-print">
          ย่อไว้ {Math.round(fit * 100)}% ให้เห็นครบทั้งแผ่น — ถีบสองนิ้วเพื่อซูมอ่าน
          หรือกด “ขนาดจริง” แล้วไถซ้าย-ขวา · ตอนพิมพ์ออกมาเต็มขนาดเสมอ
        </p>
      ) : null}
    </>
  );
}
