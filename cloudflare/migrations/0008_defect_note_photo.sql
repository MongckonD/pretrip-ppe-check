-- =====================================================================
-- 0008: ข้อตรวจรถที่ "ไม่ผ่าน" มีหมายเหตุ + รูปถ่ายของข้อนั้น
--   - หมายเหตุใช้คอลัมน์ remark ที่มีอยู่แล้ว (vehicle_inspection_results.remark, view v_vehicle_item_results มีแล้ว)
--   - เพิ่ม photo_r2_key: รูปข้อบกพร่องใน R2 (bucket เดียวกับรูปตรวจรถ) — 1 รูปใช้ได้ที่เดียว
-- ฟอร์มพนักงานเลือกได้แค่ ผ่าน / ไม่ผ่าน แล้ว (ค่า 3 = N/A ยังรับไว้สำหรับข้อมูลเก่า)
-- =====================================================================
ALTER TABLE vehicle_inspection_results
  ADD COLUMN photo_r2_key TEXT CHECK (photo_r2_key IS NULL OR length(photo_r2_key) BETWEEN 1 AND 512);

CREATE UNIQUE INDEX vehicle_inspection_results_photo_uq
  ON vehicle_inspection_results (photo_r2_key) WHERE photo_r2_key IS NOT NULL;
