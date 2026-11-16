-- =====================================================================
-- 0004: สิทธิ์ผู้ใช้เหลือ 2 แบบ
--   admin = ทุกอย่าง (ตั้งค่า, จัดการผู้ใช้, อนุมัติ)
--   user  = พนักงานทุกคน (บันทึกการตรวจรถ / PPE, ดูข้อมูล)
-- รหัสผ่านที่ admin ตั้งให้ใช้ได้เลย ไม่บังคับเปลี่ยน (must_change_password = 0)
--
-- SQLite แก้ CHECK ของคอลัมน์ไม่ได้ จึงสร้างตาราง users ใหม่แล้วคัดลอกข้อมูล
--   supervisor / staff / viewer → user,  admin → admin
-- ผลข้างเคียง: session ทั้งหมดถูกลบ (ทุกคนต้อง login ใหม่ 1 ครั้ง)
--
-- กันพลาด: การ DROP ตาราง users จะทำให้ created_by / updated_by ของบันทึกเดิมกลายเป็น NULL
-- จึงหยุด migration ทันทีถ้ามีบันทึกที่อ้างถึงผู้ใช้อยู่แล้ว (ตอนรันครั้งแรกยังไม่มีบันทึกการตรวจ)
-- =====================================================================

CREATE TABLE _guard_0004 (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _guard_0004 (ok)
SELECT CASE WHEN EXISTS (SELECT 1 FROM vehicle_inspections
                         WHERE created_by IS NOT NULL OR updated_by IS NOT NULL OR approved_by IS NOT NULL)
              OR EXISTS (SELECT 1 FROM ppe_inspections
                         WHERE created_by IS NOT NULL OR updated_by IS NOT NULL OR approved_by IS NOT NULL)
              OR EXISTS (SELECT 1 FROM vehicle_inspection_photos WHERE uploaded_by IS NOT NULL)
            THEN 0 ELSE 1 END;
DROP TABLE _guard_0004;

PRAGMA defer_foreign_keys = on;

CREATE TABLE users_new (
  id                    TEXT    PRIMARY KEY
                                CHECK (length(id) BETWEEN 3 AND 32 AND id NOT GLOB '*[^a-z0-9._-]*'),
  display_name          TEXT    NOT NULL DEFAULT ''
                                CHECK (display_name = trim(display_name) AND length(display_name) <= 100),
  employee_id           TEXT    REFERENCES employees(id) ON UPDATE RESTRICT ON DELETE SET NULL,
  role                  TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  active                INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  password_hash         TEXT    NOT NULL CHECK (password_hash GLOB 'pbkdf2-sha256$*$*$*'),
  must_change_password  INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  failed_logins         INTEGER NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
  locked_until          TEXT,
  last_login_at         TEXT,
  password_changed_at   TEXT,
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT, WITHOUT ROWID;

INSERT INTO users_new (id, display_name, employee_id, role, active, password_hash, must_change_password,
                       failed_logins, locked_until, last_login_at, password_changed_at, created_at, updated_at)
SELECT id, display_name, employee_id,
       CASE WHEN role = 'admin' THEN 'admin' ELSE 'user' END,
       active, password_hash, 0,
       failed_logins, locked_until, last_login_at, password_changed_at, created_at, updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX users_employee_idx ON users (employee_id);

CREATE TRIGGER trg_users_touch AFTER UPDATE ON users FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
