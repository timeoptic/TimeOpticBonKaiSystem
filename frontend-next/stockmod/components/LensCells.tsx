"use client";

import type { ProductRow } from "@/stockmod/lib/api";
import { lensRx, lensRxMore, lensSpec } from "@/stockmod/lib/format";

/**
 * The two lens columns, drawn the same way wherever a list of stock appears.
 *
 * A shop stocks one lens model in a dozen powers and three indexes, so a table
 * that shows only the name puts a wall of near-identical rows in front of
 * someone who has to pick exactly one. These two cells are what tells them
 * apart: what the lens *is*, and what it *corrects*.
 *
 * Everything recorded about the lens is here, none of it abbreviated away. The
 * first line of each cell carries what the choice is made on — index and
 * design, SPH and CYL — and the second line carries what qualifies it, the
 * coating and the AXIS and ADD. Four figures run together on one line get read
 * as far as the first two; on two lines they get read.
 *
 * Rendered as a fragment of two `<td>`s so the caller keeps control of where
 * they sit in the row, and so the header count cannot drift from the cell count
 * — both are behind the same condition at the call site.
 */
export default function LensCells({ row }: { row: ProductRow }) {
  const spec = lensSpec(row);
  const rx = lensRx(row);
  const more = lensRxMore(row);

  return (
    <>
      <td>
        {spec === null && row.coating === null ? (
          <span className="grid__muted">—</span>
        ) : (
          <>
            {/* A coating with no index or design still says something, so the
                cell is drawn for either half rather than only for both. */}
            <span className="grid__name">{spec ?? "—"}</span>
            {row.coating ? <span className="grid__sub">{row.coating}</span> : null}
          </>
        )}
      </td>
      <td className="grid__rx">
        {rx === null && more === null ? (
          <span className="grid__muted">—</span>
        ) : (
          <>
            <span className="grid__name">{rx ?? "—"}</span>
            {more ? <span className="grid__sub">{more}</span> : null}
          </>
        )}
      </td>
    </>
  );
}
