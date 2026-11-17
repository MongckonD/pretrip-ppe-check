/**
 * Authentication: id_user + password, managed by the app.
 *  - Passwords: PBKDF2-SHA256 (password.ts)
 *  - Sessions: random token in an HttpOnly cookie; only its SHA-256 is stored in D1
 *  - Brute force: per-account lock after MAX_FAILED wrong passwords, and per-IP attempt limit
 */
import { HttpError } from './http';
import { randomToken, sha256Hex } from './password';

/** admin = ทุกอย่าง · user = พนักงาน (บันทึกการตรวจ, ดูข้อมูล) */
export type Role = 'admin' | 'user';

export interface Actor {
  id: string;
  display_name: string;
  role: Role;
  employee_id: string | null;
  must_change_password: boolean;
  /** has accepted the current personal-data consent (CONSENT_VERSION) */
  consented: boolean;
  /** has a current driver licence on file (staff must send one before using the app) */
  has_license: boolean;
  /** SHA-256 of this request's session token (to keep this session on password change) */
  session: string;
}

interface AuthEnv { DB: D1Database }

export const COOKIE = '__Host-pt_session';
/**
 * Idle timeout (both roles): a session ends after this many minutes without any request.
 * While the app is in use it stays alive (every request — and the page's keep-alive ping — moves the
 * deadline forward). The cookie has no Max-Age, so closing the browser also ends it.
 * src/lib/session.ts IDLE_MINUTES must match.
 */
export const IDLE_MINUTES = 30;
/** move the deadline forward at most once a minute (limits D1 writes) */
const SLIDE_EVERY_MS = 60_000;
export const MAX_FAILED = 5;              // wrong passwords before the account locks
export const LOCK_MINUTES = 15;
export const IP_MAX_ATTEMPTS = 30;        // login attempts per IP per window
export const IP_WINDOW_MINUTES = 15;
/**
 * Version of the personal-data consent text (src/lib/consent.ts CONSENT.version must match).
 * Change both when the wording changes: every user is asked to accept again.
 */
export const CONSENT_VERSION = '2026-11-17';

const iso = (ms: number) => new Date(ms).toISOString();

export function readCookie(req: Request, name = COOKIE): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

/** Browser-session cookie (no Max-Age / Expires): the browser drops it when it is closed. */
export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** Create a session row and return the cookie value to send. */
export async function createSession(env: AuthEnv, userId: string, req: Request) {
  const token = randomToken();
  const hash = await sha256Hex(token);
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 200);
  const stmt = env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES (?1, ?2, ?3, ?4)`,
  ).bind(hash, userId, iso(Date.now() + IDLE_MINUTES * 60_000), ua);
  return { token, hash, stmt };
}

interface SessionRow {
  user_id: string; expires_at: string; last_seen_at: string;
  display_name: string; role: Role; active: number; employee_id: string | null; must_change_password: number;
  consented: number;
  has_license: number;
}

/**
 * Resolve the signed-in user, or throw 401.
 * Sessions idle longer than IDLE_MINUTES are rejected; each request slides the deadline forward
 * (written at most once a minute).
 */
export async function authenticate(req: Request, env: AuthEnv, exec?: ExecutionContext): Promise<Actor> {
  const token = readCookie(req);
  if (!token || token.length > 100) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.user_id, s.expires_at, s.last_seen_at,
            u.display_name, u.role, u.active, u.employee_id, u.must_change_password,
            EXISTS (SELECT 1 FROM user_consents c WHERE c.user_id = s.user_id AND c.version = ?2) AS consented,
            EXISTS (SELECT 1 FROM driver_licenses d WHERE d.user_id = s.user_id AND d.replaced_at IS NULL) AS has_license
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?1`,
  ).bind(hash, CONSENT_VERSION).first<SessionRow>();
  const now = Date.now();
  // idle check on last_seen_at too, so sessions made under an older, longer rule also end on time
  if (!row || Date.parse(row.expires_at) <= now || now - Date.parse(row.last_seen_at) > IDLE_MINUTES * 60_000) {
    throw new HttpError(401, 'ไม่ได้ใช้งานนานเกินไป ระบบออกจากระบบให้อัตโนมัติ กรุณาเข้าสู่ระบบใหม่');
  }
  if (row.active !== 1) throw new HttpError(401, 'บัญชีนี้ถูกปิดการใช้งาน');

  if (now - Date.parse(row.last_seen_at) > SLIDE_EVERY_MS) {
    const slide = env.DB.prepare(`UPDATE sessions SET last_seen_at = ?2, expires_at = ?3 WHERE token_hash = ?1`)
      .bind(hash, iso(now), iso(now + IDLE_MINUTES * 60_000)).run();
    if (exec) exec.waitUntil(slide); else await slide;
  }
  return {
    id: row.user_id, display_name: row.display_name, role: row.role, employee_id: row.employee_id,
    must_change_password: row.must_change_password === 1, consented: row.consented === 1,
    has_license: row.has_license === 1, session: hash,
  };
}

/**
 * Per-IP limit on login attempts. Returns normally, or throws 429.
 * Counts every attempt (right or wrong) inside a fixed window.
 */
export async function throttleLogin(env: AuthEnv, ip: string) {
  const now = Date.now();
  const windowStart = iso(now - IP_WINDOW_MINUTES * 60_000);
  const row = await env.DB.prepare(
    `INSERT INTO login_throttle (ip, window_start, attempts) VALUES (?1, ?2, 1)
     ON CONFLICT (ip) DO UPDATE SET
       attempts     = CASE WHEN window_start < ?3 THEN 1 ELSE attempts + 1 END,
       window_start = CASE WHEN window_start < ?3 THEN excluded.window_start ELSE window_start END
     RETURNING attempts, window_start`,
  ).bind(ip, iso(now), windowStart).first<{ attempts: number; window_start: string }>();
  if (row && row.attempts > IP_MAX_ATTEMPTS) {
    const wait = Math.max(1, Math.ceil((Date.parse(row.window_start) + IP_WINDOW_MINUTES * 60_000 - now) / 60_000));
    throw new HttpError(429, `ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอ ${wait} นาที`);
  }
}

const RANK: Record<Role, number> = { user: 1, admin: 2 };
const ROLE_LABEL: Record<Role, string> = { user: 'ผู้ใช้', admin: 'ผู้ดูแลระบบ' };

export function requireRole(actor: Actor, min: Role) {
  if (RANK[actor.role] < RANK[min]) throw new HttpError(403, min === 'admin' ? 'เฉพาะผู้ดูแลระบบ (admin) เท่านั้น' : `ต้องมีสิทธิ์ระดับ${ROLE_LABEL[min]}ขึ้นไป`);
}

/** Staff work (recording / deleting inspections, trips, photos) — role `user` only; admins have their own page. */
export function requireStaff(actor: Actor) {
  if (actor.role !== 'user') throw new HttpError(403, 'ส่วนนี้สำหรับพนักงาน (user) เท่านั้น');
}

export const isRole = (v: unknown): v is Role => typeof v === 'string' && v in RANK;
