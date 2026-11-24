-- =====================================================================
-- 0025: จับเวลาส่งสินค้าที่ร้าน (store_visits) — ตารางใหม่ ไม่แก้โครงสร้างตารางเดิม (เพิ่ม trigger กับ trip_activities 1 ตัว)
--   1 แถว = สถานะของร้าน 1 ร้านในแผนส่ง 1 วัน (delivery_plan) ของรถ 1 คัน (trip_activities = เริ่มงานของรถวันนั้น)
--   status: open   = กำลังส่ง (ended_at ว่าง) หรือ กดรถออกแล้วแต่ยังไม่บันทึกฟอร์ม (ended_at มีค่า)
--           done   = ส่งสำเร็จ (ต้องมีเวลาเริ่ม-จบ และจำนวนลัง)
--           failed = ส่งไม่สำเร็จ (ต้องมีหมายเหตุ ไม่มีเวลา)
--   เวลาทุกช่องเซิร์ฟเวอร์ประทับเอง (UTC) ไม่ใช้นาฬิกาโทรศัพท์
-- กฎที่ฐานข้อมูลบังคับเอง:
--   - ร้านละ 1 สถานะต่อวัน (plan_id UNIQUE) · รถหนึ่งคันมีร้าน "open" ได้ทีละร้าน
--   - ร้านที่มีสถานะแล้ว ลบออกจากแผนไม่ได้ (แทนที่ / ลบร้าน / ล้างทั้งวัน) — FK RESTRICT
--   - บันทึกเริ่มงานที่มีร้านผูกอยู่ ลบไม่ได้ — FK RESTRICT
--   - ร้านต้องอยู่ในแผนของรถคันเดียวกันวันเดียวกับบันทึกเริ่มงาน
--   - หลังจบงาน เพิ่ม/แก้สถานะร้านไม่ได้ · จบงานไม่ได้ถ้ายังมีร้าน "open"
-- ใช้เมื่อเปิดสวิตช์ FEATURE_STORE_TIMER เท่านั้น (Worker ตอบ 404 ถ้าปิด)
-- =====================================================================

CREATE TABLE store_visits (
  id                TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  plan_id           TEXT    NOT NULL UNIQUE REFERENCES delivery_plan(id) ON DELETE RESTRICT,
  trip_activity_id  TEXT    NOT NULL REFERENCES trip_activities(id) ON DELETE RESTRICT,
  status            TEXT    NOT NULL CHECK (status IN ('open', 'done', 'failed')),
  started_at        TEXT,
  ended_at          TEXT,
  cases             INTEGER CHECK (cases IS NULL OR cases BETWEEN 0 AND 100000),
  skus              INTEGER CHECK (skus IS NULL OR skus BETWEEN 0 AND 100000),
  distance_m        INTEGER CHECK (distance_m IS NULL OR distance_m BETWEEN 0 AND 100000),
  move_method       TEXT    CHECK (move_method IS NULL OR move_method IN ('trolley', 'carry', 'both')),
  note              TEXT    NOT NULL DEFAULT '' CHECK (length(note) <= 300 AND note = trim(note)),
  started_by        TEXT    REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ended_by          TEXT    REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- สถานะต้องมีข้อมูลครบตามชนิด
  CHECK (
    (status = 'open'   AND started_at IS NOT NULL AND (ended_at IS NULL OR ended_at >= started_at)) OR
    (status = 'done'   AND started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at >= started_at AND cases IS NOT NULL) OR
    (status = 'failed' AND started_at IS NULL AND ended_at IS NULL AND note <> '')
  )
) STRICT;
-- ร้านของรถคันนั้นวันนั้น (หน้าพนักงาน / เช็กตอนจบงาน)
CREATE INDEX store_visits_trip_idx ON store_visits (trip_activity_id, status);
-- รถหนึ่งคันมีร้านที่กำลังส่งได้ทีละร้าน
CREATE UNIQUE INDEX store_visits_one_open_uq ON store_visits (trip_activity_id) WHERE status = 'open';

-- ร้านต้องอยู่ในแผนของรถคันเดียวกัน วันเดียวกันกับบันทึกเริ่มงาน และรถต้องยังไม่จบงาน
CREATE TRIGGER trg_store_visit_ins BEFORE INSERT ON store_visits FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'STORE_VISIT_MISMATCH: the store must be on the plan of the same vehicle and day')
   WHERE NOT EXISTS (
     SELECT 1 FROM delivery_plan p JOIN trip_activities t ON t.id = NEW.trip_activity_id
      WHERE p.id = NEW.plan_id AND p.plan_date = t.activity_date AND p.vehicle_id = t.vehicle_id);
  SELECT RAISE(ABORT, 'WORK_ENDED: the vehicle already ended work')
   WHERE (SELECT work_ended_at FROM trip_activities WHERE id = NEW.trip_activity_id) IS NOT NULL;
END;

-- แก้ได้เฉพาะเวลา/ข้อมูลการส่ง ห้ามย้ายร้านหรือย้ายรถ · หลังจบงานแก้ไม่ได้ · ส่งสำเร็จแล้วแก้ไม่ได้
CREATE TRIGGER trg_store_visit_upd BEFORE UPDATE ON store_visits FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'STORE_VISIT_MISMATCH: store and vehicle cannot change')
   WHERE NEW.plan_id IS NOT OLD.plan_id OR NEW.trip_activity_id IS NOT OLD.trip_activity_id;
  SELECT RAISE(ABORT, 'STORE_VISIT_FINAL: a delivered store cannot be changed')
   WHERE OLD.status = 'done';
  SELECT RAISE(ABORT, 'WORK_ENDED: the vehicle already ended work')
   WHERE (SELECT work_ended_at FROM trip_activities WHERE id = NEW.trip_activity_id) IS NOT NULL;
END;

-- จบงานไม่ได้ ถ้ายังมีร้านที่กำลังส่ง / ยังไม่บันทึก
CREATE TRIGGER trg_trip_end_store_open BEFORE UPDATE OF work_ended_at ON trip_activities FOR EACH ROW
WHEN NEW.work_ended_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'STORE_OPEN: a store is still being delivered')
   WHERE EXISTS (SELECT 1 FROM store_visits WHERE trip_activity_id = NEW.id AND status = 'open');
END;
