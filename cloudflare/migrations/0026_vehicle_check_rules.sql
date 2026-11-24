-- =====================================================================
-- 0026: กฎการตรวจรถ (ไม่แก้โครงสร้างตาราง เพิ่ม trigger อย่างเดียว — ข้อมูลเดิมทุกแถวผ่านกฎนี้อยู่แล้ว)
--   1. เลขไมล์ต้องกรอกทุกครั้ง (ทั้งส่งครั้งแรกและตอนแก้ไข)
--   2. คนหนึ่งตรวจรถได้วันละ 1 คัน (ผู้บันทึกเดียวกัน วันเดียวกัน ห้ามมีใบตรวจของรถคันอื่น)
--      แถวที่นำเข้าจากไฟล์เก่า (created_by ว่าง) ไม่นับ
--   ตรวจครบทุกข้อ: Worker บังคับตอนบันทึก (ผลตรวจบันทึกแยกตาราง ตรวจใน trigger ไม่ได้)
-- =====================================================================

CREATE TRIGGER trg_vi_mileage_ins BEFORE INSERT ON vehicle_inspections FOR EACH ROW
WHEN NEW.mileage IS NULL
BEGIN
  SELECT RAISE(ABORT, 'MILEAGE_REQUIRED: a vehicle check needs the mileage');
END;

CREATE TRIGGER trg_vi_mileage_upd BEFORE UPDATE OF mileage ON vehicle_inspections FOR EACH ROW
WHEN NEW.mileage IS NULL
BEGIN
  SELECT RAISE(ABORT, 'MILEAGE_REQUIRED: a vehicle check needs the mileage');
END;

CREATE TRIGGER trg_vi_one_vehicle_ins BEFORE INSERT ON vehicle_inspections FOR EACH ROW
WHEN NEW.created_by IS NOT NULL AND EXISTS (
  SELECT 1 FROM vehicle_inspections
   WHERE inspect_date = NEW.inspect_date AND created_by = NEW.created_by AND vehicle_id <> NEW.vehicle_id AND id <> NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'ONE_VEHICLE_A_DAY: this account already checked another vehicle today');
END;
