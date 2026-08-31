-- "Aspheric" is not a vision design, so it does not belong in lens_design.
--
-- lens_design answers "how many distances does this lens correct" — Single
-- Vision, Bifocal, Progressive. Aspheric answers something else entirely: the
-- shape of the surface. Every aspheric lens is also one of the three, so the
-- value was never an alternative to them; it was a different fact filed in the
-- wrong drawer, and it pushed the real answer out.
--
-- The form stopped offering it, but the catalogue still held one row that had
-- it, which is enough to put it back into every list built from the data — the
-- lens filter reads the values that exist rather than a fixed list, on purpose.
--
-- Nothing is lost by this. The row it affects is "Nikon Lite AS 1.60", where
-- the AS in the product's own name is what records that it is aspheric.
--
-- To undo:
--   UPDATE products
--      SET attributes = JSON_SET(attributes, '$.lens_design', 'Aspheric')
--    WHERE sku = 'LNS-NKL160';

UPDATE products
   SET attributes = JSON_SET(attributes, '$.lens_design', 'Single Vision')
 WHERE product_type = 'Lens'
   AND JSON_UNQUOTE(JSON_EXTRACT(attributes, '$.lens_design')) = 'Aspheric';
