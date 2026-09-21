/**
 * The one way this app talks to the API.
 *
 * Two things every call needs and none of the call sites should have to
 * remember: the session cookie has to ride along cross-origin, and a failure
 * has to arrive as something with a `reason` on it rather than as an unhelpful
 * "fetch failed".
 */

/**
 * Where the API lives.
 *
 * Both halves of the merged project are served by one PHP app on port 8095:
 * this half answers under the /stock-api prefix, the storefront under /api.
 * The origin comes from NEXT_PUBLIC_API_ORIGIN, the same variable the
 * storefront half reads, so there is one origin to set rather than one each.
 *
 * Set but EMPTY means the API answers on the same origin as the page, so the
 * calls go out as relative paths. That is the shape a reverse proxy in front of
 * both halves needs - gateway.mjs behind a tunnel, or Apache in production -
 * where port 8095 is not reachable from outside at all. It matches what the
 * storefront half already does in lib/apiClient.js, which reads the same
 * variable and falls back to `''`. An empty value therefore cannot be treated
 * as "nothing configured": `if (origin)` sent every one of these calls to a
 * port the visitor's browser could not open, and every stock screen failed
 * while the pages themselves loaded fine.
 *
 * With nothing configured AT ALL, it is assumed to be on the same machine that
 * served this page, on port 8095. That is what makes the shop LAN work without
 * anyone editing a config file: the till opens http://192.168.1.108:3010 and
 * its API calls go to http://192.168.1.108:8095 by themselves. Hard-coding
 * localhost would send every other device looking for an API on its own machine.
 *
 * Computed per call rather than once at import, because this module is also
 * evaluated during server rendering where there is no window to ask.
 */
function apiBase(): string {
  const origin = process.env.NEXT_PUBLIC_API_ORIGIN;
  if (origin !== undefined) return `${origin}/stock-api`;
  if (typeof window === "undefined") return "http://localhost:8095/stock-api";
  return `${window.location.protocol}//${window.location.hostname}:8095/stock-api`;
}

/** The shape every refusal from the API takes. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  /**
   * `e instanceof ApiError`, asked in a way that survives a hot reload.
   *
   * Fast Refresh can leave two copies of this module in one page, and an error
   * thrown by the older copy fails `instanceof` against the newer class. The
   * screens use that check to decide between showing the API's own message and
   * showing "บันทึกไม่สำเร็จ" — so when it drifts, a plain "session expired"
   * arrives looking like an unexplained failure. Falling back to the shape
   * cannot drift the same way. Every screen calls this instead of `instanceof`.
   */
  static is(e: unknown): e is ApiError {
    if (e instanceof ApiError) return true;
    return (
      e instanceof Error &&
      e.name === "ApiError" &&
      typeof (e as ApiError).reason === "string"
    );
  }

  /** True when the caller is simply not signed in, rather than not allowed. */
  get isAuth() {
    return this.status === 401;
  }
}

async function call<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response;

  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      // Without this the PHP session cookie is dropped on every cross-origin
      // request and the API answers 401 to a user who is signed in.
      credentials: "include",
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    // fetch only rejects when the request never got an answer — the API is
    // down, or the machine is off the shop network. Say that, rather than
    // letting a blank screen imply the data is empty.
    throw new ApiError(0, "unreachable", "ติดต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจว่า API ทำงานอยู่หรือเปล่า");
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, "bad_response", "เซิร์ฟเวอร์ตอบกลับมาในรูปแบบที่อ่านไม่ออก");
    }
  }

  if (!res.ok) {
    const b = (body ?? {}) as Record<string, unknown>;
    throw new ApiError(
      res.status,
      typeof b.reason === "string" ? b.reason : "error",
      typeof b.message === "string" ? b.message : `คำขอล้มเหลว (${res.status})`,
      b,
    );
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => call<T>(apiBase(), path),
  post: <T>(path: string, body?: unknown) =>
    call<T>(apiBase(), path, { method: "POST", body: JSON.stringify(body ?? {}) }),
};

/* ------------------------------------------------------------------ types */

/**
 * One page of a list.
 *
 * `total` is the whole filtered set, not the length of `rows` — the paginator
 * needs to know how many pages exist, which the rows on screen cannot say.
 */
export type Page<T> = {
  rows: T[];
  total: number;
  page: number;
  perPage: number;
};

export type Actor = {
  id: number;
  username: string | null;
  displayName: string;
  jobTitle: string | null;
  /** บทบาทที่ถืออยู่ · หนึ่งคนถือได้หลายใบ สิทธิ์จริงคือยูเนียน */
  roles: RoleKey[];
  roleNames: string[];
  /** "Owner + Admin" — ประกอบมาแล้วจากฝั่ง API ให้หน้าจอเอาไปแสดงตรง ๆ */
  roleText: string;
  /**
   * สิทธิ์ที่ได้จริงหลังรวมทุกบทบาท เช่น `cost.view`
   *
   * คำนวณที่ `Roles::permsOf` ฝั่งเดียว หน้าจอจึงไม่ต้องถือสำเนาของกฎไว้อีกชุด
   * แล้วลืมแก้ตอนเพิ่มบทบาท — ดู `lib/roles.js`
   */
  perms: string[];
  /** หน้าแรกของคนนี้ ตอบมาจาก `Roles::home` ฝั่ง API ที่เดียว */
  home: string;
  employeeId: number | null;
  /** รหัสถูกตั้งโดยคนอื่น — ต้องตั้งใหม่ก่อนใช้งานต่อ */
  mustChangePassword: boolean;
};

export type RoleKey = "superuser" | "owner" | "admin" | "sales" | "trainee" | "stock";

/**
 * The five product types, in the order every screen lists them.
 *
 * The API stores them in English and validates against the same five names, so
 * this list is where a Thai label for one lives — a screen that needs to name a
 * type reads it here instead of keeping a copy that drifts.
 */
export const PRODUCT_TYPES = ["Lens", "Frame", "Sunglass", "ContactLen", "Accessory"] as const;

export const PRODUCT_TYPE_LABEL: Record<string, string> = {
  Lens: "เลนส์",
  Frame: "กรอบแว่น",
  Sunglass: "แว่นกันแดด",
  ContactLen: "คอนแทคเลนส์",
  Accessory: "อุปกรณ์เสริม",
};

export type ProductRow = {
  id: number;
  sku: string;
  name: string;
  brand: string | null;
  productType: string;
  categoryId: number;
  basePrice: number;
  /**
   * How few of this the shop is willing to be down to, or 0 for "never say".
   *
   * Zero is silence rather than a minimum that is always met: most of a
   * catalogue is things nobody wants to be told about, so the default has to be
   * quiet. Made-to-order products carry no stock and are never counted short.
   */
  minStock: number;
  isCustomMade: boolean;
  eyeSide: string | null;
  // Lens spec, read out of `attributes` by the API. Null for anything that is
  // not a lens, and for a lens whose spec was never filled in — which is not
  // the same as zero, so a missing power must not be drawn as 0.00.
  /** Which of the maker's products this is — `attributes.model`. */
  model: string | null;
  lensDesign: string | null;
  lensIndex: string | null;
  coating: string | null;
  sph: number | null;
  cyl: number | null;
  axis: number | null;
  /** Kept as written — "+2.00" reads as an ADD, "2" does not. */
  add: string | null;
  onHand: number;
  // Cost fields arrive as null for a role not allowed to see them. Screens
  // branch on the role first, so null never gets drawn as "awaiting invoice".
  stockValue: number | null;
  lotsMissingCost: number;
  nextCost: number | null;
  /**
   * เตือนต่ำกว่าขั้นต่ำเข้า Telegram ไปแล้วเมื่อไร — null คือยังไม่ได้เตือน หรือของกลับขึ้น
   * ถึงขั้นต่ำแล้ว · เวลาไทยเสมอ (แถวเก่าที่ลงเป็น UTC ถูกแปลงให้แล้วที่ API)
   */
  lowStockNotifiedAt: string | null;
};

export type LotRow = {
  id: number;
  lotNumber: string;
  productId: number;
  sku: string;
  productName: string;
  productType: string;
  supplierName: string | null;
  costPerUnit: number | null;
  initialQty: number;
  remainingQty: number;
  receivedDate: string;
  expiryDate: string | null;
  expiringSoon: boolean;
  value: number | null;
};

export type MovementRow = {
  id: number;
  actionType: string;
  actionLabel: string;
  quantity: number;
  /** ยอดคงเหลือของสินค้าหลังรายการนี้ — null คือรายการที่ไม่ขยับของบนชั้น (RX · แก้ราคา) */
  balanceAfter: number | null;
  unitCost: number | null;
  referenceDoc: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: number | null;
  /** Who keyed the entry. */
  actorName: string | null;
  /** Who took the stock — regularly not the same person as `actorName`. */
  issuedToId: number | null;
  issuedToName: string | null;
  /** ชื่อคนที่ทำของเสียที่พิมพ์ไว้ตอนตัด — เฉพาะแถว SCRAP · ไม่ใช่บัญชีผู้ใช้ */
  scrapBy: string | null;
  /** แถวจ่ายออกนี้ถูกยกเลิกและคืนของไปแล้ว */
  returned: boolean;
  /** เคสหน้าร้านที่ตัดของรายการนี้ — แก้ที่หน้าเคส ไม่ใช่ที่คลัง */
  caseId: number | null;
  /** Set only when another branch took it, which makes the row a receivable. */
  branchIssueId: number | null;
  branchName: string | null;
  takenBy: string | null;
  branchStatus: "pending" | "settled" | "written_off" | "cancelled" | null;
  branchStatusLabel: string | null;
  settledAmount: number | null;
  settledAt: string | null;
  /** Null until the branch has paid — profit belongs to the day money arrived. */
  branchProfit: number | null;
  productId: number | null;
  sku: string | null;
  productName: string | null;
  /** Catalogue price now, not what it sold for — see the note on the API side. */
  basePrice: number | null;
  /** ราคาขาย ณ ตอนที่เกิดรายการนี้ — ต่างจาก basePrice ที่เป็นราคาปัจจุบันของสินค้า */
  salePrice: number | null;
  lotNumber: string | null;
};

export type BranchRow = {
  id: number;
  name: string;
  contact: string | null;
  isActive: boolean;
  note: string | null;
  pendingCount: number;
  /** What the outstanding goods cost us — a floor on the debt, not the debt. Null when the viewer may not see costs. */
  pendingCost: number | null;
  pendingUnknown: number;
};

export type SettlementRow = {
  id: number;
  branchId: number;
  branchName: string | null;
  takenBy: string | null;
  productId: number;
  sku: string;
  productName: string | null;
  quantity: number;
  costTotal: number;
  costUnknownQty: number;
  issuedAt: string;
  issuedByName: string | null;
  status: "pending" | "settled" | "written_off" | "cancelled";
  statusLabel: string;
  settledAmount: number | null;
  settledAt: string | null;
  settledByName: string | null;
  settledNote: string | null;
  note: string | null;
  profit: number | null;
};

export type SettlementSummary = {
  pendingCount: number;
  pendingCost: number;
  pendingUnknown: number;
  monthCount: number;
  monthAmount: number;
  monthProfit: number;
};

/**
 * One RX order, as the order book reports it.
 *
 * The prescription rides on the order rather than on the product: the shop
 * stocks six made-to-order lens *models*, and every job cut from one of them
 * has its own power. See `011_rx_order_details.sql` for why that moved.
 */
export type RxOrderRow = {
  id: number;
  sku: string;
  name: string;
  referenceDoc: string | null;
  createdAt: string;
  actorName: string | null;
  note: string | null;
  unitCost: number | null;
  /**
   * ต้นทุนยังไม่ถูกลงหรือยัง — มาจาก API ตรง ๆ ไม่ใช่เดาจาก `unitCost === null`
   *
   * `unitCost` เป็น null ได้สองความหมาย: "ยังไม่ได้ลง" กับ "ลงแล้วแต่บทบาทนี้
   * ไม่มีสิทธิ์เห็น" · เดาจาก null เฉย ๆ ทำให้พนักงานคลังเห็นทุกแถวเป็น
   * "รอฝ่ายบัญชี" ทั้งที่บัญชีลงครบแล้ว
   */
  awaitingCost: boolean;
  salePrice: number | null;
  eyeSide: "left" | "right" | null;
  sph: number | null;
  cyl: number | null;
  axis: number | null;
  add: string | null;
  /** สาขาที่สั่งใบนี้ — null คือร้านนี้สั่งเอง ไม่ใช่ "ยังไม่ได้กรอก" */
  branchId: number | null;
  branch: string | null;
  /** เคสหน้าร้านที่เปิดใบนี้ — null คือใบที่เปิดจากหน้าคลังเอง */
  caseId: number | null;
  caseCode: string | null;
  /** พนักงานผู้ขายของเคส — คนละคนกับ `actorName` (บัญชีที่ล็อกอินตอนกดสั่ง) */
  salesName: string | null;
  /** เลนส์มาถึงร้านเมื่อไร — null คือยังไม่มา */
  arrivedAt: string | null;
  arrivedByName: string | null;
  /** เลขรับของที่มากับเลนส์ ใส่ตอนติ๊กว่ามาถึง (037) */
  arrivedRef: string | null;
};

/**
 * The permission table, generated by the API from the very checks it enforces
 * with — never written out a second time on this side, or it would drift.
 */
export type Policy = {
  roles: { key: "owner" | "accountant" | "staff"; label: string }[];
  groups: {
    title: string;
    rows: {
      label: string;
      note: string | null;
      /** True for the things every signed-in role can do. */
      always: boolean;
      allow: Record<string, boolean>;
    }[];
  }[];
};

/** A name that can be recorded as having taken stock. Not an account listing. */
export type Person = {
  id: number;
  displayName: string;
  jobTitle: string | null;
};

/** What POST /lots answers with — enough to say what just reached the shelf. */
export type CreatedLot = {
  lotNumber: string;
  quantity: number;
  awaitingCost: boolean;
  name: string;
};

export type ReceiveDefaults = {
  sku: string;
  name: string;
  brand: string | null;
  isCustomMade: boolean;
  lastLot: {
    id: number;
    lotNumber: string;
    supplierId: number | null;
    supplierName: string | null;
    costPerUnit: number | null;
    /** What was received into it. */
    quantity: number;
    remainingQty: number;
    expiryDate: string | null;
    receivedDate: string;
  } | null;
  suggestedLotNumber: string | null;
};

/** One filter chip: a value, and how many products carry it. */
export type LensFacet = { value: string; count: number };

/** The lens specs the pickers offer, each with its tally. */
export type LensOptions = {
  indexes: LensFacet[];
  designs: LensFacet[];
  /** Ordered by how much of each the shop stocks, not alphabetically. */
  coatings: LensFacet[];
  /** Powers stocked, low to high, as `-2.00` — the ends a range can take. */
  sphs: LensFacet[];
  cyls: LensFacet[];
  /** ค่า ADD ที่มีของ — ว่างเมื่อไม่มีเลนส์ที่มี ADD */
  adds?: LensFacet[];
};

export type Summary = {
  products: number;
  lots: number;
  onHand: number;
  stockValue: number | null;
  lotsMissingCost: number;
  rxAwaitingCost: number;
  /** Products under the minimum their owner set. Not dated — it is true now. */
  lowStock: number;
  eyeSide: { left: number; right: number; unset: number };
};

/**
 * What sells and what sits, counted on two different clocks.
 *
 * `best` belongs to the chosen date range — "sells well" is a claim about a
 * period. `slow` ignores it: something that has not moved since January is not
 * made fresh by looking at March.
 */
export type Movers = {
  from: string;
  to: string;
  idleDays: number;
  best: {
    id: number;
    sku: string;
    name: string;
    brand: string | null;
    productType: string;
    qty: number;
    rows: number;
    cost: number | null;
    onHand: number;
    minStock: number;
  }[];
  slow: {
    id: number;
    sku: string;
    name: string;
    brand: string | null;
    productType: string;
    onHand: number;
    stockValue: number | null;
    lotsMissingCost: number;
    oldestLot: string | null;
    /** Null means it has never been sold — not that it sold today. */
    lastOut: string | null;
    idleDays: number;
  }[];
};

/**
 * One product with its lots and its history.
 *
 * `lotsMissingCost` and `nextCost` are omitted rather than inherited: they are
 * summaries the *list* query computes for a page of rows, and this endpoint does
 * not send them. Inheriting them whole would have the type promise figures that
 * arrive as undefined — which is how a drawer came to render "SPH 0.00" for a
 * lens whose SPH was never recorded.
 */
export type ProductDetail = Omit<ProductRow, "lotsMissingCost" | "nextCost"> & {
  attributes: Record<string, unknown>;
  lots: Array<{
    id: number;
    lotNumber: string;
    supplierName: string | null;
    costPerUnit: number | null;
    initialQty: number;
    remainingQty: number;
    receivedDate: string;
    expiryDate: string | null;
    notes: string | null;
  }>;
  logs: MovementRow[];
};
