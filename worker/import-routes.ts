/**
 * Admin: import employees (and their sign-in accounts) from an Excel / CSV file.
 * The browser reads the file and sends the rows as JSON; the same endpoint checks them (commit = false → nothing
 * is written) and imports them (commit = true). Rows are matched by the company employee code (employees.emp_code).
 *
 *   employee: new → a row in `employees` with the next internal id (EMP22 …) · existing → name / role updated,
 *             switched back on if it was off
 *   account:  new → a row in `users` (signs in with the employee code; temporary password, must change it at
 *             first sign-in) · an employee who already has an account keeps it unchanged (password not touched)
 *
 * No new tables: it writes the same `employees`, `users` and `audit_log` rows as the Settings page does.
 * Commit is limited to IMPORT_CHUNK rows per request (password hashing is CPU heavy); the page sends chunks.
 */
import { accountIdFor, empCode } from './auth-routes';
import { requireRole, type Role } from './auth';
import { bad, json, readJson } from './http';
import { DEFAULT_PASSWORD, firstPasswordProblem, hashPassword, mustChangeFirst } from './password';
import { NOW_SQL, audit, type Ctx } from './routes';

const MAX_ROWS = 500;
export const IMPORT_CHUNK = 10;

interface InRow { line?: unknown; code?: unknown; name?: unknown; role?: unknown; access?: unknown; account?: unknown; password?: unknown }
export interface OutRow {
  line: number; code: string; name: string; role: string; access: Role;
  employee: 'new' | 'update' | 'same' | 'error';
  changes: string[];
  account: 'new' | 'exists' | 'skip' | 'error';
  errors: string[];
  /** only on commit, only for new accounts whose password was generated */
  temp_password?: string;
}

const s = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').trim();
const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase();

function parseAccess(v: string): Role | null {
  const x = norm(v);
  if (!x || ['user', 'ผู้ใช้', 'พนักงาน', 'staff'].includes(x)) return 'user';
  if (['admin', 'ผู้ดูแลระบบ', 'ผู้ดูแล', 'แอดมิน'].includes(x)) return 'admin';
  return null;
}
function parseYes(v: string): boolean | null {
  const x = norm(v);
  if (!x || ['y', 'yes', 'ใช่', 'สร้าง', '1', 'true'].includes(x)) return true;
  if (['n', 'no', 'ไม่', 'ไม่สร้าง', '0', 'false'].includes(x)) return false;
  return null;
}


/** POST /api/import/employees { rows, commit } */
export async function importEmployees({ env, actor, req }: Ctx) {
  requireRole(actor, 'admin');
  const b = await readJson(req);
  const commit = b.commit === true;
  if (!Array.isArray(b.rows)) throw bad('ไม่พบข้อมูลในไฟล์');
  const input = b.rows as InRow[];
  if (!input.length) throw bad('ไฟล์ไม่มีแถวข้อมูล');
  if (input.length > (commit ? IMPORT_CHUNK : MAX_ROWS)) {
    throw bad(commit ? `นำเข้าได้ครั้งละไม่เกิน ${IMPORT_CHUNK} แถว` : `ไฟล์หนึ่งนำเข้าได้ไม่เกิน ${MAX_ROWS} แถว — แบ่งไฟล์ก่อน`);
  }

  // current data: 3 small reads (employees · accounts · roles)
  const [emps, accs, roles] = await env.DB.batch([
    env.DB.prepare(`SELECT id, name, coalesce(role, '') AS role, active, emp_code FROM employees`),
    env.DB.prepare(`SELECT id, employee_id FROM users`),
    env.DB.prepare(`SELECT code FROM employee_roles`),
  ]);
  type E = { id: string; name: string; role: string; active: number; emp_code: string | null };
  const byCode = new Map((emps.results as E[]).filter((e) => e.emp_code).map((e) => [e.emp_code as string, e]));
  const hasAccount = new Set((accs.results as { employee_id: string | null }[]).map((a) => a.employee_id).filter(Boolean));
  const accountIds = new Set((accs.results as { id: string }[]).map((a) => a.id));
  const roleByNorm = new Map((roles.results as { code: string }[]).map((r) => [norm(r.code), r.code]));
  let nextNo = Math.max(0, ...(emps.results as E[]).map((e) => (/^EMP\d+$/.test(e.id) ? Number(e.id.slice(3)) : 0))) + 1;

  const seen = new Set<string>();
  const out: OutRow[] = input.map((r, i) => {
    const errors: string[] = [];
    const rawCode = s(r.code);
    const code = empCode(rawCode) ?? '';
    const name = s(r.name).replace(/\s+/g, ' ');
    const roleIn = s(r.role);
    const role = roleIn ? roleByNorm.get(norm(roleIn)) ?? '' : '';
    const access = parseAccess(s(r.access));
    const wantAccount = parseYes(s(r.account));
    const line = Number(r.line) || i + 2;

    if (!rawCode) errors.push('ไม่มีรหัสพนักงาน');
    else if (!code) errors.push('รหัสพนักงานใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข และ - (ไม่เกิน 20 ตัว)');
    else if (seen.has(code)) errors.push(`รหัสพนักงาน ${code} ซ้ำกับแถวก่อนหน้าในไฟล์`);
    if (code) seen.add(code);
    if (name.length > 100) errors.push('ชื่อยาวเกิน 100 ตัวอักษร');
    if (roleIn && !role) errors.push(`ตำแหน่ง "${roleIn}" ไม่มีในระบบ (ใช้ได้: ${[...roleByNorm.values()].join(', ')})`);
    if (!access) errors.push(`สิทธิ์ "${s(r.access)}" ไม่ถูกต้อง (ใช้: ผู้ใช้ หรือ ผู้ดูแลระบบ)`);
    if (wantAccount === null) errors.push(`ช่องสร้างบัญชี "${s(r.account)}" ไม่ถูกต้อง (ใช้: ใช่ หรือ ไม่)`);

    const cur = code ? byCode.get(code) : undefined;
    if (!cur && !name) errors.push('พนักงานใหม่ต้องมีชื่อ-นามสกุล');
    const changes: string[] = [];
    if (cur) {
      if (name && name !== cur.name) changes.push(`ชื่อ: ${cur.name || '–'} → ${name}`);
      if (role && role !== cur.role) changes.push(`ตำแหน่ง: ${cur.role || '–'} → ${role}`);
      if (cur.active !== 1) changes.push('เปิดใช้งานคืน');
    }

    let account: OutRow['account'] = 'skip';
    const pw = s(r.password);
    if (wantAccount && code) {
      if (cur && hasAccount.has(cur.id)) account = 'exists';
      else {
        account = 'new';
        const id = accountIdFor(code);
        if (accountIds.has(id)) { account = 'error'; errors.push('มีบัญชีภายในชื่อเดียวกันอยู่แล้ว — ติดต่อผู้พัฒนาระบบ'); }
        // a first password (must be changed at first sign-in): simple allowed, e.g. 123456
        const p = pw ? firstPasswordProblem(pw) : null;
        if (p) { account = 'error'; errors.push(`รหัสผ่าน: ${p}`); }
      }
    }
    return {
      line, code: code || rawCode, name: name || cur?.name || '', role: role || cur?.role || '', access: access ?? 'user',
      employee: errors.length ? 'error' : cur ? (changes.length ? 'update' : 'same') : 'new',
      changes, account: errors.length && account !== 'skip' ? 'error' : account, errors,
    };
  });

  const summary = {
    rows: out.length,
    errors: out.filter((r) => r.errors.length).length,
    new_employees: out.filter((r) => r.employee === 'new').length,
    updated_employees: out.filter((r) => r.employee === 'update').length,
    new_accounts: out.filter((r) => !r.errors.length && r.account === 'new').length,
  };
  if (!commit) return json({ rows: out, summary, chunk: IMPORT_CHUNK });

  // ---- commit: only rows without errors; one atomic batch for this chunk ----
  const stmts = [];
  for (let i = 0; i < out.length; i++) {
    const r = out[i];
    if (r.errors.length) continue;
    const src = input[i];
    let empId = byCode.get(r.code)?.id;
    if (!empId) {
      empId = 'EMP' + String(nextNo++).padStart(2, '0');
      stmts.push(env.DB.prepare(
        `INSERT INTO employees (id, name, role, emp_code, active, active_from) VALUES (?1, ?2, nullif(?3, ''), ?4, 1, date('now', '+7 hours'))`,
      ).bind(empId, r.name, r.role, r.code));
      stmts.push(audit(env, actor, 'create', 'employees', empId, { name: r.name, role: r.role || null, code: r.code, import: true }));
    } else if (r.employee === 'update') {
      stmts.push(env.DB.prepare(
        `UPDATE employees SET name = ?2, role = nullif(?3, ''), active = 1, active_to = NULL WHERE id = ?1`,
      ).bind(empId, r.name, r.role));
      stmts.push(audit(env, actor, 'update', 'employees', empId, { changes: r.changes, import: true }));
    }
    if (r.account === 'new') {
      const id = accountIdFor(r.code);
      // no password in the file → the default first password (123456), changed at first sign-in
      const given = s(src.password);
      const pw = given || DEFAULT_PASSWORD;
      stmts.push(env.DB.prepare(
        `INSERT INTO users (id, display_name, role, employee_id, password_hash, must_change_password, password_changed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ${NOW_SQL})`,
        // a generated password is temporary (always changed); a given one only when it is simple (e.g. 123456)
      ).bind(id, r.name, r.access, empId, await hashPassword(pw), mustChangeFirst(pw, id)));
      stmts.push(audit(env, actor, 'create', 'users', id, { role: r.access, employee_id: empId, import: true }));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ rows: out, summary });
}


/* ======================================================================
 * Vehicles: columns ทะเบียน · ประเภทรถ. Matched by plate the same way the database does
 * (vehicles.plate_key: spaces, "-" and "." ignored, upper case).
 *   new → a row in `vehicles` · existing → type updated · a deleted (switched-off) vehicle → back on, history kept
 * No password hashing here, so a whole file is imported in one request (one atomic batch).
 * ==================================================================== */

interface VehIn { line?: unknown; plate?: unknown; type?: unknown }
export interface VehOut {
  line: number; plate: string; type: string;
  vehicle: 'new' | 'update' | 'same' | 'error';
  changes: string[]; errors: string[];
}
const plateKey = (p: string) => p.replace(/[\s.-]/g, '').toUpperCase();

/** POST /api/import/vehicles { rows, commit } */
export async function importVehicles({ env, actor, req }: Ctx) {
  requireRole(actor, 'admin');
  const b = await readJson(req);
  const commit = b.commit === true;
  if (!Array.isArray(b.rows)) throw bad('ไม่พบข้อมูลในไฟล์');
  const input = b.rows as VehIn[];
  if (!input.length) throw bad('ไฟล์ไม่มีแถวข้อมูล');
  if (input.length > MAX_ROWS) throw bad(`ไฟล์หนึ่งนำเข้าได้ไม่เกิน ${MAX_ROWS} แถว — แบ่งไฟล์ก่อน`);

  // current vehicles: one small read
  const { results } = await env.DB.prepare(`SELECT id, plate, type, active FROM vehicles`)
    .all<{ id: string; plate: string; type: string; active: number }>();
  const byKey = new Map(results.map((v) => [plateKey(v.plate), v]));

  const seen = new Set<string>();
  const out: VehOut[] = input.map((r, i) => {
    const errors: string[] = [];
    const plate = s(r.plate).replace(/\s+/g, ' ');
    const type = s(r.type).replace(/\s+/g, ' ');
    const line = Number(r.line) || i + 2;
    const key = plateKey(plate);
    if (!plate) errors.push('ไม่มีทะเบียน');
    else if (plate.length > 20) errors.push('ทะเบียนยาวเกิน 20 ตัวอักษร');
    else if (seen.has(key)) errors.push(`ทะเบียน ${plate} ซ้ำกับแถวก่อนหน้าในไฟล์`);
    if (key) seen.add(key);
    if (type.length > 50) errors.push('ประเภทรถยาวเกิน 50 ตัวอักษร');

    const cur = key ? byKey.get(key) : undefined;
    const changes: string[] = [];
    if (cur) {
      if (type && type !== cur.type) changes.push(`ประเภท: ${cur.type || '–'} → ${type}`);
      if (cur.active !== 1) changes.push('เปิดใช้งานคืน (ประวัติเดิมยังอยู่)');
    }
    return {
      line, plate: cur?.plate ?? plate, type: type || cur?.type || '',
      vehicle: errors.length ? 'error' : cur ? (changes.length ? 'update' : 'same') : 'new',
      changes, errors,
    };
  });

  const summary = {
    rows: out.length,
    errors: out.filter((r) => r.errors.length).length,
    new_vehicles: out.filter((r) => r.vehicle === 'new').length,
    updated_vehicles: out.filter((r) => r.vehicle === 'update').length,
  };
  if (!commit) return json({ rows: out, summary });

  const stmts = [];
  for (const r of out) {
    if (r.errors.length) continue;
    const cur = byKey.get(plateKey(r.plate));
    if (!cur) {
      const id = crypto.randomUUID();
      stmts.push(env.DB.prepare(
        `INSERT INTO vehicles (id, plate, type, active, active_from) VALUES (?1, ?2, ?3, 1, date('now', '+7 hours'))`,
      ).bind(id, r.plate, r.type));
      stmts.push(audit(env, actor, 'create', 'vehicles', id, { plate: r.plate, type: r.type, import: true }));
    } else if (r.vehicle === 'update') {
      stmts.push(env.DB.prepare(`UPDATE vehicles SET type = ?2, active = 1, active_to = NULL WHERE id = ?1`).bind(cur.id, r.type));
      stmts.push(audit(env, actor, 'update', 'vehicles', cur.id, { changes: r.changes, import: true }));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ rows: out, summary });
}
