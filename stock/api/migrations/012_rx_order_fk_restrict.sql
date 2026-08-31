-- The RX detail must not be swept away by a delete on the ledger.
--
-- 011 created this key as ON DELETE CASCADE, which the foundation test refuses
-- on sight and is right to: every foreign key pointing at `inventory_logs`,
-- `stock_lots` or `products` has to be RESTRICT, because history that a delete
-- can rewrite is not history. Nothing deletes ledger rows today — that is the
-- point. The constraint is what keeps it that way when someone one day writes
-- the code that would.

ALTER TABLE rx_orders DROP FOREIGN KEY fk_rx_log;

ALTER TABLE rx_orders
  ADD CONSTRAINT fk_rx_log FOREIGN KEY (log_id) REFERENCES inventory_logs (id);
