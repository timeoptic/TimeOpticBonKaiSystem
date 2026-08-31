-- Goods coming back cancel the debt they created.
--
-- 003 gave a branch withdrawal three endings: still owed, paid, or never going
-- to be paid. It missed a fourth that costs nothing to allow and is wrong to
-- leave out — the branch brought the goods back, so there was never anything to
-- pay. Folding that into 'written_off' would count returned stock as bad debt
-- and make the shop look worse at collecting money than it is.
--
-- A settled withdrawal is deliberately NOT cancellable by returning: money has
-- already been recorded against it, and unwinding that belongs to whoever keeps
-- the books, not to a stock screen.

ALTER TABLE branch_issues
  MODIFY status ENUM('pending','settled','written_off','cancelled')
    NOT NULL DEFAULT 'pending';
