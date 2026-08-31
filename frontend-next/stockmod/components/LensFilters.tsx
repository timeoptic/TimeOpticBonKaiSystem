"use client";

import { qs, useApi } from "@/stockmod/lib/useApi";
import type { LensOptions } from "@/stockmod/lib/api";

/**
 * Narrowing a list of lenses down to the drawer worth walking to.
 *
 * Chips, not selects. There are four indexes and two or three designs in the
 * whole catalogue — few enough to show at once, and showing them is the point:
 * a dropdown hides the answer until it is opened, costs two taps instead of
 * one, and on the shop tablet drops a native picker over the table you were
 * reading. The rest of this app filters with chips for the same reasons.
 *
 * The values come from the API's `/lens-options` — the specs the catalogue
 * actually holds. Nothing here can be typed, and nothing offered comes back
 * empty: an index the shop has never stocked never appears, so choosing one is
 * not a mistake anyone can make.
 *
 * Shown only where there are lenses to narrow. On a list of frames these would
 * be controls that could never do anything, and a dead control is worse than a
 * missing one — it invites a tap that answers nothing.
 */
export default function LensFilters({
  index,
  design,
  coating,
  onIndex,
  onDesign,
  onCoating,
  scope,
}: {
  index: string;
  design: string;
  coating: string;
  onIndex: (v: string) => void;
  onDesign: (v: string) => void;
  onCoating: (v: string) => void;
  /**
   * The rest of the narrowing the list under these chips is already under.
   *
   * Without it the chips tally the whole lens catalogue while the table below
   * shows a slice of it, and the two disagree out loud: the withdraw screen
   * lists only stock, both 1.74 lenses in the shop are made to order, and the
   * chip read "1.74 · 2" above a table that could never show either of them.
   */
  scope?: { q?: string; eye?: string; make?: string };
}) {
  // The chosen index and design go too. The API drops a facet's own choice
  // before counting it, so sending them is what makes the *other* row of chips
  // re-tally — pick Progressive and the index counts become the Progressive
  // ones, rather than staying the counts for every lens in the shop.
  const options = useApi<LensOptions>(
    `/lens-options${qs({ ...scope, index, design, coating })}`,
  );

  if (options.status !== "ready") return null;

  const { indexes, designs, coatings } = options.data;
  if (indexes.length === 0 && designs.length === 0 && coatings.length === 0) return null;

  /** One chip per value, with its tally — a zero is an answer, not a dead end. */
  const chips = (
    facets: { value: string; count: number }[],
    chosen: string,
    onPick: (v: string) => void,
    allLabel: string,
    group: string,
    numeric = false,
  ) => (
    <div className="chips" role="group" aria-label={group}>
      <button
        type="button"
        className="chip"
        aria-current={chosen === "" ? "true" : undefined}
        onClick={() => onPick("")}
      >
        {allLabel}
      </button>
      {facets.map((f) => (
        <button
          key={f.value}
          type="button"
          className={numeric ? "chip chip--num" : "chip"}
          aria-current={chosen === f.value ? "true" : undefined}
          // Nothing to show and nothing chosen — leave it unclickable rather
          // than let someone empty the table with a tap that says "none".
          disabled={f.count === 0 && chosen !== f.value}
          onClick={() => onPick(chosen === f.value ? "" : f.value)}
        >
          {f.value}
          <span className="chip__count">{f.count}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="lensfilter">
      <span className="lensfilter__label">เฉพาะเลนส์</span>

      {indexes.length > 0
        ? chips(indexes, index, onIndex, "ทุก Index", "กรองตาม Index", true)
        : null}

      {indexes.length > 0 && designs.length > 0 ? (
        <span className="chips__note">·</span>
      ) : null}

      {designs.length > 0
        ? chips(designs, design, onDesign, "ทุกชนิดเลนส์", "กรองตามชนิดเลนส์")
        : null}

      {designs.length > 0 && coatings.length > 0 ? (
        <span className="chips__note">·</span>
      ) : null}

      {/* Coating earns a row now that the shop stocks five of them rather
          than the open-ended list it used to be. Ordered by how much of each
          is stocked, not alphabetically: what a shop reaches for first is the
          one it sells most of, and A-to-Z would put Blue above everything. */}
      {coatings.length > 0
        ? chips(coatings, coating, onCoating, "ทุก Coating", "กรองตาม Coating")
        : null}
    </div>
  );
}
