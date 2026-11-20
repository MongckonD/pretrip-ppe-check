-- =====================================================================
-- 0019: drop views of the removed "ประเภทพื้นที่" (area types) feature
--   Time activities no longer records areas, so these two report views are always empty.
--   (The area_types / trip_activity_areas tables stay for now.)
-- =====================================================================
DROP VIEW IF EXISTS v_trip_area_results;
DROP VIEW IF EXISTS v_trip_area_monthly;
