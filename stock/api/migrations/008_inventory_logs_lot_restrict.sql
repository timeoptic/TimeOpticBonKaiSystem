-- The ledger's own link to its lots was the loosest of the lot.
--
-- 007 tightened the two foreign keys the shop-floor tables point at
-- `stock_lots` with. The rule that came out of it — a delete must not silently
-- rewrite stock history — then found a fourth one that had been sitting here
-- all along, in this project's own schema:
--
--   inventory_logs.lot_id -> stock_lots   ON DELETE SET NULL
--
-- Delete a lot straight from SQL and every ledger line that came from it keeps
-- existing while forgetting where the goods came from. A received quantity with
-- no lot behind it cannot be reconciled against anything.
--
-- Nothing in the application relies on that behaviour. `Catalog::deleteLot`
-- already deletes the ledger lines itself, inside a transaction, before
-- deleting the lot — precisely so the books stay balanced — which means the
-- foreign key is satisfied before it is ever consulted. RESTRICT only changes
-- what happens to someone bypassing that code, and what it changes is: the
-- delete is refused instead of quietly succeeding.
--
-- To undo:
--   ALTER TABLE inventory_logs DROP FOREIGN KEY fk_inv_lot;
--   ALTER TABLE inventory_logs ADD CONSTRAINT fk_inv_lot
--     FOREIGN KEY (lot_id) REFERENCES stock_lots (id) ON DELETE SET NULL;

ALTER TABLE inventory_logs DROP FOREIGN KEY fk_inv_lot;
ALTER TABLE inventory_logs
  ADD CONSTRAINT fk_inv_lot FOREIGN KEY (lot_id)
      REFERENCES stock_lots (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
