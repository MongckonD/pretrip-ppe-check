-- =====================================================================
-- 0020: v_vehicle_day_summary follows the admin report "สรุปผลการทำงาน"
--   1 row = 1 vehicle on 1 day, now with every column of the report:
--   วันที่ · ทะเบียนรถ · D-Man · Helper1 · Helper2 · ตรวจรถ · PPE · เริ่ม · จบ · เวลาทำงาน · สถานะ · (เฉลี่ย/วัน)
--   The report's ชั่วโมงรวม / เฉลี่ย/วัน follow the date range picked on the page (any range), which a view
--   cannot take as input; the view keeps the per-month figure (avg_minutes_per_day). For any range use e.g.
--     SELECT plate, sum(work_minutes) AS total_minutes, round(avg(work_minutes)) AS avg_minutes_per_day
--     FROM v_vehicle_day_summary WHERE date BETWEEN '2026-11-01' AND '2026-11-19' GROUP BY plate;
-- =====================================================================
DROP VIEW IF EXISTS v_vehicle_day_summary;

CREATE VIEW v_vehicle_day_summary AS
WITH day AS (
  SELECT
    vi.id                                                        AS vehicle_inspection_id,
    vi.inspect_date                                              AS date,
    substr(vi.inspect_time, 1, 5)                                AS check_time,
    vi.month,
    vi.vehicle_id,
    v.plate,
    vi.dman_id,
    d.name                                                       AS dman_name,
    vi.helper1_id,
    h1.name                                                      AS helper1_name,
    vi.helper2_id,
    h2.name                                                      AS helper2_name,
    (SELECT count(*) FROM vehicle_inspection_results r WHERE r.inspection_id = vi.id AND r.result = 2) AS fail_count,
    1 + (vi.helper1_id IS NOT NULL) + (vi.helper2_id IS NOT NULL)                                  AS crew_size,
    (SELECT count(*) FROM v_ppe_inspection_summary p
      WHERE p.inspect_date = vi.inspect_date AND p.plate = v.plate AND p.status = 'ครบ'
        AND p.employee_id IN (vi.dman_id, vi.helper1_id, vi.helper2_id))                            AS ppe_ok,
    CASE WHEN vi.approved_at IS NOT NULL THEN 'อนุมัติแล้ว'
         WHEN vi.rejected_at IS NOT NULL THEN 'ไม่อนุมัติ'
         ELSE 'รออนุมัติ' END                                     AS approval_status,
    t.id                                                         AS trip_activity_id,
    t.work_started_at,
    t.work_ended_at,
    CASE WHEN t.work_ended_at IS NOT NULL
         THEN CAST(round((julianday(t.work_ended_at) - julianday(t.work_started_at)) * 1440) AS INTEGER) END
                                                                 AS work_minutes,
    CASE WHEN t.id IS NULL THEN 'ยังไม่เริ่มงาน'
         WHEN t.work_ended_at IS NULL THEN 'กำลังทำงาน'
         ELSE 'จบงานแล้ว' END                                     AS work_status
  FROM vehicle_inspections vi
  JOIN vehicles v       ON v.id = vi.vehicle_id
  JOIN employees d      ON d.id = vi.dman_id
  LEFT JOIN employees h1 ON h1.id = vi.helper1_id
  LEFT JOIN employees h2 ON h2.id = vi.helper2_id
  LEFT JOIN trip_activities t ON t.activity_date = vi.inspect_date AND t.vehicle_id = vi.vehicle_id
),
avg AS (
  SELECT *, CAST(round(AVG(work_minutes) OVER (PARTITION BY vehicle_id, month)) AS INTEGER) AS avg_minutes_per_day
  FROM day
)
SELECT
  date,
  plate,
  dman_name,
  helper1_name,
  helper2_name,
  CASE WHEN fail_count > 0 THEN 'ไม่ผ่าน ' || fail_count || ' ข้อ' ELSE 'ผ่าน' END            AS check_result,
  ppe_ok || '/' || crew_size                                                                  AS ppe,
  strftime('%H:%M', work_started_at, '+7 hours')                                              AS start_time,
  strftime('%H:%M', work_ended_at, '+7 hours')                                                AS end_time,
  CASE WHEN work_minutes IS NOT NULL
       THEN (work_minutes / 60) || ':' || printf('%02d', work_minutes % 60) END              AS work_hours,
  approval_status,
  avg_minutes_per_day,
  CASE WHEN avg_minutes_per_day IS NOT NULL
       THEN (avg_minutes_per_day / 60) || ':' || printf('%02d', avg_minutes_per_day % 60) END AS avg_hours_per_day,
  work_minutes,
  work_status,
  fail_count,
  ppe_ok,
  crew_size,
  check_time,
  month,
  dman_id,
  helper1_id,
  helper2_id,
  vehicle_id,
  vehicle_inspection_id,
  trip_activity_id,
  work_started_at,
  work_ended_at
FROM avg;
