-- =====================================================================
-- 0005: Time activities — บันทึกก่อนออกงานว่ารถคันนี้จะวิ่งพื้นที่ประเภทไหน
--
--   area_types           ประเภทพื้นที่ (ข้อมูลหลัก แก้ชื่อ/ปิดใช้งานได้ ไม่ฝังในโค้ด)
--   trip_activities      1 แถว = รถ 1 คัน / 1 วัน: เวลาออกงาน, D-Man, หมายเหตุ
--                        ผูกกับใบตรวจรถวันเดียวกันของรถคันเดียวกันอัตโนมัติ (vehicle_inspection_id)
--   trip_activity_areas  ความสัมพันธ์หลายต่อหลาย: 1 เที่ยวมีได้หลายประเภทพื้นที่ (เช่น ไกล + ขึ้นเขา)
--
-- ข้อตกลงเหมือน 0001: STRICT, วันที่ TEXT 'YYYY-MM-DD' (เวลาไทย), เวลา HH:MM[:SS], timestamp UTC ISO-8601
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ประเภทพื้นที่
-- ---------------------------------------------------------------------
CREATE TABLE area_types (
  code         TEXT    PRIMARY KEY
                       CHECK (length(code) BETWEEN 1 AND 30 AND code NOT GLOB '*[^a-z0-9_]*'),
  name         TEXT    NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100 AND name = trim(name)),
  description  TEXT    NOT NULL DEFAULT '',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT, WITHOUT ROWID;

-- ---------------------------------------------------------------------
-- 2. บันทึกก่อนออกงาน (1 รถ / 1 วัน)
-- ---------------------------------------------------------------------
CREATE TABLE trip_activities (
  id                     TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  activity_date          TEXT    NOT NULL CHECK (date(activity_date) IS activity_date),
  month                  TEXT    GENERATED ALWAYS AS (substr(activity_date, 1, 7)) VIRTUAL,
  depart_time            TEXT    NOT NULL CHECK (strftime('%H:%M', depart_time) IS depart_time
                                                 OR strftime('%H:%M:%S', depart_time) IS depart_time),
  vehicle_id             TEXT    NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  dman_id                TEXT    NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  vehicle_inspection_id  TEXT    REFERENCES vehicle_inspections(id) ON DELETE SET NULL,
  note                   TEXT    NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  created_by             TEXT    REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  updated_by             TEXT    REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at             TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at             TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT trip_activities_day_vehicle_uq UNIQUE (activity_date, vehicle_id)
) STRICT;
CREATE INDEX trip_activities_vehicle_idx ON trip_activities (vehicle_id, activity_date);
CREATE INDEX trip_activities_dman_idx    ON trip_activities (dman_id, activity_date);
CREATE INDEX trip_activities_vi_idx      ON trip_activities (vehicle_inspection_id);

-- ---------------------------------------------------------------------
-- 3. ประเภทพื้นที่ของแต่ละเที่ยว (หลายต่อหลาย)
-- ---------------------------------------------------------------------
CREATE TABLE trip_activity_areas (
  trip_activity_id  TEXT NOT NULL REFERENCES trip_activities(id) ON DELETE CASCADE,
  area_code         TEXT NOT NULL REFERENCES area_types(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  PRIMARY KEY (trip_activity_id, area_code)
) STRICT, WITHOUT ROWID;
CREATE INDEX trip_activity_areas_code_idx ON trip_activity_areas (area_code);

-- ---------------------------------------------------------------------
-- 4. Triggers
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_area_types_touch AFTER UPDATE ON area_types FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE area_types SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = NEW.code;
END;

CREATE TRIGGER trg_trip_activities_touch AFTER UPDATE ON trip_activities FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE trip_activities SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- เที่ยวที่ผูกกับใบตรวจรถ ต้องเป็นวันเดียวกันและรถคันเดียวกัน
CREATE TRIGGER trg_trip_vi_match_ins BEFORE INSERT ON trip_activities FOR EACH ROW
WHEN NEW.vehicle_inspection_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM vehicle_inspections v
  WHERE v.id = NEW.vehicle_inspection_id AND v.inspect_date = NEW.activity_date AND v.vehicle_id = NEW.vehicle_id)
BEGIN
  SELECT RAISE(ABORT, 'TRIP_VEHICLE_MISMATCH: vehicle_inspection_id must have the same date and vehicle');
END;

CREATE TRIGGER trg_trip_vi_match_upd BEFORE UPDATE OF vehicle_inspection_id, activity_date, vehicle_id ON trip_activities FOR EACH ROW
WHEN NEW.vehicle_inspection_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM vehicle_inspections v
  WHERE v.id = NEW.vehicle_inspection_id AND v.inspect_date = NEW.activity_date AND v.vehicle_id = NEW.vehicle_id)
BEGIN
  SELECT RAISE(ABORT, 'TRIP_VEHICLE_MISMATCH: vehicle_inspection_id must have the same date and vehicle');
END;

-- ถ้าใบตรวจรถถูกแก้วันที่/รถ เที่ยวที่ผูกอยู่ต้องไม่ขัดกัน (Worker ปลดการผูกก่อนแก้)
CREATE TRIGGER trg_vi_trip_match_upd BEFORE UPDATE OF inspect_date, vehicle_id ON vehicle_inspections FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM trip_activities t
  WHERE t.vehicle_inspection_id = NEW.id
    AND (t.activity_date <> NEW.inspect_date OR t.vehicle_id <> NEW.vehicle_id))
BEGIN
  SELECT RAISE(ABORT, 'TRIP_VEHICLE_MISMATCH: linked trip activities have a different date or vehicle');
END;

-- ---------------------------------------------------------------------
-- 5. Views สำหรับหน้าเว็บและรายงาน
-- ---------------------------------------------------------------------

-- 1 แถว / 1 เที่ยว พร้อมรายชื่อประเภทพื้นที่ (เรียงตาม sort_order)
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
  t.created_by,
  t.updated_by,
  t.created_at,
  t.updated_at
FROM trip_activities t
JOIN vehicles v  ON v.id = t.vehicle_id
JOIN employees e ON e.id = t.dman_id;

-- แบบยาว 1 แถว / 1 เที่ยว / 1 ประเภทพื้นที่ (Power BI)
CREATE VIEW v_trip_area_results AS
SELECT
  t.id            AS trip_activity_id,
  t.activity_date,
  t.month,
  t.depart_time,
  v.plate,
  t.dman_id,
  a.code          AS area_code,
  a.name          AS area_name
FROM trip_activity_areas ta
JOIN trip_activities t ON t.id = ta.trip_activity_id
JOIN vehicles v        ON v.id = t.vehicle_id
JOIN area_types a      ON a.code = ta.area_code;

-- สรุปรายเดือน: แต่ละประเภทพื้นที่มีกี่เที่ยว กี่คัน
CREATE VIEW v_trip_area_monthly AS
SELECT
  t.month,
  a.code                          AS area_code,
  a.name                          AS area_name,
  a.sort_order,
  count(*)                        AS trips,
  count(DISTINCT t.vehicle_id)    AS vehicles,
  count(DISTINCT t.dman_id)       AS dmen
FROM trip_activity_areas ta
JOIN trip_activities t ON t.id = ta.trip_activity_id
JOIN area_types a      ON a.code = ta.area_code
GROUP BY t.month, a.code;

-- ---------------------------------------------------------------------
-- 6. ข้อมูลตั้งต้น: 7 ประเภทพื้นที่
-- ---------------------------------------------------------------------
INSERT INTO area_types (code, name, sort_order) VALUES
  ('remote',         'พื้นที่ไกล',               1),
  ('mountain',       'พื้นที่ขึ้นเขา',            2),
  ('urban_dense',    'พื้นที่หนาแน่นในเมือง',     3),
  ('suburban_dense', 'พื้นที่หนาแน่นนอกเมือง',    4),
  ('easy_access',    'พื้นที่เข้าถึงง่าย',         5),
  ('narrow_road',    'พื้นที่ถนนแคบ (2 เลน)',     6),
  ('road_works',     'พื้นที่ถนนซ่อมบำรุง',        7);
