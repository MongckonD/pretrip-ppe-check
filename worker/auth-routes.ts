/** Login, logout, first-time setup, password change, and user administration. */
import {
  CONSENT_VERSION, IP_WINDOW_MINUTES, LOCK_MINUTES, MAX_FAILED, authenticate, clearCookie, createSession, isRole,
  readCookie, requireRole, sessionCookie, throttleLogin, type Actor, type Role,
} from './auth';
import { HttpError, bad, conflict, json, notFound, readJson } from './http';
import { burnPasswordCheck, hashPassword, passwordProblem, sha256Hex, verifyPassword } from './password';
import type { Ctx, Env } from './routes';
import { bool, optEmployeeId, str } from './validate';

const NOW_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
const GENERIC_FAIL = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';

/** id_user: a-z 0-9 . _ - (3–32), case-insensitive input. */
export function userId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return /^[a-z0-9._-]{3,32}$/.test(s) ? s : null;
}
function reqUserId(v: unknown): string {
  const id = userId(v);
  if (!id) throw bad('ชื่อผู้ใช้ต้องเป็นตัวอักษรอังกฤษพิมพ์เล็ก ตัวเลข หรือ . _ - ยาว 3–32 ตัว');
  return id;
}
function reqPassword(pw: unknown, id: string): string {
  const problem = passwordProblem(pw, id);
  if (problem) throw bad(problem);
  return pw as string;
}

const clientIp = (req: Request) => req.headers.get('cf-connecting-ip') ?? 'local';

function audit(env: Env, actor: string | null, action: string, entity: string, id: string, detail?: unknown) {
  return env.DB.prepare(`INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(actor, action, entity, id, detail === undefined ? null : JSON.stringify(detail));
}

const publicUser = (a: Actor) => ({
  id: a.id, display_name: a.display_name, role: a.role, employee_id: a.employee_id,
  must_change_password: a.must_change_password, consented: a.consented, has_license: a.has_license,
});

/* ---------------------------------------------------------------------
 * Public endpoints (no session needed)
 * ------------------------------------------------------------------- */

/** GET /api/auth/status → { needs_setup, user } — tells the app which screen to show. */
export async function authStatus(req: Request, env: Env, exec: ExecutionContext) {
  const any = await env.DB.prepare(`SELECT EXISTS (SELECT 1 FROM users) AS has`).first<{ has: number }>();
  if (!any?.has) return json({ needs_setup: true, user: null });
  try {
    return json({ needs_setup: false, user: publicUser(await authenticate(req, env, exec)) });
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) return json({ needs_setup: false, user: null });
    throw e;
  }
}

/** POST /api/auth/setup — creates the first admin. Works only while there are no users at all. */
export async function setup(req: Request, env: Env) {
  const b = await readJson(req);
  const id = reqUserId(b.username);
  const display = str(b.display_name, 'ชื่อที่แสดง', 100);
  const pw = reqPassword(b.password, id);
  const hash = await hashPassword(pw);
  const r = await env.DB.prepare(
    `INSERT INTO users (id, display_name, role, password_hash, must_change_password, password_changed_at)
     SELECT ?1, ?2, 'admin', ?3, 0, ${NOW_SQL} WHERE NOT EXISTS (SELECT 1 FROM users)`,
  ).bind(id, display, hash).run();
  if (r.meta.changes !== 1) throw conflict('ระบบตั้งค่าผู้ดูแลไปแล้ว กรุณาเข้าสู่ระบบ');
  const s = await createSession(env, id, req);
  await env.DB.batch([s.stmt, audit(env, id, 'create', 'users', id, { role: 'admin', setup: true })]);
  return json({ user: { id, display_name: display, role: 'admin', employee_id: null, must_change_password: false, consented: false, has_license: false } }, 201,
    { 'set-cookie': sessionCookie(s.token) });
}

/** POST /api/auth/login */
export async function login(req: Request, env: Env) {
  await throttleLogin(env, clientIp(req));
  const b = await readJson(req);
  const id = userId(b.username);
  const pw = typeof b.password === 'string' ? b.password : '';
  if (!id || !pw || pw.length > 128) {
    await burnPasswordCheck(pw.slice(0, 128));
    throw new HttpError(401, GENERIC_FAIL);
  }
  const u = await env.DB.prepare(
    `SELECT id, display_name, role, active, employee_id, password_hash, must_change_password, failed_logins, locked_until
     FROM users WHERE id = ?1`,
  ).bind(id).first<{
    id: string; display_name: string; role: Role; active: number; employee_id: string | null;
    password_hash: string; must_change_password: number; failed_logins: number; locked_until: string | null;
  }>();
  if (!u) {
    await burnPasswordCheck(pw);
    throw new HttpError(401, GENERIC_FAIL);
  }
  const now = Date.now();
  if (u.locked_until && Date.parse(u.locked_until) > now) {
    const mins = Math.ceil((Date.parse(u.locked_until) - now) / 60_000);
    throw new HttpError(429, `บัญชีนี้ถูกล็อกชั่วคราวเพราะใส่รหัสผ่านผิดหลายครั้ง ลองใหม่ใน ${mins} นาที หรือให้ผู้ดูแลปลดล็อก`);
  }
  if (!(await verifyPassword(pw, u.password_hash))) {
    const failed = u.failed_logins + 1;
    const lock = failed >= MAX_FAILED;
    await env.DB.prepare(`UPDATE users SET failed_logins = ?2, locked_until = ?3 WHERE id = ?1`)
      .bind(id, lock ? 0 : failed, lock ? new Date(now + LOCK_MINUTES * 60_000).toISOString() : null).run();
    if (lock) throw new HttpError(429, `ใส่รหัสผ่านผิด ${MAX_FAILED} ครั้ง บัญชีถูกล็อก ${LOCK_MINUTES} นาที`);
    throw new HttpError(401, `${GENERIC_FAIL} (เหลืออีก ${MAX_FAILED - failed} ครั้งก่อนบัญชีถูกล็อก)`);
  }
  if (u.active !== 1) throw new HttpError(403, 'บัญชีนี้ถูกปิดการใช้งาน ติดต่อผู้ดูแลระบบ');

  const s = await createSession(env, id, req);
  const onboard = await env.DB.prepare(
    `SELECT EXISTS (SELECT 1 FROM user_consents WHERE user_id = ?1 AND version = ?2) AS consented,
            EXISTS (SELECT 1 FROM driver_licenses WHERE user_id = ?1 AND replaced_at IS NULL) AS has_license`,
  ).bind(id, CONSENT_VERSION).first<{ consented: number; has_license: number }>();
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ${NOW_SQL} WHERE id = ?1`).bind(id),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1 AND expires_at <= ?2`).bind(id, new Date(now).toISOString()),
    s.stmt,
    audit(env, id, 'login', 'users', id),
  ]);
  return json({
    user: {
      id, display_name: u.display_name, role: u.role, employee_id: u.employee_id,
      must_change_password: u.must_change_password === 1, consented: onboard?.consented === 1,
      has_license: onboard?.has_license === 1,
    },
  }, 200, { 'set-cookie': sessionCookie(s.token) });
}

/** POST /api/auth/logout — always succeeds and clears the cookie. */
export async function logout(req: Request, env: Env) {
  const token = readCookie(req);
  if (token && token.length <= 100) {
    const hash = await sha256Hex(token);
    const row = await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?1 RETURNING user_id`).bind(hash).first<{ user_id: string }>();
    if (row) await audit(env, row.user_id, 'logout', 'users', row.user_id).run();
  }
  return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
}

/* ---------------------------------------------------------------------
 * Signed-in endpoints
 * ------------------------------------------------------------------- */

export async function getMe({ actor }: Ctx) {
  return json(publicUser(actor));
}

/** POST /api/auth/password { current_password, new_password } — also signs out the user's other devices. */
export async function changePassword({ env, actor, req }: Ctx) {
  const b = await readJson(req);
  const cur = typeof b.current_password === 'string' ? b.current_password : '';
  const row = await env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?1`).bind(actor.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(cur, row.password_hash))) throw bad('รหัสผ่านปัจจุบันไม่ถูกต้อง');
  const pw = reqPassword(b.new_password, actor.id);
  if (pw === cur) throw bad('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
  const hash = await hashPassword(pw);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET password_hash = ?2, must_change_password = 0, password_changed_at = ${NOW_SQL} WHERE id = ?1`,
    ).bind(actor.id, hash),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1 AND token_hash <> ?2`).bind(actor.id, actor.session),
    audit(env, actor.id, 'password_change', 'users', actor.id),
  ]);
  return json({ ok: true });
}

/* ---------------------------------------------------------------------
 * User administration (admin only)
 * ------------------------------------------------------------------- */

const USER_COLS = `id, display_name, employee_id, role, active, must_change_password, failed_logins,
  locked_until, last_login_at, password_changed_at, created_at`;

type URow = Record<string, unknown> & { active: number; must_change_password: number; locked_until: string | null };
const userOut = (r: URow) => ({
  ...r,
  active: r.active === 1,
  must_change_password: r.must_change_password === 1,
  locked: !!r.locked_until && Date.parse(r.locked_until) > Date.now(),
});

export async function listUsers({ env, actor }: Ctx) {
  requireRole(actor, 'admin');
  const { results } = await env.DB.prepare(`SELECT ${USER_COLS} FROM users ORDER BY id`).all<URow>();
  return json(results.map(userOut));
}

async function assertEmployee(env: Env, id: string | null) {
  if (!id) return;
  const e = await env.DB.prepare(`SELECT id FROM employees WHERE id = ?1`).bind(id).first();
  if (!e) throw bad(`ไม่พบรหัสพนักงาน ${id}`);
}

export async function createUser({ env, actor, req }: Ctx) {
  requireRole(actor, 'admin');
  const b = await readJson(req);
  const id = reqUserId(b.id);
  const display = str(b.display_name, 'ชื่อที่แสดง', 100);
  const role = b.role ?? 'user';
  if (!isRole(role)) throw bad('สิทธิ์ต้องเป็น admin หรือ user');
  const emp = optEmployeeId(b.employee_id, 'รหัสพนักงาน');
  await assertEmployee(env, emp);
  const pw = reqPassword(b.password, id);
  const exists = await env.DB.prepare(`SELECT id FROM users WHERE id = ?1`).bind(id).first();
  if (exists) throw conflict(`มีผู้ใช้ ${id} อยู่แล้ว`);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, display_name, role, employee_id, password_hash, must_change_password) VALUES (?1, ?2, ?3, ?4, ?5, 0)`,
    ).bind(id, display, role, emp, await hashPassword(pw)),
    audit(env, actor.id, 'create', 'users', id, { role, display_name: display, employee_id: emp }),
  ]);
  return json({ id }, 201);
}

/** Make sure at least one active admin remains after a change to `target`. */
async function assertAdminRemains(env: Env, target: string) {
  const r = await env.DB.prepare(`SELECT count(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?1`)
    .bind(target).first<{ n: number }>();
  if (!r?.n) throw bad('ต้องมีผู้ดูแลระบบ (admin) ที่ใช้งานได้อย่างน้อย 1 คน');
}

export async function updateUser({ env, actor, req, params }: Ctx) {
  requireRole(actor, 'admin');
  const id = reqUserId(decodeURIComponent(params[0]));
  const cur = await env.DB.prepare(`SELECT role, active FROM users WHERE id = ?1`).bind(id).first<{ role: Role; active: number }>();
  if (!cur) throw notFound('ไม่พบผู้ใช้นี้');
  const b = await readJson(req);
  const display = b.display_name === undefined ? undefined : str(b.display_name, 'ชื่อที่แสดง', 100);
  const role = b.role === undefined ? cur.role : b.role;
  if (!isRole(role)) throw bad('สิทธิ์ต้องเป็น admin หรือ user');
  const active = b.active === undefined ? cur.active === 1 : bool(b.active, 'สถานะใช้งาน');
  const emp = b.employee_id === undefined ? undefined : optEmployeeId(b.employee_id, 'รหัสพนักงาน');
  if (emp !== undefined) await assertEmployee(env, emp);
  const unlock = b.unlock === true;

  const losesAdmin = cur.role === 'admin' && cur.active === 1 && (role !== 'admin' || !active);
  if (losesAdmin) {
    if (id === actor.id) throw bad('ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้');
    await assertAdminRemains(env, id);
  }
  const stmts = [
    env.DB.prepare(
      `UPDATE users SET
         display_name = coalesce(?2, display_name), role = ?3, active = ?4,
         employee_id = CASE WHEN ?5 = 1 THEN ?6 ELSE employee_id END,
         failed_logins = CASE WHEN ?7 = 1 THEN 0 ELSE failed_logins END,
         locked_until  = CASE WHEN ?7 = 1 THEN NULL ELSE locked_until END
       WHERE id = ?1`,
    ).bind(id, display ?? null, role, active ? 1 : 0, emp === undefined ? 0 : 1, emp ?? null, unlock ? 1 : 0),
    audit(env, actor.id, 'update', 'users', id, { display_name: display, role, active, employee_id: emp, unlock }),
  ];
  // a deactivated user, or one whose role changed, is signed out everywhere
  if (!active || role !== cur.role) stmts.push(env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(id));
  await env.DB.batch(stmts);
  return json({ ok: true });
}

/** Admin sets a new password for the user; it is used as-is (no forced change). Their other sessions end. */
export async function resetPassword({ env, actor, req, params }: Ctx) {
  requireRole(actor, 'admin');
  const id = reqUserId(decodeURIComponent(params[0]));
  const cur = await env.DB.prepare(`SELECT id FROM users WHERE id = ?1`).bind(id).first();
  if (!cur) throw notFound('ไม่พบผู้ใช้นี้');
  const b = await readJson(req);
  const pw = reqPassword(b.password, id);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET password_hash = ?2, must_change_password = 0, failed_logins = 0, locked_until = NULL,
         password_changed_at = ${NOW_SQL} WHERE id = ?1`,
    ).bind(id, await hashPassword(pw)),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1 AND token_hash <> ?2`).bind(id, actor.session),
    audit(env, actor.id, 'password_reset', 'users', id),
  ]);
  return json({ ok: true });
}

/** Cron housekeeping for auth tables. */
export async function cleanupAuth(env: Env) {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - IP_WINDOW_MINUTES * 60_000 * 4).toISOString();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sessions WHERE expires_at <= ?1`).bind(now),
    env.DB.prepare(`DELETE FROM login_throttle WHERE window_start < ?1`).bind(old),
  ]);
}
