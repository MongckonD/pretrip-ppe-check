-- เลขที่บิล / Delivery No หนึ่งเลข = การส่งครั้งเดียว: ห้ามซ้ำทั้งระบบ (ทุกวัน ทุกร้าน) ไม่ใช่แค่ในร้านเดียวกัน
-- บิลที่ไม่มีเลข ('') ไม่นับ
DROP INDEX IF EXISTS delivery_bills_plan_bill_uq;
CREATE UNIQUE INDEX delivery_bills_bill_uq ON delivery_bills (bill_no) WHERE bill_no <> '';
