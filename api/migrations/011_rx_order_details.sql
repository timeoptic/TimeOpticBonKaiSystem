-- An RX order is a job, not a shelf.
--
-- Until now the prescription lived on the *product*, which is right for a lens
-- the shop stocks — a drawer of −2.00 really is a different SKU from a drawer of
-- −2.25 — and wrong for one cut to order. The catalogue held six made-to-order
-- lenses and the ledger held thirteen orders against them, so three customers
-- who each ordered a Varilux X 1.67 for the left eye all pointed at one product
-- carrying one power. Two of those three prescriptions were never recorded
-- anywhere: the form never asked, and there was nowhere to put the answer.
--
-- So the prescription moves to the order, and the product goes back to being
-- what it should be for this kind of goods: the lens *model*. The catalogue
-- stops growing by one row per customer, and "what power did we order on
-- RX-2026-0127" becomes a question the system can answer.
--
-- The selling price moves here for the same reason. A stocked product has one
-- price on the shelf; a bespoke lens is quoted per job, and quoting it per job
-- is exactly what makes the margin on that job knowable.
--
-- Shaped after `branch_issues`: a row in `inventory_logs` remains the ledger
-- entry, and the facts that only this kind of movement has hang off it in a
-- table of their own. The cost stays on the log, where every other movement
-- keeps its cost and where `Rx::setCost` already writes it.

CREATE TABLE IF NOT EXISTS rx_orders (
  id        INT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- The RX_ORDER row this describes. One row each, and it goes when that goes.
  log_id    INT UNSIGNED NOT NULL,

  -- The prescription as written on the job sheet. Nullable throughout: an order
  -- keyed before the sheet arrives is a real thing, and a blank column says so
  -- where a zero would lie.
  eye_side  ENUM('left','right') NULL,
  sph       DECIMAL(5,2) NULL,
  cyl       DECIMAL(5,2) NULL,
  axis      SMALLINT UNSIGNED NULL,

  -- "+2.00" — the leading plus is part of how an ADD is written and read, so it
  -- is kept as written rather than normalised into a number.
  add_power VARCHAR(10) NULL,

  -- What the customer is charged for this job. NULL until it is quoted.
  sale_price DECIMAL(12,2) NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_rx_log (log_id),
  CONSTRAINT fk_rx_log FOREIGN KEY (log_id) REFERENCES inventory_logs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
