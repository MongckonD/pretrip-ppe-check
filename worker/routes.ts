/** API route handlers. Each returns a Response or throws HttpError. */
import { type Actor, requireRole, requireStaff } from './auth';
import { HttpError, bad, conflict, forbidden, json, notFound, readJson } from './http';
import {
  PHOTO_KEY_RE, bool, employeeId, isDate, isMonth, monthBounds, obj, optEmployeeId,
  optMileage, nowTimeTH, photoKey, photoPlate, plate, reqDate, str, text, todayTH,
} from './validate';

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  /** driver-licence photos only (separate private bucket) */
  LICENSES: R2Bucket;
  ASSETS: Fetcher;
  /** "1" = store delivery (ร้านค้าที่ต้องส่ง) API on; anything else = its routes answer 404 (version 1) */
  FEATURE_STORE_DELIVERY?: string;
  /** "1" = store timer (จับเวลาร้านค้า, store_visits) API on; needs FEATURE_STORE_DELIVERY too — otherwise 404 */
  FEATURE_STORE_TIMER?: string;
}

export interface Ctx {
  req: Request;
  env: Env;
  exec: ExecutionContext;
  url: URL;
  actor: Actor;
  params: string[];
}

export const NOW_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
const PLATE_KEY_SQL = (p: string) => `upper(replace(replace(replace(${p}, ' ', ''), '-', ''), '.', ''))`;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export function audit(env: Env, actor: Actor, action: string, entity: string, id: string, detail?: unknown) {
  return env.DB.prepare(
    `INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?1, ?2, ?3, ?4, ?5)`,
  ).bind(actor.id, action, entity, id, detail === undefined ? null : JSON.stringify(detail));
}

export const parse = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string') return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};

export async function findVehicleByPlate(env: Env, p: string) {
  return env.DB.prepare(
    `SELECT id, plate, active FROM vehicles WHERE plate_key = ${PLATE_KEY_SQL('?1')}`,
  ).bind(p).first<{ id: string; plate: string; active: number }>();
}

/** Throws 400 listing any ids that are not in employees. */
export async function assertEmployeesExist(env: Env, ids: string[]) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return;
  const { results } = await env.DB.prepare(
    `SELECT id FROM employees WHERE id IN (SELECT value FROM json_each(?1))`,
  ).bind(JSON.stringify(uniq)).all<{ id: string }>();
  const found = new Set(results.map((r) => r.id));
  const missing = uniq.filter((id) => !found.has(id));
  if (missing.length) throw bad(`ไม่พบพนักงานที่เลือก ${missing.length} คนในระบบ — โหลดหน้าใหม่แล้วเลือกอีกครั้ง`);
}

export function dateFilter(url: URL): { sql: string; args: string[] } {
  const date = url.searchParams.get('date');
  const month = url.searchParams.get('month');
  if (date) {
    if (!isDate(date)) throw bad('พารามิเตอร์ date ไม่ถูกต้อง');
    return { sql: 'inspect_date = ?1', args: [date] };
  }
  if (month) {
    if (!isMonth(month)) throw bad('พารามิเตอร์ month ไม่ถูกต้อง');
    const { from, to } = monthBounds(month);
    return { sql: 'inspect_date BETWEEN ?1 AND ?2', args: [from, to] };
  }
  // date range (inclusive), e.g. the admin report: ?from=2026-11-01&to=2026-11-19 — at most 366 days
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (from || to) {
    if (!from || !to || !isDate(from) || !isDate(to)) throw bad('พารามิเตอร์ from / to ไม่ถูกต้อง');
    if (from > to) throw bad('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw bad('เลือกช่วงวันที่ได้ไม่เกิน 1 ปี');
    return { sql: 'inspect_date BETWEEN ?1 AND ?2', args: [from, to] };
  }
  throw bad('ต้องระบุ date, month หรือ from / to');
}

/* =====================================================================
 * Me / master data
 * ===================================================================== */

export async function getMaster({ env }: Ctx) {
  const [emps, vehs, items, ppe, slots, roles, areas] = await env.DB.batch([
    env.DB.prepare(`SELECT id, name, coalesce(role, '') AS role, active, coalesce(emp_code, '') AS code FROM employees ORDER BY id`),
    env.DB.prepare(`SELECT id, plate, type, active FROM vehicles ORDER BY plate`),
    env.DB.prepare(`SELECT item_no, name, hint, active FROM check_items ORDER BY item_no`),
    env.DB.prepare(`SELECT code, name, sort_order, active FROM ppe_items ORDER BY sort_order, code`),
    env.DB.prepare(`SELECT code, name, sort_order FROM photo_slots WHERE active = 1 ORDER BY sort_order, code`),
    env.DB.prepare(`SELECT code FROM employee_roles ORDER BY sort_order, code`),
    env.DB.prepare(`SELECT code, name, description, sort_order, active FROM area_types ORDER BY sort_order, code`),
  ]);
  type R = Record<string, unknown>;
  const b = (r: R, k: string) => ({ ...r, [k]: r[k] === 1 });
  return json({
    employees: (emps.results as R[]).map((r) => b(r, 'active')),
    vehicles: (vehs.results as R[]).map((r) => b(r, 'active')),
    checkItems: (items.results as R[]).map((r) => b(r, 'active')),
    ppeItems: (ppe.results as R[]).map((r) => b(r, 'active')),
    photoSlots: slots.results,
    roles: (roles.results as { code: string }[]).map((r) => r.code),
    areaTypes: (areas.results as R[]).map((r) => b(r, 'active')),
  });
}

/**
 * How an employee is named in messages: name and company code — never the internal id (EMP01).
 * Shared with auth-routes.ts.
 */
export async function empLabel(env: Env, id: string): Promise<string> {
  const e = await env.DB.prepare(`SELECT name, emp_code FROM employees WHERE id = ?1`).bind(id).first<{ name: string; emp_code: string | null }>();
  if (!e) return 'พนักงานคนนี้';
  if (e.name && e.emp_code) return `${e.name} (${e.emp_code})`;
  return e.name || (e.emp_code ? `รหัสพนักงาน ${e.emp_code}` : 'พนักงานคนนี้ (ยังไม่มีชื่อและรหัส)');
}

export async function putEmployee({ env, actor, req, params }: Ctx) {
  requireRole(actor, 'admin');
  const id = employeeId(decodeURIComponent(params[0]));
  const body = await readJson(req);
  const name = str(body.name, 'ชื่อ', 100);
  const roleIn = str(body.role, 'ตำแหน่ง', 30);
  const active = body.active === undefined ? true : bool(body.active, 'สถานะใช้งาน');
  // company employee code (will become the login name later). Not sent = keep as is · '' = clear.
  const codeSent = body.code !== undefined && body.code !== null;
  const code = codeSent ? str(body.code, 'รหัสพนักงาน', 20).toUpperCase().replace(/\s+/g, '') : '';
  if (code && !/^[A-Z0-9-]{1,20}$/.test(code)) throw bad('รหัสพนักงานใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข และ - (ไม่เกิน 20 ตัว)');
  if (code) {
    const owner = await env.DB.prepare(`SELECT id FROM employees WHERE emp_code = ?1 AND id <> ?2`).bind(code, id).first<{ id: string }>();
    if (owner) throw conflict(`รหัสพนักงาน ${code} ใช้กับ ${await empLabel(env, owner.id)} แล้ว`);
  } else if (codeSent) {
    // the code is the sign-in name: an employee with an account must keep one (it can be changed, not removed)
    const acc = await env.DB.prepare(`SELECT id FROM users WHERE employee_id = ?1`).bind(id).first<{ id: string }>();
    if (acc) throw conflict(`ลบรหัสพนักงานของ ${await empLabel(env, id)} ไม่ได้ — พนักงานคนนี้มีบัญชีและใช้รหัสนี้เข้าสู่ระบบ (เปลี่ยนเป็นรหัสใหม่ได้)`);
  }

  let role: string | null = null;
  if (roleIn) {
    const ok = await env.DB.prepare(`SELECT code FROM employee_roles WHERE code = ?1`).bind(roleIn).first();
    if (!ok) {
      const { results } = await env.DB.prepare(`SELECT code FROM employee_roles ORDER BY sort_order`).all<{ code: string }>();
      throw bad(`ตำแหน่งต้องเป็นหนึ่งใน: ${results.map((r) => r.code).join(', ')}`);
    }
    role = roleIn;
  }

  const today = todayTH();
  const existing = await env.DB.prepare(`SELECT active FROM employees WHERE id = ?1`).bind(id).first<{ active: number }>();
  const stmt = existing
    ? env.DB.prepare(
        `UPDATE employees SET name = ?2, role = ?3, active = ?4,
           active_to = CASE WHEN ?4 = 1 THEN NULL
                            WHEN active = 1 THEN ?5
                            ELSE active_to END,
           emp_code = CASE WHEN ?6 = 1 THEN nullif(?7, '') ELSE emp_code END
         WHERE id = ?1`,
      ).bind(id, name, role, active ? 1 : 0, today, codeSent ? 1 : 0, code)
    : env.DB.prepare(
        `INSERT INTO employees (id, name, role, active, active_from, active_to, emp_code) VALUES (?1, ?2, ?3, ?4, ?5, ?6, nullif(?7, ''))`,
      ).bind(id, name, role, active ? 1 : 0, today, active ? null : today, code);
  await env.DB.batch([stmt, audit(env, actor, existing ? 'update' : 'create', 'employees', id,
    codeSent ? { name, role, active, code: code || null } : { name, role, active })]);
  return json({ ok: true });
}

export async function putVehicle({ env, actor, req }: Ctx) {
  requireRole(actor, 'admin');
  const body = await readJson(req);
  const id = body.id === undefined || body.id === null || body.id === '' ? null : str(body.id, 'รหัสรถ', 64);
  const p = plate(body.plate);
  const type = str(body.type, 'ประเภทรถ', 50);
  const active = body.active === undefined ? true : bool(body.active, 'สถานะใช้งาน');
  const today = todayTH();
  const same = await findVehicleByPlate(env, p);

  if (id) {
    const cur = await env.DB.prepare(`SELECT id, plate, active FROM vehicles WHERE id = ?1`).bind(id).first<{ id: string; plate: string; active: number }>();
    if (!cur) throw notFound('ไม่พบรถคันนี้');
    if (same && same.id !== id) throw conflict(`ทะเบียน ${same.plate} มีอยู่แล้ว`);
    // switching off: not while it still has stores to deliver
    if (!active && cur.active === 1) await assertNoOpenDeliveries(env, id, cur.plate);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE vehicles SET plate = ?2, type = ?3, active = ?4,
           active_to = CASE WHEN ?4 = 1 THEN NULL WHEN active = 1 THEN ?5 ELSE active_to END
         WHERE id = ?1`,
      ).bind(id, p, type, active ? 1 : 0, today),
      audit(env, actor, 'update', 'vehicles', id, { plate: p, type, active }),
    ]);
    return json({ id });
  }

  if (same) {
    if (same.active === 1) throw conflict(`ทะเบียน ${same.plate} มีอยู่แล้ว`);
    // a deleted (deactivated) vehicle comes back with its history intact
    await env.DB.batch([
      env.DB.prepare(`UPDATE vehicles SET plate = ?2, type = ?3, active = 1, active_to = NULL WHERE id = ?1`)
        .bind(same.id, p, type),
      audit(env, actor, 'update', 'vehicles', same.id, { plate: p, type, reactivated: true }),
    ]);
    return json({ id: same.id });
  }

  const newId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO vehicles (id, plate, type, active, active_from) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(newId, p, type, active ? 1 : 0, today),
    audit(env, actor, 'create', 'vehicles', newId, { plate: p, type }),
  ]);
  return json({ id: newId }, 201);
}

/**
 * Delete an employee row — only one with no history at all (e.g. a row added by mistake).
 * Anyone on a vehicle check, PPE sheet or work record, or with a sign-in account, is kept:
 * switch them to "ปิดอยู่" instead (the database's ON DELETE RESTRICT would refuse anyway).
 */
export async function deleteEmployee({ env, actor, params }: Ctx) {
  requireRole(actor, 'admin');
  const id = employeeId(decodeURIComponent(params[0]));
  const e = await env.DB.prepare(`SELECT name, emp_code FROM employees WHERE id = ?1`).bind(id).first<{ name: string; emp_code: string | null }>();
  if (!e) throw notFound('ไม่พบพนักงานคนนี้ (อาจถูกลบไปแล้ว)');
  const r = await env.DB.prepare(
    `SELECT EXISTS (SELECT 1 FROM users WHERE employee_id = ?1) AS account,
            EXISTS (SELECT 1 FROM vehicle_inspections WHERE dman_id = ?1 OR helper1_id = ?1 OR helper2_id = ?1)
         OR EXISTS (SELECT 1 FROM ppe_inspections WHERE employee_id = ?1 OR inspector_id = ?1)
         OR EXISTS (SELECT 1 FROM trip_activities WHERE dman_id = ?1) AS history`,
  ).bind(id).first<{ account: number; history: number }>();
  const who = e.name || e.emp_code || 'พนักงานคนนี้';
  if (r?.account) throw conflict(`ลบ ${who} ไม่ได้ — มีบัญชีเข้าสู่ระบบผูกอยู่ ลบบัญชีในกล่องผู้ใช้งานระบบก่อน หรือปิดสถานะเป็น "ปิดอยู่" แทน`);
  if (r?.history) throw conflict(`ลบ ${who} ไม่ได้ — มีประวัติการตรวจรถ / PPE / เวลาทำงานแล้ว ให้ปิดสถานะเป็น "ปิดอยู่" แทน`);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM employees WHERE id = ?1`).bind(id),
    audit(env, actor, 'delete', 'employees', id, { name: e.name, code: e.emp_code }),
  ]);
  return json({ ok: true });
}

/**
 * A vehicle with stores to deliver today or later cannot be deleted or switched off: those stores would drop out of
 * every list (staff can no longer pick the vehicle). The admin moves or removes them first.
 */
async function assertNoOpenDeliveries(env: Env, vehicleId: string, plateText: string) {
  const open = await env.DB.prepare(
    `SELECT count(*) AS stores, min(plan_date) AS first_date FROM delivery_plan WHERE vehicle_id = ?1 AND plan_date >= ?2`,
  ).bind(vehicleId, todayTH()).first<{ stores: number; first_date: string | null }>();
  if (open?.stores) {
    throw conflict(`รถ ${plateText} มีแผนส่ง ${open.stores} ร้าน ตั้งแต่วันที่ ${open.first_date} — `
      + 'ย้ายร้านไปรถคันอื่นหรือลบออกจากแผน (หน้าหลัก → ร้านค้าที่ต้องส่ง) ก่อน');
  }
}

/** Vehicles with history are deactivated instead of deleted, so reports keep their plate. */
export async function deleteVehicle({ env, actor, params }: Ctx) {
  requireRole(actor, 'admin');
  const id = decodeURIComponent(params[0]);
  const v = await env.DB.prepare(`SELECT id, plate FROM vehicles WHERE id = ?1`).bind(id).first<{ id: string; plate: string }>();
  if (!v) throw notFound('ไม่พบรถคันนี้');
  await assertNoOpenDeliveries(env, id, v.plate);
  // past delivery plans count as history too (the vehicle is switched off instead of deleted)
  const used = await env.DB.prepare(
    `SELECT EXISTS (SELECT 1 FROM vehicle_inspections WHERE vehicle_id = ?1)
         OR EXISTS (SELECT 1 FROM ppe_inspections WHERE vehicle_id = ?1)
         OR EXISTS (SELECT 1 FROM trip_activities WHERE vehicle_id = ?1)
         OR EXISTS (SELECT 1 FROM delivery_plan WHERE vehicle_id = ?1) AS used`,
  ).bind(id).first<{ used: number }>();
  if (used?.used) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE vehicles SET active = 0, active_to = coalesce(active_to, ?2) WHERE id = ?1`).bind(id, todayTH()),
      audit(env, actor, 'update', 'vehicles', id, { plate: v.plate, deactivated: true }),
    ]);
    return json({ deleted: false, deactivated: true });
  }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM vehicles WHERE id = ?1`).bind(id),
    audit(env, actor, 'delete', 'vehicles', id, { plate: v.plate }),
  ]);
  return json({ deleted: true, deactivated: false });
}

/* =====================================================================
 * Vehicle inspections
 * ===================================================================== */

type Row = Record<string, unknown>;

/** Every R2 key one inspection uses (?1 = inspection id): the 6 vehicle photos + failed items' photos. */
const INSPECTION_PHOTO_KEYS_SQL = `
  SELECT r2_key AS k FROM vehicle_inspection_photos WHERE inspection_id = ?1
  UNION
  SELECT photo_r2_key AS k FROM vehicle_inspection_results WHERE inspection_id = ?1 AND photo_r2_key IS NOT NULL`;

function vehOut(r: Row) {
  return {
    id: r.id, inspect_date: r.inspect_date, inspect_time: r.inspect_time,
    dman_id: r.dman_id, helper1_id: r.helper1_id, helper2_id: r.helper2_id,
    plate: r.plate, vehicle_id: r.vehicle_id, vehicle_type: r.vehicle_type, mileage: r.mileage, note: r.note,
    month: r.month,
    results: parse<Record<string, number>>(r.results, {}),
    photos: parse<Record<string, string>>(r.photos, {}),
    fail_items: parse<number[]>(r.fail_items, []),
    pass_count: r.pass_count, fail_count: r.fail_count, na_count: r.na_count, filled_count: r.filled_count,
    photo_count: r.photo_count, overall_result: r.overall_result, photo_status: r.photo_status,
    completeness: r.completeness, declared_result: r.declared_result, result_mismatch: r.result_mismatch,
    line_photo_sent: r.line_photo_sent, source: r.source,
    approved_by: r.approved_by, approved_at: r.approved_at,
    created_by: r.created_by, updated_by: r.updated_by, created_at: r.created_at, updated_at: r.updated_at,
  };
}

/**
 * Vehicle checks for a day / month / range, with the same fields as v_vehicle_inspection_summary.
 * D1 rows read: the view re-scans each check's 23 results ~10 times (+ every check item / photo slot per row);
 * here the results and photos are read ONCE and the counts are made in the Worker (≈ 25 rows per check, ~90% less).
 */
export async function listVehicleInspections({ env, url }: Ctx) {
  const f = dateFilter(url);
  const { results: rows } = await env.DB.prepare(
    `SELECT vi.id, vi.inspect_date, vi.month, vi.inspect_time, vi.vehicle_id, v.plate, v.type AS vehicle_type, vi.mileage,
            vi.dman_id, vi.helper1_id, vi.helper2_id, vi.declared_result, vi.line_photo_sent, vi.note, vi.source,
            vi.approved_by, vi.approved_at, vi.created_by, vi.updated_by, vi.created_at, vi.updated_at,
            vi.rejected_at, vi.rejected_by, vi.reject_reason
     FROM vehicle_inspections vi
     JOIN vehicles v  ON v.id = vi.vehicle_id
     JOIN employees d ON d.id = vi.dman_id
     WHERE ${f.sql.replace(/inspect_date/g, 'vi.inspect_date')}
     ORDER BY vi.inspect_date, vi.inspect_time IS NULL, vi.inspect_time, v.plate`,
  ).bind(...f.args).all<Row>();
  if (!rows.length) return json([]);

  const ids = JSON.stringify(rows.map((r) => r.id));
  const [res, pho, items, slots] = await env.DB.batch([
    env.DB.prepare(
      `SELECT inspection_id AS i, item_no AS n, result AS r, remark AS m, photo_r2_key AS p
       FROM vehicle_inspection_results WHERE inspection_id IN (SELECT value FROM json_each(?1))`,
    ).bind(ids),
    env.DB.prepare(
      `SELECT inspection_id AS i, slot AS s, r2_key AS k FROM vehicle_inspection_photos
       WHERE inspection_id IN (SELECT value FROM json_each(?1))`,
    ).bind(ids),
    env.DB.prepare(`SELECT item_no FROM check_items WHERE active = 1`),
    env.DB.prepare(`SELECT code FROM photo_slots WHERE active = 1`),
  ]);
  const activeItems = (items.results as { item_no: number }[]).map((x) => String(x.item_no));
  const activeSlots = (slots.results as { code: string }[]).map((x) => x.code);
  const byCheck = new Map<string, { i: string; n: number; r: number; m: string; p: string | null }[]>();
  for (const x of res.results as { i: string; n: number; r: number; m: string; p: string | null }[]) {
    (byCheck.get(x.i) ?? byCheck.set(x.i, []).get(x.i)!).push(x);
  }
  const photosOf = new Map<string, Record<string, string>>();
  for (const x of pho.results as { i: string; s: string; k: string }[]) (photosOf.get(x.i) ?? photosOf.set(x.i, {}).get(x.i)!)[x.s] = x.k;

  return json(rows.map((r) => {
    const id = r.id as string;
    const list = byCheck.get(id) ?? [];
    const results: Record<string, number> = {};
    const defects: Record<string, { note: string; photo: string | null }> = {};
    let pass = 0, fail = 0, na = 0;
    for (const x of list) {
      results[String(x.n)] = x.r;
      if (x.r === 1) pass++;
      else if (x.r === 2) { fail++; defects[String(x.n)] = { note: x.m, photo: x.p }; }
      else if (x.r === 3) na++;
    }
    const missingItems = activeItems.filter((n) => results[n] === undefined).length;
    const photos = photosOf.get(id) ?? {};
    const photoCount = Object.keys(photos).length;
    const photoMissing = activeSlots.filter((s) => photos[s] === undefined).length;
    const declared = r.declared_result as number | null;
    // same rules as v_vehicle_inspection_summary (0002_views.sql)
    const out = vehOut({
      ...r,
      results: JSON.stringify(results), photos: JSON.stringify(photos),
      fail_items: JSON.stringify(list.filter((x) => x.r === 2).map((x) => x.n).sort((a, b) => a - b)),
      pass_count: pass, fail_count: fail, na_count: na, filled_count: list.length, photo_count: photoCount,
      overall_result: fail > 0 || declared === 2 ? 2 : missingItems === 0 ? 1 : null,
      completeness: missingItems === 0 ? 'ครบ' : 'ไม่ครบ',
      result_mismatch: declared !== null && list.length > 0 && declared !== (fail > 0 ? 2 : 1) ? 1 : 0,
      photo_status: photoMissing === 0 ? 1 : photoCount > 0 ? 2 : 0,
    });
    return { ...out, defects, rejected_at: r.rejected_at ?? null, rejected_by: r.rejected_by ?? null, reject_reason: r.reject_reason ?? '' };
  }));
}

export async function saveVehicleInspection({ env, actor, req, exec }: Ctx) {
  requireStaff(actor);
  const b = await readJson(req);
  const reqId = b.id === undefined || b.id === null || b.id === '' ? null : str(b.id, 'รหัสบันทึก', 64);
  // date and time of a vehicle check are set by the server (Thai time), not by the form — staff cannot change them
  let date = todayTH();
  let time: string | null = nowTimeTH();
  const dman = employeeId(b.dman, 'D-Man');
  let h1 = optEmployeeId(b.h1, 'Helper 1');
  let h2 = optEmployeeId(b.h2, 'Helper 2');
  if (!h1 && h2) { h1 = h2; h2 = null; } // Helper 2 alone becomes Helper 1
  const crew = [dman, h1, h2].filter((x): x is string => !!x);
  if (new Set(crew).size !== crew.length) throw bad('D-Man และ Helper ต้องเป็นคนละคนกัน');
  // เลขไมล์ต้องกรอกทุกครั้ง (the database refuses an empty one too, migration 0026)
  const mileage = optMileage(b.mileage);
  if (mileage === null) throw bad('กรอกเลขไมล์ก่อนส่ง');
  const note = text(b.note, 'หมายเหตุ', 2000);
  const p = plate(b.plate);

  const resultsIn = obj(b.results, 'ผลการตรวจ');
  const results: Record<string, number> = {};
  for (const [k, v] of Object.entries(resultsIn)) {
    if (!/^\d{1,2}$/.test(k) || Number(k) < 1) throw bad(`เลขข้อตรวจ ${k} ไม่ถูกต้อง`);
    if (v !== 1 && v !== 2 && v !== 3) throw bad(`ผลข้อ ${k} ต้องเป็น 1, 2 หรือ 3`);
    results[String(Number(k))] = v;
  }
  if (!Object.keys(results).length) throw bad('ยังไม่ได้ตรวจรายการใด');

  const photosIn = obj(b.photos, 'รูปภาพ');
  const photoKeys = Object.entries(photosIn).map(([slot, key]) => [str(slot, 'ช่องรูป', 20), photoKey(key)] as const);

  // failed items (2): note required, photo optional — { "<item_no>": { note, photo } }
  const defectsIn = b.defects === undefined || b.defects === null ? {} : obj(b.defects, 'ข้อบกพร่อง');
  const resultRows = Object.entries(results).map(([k, r]) => {
    if (r !== 2) return { n: Number(k), r, m: '', p: null as string | null };
    const d = defectsIn[k] === undefined ? {} : obj(defectsIn[k], `ข้อบกพร่องข้อ ${k}`);
    const m = text(d.note, `หมายเหตุข้อ ${k}`, 500).trim();
    if (!m) throw bad(`ระบุหมายเหตุของข้อ ${k} ที่ไม่ผ่าน`);
    const p = d.photo === undefined || d.photo === null || d.photo === '' ? null : photoKey(d.photo);
    return { n: Number(k), r, m, p };
  });
  const allKeys = [...photoKeys.map(([, k]) => k), ...resultRows.flatMap((r) => (r.p ? [r.p] : []))];
  if (new Set(allKeys).size !== allKeys.length) throw bad('ใช้รูปเดียวกันซ้ำหลายช่อง');

  // reference checks with clear messages (the DB enforces them again)
  const vehicle = await findVehicleByPlate(env, p);
  if (!vehicle) throw bad(`ยังไม่ได้ลงทะเบียนรถ ${p} — เพิ่มได้ที่แท็บตั้งค่า`);
  await assertEmployeesExist(env, crew);
  const [items, slots] = await env.DB.batch([
    env.DB.prepare(`SELECT item_no, active FROM check_items`),
    env.DB.prepare(`SELECT code FROM photo_slots WHERE active = 1`),
  ]);
  const itemRows = items.results as { item_no: number; active: number }[];
  const itemSet = new Set(itemRows.map((r) => String(r.item_no)));
  const badItem = Object.keys(results).find((k) => !itemSet.has(k));
  if (badItem) throw bad(`ไม่มีข้อตรวจที่ ${badItem}`);
  // every active item must be checked — on the first send and on every fix
  const missingItems = itemRows.filter((r) => r.active === 1 && !(String(r.item_no) in results)).map((r) => r.item_no).sort((a, b) => a - b);
  if (missingItems.length) {
    throw bad(`ตรวจให้ครบทุกข้อก่อนส่ง — ยังไม่ได้ตรวจ ${missingItems.length} ข้อ (ข้อ ${missingItems.slice(0, 10).join(', ')}${missingItems.length > 10 ? ' …' : ''})`);
  }
  const slotSet = new Set((slots.results as { code: string }[]).map((r) => r.code));
  const badSlot = photoKeys.find(([s]) => !slotSet.has(s));
  if (badSlot) throw bad(`ไม่มีช่องรูป ${badSlot[0]}`);

  // which row are we writing?
  let id: string;
  let isNew = false;
  if (reqId) {
    const cur = await env.DB.prepare(`SELECT id, approved_at, inspect_date, inspect_time FROM vehicle_inspections WHERE id = ?1`)
      .bind(reqId).first<{ id: string; approved_at: string | null; inspect_date: string; inspect_time: string | null }>();
    if (!cur) throw notFound('ไม่พบบันทึกนี้ (อาจถูกลบไปแล้ว)');
    // editing keeps the original date and time
    date = cur.inspect_date;
    time = cur.inspect_time;
    if (cur.approved_at) throw conflict('รายการนี้หัวหน้าอนุมัติแล้ว แก้ไขไม่ได้ (ต้องยกเลิกอนุมัติก่อน)');
    const clash = await env.DB.prepare(
      `SELECT id FROM vehicle_inspections WHERE inspect_date = ?1 AND vehicle_id = ?2 AND id <> ?3`,
    ).bind(date, vehicle.id, reqId).first();
    if (clash) throw conflict(`ทะเบียน ${vehicle.plate} มีบันทึกของวันที่ ${date} แล้ว`);
    id = reqId;
  } else {
    const cur = await env.DB.prepare(
      `SELECT id, approved_at FROM vehicle_inspections WHERE inspect_date = ?1 AND vehicle_id = ?2`,
    ).bind(date, vehicle.id).first<{ id: string; approved_at: string | null }>();
    if (cur?.approved_at) throw conflict('รายการนี้หัวหน้าอนุมัติแล้ว แก้ไขไม่ได้ (ต้องยกเลิกอนุมัติก่อน)');
    if (!cur && vehicle.active !== 1) throw bad(`รถ ${vehicle.plate} ปิดใช้งานแล้ว เปิดใช้งานใหม่ได้ที่แท็บตั้งค่า`);
    // one vehicle a day: someone who already checked (or is in the crew of) another vehicle today cannot check a second one
    if (!cur) {
      const other = await env.DB.prepare(
        `SELECT v.plate FROM vehicle_inspections vi JOIN vehicles v ON v.id = vi.vehicle_id
          WHERE vi.inspect_date = ?1 AND vi.vehicle_id <> ?2
            AND (vi.created_by = ?3 OR (?4 IS NOT NULL AND ?4 IN (vi.dman_id, vi.helper1_id, vi.helper2_id)))
          LIMIT 1`,
      ).bind(date, vehicle.id, actor.id, actor.employee_id ?? null).first<{ plate: string }>();
      if (other) throw conflict(`วันนี้คุณตรวจรถ ${other.plate} ไปแล้ว — ตรวจรถได้วันละ 1 คัน (แก้ไขการตรวจคันเดิมได้)`);
    }
    isNew = !cur;
    id = cur?.id ?? crypto.randomUUID();
  }
  const { results: old } = await env.DB.prepare(INSPECTION_PHOTO_KEYS_SQL).bind(id).all<{ k: string }>();
  const oldKeys = old.map((r) => r.k);

  // every referenced photo must really be in R2
  const photoMeta: Record<string, { k: string; t: string; s: number }> = {};
  await Promise.all([
    ...photoKeys.map(async ([slot, key]) => {
      const head = await env.PHOTOS.head(key);
      if (!head) throw bad(`ไม่พบไฟล์รูปช่อง ${slot} กรุณาอัปโหลดใหม่`);
      photoMeta[slot] = { k: key, t: head.httpMetadata?.contentType ?? 'image/jpeg', s: head.size };
    }),
    ...resultRows.filter((r) => r.p).map(async (r) => {
      if (!(await env.PHOTOS.head(r.p as string))) throw bad(`ไม่พบไฟล์รูปข้อ ${r.n} กรุณาถ่ายใหม่`);
    }),
  ]);

  await env.DB.batch([
    // trips and PPE sheets linked to this inspection must follow its date/vehicle, so unlink any that no longer match
    env.DB.prepare(
      `UPDATE trip_activities SET vehicle_inspection_id = NULL
       WHERE vehicle_inspection_id = ?1 AND (activity_date <> ?2 OR vehicle_id <> ?3)`,
    ).bind(id, date, vehicle.id),
    env.DB.prepare(
      `UPDATE ppe_inspections SET vehicle_inspection_id = NULL
       WHERE vehicle_inspection_id = ?1 AND (inspect_date <> ?2 OR vehicle_id IS NOT ?3)`,
    ).bind(id, date, vehicle.id),
    env.DB.prepare(
      `INSERT INTO vehicle_inspections
         (id, inspect_date, inspect_time, vehicle_id, mileage, dman_id, helper1_id, helper2_id, note, created_by, updated_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
       ON CONFLICT (id) DO UPDATE SET
         inspect_date = excluded.inspect_date, inspect_time = excluded.inspect_time,
         vehicle_id = excluded.vehicle_id, mileage = excluded.mileage, dman_id = excluded.dman_id,
         helper1_id = excluded.helper1_id, helper2_id = excluded.helper2_id, note = excluded.note,
         rejected_at = NULL, rejected_by = NULL, reject_reason = '',
         updated_by = excluded.updated_by, updated_at = ${NOW_SQL}`,
    ).bind(id, date, time, vehicle.id, mileage, dman, h1, h2, note, actor.id),
    env.DB.prepare(`DELETE FROM vehicle_inspection_results WHERE inspection_id = ?1`).bind(id),
    env.DB.prepare(
      `INSERT INTO vehicle_inspection_results (inspection_id, item_no, result, remark, photo_r2_key)
       SELECT ?1, json_extract(value, '$.n'), json_extract(value, '$.r'),
              coalesce(json_extract(value, '$.m'), ''), json_extract(value, '$.p')
       FROM json_each(?2)`,
    ).bind(id, JSON.stringify(resultRows)),
    env.DB.prepare(`DELETE FROM vehicle_inspection_photos WHERE inspection_id = ?1`).bind(id),
    env.DB.prepare(
      `INSERT INTO vehicle_inspection_photos (inspection_id, slot, r2_key, content_type, size_bytes, uploaded_by)
       SELECT ?1, j.key, json_extract(j.value, '$.k'), json_extract(j.value, '$.t'), json_extract(j.value, '$.s'), ?3
       FROM json_each(?2) j`,
    ).bind(id, JSON.stringify(photoMeta), actor.id),
    // the trip of the same day and vehicle saved earlier gets linked now
    env.DB.prepare(
      `UPDATE trip_activities SET vehicle_inspection_id = ?1
       WHERE activity_date = ?2 AND vehicle_id = ?3 AND vehicle_inspection_id IS NULL`,
    ).bind(id, date, vehicle.id),
    // PPE sheets of the same day and vehicle saved earlier get linked now (crew members only)
    env.DB.prepare(
      `UPDATE ppe_inspections SET vehicle_inspection_id = ?1
       WHERE inspect_date = ?2 AND vehicle_id = ?3 AND vehicle_inspection_id IS NULL
         AND employee_id IN (SELECT value FROM json_each(?4))`,
    ).bind(id, date, vehicle.id, JSON.stringify(crew)),
    // the crew may have changed on re-save: PPE of people no longer on this vehicle is unlinked (kept, not counted
    // for this vehicle), and the remaining PPE + the day's trip take the current D-Man
    env.DB.prepare(
      `UPDATE ppe_inspections SET vehicle_inspection_id = NULL
       WHERE vehicle_inspection_id = ?1 AND employee_id NOT IN (SELECT value FROM json_each(?2))`,
    ).bind(id, JSON.stringify(crew)),
    env.DB.prepare(
      `UPDATE ppe_inspections SET inspector_id = ?2 WHERE vehicle_inspection_id = ?1 AND inspector_id <> ?2`,
    ).bind(id, dman),
    env.DB.prepare(
      `UPDATE trip_activities SET dman_id = ?2 WHERE vehicle_inspection_id = ?1 AND dman_id <> ?2`,
    ).bind(id, dman),
    audit(env, actor, isNew ? 'create' : 'update', 'vehicle_inspections', id, {
      date, time, plate: vehicle.plate, dman, h1, h2, mileage, note, results, photos: Object.fromEntries(photoKeys),
      defects: Object.fromEntries(resultRows.filter((r) => r.r === 2).map((r) => [r.n, { note: r.m, photo: r.p }])),
    }),
  ]);

  // photos that this record no longer uses
  const keep = new Set([...photoKeys.map(([, k]) => k), ...resultRows.flatMap((r) => (r.p ? [r.p] : []))]);
  const dropped = oldKeys.filter((k) => !keep.has(k));
  if (dropped.length) exec.waitUntil(env.PHOTOS.delete(dropped));
  return json({ id });
}

export async function deleteVehicleInspection({ env, actor, params, exec }: Ctx) {
  requireStaff(actor);
  const id = decodeURIComponent(params[0]);
  const cur = await env.DB.prepare(
    `SELECT v.id, v.inspect_date, v.approved_at, vh.plate FROM vehicle_inspections v JOIN vehicles vh ON vh.id = v.vehicle_id WHERE v.id = ?1`,
  ).bind(id).first<{ id: string; inspect_date: string; approved_at: string | null; plate: string }>();
  if (!cur) throw notFound('ไม่พบบันทึกนี้ (อาจถูกลบไปแล้ว)');
  if (cur.approved_at) throw conflict('รายการนี้หัวหน้าอนุมัติแล้ว ลบไม่ได้ (ต้องยกเลิกอนุมัติก่อน)');
  const { results } = await env.DB.prepare(INSPECTION_PHOTO_KEYS_SQL).bind(id).all<{ k: string }>();
  await env.DB.batch([
    audit(env, actor, 'delete', 'vehicle_inspections', id, { date: cur.inspect_date, plate: cur.plate }),
    env.DB.prepare(`DELETE FROM vehicle_inspections WHERE id = ?1`).bind(id),
  ]);
  const keys = results.map((r) => r.k);
  if (keys.length) exec.waitUntil(env.PHOTOS.delete(keys));
  return json({ ok: true });
}

/* =====================================================================
 * PPE inspections
 * ===================================================================== */

function ppeOut(r: Row) {
  return {
    id: r.id, inspect_date: r.inspect_date, employee_id: r.employee_id, inspector_id: r.inspector_id,
    plate: r.plate, vehicle_inspection_id: r.vehicle_inspection_id, month: r.month, note: r.note,
    results: parse<Record<string, number>>(r.results, {}),
    missing_items: parse<string[]>(r.missing_items, []),
    have_count: r.have_count, missing_count: r.missing_count, filled_count: r.filled_count, status: r.status,
    approved_by: r.approved_by, approved_at: r.approved_at,
    created_by: r.created_by, updated_by: r.updated_by, created_at: r.created_at, updated_at: r.updated_at,
  };
}

/**
 * PPE sheets for a day / month / range, with the same fields as v_ppe_inspection_summary.
 * Results are read once and counted in the Worker (the view re-scans them 5× per sheet) — ~80% fewer D1 rows read.
 */
export async function listPpeInspections({ env, url }: Ctx) {
  const f = dateFilter(url);
  const { results: rows } = await env.DB.prepare(
    `SELECT pi.id, pi.inspect_date, pi.month, pi.employee_id, pi.inspector_id, coalesce(v.plate, '') AS plate,
            pi.vehicle_inspection_id, pi.note, pi.approved_by, pi.approved_at,
            pi.created_by, pi.updated_by, pi.created_at, pi.updated_at
     FROM ppe_inspections pi
     JOIN employees e     ON e.id = pi.employee_id
     JOIN employees i     ON i.id = pi.inspector_id
     LEFT JOIN vehicles v ON v.id = pi.vehicle_id
     WHERE ${f.sql.replace(/inspect_date/g, 'pi.inspect_date')}
     ORDER BY pi.inspect_date, pi.employee_id`,
  ).bind(...f.args).all<Row>();
  if (!rows.length) return json([]);

  const [res, items] = await env.DB.batch([
    env.DB.prepare(
      `SELECT ppe_inspection_id AS i, ppe_code AS c, result AS r FROM ppe_inspection_results
       WHERE ppe_inspection_id IN (SELECT value FROM json_each(?1))`,
    ).bind(JSON.stringify(rows.map((r) => r.id))),
    env.DB.prepare(`SELECT code, sort_order, active FROM ppe_items`),
  ]);
  const itemList = items.results as { code: string; sort_order: number; active: number }[];
  const order = new Map(itemList.map((x) => [x.code, x]));
  const active = itemList.filter((x) => x.active === 1).map((x) => x.code);
  const bySheet = new Map<string, { c: string; r: number }[]>();
  for (const x of res.results as { i: string; c: string; r: number }[]) (bySheet.get(x.i) ?? bySheet.set(x.i, []).get(x.i)!).push(x);

  return json(rows.map((r) => {
    const list = bySheet.get(r.id as string) ?? [];
    const results: Record<string, number> = {};
    for (const x of list) results[x.c] = x.r;
    const missing = list.filter((x) => x.r === 2);
    const missingRequired = active.filter((c) => results[c] === undefined).length;
    // same rules as v_ppe_inspection_summary (0002_views.sql)
    const missingItems = missing.filter((x) => order.has(x.c)).map((x) => x.c)
      .sort((a, b) => order.get(a)!.sort_order - order.get(b)!.sort_order || a.localeCompare(b));
    return ppeOut({
      ...r,
      results: JSON.stringify(results), missing_items: JSON.stringify(missingItems),
      have_count: list.filter((x) => x.r === 1).length, missing_count: missing.length, filled_count: list.length,
      status: missingRequired > 0 ? 'ไม่ครบ' : missing.length > 0 ? 'อุปกรณ์ไม่ครบ' : 'ครบ',
    });
  }));
}

/** who a vehicle check belongs to: the account that saved it and the crew on it */
export interface CheckOwner { created_by: string | null; dman_id: string; helper1_id: string | null; helper2_id: string | null }

/** Staff work only on their own team's check: one they saved, or one where they are the D-Man or a helper. */
export function assertMyCheck(actor: Actor, c: CheckOwner, plateText: string) {
  if (actor.role === 'admin') return;
  if (c.created_by === actor.id) return;
  if (actor.employee_id && [c.dman_id, c.helper1_id, c.helper2_id].includes(actor.employee_id)) return;
  throw forbidden(`รถ ${plateText} วันนี้ไม่ได้อยู่ในทีมของคุณ — ทำได้เฉพาะรถที่คุณตรวจเอง หรือที่คุณอยู่ในทีม`);
}

export async function savePpeInspections({ env, actor, req }: Ctx) {
  requireStaff(actor);
  const b = await readJson(req);
  // PPE date is set by the server (today, Thai time) — staff cannot change it
  const date = todayTH();
  const p = plate(b.plate);
  const rowsIn = obj(b.rows, 'ผล PPE');

  const rows: Record<string, Record<string, number>> = {};
  for (const [empRaw, itemsRaw] of Object.entries(rowsIn)) {
    const emp = employeeId(empRaw);
    const items = obj(itemsRaw, `ผล PPE ของ ${emp}`);
    const clean: Record<string, number> = {};
    for (const [code, v] of Object.entries(items)) {
      if (!/^[a-z0-9_-]{1,20}$/.test(code)) throw bad(`รหัสอุปกรณ์ ${code} ไม่ถูกต้อง`);
      if (v !== 1 && v !== 2) throw bad(`ผล PPE ต้องเป็น 1 (มี) หรือ 2 (ไม่มี)`);
      clean[code] = v;
    }
    if (Object.keys(clean).length) rows[emp] = clean;
  }
  const emps = Object.keys(rows);
  if (!emps.length) throw bad('ยังไม่ได้ตรวจ PPE ของใคร');
  if (emps.length > 200) throw bad('บันทึกได้ครั้งละไม่เกิน 200 คน');

  // PPE follows today's vehicle check of this vehicle: only its crew, inspected by its D-Man
  const vehicle = await findVehicleByPlate(env, p);
  if (!vehicle) throw bad(`ยังไม่ได้ลงทะเบียนรถ ${p} — เพิ่มได้ที่แท็บตั้งค่า`);
  const vi = await env.DB.prepare(
    `SELECT created_by, dman_id, helper1_id, helper2_id FROM vehicle_inspections WHERE inspect_date = ?1 AND vehicle_id = ?2`,
  ).bind(date, vehicle.id).first<CheckOwner>();
  if (!vi) throw bad(`ยังไม่ได้ตรวจรถทะเบียน ${vehicle.plate} วันนี้ — ตรวจรถก่อนแล้วค่อยตรวจ PPE`);
  assertMyCheck(actor, vi, vehicle.plate);
  const crew = new Set([vi.dman_id, vi.helper1_id, vi.helper2_id].filter((x): x is string => !!x));
  const outsider = emps.find((e) => !crew.has(e));
  if (outsider) throw bad(`${await empLabel(env, outsider)} ไม่ได้อยู่ในทีมงานของรถ ${vehicle.plate} วันนี้ (ตรวจ PPE ได้เฉพาะทีมที่เลือกตอนตรวจรถ)`);
  const inspector = vi.dman_id;
  await assertEmployeesExist(env, [inspector, ...emps]);
  const { results: codes } = await env.DB.prepare(`SELECT code FROM ppe_items`).all<{ code: string }>();
  const codeSet = new Set(codes.map((c) => c.code));
  for (const items of Object.values(rows)) {
    const unknown = Object.keys(items).find((c) => !codeSet.has(c));
    if (unknown) throw bad(`ไม่มีอุปกรณ์รหัส ${unknown}`);
  }
  const vehicleId = vehicle.id;
  const { results: locked } = await env.DB.prepare(
    `SELECT employee_id FROM ppe_inspections
     WHERE inspect_date = ?1 AND approved_at IS NOT NULL AND employee_id IN (SELECT value FROM json_each(?2))`,
  ).bind(date, JSON.stringify(emps)).all<{ employee_id: string }>();
  if (locked.length) {
    throw conflict(`PPE ของ ${locked.map((r) => r.employee_id).join(', ')} หัวหน้าอนุมัติแล้ว แก้ไขไม่ได้`);
  }

  const rowsJson = JSON.stringify(rows);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ppe_inspections
         (id, inspect_date, employee_id, inspector_id, vehicle_id, vehicle_inspection_id, created_by, updated_by)
       SELECT lower(hex(randomblob(16))), ?1, j.key, ?2, ?3,
              (SELECT v.id FROM vehicle_inspections v WHERE v.inspect_date = ?1 AND v.vehicle_id = ?3),
              ?4, ?4
       FROM json_each(?5) j WHERE true
       ON CONFLICT (inspect_date, employee_id) DO UPDATE SET
         inspector_id = excluded.inspector_id, vehicle_id = excluded.vehicle_id,
         vehicle_inspection_id = excluded.vehicle_inspection_id,
         updated_by = excluded.updated_by, updated_at = ${NOW_SQL}`,
    ).bind(date, inspector, vehicleId, actor.id, rowsJson),
    env.DB.prepare(
      `DELETE FROM ppe_inspection_results WHERE ppe_inspection_id IN (
         SELECT id FROM ppe_inspections WHERE inspect_date = ?1 AND employee_id IN (SELECT key FROM json_each(?2)))`,
    ).bind(date, rowsJson),
    env.DB.prepare(
      `INSERT INTO ppe_inspection_results (ppe_inspection_id, ppe_code, result)
       SELECT p.id, r.key, r.value
       FROM json_each(?2) j
       JOIN ppe_inspections p ON p.inspect_date = ?1 AND p.employee_id = j.key
       JOIN json_each(j.value) r`,
    ).bind(date, rowsJson),
    audit(env, actor, 'update', 'ppe_inspections', date, { date, inspector, plate: p, rows }),
  ]);
  return json({ count: emps.length });
}

export async function deletePpeInspection({ env, actor, params }: Ctx) {
  requireStaff(actor);
  const id = decodeURIComponent(params[0]);
  const cur = await env.DB.prepare(`SELECT id, inspect_date, employee_id, approved_at FROM ppe_inspections WHERE id = ?1`)
    .bind(id).first<{ id: string; inspect_date: string; employee_id: string; approved_at: string | null }>();
  if (!cur) throw notFound('ไม่พบบันทึกนี้ (อาจถูกลบไปแล้ว)');
  if (cur.approved_at) throw conflict('รายการนี้หัวหน้าอนุมัติแล้ว ลบไม่ได้ (ต้องยกเลิกอนุมัติก่อน)');
  await env.DB.batch([
    audit(env, actor, 'delete', 'ppe_inspections', id, { date: cur.inspect_date, employee: cur.employee_id }),
    env.DB.prepare(`DELETE FROM ppe_inspections WHERE id = ?1`).bind(id),
  ]);
  return json({ ok: true });
}

/* =====================================================================
 * Approval (หัวหน้าเซ็น) — admin
 * ===================================================================== */

function approval(table: 'vehicle_inspections' | 'ppe_inspections', approve: boolean) {
  return async ({ env, actor, params }: Ctx) => {
    requireRole(actor, 'admin');
    const id = decodeURIComponent(params[0]);
    const cur = await env.DB.prepare(`SELECT approved_at FROM ${table} WHERE id = ?1`).bind(id).first<{ approved_at: string | null }>();
    if (!cur) throw notFound('ไม่พบบันทึกนี้');
    if (approve === !!cur.approved_at) return json({ ok: true, approved: approve }); // already in that state
    // a vehicle check's approval is final: it cannot be undone
    if (!approve && table === 'vehicle_inspections') throw conflict('อนุมัติแล้ว ยกเลิกหรือแก้ไขการอนุมัติไม่ได้');
    await env.DB.batch([
      approve
        ? env.DB.prepare(`UPDATE ${table} SET approved_by = ?2, approved_at = ${NOW_SQL}, updated_by = ?2${
            table === 'vehicle_inspections' ? `, rejected_at = NULL, rejected_by = NULL, reject_reason = ''` : ''} WHERE id = ?1`).bind(id, actor.id)
        : env.DB.prepare(`UPDATE ${table} SET approved_by = NULL, approved_at = NULL, updated_by = ?2 WHERE id = ?1`).bind(id, actor.id),
      audit(env, actor, approve ? 'approve' : 'unapprove', table, id),
    ]);
    return json({ ok: true, approved: approve });
  };
}
export const approveVehicle = approval('vehicle_inspections', true);
export const unapproveVehicle = approval('vehicle_inspections', false);
export const approvePpe = approval('ppe_inspections', true);

/**
 * Admin "ไม่อนุมัติ" a vehicle check, with a reason (required). Not possible once it is approved (approval is final).
 * Staff can then fix and re-send it, which clears the rejection.
 */
export async function rejectVehicle({ env, actor, params, req }: Ctx) {
  requireRole(actor, 'admin');
  const id = decodeURIComponent(params[0]);
  const b = await readJson(req);
  const reason = str(b.reason, 'เหตุผลที่ไม่อนุมัติ', 500);
  if (!reason) throw bad('ระบุเหตุผลที่ไม่อนุมัติ');
  const cur = await env.DB.prepare(`SELECT approved_at FROM vehicle_inspections WHERE id = ?1`).bind(id).first<{ approved_at: string | null }>();
  if (!cur) throw notFound('ไม่พบบันทึกนี้');
  if (cur.approved_at) throw conflict('อนุมัติแล้ว เปลี่ยนเป็นไม่อนุมัติไม่ได้');
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE vehicle_inspections SET rejected_at = ${NOW_SQL}, rejected_by = ?2, reject_reason = ?3, updated_by = ?2 WHERE id = ?1`,
    ).bind(id, actor.id, reason),
    audit(env, actor, 'update', 'vehicle_inspections', id, { status: 'rejected', reason }),
  ]);
  return json({ ok: true, rejected: true });
}

/** Admin undoes a rejection → back to รออนุมัติ */
export async function unrejectVehicle({ env, actor, params }: Ctx) {
  requireRole(actor, 'admin');
  const id = decodeURIComponent(params[0]);
  const cur = await env.DB.prepare(`SELECT rejected_at FROM vehicle_inspections WHERE id = ?1`).bind(id).first<{ rejected_at: string | null }>();
  if (!cur) throw notFound('ไม่พบบันทึกนี้');
  if (!cur.rejected_at) return json({ ok: true, rejected: false });
  await env.DB.batch([
    env.DB.prepare(`UPDATE vehicle_inspections SET rejected_at = NULL, rejected_by = NULL, reject_reason = '', updated_by = ?2 WHERE id = ?1`)
      .bind(id, actor.id),
    audit(env, actor, 'update', 'vehicle_inspections', id, { status: 'pending', undo: 'rejected' }),
  ]);
  return json({ ok: true, rejected: false });
}
export const unapprovePpe = approval('ppe_inspections', false);

/* =====================================================================
 * Photos (R2)
 * ===================================================================== */

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function sniffImage(b: Uint8Array): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export async function uploadPhoto({ env, actor, req, url }: Ctx) {
  requireStaff(actor);
  const date = reqDate(url.searchParams.get('date'), 'วันที่ของรูป');
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_PHOTO_BYTES) throw new HttpError(413, 'รูปใหญ่เกิน 5 MB');
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) throw bad('ไม่มีไฟล์รูป');
  if (bytes.length > MAX_PHOTO_BYTES) throw new HttpError(413, 'รูปใหญ่เกิน 5 MB');
  const type = sniffImage(bytes);
  if (!type) throw new HttpError(415, 'รองรับเฉพาะรูป JPEG, PNG หรือ WebP');
  // file name = when it was taken (Thai time, server clock) + which vehicle + which photo:
  //   2026-11/2026-11-25/ผข4600/20261125-0812_ผข4600_front_a1b2c3.jpg   (6 random hex: two photos the same minute never clash)
  // a page from before this change sends no plate / slot: the old name is used then
  const plateIn = url.searchParams.get('plate');
  const slotIn = url.searchParams.get('slot') ?? '';
  let key: string;
  if (plateIn) {
    const veh = await findVehicleByPlate(env, plate(plateIn));
    if (!veh) throw bad(`ยังไม่ได้ลงทะเบียนรถ ${plateIn} — เพิ่มได้ที่แท็บตั้งค่า`);
    if (!/^(?:[a-z]{2,12}|item\d{2})$/.test(slotIn)) throw bad('ช่องรูปไม่ถูกต้อง');
    const p = photoPlate(veh.plate);
    if (!p) throw bad('ทะเบียนรถไม่ถูกต้อง');
    const now = new Date(Date.now() + 7 * 3_600_000).toISOString(); // Thai time
    const day = now.slice(0, 10);
    const stamp = `${day.replace(/-/g, '')}-${now.slice(11, 13)}${now.slice(14, 16)}`;
    const rand = [...crypto.getRandomValues(new Uint8Array(3))].map((b) => b.toString(16).padStart(2, '0')).join('');
    key = `${day.slice(0, 7)}/${day}/${p}/${stamp}_${p}_${slotIn}_${rand}.${IMAGE_TYPES[type]}`;
  } else {
    key = `${date.slice(0, 7)}/${date}_${crypto.randomUUID()}.${IMAGE_TYPES[type]}`;
  }
  await env.PHOTOS.put(key, bytes, {
    httpMetadata: { contentType: type },
    customMetadata: { uploadedBy: actor.id },
  });
  return json({ key }, 201);
}

export async function getPhoto({ env, params, req }: Ctx) {
  const key = photoKey(decodeURIComponent(params[0]));
  const obj = await env.PHOTOS.get(key, { onlyIf: req.headers });
  if (!obj) throw notFound('ไม่พบรูป');
  const headers = new Headers({
    etag: obj.httpEtag,
    // revalidate every time (cheap 304 via ETag) so a deleted photo disappears immediately
    'cache-control': 'private, no-cache',
    'x-content-type-options': 'nosniff',
    'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg',
  });
  if (!('body' in obj) || !obj.body) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers });
}

/** Which of the keys in ?1 (JSON array) a saved inspection uses: the 6 vehicle photos or a failed item's photo. */
const USED_PHOTO_KEYS_SQL = `
  SELECT r2_key AS k FROM vehicle_inspection_photos WHERE r2_key IN (SELECT value FROM json_each(?1))
  UNION
  SELECT photo_r2_key AS k FROM vehicle_inspection_results WHERE photo_r2_key IN (SELECT value FROM json_each(?1))`;

/** Delete photos that are not used by any saved inspection (e.g. replaced before saving). */
export async function deletePhotos({ env, actor, req }: Ctx) {
  requireStaff(actor);
  const b = await readJson(req);
  if (!Array.isArray(b.keys) || b.keys.length > 50) throw bad('keys ต้องเป็นรายการไม่เกิน 50 รายการ');
  const keys = [...new Set(b.keys.map(photoKey))];
  if (!keys.length) return json({ deleted: [], kept: [] });
  const { results } = await env.DB.prepare(USED_PHOTO_KEYS_SQL).bind(JSON.stringify(keys)).all<{ k: string }>();
  const used = new Set(results.map((r) => r.k));
  const del = keys.filter((k) => !used.has(k));
  if (del.length) await env.PHOTOS.delete(del);
  return json({ deleted: del, kept: [...used] });
}

/** Cron: remove uploads older than 24 h that never got attached to an inspection. */
export async function cleanupOrphanPhotos(env: Env): Promise<number> {
  const cutoff = Date.now() - 24 * 3600_000;
  let cursor: string | undefined;
  let removed = 0;
  do {
    const page = await env.PHOTOS.list({ cursor, limit: 500 });
    const old = page.objects.filter((o) => o.uploaded.getTime() < cutoff && PHOTO_KEY_RE.test(o.key)).map((o) => o.key);
    if (old.length) {
      const { results } = await env.DB.prepare(USED_PHOTO_KEYS_SQL).bind(JSON.stringify(old)).all<{ k: string }>();
      const used = new Set(results.map((r) => r.k));
      const orphans = old.filter((k) => !used.has(k));
      for (let i = 0; i < orphans.length; i += 1000) await env.PHOTOS.delete(orphans.slice(i, i + 1000));
      removed += orphans.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return removed;
}

/* =====================================================================
 * Reports for Excel / Power BI (CSV or JSON)
 * ===================================================================== */

const REPORTS: Record<string, { view: string; dateCol: string; order: string }> = {
  'daily-summary': { view: 'v_daily_summary', dateCol: 'day', order: 'day' },
  'daily-vehicle-status': { view: 'v_daily_vehicle_status', dateCol: 'day', order: 'day, plate' },
  'daily-ppe-status': { view: 'v_daily_ppe_status', dateCol: 'day', order: 'day, employee_id' },
  'employee-daily': { view: 'v_employee_daily_activity', dateCol: 'day', order: 'day, employee_id' },
  'employee-monthly': { view: 'v_employee_monthly_summary', dateCol: '', order: 'month, employee_id' },
  'vehicle-inspections': { view: 'v_vehicle_inspection_summary', dateCol: 'inspect_date', order: 'inspect_date, plate' },
  'ppe-inspections': { view: 'v_ppe_inspection_summary', dateCol: 'inspect_date', order: 'inspect_date, employee_id' },
  'vehicle-item-results': { view: 'v_vehicle_item_results', dateCol: 'inspect_date', order: 'inspect_date, plate, item_no' },
  'ppe-item-results': { view: 'v_ppe_item_results', dateCol: 'inspect_date', order: 'inspect_date, employee_id, ppe_code' },
  'mileage-check': { view: 'v_mileage_check', dateCol: 'inspect_date', order: 'plate, inspect_date' },
  'trip-activities': { view: 'v_trip_activity_summary', dateCol: 'activity_date', order: 'activity_date, work_started_at, plate' },
  'vehicle-days': { view: 'v_vehicle_day_summary', dateCol: '', order: 'date, plate' },
};

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** GET /api/reports/<name>(.csv|.json) — admin only (the reports hold every employee's data) */
export async function getReport({ env, actor, url, params }: Ctx) {
  requireRole(actor, 'admin');
  const name = params[0];
  const format = params[1] ?? 'json';
  const rep = REPORTS[name];
  if (!rep) throw notFound(`ไม่มีรายงาน ${name} (มี: ${Object.keys(REPORTS).join(', ')})`);
  const month = url.searchParams.get('month');
  let where = '';
  const args: string[] = [];
  if (month) {
    if (!isMonth(month)) throw bad('พารามิเตอร์ month ไม่ถูกต้อง');
    if (rep.dateCol) {
      const { from, to } = monthBounds(month);
      where = `WHERE ${rep.dateCol} BETWEEN ?1 AND ?2`;
      args.push(from, to);
    } else {
      where = 'WHERE month = ?1';
      args.push(month);
    }
  }
  const { results } = await env.DB.prepare(`SELECT * FROM ${rep.view} ${where} ORDER BY ${rep.order}`)
    .bind(...args).all<Row>();
  if (format === 'json') return json(results);
  const cols = results.length ? Object.keys(results[0]) : [];
  const body = '﻿' + [cols.join(','), ...results.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n');
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}${month ? '-' + month : ''}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
