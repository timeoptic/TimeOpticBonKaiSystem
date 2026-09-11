import ExcelJS from "exceljs";

/**
 * แดชบอร์ด ลงเป็นไฟล์ Excel จริง — ชีตละเรื่อง มีแถวรวม
 *
 * เคยเป็น CSV ซึ่งเปิดได้แต่มีชีตเดียว ไม่มีสี ไม่มีรูป และตัวเลขที่จัดรูปแบบ
 * แล้วรวมไม่ได้ · `.xlsx` คือไฟล์ zip ที่ข้างในเป็น XML หลายใบ เขียนเองไม่ไหว
 * จึงพึ่ง ExcelJS — เป็น dependency ตัวเดียวที่โปรเจกต์นี้ยอมรับเพื่อเรื่องนี้
 *
 * สิ่งที่ไฟล์นี้รับผิดชอบคือ "รูปร่างของสมุดงาน" เท่านั้น — ตัวเลขมาจากหน้าจอ
 * รูปกราฟมาจาก `chartimage.ts` · ที่นี่ไม่คำนวณอะไรเองสักตัว ยกเว้นแถวรวม
 * ซึ่งบวกจากแถวที่เพิ่งเขียนลงไป จึงตรงกับสิ่งที่อยู่บนชีตเสมอ
 */

/** ค่าหนึ่งช่อง — ตัวเลขลงเป็นตัวเลข ไม่ใช่ข้อความที่รวมไม่ได้ */
export type Cell = string | number | null;

/** คอลัมน์หนึ่งของชีต */
export type Column = {
  header: string;
  /** กว้างกี่ตัวอักษร — ExcelJS นับเป็นความกว้างของอักษรมาตรฐาน */
  width?: number;
  /** true = เป็นเงิน จัดรูปแบบทศนิยมสองตำแหน่งและมีตัวคั่นหลัก */
  money?: boolean;
  /** true = รวมยอดในแถวสุดท้าย · คอลัมน์ที่ไม่ใช่จำนวนไม่ควรถูกรวม */
  total?: boolean;
};

export type Sheet = {
  name: string;
  /** บรรทัดอธิบายใต้ชื่อชีต — บอกว่าตัวเลขชุดนี้นับอะไรและไม่นับอะไร */
  note?: string;
  columns: Column[];
  rows: Cell[][];
  /**
   * ภาพกราฟของชีตนี้ (data URL) — วางเรียงลงมาใต้ตาราง
   *
   * เป็นรายการ ไม่ใช่ใบเดียว เพราะตัวเลขชุดเดียวกันตอบได้สองคำถาม: แท่งอันดับ
   * บอกว่าใครมากที่สุด วงกลมบอกว่าใครกินไปกี่เปอร์เซ็นต์ของทั้งก้อน · ชีตที่
   * เป็นอนุกรมเวลา (รายวัน) มีใบเดียวตามเดิม — สัดส่วนของ "วันที่ 3" ไม่ใช่
   * คำถามที่ใครถาม
   *
   * เป็นรูป ไม่ใช่กราฟที่ Excel แก้ได้ และตั้งใจให้เป็นแบบนั้น — กราฟที่ Excel
   * แก้ได้ต้องมีช่วงเซลล์ของตัวเองให้ชี้ ซึ่งแปลว่าต้องเขียนตารางสรุปย่อ ๆ ลง
   * ไปใต้ตารางจริงอีกชุด · ตารางชุดนั้นคือสิ่งที่ถูกถอดออกไปแล้ว
   */
  charts?: string[];
  /**
   * คอลัมน์ที่ใช้จัดกลุ่ม — ทุกครั้งที่ค่าเปลี่ยน จะมีแถวรวมย่อยคั่น
   *
   * แถวต้องเรียงตามคอลัมน์นั้นมาแล้ว · ตัวเขียนไม่จัดเรียงให้ เพราะลำดับของแถว
   * ในชีตคือลำดับที่หน้าจอแสดง และการเรียงใหม่เงียบ ๆ จะทำให้ไฟล์กับจอไม่ตรงกัน
   */
  groupBy?: number;
};

const HEAD_FILL = "FF1F7A4D";
const NOTE_INK = "FF777777";
const TOTAL_FILL = "FFEFF5F1";
/* ยอดรวมย่อยจางกว่ายอดรวมท้ายตาราง — สองอย่างนี้คนละน้ำหนัก และถ้าสีเท่ากัน
   ตารางสี่สาขาจะอ่านเหมือนมียอดรวมท้ายตารางห้าอัน */
const SUB_FILL = "FFF7FAF8";

/** เขียนสมุดงานแล้วให้เบราว์เซอร์เซฟ */
export async function download(name: string, title: string, sheets: Sheet[]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TimeOptic";
  wb.created = new Date();

  for (const sheet of sheets) {
    writeSheet(wb, title, sheet);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // ปล่อยคืนทันที ไม่ใช่ตอนออกจากหน้า — กดสิบครั้งคือจองไว้สิบก้อน
  URL.revokeObjectURL(url);
}

function writeSheet(wb: ExcelJS.Workbook, title: string, sheet: Sheet): void {
  // ชื่อชีตของ Excel ห้ามเกิน 31 ตัวและห้ามมี : \ / ? * [ ]
  const name = sheet.name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);
  const ws = wb.addWorksheet(name);

  ws.mergeCells(1, 1, 1, Math.max(1, sheet.columns.length));
  const heading = ws.getCell(1, 1);
  heading.value = `${title} · ${sheet.name}`;
  heading.font = { bold: true, size: 13 };

  let at = 2;
  if (sheet.note) {
    ws.mergeCells(at, 1, at, Math.max(1, sheet.columns.length));
    const note = ws.getCell(at, 1);
    note.value = sheet.note;
    note.font = { size: 10, color: { argb: NOTE_INK } };
    at += 1;
  }
  at += 1; // เว้นบรรทัดว่างก่อนหัวตาราง

  const headRow = ws.getRow(at);
  sheet.columns.forEach((col, i) => {
    const cell = headRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
    cell.alignment = { vertical: "middle", horizontal: col.money ? "right" : "left" };
    ws.getColumn(i + 1).width = col.width ?? (col.money ? 16 : 22);
  });
  headRow.height = 22;

  /**
   * เขียนแถวข้อมูล พร้อมแถวรวมย่อยคั่นทุกครั้งที่ค่าในคอลัมน์ที่จัดกลุ่มเปลี่ยน
   *
   * ตารางที่มีสี่สาขาปนกันแล้วมีแค่ยอดรวมท้ายสุด ตอบได้แค่ "ทั้งหมดเท่าไร" ซึ่ง
   * ไม่ใช่คำถามที่คนเปิดไฟล์นี้ถาม — เขาถามว่าสาขาไหนเท่าไร แล้วต้องไปลากเลือก
   * แถวเองทีละก้อนเพื่อให้ Excel บอก
   *
   * ยอดรวมย่อยเป็น SUM ของบล็อกตัวเอง และยอดรวมท้ายตารางเป็นผลบวกของยอดย่อย
   * ไม่ใช่ SUM ทับทั้งคอลัมน์ — SUM ทับทั้งคอลัมน์จะนับยอดย่อยซ้ำเข้าไปอีกรอบ
   */
  const firstDataRow = at + 1;
  const subtotals: number[] = [];
  let write = firstDataRow;
  let blockFrom = firstDataRow;

  const totalRow = (label: string, from: number, to: number, sub: boolean): void => {
    const line = ws.getRow(write);
    line.getCell(1).value = label;
    sheet.columns.forEach((col, i) => {
      const cell = line.getCell(i + 1);
      if (col.total) {
        const letter = ws.getColumn(i + 1).letter;
        cell.value = { formula: `SUM(${letter}${from}:${letter}${to})` };
        cell.numFmt = col.money ? "#,##0.00" : "#,##0";
      }
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sub ? SUB_FILL : TOTAL_FILL } };
      cell.border = { top: { style: "thin" } };
    });
    if (sub) subtotals.push(write);
    write += 1;
  };

  sheet.rows.forEach((row, r) => {
    const key = sheet.groupBy === undefined ? null : String(row[sheet.groupBy] ?? "");
    const prev =
      sheet.groupBy === undefined || r === 0
        ? key
        : String(sheet.rows[r - 1][sheet.groupBy] ?? "");

    if (key !== null && r > 0 && key !== prev) {
      totalRow(`รวม ${prev}`, blockFrom, write - 1, true);
      blockFrom = write;
    }

    const line = ws.getRow(write);
    row.forEach((v, i) => {
      const cell = line.getCell(i + 1);
      cell.value = v;
      if (sheet.columns[i]?.money) cell.numFmt = "#,##0.00";
      else if (typeof v === "number") cell.numFmt = "#,##0";
    });
    write += 1;
  });

  const lastDataRow = write - 1;

  if (sheet.rows.length > 0 && sheet.groupBy !== undefined) {
    const last = String(sheet.rows[sheet.rows.length - 1][sheet.groupBy] ?? "");
    totalRow(`รวม ${last}`, blockFrom, write - 1, true);
  }

  /**
   * แถวรวมท้ายตาราง — เป็นสูตร ไม่ใช่ตัวเลขที่คิดไว้แล้ว
   *
   * คนที่เปิดไฟล์แล้วลบแถวที่ไม่เกี่ยวออกสองแถว ควรเห็นยอดรวมขยับตาม · ตัวเลข
   * ตายตัวจะยังบอกยอดเดิมและกลายเป็นตัวเลขที่ผิดโดยไม่มีใครรู้
   */
  if (sheet.rows.length > 0 && sheet.columns.some((c) => c.total)) {
    const totals = ws.getRow(write);
    totals.getCell(1).value = "รวมทั้งหมด";
    sheet.columns.forEach((col, i) => {
      const cell = totals.getCell(i + 1);
      if (col.total) {
        const letter = ws.getColumn(i + 1).letter;
        // มียอดย่อยแล้วก็บวกยอดย่อย ไม่ใช่ SUM ทับทั้งคอลัมน์ซึ่งจะนับซ้ำ
        cell.value = {
          formula:
            subtotals.length > 0
              ? subtotals.map((n) => `${letter}${n}`).join("+")
              : `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})`,
        };
        cell.numFmt = col.money ? "#,##0.00" : "#,##0";
      }
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
      cell.border = { top: { style: "double" } };
    });
    write += 1;
  }

  // ตรึงหัวตารางไว้ ตารางยาว ๆ จะได้ยังรู้ว่าคอลัมน์ไหนคืออะไร
  ws.views = [{ state: "frozen", ySplit: at }];
  if (sheet.rows.length > 0) {
    ws.autoFilter = {
      from: { row: at, column: 1 },
      to: { row: lastDataRow, column: sheet.columns.length },
    };
  }

  // `write` เดินผ่านแถวรวมย่อยกับแถวรวมท้ายตารางมาแล้ว จึงเป็นบรรทัดว่างจริง
  // บรรทัดแรกใต้ตาราง ต่างจาก lastDataRow ซึ่งเป็นแถวข้อมูลแถวสุดท้าย
  let after = write + 2;
  for (const chart of sheet.charts ?? []) {
    after = placeChart(wb, ws, chart, after) + 1;
  }
}

/**
 * วางภาพหนึ่งใบลงชีต ที่แถวที่บอก กว้างครึ่งหน้ากระดาษพอดี
 *
 * คืนแถวสุดท้ายที่ภาพกินไปถึง เพื่อให้ภาพใบถัดไปเริ่มต่อจากนั้น ไม่ใช่ทับกัน ·
 * ภาพลอยอยู่เหนือเซลล์ Excel จึงไม่รู้เองว่ามันสูงกี่แถว — สูง 20px ต่อแถวเป็น
 * ค่าปริยายของ Excel และเผื่อไว้อีกสองแถวเป็นช่องไฟ
 */
function placeChart(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  dataUrl: string,
  row: number,
): number {
  const height = dataUrl.length > 0 ? heightOf(dataUrl) : 260;
  const id = wb.addImage({ base64: dataUrl, extension: "png" });
  ws.addImage(id, {
    tl: { col: 0, row: row - 1 },
    ext: { width: 720, height },
  });
  return row + Math.ceil(height / 20) + 2;
}

/**
 * ความสูงของภาพ อ่านจากตัว PNG เอง
 *
 * กราฟอันดับสูงตามจำนวนแถว ส่วนกราฟรายวันสูงคงที่ · ยัดทุกใบให้สูงเท่ากันคือ
 * ภาพที่ยืดหรือบี้ · PNG เก็บความกว้างกับความสูงไว้ที่ไบต์ 16–24 ของไฟล์เสมอ
 * (ก้อน IHDR) จึงอ่านได้โดยไม่ต้องรอโหลดภาพ
 */
function heightOf(dataUrl: string): number {
  const bin = atob(dataUrl.split(",")[1] ?? "");
  const w = (bin.charCodeAt(16) << 24) | (bin.charCodeAt(17) << 16) | (bin.charCodeAt(18) << 8) | bin.charCodeAt(19);
  const h = (bin.charCodeAt(20) << 24) | (bin.charCodeAt(21) << 16) | (bin.charCodeAt(22) << 8) | bin.charCodeAt(23);
  if (w <= 0 || h <= 0) return 260;
  return Math.round((720 * h) / w);
}
