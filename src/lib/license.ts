/** Driver licence types shared by the real API, the test-mode API and the pages. */

/** Warn this many days before expiry (worker/license-routes.ts LICENSE_WARN_DAYS is the same). */
export const LICENSE_WARN_DAYS = 60;

/**
 * false (for now) = the licence screen after login has "ข้ามไปหน้าหลัก"; a reminder shows until it is sent.
 * true            = no skipping. Keep in sync with REQUIRE_LICENSE in worker/index.ts.
 */
export const LICENSE_REQUIRED = false;

export type LicenseStatus = 'ok' | 'expiring' | 'expired' | 'lifetime';

export interface DriverLicense {
  id: string;
  full_name: string;
  license_no: string;
  /** YYYY-MM-DD (Gregorian); null for a lifetime licence */
  expiry_date: string | null;
  lifetime: boolean;
  submitted_at: string;
  has_photo: boolean;
  status: LicenseStatus;
  /** days until expiry (negative = already expired); null for lifetime */
  days_left: number | null;
}

export interface LicenseInfo { license: DriverLicense | null; warn_days: number }

export interface LicenseRow {
  user_id: string;
  display_name: string;
  employee_id: string | null;
  employee_name: string | null;
  license: DriverLicense;
  status: LicenseStatus;
}

export interface LicenseForm {
  photo: Blob;
  full_name: string;
  license_no: string;
  expiry_date: string;
  lifetime: boolean;
  ocr_used: boolean;
}

export function licenseStatus(expiry: string | null, lifetime: boolean, today: string) {
  if (lifetime || !expiry) return { status: 'lifetime' as LicenseStatus, days_left: null as number | null };
  const days = Math.round((Date.parse(expiry) - Date.parse(today)) / 86400_000);
  const status: LicenseStatus = days < 0 ? 'expired' : days <= LICENSE_WARN_DAYS ? 'expiring' : 'ok';
  return { status, days_left: days as number | null };
}

/** "12 ม.ค. 2570" */
export function thaiDate(iso: string | null): string {
  if (!iso) return '–';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Short Thai sentence for a status, e.g. "เหลืออีก 12 วัน". */
export function statusText(l: Pick<DriverLicense, 'status' | 'days_left'> | null): string {
  if (!l) return 'ยังไม่ได้ส่งใบขับขี่';
  if (l.status === 'lifetime') return 'ใบตลอดชีพ';
  const d = l.days_left ?? 0;
  if (l.status === 'expired') return d === -1 ? 'หมดอายุเมื่อวาน' : `หมดอายุแล้ว ${-d} วัน`;
  if (d === 0) return 'หมดอายุวันนี้';
  return `เหลืออีก ${d} วัน`;
}

/**
 * "ข้ามไปหน้าหลัก" on the licence screen: remembered for this account in this browser tab only
 * (a page refresh keeps it), and cleared on every sign-in and sign-out — so after logging in,
 * anyone without a licence sees the licence screen again, whoever used the tab before.
 */
const SKIP_PREFIX = 'license-skipped';
const skipKey = (userId: string) => `${SKIP_PREFIX}:${userId}`;
export function readLicenseSkip(userId: string | undefined): boolean {
  if (!userId) return false;
  try { return sessionStorage.getItem(skipKey(userId)) === '1'; } catch { return false; }
}
export function writeLicenseSkip(userId: string | undefined) {
  if (!userId) return;
  try { sessionStorage.setItem(skipKey(userId), '1'); } catch { /* storage unavailable */ }
}
export function clearLicenseSkips() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k === SKIP_PREFIX || k.startsWith(SKIP_PREFIX + ':')) sessionStorage.removeItem(k);
  } catch { /* storage unavailable */ }
}
