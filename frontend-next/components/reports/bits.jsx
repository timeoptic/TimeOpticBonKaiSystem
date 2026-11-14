'use client';
/** ชิ้นส่วนเล็ก ๆ ที่หน้ารายงานทั้งหกใช้ร่วมกัน */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Card, Loading } from '../ui.jsx';
import { Icon } from '../Icon.jsx';
import { count, money } from '../../lib/format.js';
import {
  BUCKET_NAME, bucketFull, bucketLabel, filterQuery, rangeLabel,
} from '../../lib/reportRange.js';

/**
 * สามสถานะของหน้าที่โหลดข้อมูล — กำลังโหลด / พัง / มีข้อมูล
 *
 * ตอนโหลดซ้ำ (เปลี่ยนช่วงวันที่) ยังโชว์ของเดิมไว้แล้วหรี่ลง แทนที่จะกระพริบเป็น
 * หน้าว่างทุกครั้งที่ขยับตัวกรอง — ตัวกรองแบบ real time ที่ล้างจอทุกครั้งที่พิมพ์
 * อ่านว่าระบบค้าง
 */
export function ReportState({ loading, error, data, children }) {
  if (error) {
    return (
      <Card>
        <div className="empty">
          <Icon name="warning" /> โหลดรายงานไม่สำเร็จ — {String(error.message || error)}
        </div>
      </Card>
    );
  }
  if (!data) return loading ? <Loading /> : null;
  return <div className={loading ? 'report-stale' : ''}>{children}</div>;
}

/**
 * KPI ที่กดเข้าไปดูรายละเอียดได้
 *
 * ไม่มี `to` = การ์ดธรรมดา ไม่ใช่ลิงก์ที่กดแล้วไม่ไปไหน — ตัวชี้เมาส์ที่เปลี่ยน
 * เป็นมือแล้วกดไม่ได้อะไร คือคำสัญญาที่ผิด
 */
export function DrillKpi({ label, value, sub, to, kind = '', icon = null }) {
  const body = (
    <>
      <div className="k-label">
        {icon ? <Icon name={icon} /> : null}{label}
        {to ? <span className="k-go" aria-hidden="true">›</span> : null}
      </div>
      <div className="k-value">{value}</div>
      {sub ? <div className="k-sub">{sub}</div> : null}
    </>
  );
  if (!to) return <div className={`kpi ${kind}`}>{body}</div>;
  return <Link className={`kpi kpi-link ${kind}`} href={to}>{body}</Link>;
}

/**
 * ช่วงนี้ไม่มีบิลสักใบ — บอกว่าทำไม แล้วเสนอทางออก
 *
 * หน้าที่ขึ้น ฿0 กับตารางว่างเปล่า แยกไม่ออกระหว่าง "วันนี้ยังไม่มีลูกค้า" กับ
 * "รายงานพัง" · คนที่เห็นจะเดาอย่างหลัง แล้วโทรมาถาม · ตรงนี้จึงบอกตรง ๆ ว่า
 * ร้านมีข้อมูลอยู่ช่วงไหน พร้อมปุ่มกระโดดไปช่วงนั้นทันที
 *
 * ไม่มีบิลเลยทั้งร้าน (ระบบเพิ่งติดตั้ง) เป็นคนละข้อความ — ไม่มีช่วงไหนให้เสนอ
 */
export function NoData({ bounds, channel, what = 'บิล' }) {
  const router = useRouter();
  const pathname = usePathname();

  if (!bounds?.first) {
    return (
      <Card>
        <div className="no-data">
          <div className="nd-icon"><Icon name="chart" /></div>
          <b>ยังไม่มี{what}ในระบบ</b>
          <p className="muted">
            รายงานจะเริ่มมีตัวเลขเมื่อมีการเปิดออเดอร์หรือขายหน้าร้านใบแรก
          </p>
        </div>
      </Card>
    );
  }

  const all = { from: bounds.first, to: bounds.last, channel };
  return (
    <Card>
      <div className="no-data">
        <div className="nd-icon"><Icon name="calendar" /></div>
        <b>ไม่มี{what}ในช่วงที่เลือก</b>
        <p className="muted">
          ข้อมูลที่ร้านมีอยู่ตอนนี้คือช่วง <b>{rangeLabel(bounds.first, bounds.last)}</b>
        </p>
        <button
          type="button"
          className="btn btn-accent"
          onClick={() => router.replace(`${pathname}?${filterQuery(all)}`, { scroll: false })}
        >
          <Icon name="search" /> ดูข้อมูลทั้งหมดที่มี
        </button>
      </div>
    </Card>
  );
}

/**
 * งานรอส่งมอบ — คู่กับโหมด "นับตาม: วันปิดบิล"
 *
 * บิลที่ยังไม่ส่งมอบไม่มีวันปิด จึงไม่อยู่ในยอดของเดือนไหนเลยในโหมดนั้น · บรรทัดนี้
 * บอกว่ามันไม่ได้หาย แค่ยังไม่ถึงวันที่ถูกนับ · API ส่ง `pending: null` เมื่อไม่
 * เกี่ยว (โหมดวันเปิดบิลนับใบพวกนี้รวมในยอดอยู่แล้ว) จึงไม่ต้องเช็กโหมดซ้ำที่นี่
 */
export function PendingNote({ pending }) {
  if (!pending?.bills) return null;
  return (
    <div className="report-note">
      <b>งานรอส่งมอบ {count(pending.bills)} ใบ · {money(pending.revenue)}</b>
      {' '}— ยังไม่ปิดบิล จึงยังไม่นับในยอดขายของช่วงนี้ (นับทั้งร้าน ณ ตอนนี้ ไม่ขึ้นกับช่วงวันที่)
      {pending.balance > 0 ? ` · ยังค้างชำระ ${money(pending.balance)}` : ''}
      {' '}· สลับ “นับตาม” เป็นวันเปิดบิลเพื่อดูแบบรวมงานที่ยังไม่ส่งมอบ
    </div>
  );
}

/**
 * แปลงแถวรายวัน/สัปดาห์/เดือนจาก API เป็นข้อมูลที่กราฟแท่งกิน
 *
 * API เลือกความละเอียดมาให้แล้ว (ดู SalesReport::bucketFor) และติดมากับแต่ละแถว
 * ที่ฟิลด์ `bucket` — หน้าเว็บไม่เดาเองจากจำนวนจุด เพราะสองที่ที่ตัดสินใจแยกกัน
 * จะให้กราฟรายเดือนที่ป้ายเขียนเป็นรายวัน
 */
export function toSeries(rows, pick) {
  return (rows || []).map((r) => ({ ...bucketNames(r), value: pick(r) }));
}

/** เหมือน toSeries แต่สำหรับกราฟแท่งซ้อน ซึ่งกินหลายค่าต่อหนึ่งแท่ง */
export function toStacked(rows, parts) {
  return (rows || []).map((r) => ({ ...bucketNames(r), parts: parts(r) }));
}

function bucketNames(r) {
  const b = r.bucket || 'day';
  const to = r.date_end || r.date;
  return { label: bucketLabel(b, r.date, to), full: bucketFull(b, r.date, to) };
}

/** ชื่อความละเอียดของแกน — วางมุมการ์ดให้รู้ว่าหนึ่งแท่งคือช่วงเท่าไหร่ */
export function bucketNote(rows) {
  const b = rows?.[0]?.bucket;
  return b ? BUCKET_NAME[b] || null : null;
}

/**
 * ช่องค้นหาเหนือตาราง
 *
 * กรองที่ฝั่งหน้าเว็บจากแถวที่โหลดมาแล้ว ไม่ยิง API ใหม่ — รายงานหนึ่งช่วงมีหลัก
 * ร้อยถึงพันแถว การกรองในหน่วยความจำจึงตอบทันทีทุกตัวอักษร ขณะที่การยิงใหม่
 * ทุกตัวอักษรจะได้ทั้งความหน่วงและภาระที่ฐานข้อมูลโดยไม่ได้อะไรกลับมา
 */
export function TableSearch({ value, onChange, placeholder = 'ค้นหาในตาราง…', count = null }) {
  return (
    <div className="table-search no-print">
      <Icon name="search" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {count !== null ? <span className="muted">{count} แถว</span> : null}
    </div>
  );
}

/** กรองแถวด้วยคำค้น — เทียบกับทุกค่าที่เป็นข้อความหรือตัวเลขในแถว */
export function filterRows(rows, term) {
  const q = String(term || '').trim().toLowerCase();
  if (!q) return rows;
  return (rows || []).filter((r) => Object.values(r).some(
    (v) => v !== null && v !== undefined && typeof v !== 'object'
      && String(v).toLowerCase().includes(q),
  ));
}
