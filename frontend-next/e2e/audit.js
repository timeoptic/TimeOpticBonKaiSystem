/**
 * ตัววัดที่รันอยู่ในหน้าเว็บจริง
 *
 * ทุกฟังก์ชันในไฟล์นี้ถูกส่งไปรันในเบราว์เซอร์ (page.evaluate) จึงเขียนเป็น
 * JavaScript ล้วน ๆ ที่ไม่อ้างอะไรจากฝั่ง Node เลย
 */

/**
 * element ที่ขอบขวาเลยจอ
 *
 * **ทำไมไม่ใช้ document.scrollWidth** — globals.css ตั้ง `html,body{overflow-x:clip}`
 * ไว้เป็นตาข่ายกันตก ผลคือ scrollWidth เท่ากับความกว้างจอเสมอ การเช็ค
 * `scrollWidth <= clientWidth` จึงผ่านตลอดกาลโดยไม่ได้ตรวจอะไร · ต้องไล่วัด
 * ทีละ element แล้วชี้ตัวการจริง
 *
 * ตัวที่ยกเว้นให้:
 *   · อยู่ในกล่องที่ตั้งใจให้เลื่อนแนวนอน (overflow-x: auto/scroll) เช่นแถบชิป
 *     ตัวกรอง กับคอลัมน์กระดานงาน — ข้อ 18 ของโจทย์อนุญาตไว้
 *   · ตัวที่พ่อแม่ก็ล้นด้วย — รายงานเฉพาะตัวนอกสุด ไม่งั้นการ์ดใบเดียวที่กว้างเกิน
 *     จะรายงานลูกหลานทั้งกิ่งเป็นร้อยบรรทัด
 */
export const findOverflow = () => {
  const vw = document.documentElement.clientWidth;
  const nameOf = (el) => {
    const cls = typeof el.className === 'string' ? el.className : (el.className?.baseVal || '');
    return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (cls ? `.${cls.trim().split(/\s+/).join('.')}` : '');
  };
  const overflows = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > vw + 1;
  };
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    return false;
  };

  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') continue;
    if (!overflows(el)) continue;
    if (inScroller(el)) continue;
    /* ตัวนอกสุดเท่านั้น — พ่อแม่ที่ล้นอยู่แล้วเป็นเจ้าของปัญหา */
    if (el.parentElement && el.parentElement !== document.body && overflows(el.parentElement)) continue;
    out.push({
      el: nameOf(el),
      right: Math.round(el.getBoundingClientRect().right),
      vw,
      text: (el.textContent || '').trim().slice(0, 40),
    });
    if (out.length >= 12) break;
  }
  return out;
};

/**
 * ช่องกรอกที่ตัวหนังสือเล็กกว่า 16px
 *
 * Safari บน iPhone ซูมหน้าจอเข้าเองทุกครั้งที่แตะช่องที่ font เล็กกว่า 16px
 * แล้ว **ไม่ซูมกลับ** — ผู้ใช้ต้องบีบนิ้วเองทุกครั้ง นี่คือข้อ 5 ของเกณฑ์รับงาน
 */
export const findTinyInputs = () => {
  const out = [];
  for (const el of document.querySelectorAll('input,select,textarea')) {
    if (el.type === 'hidden' || el.offsetParent === null) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 15.9) {
      out.push({ el: el.tagName.toLowerCase(), name: el.name || el.getAttribute('aria-label') || '', size });
    }
    if (out.length >= 12) break;
  }
  return out;
};

/**
 * ปุ่มที่เล็กกว่าเป้านิ้ว
 *
 * เกณฑ์ 44px มาจากคู่มือของ Apple และเป็นตัวเลขที่โจทย์ระบุ · วัดจากกล่องจริง
 * ไม่ใช่จาก CSS ที่ประกาศไว้ เพราะปุ่มที่ถูกบีบด้วย flex จะเล็กกว่าที่เขียนไว้
 *
 * ปุ่มที่ยกเว้นให้: ปุ่มในแถบเลขหน้า (.pg) ที่เป็นตัวเลขเรียงกันเป็นแถบ และปุ่ม
 * ในตารางฝั่งเดสก์ท็อป (.table-wrap) ซึ่งบนมือถือไม่ได้แสดงอยู่แล้ว
 */
export const findSmallTargets = (min) => {
  const out = [];
  const sel = 'button, a.btn, [role="button"], input[type="checkbox"], input[type="radio"]';
  for (const el of document.querySelectorAll(sel)) {
    if (el.offsetParent === null) continue;
    if (el.closest('.table-wrap')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < min || r.width < min) {
      const cls = typeof el.className === 'string' ? el.className : '';
      out.push({
        el: el.tagName.toLowerCase() + (cls ? `.${cls.trim().split(/\s+/).join('.')}` : ''),
        w: Math.round(r.width),
        h: Math.round(r.height),
        text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24),
      });
    }
    if (out.length >= 20) break;
  }
  return out;
};

/** กล่องที่เลื่อนได้ซ้อนอยู่ในหน้าที่เลื่อนได้ — ต้นเหตุของอาการ "ลากแล้วไม่ไป" */
export const findNestedScrollers = () => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    const scrolls = (s.overflowY === 'auto' || s.overflowY === 'scroll')
      && el.scrollHeight > el.clientHeight + 4
      && el.clientHeight > 0;
    if (!scrolls) continue;
    /* กล่องลอย (modal/sheet) มีตัวเลื่อนของตัวเองได้ตามข้อ 13 — มันคือหน้าจอ
       ทั้งจอชั่วคราว ไม่ใช่กล่องที่ซ้อนอยู่ในหน้า */
    if (el.closest('.modal-back, .sheet-back')) continue;
    const cls = typeof el.className === 'string' ? el.className : '';
    out.push({
      el: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (cls ? `.${cls.trim().split(/\s+/).join('.')}` : ''),
      h: el.clientHeight,
      scroll: el.scrollHeight,
    });
    if (out.length >= 10) break;
  }
  return out;
};

/** ตารางที่ยังโชว์เป็นตารางอยู่ทั้งที่จอแคบ — ข้อ 4 ของเกณฑ์รับงาน */
export const findVisibleTables = () => {
  const out = [];
  for (const el of document.querySelectorAll('table')) {
    if (el.offsetParent === null) continue;
    /* ตารางค่าสายตาถูกคลี่เป็นบล็อก R/L ด้วย display:block — ยังเป็น <table> ใน
       DOM แต่ไม่ได้วางตัวเป็นตารางแล้ว · ตารางยอดรวมท้ายการ์ดก็ตั้งใจให้เป็นตาราง */
    if (getComputedStyle(el).display !== 'table') continue;
    if (el.classList.contains('dt-cards-foot')) continue;
    const cols = el.querySelector('tr')?.children.length || 0;
    if (cols <= 3) continue;
    const cls = typeof el.className === 'string' ? el.className : '';
    out.push({ el: `table.${cls.trim().split(/\s+/).join('.')}`, cols });
  }
  return out;
};
