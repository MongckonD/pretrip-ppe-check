-- =====================================================================
-- 0017: อนุมัติแล้วแก้ไม่ได้ — a vehicle check's approval is final.
--   Once approved_at is set it can never be cleared or changed (no undo, no "ไม่อนุมัติ" afterwards).
--   Together with the LOCKED triggers from 0001 the approved check itself cannot be edited or deleted either.
-- =====================================================================
CREATE TRIGGER trg_vi_approval_final BEFORE UPDATE OF approved_at, approved_by ON vehicle_inspections
WHEN OLD.approved_at IS NOT NULL AND (NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by IS NOT OLD.approved_by)
BEGIN
  SELECT RAISE(ABORT, 'APPROVAL_FINAL: an approved vehicle check cannot be changed');
END;
