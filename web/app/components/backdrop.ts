"use client";

/**
 * Clicking the dark outside a modal closes it.
 *
 * A `<dialog>` fills the whole viewport — the backdrop is the dialog's own box,
 * not a sibling — so a click that lands outside the panel still has the dialog
 * as its target. Comparing against the panel's rectangle is what separates
 * "outside the card" from "on the card", and it is the only way to tell them
 * apart without wrapping the content in a second element that swallows clicks.
 *
 * Worth doing because every other overlay on the web closes this way: someone
 * who taps the dark expects it gone, and a modal that ignores that reads as
 * stuck. The close button stays — this is a second way out, not the only one.
 */
function backdropClose(e: React.MouseEvent<HTMLDialogElement>) {
  const dialog = e.currentTarget;
  if (e.target !== dialog) return;

  const box = dialog.getBoundingClientRect();
  const outside =
    e.clientY < box.top ||
    e.clientY > box.bottom ||
    e.clientX < box.left ||
    e.clientX > box.right;

  if (outside) dialog.close();
}

export default backdropClose;
