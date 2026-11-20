-- =====================================================================
-- 0018: v_vehicle_day_summary — the admin summary page's monthly table as a view
--   1 row = 1 vehicle on 1 day (each vehicle check), with that day's team and work hours:
--   วันที่ · ทะเบียนรถ · D-Man · Helper1 · Helper2 · ชั่วโมงรวม · เฉลี่ย/วัน
--   เฉลี่ย/วัน = that vehicle's average per working day in the same month, counting finished days only
--   (the same number on each of the vehicle's rows). Nothing is stored twice — it reads
--   vehicle_inspections + trip_activities.
--
--   e.g.  SELECT * FROM v_vehicle_day_summary WHERE month = '2026-11' ORDER BY date, plate;
-- =====================================================================
CREATE VIEW v_vehicle_day_summary AS
WITH day AS (
  SELECT
    vi.id                                                        AS vehicle_inspection_id,
    vi.inspect_date                                              AS date,
    vi.month,
    vi.vehicle_id,
    v.plate,
    vi.dman_id,
    d.name                                                       AS dman_name,
    vi.helper1_id,
    h1.name                                                      AS helper1_name,
    vi.helper2_id,
    h2.name                                                      AS helper2_name,
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
  work_minutes,
  CASE WHEN work_minutes IS NOT NULL
       THEN (work_minutes / 60) || ':' || printf('%02d', work_minutes % 60) END              AS work_hours,
  avg_minutes_per_day,
  CASE WHEN avg_minutes_per_day IS NOT NULL
       THEN (avg_minutes_per_day / 60) || ':' || printf('%02d', avg_minutes_per_day % 60) END AS avg_hours_per_day,
  work_status,
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
