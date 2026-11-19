-- =====================================================================
-- 0016: "ไม่อนุมัติ" (reject) for vehicle checks
--   rejected_at / rejected_by / reject_reason — set by an admin with a reason.
--   A check is either รออนุมัติ (both empty), อนุมัติแล้ว (approved_at) or ไม่อนุมัติ (rejected_at) — never both.
--   Staff fixing and re-sending a rejected check clears the rejection (back to รออนุมัติ);
--   every reject / approve is also kept in audit_log.
-- =====================================================================
ALTER TABLE vehicle_inspections ADD COLUMN rejected_at   TEXT;
ALTER TABLE vehicle_inspections ADD COLUMN rejected_by   TEXT REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE vehicle_inspections ADD COLUMN reject_reason TEXT NOT NULL DEFAULT ''
  CHECK (reject_reason = trim(reject_reason) AND length(reject_reason) <= 500);

-- a rejection needs a time and a reason; it cannot sit next to an approval
CREATE TRIGGER trg_vi_reject_ins BEFORE INSERT ON vehicle_inspections
WHEN (NEW.rejected_at IS NOT NULL AND (NEW.approved_at IS NOT NULL OR NEW.reject_reason = ''))
  OR (NEW.rejected_at IS NULL AND NEW.reject_reason <> '')
BEGIN
  SELECT RAISE(ABORT, 'REJECT_STATE: rejected needs a reason and cannot also be approved');
END;

CREATE TRIGGER trg_vi_reject_upd BEFORE UPDATE OF rejected_at, reject_reason, approved_at ON vehicle_inspections
WHEN (NEW.rejected_at IS NOT NULL AND (NEW.approved_at IS NOT NULL OR NEW.reject_reason = ''))
  OR (NEW.rejected_at IS NULL AND NEW.reject_reason <> '')
BEGIN
  SELECT RAISE(ABORT, 'REJECT_STATE: rejected needs a reason and cannot also be approved');
END;
