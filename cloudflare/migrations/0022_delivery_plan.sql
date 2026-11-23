-- ร้านค้าที่ต้องส่ง (แผนส่งรายวันจาก SAP) — ตารางใหม่ทั้งหมด ไม่แตะตารางเดิม
--   stores          ร้านค้าหลัก จับคู่ด้วยรหัสลูกค้า SAP (Ship-to) · สร้างให้อัตโนมัติตอนนำเข้าแผน
--   delivery_plan   1 แถว = 1 ร้านใน 1 วัน (ร้านเดียวกันอยู่ได้รถคันเดียวต่อวัน)
--   delivery_bills  1 แถว = 1 บิล / Delivery No ของร้านนั้นในวันนั้น · ลังของร้าน = ผลรวมของบิล
-- ใช้เมื่อเปิดสวิตช์ FEATURE_STORE_DELIVERY เท่านั้น (Worker ตอบ 404 ถ้าปิด)

CREATE TABLE stores (
  id          TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  -- รหัส SAP: พิมพ์ใหญ่ ไม่มีช่องว่าง (Worker แปลงให้ก่อนบันทึก)
  sap_code    TEXT    NOT NULL UNIQUE CHECK (length(sap_code) BETWEEN 1 AND 30 AND sap_code = upper(sap_code) AND sap_code NOT GLOB '*[ ]*'),
  name        TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 200 AND name = trim(name)),
  -- ประเภทร้าน (รหัสจาก STORE_TYPES ใน src/lib/storeVisit.ts) ว่างได้
  store_type  TEXT    NOT NULL DEFAULT '' CHECK (length(store_type) <= 30),
  address     TEXT    NOT NULL DEFAULT '' CHECK (length(address) <= 500),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE delivery_plan (
  id          TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  plan_date   TEXT    NOT NULL CHECK (date(plan_date) IS plan_date),
  vehicle_id  TEXT    NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  store_id    TEXT    NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  -- ลำดับแถวในไฟล์ SAP (ร้านที่เพิ่มเองต่อท้าย) — ใช้เรียงอย่างเดียว ไม่แสดงและไม่ให้แก้
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT    REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- ร้านเดียวกันอยู่ได้รถคันเดียวต่อวัน
  CONSTRAINT delivery_plan_day_store_uq UNIQUE (plan_date, store_id)
) STRICT;
-- พนักงานอ่านเฉพาะรถตัวเองของวันนี้ / แอดมินอ่านทั้งวัน
CREATE INDEX delivery_plan_day_vehicle_idx ON delivery_plan (plan_date, vehicle_id, sort_order);

CREATE TABLE delivery_bills (
  id          TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  plan_id     TEXT    NOT NULL REFERENCES delivery_plan(id) ON DELETE CASCADE,
  -- เลขที่บิล / Delivery No (ว่างได้ ถ้าไฟล์ไม่มี)
  bill_no     TEXT    NOT NULL DEFAULT '' CHECK (length(bill_no) <= 40 AND bill_no = trim(bill_no)),
  cases       INTEGER CHECK (cases IS NULL OR cases BETWEEN 0 AND 100000)
) STRICT;
CREATE INDEX delivery_bills_plan_idx ON delivery_bills (plan_id);
-- บิลเดียวกันของร้านเดียวกันไม่ซ้ำ (นำเข้าไฟล์เดิมซ้ำแล้วไม่นับลังสองรอบ)
CREATE UNIQUE INDEX delivery_bills_plan_bill_uq ON delivery_bills (plan_id, bill_no) WHERE bill_no <> '';
