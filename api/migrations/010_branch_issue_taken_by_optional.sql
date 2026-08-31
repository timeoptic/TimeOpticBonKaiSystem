-- The branch's collector no longer has to be named.
--
-- It was asked for on every branch withdrawal and answered honestly perhaps
-- half the time: the person at the counter is handing goods to a colleague they
-- already know, under time pressure, and a required free-text field in that
-- position collects "-", "พี่", and the branch's own name. A field that is
-- filled with noise is worse than a field that is not there, because the noise
-- is indistinguishable from a real answer when the row is read back a month
-- later.
--
-- What the receivable actually needs is which branch owes for what, and that is
-- `branch_id` — never optional. The name stays accepted from callers that do
-- know it (the shop-floor system takes it from the collector's own login), so
-- nothing already recorded is lost or has to be rewritten.

ALTER TABLE branch_issues
  MODIFY COLUMN taken_by VARCHAR(120) NULL
    COMMENT 'ชื่อคนจากสาขาที่มารับของ · ว่างได้ — ตัวที่ผูกหนี้คือ branch_id';
