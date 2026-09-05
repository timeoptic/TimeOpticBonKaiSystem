"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { can, useActor, WorkHead } from "@/stockmod/components/AppShell";
import { useToast } from "@/stockmod/components/Toaster";
import ProductPicker from "@/stockmod/components/ProductPicker";
import TaskDialog from "@/stockmod/components/TaskDialog";
import { IconCart } from "@/stockmod/components/Icon";
import Select from "@/stockmod/components/Select";
import {
  api,
  ApiError,
  type BranchRow,
  type Person,
  type ProductRow,
  type Summary,
} from "@/stockmod/lib/api";
import { useApi } from "@/stockmod/lib/useApi";
import { uuid } from "@/stockmod/lib/uuid";
import { count, money } from "@/stockmod/lib/format";

// The cost fields are absent, not null, for a role that may not see them — the
// API drops the keys rather than sending an empty number.
type Cut = {
  lot: string;
  lot_id: number;
  quantity: number;
  unit_cost?: string | null;
  /** ส่วนที่ของไม่พอ ไปกองบนล็อตค้างส่ง — ยอดของสินค้าตัวนี้ติดลบแล้ว */
  shortfall?: boolean;
};

/** One product's worth of a withdrawal, as the API reports it back. */
type ResultLine = {
  sku: string;
  name: string;
  quantity: number;
  cuts: Cut[];
  total_cost?: string | null;
  remaining_after: number;
  branch_issue_id: number | null;
};

type MoveResult = {
  replayed: boolean;
  action: string;
  lines: ResultLine[];
  quantity: number;
  total_cost?: string | null;
};

/** Who the stock is going to. */
type Recipient = "staff" | "branch";

/**
 * ทำไมของถึงเสีย — ตามคำของร้าน
 *
 * รายการปิด (บวก "อื่น ๆ") เพราะสาเหตุมีอยู่ไม่กี่แบบและวนซ้ำทุกสัปดาห์ ต่างจาก
 * หมายเหตุของใบเบิกที่เป็นเรื่องเฉพาะใบ · ปล่อยให้พิมพ์เองแล้วสาเหตุเดียวกันจะ
 * ถูกเขียนสามแบบ แล้วคำถามว่า "เดือนนี้ของหายไปกับอะไรมากที่สุด" จะตอบไม่ได้
 *
 * ข้อความที่เลือกถูกบันทึกลง `inventory_logs.notes` ตรง ๆ ไม่ใช่รหัส — สมุด
 * คลังอ่านด้วยตาคน และรหัสที่ต้องเปิดตารางแปลอีกทีไม่ได้ทำให้อะไรดีขึ้น
 */
const SCRAP_REASONS = ["เจียร์เสีย", "เลนส์ไม่ได้คุณภาพ", "หยิบเลนส์ผิด"];

/** ทางออกสำหรับสาเหตุที่สี่ ซึ่งวันหนึ่งจะมี */
const OTHER_REASON = "อื่น ๆ";

/**
 * One line waiting to go out.
 *
 * `onHand` is kept beside the quantity so the basket can say "this one is
 * short" without asking the API again — the number was already on the row that
 * was picked.
 */
type Line = { sku: string; name: string; qty: number; onHand: number };

/**
 * The one thing this shop does all day: take stock out.
 *
 * It is the front page because it is the front page of the work — everything
 * else here (the catalogue, the lots, the ledger) exists to support this and is
 * consulted far less often. It used to be one section of a drawer that also held
 * receiving, RX orders, product editing and product deletion, which meant the
 * most frequent task in the shop was three clicks deep and surrounded by
 * destructive ones.
 */
export default function IssuePage() {
  const actor = useActor();
  const toast = useToast();

  /**
   * The other products going out on the same errand.
   *
   * A customer's job is a frame and two lenses, and the two lenses are two
   * different products because the left and the right hardly ever share a
   * power. Done one at a time that is three trips through this form, three
   * document numbers to retype, and three chances to get the recipient wrong.
   * The basket holds them; the fields below belong to the whole errand.
   *
   * The product currently picked is deliberately *not* in here — it is the line
   * being edited, and it joins the basket when the next product is picked or
   * when the whole lot is cut.
   */
  const [basket, setBasket] = useState<Line[]>([]);

  /**
   * Whether the form is open with nothing picked — the basket being reviewed.
   *
   * The form is a dialog over the list now, and picking a product opens it. A
   * basket that has been put down needs a way back in that is not "pick another
   * product", so the bar over the list reopens it on its own.
   */
  const [reviewing, setReviewing] = useState(false);

  /** Bumped after a write, so the list underneath re-reads the new counts. */
  const [refresh, setRefresh] = useState(0);

  /**
   * Counted up on every trip into the basket, so the cart can say it heard.
   *
   * The row that was tapped is at eye level and the cart button is at the top
   * of the page, which is exactly the distance over which "did that work?"
   * lives — the answer used to be a number quietly changing off-screen. The
   * count alone cannot carry it either: two of the same lens is one line, so
   * the badge reads the same before and after. A counter that only ever goes up
   * is what makes each tap its own event, and remounting the badge on it is
   * what replays the animation.
   */
  const [taps, setTaps] = useState(0);

  /**
   * A basket line being retyped, keyed by SKU, while the box is briefly empty.
   *
   * Kept beside the basket rather than in it: `qty` is a number that the
   * total, the short check and the request all read, and clearing the box to
   * type "12" would take it through 0 and fight the cursor. The draft is what
   * is on screen; the basket keeps the last figure that was actually a number.
   */
  const [typing, setTyping] = useState<Record<string, string>>({});

  const [kind, setKind] = useState<"issue" | "scrap">("issue");
  const [recipient, setRecipient] = useState<Recipient>("staff");

  // Anchored to the signed-in account; `forOther` is the deliberate step away
  // from that, taken only when someone is drawing for a colleague.
  const [staffId, setStaffId] = useState<string>(String(actor.id));
  const [forOther, setForOther] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [doc, setDoc] = useState("");
  const [note, setNote] = useState("");

  /**
   * ตัวเลือกที่กดในดรอปดาวน์สาเหตุ — ของหน้าจอ ไม่ใช่ของสมุด
   *
   * สิ่งที่ถูกบันทึกคือ `note` เสมอ ตัวนี้แค่จำว่าดรอปดาวน์ค้างอยู่บรรทัดไหน
   * เก็บแยกกันเพราะ "อื่น ๆ" ไม่ใช่ข้อความที่จะลงสมุด มันคือคำสั่งให้เปิดช่องพิมพ์
   */
  const [reason, setReason] = useState("");

  const [busy, setBusy] = useState(false);
  /** A refusal, and — when the API named one — the line it was about. */
  const [problem, setProblem] = useState<
    { message: string; available?: number; sku?: string | null } | null
  >(null);

  const summary = useApi<Summary>("/summary");
  const people = useApi<{ people: Person[] }>("/people");
  const branches = useApi<{ branches: BranchRow[] }>("/branches?active=1");

  /**
   * The key is minted once per form, not per click. Submitting the same form
   * twice — a double tap, a retry after a stall — carries the same key and the
   * server does the work once. A fresh key is minted only after a success,
   * because that genuinely is the next event.
   */
  const [idemKey, setIdemKey] = useState(() => `web:${uuid()}`);

  // Ruined material is not lent to anyone, so the branch option disappears
  // rather than sitting there waiting to be refused by the server.
  useEffect(() => {
    if (kind === "scrap" && recipient === "branch") setRecipient("staff");
  }, [kind, recipient]);

  /* สลับระหว่างเบิกกับตัดของเสีย = เปลี่ยนคำถาม ไม่ใช่เปลี่ยนแค่ปุ่ม · หมายเหตุ
     ของใบเบิกที่ค้างอยู่จะกลายเป็นสาเหตุที่ของเสียทันทีถ้าไม่ล้าง */
  useEffect(() => {
    setNote("");
    setReason("");
  }, [kind]);

  /**
   * Naming a colleague on a scrap is the owner's call.
   *
   * On a withdrawal anyone may draw for anyone — a technician fetching a lens
   * for the person at the counter is the ordinary case. On a scrap the same
   * field says whose doing it was, the dashboard totals it per person, and the
   * shop asked for that to come from the owner. Someone who set the picker on a
   * withdrawal and then switched to scrap is put back on their own name here,
   * rather than being let type an accusation the API will refuse on submit.
   */
  const mayBlame = can.blameScrap(actor);

  useEffect(() => {
    if (kind === "scrap" && !mayBlame && forOther) {
      setForOther(false);
      setStaffId(String(actor.id));
    }
  }, [kind, mayBlame, forOther, actor.id]);

  const isBranch = kind === "issue" && recipient === "branch";
  const activeBranches = branches.status === "ready" ? branches.data.branches : [];

  /**
   * เลือกสาเหตุแล้วสาเหตุนั้นกลายเป็นหมายเหตุเลย
   *
   * ยกเว้น "อื่น ๆ" ซึ่งเปิดช่องพิมพ์แทน — ล้างของเดิมทิ้งด้วย ไม่งั้นสาเหตุที่
   * เพิ่งกดไว้จะค้างอยู่ในช่องที่กำลังจะพิมพ์ทับ
   */
  function pickReason(v: string) {
    setReason(v);
    setNote(v === OTHER_REASON ? "" : v);
  }

  function reset() {
    setDoc("");
    setNote("");
    setReason("");
    setBasket([]);
    setTyping({});
    setIdemKey(`web:${uuid()}`);
  }

  /**
   * The picked product folded into the basket.
   *
   * The same product picked twice adds up rather than appearing twice: two
   * lines of one product is one withdrawal of it as far as the shelf is
   * concerned, and the API would merge them anyway.
   */
  function stash(lines: Line[], p: ProductRow, n: number): Line[] {
    const at = lines.findIndex((l) => l.sku === p.sku);
    if (at === -1) {
      return [...lines, { sku: p.sku, name: p.name, qty: n, onHand: p.onHand }];
    }
    const merged = [...lines];
    merged[at] = { ...merged[at], qty: merged[at].qty + n };
    return merged;
  }

  const lines = basket;
  const short = lines.find((l) => l.qty > l.onHand) ?? null;

  /** One tap on a row puts one of it in the basket. */
  function add(p: ProductRow | null) {
    if (p === null) return;
    setProblem(null);
    setBasket((b) => stash(b, p, 1));
    setTaps((n) => n + 1);
  }

  /** The steppers inside the basket, where a quantity is actually decided. */
  function setQtyOf(sku: string, n: number) {
    setProblem(null);
    setBasket((b) =>
      b.map((l) => (l.sku === sku ? { ...l, qty: Math.max(1, Math.min(n, l.onHand)) } : l)),
    );
  }

  /**
   * The same quantity, typed rather than stepped.
   *
   * Thirty of something is six taps of the plus button or two keystrokes. The
   * draft holds whatever is in the box — including nothing, mid-retype — and
   * only a real number reaches the basket, where it is clamped the way the
   * stepper clamps it.
   */
  function typeQtyOf(sku: string, text: string) {
    const digits = text.replace(/[^\d]/g, "");
    setTyping((t) => ({ ...t, [sku]: digits }));
    if (digits !== "") setQtyOf(sku, Number(digits));
  }

  /** Leaving the box gives up the draft, so the line shows the figure it kept. */
  function settleQtyOf(sku: string) {
    setTyping(({ [sku]: _gone, ...rest }) => rest);
  }

  function drop(sku: string) {
    setBasket((b) => b.filter((l) => l.sku !== sku));
    settleQtyOf(sku);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    const going = basket;
    if (going.length === 0) return;

    if (isBranch && branchId === "") {
      setProblem({ message: "เลือกสาขาที่มาเบิกก่อน" });
      return;
    }

    setBusy(true);
    setProblem(null);

    try {
      const out = await api.post<MoveResult>(
        kind === "scrap" ? "/stock/scrap-many" : "/stock/issue-many",
        {
        idem_key: idemKey,
        items: going.map((l) => ({ sku: l.sku, quantity: l.qty })),
        reference_doc: doc.trim() || null,
        note: note.trim() || null,
        // Exactly one of these two, which is what the API insists on.
        ...(isBranch
          ? { branch_id: Number(branchId) }
          : { issued_to_admin_id: staffId === "" ? null : Number(staffId) }),
        },
      );

      // Past this line the stock is already cut. Nothing below may throw into
      // the catch, or a finished cut would be reported as a failed one and
      // someone would do it again.
      reset();
      setReviewing(false);
      // The list under the dialog and the tiles over it both counted the stock
      // that just left; neither knows it yet.
      setRefresh((n) => n + 1);
      summary.reload();

      // Say it and get out of the way. The cut is finished, the next customer
      // is already at the counter, and leaving the last one's form on screen
      // with a green panel above it is how the wrong product gets cut twice.
      const done = out.lines ?? [];
      const what =
        done.length === 1
          ? done[0].name
          : `${count(done.length)} รายการ · ${count(out.quantity)} ชิ้น`;

      /* กดซ้ำใบเดิม — เซิร์ฟเวอร์ตอบใบเก่ากลับมา ไม่ได้ตัดสต็อกรอบสอง · ต้องบอก
         ไปตรง ๆ ไม่งั้น "ตัดสต็อกแล้ว" ใบที่สองจะอ่านว่าตัดไปสองรอบ */
      if (out.replayed) {
        toast.info({
          text: `รายการนี้บันทึกไปแล้ว — ${what}`,
          detail: "กดซ้ำไม่ได้ตัดสต็อกเพิ่ม ระบบตอบใบเดิมกลับมา",
          link: { href: "/movements", label: "ดูความเคลื่อนไหว" },
        });
        return;
      }

      /* ของไม่พอแล้วยังตัดออกไป = ยอดติดลบ กลายเป็นของที่ต้องสั่ง · เป็นเรื่อง
         ที่ระบบยอมให้ทำ (หน้าร้านขายของที่ยังไม่มีได้) แต่ไม่ใช่เรื่องที่ควร
         หายไปเงียบ ๆ — มีใบต้องสั่งซื้อเกิดขึ้นจากการกดครั้งนี้ */
      const short = done.flatMap((l) =>
        l.cuts.filter((c) => c.shortfall).map((c) => `${l.name} ×${c.quantity}`),
      );

      const detail =
        done
          .map((l) =>
            done.length === 1
              ? l.cuts.map((c) => `${c.lot} ×${c.quantity}`).join(" · ")
              : `${l.name} ×${count(l.quantity)}`,
          )
          .join(" · ") +
        (out.total_cost ? ` · ต้นทุนรวม ${money(Number(out.total_cost))} บาท` : "");

      const link = done.some((l) => l.branch_issue_id !== null)
        ? { href: "/settlements", label: "บันทึกให้สาขาแล้ว · ดูรายการ" }
        : { href: "/movements", label: "ดูความเคลื่อนไหว" };

      if (short.length > 0) {
        toast.warning({
          text: `${out.action === "SCRAP" ? "ตัดของเสีย" : "ตัดสต็อก"} ${what} แล้ว — ของไม่พอ ${short.join(" · ")}`,
          detail: `${detail} · ส่วนที่ขาดกลายเป็นสินค้ารอสั่ง ยอดคงเหลือติดลบ`,
          link: { href: "/backorders", label: "ดูสินค้ารอสั่ง" },
        });
      } else {
        toast.success({
          text: out.action === "SCRAP" ? `ตัดของเสีย ${what} แล้ว` : `ตัดสต็อก ${what} แล้ว`,
          detail,
          link,
        });
      }
    } catch (err) {
      if (ApiError.is(err)) {
        const sku = typeof err.extra.sku === "string" ? err.extra.sku : null;
        const named = going.find((l) => l.sku === sku);
        setProblem({
          // With several products on one request, "not enough" has to say
          // enough of what.
          message: named && going.length > 1 ? `${named.name}: ${err.message}` : err.message,
          available: typeof err.extra.available === "number" ? err.extra.available : undefined,
          sku,
        });
      } else {
        // Whatever this is, it is not the API refusing — say so and leave the
        // real thing in the console rather than swallowing it.
        console.error("ตัดสต็อกไม่สำเร็จด้วยเหตุที่ไม่ได้มาจาก API:", err);
        setProblem({ message: "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง" });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="work-main">
      <WorkHead
        title="เบิก / ตัดสต็อก"
        lede="เลือกสินค้า บอกจำนวนและคนที่เบิก ระบบตัดจากล็อตที่รับเข้าก่อนสุดให้เอง"
      >
        <button
          type="button"
          className={basket.length > 0 ? "btn btn--primary btn--icon" : "btn btn--icon"}
          onClick={() => setReviewing(true)}
          aria-label={`ตะกร้า ${count(basket.length)} รายการ`}
        >
          {/* Remounted on every tap — that is what replays the nudge and the
              pop, and it is why the counter exists rather than the count. */}
          <span className="cart__icon" key={`cart-icon-${taps}`}>
            <IconCart />
          </span>
          ตะกร้า
          {basket.length > 0 ? (
            <span className="cartcount" key={`cart-count-${taps}`}>
              {count(basket.length)}
            </span>
          ) : null}
        </button>
        <Link href="/stock/products" className="btn">
          สินค้าและสต็อก
        </Link>
      </WorkHead>

      {/* Until a product is chosen this page is a stock list, laid out exactly
          like the catalogue index — same toolbar, same full-width table, same
          pager. Choosing a row swaps the list for the form. */}
      {basket.length === 0 && summary.status === "ready" ? (
        <section className="readout" aria-label="สรุปคลัง">
          <div className="readout__cell readout__cell--mint">
            <p className="readout__label">คงคลังรวม</p>
            <p className="readout__figure">{count(summary.data.onHand)}</p>
            <p className="readout__note">ชิ้น จาก {count(summary.data.lots)} ล็อต</p>
          </div>
          <div className="readout__cell readout__cell--pear">
            <p className="readout__label">สินค้าทั้งหมด</p>
            <p className="readout__figure">{count(summary.data.products)}</p>
            <p className="readout__note">รายการในแคตตาล็อก</p>
          </div>
          <div className="readout__cell readout__cell--cyan">
            <p className="readout__label">สั่งตัด RX รอต้นทุน</p>
            <p className="readout__figure">{count(summary.data.rxAwaitingCost)}</p>
            <p className="readout__note">ใบสั่งที่ยังไม่มีต้นทุน</p>
          </div>
          <div className="readout__cell readout__cell--coral">
            <p className="readout__label">ล็อตรอใบกำกับ</p>
            <p
              className={
                summary.data.lotsMissingCost > 0
                  ? "readout__figure readout__figure--signal"
                  : "readout__figure"
              }
            >
              {count(summary.data.lotsMissingCost)}
            </p>
            <p className="readout__note">ล็อตที่ยังไม่รู้ต้นทุน</p>
          </div>
        </section>
      ) : null}

      {basket.length > 0 && !reviewing ? (
        <div className="basketbar" role="status">
          <span className="basketbar__what">
            ตะกร้า {count(basket.length)} รายการ ·{" "}
            {count(basket.reduce((n, l) => n + l.qty, 0))} ชิ้น
            <span className="basketbar__names">{basket.map((l) => l.name).join(" · ")}</span>
          </span>
          <button type="button" className="btn btn--primary btn--small" onClick={() => setReviewing(true)}>
            ดูตะกร้าแล้วตัด
          </button>
          <button type="button" className="btn btn--quiet btn--small" onClick={() => setBasket([])}>
            ล้างตะกร้า
          </button>
        </div>
      ) : null}

      {/* The list stays a list, and a row goes straight into the basket. No
          form opens over it, so the shelf you were reading is still the shelf
          you are reading — which is the whole point when the other lens of the
          pair is three rows down. */}
      <ProductPicker
        value={null}
        onPick={add}
        pickLabel="+ ใส่ตะกร้า"
        refresh={refresh}
        only="ready"
        label="สินค้าที่จะเบิก"
        // Standing at the shelf, what is left is the thing being scanned for.
        defaultSort="onhand"
        autoFocus
      />

      {reviewing ? (
        <TaskDialog
          eyebrow={kind === "scrap" ? "ตัดของเสีย" : "เบิก / ตัดสต็อก"}
          title={`ตะกร้า · ${count(basket.length)} รายการ`}
          onClose={() => setReviewing(false)}
        >
          {basket.length === 0 ? (
            <div className="basket__empty">
              <p>ตะกร้ายังว่าง</p>
              <p className="field__help">
                ตะกร้ามีไว้ตัดหลายรายการพร้อมกันในครั้งเดียว — คู่เลนส์ซ้าย–ขวาเป็นคนละรหัส
                ถ้าตัดทีละอันแล้วอีกข้างของไม่พอ จะเหลือเลนส์ครึ่งคู่ค้างในสมุด
              </p>
              <p className="field__help">
                วิธีใช้: ปิดหน้านี้ → กด <strong>เลือก</strong> ที่สินค้าชิ้นแรก → ใส่จำนวน → กด{" "}
                <strong>+ ใส่ตะกร้า แล้วเลือกชิ้นต่อไป</strong> → เลือกชิ้นถัดไป → กดตัดทีเดียวจบ
              </p>
              <div className="chips">
                <button type="button" className="btn btn--primary" onClick={() => setReviewing(false)}>
                  เข้าใจแล้ว ไปเลือกสินค้า
                </button>
              </div>
            </div>
          ) : (
          <form onSubmit={submit} noValidate>
            {/* Same FIFO cut either way — the reason decides whether the cost
                lands in cost of goods sold or in waste. */}
            <div className="chips chips--bar" role="group" aria-label="ประเภทรายการ">
              <button
                type="button"
                className="chip"
                aria-current={kind === "issue" ? "true" : undefined}
                onClick={() => setKind("issue")}
              >
                เบิก / ขาย
              </button>
              <button
                type="button"
                className="chip"
                aria-current={kind === "scrap" ? "true" : undefined}
                onClick={() => setKind("scrap")}
              >
                ตัดของเสีย
              </button>
            </div>

            {/* What is going out — and where its quantity is decided. The
                stepper lives on the line rather than in a field above it,
                because with several products there is no "the" quantity. */}
            <div className="basket">
              <p className="basket__head">
                {count(lines.length)} รายการ · {count(lines.reduce((n, l) => n + l.qty, 0))} ชิ้น
              </p>
              <ul className="basket__list">
                {lines.map((l) => (
                  <li className="basket__line" key={l.sku}>
                    <span className="basket__name">
                      {l.name}
                      <span className="basket__sku">
                        {l.sku} · มีอยู่ {count(l.onHand)}
                      </span>
                    </span>
                    <span className="basket__step">
                      <button
                        type="button"
                        className="qty__step"
                        onClick={() => setQtyOf(l.sku, l.qty - 1)}
                        disabled={busy || l.qty <= 1}
                        aria-label={`ลดจำนวน ${l.name}`}
                      >
                        −
                      </button>
                      {/* Typed as well as stepped: thirty of something is six
                          taps of the plus button, or two keystrokes. */}
                      <input
                        className={
                          l.qty > l.onHand
                            ? "input basket__qtyinput basket__qtyinput--short"
                            : "input basket__qtyinput"
                        }
                        inputMode="numeric"
                        autoComplete="off"
                        value={typing[l.sku] ?? String(l.qty)}
                        onChange={(e) => typeQtyOf(l.sku, e.target.value)}
                        onBlur={() => settleQtyOf(l.sku)}
                        disabled={busy}
                        aria-label={`จำนวน ${l.name}`}
                      />
                      <button
                        type="button"
                        className="qty__step"
                        onClick={() => setQtyOf(l.sku, l.qty + 1)}
                        disabled={busy || l.qty >= l.onHand}
                        aria-label={`เพิ่มจำนวน ${l.name}`}
                      >
                        +
                      </button>
                    </span>
                    <button
                      type="button"
                      className="btn btn--quiet btn--small"
                      onClick={() => drop(l.sku)}
                      disabled={busy}
                    >
                      เอาออก
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="formgrid">
              <div className="field">
                <label className="field__label" htmlFor="if-doc">
                  เลขที่เอกสาร
                </label>
                <input
                  id="if-doc"
                  className="input"
                  value={doc}
                  onChange={(e) => setDoc(e.target.value)}
                  placeholder="เช่น JOB-1042 หรือ SO-2026-1058"
                  disabled={busy}
                />
              </div>
            </div>

            {kind === "issue" ? (
              <div className="chips chips--bar" role="group" aria-label="ใครเบิก">
                <button
                  type="button"
                  className="chip"
                  aria-current={recipient === "staff" ? "true" : undefined}
                  onClick={() => setRecipient("staff")}
                >
                  พนักงานในร้าน
                </button>
                <button
                  type="button"
                  className="chip"
                  aria-current={recipient === "branch" ? "true" : undefined}
                  onClick={() => setRecipient("branch")}
                >
                  สาขาอื่นมาเบิก
                </button>
              </div>
            ) : null}

            {/* The person signed in is the person taking the stock, nearly
                every time. So it is stated, not asked: the name comes off their
                own account and the picker stays out of the way until someone
                actually is drawing on behalf of a colleague. */}
            {!isBranch ? (
              forOther ? (
                <div className="field">
                  <label className="field__label" htmlFor="if-who">
                    {kind === "scrap" ? "คนที่ทำของเสีย" : "ผู้เบิก"}
                  </label>
                  <Select
                    id="if-who"
                    value={staffId}
                    onChange={setStaffId}
                    disabled={busy || people.status !== "ready"}
                    placeholder="ไม่ระบุ"
                    options={[
                      { value: "", label: "ไม่ระบุ" },
                      ...(people.status === "ready"
                        ? people.data.people.map((p) => ({
                            value: String(p.id),
                            label: p.displayName + (p.jobTitle ? ` · ${p.jobTitle}` : ""),
                          }))
                        : []),
                    ]}
                  />
                  <div className="chips">
                    <button
                      type="button"
                      className="btn btn--quiet btn--small"
                      disabled={busy}
                      onClick={() => {
                        setForOther(false);
                        setStaffId(String(actor.id));
                      }}
                    >
                      กลับมาเป็นตัวเอง
                    </button>
                  </div>
                  <span className="field__help">
                    รายการนี้จะขึ้นชื่อ {actor.displayName} เป็นผู้บันทึกเสมอ ไม่ว่าเลือกใคร
                    {kind === "scrap" ? "เป็นคนทำของเสีย" : "เป็นผู้เบิก"}
                  </span>
                  {kind === "scrap" ? (
                    <span className="field__help">
                      ชื่อที่เลือกจะไปรวมเป็นยอดของเสียรายคนในแดชบอร์ด
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="whois">
                  <span className="whois__what">
                    <span className="whois__label">
                      {kind === "scrap" ? "คนที่ทำของเสีย" : "ผู้เบิก"}
                    </span>
                    <span className="whois__name">
                      {actor.displayName}
                      {actor.jobTitle ? ` · ${actor.jobTitle}` : ""}
                    </span>
                  </span>
                  {/* On a scrap this button is an accusation, so only the owner
                      gets it. Everyone else writes off what they broke under
                      their own name, which needs no permission at all. */}
                  {kind === "issue" || mayBlame ? (
                    <button
                      type="button"
                      className="btn btn--quiet btn--small"
                      disabled={busy}
                      onClick={() => setForOther(true)}
                    >
                      {kind === "scrap" ? "คนอื่นเป็นคนทำ" : "เบิกแทนคนอื่น"}
                    </button>
                  ) : null}
                </div>
              )
            ) : (
              <>
                <div className="formgrid">
                  <div className="field">
                    <label className="field__label" htmlFor="if-branch">
                      สาขาที่มาเบิก
                    </label>
                    <Select
                      id="if-branch"
                      value={branchId}
                      onChange={setBranchId}
                      disabled={busy || branches.status !== "ready"}
                      placeholder="เลือกสาขา"
                      options={[
                        { value: "", label: "เลือกสาขา" },
                        ...activeBranches.map((b) => ({ value: String(b.id), label: b.name })),
                      ]}
                    />
                  </div>
                </div>

                {branches.status === "ready" && activeBranches.length === 0 ? (
                  <div className="notice" role="status">
                    ยังไม่มีสาขาในระบบ —{" "}
                    <Link href="/stock/branches" className="grid__link">
                      เพิ่มสาขาก่อน
                    </Link>
                  </div>
                ) : (
                  <div className="notice" role="status">
                    สาขาเบิกจะ<strong>ตัดสต็อกและลงต้นทุนวันนี้</strong> — เรื่องเงินกับกำไร
                    บัญชีคิดเองจาก Excel · ดูของที่ออกไปแล้วได้ที่หน้า{" "}
                    <Link href="/stock/settlements" className="grid__link">
                      ของที่สาขาเบิกไป
                    </Link>
                  </div>
                )}
              </>
            )}

            {/* ของเสียเลือกจากรายการ ของเบิกพิมพ์เอง

                สองช่องนี้ลงคอลัมน์เดียวกัน แต่ตอบคนละคำถาม · หมายเหตุของใบเบิก
                เป็นเรื่องเฉพาะใบ ("ลูกค้าคุณสมชายมารับเอง") เดาแทนไม่ได้ จึงยัง
                เป็นช่องพิมพ์ · สาเหตุที่ของเสียมีอยู่ไม่กี่แบบและวนซ้ำทุกสัปดาห์
                ปล่อยให้พิมพ์เองแปลว่า "เจียร์เสีย" "เจียรเสีย" "เจียนเสีย" จะ
                กลายเป็นสามสาเหตุตอนไล่ดูย้อนหลังว่าของหายไปกับอะไรมากที่สุด

                เหลือ "อื่น ๆ" ไว้ให้พิมพ์ เพราะวันหนึ่งจะมีสาเหตุที่สี่ และการ
                บังคับให้เลือกผิด ๆ ไปหนึ่งข้อแย่กว่าปล่อยให้เขียนตามจริง */}
            {kind === "scrap" ? (
              <>
                <div className="field">
                  <label className="field__label" htmlFor="if-reason">
                    สาเหตุที่เสีย
                  </label>
                  <Select
                    id="if-reason"
                    value={reason}
                    onChange={pickReason}
                    disabled={busy}
                    placeholder="เลือกสาเหตุ"
                    options={[
                      { value: "", label: "— ไม่ระบุ —" },
                      ...SCRAP_REASONS.map((r) => ({ value: r, label: r })),
                      { value: OTHER_REASON, label: OTHER_REASON },
                    ]}
                  />
                </div>

                {reason === OTHER_REASON ? (
                  <div className="field">
                    <label className="field__label" htmlFor="if-note">
                      เขียนสาเหตุ
                    </label>
                    <input
                      id="if-note"
                      className="input"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="เช่น ขอบบิ่นตอนใส่กรอบ"
                      disabled={busy}
                      autoComplete="off"
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <div className="field">
                <label className="field__label" htmlFor="if-note">
                  หมายเหตุ
                </label>
                <input
                  id="if-note"
                  className="input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="เช่น ขายหน้าร้าน"
                  disabled={busy}
                  autoComplete="off"
                />
              </div>
            )}

            {problem ? (
              <div className="notice notice--error" role="alert">
                <p>{problem.message}</p>
                {problem.available !== undefined && problem.available > 0 && problem.sku ? (
                  <button
                    type="button"
                    className="btn btn--small"
                    style={{ marginBlockStart: "var(--space-xs)" }}
                    onClick={() => setQtyOf(problem.sku as string, problem.available as number)}
                    disabled={busy}
                  >
                    ปรับเป็น {count(problem.available)} ชิ้น เท่าที่มี
                  </button>
                ) : null}
                {problem.available === 0 ? (
                  <p className="field__help" style={{ marginBlockStart: "var(--space-2xs)" }}>
                    ของหมด —{" "}
                    <Link href="/stock/products" className="grid__link">
                      รับล็อตใหม่ที่หน้าสินค้า
                    </Link>{" "}
                    หรือ{" "}
                    <Link href="/stock/rx" className="grid__link">
                      เปิดใบสั่งพิเศษ RX
                    </Link>
                  </p>
                ) : null}
              </div>
            ) : null}

            {short !== null ? (
              <div className="notice notice--error" role="alert">
                {short.name} มีอยู่ {count(short.onHand)} ชิ้น แต่ตะกร้าขอ {count(short.qty)} ชิ้น
                — แก้จำนวนก่อน ทั้งตะกร้าถึงจะตัดได้
              </div>
            ) : null}

            <button type="submit" className="btn btn--primary" disabled={busy || short !== null}>
              {busy
                ? "กำลังบันทึก…"
                : `${kind === "scrap" ? "บันทึกของเสีย" : isBranch ? "บันทึกสาขาเบิก" : "ตัดสต็อก"}${
                    lines.length > 1 ? ` ${count(lines.length)} รายการ` : ""
                  }`}
            </button>
          </form>
          )}
        </TaskDialog>
      ) : null}
    </main>
  );
}
