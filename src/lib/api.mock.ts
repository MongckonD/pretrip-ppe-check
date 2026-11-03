/**
 * Test-mode implementation: same functions as api.supabase.ts, but data lives in this browser
 * (rows in localStorage, photos in IndexedDB). It mirrors the SQL views and save functions in
 * supabase/migrations so the UI behaves the same once the real backend is switched on.
 */
import type {
  DailyPpeStatus, DailySummary, DailyVehicleStatus,
  Employee, Master, PpeForm, PpeInspection, PpeResult, Vehicle, VehicleForm, VehicleInspection, VehResult,
} from './types';
import { CHECK_ITEMS, PHOTO_SLOTS, PPE_ITEMS } from './seed';
import { daysInMonth, monthRange, pad2, photoStatus, today } from './utils';

/* ---------- row shapes (= the tables) ---------- */
interface VehRow {
  id: string; inspect_date: string; inspect_time: string | null; dman_id: string;
  helper1_id: string | null; helper2_id: string | null; plate: string; mileage: number | null; note: string;
  results: Record<string, VehResult>; photos: Record<string, string>;
}
interface PpeRow {
  id: string; inspect_date: string; employee_id: string; inspector_id: string; plate: string;
  results: Record<string, PpeResult>;
}
interface Db { employees: Employee[]; vehicles: Vehicle[]; veh: VehRow[]; ppe: PpeRow[] }

const KEY = 'pretrip-mock-v3';
let mem: Db | null = null;

function load(): Db {
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return (mem = JSON.parse(raw) as Db);
    // drop data saved by older demo versions
    Object.keys(localStorage).filter((k) => k.startsWith('pretrip-mock-') && k !== KEY).forEach((k) => localStorage.removeItem(k));
  } catch { /* storage unavailable or corrupt: fall through to demo data */ }
  mem = demoData();
  persist();
  return mem;
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* keep in memory only */ }
}
const tick = () => new Promise((r) => setTimeout(r, 120)); // feel like a network call
const uuid = () => crypto.randomUUID();

/* ---------- demo data ---------- */
function demoData(): Db {
  const names: [string, string][] = [
    ['สมชาย ใจดี', 'D-Man'], ['วิชัย แสงทอง', 'D-Man'], ['ประสิทธิ์ มั่นคง', 'Helper'],
    ['อนุชา ศรีสุข', 'Helper'], ['สุริยา บุญมา', 'Helper'], ['ธนพล รุ่งเรือง', 'D-Man'],
  ];
  const employees = names.map(([name, role], i) => ({ id: `EMP${pad2(i + 1)}`, name, role, active: true }));
  const vehicles = [['1กก 1234', '6 ล้อ'], ['2ขข 5678', '4 ล้อ'], ['3คค 9012', '6 ล้อ']]
    .map(([plate, type]) => ({ id: uuid(), plate, type, active: true }));

  // deterministic pseudo-random so the demo looks the same every reset
  let seed = 54;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

  const veh: VehRow[] = [];
  const ppe: PpeRow[] = [];
  // whole previous month + this month up to yesterday (today is left empty for the tester)
  const t = new Date(today() + 'T00:00:00');
  const start = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  const crews = [['EMP01', 'EMP03'], ['EMP02', 'EMP04'], ['EMP06', 'EMP05']];
  for (const day = start; day < t; day.setDate(day.getDate() + 1)) {
    if (day.getDay() === 0) continue; // no Sunday runs
    const date = day.toLocaleDateString('sv-SE');
    const d = Math.round((day.getTime() - start.getTime()) / 86_400_000); // keeps mileage rising across months
    vehicles.forEach((v, i) => {
      const [dman, helper] = crews[i];
      const results: Record<string, VehResult> = {};
      CHECK_ITEMS.forEach((it) => {
        const r = rnd();
        results[it.item_no] = r < 0.008 ? 2 : it.item_no === 23 && r < 0.2 ? 3 : 1;
      });
      veh.push({
        id: uuid(), inspect_date: date, inspect_time: `07:${pad2(10 + i * 7)}:00`, dman_id: dman, helper1_id: helper,
        helper2_id: null, plate: v.plate, mileage: 40000 + i * 15000 + d * 120, note: '', results, photos: {},
      });
      for (const emp of [dman, helper]) {
        const pr: Record<string, PpeResult> = {};
        PPE_ITEMS.forEach((p) => { pr[p.code] = rnd() < 0.06 ? 2 : 1; });
        ppe.push({ id: uuid(), inspect_date: date, employee_id: emp, inspector_id: dman, plate: v.plate, results: pr });
      }
    });
  }
  veh.filter((r) => Object.values(r.results).includes(2)).forEach((r) => { r.note = 'แจ้งช่างแล้ว'; });
  return { employees, vehicles, veh, ppe };
}

/** Wipe test data (rows + photos) and start again from the demo set. */
export async function resetDemo(empty = false) {
  mem = empty
    ? { ...demoData(), veh: [], ppe: [] }
    : demoData();
  persist();
  await idb('readwrite', (s) => s.clear()).catch(() => {});
  urlCache.forEach((u) => URL.revokeObjectURL(u));
  urlCache.clear();
}

/* ---------- "views" ---------- */
function vehSummary(r: VehRow): VehicleInspection {
  const vals = Object.values(r.results);
  const fail = vals.filter((v) => v === 2).length;
  const photoCount = Object.keys(r.photos).length;
  return {
    ...r, month: r.inspect_date.slice(0, 7),
    pass_count: vals.filter((v) => v === 1).length, fail_count: fail,
    na_count: vals.filter((v) => v === 3).length, filled_count: vals.length, photo_count: photoCount,
    overall_result: vals.length ? (fail ? 2 : 1) : null,
    photo_status: photoStatus(photoCount, PHOTO_SLOTS.length),
  };
}
function ppeSummary(r: PpeRow): PpeInspection {
  const vals = Object.values(r.results);
  const missing = vals.filter((v) => v === 2).length;
  const required = PPE_ITEMS.filter((p) => p.active).length;
  return {
    ...r, month: r.inspect_date.slice(0, 7),
    have_count: vals.filter((v) => v === 1).length, missing_count: missing, filled_count: vals.length,
    status: vals.length < required ? 'ไม่ครบ' : missing ? 'อุปกรณ์ไม่ครบ' : 'ครบ',
  };
}
function inRange(date: string, opts: { date?: string; month?: string }) {
  if (opts.date && date !== opts.date) return false;
  if (opts.month) {
    const { from, to } = monthRange(opts.month);
    if (date < from || date > to) return false;
  }
  return true;
}

/* ---------- master ---------- */
export async function loadMaster(): Promise<Master> {
  await tick();
  const db = load();
  return {
    employees: [...db.employees].sort((a, b) => a.id.localeCompare(b.id)),
    vehicles: [...db.vehicles].sort((a, b) => a.plate.localeCompare(b.plate)),
    checkItems: CHECK_ITEMS, ppeItems: PPE_ITEMS, photoSlots: PHOTO_SLOTS,
  };
}

export async function upsertEmployee(e: Employee) {
  const db = load();
  const i = db.employees.findIndex((x) => x.id === e.id);
  if (i >= 0) db.employees[i] = { ...e }; else db.employees.push({ ...e });
  persist();
}
export async function upsertVehicle(v: Partial<Vehicle> & { plate: string }) {
  const db = load();
  const clash = db.vehicles.find((x) => x.plate === v.plate && x.id !== v.id);
  if (clash) throw new Error(`ทะเบียน ${v.plate} มีอยู่แล้ว`);
  const i = v.id ? db.vehicles.findIndex((x) => x.id === v.id) : -1;
  if (i >= 0) db.vehicles[i] = { ...db.vehicles[i], ...v };
  else db.vehicles.push({ id: uuid(), type: '', active: true, ...v });
  persist();
}
export async function deleteVehicle(id: string) {
  const db = load();
  db.vehicles = db.vehicles.filter((v) => v.id !== id);
  persist();
}

/* ---------- vehicle inspections ---------- */
export async function listVehicleInspections(opts: { date?: string; month?: string }) {
  await tick();
  return load().veh
    .filter((r) => inRange(r.inspect_date, opts))
    .sort((a, b) => (a.inspect_date + (a.inspect_time ?? '')).localeCompare(b.inspect_date + (b.inspect_time ?? '')))
    .map(vehSummary);
}

export async function saveVehicleInspection(f: VehicleForm) {
  await tick();
  const db = load();
  const row: Omit<VehRow, 'id'> = {
    inspect_date: f.date, inspect_time: f.time ? `${f.time}:00` : null, dman_id: f.dman,
    helper1_id: f.h1 || null, helper2_id: f.h2 || null, plate: f.plate.trim(),
    mileage: f.mileage.trim() ? Number(f.mileage) : null, note: f.note,
    results: Object.fromEntries(Object.entries(f.results).map(([k, v]) => [k, v])), photos: { ...f.photos },
  };
  // same rule as the vehicle_inspections_crew_distinct check
  const crew = [row.dman_id, row.helper1_id, row.helper2_id].filter(Boolean);
  if (new Set(crew).size !== crew.length) {
    throw new Error('new row violates check constraint "vehicle_inspections_crew_distinct"');
  }
  // same rule as the unique (inspect_date, plate) constraint
  const clash = db.veh.find((r) => r.inspect_date === row.inspect_date && r.plate === row.plate && r.id !== f.id);
  let target = f.id ? db.veh.find((r) => r.id === f.id) : undefined;
  if (target && clash) throw new Error('duplicate key value violates unique constraint "vehicle_inspections_day_plate_uq"');
  target ??= clash;
  if (target) Object.assign(target, row);
  else db.veh.push((target = { id: uuid(), ...row }));
  persist();
  return target.id;
}

export async function deleteVehicleInspection(r: VehicleInspection) {
  const db = load();
  db.veh = db.veh.filter((x) => x.id !== r.id);
  persist();
  await removePhotos(Object.values(r.photos ?? {}));
}

/* ---------- photos (IndexedDB) ---------- */
function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('pretrip-mock', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('photos');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('photos', mode);
      const req = fn(tx.objectStore('photos'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => open.result.close();
    };
  });
}
const urlCache = new Map<string, string>();

export async function uploadPhoto(blob: Blob, date: string) {
  const path = `${date.slice(0, 7)}/${date}_${uuid()}.jpg`;
  await idb('readwrite', (s) => s.put(blob, path));
  return path;
}
export async function removePhotos(paths: string[]) {
  for (const p of paths) {
    await idb('readwrite', (s) => s.delete(p)).catch(() => {});
    const u = urlCache.get(p);
    if (u) { URL.revokeObjectURL(u); urlCache.delete(p); }
  }
}
export async function signedUrls(paths: string[]) {
  const out: Record<string, string> = {};
  for (const p of paths) {
    let u = urlCache.get(p);
    if (!u) {
      const blob = await idb<Blob | undefined>('readonly', (s) => s.get(p) as IDBRequest<Blob | undefined>).catch(() => undefined);
      if (!blob) continue;
      u = URL.createObjectURL(blob);
      urlCache.set(p, u);
    }
    out[p] = u;
  }
  return out;
}

/* ---------- PPE ---------- */
export async function listPpeInspections(opts: { date?: string; month?: string }) {
  await tick();
  return load().ppe
    .filter((r) => inRange(r.inspect_date, opts))
    .sort((a, b) => (a.inspect_date + a.employee_id).localeCompare(b.inspect_date + b.employee_id))
    .map(ppeSummary);
}

export async function savePpeInspections(f: PpeForm) {
  await tick();
  const db = load();
  let n = 0;
  for (const [emp, items] of Object.entries(f.rows)) {
    if (!Object.keys(items).length) continue;
    const row = { inspect_date: f.date, employee_id: emp, inspector_id: f.inspector, plate: f.plate.trim(), results: { ...items } };
    const existing = db.ppe.find((r) => r.inspect_date === f.date && r.employee_id === emp);
    if (existing) Object.assign(existing, row); else db.ppe.push({ id: uuid(), ...row });
    n++;
  }
  persist();
  return n;
}

export async function deletePpeInspection(id: string) {
  const db = load();
  db.ppe = db.ppe.filter((r) => r.id !== id);
  persist();
}

/* ---------- daily status (= v_daily_* views) ---------- */
/** Days the views cover: first recorded day … today. */
function coveredDay(day: string) {
  const db = load();
  const t = today();
  const first = [...db.veh.map((r) => r.inspect_date), ...db.ppe.map((r) => r.inspect_date)]
    .reduce((a, b) => (b < a ? b : a), t);
  return day >= first && day <= t;
}

function vehStatusFor(day: string): DailyVehicleStatus[] {
  if (!coveredDay(day)) return [];
  const db = load();
  const registered = new Set(db.vehicles.map((v) => v.plate));
  const rows = db.veh.filter((r) => r.inspect_date === day);
  const plates = new Set([...db.vehicles.filter((v) => v.active).map((v) => v.plate), ...rows.map((r) => r.plate)]);
  return [...plates].sort().map((plate) => {
    const r = rows.find((x) => x.plate === plate);
    const s = r && vehSummary(r);
    return {
      day, plate, registered: registered.has(plate),
      inspection_id: s?.id ?? null, inspect_time: s?.inspect_time ?? null, dman_id: s?.dman_id ?? null,
      filled_count: s?.filled_count ?? 0, fail_count: s?.fail_count ?? 0,
      photo_count: s?.photo_count ?? 0, photo_status: s?.photo_status ?? 0,
      fail_items: s ? Object.entries(s.results).filter(([, v]) => v === 2).map(([k]) => Number(k)).sort((a, b) => a - b) : [],
      status: !s ? 0 : s.fail_count ? 2 : 1,
    };
  });
}

function ppeStatusFor(day: string): DailyPpeStatus[] {
  if (!coveredDay(day)) return [];
  const db = load();
  const rows = db.ppe.filter((r) => r.inspect_date === day);
  const ids = new Set([...db.employees.filter((e) => e.active).map((e) => e.id), ...rows.map((r) => r.employee_id)]);
  return [...ids].sort().map((employee_id) => {
    const r = rows.find((x) => x.employee_id === employee_id);
    const s = r && ppeSummary(r);
    return {
      day, employee_id, ppe_inspection_id: s?.id ?? null, inspector_id: s?.inspector_id ?? null, plate: s?.plate ?? null,
      missing_count: s?.missing_count ?? 0,
      missing_items: s ? Object.entries(s.results).filter(([, v]) => v === 2).map(([k]) => k).sort() : [],
      status: s?.status ?? 'ยังไม่ตรวจ',
    };
  });
}

export async function listDailyVehicleStatus(date: string) {
  await tick();
  return vehStatusFor(date);
}
export async function listDailyPpeStatus(date: string) {
  await tick();
  return ppeStatusFor(date);
}
export async function listDailySummary(month: string): Promise<DailySummary[]> {
  await tick();
  return daysInMonth(month).filter(coveredDay).map((day) => {
    const v = vehStatusFor(day), p = ppeStatusFor(day);
    return {
      day,
      vehicles_total: v.length,
      vehicles_checked: v.filter((x) => x.status > 0).length,
      vehicles_failed: v.filter((x) => x.status === 2).length,
      vehicles_photo_complete: v.filter((x) => x.photo_status === 1).length,
      ppe_total: p.length,
      ppe_checked: p.filter((x) => x.status !== 'ยังไม่ตรวจ').length,
      ppe_complete: p.filter((x) => x.status === 'ครบ').length,
    };
  });
}
