/**
 * Personal-data consent and driver licenses.
 *   POST /api/consent              accept the current consent text (any signed-in user)
 *   GET  /api/me/license           my current license + expiry status            (user)
 *   POST /api/me/license           send a new license: photo + name, number, expiry (user, multipart)
 *   GET  /api/licenses             every employee's license status               (admin)
 *   GET  /api/licenses/:id/photo   license photo                                 (admin, or the owner)
 * Photos live in their own private R2 bucket (binding LICENSES = pretrip-driver-licenses) as
 * licenses/<user>/<uuid>.jpg; D1 keeps only the key. Sending a new license replaces the old one and deletes its photo.
 * Staff cannot use the rest of the app until they have a current license on file (gate in index.ts).
 */
import { CONSENT_VERSION, requireRole, requireStaff } from './auth';
import { HttpError, bad, conflict, json, notFound } from './http';
import { audit, type Ctx } from './routes';
import { isDate, todayTH } from './validate';

/** Warn this many days before a license expires (src/lib/license.ts uses the same number). */
export const LICENSE_WARN_DAYS = 60;
const MAX_LICENSE_PHOTO_BYTES = 5 * 1024 * 1024;

type LicenseStatus = 'ok' | 'expiring' | 'expired' | 'lifetime';

interface LicenseRow {
  id: string; full_name: string; license_no: string; expiry_date: string | null;
  lifetime: number; ocr_used: number; created_at: string; photo_r2_key: string | null;
}

const DAY = 86400_000;
function licenseStatus(expiry: string | null, lifetime: boolean, today = todayTH()) {
  if (lifetime || !expiry) return { status: 'lifetime' as LicenseStatus, days_left: null };
  const days = Math.round((Date.parse(expiry) - Date.parse(today)) / DAY);
  const status: LicenseStatus = days < 0 ? 'expired' : days <= LICENSE_WARN_DAYS ? 'expiring' : 'ok';
  return { status, days_left: days };
}

const publicLicense = (r: LicenseRow) => ({
  id: r.id, full_name: r.full_name, license_no: r.license_no, expiry_date: r.expiry_date,
  lifetime: r.lifetime === 1, submitted_at: r.created_at, has_photo: !!r.photo_r2_key,
  ...licenseStatus(r.expiry_date, r.lifetime === 1),
});

/* ---------------------------------------------------------------------
 * Consent
 * ------------------------------------------------------------------- */

/** POST /api/consent { version } — the version shown on screen must be the current one. */
export async function acceptConsent({ env, actor, req }: Ctx) {
  const b = await req.json().catch(() => null) as { version?: unknown } | null;
  if (!b || b.version !== CONSENT_VERSION) {
    throw conflict('ข้อความความยินยอมมีฉบับใหม่ กรุณารีเฟรชหน้าเว็บแล้วอ่านอีกครั้ง');
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user_consents (user_id, version, ip, user_agent) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (user_id, version) DO NOTHING`,
    ).bind(actor.id, CONSENT_VERSION, req.headers.get('cf-connecting-ip'), (req.headers.get('user-agent') ?? '').slice(0, 200)),
    audit(env, actor, 'create', 'user_consents', actor.id, { version: CONSENT_VERSION }),
  ]);
  return json({ ok: true, version: CONSENT_VERSION });
}

/* ---------------------------------------------------------------------
 * My license
 * ------------------------------------------------------------------- */

const LICENSE_COLS = `id, full_name, license_no, expiry_date, lifetime, ocr_used, created_at, photo_r2_key`;

export async function getMyLicense({ env, actor }: Ctx) {
  const row = await env.DB.prepare(`SELECT ${LICENSE_COLS} FROM driver_licenses WHERE user_id = ?1 AND replaced_at IS NULL`)
    .bind(actor.id).first<LicenseRow>();
  return json({ license: row ? publicLicense(row) : null, warn_days: LICENSE_WARN_DAYS });
}

function sniffImage(b: Uint8Array): { type: string; ext: string } | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: 'image/png', ext: 'png' };
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') {
    return { type: 'image/webp', ext: 'webp' };
  }
  return null;
}

const field = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' ? v : '';
};

/** POST /api/me/license (multipart): photo, full_name, license_no, expiry_date | lifetime=1, ocr_used=0|1 */
export async function saveMyLicense({ env, actor, req, exec }: Ctx) {
  requireStaff(actor);
  if (Number(req.headers.get('content-length') ?? '0') > MAX_LICENSE_PHOTO_BYTES + 64 * 1024) {
    throw new HttpError(413, 'รูปใหญ่เกิน 5 MB');
  }
  let form: FormData;
  try { form = await req.formData(); } catch { throw bad('ข้อมูลที่ส่งมาไม่ถูกต้อง'); }

  const fullName = field(form, 'full_name').replace(/\s+/g, ' ').trim();
  if (fullName.length < 2 || fullName.length > 120) throw bad('กรอกชื่อ-นามสกุลตามใบขับขี่');
  const licenseNo = field(form, 'license_no').replace(/[\s-]/g, '').toUpperCase();
  if (!/^[0-9A-Z]{5,20}$/.test(licenseNo)) throw bad('เลขที่ใบขับขี่ต้องเป็นตัวเลข/ตัวอักษร 5–20 ตัว');
  const lifetime = field(form, 'lifetime') === '1';
  let expiry: string | null = null;
  if (!lifetime) {
    expiry = field(form, 'expiry_date');
    if (!isDate(expiry)) throw bad('กรอกวันหมดอายุ (หรือเลือก "ตลอดชีพ")');
    const y = Number(expiry.slice(0, 4));
    if (y < 2000 || y > 2100) throw bad('วันหมดอายุไม่ถูกต้อง (ใช้ปี ค.ศ.)');
  }
  const ocrUsed = field(form, 'ocr_used') === '1' ? 1 : 0;

  const photo = form.get('photo');
  if (!photo || typeof photo === 'string') throw bad('กรุณาถ่ายรูปใบขับขี่');
  if (photo.size > MAX_LICENSE_PHOTO_BYTES) throw new HttpError(413, 'รูปใหญ่เกิน 5 MB');
  const bytes = new Uint8Array(await photo.arrayBuffer());
  const img = sniffImage(bytes);
  if (!img) throw new HttpError(415, 'รองรับเฉพาะรูป JPEG, PNG หรือ WebP');

  const key = `licenses/${actor.id}/${crypto.randomUUID()}.${img.ext}`;
  await env.LICENSES.put(key, bytes, { httpMetadata: { contentType: img.type }, customMetadata: { uploadedBy: actor.id } });

  const old = await env.DB.prepare(`SELECT photo_r2_key FROM driver_licenses WHERE user_id = ?1 AND replaced_at IS NULL`)
    .bind(actor.id).first<{ photo_r2_key: string | null }>();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE driver_licenses SET replaced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), photo_r2_key = NULL
         WHERE user_id = ?1 AND replaced_at IS NULL`,
      ).bind(actor.id),
      env.DB.prepare(
        `INSERT INTO driver_licenses (user_id, full_name, license_no, expiry_date, lifetime, photo_r2_key, ocr_used)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      ).bind(actor.id, fullName, licenseNo, expiry, lifetime ? 1 : 0, key, ocrUsed),
      // the audit log keeps when and the expiry, not the license number
      audit(env, actor, 'update', 'driver_licenses', actor.id, { expiry_date: expiry, lifetime, ocr_used: !!ocrUsed }),
    ]);
  } catch (e) {
    exec.waitUntil(env.LICENSES.delete(key));
    throw e;
  }
  if (old?.photo_r2_key) exec.waitUntil(env.LICENSES.delete(old.photo_r2_key));

  const row = await env.DB.prepare(`SELECT ${LICENSE_COLS} FROM driver_licenses WHERE user_id = ?1 AND replaced_at IS NULL`)
    .bind(actor.id).first<LicenseRow>();
  return json({ license: row ? publicLicense(row) : null, warn_days: LICENSE_WARN_DAYS }, 201);
}

/* ---------------------------------------------------------------------
 * Admin
 * ------------------------------------------------------------------- */

const STATUS_ORDER: Record<LicenseStatus, number> = { expired: 0, expiring: 1, ok: 2, lifetime: 3 };

/** GET /api/licenses — current licences that active staff have sent, worst status first. */
export async function listLicenses({ env, actor }: Ctx) {
  requireRole(actor, 'admin');
  const { results } = await env.DB.prepare(
    `SELECT u.id AS user_id, u.display_name, u.employee_id, e.name AS employee_name,
            l.id, l.full_name, l.license_no, l.expiry_date, l.lifetime, l.ocr_used, l.created_at, l.photo_r2_key
     FROM driver_licenses l
     JOIN users u ON u.id = l.user_id
     LEFT JOIN employees e ON e.id = u.employee_id
     WHERE l.replaced_at IS NULL AND u.role = 'user' AND u.active = 1`,
  ).all<LicenseRow & { user_id: string; display_name: string; employee_id: string | null; employee_name: string | null }>();
  const rows = results.map((r) => {
    const license = publicLicense(r);
    return {
      user_id: r.user_id, display_name: r.display_name, employee_id: r.employee_id, employee_name: r.employee_name,
      license, status: license.status,
    };
  });
  rows.sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
    || ((a.license.days_left ?? 1e9) - (b.license.days_left ?? 1e9))
    || a.user_id.localeCompare(b.user_id));
  return json({ rows, warn_days: LICENSE_WARN_DAYS, today: todayTH() });
}

/** GET /api/licenses/:id/photo — admins, or the license owner. */
export async function getLicensePhoto({ env, actor, params }: Ctx) {
  const id = decodeURIComponent(params[0]);
  if (!/^[0-9a-f]{32}$/.test(id)) throw notFound('ไม่พบรูป');
  const row = await env.DB.prepare(`SELECT user_id, photo_r2_key FROM driver_licenses WHERE id = ?1`)
    .bind(id).first<{ user_id: string; photo_r2_key: string | null }>();
  if (!row || (actor.role !== 'admin' && row.user_id !== actor.id)) throw notFound('ไม่พบรูป');
  if (!row.photo_r2_key) throw notFound('รูปนี้ถูกลบแล้ว (มีการส่งใบใหม่)');
  const obj = await env.LICENSES.get(row.photo_r2_key);
  if (!obj) throw notFound('ไม่พบรูป');
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg',
      // personal document: never cached anywhere
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
