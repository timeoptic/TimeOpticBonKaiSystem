"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { can, useActor, WorkHead } from "@/stockmod/components/AppShell";
import { useToast } from "@/stockmod/components/Toaster";
import ProductPicker from "@/stockmod/components/ProductPicker";
import TaskDialog from "@/stockmod/components/TaskDialog";
import NewProductDialog from "@/stockmod/components/NewProductDialog";
import SupplierSelect, { supplierIdOf } from "@/stockmod/components/SupplierSelect";
import DateField from "@/stockmod/components/DateField";
import { IconCart } from "@/stockmod/components/Icon";
import { api, ApiError, type CreatedLot, type ProductRow, type ReceiveDefaults } from "@/stockmod/lib/api";
import { useApi } from "@/stockmod/lib/useApi";
import { count, money, shortName } from "@/stockmod/lib/format";

type Supplier = { id: number; name: string };

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
 * รับของเข้าแบบเปิดบิล — ร้านขอ 18 ก.ย. 2026
 *
 * บริษัทมาส่งของทีละบิล บิลหนึ่งมีหลายสินค้า ที่ใช้ร่วมกันทั้งบิล (ผู้ขาย วันที่รับ เลขที่บิล)
 * ไม่ควรต้องกรอกซ้ำทุกชิ้น · หัวบิลกรอกครั้งเดียว แล้วกดสินค้าจากรายการใส่บิลไปเรื่อย ๆ แบบ
 * ใส่ตะกร้า (หน้าตาเดียวกับหน้าเบิก) · แต่ละบรรทัดแก้แค่จำนวน ต้นทุน วันหมดอายุ · กดบันทึกครั้ง
 * เดียวเข้าคลังทั้งบิล (POST /lots/many — ทรานแซกชันเดียว ผิดบรรทัดเดียวไม่มีอะไรเข้าเลย)
 *
 * ต้นทุนเติมจากล็อตก่อนของสินค้านั้นให้เอง · กดสินค้าเดิมซ้ำ = บวกจำนวน · บิลที่ยังไม่บันทึก
 * จำไว้ในเครื่องนี้ รีเฟรชหน้าแล้วไม่หาย
 */
export default function ReceivePage() {
  const actor = useActor();
  const mayCost = can.enterCost(actor);
  const toast = useToast();
  const suppliers = useApi<{ suppliers: Supplier[] }>("/suppliers");

  const [bill, setBill] = useState<Bill>(EMPTY_BILL);
  const [lines, setLines] = useState<Line[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** นับทุกครั้งที่ใส่บิล ให้ไอคอนเด้งบอกว่าได้ยิน (แบบเดียวกับหน้าเบิก) */
  const [taps, setTaps] = useState(0);

  // บิลที่ค้างอยู่ในเครื่อง — ความสะดวกของคนนี้คนเดียว อ่านไม่ได้ก็เริ่มบิลใหม่
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT);
      if (raw) {
        const d = JSON.parse(raw) as { bill?: Bill; lines?: Line[] };
        if (d.bill) setBill({ ...EMPTY_BILL(), ...d.bill });
        if (Array.isArray(d.lines)) setLines(d.lines);
      }
    } catch {
      /* เริ่มบิลใหม่ */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      if (lines.length === 0 && !bill.doc && !bill.note && !bill.supplier) localStorage.removeItem(DRAFT);
      else localStorage.setItem(DRAFT, JSON.stringify({ bill, lines }));
    } catch {
      /* เก็บไม่ได้ก็แค่ไม่จำ */
    }
  }, [bill, lines, loaded]);

  const setB = (patch: Partial<Bill>) => setBill((b) => ({ ...b, ...patch }));
  const setLine = (sku: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.sku === sku ? { ...l, ...patch } : l)));

  async function add(p: ProductRow | null) {
    if (p === null) return;
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
    if (had) {
      setLines((ls) => ls.map((l) => (l.sku === p.sku ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l)));
      return;
    }
    setLines((ls) => [...ls, { sku: p.sku, name: p.name, qty: "1", cost: "", expiry: "", lastCost: null }]);
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
        detail: `${count(lots.reduce((n, x) => n + x.quantity, 0))} ชิ้น` + (waiting ? ` · ${count(waiting)} รายการยังไม่มีต้นทุน` : ""),
        link: { href: "/movements", label: "ดูความเคลื่อนไหว" },
      };
      if (waiting) toast.warning(said);
      else toast.success(said);
      setLines([]);
      setBill(EMPTY_BILL());
      setReviewing(false);
      setRefresh((n) => n + 1);
    } catch (err) {
      setProblem(ApiError.is(err) ? err.message : "รับของไม่สำเร็จ — ยังไม่มีอะไรเข้าคลัง");
    } finally {
      setBusy(false);
    }
  }

  const supplierList = suppliers.status === "ready" ? suppliers.data.suppliers : [];

  return (
    <main className="work-main">
      <WorkHead
        title="รับของเข้าคลัง"
        lede="เปิดบิลครั้งเดียว — กรอกผู้ขาย วันที่ เลขที่บิล แล้วกดสินค้าใส่บิลทีละรายการ บันทึกทีเดียวทั้งบิล"
      >
        <button
          type="button"
          className={lines.length > 0 ? "btn btn--primary btn--icon" : "btn btn--icon"}
          onClick={() => setReviewing(true)}
          aria-label={`บิลรับเข้า ${count(lines.length)} รายการ`}
        >
          <span className="cart__icon" key={`bill-icon-${taps}`}>
            <IconCart />
          </span>
          บิลรับเข้า
          {lines.length > 0 ? (
            <span className="cartcount" key={`bill-count-${taps}`}>
              {count(lines.length)}
            </span>
          ) : null}
        </button>
        <button type="button" className="btn" onClick={() => setCreating(true)}>
          เพิ่มสินค้าใหม่
        </button>
        <span id="recv-sort" />
      </WorkHead>

      {lines.length === 0 ? (
        <p className="notice" role="status">
          กด <strong>+ ใส่บิล</strong> ที่สินค้าในรายการด้านล่างทีละตัว แล้วเปิด <strong>บิลรับเข้า</strong> ด้านบน
          เพื่อกรอกผู้ขาย วันที่ เลขที่บิล และแก้จำนวน/ต้นทุนของแต่ละรายการ — ของที่ยังไม่เคยมีในระบบ กด{" "}
          <strong>เพิ่มสินค้าใหม่</strong> แล้วมันจะเข้าบิลให้เอง
        </p>
      ) : null}

      <ProductPicker
        value={null}
        onPick={(p) => void add(p)}
        pickLabel="+ ใส่บิล"
        pickByButton
        reserved={{}}
        refresh={refresh}
        only="ready"
        label="สินค้าที่รับเข้า"
        autoFocus
        sortSlotId="recv-sort"
      />

      {lines.length > 0 && !reviewing ? (
        <div className="cartfab" role="group" aria-label="บิลที่ค้างอยู่">
          <span className="cartfab__what">
            <IconCart />
            <span>
              <b>{count(lines.length)} รายการ</b>
              <span className="cartfab__sub">{count(pieces)} ชิ้น</span>
            </span>
          </span>
          <button type="button" className="btn btn--primary" onClick={() => setReviewing(true)}>
            ดูบิลแล้วรับเข้า
          </button>
        </div>
      ) : null}

      {reviewing ? (
        <TaskDialog
          eyebrow="รับของเข้าคลัง"
          title={`บิลรับเข้า · ${count(lines.length)} รายการ`}
          onClose={() => setReviewing(false)}
        >
          {lines.length === 0 ? (
            <div className="basket__empty">
              <p>บิลยังว่าง</p>
              <p className="field__help">
                ปิดหน้านี้ แล้วกด <strong>+ ใส่บิล</strong> ที่สินค้าแต่ละตัวที่มากับบิล — กดตัวเดิมซ้ำ = บวกจำนวน
              </p>
              <div className="chips">
                <button type="button" className="btn btn--primary" onClick={() => setReviewing(false)}>
                  ไปเลือกสินค้า
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
                    suppliers={supplierList}
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
                  {lines.map((l) => (
                    <li className="basket__line billline" key={l.sku}>
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
                        <span className="billline__exp">
                          <DateField
                            value={l.expiry}
                            onChange={(v) => setLine(l.sku, { expiry: v })}
                            disabled={busy}
                            placeholder="วันหมดอายุ"
                          />
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
          title="เพิ่มสินค้าใหม่ แล้วใส่บิล"
          make="stock"
          onUseExisting={async (id) => {
            setCreating(false);
            try {
              const { product } = await api.get<{ product: ProductRow }>(`/products/${id}`);
              void add(product);
            } catch {
              setProblem("ใส่บิลให้อัตโนมัติไม่สำเร็จ — กด + ใส่บิล จากรายการได้เลย");
            }
          }}
          onClose={() => setCreating(false)}
          onSaved={async (id) => {
            setCreating(false);
            setRefresh((n) => n + 1);
            try {
              const { product } = await api.get<{ product: ProductRow }>(`/products/${id}`);
              void add(product);
              toast.success({ text: `เพิ่ม ${shortName(product.name)} แล้ว และใส่บิลให้แล้ว` });
            } catch {
              toast.info({ text: "เพิ่มสินค้าแล้ว — กด + ใส่บิล จากรายการได้เลย" });
            }
          }}
        />
      ) : null}

      <p className="field__help">
        ต้องแก้ล็อตที่รับไปแล้ว (จำนวน ต้นทุน วันที่) ใช้ปุ่ม <strong>แก้ไขการรับเข้า</strong> ในหน้า{" "}
        <Link href="/stock/movements" className="grid__link">ความเคลื่อนไหว</Link>
      </p>
    </main>
  );
}
