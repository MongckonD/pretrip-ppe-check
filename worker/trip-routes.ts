/**
 * Time activities = the work clock of a vehicle's team for one day.
 *   POST /api/trip-activities/start      "เริ่มการทำงาน": creates today's record, start time stamped by the server
 *   POST /api/trip-activities/:id/end    "จบงาน / หยุดเวลาทำงาน": end time stamped by the server
 * 1 record = 1 vehicle / 1 day, tied to that day's vehicle check (vehicle + D-Man come from it).
 */
import { requireStaff } from './auth';
import { bad, conflict, json, notFound, readJson } from './http';
import { NOW_SQL, assertMyCheck, audit, dateFilter, findVehicleByPlate, parse, type CheckOwner, type Ctx } from './routes';
import { plate, todayTH } from './validate';

type Row = Record<string, unknown>;

function tripOut(r: Row) {
  return {
    id: r.id, activity_date: r.activity_date, month: r.month,
    start_time: r.start_time, end_time: r.end_time ?? null,
    vehicle_id: r.vehicle_id, plate: r.plate, vehicle_type: r.vehicle_type,
    dman_id: r.dman_id, dman_name: r.dman_name,
    vehicle_inspection_id: r.vehicle_inspection_id, inspected: r.inspected === 1,
    area_codes: parse<string[]>(r.area_codes, []),
    work_started_at: r.work_started_at, work_ended_at: r.work_ended_at ?? null,
    work_minutes: r.work_minutes ?? null, work_status: r.work_status,
    created_by: r.created_by, updated_by: r.updated_by, created_at: r.created_at, updated_at: r.updated_at,
  };
}

export async function listTripActivities({ env, url }: Ctx) {
  const f = dateFilter(url);
  const where = f.sql.replace('inspect_date', 'activity_date');
  const { results } = await env.DB.prepare(
    `SELECT * FROM v_trip_activity_summary WHERE ${where} ORDER BY activity_date, work_started_at, plate`,
  ).bind(...f.args).all<Row>();
  return json(results.map(tripOut));
}

export async function deleteTripActivity({ env, actor, params }: Ctx) {
  requireStaff(actor);
  const id = decodeURIComponent(params[0]);
  const cur = await env.DB.prepare(
    `SELECT t.id, t.activity_date, v.plate FROM trip_activities t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = ?1`,
  ).bind(id).first<{ id: string; activity_date: string; plate: string }>();
  if (!cur) throw notFound('ไม่พบบันทึกนี้ (อาจถูกลบไปแล้ว)');
  await env.DB.batch([
    audit(env, actor, 'delete', 'trip_activities', id, { date: cur.activity_date, plate: cur.plate }),
    env.DB.prepare(`DELETE FROM trip_activities WHERE id = ?1`).bind(id),
  ]);
  return json({ ok: true });
}

/** POST /api/trip-activities/start { plate } — starts the work clock: today's record of this vehicle, time = now */
export async function startWork({ env, actor, req }: Ctx) {
  requireStaff(actor);
  const b = await readJson(req);
  const p = plate(b.plate);
  const date = todayTH();
  const vehicle = await findVehicleByPlate(env, p);
  if (!vehicle) throw bad(`ยังไม่ได้ลงทะเบียนรถ ${p} — เพิ่มได้ที่แท็บตั้งค่า`);
  const vi = await env.DB.prepare(
    `SELECT id, created_by, dman_id, helper1_id, helper2_id FROM vehicle_inspections WHERE inspect_date = ?1 AND vehicle_id = ?2`,
  ).bind(date, vehicle.id).first<CheckOwner & { id: string }>();
  if (!vi) throw bad(`ยังไม่ได้ตรวจรถทะเบียน ${vehicle.plate} วันนี้ — ตรวจรถก่อนแล้วค่อยเริ่มการทำงาน`);
  assertMyCheck(actor, vi, vehicle.plate);
  const cur = await env.DB.prepare(`SELECT id FROM trip_activities WHERE activity_date = ?1 AND vehicle_id = ?2`)
    .bind(date, vehicle.id).first<{ id: string }>();
  if (cur) throw conflict(`รถ ${vehicle.plate} เริ่มการทำงานของวันนี้ไปแล้ว`);

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO trip_activities (id, activity_date, vehicle_id, dman_id, vehicle_inspection_id,
         created_by, updated_by, work_started_at, work_started_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?6)`,
    ).bind(id, date, vehicle.id, vi.dman_id, vi.id, actor.id, now),
    audit(env, actor, 'create', 'trip_activities', id, { date, plate: vehicle.plate, work_started_at: now }),
  ]);
  return json({ id, work_started_at: now });
}

/** POST /api/trip-activities/:id/end — stops the work clock */
export async function endWork({ env, actor, params }: Ctx) {
  requireStaff(actor);
  const id = decodeURIComponent(params[0]);
  const cur = await env.DB.prepare(
    `SELECT t.work_ended_at, t.created_by AS trip_by, v.plate, vi.created_by, coalesce(vi.dman_id, t.dman_id) AS dman_id, vi.helper1_id, vi.helper2_id
     FROM trip_activities t JOIN vehicles v ON v.id = t.vehicle_id
     LEFT JOIN vehicle_inspections vi ON vi.id = t.vehicle_inspection_id
     WHERE t.id = ?1`,
  ).bind(id).first<CheckOwner & { work_ended_at: string | null; trip_by: string | null; plate: string }>();
  if (!cur) throw notFound('ไม่พบบันทึกนี้ (อาจถูกลบไปแล้ว)');
  // whoever started the clock may stop it; otherwise the same team rule as the start
  if (cur.trip_by !== actor.id) assertMyCheck(actor, cur, cur.plate);
  if (cur.work_ended_at) throw conflict('จบงานไปแล้ว');
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE trip_activities SET work_ended_at = ?2, work_ended_by = ?3, updated_by = ?3, updated_at = ${NOW_SQL}
       WHERE id = ?1 AND work_ended_at IS NULL`,
    ).bind(id, now, actor.id),
    audit(env, actor, 'update', 'trip_activities', id, { work_ended_at: now }),
  ]);
  return json({ id, work_ended_at: now });
}
