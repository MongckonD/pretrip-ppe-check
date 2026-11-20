-- =====================================================================
-- Pre-Trip PPE Check · Piyachart 54
-- Cloudflare D1 (SQLite) schema — tables, indexes, triggers
-- รันด้วย: npx wrangler d1 migrations apply pretrip-ppe --remote
--
-- ข้อตกลงทั้งไฟล์
--   * ทุกตารางเป็น STRICT: ชนิดข้อมูลถูกบังคับจริง (SQLite ปกติไม่บังคับ)
--   * boolean  = INTEGER 0/1 + CHECK
--   * วันที่    = TEXT 'YYYY-MM-DD' เป็น "วันที่ตามเวลาไทย" (Asia/Bangkok) ที่ผู้ใช้เลือก
--   * เวลา     = TEXT 'HH:MM' หรือ 'HH:MM:SS' (เวลาไทย)
--   * timestamp = TEXT ISO-8601 UTC 'YYYY-MM-DDTHH:MM:SS.SSSZ'
--   * id       = TEXT hex 32 ตัว (Worker ส่ง crypto.randomUUID() มาเองก็ได้)
--   * D1 เปิด foreign key ตลอดเวลา ไม่ต้องสั่ง PRAGMA foreign_keys
--   * ห้ามใส่ BEGIN/COMMIT ในไฟล์ migration (D1 จัด transaction เอง)
--
-- รหัสผล (ตรงกับชีต ตั้งค่า!I:J ใน Excel)
--   ตรวจรถ  1 = ผ่าน, 2 = ไม่ผ่าน, 3 = ไม่เกี่ยวข้อง
--   PPE     1 = มี,   2 = ไม่มี
--   ช่องว่าง = ยังไม่ตรวจ/ยังไม่คีย์ → ไม่มีแถวในตารางผล และ "ไม่ถือว่าผ่าน"
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Lookup tables
-- ---------------------------------------------------------------------

-- ความหมายของรหัสผล (ใช้ทำ label ในรายงาน / Power BI)
CREATE TABLE result_codes (
  domain      TEXT    NOT NULL CHECK (domain IN ('vehicle', 'ppe')),
  code        INTEGER NOT NULL,
  label       TEXT    NOT NULL,
  PRIMARY KEY (domain, code),
  CHECK ((domain = 'vehicle' AND code IN (1, 2, 3)) OR (domain = 'ppe' AND code IN (1, 2)))
) STRICT, WITHOUT ROWID;

-- ตำแหน่งพนักงาน (dropdown ใน ตั้งค่า!C4:C9)
CREATE TABLE employee_roles (
  code        TEXT    PRIMARY KEY CHECK (length(code) BETWEEN 1 AND 30 AND code = trim(code)),
  sort_order  INTEGER NOT NULL DEFAULT 0
) STRICT, WITHOUT ROWID;


-- ---------------------------------------------------------------------
-- 2. Master data
-- ---------------------------------------------------------------------

-- พนักงาน (ตั้งค่า!A:D)
CREATE TABLE employees (
  id            TEXT    PRIMARY KEY
                        CHECK (length(id) BETWEEN 1 AND 20 AND id = upper(trim(id))),   -- EMP01
  name          TEXT    NOT NULL DEFAULT '' CHECK (name = trim(name)),
  role          TEXT    REFERENCES employee_roles(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  requires_ppe  INTEGER NOT NULL DEFAULT 1 CHECK (requires_ppe IN (0, 1)),  -- 0 = ไม่ต้องตรวจ PPE รายวัน (เช่น ธุรการ)
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),        -- ตั้งค่า!D "ใช้งาน"
  active_from   TEXT    CHECK (date(active_from) IS active_from),           -- วันแรกที่ต้องตรวจ (NULL = ไม่จำกัด)
  active_to     TEXT    CHECK (date(active_to) IS active_to),               -- วันสุดท้ายที่ต้องตรวจ (ตั้งตอนเลิกใช้งาน)
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (active_from IS NULL OR active_to IS NULL OR active_to >= active_from)
) STRICT, WITHOUT ROWID;

-- ทะเบียนรถ (ตั้งค่า!F:G)
CREATE TABLE vehicles (
  id            TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  plate         TEXT    NOT NULL CHECK (length(plate) BETWEEN 1 AND 20 AND plate = trim(plate)),
  -- ทะเบียนแบบตัดช่องว่าง/ขีด/จุด ใช้กันกรอกซ้ำ เช่น "70-1234" กับ "70 1234"
  plate_key     TEXT    GENERATED ALWAYS AS (upper(replace(replace(replace(plate, ' ', ''), '-', ''), '.', ''))) VIRTUAL,
  type          TEXT    NOT NULL DEFAULT '' CHECK (type = trim(type)),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  active_from   TEXT    CHECK (date(active_from) IS active_from),
  active_to     TEXT    CHECK (date(active_to) IS active_to),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (active_from IS NULL OR active_to IS NULL OR active_to >= active_from)
) STRICT;
CREATE UNIQUE INDEX vehicles_plate_uq     ON vehicles (plate);
CREATE UNIQUE INDEX vehicles_plate_key_uq ON vehicles (plate_key);

-- รายการตรวจรถ 23 ข้อ (PRINT!A7:C29) — item_no เป็นคีย์ถาวร ห้ามเปลี่ยนเลข
CREATE TABLE check_items (
  item_no     INTEGER PRIMARY KEY CHECK (item_no BETWEEN 1 AND 99),
  name        TEXT    NOT NULL CHECK (length(trim(name)) > 0),
  hint        TEXT    NOT NULL DEFAULT '',                                   -- วิธีตรวจ
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- อุปกรณ์ PPE 4 อย่าง (PRINT!A32:B35)
CREATE TABLE ppe_items (
  code        TEXT    PRIMARY KEY CHECK (length(code) BETWEEN 1 AND 20 AND code = lower(trim(code))),
  name        TEXT    NOT NULL CHECK (length(trim(name)) > 0),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT, WITHOUT ROWID;

-- ช่องรูป 6 ช่อง (PRINT!B37: หน้า / ข้าง / หลัง / หน้าปัด / สินค้า / PPE)
CREATE TABLE photo_slots (
  code        TEXT    PRIMARY KEY CHECK (length(code) BETWEEN 1 AND 20 AND code = lower(trim(code))),
  name        TEXT    NOT NULL CHECK (length(trim(name)) > 0),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
) STRICT, WITHOUT ROWID;

-- วันหยุด / วันไม่มีรถออก — วันเหล่านี้รถและคนที่ไม่ได้ตรวจจะไม่ถูกนับเป็น "ยังไม่ตรวจ"
CREATE TABLE non_working_days (
  day         TEXT    PRIMARY KEY CHECK (date(day) IS day),
  note        TEXT    NOT NULL DEFAULT ''
) STRICT, WITHOUT ROWID;


-- ---------------------------------------------------------------------
-- 3. ผู้ใช้ระบบ — login ด้วย id_user + รหัสผ่าน (แอปจัดการเอง)
--    ผู้ใช้คนแรก (admin) สร้างจากหน้า "ตั้งค่าครั้งแรก" ของแอป
-- ---------------------------------------------------------------------
CREATE TABLE users (
  -- id_user: ตัวพิมพ์เล็ก a-z 0-9 . _ - ยาว 3–32 ตัว เช่น somchai, emp01
  id                    TEXT    PRIMARY KEY
                                CHECK (length(id) BETWEEN 3 AND 32 AND id NOT GLOB '*[^a-z0-9._-]*'),
  display_name          TEXT    NOT NULL DEFAULT ''
                                CHECK (display_name = trim(display_name) AND length(display_name) <= 100),
  employee_id           TEXT    REFERENCES employees(id) ON UPDATE RESTRICT ON DELETE SET NULL,
  role                  TEXT    NOT NULL DEFAULT 'staff'
                                CHECK (role IN ('admin', 'supervisor', 'staff', 'viewer')),
  active                INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  -- รูปแบบ: pbkdf2-sha256$<รอบ>$<salt base64url>$<hash base64url> (ไม่มีการเก็บรหัสผ่านจริง)
  password_hash         TEXT    NOT NULL CHECK (password_hash GLOB 'pbkdf2-sha256$*$*$*'),
  must_change_password  INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1)),
  failed_logins         INTEGER NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
  locked_until          TEXT,    -- ใส่รหัสผิดเกินกำหนด ล็อกถึงเวลานี้ (UTC)
  last_login_at         TEXT,
  password_changed_at   TEXT,
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT, WITHOUT ROWID;
CREATE INDEX users_employee_idx ON users (employee_id);

-- session ที่ login อยู่ — cookie เก็บ token สุ่ม, ตารางเก็บแค่ SHA-256 ของ token
CREATE TABLE sessions (
  token_hash    TEXT    PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id       TEXT    NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at    TEXT    NOT NULL,
  last_seen_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  user_agent    TEXT    NOT NULL DEFAULT ''
) STRICT, WITHOUT ROWID;
CREATE INDEX sessions_user_idx    ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- จำกัดจำนวนครั้งที่ลอง login ต่อ IP (กันการเดารหัสผ่าน)
CREATE TABLE login_throttle (
  ip            TEXT    PRIMARY KEY,
  window_start  TEXT    NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
) STRICT, WITHOUT ROWID;


-- ---------------------------------------------------------------------
-- 4. ตรวจรถ — 1 แถว = รถ 1 คัน / 1 วัน (ชีต DATA รถ)
-- ---------------------------------------------------------------------
CREATE TABLE vehicle_inspections (
  id               TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  inspect_date     TEXT    NOT NULL CHECK (date(inspect_date) IS inspect_date),          -- DATA รถ!A
  month            TEXT    GENERATED ALWAYS AS (substr(inspect_date, 1, 7)) VIRTUAL,    -- DATA รถ!B
  inspect_time     TEXT    CHECK (inspect_time IS NULL
                                  OR strftime('%H:%M', inspect_time) IS inspect_time
                                  OR strftime('%H:%M:%S', inspect_time) IS inspect_time), -- DATA รถ!G
                                  -- ใช้ IS ไม่ใช่ = เพราะ CHECK ที่ได้ NULL ถือว่าผ่าน (ค่าผิดรูปแบบจะหลุด)
  vehicle_id       TEXT    NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,          -- DATA รถ!E
  mileage          INTEGER CHECK (mileage IS NULL OR mileage BETWEEN 0 AND 9999999),     -- DATA รถ!F
  dman_id          TEXT    NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,         -- DATA รถ!C
  helper1_id       TEXT    REFERENCES employees(id) ON DELETE RESTRICT,
  helper2_id       TEXT    REFERENCES employees(id) ON DELETE RESTRICT,
  declared_result  INTEGER CHECK (declared_result IN (1, 2)),   -- DATA รถ!I ผลตรวจที่ D-Man ติ๊กบนกระดาษ
  line_photo_sent  INTEGER CHECK (line_photo_sent IN (1, 2)),   -- DATA รถ!H ส่งภาพ LINE 1/2
  note             TEXT    NOT NULL DEFAULT '',                  -- DATA รถ!J ข้อบกพร่อง/หมายเหตุ
  source           TEXT    NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'paper', 'import')),
  approved_by      TEXT    REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT, -- ลงชื่อหัวหน้า
  approved_at      TEXT,
  created_by       TEXT    REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  updated_by       TEXT    REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT vehicle_inspections_day_vehicle_uq UNIQUE (inspect_date, vehicle_id),
  -- D-Man / Helper 1 / Helper 2 ต้องเป็นคนละคน
  CONSTRAINT vehicle_inspections_crew_distinct CHECK (
        (helper1_id IS NULL OR helper1_id <> dman_id)
    AND (helper2_id IS NULL OR helper2_id <> dman_id)
    AND (helper1_id IS NULL OR helper2_id IS NULL OR helper1_id <> helper2_id)
  ),
  -- มี Helper 2 ได้ก็ต่อเมื่อมี Helper 1
  CONSTRAINT vehicle_inspections_helper_order CHECK (helper2_id IS NULL OR helper1_id IS NOT NULL),
  CONSTRAINT vehicle_inspections_approval_pair CHECK ((approved_by IS NULL) = (approved_at IS NULL))
) STRICT;
CREATE INDEX vehicle_inspections_vehicle_idx ON vehicle_inspections (vehicle_id, inspect_date);
CREATE INDEX vehicle_inspections_dman_idx    ON vehicle_inspections (dman_id, inspect_date);
CREATE INDEX vehicle_inspections_helper1_idx ON vehicle_inspections (helper1_id);
CREATE INDEX vehicle_inspections_helper2_idx ON vehicle_inspections (helper2_id);

-- ผลรายข้อ (DATA รถ!K:AG) — ข้อที่ยังไม่คีย์ = ไม่มีแถว
CREATE TABLE vehicle_inspection_results (
  inspection_id  TEXT    NOT NULL REFERENCES vehicle_inspections(id) ON DELETE CASCADE,
  item_no        INTEGER NOT NULL REFERENCES check_items(item_no) ON DELETE RESTRICT,
  result         INTEGER NOT NULL CHECK (result IN (1, 2, 3)),
  remark         TEXT    NOT NULL DEFAULT '',     -- รายละเอียดข้อบกพร่องของข้อนี้ (ถ้ามี)
  PRIMARY KEY (inspection_id, item_no)
) STRICT, WITHOUT ROWID;
CREATE INDEX vehicle_inspection_results_item_idx ON vehicle_inspection_results (item_no, result);

-- รูปถ่ายใน R2 (แทน "ส่งภาพ LINE")
CREATE TABLE vehicle_inspection_photos (
  inspection_id  TEXT    NOT NULL REFERENCES vehicle_inspections(id) ON DELETE CASCADE,
  slot           TEXT    NOT NULL REFERENCES photo_slots(code) ON DELETE RESTRICT,
  r2_key         TEXT    NOT NULL UNIQUE CHECK (length(r2_key) BETWEEN 1 AND 512),  -- key ใน bucket R2
  content_type   TEXT    NOT NULL DEFAULT 'image/jpeg'
                         CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes     INTEGER CHECK (size_bytes IS NULL OR size_bytes BETWEEN 1 AND 5242880),  -- ≤ 5 MB
  uploaded_by    TEXT    REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  uploaded_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (inspection_id, slot)
) STRICT, WITHOUT ROWID;
CREATE INDEX vehicle_inspection_photos_slot_idx ON vehicle_inspection_photos (slot);


-- ---------------------------------------------------------------------
-- 5. ตรวจ PPE — 1 แถว = พนักงาน 1 คน / 1 วัน (ชีต DATA PPE)
-- ---------------------------------------------------------------------
CREATE TABLE ppe_inspections (
  id                     TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  inspect_date           TEXT    NOT NULL CHECK (date(inspect_date) IS inspect_date),        -- DATA PPE!A
  month                  TEXT    GENERATED ALWAYS AS (substr(inspect_date, 1, 7)) VIRTUAL,  -- DATA PPE!B
  employee_id            TEXT    NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,       -- DATA PPE!C
  inspector_id           TEXT    NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,       -- DATA PPE!G ผู้ตรวจ D-Man
  vehicle_id             TEXT    REFERENCES vehicles(id) ON DELETE RESTRICT,                 -- DATA PPE!F
  vehicle_inspection_id  TEXT    REFERENCES vehicle_inspections(id) ON DELETE SET NULL,      -- ใบตรวจรถคันเดียวกัน (ถ้ามี)
  note                   TEXT    NOT NULL DEFAULT '',                                         -- PRINT!F หมายเหตุ
  source                 TEXT    NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'paper', 'import')),
  approved_by            TEXT    REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  approved_at            TEXT,
  created_by             TEXT    REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  updated_by             TEXT    REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at             TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at             TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT ppe_inspections_day_employee_uq UNIQUE (inspect_date, employee_id),
  CONSTRAINT ppe_inspections_approval_pair CHECK ((approved_by IS NULL) = (approved_at IS NULL))
) STRICT;
CREATE INDEX ppe_inspections_employee_idx  ON ppe_inspections (employee_id, inspect_date);
CREATE INDEX ppe_inspections_inspector_idx ON ppe_inspections (inspector_id, inspect_date);
CREATE INDEX ppe_inspections_vehicle_idx   ON ppe_inspections (vehicle_id, inspect_date);
CREATE INDEX ppe_inspections_vi_idx        ON ppe_inspections (vehicle_inspection_id);

-- ผล PPE รายชิ้น (DATA PPE!H:K)
CREATE TABLE ppe_inspection_results (
  ppe_inspection_id  TEXT    NOT NULL REFERENCES ppe_inspections(id) ON DELETE CASCADE,
  ppe_code           TEXT    NOT NULL REFERENCES ppe_items(code) ON DELETE RESTRICT,
  result             INTEGER NOT NULL CHECK (result IN (1, 2)),
  PRIMARY KEY (ppe_inspection_id, ppe_code)
) STRICT, WITHOUT ROWID;
CREATE INDEX ppe_inspection_results_code_idx ON ppe_inspection_results (ppe_code, result);


-- ---------------------------------------------------------------------
-- 6. Audit log (Worker เขียนใน db.batch() เดียวกับการบันทึก)
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY,
  at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor        TEXT,                       -- id_user (ไม่ทำ FK เพื่อให้ log อยู่ต่อแม้ลบผู้ใช้)
  action       TEXT    NOT NULL CHECK (action IN ('create', 'update', 'delete', 'approve', 'unapprove', 'import',
                                                  'login', 'logout', 'password_change', 'password_reset')),
  entity       TEXT    NOT NULL,           -- ชื่อตาราง เช่น vehicle_inspections
  entity_id    TEXT    NOT NULL,
  detail       TEXT    CHECK (detail IS NULL OR json_valid(detail))   -- JSON ก่อน/หลัง
) STRICT;
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id, at);
CREATE INDEX audit_log_at_idx     ON audit_log (at);


-- ---------------------------------------------------------------------
-- 7. Triggers: updated_at อัตโนมัติ
--    (ทำงานเฉพาะเมื่อคำสั่ง UPDATE ไม่ได้ตั้ง updated_at มาเอง)
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_employees_touch AFTER UPDATE ON employees FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE employees SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER trg_vehicles_touch AFTER UPDATE ON vehicles FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE vehicles SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER trg_check_items_touch AFTER UPDATE ON check_items FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE check_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE item_no = NEW.item_no;
END;

CREATE TRIGGER trg_ppe_items_touch AFTER UPDATE ON ppe_items FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE ppe_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = NEW.code;
END;

CREATE TRIGGER trg_users_touch AFTER UPDATE ON users FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER trg_vehicle_inspections_touch AFTER UPDATE ON vehicle_inspections FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE vehicle_inspections SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER trg_ppe_inspections_touch AFTER UPDATE ON ppe_inspections FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE ppe_inspections SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;


-- ---------------------------------------------------------------------
-- 8. Triggers: ความสอดคล้องระหว่างใบ PPE กับใบตรวจรถ
--    ถ้าผูก vehicle_inspection_id ไว้ วันที่และรถต้องตรงกัน
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_ppe_vi_match_ins BEFORE INSERT ON ppe_inspections FOR EACH ROW
WHEN NEW.vehicle_inspection_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM vehicle_inspections v
  WHERE v.id = NEW.vehicle_inspection_id
    AND v.inspect_date = NEW.inspect_date
    AND v.vehicle_id IS NEW.vehicle_id)
BEGIN
  SELECT RAISE(ABORT, 'PPE_VEHICLE_MISMATCH: vehicle_inspection_id must have the same date and vehicle');
END;

CREATE TRIGGER trg_ppe_vi_match_upd BEFORE UPDATE OF vehicle_inspection_id, inspect_date, vehicle_id ON ppe_inspections FOR EACH ROW
WHEN NEW.vehicle_inspection_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM vehicle_inspections v
  WHERE v.id = NEW.vehicle_inspection_id
    AND v.inspect_date = NEW.inspect_date
    AND v.vehicle_id IS NEW.vehicle_id)
BEGIN
  SELECT RAISE(ABORT, 'PPE_VEHICLE_MISMATCH: vehicle_inspection_id must have the same date and vehicle');
END;

-- ถ้าใบตรวจรถถูกแก้วันที่/รถ ใบ PPE ที่ผูกอยู่ต้องไม่ขัดกัน
CREATE TRIGGER trg_vi_ppe_match_upd BEFORE UPDATE OF inspect_date, vehicle_id ON vehicle_inspections FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM ppe_inspections p
  WHERE p.vehicle_inspection_id = NEW.id
    AND (p.inspect_date <> NEW.inspect_date OR p.vehicle_id IS NOT NEW.vehicle_id))
BEGIN
  SELECT RAISE(ABORT, 'PPE_VEHICLE_MISMATCH: linked PPE inspections have a different date or vehicle');
END;


-- ---------------------------------------------------------------------
-- 9. Triggers: ล็อกเอกสารที่หัวหน้าเซ็นแล้ว (approved_at IS NOT NULL)
--    แก้/ลบไม่ได้จนกว่าจะยกเลิกอนุมัติ (UPDATE ... SET approved_by = NULL, approved_at = NULL)
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_vi_lock_update BEFORE UPDATE ON vehicle_inspections FOR EACH ROW
WHEN OLD.approved_at IS NOT NULL AND NEW.approved_at IS NOT NULL AND (
     NEW.inspect_date    IS NOT OLD.inspect_date
  OR NEW.inspect_time    IS NOT OLD.inspect_time
  OR NEW.vehicle_id      IS NOT OLD.vehicle_id
  OR NEW.mileage         IS NOT OLD.mileage
  OR NEW.dman_id         IS NOT OLD.dman_id
  OR NEW.helper1_id      IS NOT OLD.helper1_id
  OR NEW.helper2_id      IS NOT OLD.helper2_id
  OR NEW.declared_result IS NOT OLD.declared_result
  OR NEW.line_photo_sent IS NOT OLD.line_photo_sent
  OR NEW.note            IS NOT OLD.note
  OR NEW.source          IS NOT OLD.source)
BEGIN
  SELECT RAISE(ABORT, 'LOCKED: vehicle inspection is approved');
END;

CREATE TRIGGER trg_vi_lock_delete BEFORE DELETE ON vehicle_inspections FOR EACH ROW
WHEN OLD.approved_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'LOCKED: vehicle inspection is approved');
END;

CREATE TRIGGER trg_vir_lock_insert BEFORE INSERT ON vehicle_inspection_results FOR EACH ROW
WHEN (SELECT approved_at FROM vehicle_inspections WHERE id = NEW.inspection_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'LOCKED: vehicle inspection is approved');
END;

CREATE TRIGGER trg_vir_lock_update BEFORE UPDATE ON vehicle_inspection_results FOR EACH ROW
WHEN (SELECT approved_at FROM vehicle_inspections WHERE id = OLD.inspection_id) IS NOT NULL
  OR (SELECT approved_at FROM vehicle_inspections WHERE id = NEW.inspection_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'LOCKED: vehicle inspection is approved');
END;

CREATE TRIGGER trg_vir_lock_delete BEFORE DELETE ON vehicle_inspection_results FOR EACH ROW
WHEN (SELECT approved_at FROM vehicle_inspections WHERE id = OLD.inspection_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'LOCKED: vehicle inspection is approved');
END;

CREATE TRIGGER trg_vip_lock_insert BEFORE INSERT ON vehicle_inspection_photos FOR EACH ROW
WHEN (SELECT approved_at FROM vehicle_inspections WHERE id = NEW.inspection_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'LOCKED: vehicle inspection is approved');
END;

CREATE TRIGGER trg_vip_lock_update BEFORE UPDATE ON vehicle_inspection_photos FOR EACH ROW
WHEN (SELECT approved_at FROM vehicle_inspections WHERE id = OLD.inspection_id) IS NOT NULL
  OR (SELECT approved_at FROM vehicle_inspections WHERE id = NEW.inspection_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'LOCKED: vehicle inspection is approved');
END;

CREATE TRIGGER trg_vip_lock_delete BEFORE DELETE ON vehicle_inspection_photos FOR EACH ROW
WHEN (SELECT approved_at FROM vehicle_inspections WHERE id = OLD.inspection_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'LOCKED: vehicle inspection is approved');
END;

CREATE TRIGGER trg_pi_lock_update BEFORE UPDATE ON ppe_inspections FOR EACH ROW
WHEN OLD.approved_at IS NOT NULL AND NEW.approved_at IS NOT NULL AND (
     NEW.inspect_date IS NOT OLD.inspect_date
  OR NEW.employee_id  IS NOT OLD.employee_id
  OR NEW.inspector_id IS NOT OLD.inspector_id
  OR NEW.vehicle_id   IS NOT OLD.vehicle_id
  OR NEW.note         IS NOT OLD.note
  OR NEW.source       IS NOT OLD.source)
BEGIN
  SELECT RAISE(ABORT, 'LOCKED: PPE inspection is approved');
END;

CREATE TRIGGER trg_pi_lock_delete BEFORE DELETE ON ppe_inspections FOR EACH ROW
WHEN OLD.approved_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'LOCKED: PPE inspection is approved');
END;

CREATE TRIGGER trg_pir_lock_insert BEFORE INSERT ON ppe_inspection_results FOR EACH ROW
WHEN (SELECT approved_at FROM ppe_inspections WHERE id = NEW.ppe_inspection_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'LOCKED: PPE inspection is approved');
END;

CREATE TRIGGER trg_pir_lock_update BEFORE UPDATE ON ppe_inspection_results FOR EACH ROW
WHEN (SELECT approved_at FROM ppe_inspections WHERE id = OLD.ppe_inspection_id) IS NOT NULL
  OR (SELECT approved_at FROM ppe_inspections WHERE id = NEW.ppe_inspection_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'LOCKED: PPE inspection is approved');
END;

CREATE TRIGGER trg_pir_lock_delete BEFORE DELETE ON ppe_inspection_results FOR EACH ROW
WHEN (SELECT approved_at FROM ppe_inspections WHERE id = OLD.ppe_inspection_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'LOCKED: PPE inspection is approved');
END;
