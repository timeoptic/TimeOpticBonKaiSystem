'use client';
/**
 * แถบตัวกรองของหน้ารายงาน — ช่วงวันที่ + ช่องทางขาย
 *
 * **สถานะอยู่ใน URL ไม่ใช่ใน useState** ตั้งใจให้เป็นแบบนั้น:
 *
 *   · สลับแท็บไปหน้ารายงานอื่น แล้วช่วงวันที่ไม่หาย (layout ไม่ remount ก็จริง
 *     แต่ state ที่อยู่ในหน่วยความจำหายทันทีที่รีเฟรช)
 *   · กดปุ่มย้อนกลับของเบราว์เซอร์ได้ผลอย่างที่คาด
 *   · ส่งลิงก์ให้เจ้าของร้านเปิด แล้วเห็นตัวเลขชุดเดียวกันเป๊ะ
 *
 * ใช้ `replace` ไม่ใช่ `push` ตอนกดปุ่มช่วงเวลา — กดสี่ปุ่มไล่ดูแล้วต้องกดย้อนกลับ
 * สี่ครั้งกว่าจะออกจากหน้ารายงาน คือประวัติที่ไม่มีใครอยากได้
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icon } from './Icon.jsx';
import { api } from '../lib/apiClient.js';
import { useAsync } from '../lib/hooks.js';
import {
  CHANNELS, PERIODS, filterQuery, periodOf, rangeFor, rangeLabel, readFilter,
} from '../lib/reportRange.js';

export function useReportFilter() {
  const params = useSearchParams();
  return readFilter(params);
}

/**
 * โหลดรายงานหนึ่งหน้าตามตัวกรองที่อยู่ใน URL
 *
 * ทุกหน้ารายงานเรียกอันนี้ตัวเดียว — ตัวกรองเปลี่ยนเมื่อไหร่โหลดใหม่เมื่อนั้น
 * โดยไม่ต้องมีปุ่ม "ค้นหา" ให้กด (สเปกขอ filter แบบ real time) · `useAsync`
 * ทิ้งผลของคำขอที่ถูกแซงแล้ว คำตอบเก่าที่มาช้าจึงเขียนทับคำตอบใหม่ไม่ได้
 */
export function useReport(name) {
  const f = useReportFilter();
  const state = useAsync(
    () => api.get(`/api/reports/${name}`, f),
    [name, f.from, f.to, f.channel],
  );
  return { filter: f, ...state };
}

export function ReportFilter({ actions = null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const f = readFilter(params);
  const active = periodOf(f.from, f.to);

  const go = (next) => {
    router.replace(`${pathname}?${filterQuery({ ...f, ...next })}`, { scroll: false });
  };

  return (
    <div className="report-filter no-print">
      <div className="rf-periods" role="group" aria-label="ช่วงเวลา">
        {PERIODS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={active === key ? 'on' : ''}
            /* "กำหนดเอง" ไม่ได้เปลี่ยนช่วง แค่บอกว่ากำลังจะกรอกเอง — กดแล้ว
               ช่วงเดิมค้างไว้ให้แก้ต่อ ไม่ใช่ถูกล้างจนต้องเริ่มใหม่ */
            onClick={() => (key === 'custom' ? null : go(rangeFor(key)))}
            aria-pressed={active === key}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="rf-date">
        <span>จาก</span>
        <input
          type="date"
          value={f.from}
          max={f.to}
          onChange={(e) => go({ from: e.target.value || f.from })}
        />
      </label>
      <label className="rf-date">
        <span>ถึง</span>
        <input
          type="date"
          value={f.to}
          min={f.from}
          onChange={(e) => go({ to: e.target.value || f.to })}
        />
      </label>

      <label className="rf-date">
        <span>ช่องทาง</span>
        <select value={f.channel} onChange={(e) => go({ channel: e.target.value })}>
          {CHANNELS.map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </label>

      <span className="rf-range" title="ช่วงที่กำลังดูอยู่">
        <Icon name="📅" /> {rangeLabel(f.from, f.to)}
      </span>

      <div className="rf-actions">{actions}</div>
    </div>
  );
}

/**
 * ปุ่มส่งออกที่ทุกหน้ารายงานใช้เหมือนกัน
 *
 * PDF = สั่งพิมพ์ของเบราว์เซอร์แล้วเลือก "บันทึกเป็น PDF" ไม่ใช่สร้าง PDF เอง —
 * `globals.css` มีสไตล์สำหรับพิมพ์อยู่แล้ว และวิธีนี้ให้ผลที่พรีวิวเห็นก่อนพิมพ์ได้
 * โดยไม่ต้องลากไลบรารีสร้าง PDF เข้ามาทั้งก้อน
 */
export function ExportButtons({ onCsv, disabled }) {
  return (
    <>
      <button type="button" className="btn btn-sm" onClick={onCsv} disabled={disabled}>
        <Icon name="📊" /> Excel
      </button>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => window.print()}
        disabled={disabled}
      >
        <Icon name="printer" /> PDF
      </button>
    </>
  );
}
