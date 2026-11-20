-- =====================================================================
-- Remove the SAMPLE data loaded on 2026-11-19 (15 days of November 2026).
-- Every sample row has an id starting with "demo-" (and note = 'ข้อมูลตัวอย่าง', source = 'import');
-- real records are not touched.
--
-- Approved sample checks are final + locked, so the "approval is final" trigger (0017) is lifted
-- only for this cleanup and restored at the end (same definition as migration 0017).
--
-- Run:  npx wrangler d1 execute pretrip-ppe --remote --file docs/demo-data-cleanup.sql
-- =====================================================================
DROP TRIGGER IF EXISTS trg_vi_approval_final;

UPDATE vehicle_inspections
   SET approved_at = NULL, approved_by = NULL, rejected_at = NULL, rejected_by = NULL, reject_reason = ''
 WHERE id LIKE 'demo-%';

DELETE FROM ppe_inspection_results WHERE ppe_inspection_id LIKE 'demo-%';
DELETE FROM ppe_inspections        WHERE id LIKE 'demo-%';
DELETE FROM trip_activities        WHERE id LIKE 'demo-%';
DELETE FROM vehicle_inspection_results WHERE inspection_id LIKE 'demo-%';
DELETE FROM vehicle_inspections    WHERE id LIKE 'demo-%';

CREATE TRIGGER trg_vi_approval_final BEFORE UPDATE OF approved_at, approved_by ON vehicle_inspections
WHEN OLD.approved_at IS NOT NULL AND (NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by IS NOT OLD.approved_by)
BEGIN
  SELECT RAISE(ABORT, 'APPROVAL_FINAL: an approved vehicle check cannot be changed');
END;
