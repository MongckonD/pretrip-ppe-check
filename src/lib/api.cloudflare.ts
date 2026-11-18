/**
 * Backend: Cloudflare Worker API (/api/*) → D1 (data) + R2 (photos).
 * Same functions as api.mock.ts so pages do not care which one is active.
 * Login: id_user + password; the Worker sets an HttpOnly session cookie that the browser sends automatically.
 */
import type { LicenseForm, LicenseInfo, LicenseRow } from './license';
import type {
  Employee, Master, PpeForm, PpeInspection, TripActivity, Vehicle, VehicleForm, VehicleInspection,
} from './types';

/** admin = ทุกอย่าง · user = พนักงาน */
export type Role = 'admin' | 'user';

export interface Me {
  id: string;
  display_name: string;
  role: Role;
  employee_id: string | null;
  must_change_password: boolean;
  /** has accepted the current personal-data consent */
  consented: boolean;
  /** has a current driver licence on file */
  has_license: boolean;
}

export interface AppUser {
  id: string;
  display_name: string;
  employee_id: string | null;
  role: Role;
  active: boolean;
  must_change_password: boolean;
  locked: boolean;
  last_login_at: string | null;
  created_at: string;
}

/** Fired when the server says the session is gone, so the app can show the login screen. */
export const UNAUTHORIZED_EVENT = 'pretrip:unauthorized';

async function call<T>(method: string, path: string, body?: unknown, raw?: Blob | FormData): Promise<T> {
  const headers: Record<string, string> = { 'x-requested-with': 'pretrip' };
  let payload: BodyInit | undefined;
  if (raw instanceof FormData) {
    payload = raw; // the browser sets the multipart content-type
  } else if (raw) {
    payload = raw;
    headers['content-type'] = raw.type || 'application/octet-stream';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
  }
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
    throw new Error(`เซิร์ฟเวอร์ตอบกลับผิดพลาด (${res.status}) ลองรีเฟรชหน้าเว็บ`);
  }
  const data = await res.json().catch(() => null) as (T & { error?: string }) | null;
  if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) throw new Error(data?.error || `เซิร์ฟเวอร์ตอบกลับผิดพลาด (${res.status})`);
  return data as T;
}

const q = (opts: { date?: string; month?: string }) => {
  const p = new URLSearchParams();
  if (opts.date) p.set('date', opts.date);
  if (opts.month) p.set('month', opts.month);
  return p.toString();
};

/* ---------- login / session ---------- */
export const authStatus = () => call<{ needs_setup: boolean; user: Me | null }>('GET', '/api/auth/status');
export const login = (username: string, password: string) =>
  call<{ user: Me }>('POST', '/api/auth/login', { username, password }).then((r) => r.user);
export const setupAdmin = (username: string, display_name: string, password: string) =>
  call<{ user: Me }>('POST', '/api/auth/setup', { username, display_name, password }).then((r) => r.user);
export async function logout() {
  await call('POST', '/api/auth/logout');
}
export async function changePassword(current_password: string, new_password: string) {
  await call('POST', '/api/auth/password', { current_password, new_password });
}

/* ---------- user administration (admin) ---------- */
export const listUsers = () => call<AppUser[]>('GET', '/api/users');
export async function createUser(u: { id: string; display_name: string; role: Role; employee_id: string; password: string }) {
  await call('POST', '/api/users', u);
}
export async function updateUser(id: string, patch: Partial<{ display_name: string; role: Role; active: boolean; employee_id: string; unlock: boolean }>) {
  await call('PUT', `/api/users/${encodeURIComponent(id)}`, patch);
}
export async function deleteUser(id: string) {
  await call('DELETE', `/api/users/${encodeURIComponent(id)}`);
}
export async function resetUserPassword(id: string, password: string) {
  await call('POST', `/api/users/${encodeURIComponent(id)}/reset-password`, { password });
}

/* ---------- master ---------- */
export const loadMaster = () => call<Master>('GET', '/api/master');

export async function upsertEmployee(e: Employee) {
  await call('PUT', `/api/employees/${encodeURIComponent(e.id)}`, { name: e.name, role: e.role, active: e.active });
}
export async function upsertVehicle(v: Partial<Vehicle> & { plate: string }) {
  await call('PUT', '/api/vehicles', { id: v.id ?? null, plate: v.plate, type: v.type ?? '', active: v.active ?? true });
}
export async function deleteVehicle(id: string) {
  await call('DELETE', `/api/vehicles/${encodeURIComponent(id)}`);
}

/* ---------- vehicle inspections ---------- */
export const listVehicleInspections = (opts: { date?: string; month?: string }) =>
  call<VehicleInspection[]>('GET', `/api/vehicle-inspections?${q(opts)}`);

/** note + photo only for items that are ไม่ผ่าน */
export function failedDefects(f: VehicleForm) {
  return Object.fromEntries(Object.entries(f.results).filter(([, v]) => v === 2).map(([k]) => {
    const d = f.defects[Number(k)];
    return [k, { note: (d?.note ?? '').trim(), photo: d?.photo ?? null }];
  }));
}

export async function saveVehicleInspection(f: VehicleForm) {
  const r = await call<{ id: string }>('POST', '/api/vehicle-inspections', {
    id: f.id, date: f.date, time: f.time, dman: f.dman, h1: f.h1, h2: f.h2,
    plate: f.plate.trim(), mileage: f.mileage.trim(), note: f.note, results: f.results, photos: f.photos,
    defects: failedDefects(f),
  });
  return r.id;
}

export async function deleteVehicleInspection(r: VehicleInspection) {
  await call('DELETE', `/api/vehicle-inspections/${encodeURIComponent(r.id)}`); // server also removes its photos
}

/** Keep-alive while the user is active: any signed-in request moves the idle deadline forward. */
export async function keepAlive() {
  await call('GET', '/api/me');
}

/* ---------- consent + driver licence ---------- */
export async function acceptConsent(version: string) {
  await call('POST', '/api/consent', { version });
}
export const getMyLicense = () => call<LicenseInfo>('GET', '/api/me/license');
export async function saveMyLicense(f: LicenseForm) {
  const fd = new FormData();
  fd.set('photo', f.photo, 'license.jpg');
  fd.set('full_name', f.full_name);
  fd.set('license_no', f.license_no);
  fd.set('expiry_date', f.lifetime ? '' : f.expiry_date);
  fd.set('lifetime', f.lifetime ? '1' : '0');
  fd.set('ocr_used', f.ocr_used ? '1' : '0');
  return call<LicenseInfo>('POST', '/api/me/license', undefined, fd);
}
export const listLicenses = () => call<{ rows: LicenseRow[]; warn_days: number; today: string }>('GET', '/api/licenses');
export const licensePhotoUrl = (id: string) => `/api/licenses/${encodeURIComponent(id)}/photo`;

/* ---------- photos ---------- */
export async function uploadPhoto(blob: Blob, date: string) {
  const r = await call<{ key: string }>('POST', `/api/photos?date=${encodeURIComponent(date)}`, undefined, blob);
  return r.key;
}
export async function removePhotos(paths: string[]) {
  if (paths.length) await call('POST', '/api/photos/delete', { keys: paths });
}
/** Photos are served by the Worker after it checks the login, so the "signed" URL is just our path. */
export async function signedUrls(paths: string[]) {
  return Object.fromEntries(paths.map((p) => [p, `/api/photos/${p.split('/').map(encodeURIComponent).join('/')}`]));
}

/* ---------- PPE ---------- */
export const listPpeInspections = (opts: { date?: string; month?: string }) =>
  call<PpeInspection[]>('GET', `/api/ppe-inspections?${q(opts)}`);

export async function savePpeInspections(f: PpeForm) {
  const rows = Object.fromEntries(Object.entries(f.rows).filter(([, v]) => Object.keys(v).length));
  const r = await call<{ count: number }>('POST', '/api/ppe-inspections', {
    date: f.date, plate: f.plate.trim(), inspector: f.inspector, rows,
  });
  return r.count;
}

export async function deletePpeInspection(id: string) {
  await call('DELETE', `/api/ppe-inspections/${encodeURIComponent(id)}`);
}

/* ---------- Time activities ---------- */
export const listTripActivities = (opts: { date?: string; month?: string }) =>
  call<TripActivity[]>('GET', `/api/trip-activities?${q(opts)}`);


export async function deleteTripActivity(id: string) {
  await call('DELETE', `/api/trip-activities/${encodeURIComponent(id)}`);
}
/** "เริ่มการทำงาน": the server stamps the start time on today's trip of this vehicle */
export const startWork = (plate: string) =>
  call<{ id: string; work_started_at: string }>('POST', '/api/trip-activities/start', { plate: plate.trim() });
/** "จบงาน / หยุดเวลาทำงาน" */
export const endWork = (id: string) =>
  call<{ id: string; work_ended_at: string }>('POST', `/api/trip-activities/${encodeURIComponent(id)}/end`, {});

/** Only meaningful in test mode. */
export async function resetDemo(_empty = false) {
  throw new Error('ใช้ได้เฉพาะโหมดทดสอบ');
}
