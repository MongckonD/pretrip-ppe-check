/**
 * จับเวลาส่งสินค้าที่ร้าน (store_visits, migration 0025): the status of each store of today's delivery plan.
 *
 *   POST   /api/store-visits/start          { plan_id }                 "รถจอดแล้ว — เริ่มส่งร้านนี้"  (started_at = now)
 *   POST   /api/store-visits/:id/end                                     "รถออกจากร้าน — จบร้านนี้"     (ended_at = now)
 *   POST   /api/store-visits/:id/resume                                  "กดจบผิด" (ended_at cleared, only before saving)
 *   POST   /api/store-visits/:id/save       { cases, skus?, distance_m?, method? }   finish form → ส่งสำเร็จ (final)
 *   POST   /api/store-visits/fail           { plan_id, note }           "ส่งไม่สำเร็จ" (note required)
 *   DELETE /api/store-visits/:id                                         "ยกเลิกร้านนี้" (open) / "ยกเลิกสถานะ" (failed)
 *   DELETE /api/store-visits?plate=…        LOCAL DEVELOPMENT ONLY: clear today's statuses of a vehicle (refused elsewhere)
 *   GET    /api/store-visits?from=…&to=…   admin report: 1 row per store of the plan per day (view v_store_visit_summary)
 *
 * The statuses are read together with the plan (GET /api/delivery-plan, delivery-routes.ts) — no extra request.
 *
 * Rules (the database enforces the same ones, migration 0025 — these checks only give clear messages):
 *   - the data belongs to the VEHICLE and the day (whoever of the team presses it; each row keeps who pressed)
 *   - only today's stores; only the vehicle's team (same rule as the vehicle check); staff accounts only
 *   - timing starts after "เริ่มการทำงาน" and stops at "จบงาน" (afterwards nothing can change)
 *   - one store "open" at a time per vehicle; one status per store; a delivered store is final
 *   - every time is stamped by the server (never the phone's clock)
 * Hidden unless the Worker var FEATURE_STORE_TIMER is "1" (every route answers 404 otherwise).
 */
import { requireRole, requireStaff, type Actor } from './auth';
import { bad, conflict, forbidden, json, notFound, readJson } from './http';
import { NOW_SQL, assertMyCheck, audit, dateFilter, findVehicleByPlate, type CheckOwner, type Ctx, type Env } from './routes';
import { todayTH } from './validate';

function requireFeature(env: Env) {
  if (env.FEATURE_STORE_TIMER !== '1' || env.FEATURE_STORE_DELIVERY !== '1') throw notFound('ไม่พบ API นี้');
}

const MOVE_METHODS = new Set(['trolley', 'carry', 'both']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** the plan row with everything the rules need: its vehicle, the day's work record and the team (one query) */
type PlanCtx = CheckOwner & {
  plan_id: string; plan_date: string; vehicle_id: string; plate: string; store: string;
  trip_id: string | null; work_ended_at: string | null; has_check: number;
};
async function planContext(env: Env, actor: Actor, planId: string): Promise<PlanCtx> {
  const c = await env.DB.prepare(
    `SELECT p.id AS plan_id, p.plan_date, p.vehicle_id, v.plate, coalesce(nullif(p.store_name, ''), s.name) AS store,
            t.id AS trip_id, t.work_ended_at,
            vi.id IS NOT NULL AS has_check, vi.created_by, vi.dman_id, vi.helper1_id, vi.helper2_id
       FROM delivery_plan p
       JOIN vehicles v ON v.id = p.vehicle_id
       JOIN stores s ON s.id = p.store_id
       LEFT JOIN trip_activities t ON t.activity_date = p.plan_date AND t.vehicle_id = p.vehicle_id
       LEFT JOIN vehicle_inspections vi ON vi.inspect_date = p.plan_date AND vi.vehicle_id = p.vehicle_id
      WHERE p.id = ?1`,
  ).bind(planId).first<PlanCtx>();
  if (!c) throw notFound('ไม่พบร้านนี้ในแผนส่ง (อาจถูกลบไปแล้ว) — กดรีเฟรช');
  if (c.plan_date !== todayTH()) throw bad('จับเวลาได้เฉพาะร้านของวันนี้');
  // staff only (requireStaff): the vehicle's team, same rule as the vehicle check
  if (!c.has_check) throw bad(`ยังไม่ได้ตรวจรถทะเบียน ${c.plate} วันนี้`);
  assertMyCheck(actor, c, c.plate);
  if (!c.trip_id) throw bad(`กด "เริ่มการทำงาน" ของรถ ${c.plate} ก่อน จึงจะจับเวลาร้านค้าได้`);
  if (c.work_ended_at) throw conflict(`รถ ${c.plate} จบงานแล้ว — จับเวลาร้านค้าหรือเปลี่ยนสถานะร้านไม่ได้`);
  return c;
}

type VisitRow = { id: string; plan_id: string; status: 'open' | 'done' | 'failed'; ended_at: string | null };
async function visitContext(env: Env, actor: Actor, id: string) {
  const v = await env.DB.prepare(`SELECT id, plan_id, status, ended_at FROM store_visits WHERE id = ?1`).bind(id).first<VisitRow>();
  if (!v) throw notFound('ไม่พบรายการนี้ (อาจถูกยกเลิกไปแล้ว) — กดรีเฟรช');
  return { v, c: await planContext(env, actor, v.plan_id) };
}

const planIdOf = (x: unknown) => {
  const id = typeof x === 'string' ? x.trim() : '';
  if (!id || id.length > 64) throw bad('ไม่พบร้าน');
  return id;
};
/** optional whole number 0–100000 ('' / null = not given) */
function intOrNull(v: unknown, label: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  const t = String(v).replace(/,/g, '').trim();
  if (!/^\d+$/.test(t) || Number(t) > 100000) throw bad(`${label} ต้องเป็นเลขจำนวนเต็ม 0–100,000`);
  return Number(t);
}

/** POST /api/store-visits/start { plan_id } */
export async function startStoreVisit({ env, actor, req }: Ctx) {
  requireFeature(env);
  requireStaff(actor);
  const b = await readJson(req);
  const c = await planContext(env, actor, planIdOf(b.plan_id));
  const cur = await env.DB.prepare(
    `SELECT sv.plan_id, sv.status, coalesce(nullif(p.store_name, ''), s.name) AS store
       FROM store_visits sv JOIN delivery_plan p ON p.id = sv.plan_id JOIN stores s ON s.id = p.store_id
      WHERE sv.plan_id = ?1 OR (sv.trip_activity_id = ?2 AND sv.status = 'open')`,
  ).bind(c.plan_id, c.trip_id).all<{ plan_id: string; status: string; store: string }>();
  const same = cur.results.find((x) => x.plan_id === c.plan_id);
  if (same) {
    throw conflict(same.status === 'done' ? `${c.store} ส่งไปแล้ววันนี้`
      : same.status === 'failed' ? `${c.store} บันทึกว่าส่งไม่สำเร็จแล้ว — ยกเลิกสถานะนั้นก่อนถ้าจะส่งใหม่`
        : `${c.store} กำลังจับเวลาอยู่แล้ว`);
  }
  const other = cur.results.find((x) => x.status === 'open');
  if (other) throw conflict(`กำลังจับเวลา ${other.store} อยู่ — จบร้านนั้นก่อน`);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO store_visits (id, plan_id, trip_activity_id, status, started_at, started_by) VALUES (?1, ?2, ?3, 'open', ?4, ?5)`,
    ).bind(id, c.plan_id, c.trip_id, now, actor.id),
    audit(env, actor, 'create', 'store_visits', id, { plan_id: c.plan_id, plate: c.plate, store: c.store, started_at: now }),
  ]);
  return json({ id, started_at: now });
}

/** POST /api/store-visits/:id/end — the truck leaves (the finish form opens) */
export async function endStoreVisit({ env, actor, params }: Ctx) {
  requireFeature(env);
  requireStaff(actor);
  const { v } = await visitContext(env, actor, decodeURIComponent(params[0]));
  if (v.status !== 'open') throw conflict('ร้านนี้ไม่ได้กำลังจับเวลาอยู่ — กดรีเฟรช');
  if (v.ended_at) return json({ id: v.id, ended_at: v.ended_at }); // pressed twice: keep the first time
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE store_visits SET ended_at = ?2, ended_by = ?3, updated_at = ${NOW_SQL} WHERE id = ?1 AND status = 'open' AND ended_at IS NULL`,
  ).bind(v.id, now, actor.id).run();
  return json({ id: v.id, ended_at: now });
}

/** POST /api/store-visits/:id/resume — "กดจบผิด": the clock runs on (only before the form is saved) */
export async function resumeStoreVisit({ env, actor, params }: Ctx) {
  requireFeature(env);
  requireStaff(actor);
  const { v } = await visitContext(env, actor, decodeURIComponent(params[0]));
  if (v.status !== 'open') throw conflict('บันทึกร้านนี้ไปแล้ว — แก้ไม่ได้');
  await env.DB.prepare(
    `UPDATE store_visits SET ended_at = NULL, ended_by = NULL, updated_at = ${NOW_SQL} WHERE id = ?1 AND status = 'open'`,
  ).bind(v.id).run();
  return json({ ok: true });
}

/** POST /api/store-visits/:id/save — the finish form: ส่งสำเร็จ (final, cannot be changed afterwards) */
export async function saveStoreVisit({ env, actor, params, req }: Ctx) {
  requireFeature(env);
  requireStaff(actor);
  const b = await readJson(req);
  const { v, c } = await visitContext(env, actor, decodeURIComponent(params[0]));
  if (v.status === 'done') throw conflict('บันทึกร้านนี้ไปแล้ว');
  if (v.status !== 'open') throw conflict('ร้านนี้ไม่ได้กำลังจับเวลาอยู่ — กดรีเฟรช');
  if (!v.ended_at) throw bad('กด "รถออกจากร้าน" ก่อน แล้วค่อยบันทึก');
  const cases = intOrNull(b.cases, 'จำนวนลัง');
  if (cases === null) throw bad('กรอกจำนวนลังที่ส่ง');
  const skus = intOrNull(b.skus, 'จำนวน SKU');
  const dist = intOrNull(b.distance_m, 'ระยะทาง');
  const method = b.method === null || b.method === undefined || b.method === '' ? null : String(b.method);
  if (method !== null && !MOVE_METHODS.has(method)) throw bad('วิธีขนย้ายไม่ถูกต้อง');
  const upd = await env.DB.prepare(
    `UPDATE store_visits SET status = 'done', cases = ?2, skus = ?3, distance_m = ?4, move_method = ?5, updated_at = ${NOW_SQL}
      WHERE id = ?1 AND status = 'open' AND ended_at IS NOT NULL`,
  ).bind(v.id, cases, skus, dist, method).run();
  // changed meanwhile (cancelled / "กดจบผิด" on another phone): nothing was saved — say so instead of "saved"
  if (!upd.meta.changes) throw conflict('ร้านนี้ถูกเปลี่ยนจากอีกเครื่อง — กดรีเฟรช แล้วลองใหม่');
  await audit(env, actor, 'update', 'store_visits', v.id, { plate: c.plate, store: c.store, status: 'done', cases, skus, distance_m: dist, method }).run();
  return json({ ok: true });
}

/** POST /api/store-visits/fail { plan_id, note } — ส่งไม่สำเร็จ */
export async function failStoreVisit({ env, actor, req }: Ctx) {
  requireFeature(env);
  requireStaff(actor);
  const b = await readJson(req);
  const c = await planContext(env, actor, planIdOf(b.plan_id));
  const note = (typeof b.note === 'string' ? b.note : '').trim().replace(/\s+/g, ' ');
  if (!note) throw bad('เขียนหมายเหตุก่อนว่าทำไมส่งไม่สำเร็จ');
  if (note.length > 300) throw bad('หมายเหตุยาวเกิน 300 ตัวอักษร');
  const cur = await env.DB.prepare(`SELECT status FROM store_visits WHERE plan_id = ?1`).bind(c.plan_id).first<{ status: string }>();
  if (cur) throw conflict(cur.status === 'done' ? `${c.store} ส่งไปแล้ววันนี้` : cur.status === 'open' ? `${c.store} กำลังจับเวลาอยู่ — ยกเลิกร้านนั้นก่อน` : `${c.store} บันทึกว่าส่งไม่สำเร็จแล้ว`);
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO store_visits (id, plan_id, trip_activity_id, status, note, started_by) VALUES (?1, ?2, ?3, 'failed', ?4, ?5)`,
    ).bind(id, c.plan_id, c.trip_id, note, actor.id),
    audit(env, actor, 'create', 'store_visits', id, { plan_id: c.plan_id, plate: c.plate, store: c.store, status: 'failed', note }),
  ]);
  return json({ id });
}

/** DELETE /api/store-visits/:id — cancel a store being timed, or put a "ส่งไม่สำเร็จ" back (a delivered store is final) */
export async function deleteStoreVisit({ env, actor, params }: Ctx) {
  requireFeature(env);
  requireStaff(actor);
  const { v, c } = await visitContext(env, actor, decodeURIComponent(params[0]));
  if (v.status === 'done') throw conflict('ส่งสำเร็จแล้ว — ยกเลิกไม่ได้');
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM store_visits WHERE id = ?1 AND status <> 'done'`).bind(v.id),
    audit(env, actor, 'delete', 'store_visits', v.id, { plan_id: v.plan_id, plate: c.plate, store: c.store, status: v.status }),
  ]);
  return json({ ok: true });
}

/** DELETE /api/store-visits?plate=… — LOCAL DEVELOPMENT ONLY ("ล้างข้อมูลทดลอง"): never on the live site */
export async function devResetStoreVisits({ env, actor, url }: Ctx) {
  requireFeature(env);
  requireStaff(actor);
  if (!LOCAL_HOSTS.has(url.hostname)) throw forbidden('ใช้ได้เฉพาะเครื่องพัฒนา');
  const veh = await findVehicleByPlate(env, url.searchParams.get('plate') ?? '');
  if (!veh) throw bad('ไม่พบรถ');
  await env.DB.prepare(
    `DELETE FROM store_visits WHERE trip_activity_id IN (SELECT id FROM trip_activities WHERE activity_date = ?1 AND vehicle_id = ?2)`,
  ).bind(todayTH(), veh.id).run();
  return json({ ok: true });
}

/** GET /api/store-visits?from=…&to=… (or ?date= / ?month=) — admin report from the view v_store_visit_summary (migration 0027) */
export async function listStoreVisitReport({ env, actor, url }: Ctx) {
  requireFeature(env);
  requireRole(actor, 'admin');
  const f = dateFilter(url); // at most 366 days
  const { results } = await env.DB.prepare(
    `SELECT plan_id, plan_date, plate, sort_order, sap_code, store_name, store_type, bills, plan_cases, status, started_at, ended_at,
            seconds, cases, skus, distance_m, move_method, note, by_name, dman_name
       FROM v_store_visit_summary WHERE ${f.sql.replace('inspect_date', 'plan_date')}
      ORDER BY plan_date DESC, plate, coalesce(started_at, '9'), sort_order`,
  ).bind(...f.args).all();
  return json(results);
}
