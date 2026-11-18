-- =====================================================================
-- 0014: ลบคอลัมน์ note ของ trip_activities (หน้าเว็บเอาช่องหมายเหตุออกแล้ว · ตอนลบไม่มีแถวไหนมีข้อความ)
--   view v_trip_activity_summary อ้าง note อยู่ จึงสร้างใหม่โดยไม่มี note
-- =====================================================================
DROP VIEW IF EXISTS v_trip_activity_summary;

ALTER TABLE trip_activities DROP COLUMN note;

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
