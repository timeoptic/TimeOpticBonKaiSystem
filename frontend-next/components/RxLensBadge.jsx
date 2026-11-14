'use client';
/**
 * เลนส์สั่งตัด RX มาถึงร้านแล้วหรือยัง — ป้ายสำหรับหน้าร้าน (ร้านขอไว้ 14 ก.ย. 2026)
 *
 * คลังติ๊ก "เลนส์มาถึงแล้ว" บนหน้าใบสั่งตัด แล้วหน้าร้านเห็นเองโดยไม่ต้องเดินไปถาม:
 * กระดานงานกับรายการเคสใช้ `RxLensBadge` (นับทั้งเคส) ส่วนการ์ดเลนส์แต่ละข้างในหน้าเคส
 * ใช้ `RxArrival`
 */
import { Badge } from './ui.jsx';
import { Icon } from './Icon.jsx';
import { fmtDateTime } from '../lib/format.js';

/**
 * ป้ายต่อเคส จาก `rx_lens_arrived / rx_lens_total` ของ /api/cases
 * เคสที่ไม่ได้สั่งตัดไม่มีป้าย — ป้าย "0/0" คือข้อมูลที่ไม่มีใครถาม
 */
export function RxLensBadge({ row }) {
  const total = Number(row?.rx_lens_total) || 0;
  if (!total) return null;
  const arrived = Number(row?.rx_lens_arrived) || 0;
  if (arrived >= total) {
    return <Badge kind="ok"><Icon name="glasses" /> เลนส์เข้าแล้ว</Badge>;
  }
  return (
    <Badge kind="warn">
      <Icon name="glasses" /> {arrived ? `เลนส์เข้า ${arrived}/${total}` : 'รอเลนส์'}
    </Badge>
  );
}

/**
 * เลนส์สั่งตัดข้างเดียว บนการ์ดเลนส์ในหน้าเคส — `arrivedAt` null คือยังไม่มา
 *
 * เจียร์เสีย (ร้านขอ 30 ก.ย. 2026): คลังกดว่าเลนส์เสียตอนเจียร์ แล้วเลือกได้ว่าจะเปิดใบสั่งใหม่
 * แทนไหม · `scrappedAt` คือใบที่ผูกอยู่ตอนนี้เสียและยังไม่มีใบแทน — ป้ายแดง ไม่มี "รอเลนส์"
 * เพราะไม่มีเลนส์ที่กำลังมา · `scraps` คือใบของข้างนี้ที่เคยเสีย ใบที่ผูกอยู่คือใบที่สั่งแทน
 */
export function RxArrival({ arrivedAt, scrappedAt = null, scraps = [] }) {
  if (scrappedAt) {
    return (
      <Badge kind="danger" title={scrapTitle(scraps)}>
        {`เจียร์เสีย ${fmtDateTime(scrappedAt)} — คลังยังไม่ได้สั่งใหม่`}
      </Badge>
    );
  }
  return (
    <>
      {arrivedAt
        ? <Badge kind="ok"><Icon name="checkCircle" /> {`เลนส์เข้าแล้ว ${fmtDateTime(arrivedAt)}`}</Badge>
        : <Badge kind="warn">รอเลนส์</Badge>}
      {scraps.length ? (
        <Badge kind="danger" title={scrapTitle(scraps)}>
          {`สั่งใหม่แทน ${scraps[0].doc || 'ใบเดิม'} ที่เจียร์เสีย${scraps.length > 1 ? ` (เสีย ${scraps.length} ครั้ง)` : ''}`}
        </Badge>
      ) : null}
    </>
  );
}

/** ทุกใบที่เสียของข้างนี้ บรรทัดละใบ — ขึ้นตอนชี้ที่ป้าย */
const scrapTitle = (scraps) => scraps
  .map((s) => [s.doc, `เสีย ${fmtDateTime(s.scrapped_at)}`, s.note].filter(Boolean).join(' · '))
  .join('\n');
