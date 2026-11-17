/** API route handlers. Each returns a Response or throws HttpError. */
import { type Actor, requireRole, requireStaff } from './auth';
import { HttpError, bad, conflict, json, notFound, readJson } from './http';
import {
  PHOTO_KEY_RE, bool, employeeId, inspectDate, isDate, isMonth, monthBounds, obj, optEmployeeId,
  optMileage, optPlate, optTime, photoKey, plate, reqDate, str, text, todayTH,
} from './validate';

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  /** driver-licence photos only (separate private bucket) */
  LICENSES: R2Bucket;
  ASSETS: Fetcher;
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
  if (missing.length) throw bad(`ไม่พบรหัสพนักงาน ${missing.join(', ')}`);
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
  throw bad('ต้องระบุ date หรือ month');
}

/* =====================================================================
 * Me / master data
 * ===================================================================== */

export async function getMaster({ env }: Ctx) {
  const [emps, vehs, items, ppe, slots, roles, areas] = await env.DB.batch([
    env.DB.prepare(`SELECT id, name, coalesce(role, '') AS role, active FROM employees ORDER BY id`),
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

export async function putEmployee({ env, actor, req, params }: Ctx) {
  requireRole(actor, 'admin');
  const id = employeeId(decodeURIComponent(params[0]));
  const body = await readJson(req);
  const name = str(body.name, 'ชื่อ', 100);
  const roleIn = str(body.role, 'ตำแหน่ง', 30);
  const active = body.active === undefined ? true : bool(body.active, 'สถานะใช้งาน');

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
                            ELSE active_to END
         WHERE id = ?1`,
      ).bind(id, name, role, active ? 1 : 0, today)
    : env.DB.prepare(
        `INSERT INTO employees (id, name, role, active, active_from, active_to) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(id, name, role, active ? 1 : 0, today, active ? null : today);
  await env.DB.batch([stmt, audit(env, actor, existing ? 'update' : 'create', 'employees', id, { name, role, active })]);
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
    const cur = await env.DB.prepare(`SELECT id FROM vehicles WHERE id = ?1`).bind(id).first();
    if (!cur) throw notFound('ไม่พบรถคันนี้');
    if (same && same.id !== id) throw conflict(`ทะเบียน ${same.plate} มีอยู่แล้ว`);
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

/** Vehicles with history are deactivated instead of deleted, so reports keep their plate. */
export async function deleteVehicle({ env, actor, params }: Ctx) {
  requireRole(actor, 'admin');
  const id = decodeURIComponent(params[0]);
  const v = await env.DB.prepare(`SELECT id, plate FROM vehicles WHERE id = ?1`).bind(id).first<{ id: string; plate: string }>();
  if (!v) throw notFound('ไม่พบรถคันนี้');
  const used = await env.DB.prepare(
    `SELECT EXISTS (SELECT 1 FROM vehicle_inspections WHERE vehicle_id = ?1)
         OR EXISTS (SELECT 1 FROM ppe_inspections WHERE vehicle_id = ?1)
         OR EXISTS (SELECT 1 FROM trip_activities WHERE vehicle_id = ?1) AS used`,
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

export async function listVehicleInspections({ env, url }: Ctx) {
  const f = dateFilter(url);
  const { results } = await env.DB.prepare(
    `SELECT * FROM v_vehicle_inspection_summary WHERE ${f.sql}
     ORDER BY inspect_date, inspect_time IS NULL, inspect_time, plate`,
  ).bind(...f.args).all<Row>();
  return json(results.map(vehOut));
}

export async function saveVehicleInspection({ env, actor, req, exec }: Ctx) {
  requireStaff(actor);
  const b = await readJson(req);
  const reqId = b.id === undefined || b.id === null || b.id === '' ? null : str(b.id, 'รหัสบันทึก', 64);
  const date = inspectDate(b.date);
  const time = optTime(b.time);
  const dman = employeeId(b.dman, 'D-Man');
  let h1 = optEmployeeId(b.h1, 'Helper 1');
  let h2 = optEmployeeId(b.h2, 'Helper 2');
  if (!h1 && h2) { h1 = h2; h2 = null; } // Helper 2 alone becomes Helper 1
  const crew = [dman, h1, h2].filter((x): x is string => !!x);
  if (new Set(crew).size !== crew.length) throw bad('D-Man และ Helper ต้องเป็นคนละคนกัน');
  const mileage = optMileage(b.mileage);
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
  if (new Set(photoKeys.map(([, k]) => k)).size !== photoKeys.length) throw bad('ใช้รูปเดียวกันซ้ำหลายช่อง');

  // reference checks with clear messages (the DB enforces them again)
  const vehicle = await findVehicleByPlate(env, p);
  if (!vehicle) throw bad(`ยังไม่ได้ลงทะเบียนรถ ${p} — เพิ่มได้ที่แท็บตั้งค่า`);
  await assertEmployeesExist(env, crew);
  const [items, slots] = await env.DB.batch([
    env.DB.prepare(`SELECT item_no FROM check_items`),
    env.DB.prepare(`SELECT code FROM photo_slots WHERE active = 1`),
  ]);
  const itemSet = new Set((items.results as { item_no: number }[]).map((r) => String(r.item_no)));
  const badItem = Object.keys(results).find((k) => !itemSet.has(k));
  if (badItem) throw bad(`ไม่มีข้อตรวจที่ ${badItem}`);
  const slotSet = new Set((slots.results as { code: string }[]).map((r) => r.code));
  const badSlot = photoKeys.find(([s]) => !slotSet.has(s));
  if (badSlot) throw bad(`ไม่มีช่องรูป ${badSlot[0]}`);

  // which row are we writing?
  let id: string;
  let isNew = false;
  if (reqId) {
    const cur = await env.DB.prepare(`SELECT id, approved_at FROM vehicle_inspections WHERE id = ?1`)
      .bind(reqId).first<{ id: string; approved_at: string | null }>();
    if (!cur) throw notFound('ไม่พบบันทึกนี้ (อาจถูกลบไปแล้ว)');
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
    isNew = !cur;
    id = cur?.id ?? crypto.randomUUID();
  }
  const { results: old } = await env.DB.prepare(
    `SELECT r2_key FROM vehicle_inspection_photos WHERE inspection_id = ?1`,
  ).bind(id).all<{ r2_key: string }>();
  const oldKeys = old.map((r) => r.r2_key);

  // every referenced photo must really be in R2
  const photoMeta: Record<string, { k: string; t: string; s: number }> = {};
  await Promise.all(photoKeys.map(async ([slot, key]) => {
    const head = await env.PHOTOS.head(key);
    if (!head) throw bad(`ไม่พบไฟล์รูปช่อง ${slot} กรุณาอัปโหลดใหม่`);
    photoMeta[slot] = { k: key, t: head.httpMetadata?.contentType ?? 'image/jpeg', s: head.size };
  }));

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
         updated_by = excluded.updated_by, updated_at = ${NOW_SQL}`,
    ).bind(id, date, time, vehicle.id, mileage, dman, h1, h2, note, actor.id),
    env.DB.prepare(`DELETE FROM vehicle_inspection_results WHERE inspection_id = ?1`).bind(id),
    env.DB.prepare(
      `INSERT INTO vehicle_inspection_results (inspection_id, item_no, result)
       SELECT ?1, CAST(key AS INTEGER), value FROM json_each(?2)`,
    ).bind(id, JSON.stringify(results)),
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
    // PPE sheets of the same day and vehicle saved earlier get linked now
    env.DB.prepare(
      `UPDATE ppe_inspections SET vehicle_inspection_id = ?1
       WHERE inspect_date = ?2 AND vehicle_id = ?3 AND vehicle_inspection_id IS NULL`,
    ).bind(id, date, vehicle.id),
    audit(env, actor, isNew ? 'create' : 'update', 'vehicle_inspections', id, {
      date, time, plate: vehicle.plate, dman, h1, h2, mileage, note, results, photos: Object.fromEntries(photoKeys),
    }),
  ]);

  // photos that this record no longer uses
  const keep = new Set(photoKeys.map(([, k]) => k));
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
  const { results } = await env.DB.prepare(`SELECT r2_key FROM vehicle_inspection_photos WHERE inspection_id = ?1`)
    .bind(id).all<{ r2_key: string }>();
  await env.DB.batch([
    audit(env, actor, 'delete', 'vehicle_inspections', id, { date: cur.inspect_date, plate: cur.plate }),
    env.DB.prepare(`DELETE FROM vehicle_inspections WHERE id = ?1`).bind(id),
  ]);
  const keys = results.map((r) => r.r2_key);
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

export async function listPpeInspections({ env, url }: Ctx) {
  const f = dateFilter(url);
  const { results } = await env.DB.prepare(
    `SELECT * FROM v_ppe_inspection_summary WHERE ${f.sql} ORDER BY inspect_date, employee_id`,
  ).bind(...f.args).all<Row>();
  return json(results.map(ppeOut));
}

export async function savePpeInspections({ env, actor, req }: Ctx) {
  requireStaff(actor);
  const b = await readJson(req);
  const date = inspectDate(b.date);
  const inspector = employeeId(b.inspector, 'ผู้ตรวจ');
  const p = optPlate(b.plate);
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

  await assertEmployeesExist(env, [inspector, ...emps]);
  const { results: codes } = await env.DB.prepare(`SELECT code FROM ppe_items`).all<{ code: string }>();
  const codeSet = new Set(codes.map((c) => c.code));
  for (const items of Object.values(rows)) {
    const unknown = Object.keys(items).find((c) => !codeSet.has(c));
    if (unknown) throw bad(`ไม่มีอุปกรณ์รหัส ${unknown}`);
  }
  let vehicleId: string | null = null;
  if (p) {
    const v = await findVehicleByPlate(env, p);
    if (!v) throw bad(`ยังไม่ได้ลงทะเบียนรถ ${p} — เพิ่มได้ที่แท็บตั้งค่า หรือเว้นว่างไว้`);
    vehicleId = v.id;
  }
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
    await env.DB.batch([
      approve
        ? env.DB.prepare(`UPDATE ${table} SET approved_by = ?2, approved_at = ${NOW_SQL}, updated_by = ?2 WHERE id = ?1`).bind(id, actor.id)
        : env.DB.prepare(`UPDATE ${table} SET approved_by = NULL, approved_at = NULL, updated_by = ?2 WHERE id = ?1`).bind(id, actor.id),
      audit(env, actor, approve ? 'approve' : 'unapprove', table, id),
    ]);
    return json({ ok: true, approved: approve });
  };
}
export const approveVehicle = approval('vehicle_inspections', true);
export const unapproveVehicle = approval('vehicle_inspections', false);
export const approvePpe = approval('ppe_inspections', true);
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
  const key = `${date.slice(0, 7)}/${date}_${crypto.randomUUID()}.${IMAGE_TYPES[type]}`;
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

/** Delete photos that are not used by any saved inspection (e.g. replaced before saving). */
export async function deletePhotos({ env, actor, req }: Ctx) {
  requireStaff(actor);
  const b = await readJson(req);
  if (!Array.isArray(b.keys) || b.keys.length > 50) throw bad('keys ต้องเป็นรายการไม่เกิน 50 รายการ');
  const keys = [...new Set(b.keys.map(photoKey))];
  if (!keys.length) return json({ deleted: [], kept: [] });
  const { results } = await env.DB.prepare(
    `SELECT r2_key FROM vehicle_inspection_photos WHERE r2_key IN (SELECT value FROM json_each(?1))`,
  ).bind(JSON.stringify(keys)).all<{ r2_key: string }>();
  const used = new Set(results.map((r) => r.r2_key));
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
      const { results } = await env.DB.prepare(
        `SELECT r2_key FROM vehicle_inspection_photos WHERE r2_key IN (SELECT value FROM json_each(?1))`,
      ).bind(JSON.stringify(old)).all<{ r2_key: string }>();
      const used = new Set(results.map((r) => r.r2_key));
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
  'trip-activities': { view: 'v_trip_activity_summary', dateCol: 'activity_date', order: 'activity_date, depart_time, plate' },
  'trip-area-results': { view: 'v_trip_area_results', dateCol: 'activity_date', order: 'activity_date, plate, area_code' },
  'trip-area-monthly': { view: 'v_trip_area_monthly', dateCol: '', order: 'month, sort_order' },
};

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function getReport({ env, url, params }: Ctx) {
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
