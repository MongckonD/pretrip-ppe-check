-- =====================================================================
-- 0013: เวลาเริ่มงาน = กดปุ่ม "เริ่มการทำงาน" อย่างเดียว (1 ฟิลด์)
--   เดิมมี 2 ฟิลด์: depart_time (พนักงานกรอกเอง) + work_started_at (กดปุ่ม) → ซ้ำซ้อน
--   ตอนนี้: work_started_at (UTC, เซิร์ฟเวอร์ใส่ตอนกดปุ่ม) เป็นเวลาเริ่มงานของรถคันนั้นในวันนั้น
--   view แสดง start_time = เวลาไทย HH:MM
--   ใบที่สร้างก่อนหน้านี้แต่ยังไม่ได้กดเริ่ม → ใช้ depart_time เดิมเป็นเวลาเริ่ม (ไม่ทิ้งข้อมูล)
-- =====================================================================

UPDATE trip_activities
SET work_started_at = strftime('%Y-%m-%dT%H:%M:%fZ', activity_date || 'T' || depart_time, '-7 hours')
WHERE work_started_at IS NULL;

DROP VIEW IF EXISTS v_trip_activity_summary;
DROP VIEW IF EXISTS v_trip_area_results;

ALTER TABLE trip_activities DROP COLUMN depart_time;

-- ทุกใบต้องมีเวลาเริ่มงาน (ใบถูกสร้างจากปุ่ม "เริ่มการทำงาน" เท่านั้น)
CREATE TRIGGER trg_trip_start_required BEFORE INSERT ON trip_activities FOR EACH ROW
WHEN NEW.work_started_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'WORK_TIME: work_started_at is required');
END;
CREATE TRIGGER trg_trip_start_keep BEFORE UPDATE OF work_started_at ON trip_activities FOR EACH ROW
WHEN NEW.work_started_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'WORK_TIME: work_started_at is required');
END;

CREATE VIEW v_trip_activity_summary AS
SELECT
  t.id,
  t.activity_date,
  t.month,
  strftime('%H:%M', t.work_started_at, '+7 hours')                AS start_time,
  t.vehicle_id,
  v.plate,
  v.type                                                          AS vehicle_type,
  t.dman_id,
  e.name                                                          AS dman_name,
  t.vehicle_inspection_id,
  CASE WHEN t.vehicle_inspection_id IS NULL THEN 0 ELSE 1 END     AS inspected,
  coalesce((SELECT json_group_array(x.code) FROM (
              SELECT a.code FROM trip_activity_areas ta JOIN area_types a ON a.code = ta.area_code
              WHERE ta.trip_activity_id = t.id ORDER BY a.sort_order, a.code) x), '[]')   AS area_codes,
  t.note,
  t.work_started_at,
  t.work_ended_at,
  strftime('%H:%M', t.work_ended_at, '+7 hours')                  AS end_time,
  CASE WHEN t.work_ended_at IS NOT NULL
       THEN CAST(round((julianday(t.work_ended_at) - julianday(t.work_started_at)) * 1440) AS INTEGER) END AS work_minutes,
  CASE WHEN t.work_ended_at IS NULL THEN 'กำลังทำงาน' ELSE 'จบงานแล้ว' END AS work_status,
  t.created_by,
  t.updated_by,
  t.created_at,
  t.updated_at
FROM trip_activities t
JOIN vehicles v  ON v.id = t.vehicle_id
JOIN employees e ON e.id = t.dman_id;

CREATE VIEW v_trip_area_results AS
SELECT
  t.id            AS trip_activity_id,
  t.activity_date,
  t.month,
  strftime('%H:%M', t.work_started_at, '+7 hours') AS start_time,
  v.plate,
  t.dman_id,
  a.code          AS area_code,
  a.name          AS area_name
FROM trip_activity_areas ta
JOIN trip_activities t ON t.id = ta.trip_activity_id
JOIN vehicles v        ON v.id = t.vehicle_id
JOIN area_types a      ON a.code = ta.area_code;
