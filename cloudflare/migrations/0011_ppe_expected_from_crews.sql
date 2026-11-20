-- =====================================================================
-- 0011: "ต้องตรวจ PPE" = ทีมงานบนรถที่ตรวจในวันนั้น (ไม่ใช่พนักงานทุกคนทุกวันแบบเดิม)
--   PPE ตรวจเฉพาะ D-Man / Helper 1 / Helper 2 ของรถที่ตรวจแล้ว (ตั้งแต่ระบบลิงก์ PPE กับการตรวจรถ)
--   แบบเดิมนับพนักงานทุกคน (รวมฝ่ายขาย / คนที่ไม่ได้ขึ้นรถ) เป็น "ยังไม่ตรวจ" ทุกวัน → ตัวเลขผิด
--   คอลัมน์เหมือนเดิมทุกตัว (v_daily_summary ที่อ่าน view นี้ใช้ได้ต่อ) + เพิ่ม crew_role, crew_plate
-- =====================================================================
DROP VIEW IF EXISTS v_daily_ppe_status;

CREATE VIEW v_daily_ppe_status AS
WITH
crew(day, employee_id, crew_role, vehicle_id) AS (
  SELECT inspect_date, dman_id,    'D-Man',    vehicle_id FROM vehicle_inspections
  UNION ALL
  SELECT inspect_date, helper1_id, 'Helper 1', vehicle_id FROM vehicle_inspections WHERE helper1_id IS NOT NULL
  UNION ALL
  SELECT inspect_date, helper2_id, 'Helper 2', vehicle_id FROM vehicle_inspections WHERE helper2_id IS NOT NULL
),
-- one row per person per day (a person on two vehicles the same day counts once: PPE is 1 per person per day)
crew1 AS (
  SELECT day, employee_id, min(crew_role) AS crew_role, min(vehicle_id) AS vehicle_id
  FROM crew GROUP BY day, employee_id
),
keys(day, employee_id) AS (
  SELECT day, employee_id FROM crew1
  UNION
  SELECT inspect_date, employee_id FROM ppe_inspections
)
SELECT
  k.day,
  substr(k.day, 1, 7)                                                   AS month,
  k.employee_id,
  e.name                                                                AS employee_name,
  e.role                                                                AS employee_role,
  CASE WHEN c.employee_id IS NOT NULL THEN 1 ELSE 0 END                 AS expected,
  c.crew_role,
  cv.plate                                                              AS crew_plate,
  s.id                                                                  AS ppe_inspection_id,
  s.inspector_id,
  s.plate,
  coalesce(s.missing_count, 0)                                          AS missing_count,
  coalesce(s.missing_items, '[]')                                       AS missing_items,
  coalesce(s.status, 'ยังไม่ตรวจ')                                       AS status
FROM keys k
JOIN employees e        ON e.id = k.employee_id
LEFT JOIN crew1 c       ON c.day = k.day AND c.employee_id = k.employee_id
LEFT JOIN vehicles cv   ON cv.id = c.vehicle_id
LEFT JOIN v_ppe_inspection_summary s
       ON s.inspect_date = k.day AND s.employee_id = k.employee_id;
