-- A delete elsewhere must not quietly rewrite the stock history.
--
-- Three foreign keys point from the shop-floor tables at this one's, and all
-- three were ON DELETE SET NULL. Two of them point at `stock_lots`:
--
--   production_withdrawals.stock_lot_id   which lot a production job consumed
--   stock_reservations.stock_lot_id       which lot a case is holding
--
-- SET NULL is the worst of the three options there. Deleting a lot does not get
-- refused and does not cascade; it succeeds, and the record of *which lot* a job
-- took its material from silently becomes "none". The row survives, still looks
-- complete, and no longer says anything true. Nobody finds that until someone
-- asks what a job cost and the answer is missing.
--
-- RESTRICT instead: the delete is refused. That matches what the code already
-- does — Catalog::deleteLot refuses any lot with a movement other than its own
-- receipt — so in practice this changes no behaviour anyone will notice. It
-- makes the database agree with the code rather than quietly doing something
-- else in the one case the code is bypassed.
--
-- `case_item_fulfillment.supplier_id -> suppliers` is deliberately left as
-- SET NULL. Suppliers are a lookup, not history: a fulfilment record whose
-- supplier has been removed is still a true record with one unknown field.
--
-- To undo:
--   ALTER TABLE production_withdrawals DROP FOREIGN KEY fk_pw_lot;
--   ALTER TABLE production_withdrawals ADD CONSTRAINT fk_pw_lot
--     FOREIGN KEY (stock_lot_id) REFERENCES stock_lots (id) ON DELETE SET NULL;
--   ALTER TABLE stock_reservations DROP FOREIGN KEY fk_sr_lot;
--   ALTER TABLE stock_reservations ADD CONSTRAINT fk_sr_lot
--     FOREIGN KEY (stock_lot_id) REFERENCES stock_lots (id) ON DELETE SET NULL;

ALTER TABLE production_withdrawals DROP FOREIGN KEY fk_pw_lot;
ALTER TABLE production_withdrawals
  ADD CONSTRAINT fk_pw_lot FOREIGN KEY (stock_lot_id)
      REFERENCES stock_lots (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE stock_reservations DROP FOREIGN KEY fk_sr_lot;
ALTER TABLE stock_reservations
  ADD CONSTRAINT fk_sr_lot FOREIGN KEY (stock_lot_id)
      REFERENCES stock_lots (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
