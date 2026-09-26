"use client";

/**
 * Bewell: "ใช้เลนส์ / ตัดเลนส์" บนหน้าความเคลื่อนไหว
 *
 * ไม่ใช่ความเคลื่อนไหวของคลัง — เลนส์ของ Bewell ไม่มีสต็อก ข้อมูลจึงมาจากใบเบิกเลนส์ที่ยืนยัน
 * ขั้นขายแล้ว (API ฝั่งหน้าร้าน /api/lens-usage) ไม่ใช่ inventory_logs · ไม่มียอดคงเหลือ
 * และไม่นับรวมกับจำนวนของกรอบในการ์ดอื่น
 *
 * เปิดเฉพาะเมื่อ NEXT_PUBLIC_LENS_SOURCE=catalog (Bewell) · ไม่ตั้ง = หน้าเดิมของ TimeOptic ทุกอย่าง
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/apiClient";
import { LENS_SOURCE } from "@/lib/lens/lensSource";
import Paginator from "@/stockmod/components/Paginator";
import RecordCard, { CardList } from "@/stockmod/components/RecordCard";
import { count, dateTime, money } from "@/stockmod/lib/format";

export const LENS_USAGE_ON = LENS_SOURCE === "catalog";
export const LENS_USAGE = "LENS_USAGE";

export type LensFilters = {
  lens_type: string;
  lens_name: string;
  index: string;
  coating: string;
  status: string;
  who: string;
};
export const NO_LENS_FILTERS: LensFilters = { lens_type: "", lens_name: "", index: "", coating: "", status: "", who: "" };

type Eye = { sph: string | null; cyl: string | null; axis: string | null; add: string | null } | null;
export type LensRow = {
  id: number;
  reqNo: string;
  usedAt: string;
  invoiceCode: string | null;
  caseId: number;
  caseCode: string;
  customerName: string;
  eye: "pair" | "R" | "L";
  lensCode: string | null;
  lensName: string | null;
  lensType: string | null;
  lensIndex: string | null;
  coating: string | null;
  od: Eye;
  os: Eye;
  quantity: number;
  unit: string;
  costPrice: number | null;
  sellingPrice: number;
  status: string;
  statusLabel: string;
  usedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  cancelSource: string | null;
};
type LensPage = { rows: LensRow[]; total: number; page: number; perPage: number };
export type LensOptions = {
  lens_types: string[];
  indexes: string[];
  coatings: string[];
  names: string[];
  statuses: { value: string; label: string; code: string }[];
  people: { id: number; name: string }[];
};

/** ตัวกรองของหน้า → query string ของ /api/lens-usage (ชุดเดียวกับที่ Export ส่ง) */
export function lensParams(
  base: { q?: string; from?: string; to?: string },
  f: LensFilters,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...base, ...f })) if (v) out[k] = String(v);
  return out;
}

type Load<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: string };

/** GET จาก API ฝั่งหน้าร้าน — null = ไม่ต้องโหลด */
export function useFrontdesk<T>(path: string | null, query: Record<string, string> = {}): Load<T> & { reload: () => void } {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify(query);
  useEffect(() => {
    if (path === null) return undefined;
    let alive = true;
    setState({ status: "loading" });
    api
      .get(path, JSON.parse(key))
      .then((data: T) => alive && setState({ status: "ready", data }))
      .catch((e: Error) => alive && setState({ status: "error", error: e.message || "โหลดข้อมูลไม่สำเร็จ" }));
    return () => {
      alive = false;
    };
  }, [path, key, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) } as Load<T> & { reload: () => void };
}

/** ค่าสายตาหนึ่งข้าง "-2.00 / -0.50 × 180 Add +2.00" */
export function eyeText(e: Eye): string {
  if (!e) return "—";
  const sph = e.sph ?? "0.00";
  const main = e.cyl ? `${sph} / ${e.cyl}${e.axis ? ` × ${e.axis}` : ""}` : sph;
  return e.add ? `${main} Add ${e.add}` : main;
}

/* รอเบิก = ต้องทำอะไรต่อ (ส้ม) · ยกเลิก = จบแล้ว (เทา) · ระหว่างทางกับ TimeOptic = งานสั่งตัด (ม่วง) */
const STATUS_CLASS: Record<string, string> = {
  pending: "status status--pending",
  cancelled: "status status--out",
};

function StatusMark({ r }: { r: LensRow }) {
  return <span className={STATUS_CLASS[r.status] ?? "status status--rx"}>{r.statusLabel}</span>;
}

function qtyText(r: LensRow) {
  return `${count(r.quantity)} ${r.unit}`;
}

function cancelText(r: LensRow) {
  if (r.status !== "cancelled") return null;
  return [
    `ยกเลิก ${dateTime(r.cancelledAt)}`,
    r.cancelledBy ? `โดย ${r.cancelledBy}` : null,
    r.cancelSource,
    r.cancelReason,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** ตาราง (จอกว้าง) + การ์ด (มือถือ/แท็บเล็ตแนวตั้ง) ของรายการใช้เลนส์ */
export function LensUsageList({
  query,
  page,
  onPage,
  money: showMoney,
  onClear,
}: {
  query: Record<string, string>;
  page: number;
  onPage: (p: number) => void;
  money: boolean;
  onClear: () => void;
}) {
  const list = useFrontdesk<LensPage>("/api/lens-usage", { ...query, page: String(page) });

  if (list.status === "loading") return <div className="skeleton" />;
  if (list.status === "error") {
    return (
      <div className="empty">
        <p className="empty__title">โหลดรายการใช้เลนส์ไม่ได้</p>
        <p className="empty__body">{list.error}</p>
        <button type="button" className="btn" onClick={list.reload}>
          ลองใหม่
        </button>
      </div>
    );
  }
  const rows = list.data.rows;
  if (rows.length === 0) {
    return (
      <div className="empty">
        <p className="empty__title">ไม่มีรายการใช้เลนส์ที่ตรงกับเงื่อนไขนี้</p>
        <p className="empty__body">รายการใช้เลนส์เกิดเมื่อยืนยันขั้นขายของเคสที่เลือกเลนส์จากรายการเลนส์</p>
        <button type="button" className="btn" onClick={onClear}>
          ล้างตัวกรอง
        </button>
      </div>
    );
  }

  return (
    <>
      <CardList label="รายการใช้เลนส์">
        {rows.map((r) => (
          <RecordCard
            key={r.id}
            tone={r.status === "cancelled" ? "muted" : undefined}
            head={
              <>
                <span className="tag tag--lens-usage">ใช้เลนส์</span>
                <span className="reccard__when">{dateTime(r.usedAt)}</span>
              </>
            }
            title={r.lensName ?? "—"}
            sub={r.invoiceCode ?? r.reqNo}
            fields={[
              { label: "OD", value: <span className="grid__rx">{eyeText(r.od)}</span> },
              { label: "OS", value: <span className="grid__rx">{eyeText(r.os)}</span> },
              { label: "จำนวน", value: qtyText(r) },
              { label: "สถานะ", value: <StatusMark r={r} /> },
              { label: "ลูกค้า", value: `${r.customerName} · ${r.caseCode}` },
              { label: "ผู้ทำรายการ", value: r.usedBy ?? "—" },
              showMoney && r.costPrice !== null ? { label: "ต้นทุน", value: money(r.costPrice) } : null,
              { label: "ราคาขาย", value: money(r.sellingPrice) },
              r.status === "cancelled" ? { label: "ยกเลิก", value: cancelText(r) } : null,
            ]}
            actions={
              <a href={`/cases/detail?id=${r.caseId}`} className="grid__link">
                ดูเคส
              </a>
            }
          />
        ))}
      </CardList>

      <div className="tablewrap wide-only">
        <table className="grid">
          <caption className="sr-only">รายการใช้เลนส์เรียงจากใหม่ไปเก่า</caption>
          <thead>
            <tr>
              <th scope="col">วันที่</th>
              <th scope="col">ประเภท / เอกสาร</th>
              <th scope="col">สินค้า</th>
              <th scope="col" className="grid__num">
                จำนวน
              </th>
              <th scope="col">ค่าสายตา</th>
              <th scope="col" className="grid__num">
                {showMoney ? "ต้นทุน / ราคาขาย" : "ราคาขาย"}
              </th>
              <th scope="col">โดย</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.status === "cancelled" ? "grid__row grid__row--void" : "grid__row"}>
                <th scope="row" className="grid__muted grid__when">
                  {dateTime(r.usedAt)}
                </th>
                <td>
                  <span className="tag tag--lens-usage">ใช้เลนส์</span>
                  <span className="grid__sub grid__doc">{r.invoiceCode ?? "—"}</span>
                  <span className="grid__sub">
                    {r.reqNo} · <StatusMark r={r} />
                  </span>
                  {r.status === "cancelled" ? <span className="grid__sub">{cancelText(r)}</span> : null}
                </td>
                <td>
                  <span className="grid__name">{r.lensName ?? "—"}</span>
                  <span className="grid__sub">
                    {[r.lensCode, r.lensIndex, r.coating].filter(Boolean).join(" · ")}
                  </span>
                  <span className="grid__sub">
                    <a href={`/cases/detail?id=${r.caseId}`} className="grid__link">
                      {r.customerName} · {r.caseCode}
                    </a>
                  </span>
                </td>
                {/* ไม่มีเครื่องหมายลบ และไม่มี "เหลือ" — เลนส์ไม่ได้ออกจากคลังของ Bewell */}
                <td className="grid__num">{qtyText(r)}</td>
                <td className="grid__rx">
                  <span className="grid__sub">OD {eyeText(r.od)}</span>
                  <span className="grid__sub">OS {eyeText(r.os)}</span>
                </td>
                <td className="grid__num">
                  {showMoney && r.costPrice !== null ? (
                    <>
                      {money(r.costPrice)}
                      <span className="grid__sub">ขาย {money(r.sellingPrice)}</span>
                    </>
                  ) : (
                    money(r.sellingPrice)
                  )}
                </td>
                <td>{r.usedBy ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Paginator page={list.data.page} perPage={list.data.perPage} total={list.data.total} onPage={onPage} label="รายการ" />
    </>
  );
}
