-- =====================================================================
-- 0007: เก็บเฉพาะที่ระบบใช้จริงสำหรับใบขับขี่
--   - ลบ view v_driver_license_status (รวมพนักงานที่ "ยังไม่ส่ง" — หน้า admin ไม่แสดงกลุ่มนี้แล้ว และ API ไม่ได้ใช้ view นี้)
--   - ลบ index driver_licenses_expiry_idx (ไม่มี query ไหนค้นตามวันหมดอายุ)
-- ตารางที่ใช้อยู่: user_consents, driver_licenses (+ unique index ใบปัจจุบันคนละ 1 ใบ)
-- =====================================================================
DROP VIEW IF EXISTS v_driver_license_status;
DROP INDEX IF EXISTS driver_licenses_expiry_idx;
