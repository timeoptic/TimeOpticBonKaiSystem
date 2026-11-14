"use client";

import { useEffect, useState } from "react";
import TaskDialog from "./TaskDialog";
import NewProductDialog from "./NewProductDialog";
import SupplierSelect, { supplierIdOf } from "./SupplierSelect";
import DateField from "./DateField";
import { IconCart } from "./Icon";
import { useToast } from "./Toaster";
import { api, ApiError, type CreatedLot, type ProductDetail, type ProductRow, type ReceiveDefaults } from "@/stockmod/lib/api";
import { useApi } from "@/stockmod/lib/useApi";
import { count, money, shortName } from "@/stockmod/lib/format";
import { uuid } from "@/stockmod/lib/uuid";

/** หนึ่งบรรทัดในบิล — ช่องที่แก้ได้เก็บเป็นข้อความตามที่พิมพ์ แปลงตอนกดบันทึก */
type Line = {
  sku: string;
  name: string;
  qty: string;
  cost: string;
  expiry: string;
  /** ต้นทุนล็อตก่อน ไว้บอกข้างช่อง — null คือไม่เคยมีหรือไม่มีสิทธิ์เห็น */
  lastCost: number | null;
};

type Bill = { supplier: string; received: string; doc: string; note: string };

const today = () => new Date().toISOString().slice(0, 10);
const EMPTY_BILL = (): Bill => ({ supplier: "", received: today(), doc: "", note: "" });
const DRAFT = "timeoptic.receive.bill.v1";

/**
 * รับของเข้าแบบเปิดบิล — ร้านขอ 18 ก.ย. 2026 อยู่ในหน้าสินค้าและสต็อก
 *
 * บริษัทมาส่งของทีละบิล บิลหนึ่งมีหลายสินค้า ที่ใช้ร่วมกันทั้งบิล (ผู้ขาย วันที่รับ เลขที่บิล)
 * กรอกครั้งเดียว แล้วกด "+ ใส่บิล" ที่แถวสินค้าไปเรื่อย ๆ แบบใส่ตะกร้า · แต่ละบรรทัดแก้แค่จำนวน
 * ต้นทุน วันหมดอายุ · กดบันทึกครั้งเดียวเข้าคลังทั้งบิล (POST /lots/many — ทรานแซกชันเดียว
 * ผิดบรรทัดเดียวไม่มีอะไรเข้าเลย) · ต้นทุนเติมจากล็อตก่อนให้เอง · กดสินค้าเดิมซ้ำ = บวกจำนวน ·
 * บิลที่ยังไม่บันทึกจำไว้ในเครื่องนี้ รีเฟรชหน้าแล้วไม่หาย
 */
export function useReceiveBill(mayCost: boolean, onSaved: () => void) {
  const toast = useToast();
  const [bill, setBill] = useState<Bill>(EMPTY_BILL);
  const [lines, setLines] = useState<Line[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  /** นับทุกครั้งที่ใส่บิล ให้ไอคอนเด้งบอกว่าได้ยิน (แบบเดียวกับหน้าเบิก) */
  const [taps, setTaps] = useState(0);
  /**
   * กุญแจกันบันทึกซ้ำ (idem_key) — หนึ่งค่าต่อบิล จำไว้กับร่าง · เน็ตหลุดตอนกดบันทึกแล้วกดใหม่
   * ได้คำตอบเดิม ไม่รับเข้าซ้ำ · บันทึกสำเร็จหรือล้างบิลแล้วได้กุญแจใหม่ (ยกจากระบบหลัก)
   */
  const [idem, setIdem] = useState("");
  const renewIdem = () => setIdem(uuid());

  // บิลที่ค้างอยู่ในเครื่อง — ความสะดวกของคนนี้คนเดียว อ่านไม่ได้ก็เริ่มบิลใหม่
  useEffect(() => {
    let key = "";
    try {
      const raw = localStorage.getItem(DRAFT);
      if (raw) {
        const d = JSON.parse(raw) as { bill?: Bill; lines?: Line[]; idem?: string };
        if (d.bill) setBill({ ...EMPTY_BILL(), ...d.bill });
        if (Array.isArray(d.lines)) setLines(d.lines);
        if (typeof d.idem === "string") key = d.idem;
      }
    } catch {
      /* เริ่มบิลใหม่ */
    }
    setIdem(key.length >= 8 ? key : uuid());
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      if (lines.length === 0 && !bill.doc && !bill.note && !bill.supplier) localStorage.removeItem(DRAFT);
      else localStorage.setItem(DRAFT, JSON.stringify({ bill, lines, idem }));
    } catch {
      /* เก็บไม่ได้ก็แค่ไม่จำ */
    }
  }, [bill, lines, loaded, idem]);

  async function add(p: Pick<ProductRow, "sku" | "name" | "isCustomMade">) {
    if (p.isCustomMade) {
      toast.info({
        text: `${shortName(p.name)} เป็นสินค้าสั่งตัด`,
        detail: "ไม่เก็บเป็นล็อตในคลัง — สั่งกับผู้ขายที่หน้าใบสั่งตัด RX",
        link: { href: "/rx", label: "ไปหน้าใบสั่งตัด RX" },
      });
      return;
    }
    setTaps((n) => n + 1);
    const had = lines.some((l) => l.sku === p.sku);
    setLines((ls) =>
      ls.some((l) => l.sku === p.sku)
        ? ls.map((l) => (l.sku === p.sku ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l))
        : [...ls, { sku: p.sku, name: p.name, qty: "1", cost: "", expiry: "", lastCost: null }],
    );
    toast.success({ text: `ใส่บิลแล้ว: ${shortName(p.name)}` });
    if (had) return;
    // ต้นทุนกับผู้ขายจากล็อตก่อน — ถามทีหลัง บรรทัดขึ้นทันทีไม่ต้องรอ
    try {
      const d = await api.get<ReceiveDefaults>(`/receive-defaults/${encodeURIComponent(p.sku)}`);
      const last = d.lastLot?.costPerUnit ?? null;
      setLines((ls) =>
        ls.map((l) =>
          l.sku === p.sku && l.cost === ""
            ? { ...l, lastCost: last, cost: mayCost && last !== null ? String(last) : "" }
            : l,
        ),
      );
      if (d.lastLot?.supplierId != null) {
        setBill((b) => (b.supplier === "" ? { ...b, supplier: String(d.lastLot!.supplierId) } : b));
      }
    } catch {
      /* ไม่มีค่าเริ่มต้นก็กรอกเอง */
    }
  }

  return { bill, setBill, lines, setLines, open, setOpen, taps, add, mayCost, onSaved, idem, renewIdem };
}

export type ReceiveBillState = ReturnType<typeof useReceiveBill>;

/** ปุ่ม "บิลรับเข้า (N)" สำหรับหัวหน้า */
export function BillButton({ b }: { b: ReceiveBillState }) {
  return (
    <button
      type="button"
      className={b.lines.length > 0 ? "btn btn--primary btn--icon" : "btn btn--icon"}
      onClick={() => b.setOpen(true)}
      aria-label={`บิลรับเข้า ${count(b.lines.length)} รายการ`}
    >
      <span className="cart__icon" key={`bill-icon-${b.taps}`}>
        <IconCart />
      </span>
      บิลรับเข้า
      {b.lines.length > 0 ? (
        <span className="cartcount" key={`bill-count-${b.taps}`}>
          {count(b.lines.length)}
        </span>
      ) : null}
    </button>
  );
}

/** แถบลอยล่างจอเมื่อมีของในบิล + กล่องบิล */
export function ReceiveBill({ b }: { b: ReceiveBillState }) {
  const toast = useToast();
  const suppliers = useApi<{ suppliers: { id: number; name: string }[] }>("/suppliers");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** เพิ่มสินค้าใหม่จากในบิล — ร้านขอ 21 ก.ย. 2026 ของที่ไม่เคยมีมากับบิลก็ใส่บิลเดียวกันได้ */
  const [creating, setCreating] = useState(false);
  const { bill, setBill, lines, setLines, mayCost } = b;

  async function putInBill(id: number, failed: string) {
    setCreating(false);
    try {
      const { product } = await api.get<{ product: ProductDetail }>(`/products/${id}`);
      await b.add(product);
    } catch {
      toast.warning({ text: failed, detail: "ค้นสินค้าแล้วกด + ใส่บิล เอง" });
    }
    b.setOpen(true);
  }

  function startNew() {
    b.setOpen(false);
    setCreating(true);
  }

  const setB = (patch: Partial<Bill>) => setBill((x) => ({ ...x, ...patch }));
  const setLine = (sku: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.sku === sku ? { ...l, ...patch } : l)));

  const pieces = lines.reduce((n, l) => n + (Number(l.qty) || 0), 0);
  const worth = lines.reduce((n, l) => n + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const bad = lines.find((l) => !/^\d+$/.test(l.qty.trim()) || Number(l.qty) < 1);
    if (bad) {
      setProblem(`จำนวนของ ${shortName(bad.name)} ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป`);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const { lots } = await api.post<{ lots: CreatedLot[] }>("/lots/many", {
        idem_key: b.idem || null,
        supplier_id: await supplierIdOf(bill.supplier),
        received_date: bill.received,
        reference_doc: bill.doc.trim() || null,
        note: bill.note.trim() || null,
        lines: lines.map((l) => ({
          sku: l.sku,
          quantity: Number(l.qty),
          cost_per_unit: mayCost && l.cost.trim() ? l.cost.trim() : null,
          expiry_date: l.expiry || null,
        })),
      });
      const waiting = lots.filter((x) => x.awaitingCost).length;
      const said = {
        text: `รับเข้าคลังแล้ว ${count(lots.length)} รายการ${bill.doc.trim() ? ` · บิล ${bill.doc.trim()}` : ""}`,
        detail:
          `${count(lots.reduce((n, x) => n + x.quantity, 0))} ชิ้น` +
          (waiting ? ` · ${count(waiting)} รายการยังไม่มีต้นทุน` : ""),
        link: { href: "/movements", label: "ดูความเคลื่อนไหว" },
      };
      if (waiting) toast.warning(said);
      else toast.success(said);
      setLines([]);
      setBill(EMPTY_BILL());
      b.renewIdem();
      b.setOpen(false);
      b.onSaved();
    } catch (err) {
      setProblem(ApiError.is(err) ? err.message : "รับของไม่สำเร็จ — ยังไม่มีอะไรเข้าคลัง");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {lines.length > 0 && !b.open ? (
        <div className="cartfab" role="group" aria-label="บิลที่ค้างอยู่">
          <span className="cartfab__what">
            <IconCart />
            <span>
              <b>{count(lines.length)} รายการ</b>
              <span className="cartfab__sub">{count(pieces)} ชิ้น</span>
            </span>
          </span>
          <button type="button" className="btn btn--primary" onClick={() => b.setOpen(true)}>
            ดูบิลแล้วรับเข้า
          </button>
        </div>
      ) : null}

      {b.open ? (
        <TaskDialog eyebrow="รับของเข้าคลัง" title={`บิลรับเข้า · ${count(lines.length)} รายการ`} onClose={() => b.setOpen(false)}>
          {lines.length === 0 ? (
            <div className="basket__empty">
              <p>บิลยังว่าง</p>
              <p className="field__help">
                ปิดหน้านี้ แล้วกด <strong>+ ใส่บิล</strong> ที่แถวสินค้าแต่ละตัวที่มากับบิล — กดตัวเดิมซ้ำ = บวกจำนวน
              </p>
              <div className="chips">
                <button type="button" className="btn btn--primary" onClick={() => b.setOpen(false)}>
                  ไปเลือกสินค้า
                </button>
                <button type="button" className="btn" onClick={startNew}>
                  + สินค้าใหม่
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <div className="formgrid">
                <div className="field">
                  <label className="field__label" htmlFor="rb-sup">ผู้ขาย</label>
                  <SupplierSelect
                    id="rb-sup"
                    value={bill.supplier}
                    onChange={(v) => setB({ supplier: v })}
                    disabled={busy || suppliers.status !== "ready"}
                    suppliers={suppliers.status === "ready" ? suppliers.data.suppliers : []}
                  />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="rb-recv">วันที่รับเข้า</label>
                  <DateField id="rb-recv" value={bill.received} onChange={(v) => setB({ received: v })} disabled={busy} clearable={false} />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="rb-doc">เลขที่บิล / ใบส่งของ</label>
                  <input
                    id="rb-doc"
                    className="input"
                    value={bill.doc}
                    onChange={(e) => setB({ doc: e.target.value })}
                    maxLength={100}
                    disabled={busy}
                    autoComplete="off"
                    placeholder="เช่น IV2609-0123"
                  />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="rb-note">หมายเหตุ (ทั้งบิล)</label>
                  <input
                    id="rb-note"
                    className="input"
                    value={bill.note}
                    onChange={(e) => setB({ note: e.target.value })}
                    maxLength={500}
                    disabled={busy}
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="basket">
                <p className="basket__head">
                  {count(lines.length)} รายการ · {count(pieces)} ชิ้น
                  {mayCost && worth > 0 ? ` · ต้นทุนรวม ${money(worth)}` : ""}
                </p>
                <ul className="basket__list">
                  {lines.map((l, i) => (
                    <li className="basket__line billline" key={l.sku}>
                      {/* เลขแถว — บิลยาว ๆ ไล่เทียบกับกระดาษได้ไม่หลง (ร้านขอ 19 ก.ย. 2026) */}
                      <span className="billline__no" aria-label={`แถวที่ ${i + 1}`}>
                        {i + 1}
                      </span>
                      <span className="basket__name">
                        {shortName(l.name)}
                        <span className="basket__sku">
                          {l.sku}
                          {mayCost && l.lastCost !== null ? ` · ล็อตก่อน ${money(l.lastCost)}/ชิ้น` : ""}
                        </span>
                      </span>
                      <span className="basket__step">
                        <button
                          type="button"
                          className="qty__step"
                          onClick={() => setLine(l.sku, { qty: String(Math.max(1, (Number(l.qty) || 1) - 1)) })}
                          disabled={busy || (Number(l.qty) || 0) <= 1}
                          aria-label={`ลดจำนวน ${l.name}`}
                        >
                          −
                        </button>
                        <input
                          className="input basket__qtyinput"
                          inputMode="numeric"
                          autoComplete="off"
                          value={l.qty}
                          onChange={(e) => setLine(l.sku, { qty: e.target.value.replace(/[^\d]/g, "") })}
                          disabled={busy}
                          aria-label={`จำนวน ${l.name}`}
                        />
                        <button
                          type="button"
                          className="qty__step"
                          onClick={() => setLine(l.sku, { qty: String((Number(l.qty) || 0) + 1) })}
                          disabled={busy}
                          aria-label={`เพิ่มจำนวน ${l.name}`}
                        >
                          +
                        </button>
                      </span>
                      <span className="billline__more">
                        <input
                          className="input billline__cost"
                          inputMode="decimal"
                          value={l.cost}
                          onChange={(e) => setLine(l.sku, { cost: e.target.value })}
                          disabled={busy || !mayCost}
                          placeholder={mayCost ? "ต้นทุน/ชิ้น" : "บัญชีลงต้นทุน"}
                          aria-label={`ต้นทุนต่อชิ้น ${l.name}`}
                          autoComplete="off"
                        />
                        {mayCost ? (
                          <span className="billline__sum" aria-label={`ต้นทุนรวม ${l.name}`}>
                            รวม {Number(l.cost) > 0 ? money((Number(l.qty) || 0) * Number(l.cost)) : "—"}
                          </span>
                        ) : null}
                        <span className="billline__exp">
                          <DateField value={l.expiry} onChange={(v) => setLine(l.sku, { expiry: v })} disabled={busy} placeholder="วันหมดอายุ" />
                        </span>
                        <button
                          type="button"
                          className="btn btn--quiet btn--small"
                          onClick={() => setLines((ls) => ls.filter((x) => x.sku !== l.sku))}
                          disabled={busy}
                        >
                          เอาออก
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="chips">
                  <button type="button" className="btn btn--small" onClick={startNew} disabled={busy}>
                    + สินค้าใหม่ที่ยังไม่เคยมี
                  </button>
                </div>
                {/* ต้นทุนรวมทั้งบิล — ไว้เทียบยอดท้ายใบกำกับ (ร้านขอ 19 ก.ย. 2026) */}
                {mayCost ? (
                  <p className="billtotal">
                    <span>ต้นทุนรวมทั้งบิล</span>
                    <b>{money(worth)}</b>
                    {lines.some((l) => !(Number(l.cost) > 0)) ? (
                      <span className="billtotal__note">
                        ยังไม่ใส่ต้นทุน {count(lines.filter((l) => !(Number(l.cost) > 0)).length)} แถว
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </div>

              <p className="field__help">
                เว้นต้นทุนว่างได้ถ้าใบกำกับยังไม่มา — รายการนั้นขึ้น "รอต้นทุน" ให้บัญชีลงทีหลัง · เลขที่บิลขึ้นเป็นเอกสาร
                ของทุกรายการ ค้นได้ในหน้าความเคลื่อนไหว
              </p>

              {problem ? (
                <div className="notice notice--error" role="alert">
                  {problem}
                </div>
              ) : null}

              <div className="chips">
                <button type="submit" className="btn btn--primary" disabled={busy}>
                  {busy ? "กำลังรับเข้า…" : `รับเข้าคลัง ${count(lines.length)} รายการ`}
                </button>
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => {
                    setLines([]);
                    setBill(EMPTY_BILL());
                    b.renewIdem();
                    setProblem(null);
                  }}
                  disabled={busy}
                >
                  ล้างบิล
                </button>
              </div>
            </form>
          )}
        </TaskDialog>
      ) : null}

      {creating ? (
        <NewProductDialog
          title="เพิ่มสินค้าใหม่เข้าบิล"
          make="stock"
          // ไม่เปิดล็อตตรงนี้ — ของเข้าคลังพร้อมบิลทั้งใบตอนกดรับเข้า
          onClose={() => {
            setCreating(false);
            b.setOpen(true);
          }}
          onSaved={async (id) => {
            await putInBill(id, "เพิ่มสินค้าแล้ว แต่ใส่บิลไม่สำเร็จ");
            b.onSaved();
          }}
          // ชื่อซ้ำกับของเดิม แล้วกดใช้ตัวเดิม — ใส่ตัวเดิมลงบิลแทน
          onUseExisting={(id) => void putInBill(id, "ใส่บิลไม่สำเร็จ")}
        />
      ) : null}
    </>
  );
}
