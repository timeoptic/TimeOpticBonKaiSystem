-- A claim is not a result.
--
-- The first cut of this table only had 'done' and 'failed', so the row that
-- reserves an idempotency key had to be written as 'done' before the work it
-- describes had actually happened. Any claim left behind without a response
-- then blocked every retry of that key for good.
--
-- 'pending' names what the row really is at that moment. A claim starts pending,
-- becomes done when the response is stored, and a pending row found later is a
-- claim whose work never finished — safe for the next caller to take over.

ALTER TABLE stock_requests
  MODIFY status ENUM('pending','done','failed') NOT NULL DEFAULT 'pending';
