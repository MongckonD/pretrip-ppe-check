/**
 * Backend implementation: Supabase (PostgreSQL + Storage).
 * ยังไม่เปิดใช้ — จะถูกใช้อัตโนมัติเมื่อมีค่า VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ใน .env
 * ระหว่างนี้แอปใช้ api.mock.ts (เก็บข้อมูลในเบราว์เซอร์) แทน — ดู api.ts
 */
import { supabase, PHOTO_BUCKET } from './supabase';
import type {
  DailyPpeStatus, DailySummary, DailyVehicleStatus,
  Employee, Master, PpeForm, PpeInspection, Vehicle, VehicleForm, VehicleInspection,
} from './types';
import { monthRange } from './utils';

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

/* ---------- master ---------- */
export async function loadMaster(): Promise<Master> {
  const [employees, vehicles, checkItems, ppeItems, photoSlots] = await Promise.all([
    supabase.from('employees').select('id,name,role,active').order('id'),
    supabase.from('vehicles').select('id,plate,type,active').order('plate'),
    supabase.from('check_items').select('item_no,name,hint,active').order('item_no'),
    supabase.from('ppe_items').select('code,name,sort_order,active').order('sort_order'),
    supabase.from('photo_slots').select('code,name,sort_order').order('sort_order'),
  ]);
  return {
    employees: check(employees) ?? [],
    vehicles: check(vehicles) ?? [],
    checkItems: check(checkItems) ?? [],
    ppeItems: check(ppeItems) ?? [],
    photoSlots: check(photoSlots) ?? [],
  };
}

export async function upsertEmployee(e: Employee) {
  check(await supabase.from('employees').upsert(e));
}
export async function upsertVehicle(v: Partial<Vehicle> & { plate: string }) {
  check(await supabase.from('vehicles').upsert(v));
}
export async function deleteVehicle(id: string) {
  check(await supabase.from('vehicles').delete().eq('id', id));
}

/* ---------- vehicle inspections ---------- */
export async function listVehicleInspections(opts: { date?: string; month?: string }) {
  let q = supabase.from('v_vehicle_inspection_summary').select('*');
  if (opts.date) q = q.eq('inspect_date', opts.date);
  if (opts.month) {
    const { from, to } = monthRange(opts.month);
    q = q.gte('inspect_date', from).lte('inspect_date', to);
  }
  return (check(await q.order('inspect_date').order('inspect_time')) ?? []) as VehicleInspection[];
}

export async function saveVehicleInspection(f: VehicleForm) {
  return check(
    await supabase.rpc('save_vehicle_inspection', {
      p_id: f.id,
      p_date: f.date,
      p_time: f.time || null,
      p_dman: f.dman,
      p_helper1: f.h1,
      p_helper2: f.h2,
      p_plate: f.plate.trim(),
      p_mileage: f.mileage.trim() ? Number(f.mileage) : null,
      p_note: f.note,
      p_results: f.results,
      p_photos: f.photos,
    }),
  ) as string;
}

export async function deleteVehicleInspection(r: VehicleInspection) {
  check(await supabase.from('vehicle_inspections').delete().eq('id', r.id));
  await removePhotos(Object.values(r.photos ?? {}));
}

/* ---------- photos ---------- */
export async function uploadPhoto(blob: Blob, date: string) {
  const path = `${date.slice(0, 7)}/${date}_${crypto.randomUUID()}.jpg`;
  check(await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg' }));
  return path;
}
export async function removePhotos(paths: string[]) {
  if (paths.length) await supabase.storage.from(PHOTO_BUCKET).remove(paths);
}
export async function signedUrls(paths: string[]) {
  const out: Record<string, string> = {};
  if (!paths.length) return out;
  const data = check(await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 60 * 60)) ?? [];
  data.forEach((d) => { if (d.path && d.signedUrl) out[d.path] = d.signedUrl; });
  return out;
}

/* ---------- PPE ---------- */
export async function listPpeInspections(opts: { date?: string; month?: string }) {
  let q = supabase.from('v_ppe_inspection_summary').select('*');
  if (opts.date) q = q.eq('inspect_date', opts.date);
  if (opts.month) {
    const { from, to } = monthRange(opts.month);
    q = q.gte('inspect_date', from).lte('inspect_date', to);
  }
  return (check(await q.order('inspect_date').order('employee_id')) ?? []) as PpeInspection[];
}

export async function savePpeInspections(f: PpeForm) {
  const rows = Object.fromEntries(Object.entries(f.rows).filter(([, v]) => Object.keys(v).length));
  return check(
    await supabase.rpc('save_ppe_inspections', {
      p_date: f.date, p_plate: f.plate.trim(), p_inspector: f.inspector, p_rows: rows,
    }),
  ) as number;
}

export async function deletePpeInspection(id: string) {
  check(await supabase.from('ppe_inspections').delete().eq('id', id));
}

/* ---------- daily status ---------- */
export async function listDailyVehicleStatus(date: string) {
  return (check(await supabase.from('v_daily_vehicle_status').select('*').eq('day', date).order('plate')) ?? []) as DailyVehicleStatus[];
}
export async function listDailyPpeStatus(date: string) {
  return (check(await supabase.from('v_daily_ppe_status').select('*').eq('day', date).order('employee_id')) ?? []) as DailyPpeStatus[];
}
export async function listDailySummary(month: string) {
  const { from, to } = monthRange(month);
  return (check(await supabase.from('v_daily_summary').select('*').gte('day', from).lte('day', to).order('day')) ?? []) as DailySummary[];
}
