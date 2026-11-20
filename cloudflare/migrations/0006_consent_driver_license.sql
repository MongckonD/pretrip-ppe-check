-- =====================================================================
-- 0006: ความยินยอมการใช้ข้อมูลส่วนบุคคล + ใบอนุญาตขับขี่ของพนักงาน
--
--   user_consents    ผู้ใช้กด "ยอมรับ" ข้อความความยินยอมฉบับไหน เมื่อไร (เปลี่ยนข้อความ = เปลี่ยน version ต้องกดใหม่)
--   driver_licenses  ใบขับขี่ที่พนักงานถ่ายส่ง: ชื่อ-นามสกุล, เลขที่, วันหมดอายุ (หรือตลอดชีพ), รูปใน R2
--                    1 คนมีใบปัจจุบันได้ใบเดียว (replaced_at IS NULL) ส่งใบใหม่ → ใบเก่าถูกปิด (replaced_at) และลบรูปเก่า
--
-- ข้อตกลงเหมือน 0001: STRICT, วันที่ TEXT 'YYYY-MM-DD' (เวลาไทย), timestamp UTC ISO-8601
-- =====================================================================

CREATE TABLE user_consents (
  user_id      TEXT NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  -- ฉบับของข้อความที่ยอมรับ เช่น '2026-11-17'
  version      TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 40),
  accepted_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ip           TEXT,
  user_agent   TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 200),
  PRIMARY KEY (user_id, version)
) STRICT, WITHOUT ROWID;

CREATE TABLE driver_licenses (
  id            TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id       TEXT    NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  full_name     TEXT    NOT NULL CHECK (full_name = trim(full_name) AND length(full_name) BETWEEN 2 AND 120),
  -- เลขที่ใบอนุญาต: ตัวเลข/ตัวอักษร (เก็บแบบไม่มีช่องว่าง)
  license_no    TEXT    NOT NULL CHECK (length(license_no) BETWEEN 5 AND 20 AND license_no NOT GLOB '*[^0-9A-Za-z]*'),
  -- วันหมดอายุ (ค.ศ.) — NULL เฉพาะใบตลอดชีพ
  expiry_date   TEXT    CHECK (expiry_date IS NULL OR (expiry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                                                      AND date(expiry_date) IS expiry_date)),
  lifetime      INTEGER NOT NULL DEFAULT 0 CHECK (lifetime IN (0, 1)),
  -- รูปใบขับขี่ใน R2: licenses/<user>/<uuid>.jpg (NULL เมื่อรูปถูกลบเพราะส่งใบใหม่)
  photo_r2_key  TEXT    UNIQUE CHECK (photo_r2_key IS NULL OR photo_r2_key GLOB 'licenses/*'),
  -- 1 = ข้อมูลมาจากการอ่านรูปอัตโนมัติ (ผู้ใช้ตรวจ/แก้แล้วก่อนบันทึก), 0 = พิมพ์เอง
  ocr_used      INTEGER NOT NULL DEFAULT 0 CHECK (ocr_used IN (0, 1)),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  replaced_at   TEXT,
  CHECK ((lifetime = 1 AND expiry_date IS NULL) OR (lifetime = 0 AND expiry_date IS NOT NULL))
) STRICT;

-- ใบปัจจุบันได้คนละ 1 ใบ
CREATE UNIQUE INDEX driver_licenses_current_uq ON driver_licenses (user_id) WHERE replaced_at IS NULL;
CREATE INDEX driver_licenses_expiry_idx ON driver_licenses (expiry_date) WHERE replaced_at IS NULL;

-- สถานะใบขับขี่ปัจจุบันของผู้ใช้ role user ทุกคน (รวมคนที่ยังไม่ส่ง) — สำหรับรายงาน / Power BI
--   days_left: จำนวนวันถึงวันหมดอายุ นับจากวันนี้เวลาไทย (ติดลบ = หมดอายุแล้ว)
CREATE VIEW v_driver_license_status AS
SELECT
  u.id                     AS user_id,
  u.display_name,
  u.employee_id,
  u.active,
  l.id                     AS license_id,
  l.full_name,
  l.license_no,
  l.expiry_date,
  l.lifetime,
  l.created_at             AS submitted_at,
  CASE WHEN l.expiry_date IS NULL THEN NULL
       ELSE CAST(julianday(l.expiry_date) - julianday(date('now', '+7 hours')) AS INTEGER) END AS days_left,
  CASE WHEN l.id IS NULL THEN 'missing'
       WHEN l.lifetime = 1 THEN 'lifetime'
       WHEN l.expiry_date < date('now', '+7 hours') THEN 'expired'
       WHEN l.expiry_date <= date('now', '+7 hours', '+60 days') THEN 'expiring'
       ELSE 'ok' END       AS status
FROM users u
LEFT JOIN driver_licenses l ON l.user_id = u.id AND l.replaced_at IS NULL
WHERE u.role = 'user';
