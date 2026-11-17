/**
 * Time activities: before leaving, record the departure time, D-Man and which area types the trip covers.
 * 1 trip = 1 vehicle / 1 day; links automatically to that day's vehicle inspection.
 */
import { requireRole } from './auth';
import { bad, json, notFound, readJson } from './http';
import {
  NOW_SQL, assertEmployeesExist, audit, dateFilter, findVehicleByPlate, parse, type Ctx,
} from './routes';
import { employeeId, inspectDate, optTime, plate, str, text } from './validate';

type Row = Record<string, unknown>;

function tripOut(r: Row) {
  return {
    id: r.id, activity_date: r.activity_date, month: r.month, depart_time: r.depart_time,
    vehicle_id: r.vehicle_id, plate: r.plate, vehicle_type: r.vehicle_type,
    dman_id: r.dman_id, dman_name: r.dman_name,
    vehicle_inspection_id: r.vehicle_inspection_id, inspected: r.inspected === 1,
    area_codes: parse<string[]>(r.area_codes, []), area_names: r.area_names, area_count: r.area_count,
    note: r.note, created_by: r.created_by, updated_by: r.updated_by, created_at: r.created_at, updated_at: r.updated_at,
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
  requireRole(actor, 'user');
  const b = await readJson(req);
  const reqId = b.id === undefined || b.id === null || b.id === '' ? null : str(b.id, 'รหัสบันทึก', 64);
  const date = inspectDate(b.date);
  const time = optTime(b.time);
  if (!time) throw bad('กรุณาระบุเวลาออกงาน');
  const p = plate(b.plate);
  const dman = employeeId(b.dman, 'D-Man');
  const note = text(b.note, 'หมายเหตุ', 1000);

  if (!Array.isArray(b.areas)) throw bad('ประเภทพื้นที่ไม่ถูกต้อง');
  const areas = [...new Set(b.areas.map((a) => str(a, 'ประเภทพื้นที่', 30)))];
  if (!areas.length) throw bad('เลือกประเภทพื้นที่อย่างน้อย 1 อย่าง');
  if (areas.length > 20) throw bad('เลือกประเภทพื้นที่ได้ไม่เกิน 20 อย่าง');

  const vehicle = await findVehicleByPlate(env, p);
  if (!vehicle) throw bad(`ยังไม่ได้ลงทะเบียนรถ ${p} — เพิ่มได้ที่แท็บตั้งค่า`);
  await assertEmployeesExist(env, [dman]);

  // which trip are we writing?
  let id: string;
  let isNew = false;
  let keepAreas = new Set<string>();
  if (reqId) {
    const cur = await env.DB.prepare(`SELECT id FROM trip_activities WHERE id = ?1`).bind(reqId).first();
    if (!cur) throw notFound('ไม่พบบันทึกนี้ (อาจถูกลบไปแล้ว)');
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
  requireRole(actor, 'user');
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
