-- =====================================================================
-- สถานะ: เตรียมไว้ ยังไม่ได้รัน
-- ตอนนี้ frontend ใช้โหมดทดสอบ (src/lib/api.mock.ts) ซึ่งจำลองตาราง/view/function ชุดนี้ไว้ในเบราว์เซอร์
-- เมื่อพร้อมใช้ backend จริง: รันไฟล์นี้ใน Supabase SQL Editor (หรือ `supabase start` + `supabase db reset`
-- บน Docker) แล้วใส่ค่าใน .env
-- =====================================================================
-- Pre-Trip PPE Check · Piyachart 54
-- PostgreSQL schema for Supabase
-- Result codes:  vehicle 1 = ผ่าน, 2 = ไม่ผ่าน, 3 = ไม่เกี่ยวข้อง (N/A)
--                PPE     1 = มี,   2 = ไม่มี
-- =====================================================================

-- ---------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------
create table public.employees (
  id          text primary key,                       -- e.g. EMP01
  name        text not null default '',
  role        text not null default '',                -- D-Man / Helper / ...
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.vehicles (
  id          uuid primary key default gen_random_uuid(),
  plate       text not null unique,                    -- ทะเบียนรถ
  type        text not null default '',                -- ประเภทรถ
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 23 vehicle checklist items (editable, but item_no is the stable key)
create table public.check_items (
  item_no     smallint primary key check (item_no between 1 and 99),
  name        text not null,
  hint        text not null default '',
  active      boolean not null default true
);

-- 4 PPE items
create table public.ppe_items (
  code        text primary key,                        -- shoes / vest / gloves / mask
  name        text not null,
  sort_order  smallint not null default 0,
  active      boolean not null default true
);

-- 6 required photo slots
create table public.photo_slots (
  code        text primary key,                        -- front / side / back / dash / cargo / ppe
  name        text not null,
  sort_order  smallint not null default 0
);

-- ---------------------------------------------------------------------
-- Vehicle inspection (1 row = 1 vehicle / 1 day)
-- ---------------------------------------------------------------------
create table public.vehicle_inspections (
  id            uuid primary key default gen_random_uuid(),
  inspect_date  date not null,
  inspect_time  time,
  dman_id       text not null references public.employees(id) on update cascade,
  helper1_id    text references public.employees(id) on update cascade,
  helper2_id    text references public.employees(id) on update cascade,
  plate         text not null,
  mileage       integer check (mileage is null or mileage >= 0),
  note          text not null default '',
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint vehicle_inspections_day_plate_uq unique (inspect_date, plate),
  -- D-Man / Helper 1 / Helper 2 must be different people
  constraint vehicle_inspections_crew_distinct check (
        (helper1_id is null or helper1_id <> dman_id)
    and (helper2_id is null or helper2_id <> dman_id)
    and (helper1_id is null or helper2_id is null or helper1_id <> helper2_id)
  )
);
create index vehicle_inspections_date_idx on public.vehicle_inspections (inspect_date);
create index vehicle_inspections_dman_idx on public.vehicle_inspections (dman_id, inspect_date);

create table public.vehicle_inspection_results (
  inspection_id uuid not null references public.vehicle_inspections(id) on delete cascade,
  item_no       smallint not null references public.check_items(item_no) on update cascade,
  result        smallint not null check (result in (1, 2, 3)),
  primary key (inspection_id, item_no)
);
create index vir_item_fail_idx on public.vehicle_inspection_results (item_no) where result = 2;

create table public.vehicle_inspection_photos (
  inspection_id uuid not null references public.vehicle_inspections(id) on delete cascade,
  slot          text not null references public.photo_slots(code),
  storage_path  text not null,                         -- path inside bucket "inspection-photos"
  created_at    timestamptz not null default now(),
  primary key (inspection_id, slot)
);

-- ---------------------------------------------------------------------
-- PPE inspection (1 row = 1 employee / 1 day)
-- ---------------------------------------------------------------------
create table public.ppe_inspections (
  id            uuid primary key default gen_random_uuid(),
  inspect_date  date not null,
  employee_id   text not null references public.employees(id) on update cascade,
  inspector_id  text not null references public.employees(id) on update cascade,
  plate         text not null default '',
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ppe_inspections_day_emp_uq unique (inspect_date, employee_id)
);
create index ppe_inspections_date_idx on public.ppe_inspections (inspect_date);

create table public.ppe_inspection_results (
  ppe_inspection_id uuid not null references public.ppe_inspections(id) on delete cascade,
  ppe_code          text not null references public.ppe_items(code) on update cascade,
  result            smallint not null check (result in (1, 2)),
  primary key (ppe_inspection_id, ppe_code)
);

-- ---------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

create trigger trg_employees_touch before update on public.employees
  for each row execute function public.touch_updated_at();
create trigger trg_vehicles_touch before update on public.vehicles
  for each row execute function public.touch_updated_at();
create trigger trg_vehicle_inspections_touch before update on public.vehicle_inspections
  for each row execute function public.touch_updated_at();
create trigger trg_ppe_inspections_touch before update on public.ppe_inspections
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Reporting views (one flat row per inspection, like the Admin BI sheet)
-- ---------------------------------------------------------------------
create or replace view public.v_vehicle_inspection_summary
with (security_invoker = true) as
select
  vi.*,
  to_char(vi.inspect_date, 'YYYY-MM')                              as month,
  coalesce(r.results, '{}'::jsonb)                                 as results,
  coalesce(p.photos,  '{}'::jsonb)                                 as photos,
  coalesce(r.pass_count, 0)                                        as pass_count,
  coalesce(r.fail_count, 0)                                        as fail_count,
  coalesce(r.na_count,   0)                                        as na_count,
  coalesce(r.filled,     0)                                        as filled_count,
  coalesce(p.photo_count, 0)                                       as photo_count,
  case when coalesce(r.filled, 0) = 0 then null
       when r.fail_count > 0 then 2 else 1 end                     as overall_result,
  case when coalesce(p.photo_count, 0) >= 6 then 1
       when coalesce(p.photo_count, 0) > 0 then 2 else 0 end       as photo_status
from public.vehicle_inspections vi
left join lateral (
  select jsonb_object_agg(item_no, result) as results,
         count(*) filter (where result = 1) as pass_count,
         count(*) filter (where result = 2) as fail_count,
         count(*) filter (where result = 3) as na_count,
         count(*)                           as filled
  from public.vehicle_inspection_results where inspection_id = vi.id
) r on true
left join lateral (
  select jsonb_object_agg(slot, storage_path) as photos, count(*) as photo_count
  from public.vehicle_inspection_photos where inspection_id = vi.id
) p on true;

create or replace view public.v_ppe_inspection_summary
with (security_invoker = true) as
select
  pi.*,
  to_char(pi.inspect_date, 'YYYY-MM')                              as month,
  coalesce(r.results, '{}'::jsonb)                                 as results,
  coalesce(r.have_count, 0)                                        as have_count,
  coalesce(r.missing_count, 0)                                     as missing_count,
  coalesce(r.filled, 0)                                            as filled_count,
  case when coalesce(r.filled, 0) < (select count(*) from public.ppe_items where active) then 'ไม่ครบ'
       when r.missing_count > 0 then 'อุปกรณ์ไม่ครบ'
       else 'ครบ' end                                               as status
from public.ppe_inspections pi
left join lateral (
  select jsonb_object_agg(ppe_code, result) as results,
         count(*) filter (where result = 1) as have_count,
         count(*) filter (where result = 2) as missing_count,
         count(*)                           as filled
  from public.ppe_inspection_results where ppe_inspection_id = pi.id
) r on true;

-- ---------------------------------------------------------------------
-- Atomic save functions (header + detail rows in one transaction)
-- ---------------------------------------------------------------------
-- p_results: {"1":1,"2":2,...}   p_photos: {"front":"2026-11/xxx.jpg",...}
create or replace function public.save_vehicle_inspection(
  p_id uuid, p_date date, p_time time, p_dman text, p_helper1 text, p_helper2 text,
  p_plate text, p_mileage integer, p_note text, p_results jsonb, p_photos jsonb
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  if p_id is not null then
    update vehicle_inspections set
      inspect_date = p_date, inspect_time = p_time, dman_id = p_dman,
      helper1_id = nullif(p_helper1, ''), helper2_id = nullif(p_helper2, ''),
      plate = trim(p_plate), mileage = p_mileage, note = coalesce(p_note, '')
    where id = p_id returning id into v_id;
  end if;
  if v_id is null then
    insert into vehicle_inspections (inspect_date, inspect_time, dman_id, helper1_id, helper2_id, plate, mileage, note)
    values (p_date, p_time, p_dman, nullif(p_helper1, ''), nullif(p_helper2, ''), trim(p_plate), p_mileage, coalesce(p_note, ''))
    on conflict (inspect_date, plate) do update set
      inspect_time = excluded.inspect_time, dman_id = excluded.dman_id,
      helper1_id = excluded.helper1_id, helper2_id = excluded.helper2_id,
      mileage = excluded.mileage, note = excluded.note
    returning id into v_id;
  end if;

  delete from vehicle_inspection_results where inspection_id = v_id;
  insert into vehicle_inspection_results (inspection_id, item_no, result)
  select v_id, key::smallint, value::smallint from jsonb_each_text(coalesce(p_results, '{}'::jsonb));

  delete from vehicle_inspection_photos where inspection_id = v_id;
  insert into vehicle_inspection_photos (inspection_id, slot, storage_path)
  select v_id, key, value from jsonb_each_text(coalesce(p_photos, '{}'::jsonb));

  return v_id;
end $$;

-- p_rows: {"EMP01":{"shoes":1,"vest":2,...}, ...}
create or replace function public.save_ppe_inspections(
  p_date date, p_plate text, p_inspector text, p_rows jsonb
) returns integer
language plpgsql security invoker set search_path = public as $$
declare r record; v_id uuid; n integer := 0;
begin
  for r in select key as emp, value as items from jsonb_each(p_rows) loop
    insert into ppe_inspections (inspect_date, employee_id, inspector_id, plate)
    values (p_date, r.emp, p_inspector, coalesce(p_plate, ''))
    on conflict (inspect_date, employee_id) do update set
      inspector_id = excluded.inspector_id, plate = excluded.plate
    returning id into v_id;

    delete from ppe_inspection_results where ppe_inspection_id = v_id;
    insert into ppe_inspection_results (ppe_inspection_id, ppe_code, result)
    select v_id, key, value::smallint from jsonb_each_text(r.items);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security: signed-in staff only
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['employees','vehicles','check_items','ppe_items','photo_slots',
    'vehicle_inspections','vehicle_inspection_results','vehicle_inspection_photos',
    'ppe_inspections','ppe_inspection_results']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%s read"  on public.%I for select to authenticated using (true)', t, t);
    execute format('create policy "%s write" on public.%I for all    to authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

grant execute on function public.save_vehicle_inspection(uuid,date,time,text,text,text,text,integer,text,jsonb,jsonb) to authenticated;
grant execute on function public.save_ppe_inspections(date,text,text,jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Storage bucket for photos (private; app uses signed URLs)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inspection-photos', 'inspection-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "photos read"   on storage.objects for select to authenticated using (bucket_id = 'inspection-photos');
create policy "photos insert" on storage.objects for insert to authenticated with check (bucket_id = 'inspection-photos');
create policy "photos update" on storage.objects for update to authenticated using (bucket_id = 'inspection-photos');
create policy "photos delete" on storage.objects for delete to authenticated using (bucket_id = 'inspection-photos');

-- ---------------------------------------------------------------------
-- Seed: checklist / PPE / photo slots
-- ---------------------------------------------------------------------
insert into public.check_items (item_no, name, hint) values
 (1,'ยางรถยนต์','ยางทุกล้อไม่แบน บวม หรือแตกร้าว'),
 (2,'ล้อและนอตล้อ','นอตครบ ไม่พบรอยหลวม/ชำรุด'),
 (3,'กระจกหน้า/ข้าง','ไม่แตกหรือบดบังทัศนวิสัย'),
 (4,'ไฟหน้า/ท้าย','เปิดตรวจไฟทุกดวง'),
 (5,'ไฟเลี้ยว/ฉุกเฉิน','เปิดตรวจไฟทุกดวง'),
 (6,'ไฟเบรก','ให้ผู้ช่วยดูไฟขณะเหยียบเบรก'),
 (7,'ตัวถังและประตู','ไม่มีชิ้นส่วนหลุด ประตูล็อกได้'),
 (8,'การรั่วซึมใต้รถ','ดูใต้รถไม่มีรั่วซึมผิดปกติ'),
 (9,'น้ำมันเครื่อง','ตรวจระดับตามคู่มือรถ'),
 (10,'น้ำหล่อเย็น','ตรวจถังพักขณะเครื่องเย็น'),
 (11,'น้ำมันเบรก','ตรวจระดับตามคู่มือรถ'),
 (12,'ระบบเบรก','เหยียบขณะจอด แรงต้านปกติ'),
 (13,'เบรกมือ','ทดลองล็อกและปลดขณะจอด'),
 (14,'พวงมาลัย','ไม่มีเสียงหรืออาการผิดปกติ'),
 (15,'แตรรถ','กดแล้วมีเสียง'),
 (16,'ที่ปัดน้ำฝน','ทดลองปัดและฉีดน้ำ'),
 (17,'เข็มขัดนิรภัย','ทดลองล็อกและปลด'),
 (18,'ไฟเตือนหน้าปัด','ไม่มีไฟเตือนด้านความปลอดภัยค้าง'),
 (19,'ถังดับเพลิง','มีและพร้อมใช้งาน'),
 (20,'ป้ายสามเหลี่ยม','มีและพร้อมใช้งาน'),
 (21,'ประตูบรรทุกสินค้า','เปิดปิดและล็อกได้'),
 (22,'การจัดเรียงสินค้า','สินค้ามั่นคง ไม่เสี่ยงล้ม'),
 (23,'รถเข็นสินค้า','มีและพร้อมใช้งาน');

insert into public.ppe_items (code, name, sort_order) values
 ('shoes','รองเท้านิรภัย',1), ('vest','เสื้อสะท้อนแสง',2), ('gloves','ถุงมือ',3), ('mask','หน้ากากอนามัย',4);

insert into public.photo_slots (code, name, sort_order) values
 ('front','หน้า',1), ('side','ข้าง',2), ('back','หลัง',3), ('dash','หน้าปัด',4), ('cargo','สินค้า',5), ('ppe','PPE',6);

insert into public.employees (id) values ('EMP01'),('EMP02'),('EMP03'),('EMP04'),('EMP05'),('EMP06');
