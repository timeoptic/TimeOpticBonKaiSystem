-- Fills in what the shop-floor system did not write, as far as it can be known.
--
-- Until now the front-of-house code cut stock by writing `stock_lots` and
-- `inventory_logs` itself instead of calling the API. Doing it by hand meant
-- three things never got written, because nothing in that path knew how:
-- the cost of the lot it took from, the document the goods went out against,
-- and who did it.
--
-- The fix is upstream — that code now calls StockGate — but the rows it already
-- wrote are still short. This recovers the two that can be recovered from facts
-- already in the database, and leaves the third alone.
--
--   unit_cost      recovered. Every row records the lot it drew from, and a lot
--                  carries one cost. There is nothing to infer.
--
--   reference_doc  recovered where a production withdrawal names the same lot
--                  within two minutes of the ledger row. That window IS an
--                  inference. It is safe here because this is a development
--                  database seeded with test data; on a live one it should be
--                  agreed first, or driven by an id the front system records.
--
--   created_by     not recoverable. It was never captured anywhere — the
--                  withdrawal rows have a null `withdrawn_by` too. Left null,
--                  because null says "unknown" and any name we put there would
--                  say something we do not know.
--
-- To undo:
--   UPDATE inventory_logs SET unit_cost = NULL, reference_doc = NULL
--    WHERE notes = 'เริ่มผลิต' AND created_by IS NULL;

-- 1. The cost of the lot each row drew from.
UPDATE inventory_logs g
  JOIN stock_lots l ON l.id = g.lot_id
   SET g.unit_cost = l.cost_per_unit
 WHERE g.action_type = 'OUT'
   AND g.unit_cost IS NULL
   AND g.reference_doc IS NULL
   AND g.created_by IS NULL
   AND l.cost_per_unit IS NOT NULL;

-- 2. The case the goods went out against, where a withdrawal points at the same
--    lot at the same moment. DISTINCT on the log row via the correlated
--    subquery, so a lot withdrawn twice cannot multiply the update.
UPDATE inventory_logs g
   SET g.reference_doc = (
         SELECT c.case_code
           FROM production_withdrawals w
           JOIN cases c ON c.id = w.case_id
          WHERE w.stock_lot_id = g.lot_id
            AND ABS(TIMESTAMPDIFF(SECOND, w.withdrawn_at, g.created_at)) <= 120
          ORDER BY ABS(TIMESTAMPDIFF(SECOND, w.withdrawn_at, g.created_at)) ASC
          LIMIT 1
       )
 WHERE g.action_type = 'OUT'
   AND g.reference_doc IS NULL
   AND g.created_by IS NULL
   AND EXISTS (
         SELECT 1
           FROM production_withdrawals w
          WHERE w.stock_lot_id = g.lot_id
            AND ABS(TIMESTAMPDIFF(SECOND, w.withdrawn_at, g.created_at)) <= 120
       );
