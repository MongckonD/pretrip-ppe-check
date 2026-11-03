-- =====================================================================
-- สถานะ: เตรียมไว้ ยังไม่ได้รัน (รันต่อจาก 20261103000000_init.sql)
-- Daily views: สถานะการตรวจทุกอย่างรายวัน
--   v_daily_vehicle_status  1 แถว = รถ 1 คัน / 1 วัน (รวมคันที่ยังไม่ได้ตรวจ)
--   v_daily_ppe_status      1 แถว = พนักงาน 1 คน / 1 วัน (รวมคนที่ยังไม่ได้ตรวจ)
--   v_daily_summary         1 แถว = 1 วัน
-- "ที่ต้องตรวจ" = รถ/พนักงานที่ active ตอนนี้ + รายการที่มีบันทึกจริงในวันนั้น
-- ช่วงวัน = ตั้งแต่วันแรกที่มีบันทึก ถึงวันนี้
-- =====================================================================

create or replace view public.v_daily_vehicle_status
with (security_invoker = true) as
with bounds as (
  select coalesce(min(d), current_date) as first_day from (
    select inspect_date as d from public.vehicle_inspections
    union all select inspect_date from public.ppe_inspections
  ) x
),
days as (
  select g::date as day from bounds, generate_series(bounds.first_day, current_date, interval '1 day') g
),
keys as (
  select days.day, v.plate from days cross join public.vehicles v where v.active
  union
  select inspect_date, plate from public.vehicle_inspections
)
select
  k.day,
  to_char(k.day, 'YYYY-MM')                                        as month,
  k.plate,
  (v.id is not null)                                               as registered,
  s.id                                                             as inspection_id,
  s.inspect_time,
  s.dman_id,
  coalesce(s.filled_count, 0)                                      as filled_count,
  coalesce(s.fail_count, 0)                                        as fail_count,
  coalesce(s.photo_count, 0)                                       as photo_count,
  coalesce(s.photo_status, 0)                                      as photo_status,
  coalesce(array(
    select r.item_no from public.vehicle_inspection_results r
    where r.inspection_id = s.id and r.result = 2 order by r.item_no
  ), '{}')                                                         as fail_items,
  case when s.id is null then 0 when s.fail_count > 0 then 2 else 1 end as status  -- 0 ยังไม่ตรวจ 1 ผ่าน 2 ไม่ผ่าน
from keys k
left join public.v_vehicle_inspection_summary s on s.inspect_date = k.day and s.plate = k.plate
left join public.vehicles v on v.plate = k.plate;

create or replace view public.v_daily_ppe_status
with (security_invoker = true) as
with bounds as (
  select coalesce(min(d), current_date) as first_day from (
    select inspect_date as d from public.vehicle_inspections
    union all select inspect_date from public.ppe_inspections
  ) x
),
days as (
  select g::date as day from bounds, generate_series(bounds.first_day, current_date, interval '1 day') g
),
keys as (
  select days.day, e.id as employee_id from days cross join public.employees e where e.active
  union
  select inspect_date, employee_id from public.ppe_inspections
)
select
  k.day,
  to_char(k.day, 'YYYY-MM')                                        as month,
  k.employee_id,
  s.id                                                             as ppe_inspection_id,
  s.inspector_id,
  s.plate,
  coalesce(s.missing_count, 0)                                     as missing_count,
  coalesce(array(
    select r.ppe_code from public.ppe_inspection_results r
    where r.ppe_inspection_id = s.id and r.result = 2 order by r.ppe_code
  ), '{}')                                                         as missing_items,
  coalesce(s.status, 'ยังไม่ตรวจ')                                  as status
from keys k
left join public.v_ppe_inspection_summary s on s.inspect_date = k.day and s.employee_id = k.employee_id;

create or replace view public.v_daily_summary
with (security_invoker = true) as
select
  coalesce(v.day, p.day)                                           as day,
  to_char(coalesce(v.day, p.day), 'YYYY-MM')                       as month,
  coalesce(v.total, 0)                                             as vehicles_total,
  coalesce(v.checked, 0)                                           as vehicles_checked,
  coalesce(v.failed, 0)                                            as vehicles_failed,
  coalesce(v.photo_complete, 0)                                    as vehicles_photo_complete,
  coalesce(p.total, 0)                                             as ppe_total,
  coalesce(p.checked, 0)                                           as ppe_checked,
  coalesce(p.complete, 0)                                          as ppe_complete
from (
  select day,
         count(*)                                   as total,
         count(*) filter (where status > 0)         as checked,
         count(*) filter (where status = 2)         as failed,
         count(*) filter (where photo_status = 1)   as photo_complete
  from public.v_daily_vehicle_status group by day
) v
full join (
  select day,
         count(*)                                         as total,
         count(*) filter (where status <> 'ยังไม่ตรวจ')    as checked,
         count(*) filter (where status = 'ครบ')           as complete
  from public.v_daily_ppe_status group by day
) p on p.day = v.day;
