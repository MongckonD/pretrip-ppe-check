-- =====================================================================
-- 0012: จับเวลาทำงานทั้งวัน (Time activities)
--   ปุ่ม "เริ่มการทำงาน" → work_started_at, ปุ่ม "จบงาน / หยุดเวลาทำงาน" → work_ended_at
--   เก็บในใบบันทึกก่อนออกงาน (1 รถ / 1 วัน = ทีมของรถคันนั้น) เวลาเป็น timestamp UTC ที่เซิร์ฟเวอร์ใส่เอง
--   work_minutes (ใน view) = เวลาทำงานรวมเป็นนาที
-- =====================================================================
ALTER TABLE trip_activities ADD COLUMN work_started_at TEXT;
ALTER TABLE trip_activities ADD COLUMN work_started_by TEXT REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE trip_activities ADD COLUMN work_ended_at   TEXT;
ALTER TABLE trip_activities ADD COLUMN work_ended_by   TEXT REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- จบงานได้ต่อเมื่อเริ่มงานแล้ว และเวลาจบต้องไม่ก่อนเวลาเริ่ม
CREATE TRIGGER trg_trip_work_ins BEFORE INSERT ON trip_activities FOR EACH ROW
WHEN (NEW.work_ended_at IS NOT NULL AND (NEW.work_started_at IS NULL OR NEW.work_ended_at < NEW.work_started_at))
BEGIN
  SELECT RAISE(ABORT, 'WORK_TIME: work_ended_at needs work_started_at and must not be earlier');
END;

CREATE TRIGGER trg_trip_work_upd BEFORE UPDATE OF work_started_at, work_ended_at ON trip_activities FOR EACH ROW
WHEN (NEW.work_ended_at IS NOT NULL AND (NEW.work_started_at IS NULL OR NEW.work_ended_at < NEW.work_started_at))
BEGIN
  SELECT RAISE(ABORT, 'WORK_TIME: work_ended_at needs work_started_at and must not be earlier');
END;

DROP VIEW IF EXISTS v_trip_activity_summary;
CREATE VIEW v_trip_activity_summary AS
SELECT
  t.id,
  t.activity_date,
  t.month,
  t.depart_time,
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
  coalesce((SELECT group_concat(x.name, ', ') FROM (
              SELECT a.name FROM trip_activity_areas ta JOIN area_types a ON a.code = ta.area_code
              WHERE ta.trip_activity_id = t.id ORDER BY a.sort_order, a.code) x), '')     AS area_names,
  (SELECT count(*) FROM trip_activity_areas ta WHERE ta.trip_activity_id = t.id)          AS area_count,
  t.note,
  t.work_started_at,
  t.work_ended_at,
  CASE WHEN t.work_started_at IS NOT NULL AND t.work_ended_at IS NOT NULL
       THEN CAST(round((julianday(t.work_ended_at) - julianday(t.work_started_at)) * 1440) AS INTEGER) END AS work_minutes,
  CASE WHEN t.work_started_at IS NULL THEN 'ยังไม่เริ่ม'
       WHEN t.work_ended_at IS NULL   THEN 'กำลังทำงาน'
       ELSE 'จบงานแล้ว' END                                       AS work_status,
  t.created_by,
  t.updated_by,
  t.created_at,
  t.updated_at
FROM trip_activities t
JOIN vehicles v  ON v.id = t.vehicle_id
JOIN employees e ON e.id = t.dman_id;
