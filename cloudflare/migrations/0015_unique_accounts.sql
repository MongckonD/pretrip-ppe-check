-- =====================================================================
-- 0015: ห้ามข้อมูลบัญชีซ้ำ
--   1. พนักงาน 1 คน ผูกได้กับบัญชีผู้ใช้เดียว (users.employee_id ไม่ซ้ำ, ว่างได้หลายบัญชี)
--   2. เลขที่ใบขับขี่ปัจจุบัน 1 เลข อยู่ได้กับบัญชีเดียว (ใบเก่าที่ถูกแทนที่แล้วไม่นับ)
-- ถ้ามีข้อมูลซ้ำค้างอยู่ migration นี้จะไม่ผ่าน — ต้องแก้ข้อมูลก่อน
-- =====================================================================
DROP INDEX IF EXISTS users_employee_idx;
CREATE UNIQUE INDEX users_employee_uq ON users (employee_id) WHERE employee_id IS NOT NULL;

CREATE UNIQUE INDEX driver_licenses_no_uq ON driver_licenses (license_no) WHERE replaced_at IS NULL;
