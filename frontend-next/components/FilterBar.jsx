'use client';
/**
 * แถบค้นหา/ตัวกรอง ที่บนจอโทรศัพท์ยุบตัวเองเป็นแผ่นเลื่อนขึ้นจากขอบล่าง
 *
 * ── ปัญหาที่แก้ ────────────────────────────────────────────────────────────
 * หน้าที่มีตัวกรองสามสี่อันวางเรียงกันบนเดสก์ท็อป พอมาอยู่บนจอ 390px มันตกลง
 * มาเรียงกันในแนวตั้ง กล่องละ 44px รวมกับช่องค้นหาแล้วกินความสูงเกินครึ่งจอ
 * ก่อนที่ข้อมูลแถวแรกจะได้โผล่ · คนใช้ต้องเลื่อนผ่านตัวกรองที่ไม่ได้จะแตะ ทุกครั้ง
 * ที่เปิดหน้า
 *
 * ── ทำไมถึงเป็น display:contents ไม่ใช่การวาดสองชุด ────────────────────────
 * ทางที่ง่ายกว่าคือวาดแถบเดสก์ท็อปชุดหนึ่ง แผ่นมือถืออีกชุดหนึ่ง แล้วซ่อนอันที่
 * ไม่ใช้ด้วย CSS (แบบที่ DataTable ทำกับตาราง/การ์ด) · ที่นี่ทำแบบนั้นไม่ได้
 * เพราะตัวกรองเป็น <Select> ที่ถือ state ของตัวเอง (เปิด/ปิด, ตัวที่กำลังชี้อยู่)
 * วาดสองชุดคือมีสองตัวที่คิดว่าตัวเองเป็นกล่องเดียวกัน แล้วกล่องที่ซ่อนอยู่ยังกิน
 * โฟกัสจากคีย์บอร์ดได้
 *
 * `display:contents` ทำให้ `.fb-panel` หายไปจากการจัดวางโดยที่ลูกของมันยังอยู่ —
 * บนเดสก์ท็อปตัวกรองจึงเป็นลูกโดยตรงของ `.filter-bar` เหมือนเดิมทุกพิกเซล
 * พอจอแคบ `.fb-panel` กลับมาเป็นกล่องจริงที่ลอยอยู่ขอบล่าง โดยที่ลูกยังเป็น
 * อินสแตนซ์เดิมตัวเดิม ไม่ได้ถูก unmount แล้ว mount ใหม่
 *
 * ── prop ────────────────────────────────────────────────────────────────
 * `count`       จำนวนตัวกรองที่ไม่ได้เป็นค่าเริ่มต้น — ตัวเลขในวงเล็บบนปุ่ม
 * `resultCount` จำนวนแถวที่ตัวกรองปัจจุบันให้ผล — ปุ่มปิดแผ่นบอกตัวเลขนี้
 * `actions`     ปุ่มที่ไม่ใช่ตัวกรอง (เพิ่ม / ส่งออก) — อยู่แถวเดียวกับปุ่มตัวกรอง
 * `search`      ส่วนที่เห็นตลอดเวลาแม้แผ่นจะปิดอยู่ · ปกติคือช่องค้นหา แต่หน้ารายงาน
 *               ใส่แถบปุ่มช่วงเวลาลงมาแทน เพราะนั่นคือตัวกรองที่คนแตะบ่อยที่สุด
 * `className`   คลาสเพิ่มบนแถบ — หน้ารายงานใช้ `.report-filter` ที่มีสไตล์ของตัวเอง
 */
import { useEffect, useId, useState } from 'react';
import { Icon } from './Icon.jsx';

/**
 * ตัวแผ่นล้วน ๆ — ฉากมืด + กล่องที่ดันขึ้นจากขอบล่าง
 *
 * แยกออกมาเพราะกระดานงาน (/cases) มีโครงแถบตัวกรองของตัวเองสองชั้น
 * (.bf-row กับ .bf-groups) ที่เดสก์ท็อปพึ่งพาอยู่ — เอา <FilterBar> ไปครอบทั้งก้อน
 * จะรื้อหน้าเดสก์ท็อปทิ้ง · หน้านั้นจึงยืมเฉพาะแผ่นไปใช้ แล้วคุมปุ่มเปิดเอง
 *
 * บนเดสก์ท็อป .fb-panel/.fb-fields เป็น display:contents — ลูกที่ห่อไว้จึงโผล่
 * ออกมาเป็นลูกโดยตรงของแถบที่ครอบอยู่ เหมือนไม่มีชั้นนี้อยู่เลย
 */
export function FilterSheet({
  open,
  onClose,
  count = 0,
  resultCount = null,
  onReset = null,
  resetLabel = 'ล้างทั้งหมด',
  children,
  id,
}) {
  /* Esc ปิดแผ่น — ทางออกเดียวกับที่ลิ้นชักเมนูใช้ ผู้ใช้คีย์บอร์ดจะได้ไม่ติดอยู่ข้างใน */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /* กันหน้าข้างหลังเลื่อนตามนิ้วขณะแผ่นเปิดอยู่ · คืนค่าเดิมเสมอตอนปิด ไม่ใช่
     ตั้งเป็น '' เพราะหน้าอาจมีใครตั้ง overflow ไว้ก่อนแล้ว */
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <>
      {/* ฉากมืดหลังแผ่น — วาดเสมอแต่ไม่แสดงบนเดสก์ท็อป การถอด/ใส่ element ตาม
          state จะทำให้ทรานซิชันของแผ่นกระตุกรอบแรก */}
      <div className="fb-scrim" onClick={onClose} aria-hidden="true" />

      <div className="fb-panel" id={id}>
        <div className="fb-head">
          <b>ตัวกรอง</b>
          <button type="button" className="icon-btn fb-close" aria-label="ปิด" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="fb-fields">{children}</div>

        <div className="fb-foot">
          {onReset ? (
            <button type="button" className="btn btn-light" disabled={!count} onClick={onReset}>
              <Icon name="refresh" /> {resetLabel}
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {resultCount === null ? 'แสดงผล' : `แสดงผล ${resultCount} รายการ`}
          </button>
        </div>
      </div>
    </>
  );
}

export function FilterBar({
  search = null,
  className = '',
  count = 0,
  resultCount = null,
  onReset = null,
  resetLabel = 'ล้างทั้งหมด',
  actions = null,
  children,
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className={`filter-bar ${className} ${open ? 'fb-open' : ''}`.replace(/\s+/g, ' ').trim()}>
      {search}

      <button
        type="button"
        className={`btn btn-light fb-toggle ${count ? 'on' : ''}`.trim()}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(true)}
      >
        <Icon name="filter" />
        {count ? `ตัวกรอง (${count})` : 'ตัวกรอง'}
      </button>

      {actions ? <div className="fb-actions">{actions}</div> : null}

      <FilterSheet
        id={panelId}
        open={open}
        onClose={() => setOpen(false)}
        count={count}
        resultCount={resultCount}
        onReset={onReset}
        resetLabel={resetLabel}
      >
        {children}
      </FilterSheet>
    </div>
  );
}
