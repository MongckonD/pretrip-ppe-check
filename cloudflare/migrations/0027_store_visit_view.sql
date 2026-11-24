-- =====================================================================
-- 0027: view v_store_visit_summary — เวลาส่งสินค้าที่ร้าน 1 แถว = ร้าน 1 ร้านในแผนส่ง 1 วัน (มีสถานะหรือยังก็ได้)
--   ใช้กับรายงาน "เวลาส่งสินค้าที่ร้าน" ในหน้าหลักแอดมิน และดู / export ตรงจากฐานข้อมูลได้
--   status: done (ส่งสำเร็จ) · failed (ส่งไม่สำเร็จ) · open (กำลังส่ง / รอบันทึก) · none (ยังไม่ส่ง)
--   seconds = เวลาที่ร้าน (รถออก − รถจอด, เวลาเซิร์ฟเวอร์) เฉพาะร้านที่ส่งสำเร็จ
-- view อย่างเดียว ไม่แก้ตาราง ไม่แก้ข้อมูล
-- =====================================================================
DROP VIEW IF EXISTS v_store_visit_summary;
CREATE VIEW v_store_visit_summary AS
SELECT
  p.id                                                              AS plan_id,
  p.plan_date,
  substr(p.plan_date, 1, 7)                                         AS month,
  p.vehicle_id,
  v.plate,
  p.sort_order,
  s.sap_code,
  coalesce(nullif(p.store_name, ''), s.name)                        AS store_name,
  CASE WHEN p.store_name <> '' THEN p.store_type ELSE s.store_type END AS store_type,
  (SELECT count(*) FROM delivery_bills b WHERE b.plan_id = p.id)    AS bills,
  (SELECT sum(b.cases) FROM delivery_bills b WHERE b.plan_id = p.id) AS plan_cases,
  coalesce(sv.status, 'none')                                       AS status,
  sv.id                                                             AS visit_id,
  sv.started_at,
  sv.ended_at,
  CASE WHEN sv.status = 'done'
       THEN CAST(round((julianday(sv.ended_at) - julianday(sv.started_at)) * 86400) AS INTEGER) END AS seconds,
  sv.cases,
  sv.skus,
  sv.distance_m,
  sv.move_method,
  coalesce(sv.note, '')                                             AS note,
  sv.started_by,
  nullif(u.display_name, '')                                        AS by_name,
  t.id                                                              AS trip_activity_id,
  t.dman_id,
  e.name                                                            AS dman_name
FROM delivery_plan p
JOIN vehicles v ON v.id = p.vehicle_id
JOIN stores s   ON s.id = p.store_id
LEFT JOIN store_visits sv    ON sv.plan_id = p.id
LEFT JOIN users u            ON u.id = sv.started_by
LEFT JOIN trip_activities t  ON t.activity_date = p.plan_date AND t.vehicle_id = p.vehicle_id
LEFT JOIN employees e        ON e.id = t.dman_id;
