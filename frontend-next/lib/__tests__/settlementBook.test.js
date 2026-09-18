import test from 'node:test';
import assert from 'node:assert/strict';
import { settlementFileName, settlementSheets } from '../../stockmod/lib/settlementBook.ts';

/* ไฟล์ Excel ของหน้า "การเบิกจากสาขา" — ร้านขอไว้ 12 ก.ย. 2026: ตามสาขา มีชื่อเลนส์
   หมายเหตุ และสาขาที่เบิก · ฟังก์ชันนี้แปลงแถวจาก API เป็นชีต ส่วนการเขียนไฟล์จริงเป็นงาน
   ของ workbook.ts */

const row = (over) => ({
  id: 1, branchId: 1, branchName: 'Ovara', takenBy: null, productId: 10, sku: 'LNS-0217',
  productName: 'Hitop MC Single Vision (1.50) 0.00/0.00', quantity: 1, costTotal: 120,
  costUnknownQty: 0, issuedAt: '2026-09-12 13:25:51', issuedByName: 'Ja', status: 'pending',
  statusLabel: 'ค้างรับ', settledAmount: null, settledAt: null, settledByName: null,
  settledNote: null, note: '42591', profit: null,
  ...over,
});

const rows = [
  row({ id: 3, branchName: 'สาขาแพไม้', issuedAt: '2026-09-12 13:05:10', quantity: 2, costTotal: 300, note: '2677' }),
  row({ id: 2, branchName: 'Ovara', issuedAt: '2026-09-12 13:25:51', note: '42591' }),
  row({ id: 1, branchName: 'Ovara', issuedAt: '2026-09-11 09:07:06', productName: null, sku: 'LNS-0145', costUnknownQty: 1, costTotal: 0, note: null, takenBy: 'คุณเอ' }),
];

/* ชื่อสาขาเรียงแบบภาษาไทย (Intl.Collator 'th') — ชื่อไทยขึ้นก่อนชื่ออังกฤษ ตามที่คนไทยอ่าน */
test('ชีตรายการเบิก: เรียงเป็นก้อนตามสาขา แล้วตามเวลาเบิก มีแถวรวมย่อยของแต่ละสาขา', () => {
  const [, detail] = settlementSheets(rows);
  assert.equal(detail.name, 'รายการเบิก');
  assert.equal(detail.groupBy, 0, 'จัดกลุ่มด้วยคอลัมน์สาขา');
  assert.deepEqual(
    detail.columns.map((c) => c.header),
    ['สาขา', 'วันที่เบิก', 'เวลา', 'ผู้รับของ', 'SKU', 'ชื่อสินค้า / เลนส์', 'จำนวน', 'ต้นทุนรวม', 'หมายเหตุ', 'บันทึกโดย'],
  );
  assert.deepEqual(detail.rows.map((r) => [r[0], r[4]]), [
    ['สาขาแพไม้', 'LNS-0217'],
    ['Ovara', 'LNS-0145'],
    ['Ovara', 'LNS-0217'],
  ], 'ก้อนสาขาแพไม้ แล้วก้อน Ovara ที่เรียงจากใบที่เบิกก่อน');
});

test('แถวรายการ: วันที่กับเวลาเป็นค่าจริงของ Excel ตามเวลาที่ฐานเก็บ · ชื่อสินค้าว่างใช้ SKU · หมายเหตุครบ', () => {
  const [, detail] = settlementSheets(rows);
  const find = (branch, sku) => detail.rows.find((r) => r[0] === branch && r[4] === sku);
  const first = find('Ovara', 'LNS-0145');
  const second = find('Ovara', 'LNS-0217');

  assert.ok(first[1] instanceof Date, 'วันที่เป็น Date');
  assert.equal(first[1].toISOString(), '2026-09-11T00:00:00.000Z', 'วันที่ไม่เลื่อนตามโซนเวลาเครื่อง');
  assert.ok(Math.abs(first[2] - (9 * 3600 + 7 * 60 + 6) / 86400) < 1e-9, 'เวลาเป็นเศษส่วนของวัน');
  assert.equal(first[3], 'คุณเอ', 'ผู้รับของ');
  assert.equal(first[5], 'LNS-0145', 'ไม่มีชื่อสินค้า ใช้ SKU แทน');
  assert.equal(first[8], null, 'ไม่มีหมายเหตุ');
  assert.equal(second[5], 'Hitop MC Single Vision (1.50) 0.00/0.00', 'ชื่อเลนส์');
  assert.equal(second[8], '42591', 'หมายเหตุ');
  assert.equal(second[9], 'Ja', 'บันทึกโดย');

  const fmt = Object.fromEntries(detail.columns.map((c) => [c.header, c]));
  assert.equal(fmt['วันที่เบิก'].format, 'dd/mm/yyyy');
  assert.equal(fmt['เวลา'].format, 'hh:mm');
  assert.equal(fmt['ต้นทุนรวม'].money, true);
  assert.equal(fmt['จำนวน'].total, true);
  assert.equal(fmt['ต้นทุนรวม'].total, true);
});

test('ชีตสรุปตามสาขา: สาขาละแถว นับใบ ชิ้น ต้นทุน และชิ้นที่ยังไม่รู้ต้นทุน', () => {
  const [summary] = settlementSheets(rows);
  assert.equal(summary.name, 'สรุปตามสาขา');
  assert.deepEqual(summary.columns.map((c) => c.header), ['สาขา', 'ใบเบิก', 'จำนวนชิ้น', 'ต้นทุนรวม', 'ชิ้นที่ยังไม่รู้ต้นทุน']);
  assert.deepEqual(summary.rows, [
    ['สาขาแพไม้', 1, 2, 300, 0],
    ['Ovara', 2, 2, 120, 1],
  ]);
});

test('ชื่อไฟล์บอกสาขาและช่วงวันที่ · ไม่เลือกคือทุกสาขา ทุกช่วงเวลา', () => {
  assert.equal(
    settlementFileName({ branchName: 'Ovara', from: '2026-09-01', to: '2026-09-12' }),
    'การเบิกจากสาขา Ovara 2026-09-01 ถึง 2026-09-12.xlsx',
  );
  assert.equal(
    settlementFileName({ branchName: null, from: null, to: null }),
    'การเบิกจากสาขา ทุกสาขา ทุกช่วงเวลา.xlsx',
  );
});
