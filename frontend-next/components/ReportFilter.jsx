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
import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icon } from './Icon.jsx';
import { api } from '../lib/apiClient.js';
import { useAsync } from '../lib/hooks.js';
import {
  CHANNELS, GROUPS, PERIODS, STATUSES, filterQuery, periodOf, rangeFor, readFilter,
} from '../lib/reportRange.js';
import DateRangeField from '@/stockmod/components/DateRangeField';
import { FilterBar } from './FilterBar.jsx';
import { Select } from './Selects.jsx';

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
    [name, f.from, f.to, f.channel, f.status, f.group],
  );
  return { filter: f, ...state };
}

/**
 * `statusNote` = หน้านี้ไม่ได้กรองตามสถานะงาน ให้บอกเหตุผลไว้ตรงกล่อง
 *
 * หน้าช่องทางลูกค้านับจากเคสทั้งหมดเพื่อคิดอัตราปิดการขาย — กล่องสถานะจึงไม่มีผล
 * กับหน้านั้น · ปิดกล่องทิ้งพร้อมบอกเหตุผล ดีกว่าปล่อยให้กดแล้วตัวเลขไม่ขยับ ซึ่ง
 * อ่านว่าระบบพัง (หน้าการรับเงินเคยปิดไว้เหมือนกัน ตอนนี้กรองตามสถานะของบิลที่เงิน
 * ก้อนนั้นผูกอยู่แล้ว)
 *
 * `channels` + `channelLabel` = ป้ายของช่องช่องทางสำหรับหน้าที่เรียกมันด้วยชื่ออื่น —
 * หน้าการรับเงินเรียก "แหล่งที่มา" · คีย์ยังเป็นชุดเดียวกับ CHANNELS เสมอ อีกหกหน้า
 * ไม่ส่งมาก็ได้ป้ายเดิม
 */
export function ReportFilter({
  actions = null, statusNote = '', channels = CHANNELS, channelLabel = 'ช่องทาง',
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const f = readFilter(params);
  const active = periodOf(f.from, f.to);

  const go = (next) => {
    router.replace(`${pathname}?${filterQuery({ ...f, ...next })}`, { scroll: false });
  };

  /* ตัวเลขบนปุ่ม "ตัวกรอง (N)" ของจอโทรศัพท์ — นับเฉพาะสิ่งที่ถูกเปลี่ยนจาก
     ค่าตั้งต้น (เดือนนี้ · ทุกช่องทาง · ทุกสถานะ) ไม่ใช่จำนวนช่องที่มีอยู่ */
  const activeFilters = (active === 'custom' ? 1 : 0)
    + (f.channel && f.channel !== 'all' ? 1 : 0)
    + (f.status && f.status !== 'all' ? 1 : 0)
    + (f.group && f.group !== 'all' ? 1 : 0);

  return (
    <FilterBar
      className="report-filter no-print"
      count={activeFilters}
      actions={actions}
      search={(
        <>
          {/* ปุ่มช่วงเวลาอยู่นอกแผ่นเสมอ — มันคือตัวกรองที่ถูกแตะบ่อยที่สุดของหน้านี้
              ถ้าต้องเปิดแผ่นก่อนถึงจะกด "เดือนที่แล้ว" ได้ ก็แปลว่าย้ายผิดที่
              แถบนี้เลื่อนแนวนอนในตัวมันเองบนจอแคบ (ข้อ 18 อนุญาตไว้เฉพาะแถบชิป) */}
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

          {/* ป้ายช่วงที่กำลังดู กลายเป็นปุ่มปฏิทินเอง — กดแล้วเลือกช่วงได้ทันที ไม่ต้องเปิดแผ่น */}
          <div className="fb-date rf-range-pick">
            <DateRangeField
              from={f.from}
              to={f.to}
              onApply={({ from, to }) => go({ from, to })}
            />
          </div>
        </>
      )}
    >

      <label className="rf-date">
        <span>{channelLabel}</span>
        <Select value={f.channel} onChange={(e) => go({ channel: e.target.value })} options={channels} />
      </label>

      <label className="rf-date" title={statusNote || 'งานที่จบแล้ว = ปิดการขาย / ลูกค้ารับของแล้ว'}>
        <span>สถานะงาน</span>
        <Select
          value={f.status}
          disabled={!!statusNote}
          onChange={(e) => go({ status: e.target.value })}
          options={STATUSES}
        />
      </label>

      {/* แบ่งด้วยกติกาเดียวกับกระดานงาน — ขายหน้าร้าน (POS) ไม่มีประเภทลูกค้า
          จึงนับเป็นลูกค้าร้าน และหายไปเมื่อเลือก SightFirst */}
      <label className="rf-date" title="ขายหน้าร้าน (POS) นับเป็นลูกค้าร้าน">
        <span>ประเภทลูกค้า</span>
        <Select value={f.group} onChange={(e) => go({ group: e.target.value })} options={GROUPS} />
      </label>

    </FilterBar>
  );
}

/**
 * ปุ่มส่งออกที่ทุกหน้ารายงานใช้เหมือนกัน
 *
 * PDF = สั่งพิมพ์ของเบราว์เซอร์แล้วเลือก "บันทึกเป็น PDF" ไม่ใช่สร้าง PDF เอง —
 * `globals.css` มีสไตล์สำหรับพิมพ์อยู่แล้ว และวิธีนี้ให้ผลที่พรีวิวเห็นก่อนพิมพ์ได้
 * โดยไม่ต้องลากไลบรารีสร้าง PDF เข้ามาทั้งก้อน
 *
 * `onExcel` คืน promise ได้ — หน้าภาพรวมให้เซิร์ฟเวอร์สร้างไฟล์ .xlsx ให้ ซึ่งกิน
 * เวลาพอที่คนกดจะกดซ้ำเพราะคิดว่าไม่ติด · ระหว่างรอปุ่มจึงเปลี่ยนข้อความและปิด
 * ตัวเอง ส่วนหน้าอื่นที่ประกอบ CSV ในเบราว์เซอร์เสร็จทันทีจะไม่ทันเห็นสถานะนี้
 */
export function ExportButtons({ onExcel, disabled }) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onExcel();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="btn btn-sm" onClick={run} disabled={disabled || busy}>
        <Icon name="chart" /> {busy ? 'กำลังสร้างไฟล์…' : 'Excel'}
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
