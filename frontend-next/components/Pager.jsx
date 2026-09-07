'use client';
/**
 * แถบแบ่งหน้าของทั้งแอป
 *
 * เดิมโค้ดก้อนนี้ถูกก๊อปไว้สองที่ (หน้าส่งมอบ กับ ProcessCaseList) เหมือนกันทุก
 * บรรทัดรวมทั้ง pageWindow · ตอนหน้าเมนูหลักต้องใช้เป็นที่ที่สาม จึงยกออกมา
 * ไว้ที่เดียว — ตรรกะตัวเลขอยู่ใน lib/pager.js (มีเทสต์) ที่นี่เหลือแต่หน้าตา
 *
 * ใช้คลาส .pager เดิมใน globals.css ทั้งหมด ไม่มีสไตล์ใหม่ สองหน้าเดิมจึงได้
 * แถบเดิมเป๊ะทุกพิกเซล
 */
import { useEffect, useState } from 'react';
import { DataTable } from './DataTable.jsx';
import { PAGE_SIZES, fitsOnePage, pageWindow } from '../lib/pager.js';
import { Select } from './Selects.jsx';

/**
 * `total` คือจำนวนแถวทั้งหมดหลังกรอง ไม่ใช่แถวบนหน้าจอ — ตัวเลข "จาก N รายการ"
 * ที่เปลี่ยนตามหน้าที่เปิดอยู่ไม่ใช่ยอดรวม
 *
 * `hideWhenFits` สำหรับที่ที่มีตัวเลขบอกจำนวนอยู่แล้ว (การ์ดในหน้าเมนูหลักมี
 * badge นับให้) — วันที่มีคิว 4 คิว แถบ "แสดง 1 - 4 จาก 4 รายการ ‹ 1 ›" ไม่ได้
 * ตอบอะไรที่ยังไม่รู้ · หน้าที่ pager คือผลของตัวกรอง (หน้าส่งมอบ) ไม่ต้องส่งมา
 *
 * เกณฑ์ซ่อนอยู่ที่ fitsOnePage ไม่ใช่ total <= perPage — ดูเหตุผลใน lib/pager.js
 *
 * `sizes` เผื่อไว้ให้กระดานงานที่ใช้ชุดใหญ่กว่า (BOARD_PAGE_SIZES) — เกณฑ์ซ่อน
 * ต้องวัดกับชุดที่โชว์จริง ไม่งั้นแถบจะหายไปทั้งที่ยังเลือกค่าที่เล็กกว่าได้
 */
export function Pager({
  total, page, perPage, onPage, onPerPage, hideWhenFits = false, sizes = PAGE_SIZES,
}) {
  if (!total) return null;
  if (hideWhenFits && fitsOnePage(total, sizes)) return null;

  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(page, pages);
  const from = total ? (current - 1) * perPage + 1 : 0;
  const to = Math.min(current * perPage, total);

  return (
    <div className="pager">
      <span>{`แสดง ${from} - ${to} จาก ${total} รายการ`}</span>
      <div className="pages">
        <button
          type="button"
          className="pg"
          disabled={current === 1}
          aria-label="หน้าก่อนหน้า"
          onClick={() => onPage(current - 1)}
        >
          ‹
        </button>
        {pageWindow(current, pages).map((n, i) => (n === '…' ? (
          <span className="pg-gap" key={`gap${i}`}>…</span>
        ) : (
          <button
            type="button"
            key={n}
            className={`pg ${n === current ? 'active' : ''}`}
            onClick={() => onPage(n)}
          >
            {n}
          </button>
        )))}
        <button
          type="button"
          className="pg"
          disabled={current === pages}
          aria-label="หน้าถัดไป"
          onClick={() => onPage(current + 1)}
        >
          ›
        </button>
      </div>
      <label className="pg-per">
        แสดง
        <Select
          value={perPage}
          onChange={(e) => onPerPage(Number(e.target.value))}
          options={sizes.map((n) => [n, String(n)])}
        />
        รายการ / หน้า
      </label>
    </div>
  );
}

/**
 * ตาราง + แถบแบ่งหน้า ที่จำหน้าของตัวเอง
 *
 * มีไว้ให้หน้าที่วางตารางหลายใบไว้ด้วยกัน (หน้าเมนูหลักมีสามใบ) ไม่ต้องถือ
 * state หน้าละสามชุด · หน้าที่มีตัวกรองของตัวเองยังควรใช้ <Pager> ตรง ๆ
 * เพราะต้องรีเซ็ตกลับหน้า 1 ตอนตัวกรองเปลี่ยน ซึ่งที่นี่ไม่รู้จัก
 *
 * รับ prop ของ DataTable ที่เหลือส่งต่อไปตรง ๆ — แถวที่ส่งเข้ามาคือแถวทั้งหมด
 * ไม่ใช่แถวของหน้าปัจจุบัน
 */
export function PagedTable({ rows, defaultPerPage = PAGE_SIZES[0], ...table }) {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(defaultPerPage);
  const all = rows || [];

  /* โหลดข้อมูลรอบใหม่แล้วแถวหดลง หรือเปลี่ยนจำนวนต่อหน้า — กลับไปหน้า 1
     ไม่งั้นค้างอยู่หน้าที่ไม่มีอยู่จริง (sliceOf กันตารางว่างไว้อีกชั้น) */
  useEffect(() => { setPage(1); }, [all.length, perPage]);

  return (
    <>
      <DataTable {...table} rows={all} page={page} perPage={perPage} />
      <Pager
        hideWhenFits
        total={all.length}
        page={page}
        perPage={perPage}
        onPage={setPage}
        onPerPage={setPerPage}
      />
    </>
  );
}
