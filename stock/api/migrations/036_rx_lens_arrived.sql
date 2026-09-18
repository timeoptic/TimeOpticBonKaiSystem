-- เลนส์ของใบสั่งตัด RX มาถึงร้านแล้วหรือยัง — ร้านขอไว้ 14 ก.ย. 2026
--
-- ใบสั่งตัดเปิดตอนขาย แล้วเลนส์มาจากผู้ขายหลายวันต่อมา · ระหว่างนั้นหน้าร้านไม่มีทางรู้
-- ว่าของมาหรือยังนอกจากเดินไปถามคลัง · คนรับของที่คลังติ๊กบนหน้าใบสั่งตัด แล้วหน้าเคส
-- กับกระดานงานเห็นเอง
--
-- เก็บเป็นเวลา ไม่ใช่ธง — "มาถึงเมื่อไร" คือคำถามถัดไปเสมอ (นัดลูกค้ามารับได้วันไหน)
-- และเก็บว่าใครติ๊ก เพราะติ๊กผิดก็เอาออกได้ ตอนมีคนถามว่าทำไมขึ้นว่ามาแล้วต้องตอบได้
--
--   arrived_at  NULL = ยังไม่มา
--   arrived_by  บัญชีที่ติ๊กล่าสุด · เอาติ๊กออกแล้วเป็น NULL ทั้งคู่

ALTER TABLE rx_orders
  ADD COLUMN arrived_at DATETIME NULL DEFAULT NULL
    COMMENT 'เลนส์มาถึงร้านเมื่อไร — NULL = ยังไม่มา',
  ADD COLUMN arrived_by INT UNSIGNED NULL DEFAULT NULL
    COMMENT 'ใครติ๊กว่าเลนส์มาแล้ว';

ALTER TABLE rx_orders
  ADD CONSTRAINT fk_rx_arrived_by FOREIGN KEY (arrived_by) REFERENCES admins (id);

CREATE INDEX idx_rx_arrived ON rx_orders (arrived_at);
