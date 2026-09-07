"use client";

/**
 * หนึ่งแถวของตาราง เมื่ออยู่บนมือถือ
 *
 * ตารางหกคอลัมน์บนจอกว้าง 390px ทำได้สองทาง: บีบคอลัมน์จนอ่านไม่ออก หรือให้เลื่อน
 * ข้าง · ทางแรกทิ้งข้อมูล ทางหลังทิ้งคนอ่าน — พอเลื่อนไปคอลัมน์ที่สี่ ชื่อสินค้าที่
 * คอลัมน์แรกออกนอกจอไปแล้ว แถวที่กำลังอ่านจึงไม่มีชื่อ
 *
 * การ์ดแก้ด้วยการเปลี่ยนแกน: ตารางอ่านข้าม *แถว* เพื่อเทียบกัน การ์ดอ่านลง *ล่าง*
 * ทีละใบ · บนมือถือคนไม่ได้มาเทียบสิบแถว เขามาหาแถวเดียวแล้วทำอะไรกับมัน
 *
 * โครงเดียวกับการ์ด `Kv` ที่ฝั่งหน้าร้านใช้อยู่ — ป้ายซ้าย ค่าขวา — เพราะสองฝั่ง
 * นี้อยู่ในแอปเดียวกันและคนเดียวกันเปิดทั้งคู่
 *
 * **ไม่ได้แทนตาราง มันเป็นอีกร่างของข้อมูลชุดเดิม** · หน้าจอวาดทั้งสองอย่างแล้ว
 * ให้ CSS เลือกว่าจะโชว์อันไหน ไม่ได้ถาม JavaScript ว่าจอกว้างเท่าไร — คำตอบของ
 * คำถามนั้นตอนเรนเดอร์ฝั่งเซิร์ฟเวอร์คือ "ไม่รู้" แล้วจอจะกระพริบสลับร่างตอนโหลด
 */

/** คู่ป้าย–ค่าหนึ่งบรรทัดในการ์ด · ค่าว่างส่งเป็น null แล้วบรรทัดนั้นจะไม่ถูกวาด */
export type Field = { label: string; value: React.ReactNode } | null | false;

/**
 * กล่องครอบการ์ดทั้งกอง — โชว์เฉพาะบนมือถือ
 *
 * `aria-hidden` ไม่ได้ใส่ให้ฝั่งไหนเลย เพราะทั้งสองร่างมีอันเดียวที่ถูกวาดจริงใน
 * สายตาโปรแกรมอ่านหน้าจอ: `display: none` เอาออกจากทั้งภาพและเสียงอยู่แล้ว
 */
export function CardList({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <ul className="reccards phone-only" aria-label={label}>
      {children}
    </ul>
  );
}

/**
 * การ์ดหนึ่งใบ = หนึ่งแถว
 *
 * `onOpen` ทำให้ทั้งใบกดได้ ซึ่งเป็นเป้าที่ใหญ่ที่สุดที่หน้าจอให้ได้ · หน้าที่แถว
 * ไม่ได้เปิดอะไร (สมุดความเคลื่อนไหว) ไม่ต้องส่งมา แล้วการ์ดจะไม่ทำท่าว่ากดได้
 */
export default function RecordCard({
  head,
  title,
  sub,
  fields,
  actions,
  total,
  onOpen,
  tone,
}: {
  /** มุมขวาบน — ป้ายสถานะ วันที่ หรือจำนวนเงิน สิ่งที่ตาไปก่อนชื่อ */
  head?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  fields: Field[];
  /** ปุ่มของแถวนี้ ชิดขวาล่างการ์ด ไม่ใช่ไอคอนเล็กมุมขวาบน */
  actions?: React.ReactNode;
  /** บรรทัดยอดรวมก่อนถึงปุ่ม — ตัวเลขที่คนเปิดการ์ดมาหา */
  total?: React.ReactNode;
  onOpen?: () => void;
  /** เน้นว่าแถวนี้มีอะไรค้างอยู่ — ใช้สีเดียวกับ `grid__row--pending` ของตาราง */
  tone?: "pending" | "muted";
}) {
  const rows = fields.filter(Boolean) as { label: string; value: React.ReactNode }[];

  const body = (
    <>
      <div className="reccard__head">
        <div className="reccard__who">
          <span className="reccard__title">{title}</span>
          {sub ? <span className="reccard__sub">{sub}</span> : null}
        </div>
        {head ? <div className="reccard__mark">{head}</div> : null}
      </div>

      {rows.length > 0 ? (
        <dl className="reccard__kv">
          {rows.map((f, i) => (
            <div className="reccard__pair" key={`${f.label}-${i}`}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </>
  );

  const cls = [
    "reccard",
    tone === "pending" ? "reccard--pending" : "",
    tone === "muted" ? "reccard--muted" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={cls}>
      {onOpen ? (
        /* ปุ่มครอบเฉพาะส่วนที่อ่าน ไม่ครอบแถวปุ่มข้างล่าง — ปุ่มซ้อนในปุ่มเป็น HTML
           ที่เบราว์เซอร์ไม่รับ และการกดปุ่มลบก็จะเปิดหน้ารายละเอียดไปด้วย */
        <button type="button" className="reccard__open" onClick={onOpen}>
          {body}
        </button>
      ) : (
        <div className="reccard__open reccard__open--flat">{body}</div>
      )}

      {total ? <div className="reccard__total">{total}</div> : null}

      {actions ? <div className="reccard__act">{actions}</div> : null}
    </li>
  );
}
