"use client";

import { useEffect, useState } from "react";
import { can, useActor } from "./AppShell";
import QtyField from "./QtyField";
import Select from "./Select";
import {
  api,
  ApiError,
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABEL,
  type CreatedLot,
  type Page,
  type ProductDetail,
  type ProductRow,
} from "@/stockmod/lib/api";
import { qs, useApi } from "@/stockmod/lib/useApi";
import { count } from "@/stockmod/lib/format";
import {
  ADD_LADDER,
  AXIS_LADDER,
  COATING_SEED,
  CYL_LADDER,
  INDEX_SEED,
  RX_BRANDS,
  SPH_LADDER,
  STOCK_BRANDS,
} from "@/stockmod/lib/optics";
import DateField from "./DateField";

type Category = { id: number; code: string; name: string };
type Supplier = { id: number; name: string };

/**
 * One spec field, described rather than hand-written.
 *
 * There are five product types and each asks for something different; writing
 * the JSX out five times is how two of them quietly end up with a field the
 * others lost. Describing them means adding a field is a data change, and every
 * type is laid out by the same code.
 */
type Spec = {
  /** The key inside `products.attributes`. */
  key: string;
  label: string;
  input?: "text" | "select" | "bool";
  options?: readonly string[];
  placeholder?: string;
  help?: string;
  /** Stored as a JSON number, not a string — see the note in `submit`. */
  numeric?: boolean;
  /** Shown only when another field on the same form holds one of these values. */
  when?: { key: string; is: readonly string[] };
  wide?: boolean;
  /**
   * Values offered before the catalogue has any of its own.
   *
   * A picker that starts empty teaches the first person to type, and the second
   * to type it differently. These are the shop's own words for the things it
   * actually stocks — they seed the list on day one and are joined by whatever
   * has been entered since. Never a closed list: a coating nobody has heard of
   * is still enterable the day the rep brings it in.
   */
  seed?: readonly string[];
};

const EYE_SIDE: Spec = {
  key: "eye_side",
  label: "ข้างตา",
  input: "select",
  options: ["left", "right"],
};

const EYE_LABEL: Record<string, string> = {
  left: "L — ตาซ้าย",
  right: "R — ตาขวา",
};

/**
 * What each kind of product is asked for.
 *
 * The keys are the ones already in `products.attributes`, so this form edits the
 * catalogue the shop-floor system reads rather than inventing a parallel shape.
 * `attributes` is JSON in a LONGTEXT column and will hold anything — which is
 * exactly why the form has to be opinionated. A free-form key/value editor gets
 * "colour", "color" and "สี" in the same table within a week.
 */
/**
 * Which of the maker's products this is.
 *
 * Asked of every type, because it is half of every composed name: a brand alone
 * names a company, and a brand with a model names a thing you can order. It
 * lives in `attributes.model` — the catalogue's own column is `name`, and
 * `name` is now the composed sentence rather than one of its words.
 */
const MODEL: Spec = {
  key: "model",
  label: "รุ่น",
  placeholder: "HiVision · TS2088 · SofLens Daily",
  // Optional, like every other spec box. A frame from a supplier who
  // model-numbers nothing is still a frame, and the composed name simply
  // reads one word shorter.
  help: "เว้นว่างได้ — ชื่อที่ตั้งให้จะข้ามไปเฉย ๆ",
};

const SPECS: Record<string, { title: string; fields: Spec[] }> = {
  Lens: {
    title: "สเปกเลนส์",
    fields: [
      MODEL,
      {
        key: "lens_design",
        label: "ชนิดเลนส์",
        input: "select",
        options: ["Single Vision", "Bifocal", "Progressive"],
      },
      {
        key: "lens_index",
        label: "Index",
        // Free rather than closed, like the coatings: these six are what the
        // shop stocks today, not what physics allows, and the first 1.71 has to
        // be enterable on the day it arrives.
        seed: INDEX_SEED,
      },
      {
        key: "coating",
        label: "Coating",
        placeholder: "เลือก หรือพิมพ์ชื่อใหม่",
        seed: COATING_SEED,
        wide: true,
      },
      EYE_SIDE,
    ],
  },
  Frame: {
    title: "สเปกกรอบแว่น",
    fields: [
      MODEL,
      { key: "color", label: "สี", placeholder: "ดำเงา" },
      { key: "size", label: "ขนาด", placeholder: "50-22-150", help: "เลนส์-สะพาน-ขา (มม.)" },
      { key: "material", label: "วัสดุ", placeholder: "Acetate · Metal · Titanium · TR90" },
      { key: "product_line", label: "ไลน์สินค้า", placeholder: "Eyewear" },
    ],
  },
  Sunglass: {
    title: "สเปกแว่นกันแดด",
    fields: [
      MODEL,
      { key: "color", label: "สี", placeholder: "ดำ" },
      { key: "size", label: "ขนาด", placeholder: "54-16-145", help: "เลนส์-สะพาน-ขา (มม.)" },
      { key: "material", label: "วัสดุ", placeholder: "Nylon · O-Matter · Acetate" },
      { key: "tint", label: "สีเลนส์", placeholder: "Grey Gradient · Prizm Bronze" },
      { key: "polarized", label: "โพลาไรซ์", input: "bool" },
      { key: "product_line", label: "ไลน์สินค้า", placeholder: "Eyewear" },
    ],
  },
  ContactLen: {
    title: "สเปกคอนแทคเลนส์",
    fields: [
      MODEL,
      { key: "bc", label: "BC (ความโค้ง)", placeholder: "8.6", seed: ["8.3", "8.4", "8.5", "8.6", "8.7", "8.8", "9.0"] },
      { key: "dia", label: "DIA (เส้นผ่านศูนย์กลาง)", placeholder: "14.2", seed: ["13.8", "14.0", "14.2", "14.5"] },
      { key: "pack", label: "จำนวนต่อกล่อง", placeholder: "30", seed: ["1", "5", "6", "10", "30", "90"], numeric: true },
      { key: "wear", label: "รอบการใส่", input: "select", options: ["Daily", "Bi-weekly", "Monthly"] },
      EYE_SIDE,
    ],
  },
  Accessory: {
    title: "สเปกอุปกรณ์เสริม",
    fields: [
      MODEL,
      {
        key: "kind",
        label: "ประเภท",
        input: "select",
        options: ["Case", "Cleaning", "Chain", "Cloth", "Other"],
        help: "น้ำยาล้างแว่นเลือก Cleaning",
      },
      // The fields below follow from the kind — a bottle of solution has a
      // volume and no colour; a cloth has a size and no volume.
      { key: "volume", label: "ปริมาตร", placeholder: "60ml", when: { key: "kind", is: ["Cleaning"] } },
      { key: "color", label: "สี", when: { key: "kind", is: ["Case", "Chain", "Cloth", "Other"] } },
      { key: "size", label: "ขนาด", placeholder: "15x18cm", when: { key: "kind", is: ["Case", "Cloth", "Other"] } },
    ],
  },
};

/**
 * The prescription, on every lens.
 *
 * Not only on made-to-order ones: a stock lens is stocked *by power* — a drawer
 * of −2.00 is a different SKU from a drawer of −2.25 — so the power is part of
 * what the product is, not something a customer's order adds later.
 */
const RX_FIELDS: Spec[] = [
  {
    key: "sph",
    label: "SPH (สายตาสั้น/ยาว)",
    placeholder: "เลือก หรือพิมพ์ค่า",
    seed: SPH_LADDER,
    numeric: true,
  },
  {
    key: "cyl",
    label: "CYL (สายตาเอียง)",
    placeholder: "เลือก หรือพิมพ์ค่า",
    seed: CYL_LADDER,
    numeric: true,
  },
  { key: "axis", label: "AXIS (องศา)", placeholder: "0–180", seed: AXIS_LADDER, numeric: true },
  // "+2.00" — the leading plus is part of how an ADD is written and read, so it
  // is kept as text rather than normalised into a number.
  {
    key: "add",
    label: "ADD (ระยะใกล้)",
    placeholder: "+2.00",
    seed: ADD_LADDER,
    help: "ใช้กับ Progressive และ Bifocal",
  },
];

/**
 * บอกล่วงหน้าว่าเลือกชนิดนี้แล้วต้องกรอกอะไร — เหลือเฉพาะเลนส์
 *
 * ชนิดอื่นกรอกไม่กี่ช่องและเดาได้จากชื่อ การเขียนไว้ให้ครบทุกใบทำให้หน้าเลือก
 * กลายเป็นกำแพงตัวหนังสือที่ต้องอ่านก่อนกด ทั้งที่คนกดรู้อยู่แล้วว่าจะเพิ่มอะไร
 * เลนส์ต่างออกไปตรงที่มีค่าสายตาและสเปกยาวกว่าชนิดอื่นหลายเท่า คนที่ไม่เคยเพิ่ม
 * เลนส์มาก่อนควรได้เห็นก่อนกด ไม่ใช่ไปเจอตอนฟอร์มเปิดแล้ว
 */
const TYPE_ASKS: Record<string, string> = {
  Lens: "ชนิดเลนส์ · Index · Coating · ข้างตา · SPH CYL AXIS ADD",
};

/** Every key this form owns, so a value cleared here is truly removed. */
const OWNED_KEYS = new Set<string>([
  ...Object.values(SPECS).flatMap((s) => s.fields.map((f) => f.key)),
  ...RX_FIELDS.map((f) => f.key),
]);

const str = (v: unknown): string =>
  v === null || v === undefined || typeof v === "object" ? "" : String(v);

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The spec values a product's `attributes` supply to the form's fields.
 *
 * A product being added starts its two powers at 0.00 rather than blank.
 * Plano is where a prescription is read from — the optician works out from
 * zero in quarter steps — and it is also the honest value for the half of the
 * catalogue that has no power at all. An existing product is left exactly as
 * stored: a lens whose SPH was never recorded is not a plano lens, and filling
 * the box in for it would turn a gap into a claim.
 */
function specValues(attrs: Record<string, unknown>, isNew = false): Record<string, string> {
  const v: Record<string, string> = {};
  for (const key of OWNED_KEYS) v[key] = str(attrs[key]);
  v.eye_side = str(attrs.eye_side);
  v.polarized = attrs.polarized === true ? "1" : "0";
  if (isNew) {
    for (const key of ["sph", "cyl"]) {
      if (v[key] === "") v[key] = "0.00";
    }
  }
  return v;
}

/**
 * One form for both adding and editing, because the fields and the rules are
 * identical — only the endpoint differs. Two near-copies would drift.
 *
 * Adding starts by choosing what kind of thing is being added, because that is
 * what decides which questions are worth asking. Editing skips that step: the
 * product already knows what it is.
 *
 * Anything already in `attributes` that this form does not know about is carried
 * through untouched. The shop-floor system writes to the same column, and an
 * edit here must not quietly drop a key it has never heard of.
 */
export default function ProductForm({
  product,
  onSaved,
  onCancel,
  receive = false,
  make,
  presetType,
  onUseExisting,
}: {
  product?: ProductDetail;
  onSaved: (id: number, lot?: CreatedLot) => void;
  onCancel: () => void;
  /**
   * Settle what kind of goods this is, instead of asking.
   *
   * A screen that only deals in one kind should not offer the other: the
   * receiving screen cannot receive a made-to-order lens — it holds no stock —
   * and the RX screen orders nothing else. Leaving the choice on both was how a
   * made-to-order product got created on the receiving screen and then handed
   * to a form whose every outcome was the API refusing it.
   *
   * Unset on the catalogue screen, where both kinds are legitimately added.
   */
  make?: "stock" | "custom";
  /** Skip the "what are you adding" step, when the screen already knows. */
  presetType?: string;
  /**
   * Take the existing product instead of adding a copy of it.
   *
   * Offered by screens that can act on a product directly — the receiving one
   * can put a lot against it. Copying is for "like that, but different"; it is
   * the wrong tool for "that one", and the two are one keystroke apart.
   */
  onUseExisting?: (id: number) => void;
  /**
   * Take the first lot in with the same save.
   *
   * A delivery is where new products are discovered, so the screen that receives
   * one asks for the lot here rather than creating the catalogue entry and then
   * making someone find the lot form for the thing they are holding.
   */
  receive?: boolean;
}) {
  const actor = useActor();
  const mayCost = can.enterCost(actor);

  const cats = useApi<{ categories: Category[] }>("/categories");

  // No type until one is chosen, which is what shows the chooser — unless the
  // screen already knows, in which case there is nothing to choose.
  const [type, setType] = useState<string>(product?.productType ?? presetType ?? "");

  const [sku, setSku] = useState(product?.sku ?? "");

  /**
   * Whether the SKU on screen is the one the system issued.
   *
   * A product already in the catalogue keeps the code it was filed under —
   * changing it would orphan every label and every job sheet that quotes it —
   * so editing starts with this off. A new product starts with it on and the
   * code arrives from the API; typing over it turns it off for good, because
   * someone who has entered the supplier's own code should not have it
   * overwritten when they step back to change the type.
   */
  const [autoSku, setAutoSku] = useState(product === undefined);

  const [custom, setCustom] = useState(product?.isCustomMade ?? make === "custom");

  // Refetched when the made-to-order switch flips, because the two kinds
  // number in different series — a stocked lens is LNS-0007, one cut to order
  // is RX-0007, and a code that says the wrong one is a code that misleads.
  const issued = useApi<{ sku: string }>(
    autoSku && type !== ""
      ? `/products/next-sku?type=${type}${custom ? "&custom=1" : ""}`
      : null,
  );

  /**
   * What the catalogue already calls things of this type.
   *
   * Offered back rather than enforced: the same frame typed as "Gucci GG0396",
   * "GG-0396" and "gucci gg0396" is three products on the shelf report and one
   * on the shelf. Picking the existing spelling is one tap; typing a new one is
   * still just typing.
   */
  const hints = useApi<{
    names: string[];
    brands: string[];
    /** Every spec value this type already holds, keyed by attribute. */
    values: Record<string, string[]>;
  }>(
    type === "" ? null : `/products/hints?type=${type}`,
  );

  const asChoices = (xs: string[] | undefined) =>
    (xs ?? []).map((x) => ({ value: x, label: x }));

  /**
   * What a spec box offers: the shop's own words first, then everything the
   * catalogue has been given since, with the duplicates dropped.
   *
   * Seeds lead rather than sort in alphabetically — they are the five coatings
   * this shop actually sells, and burying them among thirty historical spellings
   * would defeat the point of having named them.
   */
  const choicesFor = (f: Spec) => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const v of [...(f.seed ?? []), ...(hints.data?.values?.[f.key] ?? [])]) {
      const t = v.trim();
      if (t === "" || seen.has(t)) continue;
      seen.add(t);
      out.push({ value: t, label: t });
    }
    return out;
  };

  /**
   * The brands this shop buys from, before the catalogue can name any itself.
   *
   * Two lists, because they are two trades. What sits in the drawers is bought
   * from the houses the shop stocks; what is cut to order is ordered from the
   * lens makers, and the overlap between them is one name. Offering all ten
   * everywhere would put Rodenstock on the frame shelf and Hitop on a job
   * sheet — which is how a brand column stops being worth reading.
   */
  const BRAND_SEED = custom ? RX_BRANDS : STOCK_BRANDS;

  useEffect(() => {
    if (autoSku && issued.status === "ready") setSku(issued.data.sku);
  }, [autoSku, issued.status, issued.data]);
  const [name, setName] = useState(product?.name ?? "");
  /**
   * Whether the name is still the one the spec composes, or one someone typed.
   *
   * The same bargain the SKU makes two fields up: filled in for you, and yours
   * the moment you touch it. An existing product opens as typed — its name is
   * already whatever it is, and rewriting it because a drawer was opened would
   * be a change nobody asked for.
   */
  const [autoName, setAutoName] = useState(product === undefined);
  const [brand, setBrand] = useState(product?.brand ?? "");
  // 0 is how the column stores "not priced yet", so the box opens empty for it
  // — showing "0" would read as a price of nothing rather than as no price.
  const [price, setPrice] = useState(
    product && product.basePrice > 0 ? String(product.basePrice) : "",
  );
  /**
   * How few of it the shop is willing to be down to. Blank, not "0".
   *
   * Blank is the honest reading of a product nobody has set a level for, and it
   * is also what has to be typed to switch the alert back off — a field that
   * opens showing 0 invites the owner to think one is set and reads as a
   * minimum that is permanently met.
   */
  const [minStock, setMinStock] = useState(
    product && product.minStock > 0 ? String(product.minStock) : "",
  );

  /**
   * What `attributes` held before this form touched it.
   *
   * Kept in state rather than read from the prop because copying an existing
   * product replaces it: the copy should inherit that product's unknown keys the
   * same way an edit preserves its own.
   */
  const [carried, setCarried] = useState<Record<string, unknown>>(product?.attributes ?? {});

  /**
   * The product this one was copied from, while the copy still looks like it.
   *
   * Two products cannot share a code, so a copy always gets a new one — which
   * is right, and is also how a second "กล่องแว่นแบบแข็ง" ends up beside the
   * first when what someone meant was "more of that one". Remembering the
   * source lets the form say so while the name is still unchanged, and offer
   * the thing they probably wanted instead.
   */
  const [copiedFrom, setCopiedFrom] = useState<ProductDetail | null>(null);

  /** Every spec value, keyed by its `attributes` key. */
  const [values, setValues] = useState<Record<string, string>>(() =>
    specValues(product?.attributes ?? {}, product === undefined),
  );

  /**
   * The name this spec composes, asked of the API rather than worked out here.
   *
   * The server names the product on save from the same function, so a preview
   * computed in the browser would be a second implementation of the one rule
   * that decides what the shop-floor system sees this product as. Asked on
   * every change: the values are short, the shop is on its own LAN, and the
   * hook keys on the URL, so nothing is fetched twice for the same spec.
   */
  const composed = useApi<{ name: string }>(
    type === ""
      ? null
      : `/products/compose-name${qs({
          type,
          brand,
          custom: custom ? "1" : "",
          model: values.model,
          coating: values.coating,
          lens_index: values.lens_index,
          lens_design: values.lens_design,
          // A made-to-order lens is a model and carries no power — the form
          // does not ask for one and `submit` does not write one. The preview
          // has to agree, or the box promises a name ending "0.00/0.00" that
          // the save will not produce.
          ...(custom && type === "Lens"
            ? {}
            : { sph: values.sph, cyl: values.cyl, axis: values.axis, add: values.add }),
          color: values.color,
          size: values.size,
          material: values.material,
          tint: values.tint,
          bc: values.bc,
          dia: values.dia,
          pack: values.pack,
          wear: values.wear,
          kind: values.kind,
          volume: values.volume,
        })}`,
  );

  useEffect(() => {
    if (autoName && composed.status === "ready") setName(composed.data.name);
  }, [autoName, composed.status, composed.data]);

  /* ------------------------------------------------------------ first lot */

  const suppliers = useApi<{ suppliers: Supplier[] }>(receive ? "/suppliers" : null);

  const [qty, setQty] = useState("1");
  const [supplierId, setSupplierId] = useState("");
  const [cost, setCost] = useState("");
  const [received, setReceived] = useState(today);
  const [expiry, setExpiry] = useState("");
  const [note, setNote] = useState("");

  // Made-to-order products hold no stock, so there is no lot to receive.
  const wantLot = receive && product === undefined && !custom;

  /**
   * Set once the product exists.
   *
   * Only reached when the product saved and its lot did not. Re-submitting must
   * then receive the lot alone — sending the product again would come back as a
   * duplicate SKU and hide the failure that actually needs fixing.
   */
  const [savedId, setSavedId] = useState<number | null>(null);

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /* ---------------------------------------------------------------- wizard */

  /**
   * Three kinds of question, asked one at a time.
   *
   * What the thing is, what its spec is, and what arrived in the box are
   * different enough that putting them on one scroll makes the last group read
   * as optional — and it is the last group that carries the money. Editing an
   * existing product skips the lot stop: it has lots already, and they are
   * corrected from the product's own drawer, not from here.
   */
  /**
   * The spec is always a stop, whatever is being added.
   *
   * It used to be skipped for everything but a lens while receiving: a frame's
   * colour was worth recording but not worth standing at the counter for with
   * the delivery waiting, so it was left to the catalogue screen.
   *
   * That stopped being true when the name began to be composed from the spec.
   * Skipping it now files a frame called "Hitop" and nothing else — and the
   * next Hitop frame is called "Hitop" too. The stop that was costing fifteen
   * seconds was the stop that makes the row identifiable, so it is always
   * asked, and every field on it may still be left blank.
   */
  const wantSpec = true;

  const steps = [
    "ข้อมูลหลัก",
    ...(wantSpec ? ["รายละเอียดสินค้า"] : []),
    ...(wantLot ? ["ล็อตแรกที่รับเข้า"] : []),
  ];
  const [step, setStep] = useState(0);
  // Flipping to สั่งตัด RX on the first stop removes the lot stop underneath.
  const at = Math.min(step, steps.length - 1);
  const last = at === steps.length - 1;

  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));

  /**
   * What has to be right before the next stop.
   *
   * Checked here rather than left to the API because a wizard that accepts a
   * blank SKU on the first stop and reports it two stops later has made the
   * person walk further to learn less.
   */
  function blocking(): string | null {
    if (at > 0) return null;
    if (!autoSku && sku.trim() === "") {
      return "ใส่ SKU ก่อน — เป็นรหัสที่ใช้อ้างถึงสินค้านี้ทุกที่ในระบบ";
    }
    if (name.trim() === "") return "ใส่ชื่อสินค้าก่อน";
    // Blank is allowed — stock arrives before the price list does, and a frame
    // nobody has priced yet still has to be counted in.
    if (price.trim() !== "" && !/^\d{1,10}(\.\d{1,2})?$/.test(price.trim())) {
      return "ราคาขายต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกินสองตำแหน่ง — หรือเว้นว่างไว้ก่อนก็ได้";
    }
    if (minStock.trim() !== "" && !/^\d{1,5}$/.test(minStock.trim())) {
      return "จำนวนขั้นต่ำต้องเป็นจำนวนเต็มไม่ติดลบ หรือเว้นว่างไว้ถ้าไม่ต้องการให้เตือน";
    }
    return null;
  }

  function forward() {
    const stop = blocking();
    if (stop !== null) {
      setProblem(stop);
      return;
    }
    setProblem(null);
    setStep(at + 1);
  }

  /**
   * Typing in the field the complaint was about takes the complaint down.
   *
   * Leaving it up until the next submit is how someone ends up reading "ใส่
   * เลขล็อตก่อน" while looking straight at the lot number they just typed, and
   * concluding the form is broken. Only the fields a check can fail on are
   * wrapped — a message about the SKU should not vanish because someone edited
   * a note.
   */
  const clearing =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      if (problem !== null) setProblem(null);
      set(v);
    };

  /**
   * The category, taken from the type rather than asked for.
   *
   * There is exactly one category per product type and they carry the type's own
   * code, so a separate "หมวดหมู่" select offered the same five choices twice and
   * was only ever a way to disagree with the answer above it.
   */
  const categoryId =
    (cats.status === "ready"
      ? cats.data.categories.find((c) => c.code === type)?.id
      : undefined) ??
    product?.categoryId ??
    null;

  const spec = SPECS[type];

  /**
   * A made-to-order product is a *model*, not a piece.
   *
   * Its power and its side belong to the job it is cut for — they live on the
   * RX order now, one set per customer — so asking for them here would file one
   * prescription on a model that a hundred different prescriptions will be cut
   * from, which is exactly the mess the order table was added to end. A stocked
   * lens is the opposite: a drawer of −2.00 is a different SKU from a drawer of
   * −2.25, so there the power is part of what the product *is*.
   */
  const modelOnly = custom && type === "Lens";

  const visible = (f: Spec) => {
    if (modelOnly && f.key === "eye_side") return false;
    return f.when === undefined || f.when.is.includes(values[f.when.key] ?? "");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    // Enter inside a field submits the form; on any stop but the last that
    // means "next", not "save half a product".
    if (!last) {
      forward();
      return;
    }

    setProblem(null);

    if (categoryId === null) {
      setProblem("ยังโหลดหมวดหมู่ไม่เสร็จ — รอสักครู่แล้วกดใหม่");
      return;
    }
    setBusy(true);

    // Start from what is stored so unknown keys survive, then clear the ones
    // this form owns before writing the current values back.
    const attributes: Record<string, unknown> = { ...carried };
    for (const k of OWNED_KEYS) delete attributes[k];
    delete attributes.eye_side;

    if (brand.trim()) attributes.brand = brand.trim();

    const write = (f: Spec) => {
      const raw = (values[f.key] ?? "").trim();
      if (f.input === "bool") {
        attributes[f.key] = raw === "1";
        return;
      }
      // An empty value means "this product has none of that" rather than
      // "unknown", so the key is dropped instead of stored as an empty string.
      if (raw === "") return;
      if (f.numeric) {
        if (Number.isFinite(Number(raw))) attributes[f.key] = Number(raw);
        return;
      }
      attributes[f.key] = raw;
    };

    if (spec) {
      for (const f of spec.fields) {
        if (visible(f)) write(f);
      }
    }
    // Only the lenses that are stocked by power. A made-to-order lens is a
    // model — its prescription belongs to the job it is cut for, and the form
    // does not even ask for one. Writing them anyway filed every RX model with
    // the plano the boxes were seeded with, and named it "… 0.00/0.00".
    if (type === "Lens" && !modelOnly) {
      for (const f of RX_FIELDS) write(f);
    }

    const body = {
      sku: sku.trim(),
      name: name.trim(),
      brand: brand.trim() || null,
      product_type: type,
      category_id: categoryId,
      base_selling_price: price.trim(),
      // Made-to-order goods hold no stock, so a level for them could never be
      // met or missed. Sent as 0 rather than left out, or flipping a stocked
      // product to สั่งตัด RX would keep an alert nothing can ever clear.
      min_stock: custom ? "0" : minStock.trim(),
      is_custom_made: custom,
      attributes,
    };

    let id = savedId;

    try {
      if (id === null) {
        const path = product ? `/products/${product.id}/update` : "/products";
        const { product: saved } = await api.post<{ product: { id: number } }>(path, body);
        id = saved.id;
      }
    } catch (err) {
      setProblem(ApiError.is(err) ? err.message : "บันทึกไม่สำเร็จ");
      setBusy(false);
      return;
    }

    if (!wantLot) {
      setBusy(false);
      onSaved(id);
      return;
    }

    let created: CreatedLot;
    try {
      ({ lot: created } = await api.post<{ lot: CreatedLot }>("/lots", {
        sku: sku.trim(),
        quantity: Number(qty),
        supplier_id: supplierId === "" ? null : Number(supplierId),
        cost_per_unit: mayCost && cost.trim() ? cost.trim() : null,
        received_date: received,
        expiry_date: expiry || null,
        note: note.trim() || null,
      }));
    } catch (err) {
      // The product is real now even though the lot is not. Saying so — and
      // remembering the id — turns this into "fix the lot and press again"
      // rather than a second product with the same SKU.
      setSavedId(id);
      setBusy(false);
      setProblem(
        `เพิ่มสินค้าแล้ว แต่รับล็อตเข้าไม่สำเร็จ: ${
          ApiError.is(err) ? err.message : "รับของไม่สำเร็จ"
        } — แก้ข้อมูลล็อตแล้วกดอีกครั้ง สินค้าจะไม่ถูกสร้างซ้ำ`,
      );
      return;
    }

    // Outside the catch on purpose. Both writes have committed by now, and the
    // caller closes a dialog and raises a toast from here — none of which is a
    // reason to tell someone their save failed.
    setBusy(false);
    onSaved(id, created);
  }

  /**
   * Fill the form from a product that already exists.
   *
   * The fastest way to add a lens is almost always to start from the nearest
   * one the shop already stocks — a rung up the power ladder, the same coating,
   * the same index — so this is offered wherever a product is added, including
   * on the screens that already know what type is being added and skip the
   * chooser it used to live on.
   */
  function startFrom(d: ProductDetail): void {
    setCopiedFrom(d);
    if (presetType === undefined) setType(d.productType);
    // A copy is a different product — same model, different power — so its name
    // has to be composed again rather than inherited. Taking the original's
    // name is how two rows come to read alike.
    setAutoName(true);
    setBrand(d.brand ?? "");
    setPrice(d.basePrice > 0 ? String(d.basePrice) : "");
    setMinStock(d.minStock > 0 ? String(d.minStock) : "");
    if (make === undefined) setCustom(d.isCustomMade);
    setCarried(d.attributes);
    setValues(specValues(d.attributes, true));
  }

  /* --------------------------------------------------------- type chooser */

  if (type === "") {
    return (
      <div className="typepick">
        <CopyFrom onCopy={startFrom} />

        <p className="field__help">
          หรือเริ่มจากศูนย์ — เลือกก่อนว่ากำลังเพิ่มอะไร ช่องที่ต้องกรอกจะเปลี่ยนตามชนิดสินค้า
        </p>
        <div className="typepick__grid">
          {PRODUCT_TYPES.map((t) => (
            <button key={t} type="button" className="typecard" onClick={() => setType(t)}>
              <span className="typecard__name">{PRODUCT_TYPE_LABEL[t]}</span>
              {TYPE_ASKS[t] ? <span className="typecard__asks">{TYPE_ASKS[t]}</span> : null}
            </button>
          ))}
        </div>
        <div className="chips">
          <button type="button" className="btn btn--quiet" onClick={onCancel}>
            ยกเลิก
          </button>
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------------------- form */

  const field = (f: Spec) => {
    const id = `pf-${f.key}`;
    const value = values[f.key] ?? "";

    return (
      <div className={f.wide ? "field field--wide" : "field"} key={f.key}>
        <label className="field__label" htmlFor={id}>{f.label}</label>

        {f.input === "select" ? (
          <Select
            id={id}
            value={value}
            onChange={(v) => set(f.key, v)}
            disabled={busy}
            options={[
              { value: "", label: "— ไม่ระบุ —" },
              ...(f.options ?? []).map((o) => ({
                value: o,
                label: f.key === "eye_side" ? EYE_LABEL[o] : o,
              })),
            ]}
          />
        ) : f.input === "bool" ? (
          <Select
            id={id}
            value={value === "1" ? "1" : "0"}
            onChange={(v) => set(f.key, v)}
            disabled={busy}
            options={[
              { value: "0", label: "ไม่มี" },
              { value: "1", label: "มี" },
            ]}
          />
        ) : (
          /* A combobox rather than a bare text box, everywhere.
             Closed it reads like the input it replaced; focused it offers what
             this shop has called this thing before, and typing past the list is
             still just typing. That is what stops one coating becoming three
             spellings — and, now that the product's name is composed from these
             boxes, three spellings would be three products. */
          <Select
            free
            id={id}
            value={value}
            onChange={(v) => set(f.key, v)}
            disabled={busy}
            placeholder={f.placeholder}
            options={choicesFor(f)}
          />
        )}

        {f.help ? <span className="field__help">{f.help}</span> : null}
      </div>
    );
  };

  const locked = busy || savedId !== null;

  return (
    <form className="pform" onSubmit={submit} noValidate>
      {/* The screens that already know what is being added skip the chooser the
          copy box used to sit on — and skipped the copy box with it, which is
          the one control that turns adding the ninth power of a lens from
          filling a form into changing one number. */}
      {presetType !== undefined && product === undefined ? (
        <CopyFrom onCopy={startFrom} />
      ) : null}

      <ol className="wizard__steps" aria-label="ขั้นตอนการเพิ่มสินค้า">
        {steps.map((s, i) => (
          <li key={s} className="wizard__step" aria-current={i === at ? "step" : undefined}>
            <span
              className={
                i < at
                  ? "wizard__dot wizard__dot--done"
                  : i === at
                    ? "wizard__dot wizard__dot--now"
                    : "wizard__dot"
              }
              aria-hidden="true"
            >
              {i < at ? "✓" : i + 1}
            </span>
            <span className="wizard__name">{s}</span>
          </li>
        ))}
      </ol>

      {steps[at] === "ข้อมูลหลัก" ? (
      <fieldset className="pform__set">
        <legend className="pform__legend">
          ข้อมูลหลัก{PRODUCT_TYPE_LABEL[type] ? ` · ${PRODUCT_TYPE_LABEL[type]}` : ""}
        </legend>
        <div className="pform__grid">
          <div className="field">
            <label className="field__label" htmlFor="pf-sku">SKU</label>
            <input
              id="pf-sku"
              className="input"
              value={sku}
              onChange={(e) => {
                setAutoSku(false);
                clearing(setSku)(e.target.value);
              }}
              disabled={locked}
              autoComplete="off"
              placeholder={autoSku && issued.status === "loading" ? "กำลังออกรหัส…" : undefined}
            />
            {autoSku ? (
              <span className="field__help">ระบบออกรหัสให้เอง — พิมพ์ทับได้ถ้าจะใช้รหัสของผู้ขาย</span>
            ) : null}
          </div>
          {copiedFrom !== null && name.trim() === copiedFrom.name ? (
            <div className="notice field--wide" role="status">
              <p>
                คัดลอกมาจาก <strong>{copiedFrom.sku}</strong> และยังใช้ชื่อเดิมอยู่ — ตัวใหม่นี้จะได้รหัส{" "}
                <strong>{sku || "ใหม่"}</strong> เพราะรหัสซ้ำกันไม่ได้ กลายเป็นสินค้าคนละตัวที่ชื่อเหมือนกัน
              </p>
              <div className="chips">
                {onUseExisting ? (
                  <button
                    type="button"
                    className="btn btn--primary btn--small"
                    onClick={() => onUseExisting(copiedFrom.id)}
                    disabled={locked}
                  >
                    ใช้ {copiedFrom.sku} ตัวเดิม — รับเข้าล็อตใหม่
                  </button>
                ) : null}
                <span className="chips__note">
                  ถ้าตั้งใจเพิ่มตัวใหม่จริง แก้ชื่อให้ต่างจากเดิมแล้วข้อความนี้จะหายไป
                </span>
              </div>
            </div>
          ) : null}

          <div className="field field--wide">
            <label className="field__label" htmlFor="pf-name">ชื่อสินค้า</label>
            {/* Composed from the spec, and overridable by typing — the same
                bargain the SKU box above makes. It is a plain input rather than
                the picker it used to be: offering back other products' names is
                exactly the mistake this change was made to end, now that a name
                two products share means two products that are the same. */}
            <input
              id="pf-name"
              className="input"
              value={name}
              onChange={(e) => {
                setAutoName(false);
                clearing(setName)(e.target.value);
              }}
              disabled={locked}
              autoComplete="off"
              placeholder={autoName ? "ตั้งให้เองจากสเปกด้านล่าง" : undefined}
            />
            {autoName ? (
              <span className="field__help">
                ตั้งให้เองจาก แบรนด์ · รุ่น · สเปก — พิมพ์ทับได้ถ้าจะใช้ชื่ออื่น
              </span>
            ) : (
              <button
                type="button"
                className="btn btn--quiet btn--small"
                onClick={() => setAutoName(true)}
                disabled={locked}
              >
                กลับไปใช้ชื่อที่ตั้งให้เอง
              </button>
            )}
          </div>
          <div className="field">
            <label className="field__label" htmlFor="pf-brand">แบรนด์</label>
            <Select
              free
              id="pf-brand"
              value={brand}
              onChange={setBrand}
              disabled={locked}
              placeholder="พิมพ์แบรนด์ หรือเลือกจากที่เคยมี"
              // The shop's own three first, then every brand the catalogue has
              // been given since — seeds are a starting point, not a fence.
              options={choicesFor({
                key: "brand",
                label: "",
                seed: [...BRAND_SEED, ...(hints.data?.brands ?? [])],
              })}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="pf-price">ราคาขาย (฿)</label>
            <input
              id="pf-price"
              className="input"
              inputMode="decimal"
              value={price}
              onChange={(e) => clearing(setPrice)(e.target.value)}
              disabled={locked}
              placeholder="ยังไม่ตั้งราคา"
            />
            <span className="field__help">
              เว้นว่างได้ — ของเข้าก่อนราคาเป็นเรื่องปกติ มาตั้งทีหลังได้
            </span>
          </div>
          {/* Nothing to keep on the shelf for a lens cut per customer. */}
          {custom ? null : (
            <div className="field">
              <label className="field__label" htmlFor="pf-min">จำนวนขั้นต่ำ</label>
              <input
                id="pf-min"
                className="input"
                inputMode="numeric"
                value={minStock}
                onChange={(e) => clearing(setMinStock)(e.target.value)}
                disabled={locked}
                placeholder="ไม่เตือน"
              />
              <p className="field__help">
                เหลือน้อยกว่านี้เมื่อไร หน้าสินค้าจะขึ้นเตือนให้สั่งล็อตใหม่ — เว้นว่างไว้คือไม่เตือน
              </p>
            </div>
          )}
          {make === undefined ? (
            <div className="field field--wide">
              <label className="field__label" htmlFor="pf-custom">การผลิต</label>
              <Select
                id="pf-custom"
                value={custom ? "1" : "0"}
                onChange={(v) => setCustom(v === "1")}
                disabled={locked}
                options={[
                  { value: "0", label: "สำเร็จรูป — เก็บเป็นสต็อก" },
                  { value: "1", label: "สั่งตัด RX — ไม่มีสต็อก" },
                ]}
              />
            </div>
          ) : (
            <p className="field__help field--wide">
              {make === "custom"
                ? "สั่งตัด RX — ไม่เก็บเป็นสต็อก ตามหน้าที่กำลังเพิ่มอยู่"
                : "สำเร็จรูป — เก็บเป็นสต็อก ตามหน้าที่กำลังเพิ่มอยู่"}
            </p>
          )}
        </div>
      </fieldset>
      ) : null}

      {steps[at] === "รายละเอียดสินค้า" && spec ? (
        <fieldset className="pform__set">
          <legend className="pform__legend">{spec.title}</legend>
          <div className="pform__grid">{spec.fields.filter(visible).map(field)}</div>
        </fieldset>
      ) : null}

      {steps[at] === "รายละเอียดสินค้า" && type === "Lens" && modelOnly ? (
        <p className="field__help">
          ค่าสายตาและข้างตาไม่ต้องกรอกที่นี่ — เลนส์สั่งตัดใช้รุ่นเดียวกันได้กับลูกค้าหลายคน
          ค่าของแต่ละคนกรอกตอนเปิดใบสั่ง RX
        </p>
      ) : null}

      {steps[at] === "รายละเอียดสินค้า" && type === "Lens" && !modelOnly ? (
        <fieldset className="pform__set">
          <legend className="pform__legend">ค่าสายตา</legend>
          <p className="field__help">
            กรอกได้ทั้งเลนส์สั่งตัดและเลนส์สำเร็จรูป — เลนส์สต็อกก็เก็บแยกตามค่าสายตาอยู่แล้ว
            ค่าพวกนี้จึงเป็นส่วนหนึ่งของตัวสินค้า ไม่ใช่ของใบสั่งลูกค้า
          </p>
          <div className="pform__grid pform__grid--rx">{RX_FIELDS.map(field)}</div>
        </fieldset>
      ) : null}

      {steps[at] === "ล็อตแรกที่รับเข้า" ? (
        <fieldset className="pform__set">
          <legend className="pform__legend">ล็อตแรกที่รับเข้า</legend>
          <p className="field__help">
            ของที่ถืออยู่ตรงหน้าเข้าคลังพร้อมกับสินค้าใหม่นี้เลย — ไม่ต้องบันทึกแล้วไปหาฟอร์มรับของอีกรอบ
          </p>
          <div className="pform__grid">
            <QtyField
              id="pf-qty"
              value={qty}
              onChange={setQty}
              disabled={busy}
              label="จำนวนที่รับเข้า"
              help="กดบวกลบได้ หรือพิมพ์เองถ้ารับมาเยอะ"
            />
            <div className="field">
              <label className="field__label" htmlFor="pf-sup">ผู้ขาย</label>
              <Select
                id="pf-sup"
                value={supplierId}
                onChange={setSupplierId}
                disabled={busy || suppliers.status !== "ready"}
                placeholder="ไม่ระบุ"
                options={[
                  { value: "", label: "ไม่ระบุ" },
                  ...(suppliers.status === "ready"
                    ? suppliers.data.suppliers.map((s) => ({ value: String(s.id), label: s.name }))
                    : []),
                ]}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="pf-cost">ต้นทุนต่อชิ้น (฿)</label>
              <input
                id="pf-cost"
                className="input"
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder={mayCost ? "เว้นว่างถ้าใบกำกับยังไม่มา" : "ฝ่ายบัญชีเป็นคนลง"}
                disabled={busy || !mayCost}
              />
              <span className="field__help">
                เว้นว่างได้ — ระบบจะนับล็อตนั้นเป็น &ldquo;รอต้นทุน&rdquo; แทนที่จะคิดเป็นศูนย์
              </span>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="pf-recv">วันที่รับเข้า</label>
              <DateField id="pf-recv" value={received} onChange={setReceived} disabled={busy} clearable={false} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="pf-exp">วันหมดอายุ</label>
              <DateField id="pf-exp" value={expiry} onChange={setExpiry} disabled={busy} placeholder="ไม่มีวันหมดอายุ" />
            </div>
            <div className="field field--wide">
              <label className="field__label" htmlFor="pf-note">หมายเหตุ</label>
              <input id="pf-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น เลขที่ใบส่งของ" disabled={busy} autoComplete="off" />
            </div>
          </div>
        </fieldset>
      ) : null}

      {problem ? <div className="notice notice--error" role="alert">{problem}</div> : null}

      {/* Both pairs below are keyed, and the keys are the whole point.
          Without them React reconciles the two branches into one DOM button and
          only swaps its `type` and handler — while the browser's click
          activation on that very node is still in flight. Pressing "ถัดไป" on
          the second-to-last stop turned the button into the submit button
          underneath the press, and the form saved instead of advancing: the
          product was written, the dialog dropped out of editing, and the last
          stop was never reachable. Distinct keys force a new node, and a node
          that did not exist when the mouse went down cannot be activated. */}
      <div className="wizard__nav">
        {at > 0 ? (
          <button
            key="back"
            type="button"
            className="btn btn--quiet"
            onClick={() => {
              setProblem(null);
              setStep(at - 1);
            }}
            disabled={busy}
          >
            ← ย้อนกลับ
          </button>
        ) : (
          <button
            key="cancel"
            type="button"
            className="btn btn--quiet"
            onClick={onCancel}
            disabled={busy}
          >
            {savedId !== null ? "ปิด" : "ยกเลิก"}
          </button>
        )}

        {last ? (
          <button key="save" type="submit" className="btn btn--primary" disabled={busy}>
            {busy
              ? "กำลังบันทึก…"
              : savedId !== null
                ? "รับล็อตเข้าอีกครั้ง"
                : product
                  ? "บันทึกการแก้ไข"
                  : wantLot
                    ? "เพิ่มสินค้าและรับเข้าคลัง"
                    : "เพิ่มสินค้า"}
          </button>
        ) : (
          <button
            key="next"
            type="button"
            className="btn btn--primary"
            onClick={forward}
            disabled={busy}
          >
            ถัดไป →
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Start a new product from one the shop already has.
 *
 * A lens in a power never stocked before is a *new product* that differs from an
 * existing one by two numbers — the rest of it (the SKU's shape, the brand, the
 * coating, the index, the price) is identical. Retyping all of that is where the
 * near-duplicates come from: the same lens under two spellings, one of them
 * missing its coating.
 *
 * The SKU is copied along with everything else even though it must be unique.
 * That is deliberate: the shop's SKUs encode the spec, so the old one is the
 * pattern for the new one. Forgetting to change it comes back from the API as
 * "มีสินค้ารหัส … อยู่แล้ว", which is a clearer place to be reminded than an
 * empty box.
 */
function CopyFrom({ onCopy }: { onCopy: (d: ProductDetail) => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * The catalogue, held here so the picker can filter as you type.
   *
   * It used to be a search box with a button: type, press ค้นหา, wait, read six
   * results, press one. Three of those steps existed only because the filtering
   * happened on the server. A shop's catalogue is small enough to hold, so it is
   * held, and the field filters it live like every other picker on these screens.
   */
  const list = useApi<Page<ProductRow>>(`/products${qs({ per: 500 })}`);
  const rows = list.status === "ready" ? list.data.rows : [];
  const more = list.status === "ready" ? list.data.total - rows.length : 0;

  async function copy(row: ProductRow) {
    setBusy(true);
    setProblem(null);
    try {
      // The list rows carry no `attributes`, and the attributes are the whole
      // point of copying — the coating and the index live only there.
      const { product } = await api.get<{ product: ProductDetail }>(`/products/${row.id}`);
      onCopy(product);
    } catch (err) {
      setProblem(ApiError.is(err) ? err.message : "ดึงข้อมูลสินค้าไม่ได้");
      setBusy(false);
    }
  }

  return (
    <div className="copyfrom">
      <p className="field__label">เริ่มจากสินค้าที่มีอยู่แล้ว</p>
      <p className="field__help">
        เลนส์รุ่นเดิมคนละค่าสายตาคือสินค้าคนละตัว — เลือกตัวที่ใกล้ที่สุด แล้ว SKU แบรนด์ Coating
        Index ราคาขาย และสเปกที่เหลือจะถูกเติมมาให้ เหลือแก้แค่ส่วนที่ต่างจริง
      </p>

      <label className="sr-only" htmlFor="pf-copy">สินค้าที่จะคัดลอก</label>
      <Select
        id="pf-copy"
        value=""
        onChange={(id) => {
          const row = rows.find((r) => String(r.id) === id);
          if (row) copy(row);
        }}
        disabled={busy || list.status !== "ready"}
        placeholder={
          list.status === "ready" ? "พิมพ์ชื่อสินค้า · SKU · แบรนด์" : "กำลังโหลดแคตตาล็อก…"
        }
        // The name, and nothing else. Every other fact about the product is
        // about to be copied onto the form anyway, so printing it here too is
        // the same line read twice — once to choose it, once to check it. The
        // code and the brand stay searchable without being shown.
        options={rows.map((r) => ({
          value: String(r.id),
          label: r.name,
          keywords: `${r.sku} ${r.brand ?? ""}`,
        }))}
      />

      {more > 0 ? (
        <p className="field__help">
          แคตตาล็อกมี {count(list.status === "ready" ? list.data.total : 0)} รายการ — ช่องนี้ถือไว้{" "}
          {count(rows.length)} รายการแรก ที่เหลือหาจากหน้าสินค้าทั้งหมด
        </p>
      ) : null}

      {problem ? <div className="notice notice--error" role="alert">{problem}</div> : null}

      {list.status === "error" ? (
        <div className="notice notice--error" role="alert">{list.error}</div>
      ) : null}

    </div>
  );
}
