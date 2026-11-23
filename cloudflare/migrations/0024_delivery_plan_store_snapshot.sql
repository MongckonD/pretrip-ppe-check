-- แผนส่งเก็บชื่อ / ประเภท / ที่อยู่ร้าน "ของวันนั้น" ไว้ในแถวเอง
-- ตาราง stores เก็บข้อมูลล่าสุด (ใช้กับไฟล์ถัดไป) — ถ้าร้านเปลี่ยนชื่อหรือย้ายที่ แผนของวันที่ผ่านมาแล้วยังแสดงตามที่เป็นในวันนั้น
ALTER TABLE delivery_plan ADD COLUMN store_name    TEXT NOT NULL DEFAULT '' CHECK (length(store_name) <= 200);
ALTER TABLE delivery_plan ADD COLUMN store_type    TEXT NOT NULL DEFAULT '' CHECK (length(store_type) <= 30);
ALTER TABLE delivery_plan ADD COLUMN store_address TEXT NOT NULL DEFAULT '' CHECK (length(store_address) <= 500);
