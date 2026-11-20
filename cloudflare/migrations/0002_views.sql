-- =====================================================================
-- Pre-Trip PPE Check · Piyachart 54 — Cloudflare D1 views
-- view ทุกตัวอ่านอย่างเดียว ใช้ทั้งหน้าเว็บ (ผ่าน Worker) และรายงาน / BI
--
-- กติกาที่ view ใช้ (ตรงกับชีต วิธีใช้ ใน Excel)
--   * ช่องว่าง = ยังไม่ตรวจ/ยังไม่คีย์ "ไม่ถือว่าผ่าน" และ "ไม่ถือว่ามี"
--   * ผลรวมรถ (overall_result)
--       2 ไม่ผ่าน  = มีข้อใดข้อหนึ่งเป็น 2 หรือ D-Man ติ๊ก "ไม่ผ่าน" บนกระดาษ
--       1 ผ่าน     = กรอกครบทุกข้อที่ active และไม่มีข้อไหนเป็น 2
--       NULL      = ยังกรอกไม่ครบ (ห้ามนับเป็นผ่าน)
--   * สถานะ PPE (DATA PPE!O): กรอกไม่ครบ → 'ไม่ครบ', มีชิ้นที่ไม่มี → 'อุปกรณ์ไม่ครบ', อื่น ๆ → 'ครบ'
--   * "วันนี้" = วันที่ตามเวลาไทย: date('now', '+7 hours')
--   * คอลัมน์ JSON (results, photos, fail_items, missing_items) เป็น TEXT → Worker ต้อง JSON.parse
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. สรุปใบตรวจรถ 1 แถว / 1 ใบ (เทียบชีต DATA รถ ทั้งแถวรวมคอลัมน์สูตร AH:AL)
-- ---------------------------------------------------------------------
CREATE VIEW v_vehicle_inspection_summary AS
SELECT
  s.*,
  CASE WHEN s.filled_count = 0 THEN NULL
       WHEN s.fail_count > 0  THEN 2
       ELSE 1 END                                                       AS computed_result,
  CASE WHEN s.fail_count > 0 OR s.declared_result = 2 THEN 2
       WHEN s.missing_items_count = 0                 THEN 1
       ELSE NULL END                                                    AS overall_result,
  CASE WHEN s.declared_result IS NOT NULL AND s.filled_count > 0
        AND s.declared_result <> CASE WHEN s.fail_count > 0 THEN 2 ELSE 1 END
       THEN 1 ELSE 0 END                                                AS result_mismatch,
  CASE WHEN s.missing_items_count = 0 THEN 'ครบ' ELSE 'ไม่ครบ' END     AS completeness,     -- DATA รถ!AL
  CASE WHEN s.photo_missing_count = 0 THEN 1
       WHEN s.photo_count > 0         THEN 2
       ELSE 0 END                                                       AS photo_status,     -- 0 ไม่มี 1 ครบ 2 บางส่วน
  CASE WHEN s.photo_missing_count = 0 OR s.line_photo_sent = 1
       THEN 1 ELSE 0 END                                                AS photo_evidence_ok -- มีรูปครบในระบบ หรือส่ง LINE แล้ว
FROM (
  SELECT
    vi.id,
    vi.inspect_date,
    vi.month,
    vi.inspect_time,
    vi.vehicle_id,
    v.plate,
    v.type                                                              AS vehicle_type,
    vi.mileage,
    vi.dman_id,
    d.name                                                              AS dman_name,
    vi.helper1_id,
    h1.name                                                             AS helper1_name,
    vi.helper2_id,
    h2.name                                                             AS helper2_name,
    vi.declared_result,
    vi.line_photo_sent,
    vi.note,
    vi.source,
    vi.approved_by,
    vi.approved_at,
    vi.created_by,
    vi.updated_by,
    vi.created_at,
    vi.updated_at,
    coalesce((SELECT json_group_object(CAST(r.item_no AS TEXT), r.result)
              FROM vehicle_inspection_results r WHERE r.inspection_id = vi.id), '{}')  AS results,
    (SELECT count(*) FROM vehicle_inspection_results r
      WHERE r.inspection_id = vi.id AND r.result = 1)                   AS pass_count,     -- DATA รถ!AH
    (SELECT count(*) FROM vehicle_inspection_results r
      WHERE r.inspection_id = vi.id AND r.result = 2)                   AS fail_count,     -- DATA รถ!AI
    (SELECT count(*) FROM vehicle_inspection_results r
      WHERE r.inspection_id = vi.id AND r.result = 3)                   AS na_count,       -- DATA รถ!AJ
    (SELECT count(*) FROM vehicle_inspection_results r
      WHERE r.inspection_id = vi.id)                                    AS filled_count,   -- DATA รถ!AK
    (SELECT count(*) FROM check_items ci WHERE ci.active = 1)           AS required_count,
    (SELECT count(*) FROM check_items ci
      WHERE ci.active = 1 AND NOT EXISTS (
        SELECT 1 FROM vehicle_inspection_results r
        WHERE r.inspection_id = vi.id AND r.item_no = ci.item_no))      AS missing_items_count,
    coalesce((SELECT json_group_array(x.item_no) FROM (
                SELECT r.item_no FROM vehicle_inspection_results r
                WHERE r.inspection_id = vi.id AND r.result = 2 ORDER BY r.item_no) x), '[]') AS fail_items,
    coalesce((SELECT json_group_object(p.slot, p.r2_key)
              FROM vehicle_inspection_photos p WHERE p.inspection_id = vi.id), '{}')        AS photos,
    (SELECT count(*) FROM vehicle_inspection_photos p
      WHERE p.inspection_id = vi.id)                                    AS photo_count,
    (SELECT count(*) FROM photo_slots ps
      WHERE ps.active = 1 AND NOT EXISTS (
        SELECT 1 FROM vehicle_inspection_photos p
        WHERE p.inspection_id = vi.id AND p.slot = ps.code))            AS photo_missing_count
  FROM vehicle_inspections vi
  JOIN vehicles v       ON v.id  = vi.vehicle_id
  JOIN employees d      ON d.id  = vi.dman_id
  LEFT JOIN employees h1 ON h1.id = vi.helper1_id
  LEFT JOIN employees h2 ON h2.id = vi.helper2_id
) s;


-- ---------------------------------------------------------------------
-- 2. สรุปใบ PPE 1 แถว / 1 คน / 1 วัน (เทียบชีต DATA PPE รวมคอลัมน์สูตร L:O)
-- ---------------------------------------------------------------------
CREATE VIEW v_ppe_inspection_summary AS
SELECT
  s.*,
  CASE WHEN s.missing_required_count > 0 THEN 'ไม่ครบ'
       WHEN s.missing_count > 0          THEN 'อุปกรณ์ไม่ครบ'
       ELSE 'ครบ' END                                                   AS status            -- DATA PPE!O
FROM (
  SELECT
    pi.id,
    pi.inspect_date,
    pi.month,
    pi.employee_id,
    e.name                                                              AS employee_name,    -- DATA PPE!D
    e.role                                                              AS employee_role,    -- DATA PPE!E
    pi.inspector_id,
    i.name                                                              AS inspector_name,
    pi.vehicle_id,
    coalesce(v.plate, '')                                               AS plate,            -- DATA PPE!F
    pi.vehicle_inspection_id,
    pi.note,
    pi.source,
    pi.approved_by,
    pi.approved_at,
    pi.created_by,
    pi.updated_by,
    pi.created_at,
    pi.updated_at,
    coalesce((SELECT json_group_object(r.ppe_code, r.result)
              FROM ppe_inspection_results r WHERE r.ppe_inspection_id = pi.id), '{}') AS results,
    (SELECT count(*) FROM ppe_inspection_results r
      WHERE r.ppe_inspection_id = pi.id AND r.result = 1)               AS have_count,       -- DATA PPE!L
    (SELECT count(*) FROM ppe_inspection_results r
      WHERE r.ppe_inspection_id = pi.id AND r.result = 2)               AS missing_count,    -- DATA PPE!M
    (SELECT count(*) FROM ppe_inspection_results r
      WHERE r.ppe_inspection_id = pi.id)                                AS filled_count,     -- DATA PPE!N
    (SELECT count(*) FROM ppe_items it
      WHERE it.active = 1 AND NOT EXISTS (
        SELECT 1 FROM ppe_inspection_results r
        WHERE r.ppe_inspection_id = pi.id AND r.ppe_code = it.code))    AS missing_required_count,
    coalesce((SELECT json_group_array(x.ppe_code) FROM (
                SELECT r.ppe_code FROM ppe_inspection_results r
                JOIN ppe_items it ON it.code = r.ppe_code
                WHERE r.ppe_inspection_id = pi.id AND r.result = 2
                ORDER BY it.sort_order, it.code) x), '[]')              AS missing_items
  FROM ppe_inspections pi
  JOIN employees e      ON e.id = pi.employee_id
  JOIN employees i      ON i.id = pi.inspector_id
  LEFT JOIN vehicles v  ON v.id = pi.vehicle_id
) s;


-- ---------------------------------------------------------------------
-- 3. ผลรายข้อแบบยาว 1 แถว / 1 ข้อ (สำหรับ Power BI / Looker Studio)
-- ---------------------------------------------------------------------
CREATE VIEW v_vehicle_item_results AS
SELECT
  vi.id                AS inspection_id,
  vi.inspect_date,
  vi.month,
  v.plate,
  vi.dman_id,
  r.item_no,
  ci.name              AS item_name,
  r.result,
  rc.label             AS result_label,
  r.remark
FROM vehicle_inspection_results r
JOIN vehicle_inspections vi ON vi.id = r.inspection_id
JOIN vehicles v             ON v.id = vi.vehicle_id
JOIN check_items ci         ON ci.item_no = r.item_no
JOIN result_codes rc        ON rc.domain = 'vehicle' AND rc.code = r.result;

CREATE VIEW v_ppe_item_results AS
SELECT
  pi.id                AS ppe_inspection_id,
  pi.inspect_date,
  pi.month,
  pi.employee_id,
  pi.inspector_id,
  r.ppe_code,
  it.name              AS ppe_name,
  r.result,
  rc.label             AS result_label
FROM ppe_inspection_results r
JOIN ppe_inspections pi ON pi.id = r.ppe_inspection_id
JOIN ppe_items it       ON it.code = r.ppe_code
JOIN result_codes rc    ON rc.domain = 'ppe' AND rc.code = r.result;


-- ---------------------------------------------------------------------
-- 4. สถานะรายวัน — รวมรถ/คนที่ "ยังไม่ได้ตรวจ" ด้วย
--    ช่วงวัน  = วันแรกที่มีบันทึก ถึงวันนี้ (เวลาไทย)
--    ต้องตรวจ = อยู่ในช่วง active_from..active_to และไม่ใช่วันใน non_working_days
--              (active = 0 และไม่มี active_to → ไม่ต้องตรวจทุกวัน)
--    status   0 ยังไม่ตรวจ · 1 ผ่าน · 2 ไม่ผ่าน · 3 กรอกไม่ครบ
-- ---------------------------------------------------------------------
CREATE VIEW v_daily_vehicle_status AS
WITH RECURSIVE
bounds(first_day, last_day) AS (
  SELECT coalesce(min(d), date('now', '+7 hours')), date('now', '+7 hours')
  FROM (SELECT inspect_date AS d FROM vehicle_inspections
        UNION ALL SELECT inspect_date FROM ppe_inspections)
),
days(day) AS (
  SELECT first_day FROM bounds
  UNION ALL
  SELECT date(days.day, '+1 day') FROM days, bounds WHERE days.day < bounds.last_day
),
expected(day, vehicle_id) AS (
  SELECT d.day, v.id
  FROM days d
  JOIN vehicles v
    ON d.day >= coalesce(v.active_from, '0000-01-01')
   AND d.day <= coalesce(v.active_to, CASE WHEN v.active = 1 THEN '9999-12-31' ELSE '0000-01-01' END)
  WHERE d.day NOT IN (SELECT day FROM non_working_days)
),
keys(day, vehicle_id) AS (
  SELECT day, vehicle_id FROM expected
  UNION
  SELECT inspect_date, vehicle_id FROM vehicle_inspections
)
SELECT
  k.day,
  substr(k.day, 1, 7)                                                   AS month,
  k.vehicle_id,
  v.plate,
  v.type                                                                AS vehicle_type,
  CASE WHEN EXISTS (SELECT 1 FROM expected e
                    WHERE e.day = k.day AND e.vehicle_id = k.vehicle_id)
       THEN 1 ELSE 0 END                                                AS expected,
  s.id                                                                  AS inspection_id,
  s.inspect_time,
  s.dman_id,
  s.dman_name,
  coalesce(s.filled_count, 0)                                           AS filled_count,
  coalesce(s.fail_count, 0)                                             AS fail_count,
  coalesce(s.fail_items, '[]')                                          AS fail_items,
  coalesce(s.photo_count, 0)                                            AS photo_count,
  coalesce(s.photo_status, 0)                                           AS photo_status,
  coalesce(s.photo_evidence_ok, 0)                                      AS photo_evidence_ok,
  CASE WHEN s.id IS NULL           THEN 0
       WHEN s.overall_result = 2   THEN 2
       WHEN s.overall_result = 1   THEN 1
       ELSE 3 END                                                       AS status,
  CASE WHEN s.id IS NULL           THEN 'ยังไม่ตรวจ'
       WHEN s.overall_result = 2   THEN 'ไม่ผ่าน'
       WHEN s.overall_result = 1   THEN 'ผ่าน'
       ELSE 'กรอกไม่ครบ' END                                            AS status_label
FROM keys k
JOIN vehicles v ON v.id = k.vehicle_id
LEFT JOIN v_vehicle_inspection_summary s
       ON s.inspect_date = k.day AND s.vehicle_id = k.vehicle_id;


CREATE VIEW v_daily_ppe_status AS
WITH RECURSIVE
bounds(first_day, last_day) AS (
  SELECT coalesce(min(d), date('now', '+7 hours')), date('now', '+7 hours')
  FROM (SELECT inspect_date AS d FROM vehicle_inspections
        UNION ALL SELECT inspect_date FROM ppe_inspections)
),
days(day) AS (
  SELECT first_day FROM bounds
  UNION ALL
  SELECT date(days.day, '+1 day') FROM days, bounds WHERE days.day < bounds.last_day
),
expected(day, employee_id) AS (
  SELECT d.day, e.id
  FROM days d
  JOIN employees e
    ON e.requires_ppe = 1
   AND d.day >= coalesce(e.active_from, '0000-01-01')
   AND d.day <= coalesce(e.active_to, CASE WHEN e.active = 1 THEN '9999-12-31' ELSE '0000-01-01' END)
  WHERE d.day NOT IN (SELECT day FROM non_working_days)
),
keys(day, employee_id) AS (
  SELECT day, employee_id FROM expected
  UNION
  SELECT inspect_date, employee_id FROM ppe_inspections
)
SELECT
  k.day,
  substr(k.day, 1, 7)                                                   AS month,
  k.employee_id,
  e.name                                                                AS employee_name,
  e.role                                                                AS employee_role,
  CASE WHEN EXISTS (SELECT 1 FROM expected x
                    WHERE x.day = k.day AND x.employee_id = k.employee_id)
       THEN 1 ELSE 0 END                                                AS expected,
  s.id                                                                  AS ppe_inspection_id,
  s.inspector_id,
  s.plate,
  coalesce(s.missing_count, 0)                                          AS missing_count,
  coalesce(s.missing_items, '[]')                                       AS missing_items,
  coalesce(s.status, 'ยังไม่ตรวจ')                                       AS status
FROM keys k
JOIN employees e ON e.id = k.employee_id
LEFT JOIN v_ppe_inspection_summary s
       ON s.inspect_date = k.day AND s.employee_id = k.employee_id;


-- 1 แถว / 1 วัน
CREATE VIEW v_daily_summary AS
WITH
veh AS (
  SELECT day,
         count(*)                                             AS total,
         sum(status > 0)                                      AS checked,
         sum(status = 1)                                      AS passed,
         sum(status = 2)                                      AS failed,
         sum(status = 3)                                      AS incomplete,
         sum(photo_status = 1)                                AS photo_complete,
         sum(photo_evidence_ok = 1)                           AS photo_evidence_ok
  FROM v_daily_vehicle_status GROUP BY day
),
ppe AS (
  SELECT day,
         count(*)                                             AS total,
         sum(status <> 'ยังไม่ตรวจ')                           AS checked,
         sum(status = 'ครบ')                                  AS complete,
         sum(status = 'อุปกรณ์ไม่ครบ')                         AS missing_equipment,
         sum(missing_count)                                   AS missing_items
  FROM v_daily_ppe_status GROUP BY day
),
all_days AS (
  SELECT day FROM veh UNION SELECT day FROM ppe
)
SELECT
  a.day,
  substr(a.day, 1, 7)                                         AS month,
  CASE WHEN a.day IN (SELECT day FROM non_working_days) THEN 1 ELSE 0 END AS is_day_off,
  coalesce(veh.total, 0)                                      AS vehicles_total,
  coalesce(veh.checked, 0)                                    AS vehicles_checked,
  coalesce(veh.passed, 0)                                     AS vehicles_passed,
  coalesce(veh.failed, 0)                                     AS vehicles_failed,
  coalesce(veh.incomplete, 0)                                 AS vehicles_incomplete,
  coalesce(veh.photo_complete, 0)                             AS vehicles_photo_complete,
  coalesce(veh.photo_evidence_ok, 0)                          AS vehicles_photo_evidence_ok,
  coalesce(ppe.total, 0)                                      AS ppe_total,
  coalesce(ppe.checked, 0)                                    AS ppe_checked,
  coalesce(ppe.complete, 0)                                   AS ppe_complete,
  coalesce(ppe.missing_equipment, 0)                          AS ppe_missing_equipment,
  coalesce(ppe.missing_items, 0)                              AS ppe_missing_items
FROM all_days a
LEFT JOIN veh ON veh.day = a.day
LEFT JOIN ppe ON ppe.day = a.day;


-- ---------------------------------------------------------------------
-- 5. BI รายคน / สรุปทั้งทีม
-- ---------------------------------------------------------------------

-- รายวันต่อพนักงาน (ตาราง BI รายคน!A11:H) — เฉพาะวันที่มีกิจกรรม
CREATE VIEW v_employee_daily_activity AS
WITH acts AS (
  SELECT inspect_date AS day, employee_id,
         1                                                     AS ppe_checks,
         CASE WHEN status = 'ครบ' THEN 1 ELSE 0 END            AS ppe_complete,
         missing_count                                         AS ppe_missing_items,
         0 AS vehicle_checks, 0 AS vehicles_passed, 0 AS vehicles_failed,
         0 AS vehicles_incomplete, 0 AS photos_sent, 0 AS failed_items
  FROM v_ppe_inspection_summary
  UNION ALL
  SELECT inspect_date, dman_id,
         0, 0, 0,
         1,
         CASE WHEN overall_result = 1   THEN 1 ELSE 0 END,
         CASE WHEN overall_result = 2   THEN 1 ELSE 0 END,
         CASE WHEN completeness = 'ไม่ครบ' THEN 1 ELSE 0 END,
         photo_evidence_ok,
         fail_count
  FROM v_vehicle_inspection_summary
)
SELECT
  a.day,
  substr(a.day, 1, 7)          AS month,
  a.employee_id,
  e.name                       AS employee_name,
  e.role                       AS employee_role,
  sum(a.ppe_checks)            AS ppe_checks,            -- PPE ตรวจ
  sum(a.ppe_complete)          AS ppe_complete,          -- PPE มีครบ
  sum(a.ppe_missing_items)     AS ppe_missing_items,     -- PPE ไม่มี (รายการ)
  sum(a.vehicle_checks)        AS vehicle_checks,        -- รถตรวจ (เป็น D-Man)
  sum(a.vehicles_passed)       AS vehicles_passed,
  sum(a.vehicles_failed)       AS vehicles_failed,       -- รถไม่ผ่าน
  sum(a.vehicles_incomplete)   AS vehicles_incomplete,   -- รถตรวจไม่ครบ
  sum(a.photos_sent)           AS photos_sent,           -- ภาพ LINE/รูปครบ
  sum(a.failed_items)          AS failed_items           -- รายการรถไม่ผ่าน
FROM acts a
JOIN employees e ON e.id = a.employee_id
GROUP BY a.day, a.employee_id;

-- รายเดือนต่อพนักงาน (BI รายคน!A7:H8 และ สรุปทั้งทีม!A5:H) — พนักงานทุกคน × ทุกเดือนที่มีข้อมูล
CREATE VIEW v_employee_monthly_summary AS
WITH months(month) AS (
  SELECT month FROM vehicle_inspections
  UNION
  SELECT month FROM ppe_inspections
)
SELECT
  m.month,
  e.id                                         AS employee_id,
  e.name                                       AS employee_name,
  e.role                                       AS employee_role,
  e.active,
  coalesce(sum(a.ppe_checks), 0)               AS ppe_checks,
  coalesce(sum(a.ppe_complete), 0)             AS ppe_complete,
  coalesce(sum(a.ppe_missing_items), 0)        AS ppe_missing_items,
  coalesce(sum(a.vehicle_checks), 0)           AS vehicle_checks,
  coalesce(sum(a.vehicles_passed), 0)          AS vehicles_passed,
  coalesce(sum(a.vehicles_failed), 0)          AS vehicles_failed,
  coalesce(sum(a.photos_sent), 0)              AS photos_sent,
  coalesce(sum(a.vehicles_incomplete), 0)      AS vehicles_incomplete,
  CASE WHEN coalesce(sum(a.ppe_checks), 0) = 0 THEN NULL
       ELSE round(100.0 * sum(a.ppe_complete) / sum(a.ppe_checks), 1) END
                                               AS ppe_complete_pct,
  CASE WHEN coalesce(sum(a.vehicle_checks), 0) = 0 THEN NULL
       ELSE round(100.0 * sum(a.vehicles_passed) / sum(a.vehicle_checks), 1) END
                                               AS vehicle_pass_pct
FROM months m
CROSS JOIN employees e
LEFT JOIN v_employee_daily_activity a
       ON a.month = m.month AND a.employee_id = e.id
GROUP BY m.month, e.id;


-- ---------------------------------------------------------------------
-- 6. ตรวจความถูกต้องของเลขไมล์ (ไมล์ต้องไม่ลดลงเมื่อเทียบกับครั้งก่อนของรถคันเดียวกัน)
-- ---------------------------------------------------------------------
CREATE VIEW v_mileage_check AS
SELECT
  x.*,
  x.mileage - x.prev_mileage                                    AS km_since_prev,
  CASE WHEN x.prev_mileage IS NULL       THEN 'ครั้งแรก'
       WHEN x.mileage < x.prev_mileage   THEN 'ไมล์ลดลง'
       ELSE 'ปกติ' END                                           AS mileage_status
FROM (
  SELECT
    vi.id                                                       AS inspection_id,
    vi.inspect_date,
    vi.vehicle_id,
    v.plate,
    vi.mileage,
    lag(vi.mileage)      OVER w                                 AS prev_mileage,
    lag(vi.inspect_date) OVER w                                 AS prev_date
  FROM vehicle_inspections vi
  JOIN vehicles v ON v.id = vi.vehicle_id
  WHERE vi.mileage IS NOT NULL
  WINDOW w AS (PARTITION BY vi.vehicle_id ORDER BY vi.inspect_date)
) x;
