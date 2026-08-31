-- Who the stock went to, and the money that follows later.
--
-- Two things this adds, both of which the ledger could not express before:
--
--   1. The person who took the stock is not always the person who keyed it in.
--      `created_by` has always meant "who typed this"; `issued_to_admin_id` now
--      means "who took it". The seeded history already has different people in
--      created_by, and the five password-less staff in `admins` exist for
--      exactly this — being nameable without being able to sign in.
--
--   2. Another branch taking stock is a debt, not a sale. The cost leaves on
--      the day the goods leave, but nothing is earned until they pay. So the
--      withdrawal records no amount at all, and the amount arrives later with
--      its own date — which is the date the profit belongs to.
--
-- No foreign keys, deliberately. `00-foundation.test.php` fails any FK between
-- this module's six tables and anything else, and these two tables are not on
-- that list. The rule the project runs on anyway is that the two systems are
-- kept apart by discipline rather than by constraints.

CREATE TABLE IF NOT EXISTS branches (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(120) NOT NULL,

  -- Free text: a phone number, a line id, a person. Whatever the owner needs
  -- to chase the money with.
  contact     VARCHAR(160) NULL,

  -- Closed branches stay here: their old withdrawals still have to be readable
  -- and settleable. Only new withdrawals are refused.
  is_active   TINYINT(1) NOT NULL DEFAULT 1,

  note        TEXT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_branch_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS branch_issues (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,

  branch_id     INT UNSIGNED NOT NULL,

  -- The person from that branch who actually collected the goods. Free text on
  -- purpose: they do not have an account here, and inventing one for them would
  -- put people who cannot sign in into the sign-in table.
  taken_by      VARCHAR(120) NOT NULL,

  product_id    INT UNSIGNED NOT NULL,
  sku           VARCHAR(100) NOT NULL,
  quantity      INT UNSIGNED NOT NULL,

  -- What the goods cost us, summed over the lots FIFO actually cut. Frozen at
  -- issue time: a later correction to a lot's cost must not silently rewrite
  -- the margin on a withdrawal that has already been settled.
  cost_total    DECIMAL(12,2) NOT NULL DEFAULT 0.00,

  -- Pieces drawn from lots whose cost was still unknown. While this is above
  -- zero, `cost_total` is a floor rather than the real cost, and any profit
  -- computed from it is understated. The screens say so rather than hiding it.
  cost_unknown_qty INT UNSIGNED NOT NULL DEFAULT 0,

  issued_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  issued_by     INT UNSIGNED NULL,          -- admins.id — who keyed it

  -- 'pending' is a receivable. It becomes 'settled' on the day the money
  -- arrives, and that day — not the withdrawal day — is when the profit counts.
  status        ENUM('pending','settled','written_off') NOT NULL DEFAULT 'pending',
  settled_amount DECIMAL(12,2) NULL,
  settled_at    DATETIME NULL,
  settled_by    INT UNSIGNED NULL,          -- admins.id
  settled_note  TEXT NULL,

  note          TEXT NULL,

  PRIMARY KEY (id),
  KEY idx_bi_status (status, issued_at),
  KEY idx_bi_branch (branch_id, status),
  KEY idx_bi_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE inventory_logs
  ADD COLUMN issued_to_admin_id INT UNSIGNED NULL AFTER created_by_kind,
  ADD COLUMN branch_issue_id    INT UNSIGNED NULL AFTER issued_to_admin_id,
  ADD KEY idx_log_issued_to (issued_to_admin_id),
  ADD KEY idx_log_branch_issue (branch_issue_id);
