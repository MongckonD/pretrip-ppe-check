/**
 * Test-mode implementation: data lives in this browser (rows in localStorage, photos in IndexedDB).
 * The future Cloudflare backend (api.cloudflare.ts → Worker → D1/R2, see cloudflare/) must expose
 * the same functions so the UI does not change when the real backend is switched on.
 */
import { failedDefects } from './api.cloudflare';
import type {
  DeliveryAddIn, DeliveryBill, DeliveryImportResult, DeliveryImportStop, DeliveryRowIn, DeliveryStop, ListOpts, StoreVisitReportRow, StoreVisitSave, StoreVisitStatus,
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
  if (i >= 0 && v.active === false && db.vehicles[i].active) mockNoOpenDeliveries(db.vehicles[i].plate);
  if (i >= 0) db.vehicles[i] = { ...db.vehicles[i], ...v };
  else db.vehicles.push({ id: uuid(), type: '', active: true, ...v });
  persist();
}
/** same rule as the Worker: a vehicle with stores to deliver today or later cannot be deleted or switched off */
function mockNoOpenDeliveries(plate: string) {
  const open = dpLoad().plan.filter((p) => p.plate === plate && p.date >= today());
  if (open.length) {
    const first = open.map((p) => p.date).sort()[0];
    throw new Error(`รถ ${plate} มีแผนส่ง ${open.length} ร้าน ตั้งแต่วันที่ ${first} — ย้ายร้านไปรถคันอื่นหรือลบออกจากแผน (หน้าหลัก → ร้านค้าที่ต้องส่ง) ก่อน`);
  }
}
export async function deleteVehicle(id: string) {
  const db = load();
  const v = db.vehicles.find((x) => x.id === id);
  if (v) mockNoOpenDeliveries(v.plate);
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
  // same rules as the API: the mileage every time, every active item answered
  if (row.mileage === null) throw new Error('กรอกเลขไมล์ก่อนส่ง');
  const missingItems = CHECK_ITEMS.filter((it) => it.active && row.results[String(it.item_no)] === undefined);
  if (missingItems.length) throw new Error(`ตรวจให้ครบทุกข้อก่อนส่ง — ยังไม่ได้ตรวจ ${missingItems.length} ข้อ`);
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

/** same file name as the Worker: 2026-11/2026-11-25/ผข4600/20261125-0812_ผข4600_front_a1b2c3.jpg */
export async function uploadPhoto(blob: Blob, _date: string, plate: string, slot: string) {
  const p = plate.replace(/[^0-9A-Za-z\u0E00-\u0E7F-]/g, '').slice(0, 20);
  if (!p) throw new Error('เลือกทะเบียนรถก่อนถ่ายรูป');
  const now = new Date(Date.now() + 7 * 3_600_000).toISOString();
  const day = now.slice(0, 10);
  const rand = uuid().replace(/-/g, '').slice(0, 6);
  const path = `${day.slice(0, 7)}/${day}/${p}/${day.replace(/-/g, '')}-${now.slice(11, 13)}${now.slice(14, 16)}_${p}_${slot}_${rand}.jpg`;
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
  if ((dpLoad().visits ?? []).some((v) => v.trip_id === id)) throw new Error('รถคันนี้มีการจับเวลาร้านค้าของวันนี้แล้ว — ลบบันทึกเริ่มงานไม่ได้');
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
  const dd = dpLoad();
  const open = (dd.visits ?? []).find((v) => v.trip_id === id && v.status === 'open');
  if (open) throw new Error(`ยังส่ง ${dd.plan.find((p) => p.id === open.plan_id)?.snap?.name ?? 'ร้านค้า'} ไม่เสร็จ — จบร้านนั้นและบันทึกก่อน จึงจะจบงานได้`);
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

/* ---------- ร้านค้าที่ต้องส่ง (test mode: same rules as worker/delivery-routes.ts, kept in this browser) ---------- */
/** snap = the store name / type / address as of that day (history does not follow later changes) */
interface MockPlanRow { id: string; date: string; plate: string; code: string; sort: number; bills: DeliveryBill[]; snap?: { name: string; type: string; address: string } }
/** store timer: the status of a plan row (same rules as worker/store-visit-routes.ts) */
type MockVisit = StoreVisitStatus & { plan_id: string; trip_id: string };
interface MockDelivery { stores: Record<string, { name: string; type: string; address: string }>; plan: MockPlanRow[]; visits?: MockVisit[] }
const DP_KEY = 'pretrip-mock-delivery-v1';
function dpLoad(): MockDelivery {
  try { return JSON.parse(localStorage.getItem(DP_KEY) ?? 'null') ?? { stores: {}, plan: [] }; } catch { return { stores: {}, plan: [] }; }
}
function dpSave(d: MockDelivery) { try { localStorage.setItem(DP_KEY, JSON.stringify(d)); } catch { /* memory only */ } }
const dpText = (v: string) => (v ?? '').trim().replace(/\s+/g, ' ');
const dpCode = (v: string) => (v ?? '').replace(/\s+/g, '').toUpperCase();
const dpPlateKey = (p: string) => p.replace(/[\s.-]/g, '').toUpperCase();
/** same rule as the Worker: whole number 0–100000 (commas allowed); otherwise the reason as a string */
function dpCases(v: string): number | null | string {
  const raw = (v ?? '').trim();
  const t = raw.replace(/,/g, '').replace(/\s+/g, '');
  if (!t) return null;
  if (t.startsWith('-')) return `จำนวนลังติดลบ (${raw})`;
  if (!/^\d+$/.test(t)) return `จำนวนลัง "${raw}" ต้องเป็นเลขจำนวนเต็ม`;
  return Number(t) <= 100000 ? Number(t) : `จำนวนลัง ${raw} มากเกินไป`;
}
const dpAddDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dpIso = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
function dpClosed(date: string) {
  const t = today();
  if (date < t) return `วันที่ ${date} ผ่านมาแล้ว — แผนส่งย้อนหลังแก้ไขไม่ได้`;
  if (date > dpAddDays(t, 60)) return `วันที่ ${date} ไกลเกิน 60 วันข้างหน้า — ตรวจวันที่ในไฟล์`;
  return '';
}

export async function listDeliveryPlan(date: string, plate?: string): Promise<DeliveryStop[]> {
  await tick();
  const d = dpLoad();
  return d.plan.filter((p) => p.date === date && (!plate || dpPlateKey(p.plate) === dpPlateKey(plate)))
    .sort((a, b) => a.plate.localeCompare(b.plate) || a.sort - b.sort)
    .map((p) => {
      const st = p.snap ?? d.stores[p.code] ?? { name: p.code, type: '', address: '' };
      return {
        id: p.id, plate: p.plate, code: p.code, name: st.name, type: st.type, address: st.address, bills: p.bills,
        cases: p.bills.some((b) => b.cases !== null) ? p.bills.reduce((n, b) => n + (b.cases ?? 0), 0) : null,
        visit: dpVisitOut((d.visits ?? []).find((v) => v.plan_id === p.id)),
      };
    });
}

type DpStop = DeliveryImportStop & { existing_id?: string };
function dpCheck(fallback: string, mode: 'replace' | 'append', rows: DeliveryRowIn[]) {
  const d = dpLoad();
  const vehOf = new Map(load().vehicles.filter((v) => v.active).map((v) => [dpPlateKey(v.plate), v.plate]));
  const errors: string[] = [];
  const notes: string[] = [];
  const stops = new Map<string, DpStop>();
  const billAt = new Map<string, string>();
  rows.forEach((r) => {
    const name = dpText(r.name); const code = dpCode(r.code); const p = dpText(r.plate); const dateIn = dpText(r.date);
    if (!name && !code && !p) return;
    const date = dateIn || fallback;
    if (!dpIso(date)) return errors.push(`แถว ${r.line}: วันที่ส่ง "${dateIn}" ไม่ถูกต้อง`);
    const closed = dpClosed(date);
    if (closed) return errors.push(`แถว ${r.line}: ${closed}`);
    if (!code) return errors.push(`แถว ${r.line}: ไม่มีรหัสร้าน`);
    if (!name) return errors.push(`แถว ${r.line}: ร้าน ${code} ไม่มีชื่อร้าน`);
    if (!p) return errors.push(`แถว ${r.line}: ${name} ไม่มีทะเบียนรถ`);
    const plate = vehOf.get(dpPlateKey(p));
    if (!plate) return errors.push(`แถว ${r.line}: ทะเบียน ${p} ไม่มีในระบบ — เพิ่มรถที่แท็บตั้งค่าก่อน`);
    const cs = dpCases(r.cases);
    if (typeof cs === 'string') return errors.push(`แถว ${r.line}: ${name} — ${cs}`);
    const bill = { bill_no: dpText(r.bill), cases: cs };
    const key = `${date}|${code}`;
    if (bill.bill_no) {
      const at = billAt.get(bill.bill_no);
      if (at && at !== key) { const [d2, c2] = at.split('|'); return errors.push(`แถว ${r.line}: บิล ${bill.bill_no} ซ้ำกับร้าน ${c2} วันที่ ${d2} ในไฟล์ — บิลหนึ่งใบส่งได้ครั้งเดียว`); }
    }
    const prev = stops.get(key);
    if (prev && prev.plate !== plate) return errors.push(`แถว ${r.line}: ${name} (${code}) วันที่ ${date} อยู่ทั้งรถ ${prev.plate} และรถ ${plate} — ร้านเดียวกันส่งได้คันเดียว`);
    if (bill.bill_no) billAt.set(bill.bill_no, key);
    if (prev) {
      prev.lines.push(r.line);
      if (!bill.bill_no && bill.cases === null) return;
      if (bill.bill_no && prev.bills.some((b) => b.bill_no === bill.bill_no)) notes.push(`แถว ${r.line}: บิล ${bill.bill_no} ซ้ำในไฟล์ — ใช้ครั้งเดียว`);
      else prev.bills.push(bill);
      return;
    }
    stops.set(key, { date, lines: [r.line], plate, code, name, type: dpText(r.type), address: dpText(r.address),
      bills: bill.bill_no || bill.cases !== null ? [bill] : [], existing: false, new_store: !d.stores[code] });
  });
  const list = [...stops.values()];
  const dates = [...new Set(list.map((x) => x.date))].sort();
  if (mode === 'append') {
    for (const st of list) {
      const was = d.plan.find((c) => c.date === st.date && c.code === st.code);
      if (!was) continue;
      if (was.plate !== st.plate) errors.push(`แถว ${st.lines[0]}: ${st.name} (${st.code}) วันที่ ${st.date} อยู่ในรถ ${was.plate} แล้ว — ร้านเดียวกันส่งได้คันเดียว`);
      else { st.existing_id = was.id; st.existing = true; }
    }
  }
  if (mode === 'replace') {
    const locked = dpLocked(d, d.plan.filter((p) => dates.includes(p.date)));
    if (locked.length) errors.push(`แทนที่ไม่ได้: ${dpLockedText(locked)} — ใช้ "เพิ่ม" แทน`);
  }
  const wiped = new Set(mode === 'replace' ? dates : []);
  for (const [bill, key] of billAt) {
    const savedOn = d.plan.find((c) => !wiped.has(c.date) && c.bills.some((b) => b.bill_no === bill));
    const st = stops.get(key);
    if (!savedOn || !st || st.existing_id === savedOn.id) continue;
    errors.push(`แถว ${st.lines[0]}: บิล ${bill} มีอยู่แล้ว (ร้าน ${savedOn.code} วันที่ ${savedOn.date}) — บิลหนึ่งใบส่งได้ครั้งเดียว`);
  }
  for (const st of list) {
    if (!st.existing_id) continue;
    const have = new Set(d.plan.find((c) => c.id === st.existing_id)?.bills.map((b) => b.bill_no).filter(Boolean));
    const before = st.bills.length;
    st.bills = st.bills.filter((b) => b.bill_no && !have.has(b.bill_no));
    if (st.bills.length < before) notes.push(`${st.name} (${st.date}): อยู่ในรถ ${st.plate} แล้ว — ข้าม ${before - st.bills.length} บิลที่มีอยู่แล้ว / ไม่มีเลขบิล`);
  }
  return { d, stops: list, dates, errors, notes };
}

export async function importDeliveryPlan(date: string, mode: 'replace' | 'append', rows: DeliveryRowIn[], commit: boolean): Promise<DeliveryImportResult> {
  await tick();
  const { d, stops, dates, errors, notes } = dpCheck(date, mode, rows);
  const sumOf = (list: DpStop[]) => {
    const bl = list.flatMap((x) => x.bills);
    return { stores: list.length, vehicles: new Set(list.map((x) => x.plate)).size, bills: bl.length, cases: bl.reduce((n, b) => n + (b.cases ?? 0), 0) };
  };
  const summary = {
    ...sumOf(stops), new_stores: new Set(stops.filter((x) => x.new_store).map((x) => x.code)).size,
    already: stops.filter((x) => x.existing).length,
    dates: dates.map((dt) => ({ date: dt, ...sumOf(stops.filter((x) => x.date === dt)) })),
  };
  const out = { stops: stops.map(({ existing_id: _e, ...x }) => x), errors, notes, summary };
  if (!commit) return out;
  if (errors.length) throw new Error(`ไฟล์มีปัญหา ${errors.length} รายการ — แก้ไฟล์แล้วนำเข้าใหม่`);
  if (mode === 'replace') d.plan = d.plan.filter((p) => !dates.includes(p.date));
  const next = new Map<string, number>();
  for (const x of stops) {
    const old = d.stores[x.code];
    d.stores[x.code] = { name: x.name, type: x.type || old?.type || '', address: x.address || old?.address || '' };
    const row = x.existing_id ? d.plan.find((p) => p.id === x.existing_id) : undefined;
    if (row) { row.bills.push(...x.bills); continue; }
    const n = (next.get(x.date) ?? Math.max(0, ...d.plan.filter((p) => p.date === x.date).map((p) => p.sort))) + 1;
    next.set(x.date, n);
    d.plan.push({ id: crypto.randomUUID(), date: x.date, plate: x.plate, code: x.code, sort: n, bills: x.bills, snap: { ...d.stores[x.code] } });
  }
  dpSave(d);
  return out;
}

export async function addDeliveryStop(b: DeliveryAddIn) {
  await tick();
  const closed = dpClosed(b.date);
  if (closed) throw new Error(closed);
  const { d, stops, errors } = dpCheck(b.date, 'append', [{ line: 1, date: b.date, plate: b.plate, code: b.code, name: b.name, type: b.type, address: '', cases: b.cases, bill: b.bill }]);
  if (errors.length) throw new Error(errors[0].replace(/^แถว 1: /, ''));
  const st = stops[0];
  if (!st) throw new Error('กรอกทะเบียนรถ รหัสร้าน และชื่อร้านก่อน');
  if (st.existing_id && !st.bills.length) throw new Error(`${st.name} (${st.code}) อยู่ในรถ ${st.plate} ของวันที่ ${b.date} แล้ว`);
  if (!d.stores[st.code]) d.stores[st.code] = { name: st.name, type: st.type, address: '' };
  let id = st.existing_id;
  if (id) d.plan.find((p) => p.id === id)?.bills.push(...st.bills);
  else {
    id = crypto.randomUUID();
    d.plan.push({ id, date: b.date, plate: st.plate, code: st.code, sort: Math.max(0, ...d.plan.filter((p) => p.date === b.date).map((p) => p.sort)) + 1, bills: st.bills, snap: { ...d.stores[st.code] } });
  }
  dpSave(d);
  return { id };
}

export async function removeDeliveryStop(id: string) {
  await tick();
  const d = dpLoad();
  const row = d.plan.find((p) => p.id === id);
  if (row) { const closed = dpClosed(row.date); if (closed) throw new Error(closed); }
  const locked = row ? dpLocked(d, [row]) : [];
  if (locked.length) throw new Error(`ลบไม่ได้: ${dpLockedText(locked)}`);
  d.plan = d.plan.filter((p) => p.id !== id);
  dpSave(d);
  return { ok: true as const };
}

export async function clearDeliveryPlan(date: string) {
  await tick();
  const closed = dpClosed(date);
  if (closed) throw new Error(closed);
  const d = dpLoad();
  const locked = dpLocked(d, d.plan.filter((p) => p.date === date));
  if (locked.length) throw new Error(`ล้างทั้งวันไม่ได้: ${dpLockedText(locked)}`);
  d.plan = d.plan.filter((p) => p.date !== date);
  dpSave(d);
  return { ok: true as const };
}

/* ---------- store timer (test mode: same rules as worker/store-visit-routes.ts, kept in this browser) ---------- */
const DP_STATUS: Record<string, string> = { open: 'กำลังส่ง', done: 'ส่งสำเร็จแล้ว', failed: 'ส่งไม่สำเร็จ' };
function dpVisitOut(v: MockVisit | undefined): StoreVisitStatus | null {
  if (!v) return null;
  const { plan_id: _p, trip_id: _t, ...out } = v;
  return out;
}
function dpLocked(d: MockDelivery, rows: MockPlanRow[]) {
  return rows.flatMap((p) => {
    const v = (d.visits ?? []).find((x) => x.plan_id === p.id);
    return v ? [`${p.snap?.name ?? p.code} (รถ ${p.plate} · ${DP_STATUS[v.status]})`] : [];
  });
}
const dpLockedText = (names: string[]) =>
  `มีร้านที่บันทึกสถานะการส่งแล้ว ${names.length} ร้าน: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ' …' : ''} — ร้านเหล่านี้เอาออกจากแผนไม่ได้`;
/** the plan row, today's work record of its vehicle, and the checks the Worker does */
function dpCtx(planId: string) {
  const d = dpLoad();
  const p = d.plan.find((x) => x.id === planId);
  if (!p) throw new Error('ไม่พบร้านนี้ในแผนส่ง (อาจถูกลบไปแล้ว) — กดรีเฟรช');
  if (p.date !== today()) throw new Error('จับเวลาได้เฉพาะร้านของวันนี้');
  const db = load();
  const veh = db.vehicles.find((v) => dpPlateKey(v.plate) === dpPlateKey(p.plate));
  const trip = db.trips.find((t) => t.activity_date === p.date && t.vehicle_id === veh?.id);
  if (!trip) throw new Error(`กด "เริ่มการทำงาน" ของรถ ${p.plate} ก่อน จึงจะจับเวลาร้านค้าได้`);
  if (trip.work_ended_at) throw new Error(`รถ ${p.plate} จบงานแล้ว — จับเวลาร้านค้าหรือเปลี่ยนสถานะร้านไม่ได้`);
  const visits = (d.visits ??= []);
  return { d, visits, p, trip, name: p.snap?.name ?? p.code };
}
function dpVisitCtx(id: string) {
  const found = (dpLoad().visits ?? []).find((x) => x.id === id);
  if (!found) throw new Error('ไม่พบรายการนี้ (อาจถูกยกเลิกไปแล้ว) — กดรีเฟรช');
  const c = dpCtx(found.plan_id);
  const v = c.visits.find((x) => x.id === id);
  if (!v) throw new Error('ไม่พบรายการนี้ — กดรีเฟรช');
  return { ...c, v };
}
/** test mode has no signed-in account */
const TEST_BY = 'ผู้ทดสอบ';

export async function startStoreVisit(planId: string) {
  await tick();
  const { d, visits, p, trip, name } = dpCtx(planId);
  const same = visits.find((v) => v.plan_id === p.id);
  if (same) {
    throw new Error(same.status === 'done' ? `${name} ส่งไปแล้ววันนี้`
      : same.status === 'failed' ? `${name} บันทึกว่าส่งไม่สำเร็จแล้ว — ยกเลิกสถานะนั้นก่อนถ้าจะส่งใหม่` : `${name} กำลังจับเวลาอยู่แล้ว`);
  }
  const other = visits.find((v) => v.trip_id === trip.id && v.status === 'open');
  if (other) throw new Error(`กำลังจับเวลา ${d.plan.find((x) => x.id === other.plan_id)?.snap?.name ?? 'ร้านอื่น'} อยู่ — จบร้านนั้นก่อน`);
  const now = new Date().toISOString();
  const v: MockVisit = {
    id: uuid(), plan_id: p.id, trip_id: trip.id, status: 'open', started_at: now, ended_at: null,
    cases: null, skus: null, distance_m: null, method: null, note: '', by: TEST_BY,
  };
  visits.push(v);
  dpSave(d);
  return { id: v.id, started_at: now };
}
export async function endStoreVisit(id: string) {
  await tick();
  const { d, v } = dpVisitCtx(id);
  if (v.status !== 'open') throw new Error('ร้านนี้ไม่ได้กำลังจับเวลาอยู่ — กดรีเฟรช');
  v.ended_at ??= new Date().toISOString();
  dpSave(d);
  return { id, ended_at: v.ended_at };
}
export async function resumeStoreVisit(id: string) {
  await tick();
  const { d, v } = dpVisitCtx(id);
  if (v.status !== 'open') throw new Error('บันทึกร้านนี้ไปแล้ว — แก้ไม่ได้');
  v.ended_at = null;
  dpSave(d);
  return { ok: true as const };
}
export async function saveStoreVisit(id: string, b: StoreVisitSave) {
  await tick();
  const { d, v } = dpVisitCtx(id);
  if (v.status !== 'open') throw new Error('บันทึกร้านนี้ไปแล้ว');
  if (!v.ended_at) throw new Error('กด "รถออกจากร้าน" ก่อน แล้วค่อยบันทึก');
  if (!Number.isInteger(b.cases) || b.cases < 0 || b.cases > 100000) throw new Error('กรอกจำนวนลังที่ส่ง');
  Object.assign(v, { status: 'done', cases: b.cases, skus: b.skus ?? null, distance_m: b.distance_m ?? null, method: b.method ?? null });
  dpSave(d);
  return { ok: true as const };
}
export async function failStoreVisit(planId: string, note: string) {
  await tick();
  const { d, visits, p, trip, name } = dpCtx(planId);
  const n = note.trim().replace(/\s+/g, ' ');
  if (!n) throw new Error('เขียนหมายเหตุก่อนว่าทำไมส่งไม่สำเร็จ');
  if (n.length > 300) throw new Error('หมายเหตุยาวเกิน 300 ตัวอักษร');
  const cur = visits.find((v) => v.plan_id === p.id);
  if (cur) {
    throw new Error(cur.status === 'done' ? `${name} ส่งไปแล้ววันนี้`
      : cur.status === 'open' ? `${name} กำลังจับเวลาอยู่ — ยกเลิกร้านนั้นก่อน` : `${name} บันทึกว่าส่งไม่สำเร็จแล้ว`);
  }
  const v: MockVisit = {
    id: uuid(), plan_id: p.id, trip_id: trip.id, status: 'failed', started_at: null, ended_at: null,
    cases: null, skus: null, distance_m: null, method: null, note: n, by: TEST_BY,
  };
  visits.push(v);
  dpSave(d);
  return { id: v.id };
}
export async function deleteStoreVisit(id: string) {
  await tick();
  const { d, v } = dpVisitCtx(id);
  if (v.status === 'done') throw new Error('ส่งสำเร็จแล้ว — ยกเลิกไม่ได้');
  d.visits = (d.visits ?? []).filter((x) => x.id !== id);
  dpSave(d);
  return { ok: true as const };
}
export async function devResetStoreVisits(plate: string) {
  await tick();
  const d = dpLoad();
  const mine = new Set(d.plan.filter((p) => p.date === today() && dpPlateKey(p.plate) === dpPlateKey(plate)).map((p) => p.id));
  d.visits = (d.visits ?? []).filter((v) => !mine.has(v.plan_id));
  dpSave(d);
  return { ok: true as const };
}

/** admin report (same rows as the view v_store_visit_summary) */
export async function listStoreVisitReport(from: string, to: string): Promise<StoreVisitReportRow[]> {
  await tick();
  const d = dpLoad();
  const db = load();
  const rows = d.plan.filter((p) => p.date >= from && p.date <= to).map((p): StoreVisitReportRow => {
    const st = p.snap ?? d.stores[p.code] ?? { name: p.code, type: '', address: '' };
    const v = (d.visits ?? []).find((x) => x.plan_id === p.id);
    const veh = db.vehicles.find((x) => dpPlateKey(x.plate) === dpPlateKey(p.plate));
    const trip = db.trips.find((t) => t.activity_date === p.date && t.vehicle_id === veh?.id);
    return {
      plan_id: p.id, plan_date: p.date, plate: p.plate, sort_order: p.sort, sap_code: p.code, store_name: st.name, store_type: st.type,
      bills: p.bills.length, plan_cases: p.bills.some((b) => b.cases !== null) ? p.bills.reduce((n, b) => n + (b.cases ?? 0), 0) : null,
      status: v?.status ?? 'none', started_at: v?.started_at ?? null, ended_at: v?.ended_at ?? null,
      seconds: v?.status === 'done' && v.started_at && v.ended_at ? Math.round((Date.parse(v.ended_at) - Date.parse(v.started_at)) / 1000) : null,
      cases: v?.cases ?? null, skus: v?.skus ?? null, distance_m: v?.distance_m ?? null, move_method: v?.method ?? null,
      note: v?.note ?? '', by_name: v?.by || null, dman_name: trip ? (db.employees.find((e) => e.id === trip.dman_id)?.name ?? null) : null,
    };
  });
  return rows.sort((a, b) => b.plan_date.localeCompare(a.plan_date) || a.plate.localeCompare(b.plate)
    || (a.started_at ?? '9').localeCompare(b.started_at ?? '9') || a.sort_order - b.sort_order);
}
