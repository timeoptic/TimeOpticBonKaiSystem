"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ProductRow } from "@/stockmod/lib/api";
import { count, money } from "@/stockmod/lib/format";
import { stockHref } from "@/stockmod/lib/paths";

type Item =
  | { kind: "page"; label: string; hint: string; href: string }
  | { kind: "product"; label: string; hint: string; product: ProductRow };

/** Pages every signed-in role can open. Money pages are added per role below. */
const PAGES: Extract<Item, { kind: "page" }>[] = [
  { kind: "page", label: "เบิก / ตัดสต็อก", hint: "ตัดของออกจากคลัง", href: "/" },
  { kind: "page", label: "ใบสั่งตัด RX", hint: "สั่งเลนส์เฉพาะราย", href: "/rx" },
  { kind: "page", label: "แดชบอร์ด", hint: "สรุปรายวัน รายเดือน เลือกช่วงเองได้", href: "/dashboard" },
  { kind: "page", label: "สินค้าและภาพรวม", hint: "ดัชนีสินค้า สต็อก ต้นทุน", href: "/products" },
  { kind: "page", label: "ความเคลื่อนไหว", hint: "นำเข้า ขาย เบิก ปรับ คืน", href: "/movements" },
  { kind: "page", label: "ล็อตที่ยังไม่มีต้นทุน", hint: "รอใบกำกับจากผู้ขาย", href: "/lots?state=nocost" },
  { kind: "page", label: "ล็อตใกล้หมดอายุ", hint: "ภายใน 120 วัน", href: "/lots?state=expiring" },
  { kind: "page", label: "ของเสีย", hint: "รายการที่ตัดเสีย", href: "/movements?type=SCRAP" },
  { kind: "page", label: "สาขายังค้างเงิน", hint: "รายการที่รอเงินกลับ", href: "/movements?who=owed" },
];

/**
 * Ctrl/⌘ K — jump to a screen, or straight to a product.
 *
 * The search runs against the API rather than filtering a list already on
 * screen, so it finds the twenty-ninth product from the movements page just as
 * well as from the index.
 */
export default function CommandPalette({ onOpenProduct }: { onOpenProduct?: (id: number) => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductRow[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setHits([]);
      setActive(0);
      // The dialog mounts before focus can land on it, so wait a frame.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }

    // Typing is faster than the network; without this every keystroke would
    // start a request and the answers could arrive out of order.
    let alive = true;
    const timer = setTimeout(() => {
      api
        .get<{ rows: ProductRow[] }>(`/products?q=${encodeURIComponent(term)}`)
        .then(({ rows }) => alive && setHits(rows.slice(0, 8)))
        .catch(() => alive && setHits([]));
    }, 180);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);

  if (!open) return null;

  const term = q.trim().toLowerCase();
  const pages = PAGES.filter(
    (p) => term === "" || p.label.toLowerCase().includes(term) || p.hint.toLowerCase().includes(term),
  );
  const items: Item[] = [
    ...pages,
    ...hits.map<Item>((p) => ({
      kind: "product",
      label: p.name,
      hint: `${p.sku}${p.brand ? ` · ${p.brand}` : ""}`,
      product: p,
    })),
  ];

  const clamped = Math.min(active, Math.max(items.length - 1, 0));

  function choose(item: Item) {
    setOpen(false);
    if (item.kind === "page") {
      router.push(stockHref(item.href));
      return;
    }
    if (onOpenProduct) {
      onOpenProduct(item.product.id);
    } else {
      // From another screen there is no drawer to open, so land on the index
      // filtered to that one product instead of doing nothing.
      router.push(stockHref(`/products?q=${encodeURIComponent(item.product.sku)}`));
    }
  }

  return (
    <div
      className="palette"
      role="dialog"
      aria-modal="true"
      aria-label="ค้นหาและไปยังหน้าต่าง ๆ"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="palette__card">
        <input
          ref={inputRef}
          className="palette__input"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && items[clamped]) {
              e.preventDefault();
              choose(items[clamped]);
            }
          }}
          placeholder="พิมพ์ชื่อสินค้า SKU หรือชื่อหน้า…"
          aria-label="ค้นหา"
          autoComplete="off"
        />

        {items.length === 0 ? (
          <p className="palette__empty">
            {q.trim().length < 2 ? "พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหาสินค้า" : "ไม่พบอะไรที่ตรงกับคำนี้"}
          </p>
        ) : (
          <ul className="palette__list">
            {items.map((item, i) => (
              <li key={item.kind === "page" ? item.href : `p${item.product.id}`}>
                <button
                  type="button"
                  className="palette__item"
                  aria-current={i === clamped ? "true" : undefined}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(item)}
                >
                  <span className="palette__label">{item.label}</span>
                  <span className="palette__hint">{item.hint}</span>
                  {item.kind === "product" ? (
                    <span className="palette__meta">
                      {item.product.isCustomMade
                        ? "สั่งตัด"
                        : `คงเหลือ ${count(item.product.onHand)} · ${money(item.product.basePrice)}`}
                    </span>
                  ) : (
                    <span className="palette__meta">หน้า</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="palette__foot">
          <kbd>↑</kbd> <kbd>↓</kbd> เลื่อน · <kbd>Enter</kbd> เลือก · <kbd>Esc</kbd> ปิด
        </p>
      </div>
    </div>
  );
}
