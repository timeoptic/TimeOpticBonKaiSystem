-- One request may now cut several products at once.
--
-- A pair of lenses is two SKUs — the left and the right almost never share a
-- power — so the shop's most ordinary job was two requests, and the two could
-- come apart: the first cut, the second refused for want of stock, and a
-- half-issued pair on the ledger with nothing tying the two together.
--
-- A basket is one request, one key, one transaction, all lines or none. The
-- only thing that has to give here is `sku`: a basket has no single one. It
-- becomes NULL for baskets, and the lines live in `response` alongside the
-- answer that gets replayed on a duplicate — which is where they belong, since
-- the response is the record that has to survive verbatim.
--
-- Single-product requests are untouched and still fill `sku`, so the shortage
-- index over it keeps working for the calls that dominate the table.

ALTER TABLE stock_requests
  MODIFY COLUMN sku VARCHAR(100) NULL
    COMMENT 'สินค้าที่ขอ · NULL เมื่อเป็นตะกร้าหลายรายการ — ดูรายการใน response';
