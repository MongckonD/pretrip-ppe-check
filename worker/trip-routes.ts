/**
 * Time activities: before leaving, record the departure time, D-Man and which area types the trip covers.
 * 1 trip = 1 vehicle / 1 day; links automatically to that day's vehicle inspection.
 */
import { requireStaff } from './auth';
import { bad, conflict, json, notFound, readJson } from './http';
import {
  NOW_SQL, audit, dateFilter, findVehicleByPlate, parse, type Ctx,
} from './routes';
import { nowTimeTH, optTime, plate, str, text, todayTH } from './validate';

type Row = Record<string, unknown>;

function tripOut(r: Row) {
  return {
    id: r.id, activity_date: r.activity_date, month: r.month, depart_time: r.depart_time,
    vehicle_id: r.vehicle_id, plate: r.plate, vehicle_type: r.vehicle_type,
    dman_id: r.dman_id, dman_name: r.dman_name,
    vehicle_inspection_id: r.vehicle_inspection_id, inspected: r.inspected === 1,
    area_codes: parse<string[]>(r.area_codes, []), area_names: r.area_names, area_count: r.area_count,
    note: r.note,
    work_started_at: r.work_started_at ?? null, work_ended_at: r.work_ended_at ?? null,
    work_minutes: r.work_minutes ?? null, work_status: r.work_status,
    created_by: r.created_by, updated_by: r.updated_by, created_at: r.created_at, updated_at: r.updated_at,
  };
}

export async function listTripActivities({ env, url }: Ctx) {
  const f = dateFilter(url);
  const where = f.sql.replace('inspect_date', 'activity_date');
  const { results } = await env.DB.prepare(
    `SELECT * FROM v_trip_activity_summary WHERE ${where} ORDER BY activity_date, depart_time, plate`,
  ).bind(...f.args).all<Row>();
  return json(results.map(tripOut));
}

export async function saveTripActivity({ env, actor, req }: Ctx) {
  requireStaff(actor);
  const b = await readJson(req);
  const reqId = b.id === undefined || b.id === null || b.id === '' ? null : str(b.id, 'รหัสบันทึก', 64);
  // the date is set by the server (today, Thai time; an edit keeps its original date); departure time is entered by staff
  let date = todayTH();
  const time = optTime(b.time);
  if (!time) throw bad('กรุณาระบุเวลาออกงาน');
  const p = plate(b.plate);
  const note = text(b.note, 'หมายเหตุ', 1000);

  if (!Array.isArray(b.areas)) throw bad('ประเภทพื้นที่ไม่ถูกต้อง');
  const areas = [...new Set(b.areas.map((a) => str(a, 'ประเภทพื้นที่', 30)))];
  if (!areas.length) throw bad('เลือกประเภทพื้นที่อย่างน้อย 1 อย่าง');
  if (areas.length > 20) throw bad('เลือกประเภทพื้นที่ได้ไม่เกิน 20 อย่าง');

  const vehicle = await findVehicleByPlate(env, p);
  if (!vehicle) throw bad(`ยังไม่ได้ลงทะเบียนรถ ${p} — เพิ่มได้ที่แท็บตั้งค่า`);

  // which trip are we writing?
  let id: string;
  let isNew = false;
  let keepAreas = new Set<string>();
  if (reqId) {
    const cur = await env.DB.prepare(`SELECT id, activity_date FROM trip_activities WHERE id = ?1`)
      .bind(reqId).first<{ id: string; activity_date: string }>();
    if (!cur) throw notFound('ไม่พบบันทึกนี้ (อาจถูกลบไปแล้ว)');
    date = cur.activity_date;
    const clash = await env.DB.prepare(
      `SELECT id FROM trip_activities WHERE activity_date = ?1 AND vehicle_id = ?2 AND id <> ?3`,
    ).bind(date, vehicle.id, reqId).first();
    if (clash) throw bad(`ทะเบียน ${vehicle.plate} มีบันทึกก่อนออกงานของวันที่ ${date} แล้ว`);
    id = reqId;
  } else {
    const cur = await env.DB.prepare(`SELECT id FROM trip_activities WHERE activity_date = ?1 AND vehicle_id = ?2`)
      .bind(date, vehicle.id).first<{ id: string }>();
    if (!cur && vehicle.active !== 1) throw bad(`รถ ${vehicle.plate} ปิดใช้งานแล้ว เปิดใช้งานใหม่ได้ที่แท็บตั้งค่า`);
    isNew = !cur;
    id = cur?.id ?? crypto.randomUUID();
  }

  // the trip follows that day's vehicle check: same vehicle, and its D-Man (not typed separately)
  const vi = await env.DB.prepare(`SELECT dman_id FROM vehicle_inspections WHERE inspect_date = ?1 AND vehicle_id = ?2`)
    .bind(date, vehicle.id).first<{ dman_id: string }>();
  if (!vi) throw bad(`ยังไม่ได้ตรวจรถทะเบียน ${vehicle.plate} วันนี้ — ตรวจรถก่อนแล้วค่อยบันทึกก่อนออกงาน`);
  const dman = vi.dman_id;

  if (!isNew) {
    // an area type switched off later may stay on a record that already had it
    const { results } = await env.DB.prepare(`SELECT area_code FROM trip_activity_areas WHERE trip_activity_id = ?1`)
      .bind(id).all<{ area_code: string }>();
    keepAreas = new Set(results.map((r) => r.area_code));
  }
  const { results: known } = await env.DB.prepare(`SELECT code, active FROM area_types`).all<{ code: string; active: number }>();
  const byCode = new Map(known.map((a) => [a.code, a.active]));
  for (const a of areas) {
    if (!byCode.has(a)) throw bad(`ไม่มีประเภทพื้นที่รหัส ${a}`);
    if (byCode.get(a) !== 1 && !keepAreas.has(a)) throw bad(`ประเภทพื้นที่ ${a} ปิดใช้งานแล้ว`);
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO trip_activities
         (id, activity_date, depart_time, vehicle_id, dman_id, vehicle_inspection_id, note, created_by, updated_by)
       VALUES (?1, ?2, ?3, ?4, ?5,
               (SELECT v.id FROM vehicle_inspections v WHERE v.inspect_date = ?2 AND v.vehicle_id = ?4),
               ?6, ?7, ?7)
       ON CONFLICT (id) DO UPDATE SET
         activity_date = excluded.activity_date, depart_time = excluded.depart_time,
         vehicle_id = excluded.vehicle_id, dman_id = excluded.dman_id,
         vehicle_inspection_id = excluded.vehicle_inspection_id, note = excluded.note,
         updated_by = excluded.updated_by, updated_at = ${NOW_SQL}`,
    ).bind(id, date, time, vehicle.id, dman, note, actor.id),
    env.DB.prepare(`DELETE FROM trip_activity_areas WHERE trip_activity_id = ?1`).bind(id),
    env.DB.prepare(
      `INSERT INTO trip_activity_areas (trip_activity_id, area_code) SELECT ?1, value FROM json_each(?2)`,
    ).bind(id, JSON.stringify(areas)),
    audit(env, actor, isNew ? 'create' : 'update', 'trip_activities', id, {
      date, time, plate: vehicle.plate, dman, areas, note,
    }),
  ]);
  return json({ id });
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

/* =====================================================================
 * Work time: "เริ่มการทำงาน" / "จบงาน" — one start and one end per vehicle per day, stamped by the server
 * ===================================================================== */

/** POST /api/trip-activities/start { plate, time? } — starts the work clock for today's trip of this vehicle */
export async function startWork({ env, actor, req }: Ctx) {
  requireStaff(actor);
  const b = await readJson(req);
  const p = plate(b.plate);
  const time = optTime(b.time) ?? nowTimeTH();
  const date = todayTH();
  const vehicle = await findVehicleByPlate(env, p);
  if (!vehicle) throw bad(`ยังไม่ได้ลงทะเบียนรถ ${p} — เพิ่มได้ที่แท็บตั้งค่า`);
  const vi = await env.DB.prepare(`SELECT id, dman_id FROM vehicle_inspections WHERE inspect_date = ?1 AND vehicle_id = ?2`)
    .bind(date, vehicle.id).first<{ id: string; dman_id: string }>();
  if (!vi) throw bad(`ยังไม่ได้ตรวจรถทะเบียน ${vehicle.plate} วันนี้ — ตรวจรถก่อนแล้วค่อยเริ่มการทำงาน`);
  const cur = await env.DB.prepare(`SELECT id, work_started_at FROM trip_activities WHERE activity_date = ?1 AND vehicle_id = ?2`)
    .bind(date, vehicle.id).first<{ id: string; work_started_at: string | null }>();
  if (cur?.work_started_at) throw conflict(`รถ ${vehicle.plate} เริ่มการทำงานของวันนี้ไปแล้ว`);

  const now = new Date().toISOString();
  const id = cur?.id ?? crypto.randomUUID();
  await env.DB.batch([
    cur
      ? env.DB.prepare(
        `UPDATE trip_activities SET work_started_at = ?2, work_started_by = ?3, depart_time = ?4, dman_id = ?5,
           vehicle_inspection_id = ?6, updated_by = ?3, updated_at = ${NOW_SQL} WHERE id = ?1`,
      ).bind(id, now, actor.id, time, vi.dman_id, vi.id)
      : env.DB.prepare(
        `INSERT INTO trip_activities (id, activity_date, depart_time, vehicle_id, dman_id, vehicle_inspection_id, note,
           created_by, updated_by, work_started_at, work_started_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, '', ?7, ?7, ?8, ?7)`,
      ).bind(id, date, time, vehicle.id, vi.dman_id, vi.id, actor.id, now),
    audit(env, actor, 'update', 'trip_activities', id, { plate: vehicle.plate, work_started_at: now }),
  ]);
  return json({ id, work_started_at: now });
}

/** POST /api/trip-activities/:id/end — stops the work clock */
export async function endWork({ env, actor, params }: Ctx) {
  requireStaff(actor);
  const id = decodeURIComponent(params[0]);
  const cur = await env.DB.prepare(`SELECT work_started_at, work_ended_at FROM trip_activities WHERE id = ?1`)
    .bind(id).first<{ work_started_at: string | null; work_ended_at: string | null }>();
  if (!cur) throw notFound('ไม่พบบันทึกนี้ (อาจถูกลบไปแล้ว)');
  if (!cur.work_started_at) throw bad('ยังไม่ได้กดเริ่มการทำงาน');
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
