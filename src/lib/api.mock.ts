/**
 * Test-mode implementation: data lives in this browser (rows in localStorage, photos in IndexedDB).
 * The future Cloudflare backend (api.cloudflare.ts → Worker → D1/R2, see cloudflare/) must expose
 * the same functions so the UI does not change when the real backend is switched on.
 */
import { failedDefects } from './api.cloudflare';
import type {
  ListOpts,
  Defect, Employee, Master, PpeForm, PpeInspection, PpeResult, Vehicle, VehicleForm, VehicleInspection, VehResult, TripActivity,
} from './types';
import { licenseStatus, type DriverLicense, type LicenseForm, type LicenseInfo, type LicenseRow } from './license';
import { AREA_TYPES, CHECK_ITEMS, PHOTO_SLOTS, PPE_ITEMS, ROLES } from './seed';
import { monthRange, pad2, photoStatus, today } from './utils';

/* ---------- row shapes (= the tables) ---------- */
interface VehRow {
  id: string; inspect_date: string; inspect_time: string | null; dman_id: string;
  helper1_id: string | null; helper2_id: string | null; plate: string; mileage: number | null; note: string;
  results: Record<string, VehResult>; photos: Record<string, string>;
  defects?: Record<string, Defect>;
  approved_at?: string | null; approved_by?: string | null;
  rejected_at?: string | null; rejected_by?: string | null; reject_reason?: string;
}
interface PpeRow {
  id: string; inspect_date: string; employee_id: string; inspector_id: string; plate: string;
  results: Record<string, PpeResult>;
}
interface TripRow {
  id: string; activity_date: string; vehicle_id: string; dman_id: string; areas: string[];
  work_started_at: string; work_ended_at?: string | null;
}
interface Db { employees: Employee[]; vehicles: Vehicle[]; veh: VehRow[]; ppe: PpeRow[]; trips: TripRow[] }

const KEY = 'pretrip-mock-v3';
/** test employee code from the internal id: EMP07 → 690007 (test mode only; the real codes are typed in Settings) */
const testCode = (id: string) => `69${String(Number(id.replace(/\D/g, '')) || 0).padStart(4, '0')}`;
let mem: Db | null = null;

function load(): Db {
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      mem = JSON.parse(raw) as Db;
      mem.trips ??= []; // saved by a version before Time activities
      // saved before employee codes: give each a test code (EMP07 → 690007) so nothing shows the internal id
      for (const e of mem.employees) e.code ||= testCode(e.id);
      return mem;
    }
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
  const employees = names.map(([name, role], i) => ({ id: `EMP${pad2(i + 1)}`, name, role, active: true, code: testCode(`EMP${pad2(i + 1)}`) }));
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
  // a few demo trips for the last days so the Time activities list is not empty
  const trips: TripRow[] = [];
  const areaSets = [['remote', 'mountain'], ['urban_dense'], ['suburban_dense', 'narrow_road']];
  veh.slice(-9).forEach((r, i) => {
    const v = vehicles.find((x) => x.plate === r.plate)!;
    trips.push({
      id: uuid(), activity_date: r.inspect_date, work_started_at: `${r.inspect_date}T00:${pad2(30 + (i % 3) * 5)}:00.000Z`,
      vehicle_id: v.id, dman_id: r.dman_id, areas: areaSets[i % 3],
    });
  });
  return { employees, vehicles, veh, ppe, trips };
}

/** Wipe test data (rows + photos) and start again from the demo set. */
export async function resetDemo(empty = false) {
  mem = empty
    ? { ...demoData(), veh: [], ppe: [], trips: [] }
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
function inRange(date: string, opts: ListOpts) {
  if (opts.date && date !== opts.date) return false;
  if (opts.from && date < opts.from) return false;
  if (opts.to && date > opts.to) return false;
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
    checkItems: CHECK_ITEMS, ppeItems: PPE_ITEMS, photoSlots: PHOTO_SLOTS, roles: ROLES, areaTypes: AREA_TYPES,
  };
}

export async function upsertEmployee(e: Employee) {
  const db = load();
  const code = (e.code ?? '').toUpperCase().replace(/\s+/g, '');
  if (code && !/^[A-Z0-9-]{1,20}$/.test(code)) throw new Error('รหัสพนักงานใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข และ - (ไม่เกิน 20 ตัว)');
  const owner = code && db.employees.find((x) => x.id !== e.id && (x.code ?? '') === code);
  if (owner) throw new Error(`รหัสพนักงาน ${code} ใช้กับ ${owner.id} แล้ว`);
  e = { ...e, code };
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
/** same rule as the Worker: only an employee with no history can be deleted */
export async function deleteEmployee(id: string) {
  const db = load();
  const used = db.veh.some((r) => [r.dman_id, r.helper1_id, r.helper2_id].includes(id))
    || db.ppe.some((r) => r.employee_id === id || r.inspector_id === id)
    || db.trips.some((r) => r.dman_id === id);
  if (used) throw new Error('ลบไม่ได้ — มีประวัติการตรวจรถ / PPE / เวลาทำงานแล้ว ให้ปิดสถานะเป็น "ปิดอยู่" แทน');
  db.employees = db.employees.filter((e) => e.id !== id);
  persist();
}

/* ---------- vehicle inspections ---------- */
export async function listVehicleInspections(opts: ListOpts) {
  await tick();
  return load().veh
    .filter((r) => inRange(r.inspect_date, opts))
    .sort((a, b) => (a.inspect_date + (a.inspect_time ?? '')).localeCompare(b.inspect_date + (b.inspect_time ?? '')))
    .map(vehSummary);
}

/** admin: approve / undo approval (test mode: approver is "admin") */
export async function setVehicleApproval(id: string, approve: boolean) {
  await tick();
  const db = load();
  const r = db.veh.find((x) => x.id === id);
  if (!r) throw new Error('ไม่พบบันทึกนี้');
  if (r.approved_at) {
    if (approve) return;
    throw new Error('อนุมัติแล้ว ยกเลิกหรือแก้ไขการอนุมัติไม่ได้');
  }
  r.approved_at = approve ? new Date().toISOString() : null;
  r.approved_by = approve ? 'admin' : null;
  if (approve) { r.rejected_at = null; r.rejected_by = null; r.reject_reason = ''; }
  persist();
}

/** admin: ไม่อนุมัติ with a reason, or undo (reason = null) */
export async function setVehicleRejection(id: string, reason: string | null) {
  await tick();
  const db = load();
  const r = db.veh.find((x) => x.id === id);
  if (!r) throw new Error('ไม่พบบันทึกนี้');
  if (reason !== null && !reason.trim()) throw new Error('ระบุเหตุผลที่ไม่อนุมัติ');
  if (r.approved_at) throw new Error('อนุมัติแล้ว เปลี่ยนเป็นไม่อนุมัติไม่ได้');
  r.rejected_at = reason === null ? null : new Date().toISOString();
  r.rejected_by = reason === null ? null : 'admin';
  r.reject_reason = reason?.trim() ?? '';
  persist();
}

export async function saveVehicleInspection(f: VehicleForm) {
  await tick();
  const db = load();
  const row: Omit<VehRow, 'id'> = {
    inspect_date: f.date, inspect_time: f.time ? `${f.time}:00` : null, dman_id: f.dman,
    helper1_id: f.h1 || null, helper2_id: f.h2 || null, plate: f.plate.trim(),
    mileage: f.mileage.trim() ? Number(f.mileage) : null, note: f.note,
    results: Object.fromEntries(Object.entries(f.results).map(([k, v]) => [k, v])), photos: { ...f.photos },
    defects: failedDefects(f),
  };
  // same rule as the API: an item marked ไม่ผ่าน needs a note
  const noNote = Object.entries(row.defects ?? {}).find(([, d]) => !d.note);
  if (noNote) throw new Error(`ระบุหมายเหตุของข้อ ${noNote[0]} ที่ไม่ผ่าน`);
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
  if (target?.approved_at) throw new Error('รายการนี้หัวหน้าอนุมัติแล้ว แก้ไขไม่ได้ (ต้องยกเลิกอนุมัติก่อน)');
  // same as the server: re-sending clears a ไม่อนุมัติ (back to รออนุมัติ)
  if (target) Object.assign(target, row, { rejected_at: null, rejected_by: null, reject_reason: '' });
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
export async function listPpeInspections(opts: ListOpts) {
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

/* ---------- Time activities ---------- */
/** UTC ISO → Thai HH:MM */
const hhmm = (iso: string) => new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(11, 16);
function tripSummary(t: TripRow, db: Db): TripActivity {
  const v = db.vehicles.find((x) => x.id === t.vehicle_id);
  const ordered = AREA_TYPES.filter((a) => t.areas.includes(a.code));
  const vi = db.veh.find((r) => r.inspect_date === t.activity_date && r.plate === v?.plate);
  return {
    id: t.id, activity_date: t.activity_date, month: t.activity_date.slice(0, 7),
    start_time: hhmm(t.work_started_at), end_time: t.work_ended_at ? hhmm(t.work_ended_at) : null,
    vehicle_id: t.vehicle_id, plate: v?.plate ?? '', dman_id: t.dman_id,
    vehicle_inspection_id: vi?.id ?? null, inspected: !!vi,
    area_codes: ordered.map((a) => a.code),
    work_started_at: t.work_started_at, work_ended_at: t.work_ended_at ?? null,
    work_minutes: t.work_started_at && t.work_ended_at
      ? Math.round((Date.parse(t.work_ended_at) - Date.parse(t.work_started_at)) / 60_000) : null,
  };
}

export async function listTripActivities(opts: ListOpts) {
  await tick();
  const db = load();
  return db.trips
    .filter((t) => inRange(t.activity_date, opts))
    .sort((a, b) => a.work_started_at.localeCompare(b.work_started_at))
    .map((t) => tripSummary(t, db));
}


export async function deleteTripActivity(id: string) {
  const db = load();
  db.trips = db.trips.filter((t) => t.id !== id);
  persist();
}

export async function startWork(plate: string) {
  await tick();
  const db = load();
  const v = db.vehicles.find((x) => x.plate === plate.trim());
  if (!v) throw new Error(`ยังไม่ได้ลงทะเบียนรถ ${plate}`);
  const vi = db.veh.find((r) => r.inspect_date === today() && r.plate === v.plate);
  if (!vi) throw new Error(`ยังไม่ได้ตรวจรถทะเบียน ${v.plate} วันนี้ — ตรวจรถก่อนแล้วค่อยเริ่มการทำงาน`);
  if (db.trips.some((x) => x.activity_date === today() && x.vehicle_id === v.id)) throw new Error(`รถ ${v.plate} เริ่มการทำงานของวันนี้ไปแล้ว`);
  const now = new Date().toISOString();
  const t: TripRow = { id: uuid(), activity_date: today(), vehicle_id: v.id, dman_id: vi.dman_id, areas: [], work_started_at: now };
  db.trips.push(t);
  persist();
  return { id: t.id, work_started_at: now };
}

export async function endWork(id: string) {
  await tick();
  const t = load().trips.find((x) => x.id === id);
  if (!t) throw new Error('ไม่พบบันทึกนี้');
  if (t.work_ended_at) throw new Error('จบงานไปแล้ว');
  t.work_ended_at = new Date().toISOString();
  persist();
  return { id, work_ended_at: t.work_ended_at };
}

/* ---------- driver licence (test mode: one licence for "me" kept in this browser; photo kept in memory) ---------- */
const LIC_KEY = 'pretrip-mock-license';
let licPhoto: string | null = null;
type MockLic = Omit<DriverLicense, 'status' | 'days_left'>;
function readLic(): MockLic | null {
  try { const raw = localStorage.getItem(LIC_KEY); return raw ? JSON.parse(raw) as MockLic : null; } catch { return null; }
}
const withStatus = (l: MockLic): DriverLicense => ({ ...l, ...licenseStatus(l.expiry_date, l.lifetime, today()) });

export async function getMyLicense(): Promise<LicenseInfo> {
  await tick();
  const l = readLic();
  return { license: l ? withStatus(l) : null, warn_days: 60 };
}
export async function saveMyLicense(f: LicenseForm): Promise<LicenseInfo> {
  await tick();
  if (licPhoto) URL.revokeObjectURL(licPhoto);
  licPhoto = URL.createObjectURL(f.photo);
  const l: MockLic = {
    id: uuid().replace(/-/g, ''), full_name: f.full_name.trim(), license_no: f.license_no.replace(/[\s-]/g, '').toUpperCase(),
    expiry_date: f.lifetime ? null : f.expiry_date, lifetime: f.lifetime, submitted_at: new Date().toISOString(), has_photo: true,
  };
  try { localStorage.setItem(LIC_KEY, JSON.stringify(l)); } catch { /* memory only */ }
  return { license: withStatus(l), warn_days: 60 };
}
export async function listLicenses(): Promise<{ rows: LicenseRow[]; warn_days: number; today: string }> {
  await tick();
  // test mode: the one licence sent from this browser, shown as the first employee's
  const mine = readLic();
  const e = load().employees.find((x) => x.active);
  const rows: LicenseRow[] = [];
  if (mine && e) {
    const l = withStatus(mine);
    rows.push({ user_id: e.id.toLowerCase(), display_name: e.name, employee_id: e.id, employee_name: e.name, license: l, status: l.status });
  }
  return { rows, warn_days: 60, today: today() };
}
export const licensePhotoUrl = (_id: string) => licPhoto ?? '';
