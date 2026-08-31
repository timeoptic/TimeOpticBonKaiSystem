"use client";

import type { ProductRow } from "@/stockmod/lib/api";
import { lensRx, lensSpec } from "@/stockmod/lib/format";

/**
 * Who the row is about, in one cell instead of three.
 *
 * The name is what a person looks for; the SKU and the brand are what they
 * check once they think they have found it. Stacking them keeps all three
 * readable while giving the table back two columns — and a shop stocks one lens
 * model in a dozen powers, so the columns that tell those apart are worth more
 * than a column of brand names repeated forty times.
 *
 * The side sits on the name line rather than in a column of its own: L and R
 * are part of which lens this is, and a whole column spent on a 22px badge is a
 * column not spent on the power.
 *
 * Renders the row header `<th>`, so every table using it keeps the product as
 * the thing each row is named by.
 */
export default function ProductCell({
  row,
  spec = false,
}: {
  row: ProductRow;
  /**
   * Carry the lens spec under the name.
   *
   * For lists that mix lenses with everything else, where two columns of it
   * would be two columns of dashes on every frame and every cloth. A lens still
   * has to be told from the next lens, so the facts come along — just folded
   * into the cell that is already about which product this is.
   */
  spec?: boolean;
}) {
  const side = row.eyeSide === "left" || row.eyeSide === "right" ? row.eyeSide : null;

  const lens = spec
    ? [
        lensSpec(row),
        lensRx(row),
        row.add ? `ADD ${row.add}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <th scope="row">
      <span className="grid__name">
        {row.name}
        {side ? (
          <span className="eye eye--inline">
            {side === "left" ? "L" : "R"}
            <span className="sr-only">{side === "left" ? "ตาซ้าย" : "ตาขวา"}</span>
          </span>
        ) : null}
      </span>
      <span className="grid__sub">
        {row.sku}
        {row.brand ? ` · ${row.brand}` : ""}
      </span>
      {lens ? <span className="grid__sub grid__rx">{lens}</span> : null}
    </th>
  );
}
