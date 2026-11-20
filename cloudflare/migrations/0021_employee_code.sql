-- รหัสพนักงานจริงของบริษัท (เช่น 650123) — แยกจาก employees.id (EMP01) ที่ใช้อ้างอิงภายในระบบ
-- ภายหลังจะใช้รหัสนี้ login แทนชื่อผู้ใช้ จึงต้องไม่ซ้ำกัน (ว่างได้ ระหว่างที่ยังกรอกไม่ครบ)
-- ตัวอักษรภาษาอังกฤษพิมพ์ใหญ่ / ตัวเลข / - ยาว 1–20 ตัว (Worker แปลงเป็นพิมพ์ใหญ่และตัดช่องว่างให้ก่อนบันทึก)
ALTER TABLE employees ADD COLUMN emp_code TEXT
  CHECK (emp_code IS NULL OR (length(emp_code) BETWEEN 1 AND 20 AND emp_code = upper(trim(emp_code)) AND emp_code NOT GLOB '*[^A-Z0-9-]*'));

CREATE UNIQUE INDEX employees_emp_code_uq ON employees(emp_code) WHERE emp_code IS NOT NULL;
