/**
 * ร้านค้าที่ต้องส่ง: the stores each vehicle must deliver to on a day (imported from an SAP export by the admin).
 *
 *   GET    /api/delivery-plan?date=…[&plate=…]  admin: every vehicle of the day · staff: only `plate`, today, own team
 *   POST   /api/delivery-plan/import            admin: { date, mode: 'replace'|'append', rows, commit } — commit=false checks only;
 *                                                each row has its own delivery date (blank = date); replace = every date in the file
 *   POST   /api/delivery-plan                   admin: add one store { date, plate, code, name, type, cases, bill }
 *   DELETE /api/delivery-plan/:id               admin: take one store off the plan
 *   DELETE /api/delivery-plan?date=…            admin: clear the day
 *
 * Delivery logic: past days are locked (view only); a store is on one vehicle per day; a bill number is one delivery
 * only (unique across all days, migration 0023).
 * Tables (migration 0022): stores (by SAP code, current data) · delivery_plan (1 row = 1 store on 1 day, one vehicle only;
 * keeps the store name / type / address of that day, migration 0024) ·
 * delivery_bills (1 row = 1 bill; a store's cases = the sum of its bills).
 * Hidden unless the Worker var FEATURE_STORE_DELIVERY is "1" (every route answers 404 otherwise).
 * Store timer (store_visits, migration 0025): with FEATURE_STORE_TIMER = "1" each stop also carries its delivery status.
 * A store that has a status (กำลังส่ง / ส่งสำเร็จ / ส่งไม่สำเร็จ) cannot leave the plan: แทนที่, ลบร้าน and ล้างทั้งวัน are refused
 * with the store names (the database refuses it too: FK RESTRICT).
 * Writes use a few set-based statements (json_each) so a 500-row file stays within D1's per-request query limit.
 */
import { requireRole } from './auth';
import { bad, conflict, json, notFound, readJson } from './http';
import { NOW_SQL, assertMyCheck, audit, findVehicleByPlate, type CheckOwner, type Ctx, type Env } from './routes';
import { plate as plateIn, reqDate, todayTH } from './validate';

const MAX_ROWS = 500;

/** server-side feature switch: the routes do not exist until it is on */
function requireFeature(env: Env) {
  if (env.FEATURE_STORE_DELIVERY !== '1') throw notFound('ไม่พบ API นี้');
}

const s = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').trim().replace(/\s+/g, ' ');
/** SAP customer code as stored: upper case, no spaces */
const sapCode = (v: unknown) => s(v).replace(/\s+/g, '').toUpperCase();
const plateKey = (p: string) => p.replace(/[\s.-]/g, '').toUpperCase();
/**
 * จำนวนลัง: a whole number 0–100000 (thousands commas allowed, e.g. 1,200); blank = not given.
 * Anything else (negative, decimals, units mixed in) is an error, never guessed — returns the reason as a string.
 */
function casesOf(v: unknown): number | null | string {
  const raw = s(v);
  const t = raw.replace(/,/g, '').replace(/\s+/g, '');
  if (!t) return null;
  if (t.startsWith('-')) return `จำนวนลังติดลบ (${raw})`;
  if (!/^\d+$/.test(t)) return `จำนวนลัง "${raw}" ต้องเป็นเลขจำนวนเต็ม`;
  const n = Number(t);
  return n <= 100000 ? n : `จำนวนลัง ${raw} มากเกินไป`;
}

export interface Bill { bill_no: string; cases: number | null }
/** the store's delivery status today (store timer) */
export interface Visit {
  id: string; status: 'open' | 'done' | 'failed'; started_at: string | null; ended_at: string | null;
  cases: number | null; skus: number | null; distance_m: number | null; method: string | null; note: string; by: string;
}
interface Stop { id: string; plate: string; code: string; name: string; type: string; address: string; bills: Bill[]; visit?: Visit | null }

/* ------------------------------------------------------------------ read ------------------------------------------------------------------ */

type PlanRow = {
  id: string; plate: string; sort_order: number; sap_code: string; name: string; store_type: string; address: string;
  bill_no: string | null; cases: number | null;
} & Partial<{
  sv_id: string | null; sv_status: Visit['status'] | null; sv_started_at: string | null; sv_ended_at: string | null; sv_cases: number | null;
  sv_skus: number | null; sv_distance_m: number | null; sv_method: string | null; sv_note: string; sv_by: string | null;
}>;
const timerOn = (env: Env) => env.FEATURE_STORE_TIMER === '1';

/** the stops of a day (optionally one vehicle), stores in file order, bills grouped under their store;
 *  with the store timer on, each stop also has its delivery status (1 extra row per store, by the unique plan_id index) */
async function readPlan(env: Env, date: string, vehicleId?: string) {
  const visits = timerOn(env);
  const { results } = await env.DB.prepare(
    // name / type / address as they were on that day (saved on the plan row); the store's current data only if none was saved
    `SELECT p.id, v.plate, p.sort_order, s.sap_code,
            coalesce(nullif(p.store_name, ''), s.name) AS name,
            CASE WHEN p.store_name <> '' THEN p.store_type ELSE s.store_type END AS store_type,
            CASE WHEN p.store_name <> '' THEN p.store_address ELSE s.address END AS address,
            b.bill_no, b.cases
            ${visits ? `, sv.id AS sv_id, sv.status AS sv_status, sv.started_at AS sv_started_at, sv.ended_at AS sv_ended_at,
              sv.cases AS sv_cases, sv.skus AS sv_skus, sv.distance_m AS sv_distance_m, sv.move_method AS sv_method, sv.note AS sv_note,
              nullif(u.display_name, '') AS sv_by` : ''}
       FROM delivery_plan p
       JOIN vehicles v ON v.id = p.vehicle_id
       JOIN stores s ON s.id = p.store_id
       LEFT JOIN delivery_bills b ON b.plan_id = p.id
       ${visits ? 'LEFT JOIN store_visits sv ON sv.plan_id = p.id LEFT JOIN users u ON u.id = sv.started_by' : ''}
      WHERE p.plan_date = ?1 ${vehicleId ? 'AND p.vehicle_id = ?2' : ''}
      ORDER BY v.plate, p.sort_order, b.rowid`,
  ).bind(...(vehicleId ? [date, vehicleId] : [date])).all<PlanRow>();
  const byId = new Map<string, Stop & { sort: number }>();
  for (const r of results) {
    let st = byId.get(r.id);
    if (!st) {
      st = { id: r.id, plate: r.plate, code: r.sap_code, name: r.name, type: r.store_type, address: r.address, bills: [], sort: r.sort_order };
      if (visits) {
        st.visit = r.sv_id && r.sv_status ? {
          id: r.sv_id, status: r.sv_status, started_at: r.sv_started_at ?? null, ended_at: r.sv_ended_at ?? null,
          cases: r.sv_cases ?? null, skus: r.sv_skus ?? null, distance_m: r.sv_distance_m ?? null, method: r.sv_method ?? null,
          note: r.sv_note ?? '', by: r.sv_by ?? '',
        } : null;
      }
      byId.set(r.id, st);
    }
    if (r.bill_no !== null) st.bills.push({ bill_no: r.bill_no, cases: r.cases });
  }
  return [...byId.values()].map(({ sort: _sort, ...st }) => ({
    ...st,
    cases: st.bills.some((b) => b.cases !== null) ? st.bills.reduce((n, b) => n + (b.cases ?? 0), 0) : null,
  }));
}

export async function listDeliveryPlan({ env, actor, url }: Ctx) {
  requireFeature(env);
  const date = reqDate(url.searchParams.get('date') ?? todayTH());
  if (actor.role === 'admin') {
    const p = url.searchParams.get('plate');
    const veh = p ? await findVehicleByPlate(env, p) : null;
    if (p && !veh) return json([]);
    return json(await readPlan(env, date, veh?.id));
  }
  // staff: today's list of a vehicle whose check today they are part of
  if (date !== todayTH()) throw bad('ดูได้เฉพาะรายการของวันนี้');
  const p = plateIn(url.searchParams.get('plate'));
  const veh = await findVehicleByPlate(env, p);
  if (!veh) throw bad(`ไม่พบรถทะเบียน ${p}`);
  const vi = await env.DB.prepare(
    `SELECT created_by, dman_id, helper1_id, helper2_id FROM vehicle_inspections WHERE inspect_date = ?1 AND vehicle_id = ?2`,
  ).bind(date, veh.id).first<CheckOwner>();
  if (!vi) throw bad(`ยังไม่ได้ตรวจรถทะเบียน ${veh.plate} วันนี้`);
  assertMyCheck(actor, vi, veh.plate);
  return json(await readPlan(env, date, veh.id));
}

/* ----------------------------------------------------------------- import ----------------------------------------------------------------- */

/** how far ahead a plan may be (catches a mistyped year) */
const MAX_DAYS_AHEAD = 60;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const isIso = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** why a delivery date cannot be changed ('' = it can): past days are locked, at most MAX_DAYS_AHEAD ahead */
function closedDate(date: string): string {
  const t = todayTH();
  if (date < t) return `วันที่ ${date} ผ่านมาแล้ว — แผนส่งย้อนหลังแก้ไขไม่ได้`;
  if (date > addDays(t, MAX_DAYS_AHEAD)) return `วันที่ ${date} ไกลเกิน ${MAX_DAYS_AHEAD} วันข้างหน้า — ตรวจวันที่ในไฟล์`;
  return '';
}
function assertOpenDate(date: string) {
  const why = closedDate(date);
  if (why) throw bad(why);
}

const STATUS_TEXT: Record<string, string> = { open: 'กำลังส่ง', done: 'ส่งสำเร็จแล้ว', failed: 'ส่งไม่สำเร็จ' };
/**
 * Stores of these days (or this one plan row) that already have a delivery status: they cannot leave the plan.
 * Returns "ร้าน X (รถ Y · ส่งสำเร็จแล้ว)" texts; empty = nothing locked.
 */
async function lockedStores(env: Env, by: { dates: string[] } | { planId: string }): Promise<string[]> {
  const where = 'dates' in by ? 'p.plan_date IN (SELECT value FROM json_each(?1))' : 'p.id = ?1';
  const arg = 'dates' in by ? JSON.stringify(by.dates) : by.planId;
  if ('dates' in by && !by.dates.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT coalesce(nullif(p.store_name, ''), s.name) AS store, v.plate, sv.status
       FROM delivery_plan p JOIN store_visits sv ON sv.plan_id = p.id
       JOIN stores s ON s.id = p.store_id JOIN vehicles v ON v.id = p.vehicle_id
      WHERE ${where} ORDER BY v.plate, p.sort_order`,
  ).bind(arg).all<{ store: string; plate: string; status: string }>();
  return results.map((r) => `${r.store} (รถ ${r.plate} · ${STATUS_TEXT[r.status] ?? r.status})`);
}
const lockedText = (names: string[]) =>
  `มีร้านที่บันทึกสถานะการส่งแล้ว ${names.length} ร้าน: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ' …' : ''} — ร้านเหล่านี้เอาออกจากแผนไม่ได้`;

interface InRow {
  line?: unknown; date?: unknown; plate?: unknown; code?: unknown; name?: unknown; type?: unknown; address?: unknown; cases?: unknown; bill?: unknown;
}
interface OutStop {
  date: string; lines: number[]; plate: string; vehicle_id: string; code: string; name: string; type: string; address: string; bills: Bill[];
  /** append only: this store is already on the same vehicle that day (only its new bills are added) */
  existing_id?: string;
}
const k2 = (date: string, code: string) => `${date}|${code}`;

/**
 * Turns the file rows into one stop per store per delivery date and checks the delivery rules:
 *   - each row has its own delivery date (blank → `fallback`, the date chosen on the admin page); past days are locked
 *   - a store is on ONE vehicle per day (in the file, and — append — against the plan already saved for that day)
 *   - several rows of the same store, day and vehicle = one stop with several bills
 *   - a bill number is one delivery only: never on two stores / days (in the file or already saved)
 */
async function checkImport(env: Env, fallback: string, mode: 'replace' | 'append', input: InRow[]) {
  const errors: string[] = [];
  const notes: string[] = [];
  const { results: vehicles } = await env.DB.prepare(`SELECT id, plate FROM vehicles WHERE active = 1`).all<{ id: string; plate: string }>();
  const vehOf = new Map(vehicles.map((v) => [plateKey(v.plate), v]));

  const stops = new Map<string, OutStop>();
  const billAt = new Map<string, string>(); // bill no → stop key (date|code)
  input.forEach((r, i) => {
    const line = Number(r.line) || i + 2;
    const name = s(r.name);
    const code = sapCode(r.code);
    const p = s(r.plate);
    const dateIn = s(r.date);
    if (!name && !code && !p) return; // blank row
    const date = dateIn || fallback;
    if (!isIso(date)) return errors.push(`แถว ${line}: วันที่ส่ง "${dateIn}" ไม่ถูกต้อง`);
    const closed = closedDate(date);
    if (closed) return errors.push(`แถว ${line}: ${closed}`);
    if (!code) return errors.push(`แถว ${line}: ไม่มีรหัสร้าน`);
    if (code.length > 30) return errors.push(`แถว ${line}: รหัสร้านยาวเกิน 30 ตัวอักษร`);
    if (!name) return errors.push(`แถว ${line}: ร้าน ${code} ไม่มีชื่อร้าน`);
    if (name.length > 200) return errors.push(`แถว ${line}: ชื่อร้านยาวเกิน 200 ตัวอักษร`);
    if (!p) return errors.push(`แถว ${line}: ${name} ไม่มีทะเบียนรถ`);
    const veh = vehOf.get(plateKey(p));
    if (!veh) return errors.push(`แถว ${line}: ทะเบียน ${p} ไม่มีในระบบ — เพิ่มรถที่แท็บตั้งค่าก่อน`);
    const bill_no = s(r.bill).slice(0, 40);
    const cases = casesOf(r.cases);
    if (typeof cases === 'string') return errors.push(`แถว ${line}: ${name} — ${cases}`);
    const key = k2(date, code);

    // a bill number belongs to one store on one day
    if (bill_no) {
      const at = billAt.get(bill_no);
      if (at && at !== key) {
        const [d2, c2] = at.split('|');
        return errors.push(`แถว ${line}: บิล ${bill_no} ซ้ำกับร้าน ${c2} วันที่ ${d2} ในไฟล์ — บิลหนึ่งใบส่งได้ครั้งเดียว`);
      }
    }

    const prev = stops.get(key);
    if (prev && prev.vehicle_id !== veh.id) {
      return errors.push(`แถว ${line}: ${name} (${code}) วันที่ ${date} อยู่ทั้งรถ ${prev.plate} และรถ ${veh.plate} — ร้านเดียวกันส่งได้คันเดียว`);
    }
    if (bill_no) billAt.set(bill_no, key);
    if (prev) {
      // same store, day and vehicle again (one row per bill in SAP): one stop, another bill
      prev.lines.push(line);
      if (!bill_no && cases === null) return; // nothing to add
      if (bill_no && prev.bills.some((b) => b.bill_no === bill_no)) notes.push(`แถว ${line}: บิล ${bill_no} ซ้ำในไฟล์ — ใช้ครั้งเดียว`);
      else prev.bills.push({ bill_no, cases });
      return;
    }
    stops.set(key, {
      date, lines: [line], plate: veh.plate, vehicle_id: veh.id, code, name, type: s(r.type).slice(0, 30), address: s(r.address).slice(0, 500),
      // a row without bill number or cases adds the store only (no empty bill)
      bills: bill_no || cases !== null ? [{ bill_no, cases }] : [],
    });
  });

  const list = [...stops.values()];
  const dates = [...new Set(list.map((x) => x.date))].sort();

  // the plan already saved for those days (append: clashes / stores already there; sort order continues)
  const cur = dates.length
    ? (await env.DB.prepare(
      `SELECT p.id, p.plan_date, s.sap_code, v.plate, p.sort_order
         FROM delivery_plan p JOIN stores s ON s.id = p.store_id JOIN vehicles v ON v.id = p.vehicle_id
        WHERE p.plan_date IN (SELECT value FROM json_each(?1))`,
    ).bind(JSON.stringify(dates)).all<{ id: string; plan_date: string; sap_code: string; plate: string; sort_order: number }>()).results
    : [];
  // replace wipes those days: stores that already have a delivery status are locked
  if (mode === 'replace') {
    const locked = await lockedStores(env, { dates });
    if (locked.length) errors.push(`แทนที่ไม่ได้: ${lockedText(locked)} — ใช้ "เพิ่ม" แทน`);
  }
  const maxSort = new Map<string, number>();
  for (const c of cur) maxSort.set(c.plan_date, Math.max(maxSort.get(c.plan_date) ?? 0, c.sort_order));
  if (mode === 'append') {
    const curOf = new Map(cur.map((c) => [k2(c.plan_date, c.sap_code), c]));
    for (const st of list) {
      const was = curOf.get(k2(st.date, st.code));
      if (!was) continue;
      if (plateKey(was.plate) !== plateKey(st.plate)) {
        errors.push(`แถว ${st.lines[0]}: ${st.name} (${st.code}) วันที่ ${st.date} อยู่ในรถ ${was.plate} แล้ว — ร้านเดียวกันส่งได้คันเดียว`);
      } else st.existing_id = was.id;
    }
  }

  // bills already saved: the same number on another store / day is an error; on this very stop (append) it is skipped.
  // replace: the days in the file are wiped first, so their saved bills do not count.
  const billNos = [...billAt.keys()];
  if (billNos.length) {
    const { results: saved } = await env.DB.prepare(
      `SELECT b.bill_no, b.plan_id, p.plan_date, s.sap_code
         FROM delivery_bills b JOIN delivery_plan p ON p.id = b.plan_id JOIN stores s ON s.id = p.store_id
        WHERE b.bill_no IN (SELECT value FROM json_each(?1))`,
    ).bind(JSON.stringify(billNos)).all<{ bill_no: string; plan_id: string; plan_date: string; sap_code: string }>();
    const wiped = new Set(mode === 'replace' ? dates : []);
    for (const sb of saved) {
      if (wiped.has(sb.plan_date)) continue;
      const st = stops.get(billAt.get(sb.bill_no) ?? '');
      if (!st) continue;
      if (st.existing_id === sb.plan_id) continue; // append onto the same stop: skipped below
      errors.push(`แถว ${st.lines[0]}: บิล ${sb.bill_no} มีอยู่แล้ว (ร้าน ${sb.sap_code} วันที่ ${sb.plan_date}) — บิลหนึ่งใบส่งได้ครั้งเดียว`);
    }
    // append onto a stop already there: only bills it does not have yet are added (a bill without a number cannot be
    // told apart from the ones already there, so it is skipped rather than counting its cases twice)
    const savedOn = new Map<string, Set<string>>();
    for (const sb of saved) savedOn.set(sb.plan_id, new Set([...(savedOn.get(sb.plan_id) ?? []), sb.bill_no]));
    for (const st of list) {
      if (!st.existing_id) continue;
      const have = savedOn.get(st.existing_id) ?? new Set<string>();
      const before = st.bills.length;
      st.bills = st.bills.filter((b) => b.bill_no && !have.has(b.bill_no));
      if (st.bills.length < before) notes.push(`${st.name} (${st.date}): อยู่ในรถ ${st.plate} แล้ว — ข้าม ${before - st.bills.length} บิลที่มีอยู่แล้ว / ไม่มีเลขบิล`);
    }
  } else {
    for (const st of list) {
      if (!st.existing_id) continue;
      const before = st.bills.length;
      st.bills = st.bills.filter((b) => b.bill_no);
      if (st.bills.length < before) notes.push(`${st.name} (${st.date}): อยู่ในรถ ${st.plate} แล้ว — ข้าม ${before - st.bills.length} บิลที่ไม่มีเลขบิล`);
    }
  }
  return { stops: list, dates, errors, notes, maxSort };
}

export async function importDeliveryPlan({ env, actor, req }: Ctx) {
  requireFeature(env);
  requireRole(actor, 'admin');
  const b = await readJson(req);
  const fallback = reqDate(b.date); // rows without a delivery date use the date chosen on the page
  const mode = b.mode === 'append' ? 'append' : 'replace';
  if (!Array.isArray(b.rows)) throw bad('ไม่พบข้อมูลในไฟล์');
  if (!b.rows.length) throw bad('ไฟล์ไม่มีแถวข้อมูล');
  if (b.rows.length > MAX_ROWS) throw bad(`ไฟล์หนึ่งนำเข้าได้ไม่เกิน ${MAX_ROWS} แถว — แบ่งไฟล์ก่อน`);

  const { stops, dates, errors, notes, maxSort } = await checkImport(env, fallback, mode, b.rows as InRow[]);
  // stores not in the system yet (created on import)
  const codes = [...new Set(stops.map((x) => x.code))];
  const knownSet = new Set(codes.length
    ? (await env.DB.prepare(`SELECT sap_code FROM stores WHERE sap_code IN (SELECT value FROM json_each(?1))`)
      .bind(JSON.stringify(codes)).all<{ sap_code: string }>()).results.map((r) => r.sap_code)
    : []);
  const sumOf = (list: OutStop[]) => {
    const bl = list.flatMap((x) => x.bills);
    return { stores: list.length, vehicles: new Set(list.map((x) => x.vehicle_id)).size, bills: bl.length, cases: bl.reduce((n, x) => n + (x.cases ?? 0), 0) };
  };
  const summary = {
    ...sumOf(stops),
    new_stores: codes.filter((c) => !knownSet.has(c)).length,
    already: stops.filter((x) => x.existing_id).length,
    dates: dates.map((d) => ({ date: d, ...sumOf(stops.filter((x) => x.date === d)) })),
  };
  const preview = stops.map(({ vehicle_id: _v, existing_id, ...x }) => ({ ...x, existing: !!existing_id, new_store: !knownSet.has(x.code) }));
  if (b.commit !== true) return json({ stops: preview, errors, notes, summary });
  if (errors.length) throw bad(`ไฟล์มีปัญหา ${errors.length} รายการ — แก้ไฟล์แล้วนำเข้าใหม่`);
  if (!stops.length) throw bad('ไฟล์ไม่มีร้านค้าที่นำเข้าได้');

  // ids for the new plan rows (existing ones on append keep theirs); file order per day, after what the day already has
  const next = new Map<string, number>();
  const plan = stops.map((x) => {
    const n = (next.get(x.date) ?? (mode === 'append' ? maxSort.get(x.date) ?? 0 : 0)) + 1;
    next.set(x.date, n);
    return { ...x, id: x.existing_id ?? crypto.randomUUID(), sort: n };
  });
  const newPlan = plan.filter((x) => !x.existing_id);
  const bills = plan.flatMap((x) => x.bills.map((bl) => ({ plan_id: x.id, bill_no: bl.bill_no, cases: bl.cases })));
  const storeRows = [...new Map(stops.map((x) => [x.code, { code: x.code, name: x.name, type: x.type, address: x.address }])).values()];
  const stmts = [];
  if (mode === 'replace') {
    // replace = every delivery date that is in the file starts again from this file
    stmts.push(env.DB.prepare(
      `DELETE FROM delivery_bills WHERE plan_id IN (SELECT id FROM delivery_plan WHERE plan_date IN (SELECT value FROM json_each(?1)))`,
    ).bind(JSON.stringify(dates)));
    stmts.push(env.DB.prepare(`DELETE FROM delivery_plan WHERE plan_date IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(dates)));
  }
  // stores: new ones created; known ones get the file's name / type / address (blank fields keep what is there)
  stmts.push(env.DB.prepare(
    `INSERT INTO stores (sap_code, name, store_type, address)
       SELECT json_extract(value, '$.code'), json_extract(value, '$.name'), json_extract(value, '$.type'), json_extract(value, '$.address')
         FROM json_each(?1) WHERE true
     ON CONFLICT (sap_code) DO UPDATE SET
       name = excluded.name,
       store_type = CASE WHEN excluded.store_type <> '' THEN excluded.store_type ELSE stores.store_type END,
       address = CASE WHEN excluded.address <> '' THEN excluded.address ELSE stores.address END,
       active = 1, updated_at = ${NOW_SQL}`,
  ).bind(JSON.stringify(storeRows)));
  if (newPlan.length) {
    stmts.push(env.DB.prepare(
      // the store's name / type / address as of this import are saved on the plan row (history keeps that day's data);
      // `stores` was just updated from the file, blank file fields keeping what it had
      `INSERT INTO delivery_plan (id, plan_date, vehicle_id, store_id, sort_order, created_by, store_name, store_type, store_address)
         SELECT json_extract(j.value, '$.id'), json_extract(j.value, '$.date'), json_extract(j.value, '$.vehicle_id'), st.id,
                json_extract(j.value, '$.sort'), ?2, st.name, st.store_type, st.address
           FROM json_each(?1) j JOIN stores st ON st.sap_code = json_extract(j.value, '$.code')`,
    ).bind(JSON.stringify(newPlan.map((x) => ({ id: x.id, date: x.date, vehicle_id: x.vehicle_id, code: x.code, sort: x.sort }))), actor.id));
  }
  if (bills.length) {
    // plain INSERT: a bill number saved meanwhile by someone else makes the whole import fail (unique index), not vanish
    stmts.push(env.DB.prepare(
      `INSERT INTO delivery_bills (plan_id, bill_no, cases)
         SELECT json_extract(value, '$.plan_id'), json_extract(value, '$.bill_no'), json_extract(value, '$.cases') FROM json_each(?1)`,
    ).bind(JSON.stringify(bills)));
  }
  stmts.push(audit(env, actor, 'import', 'delivery_plan', dates.join(','), { mode, ...summary, dates: dates }));
  await env.DB.batch(stmts);
  return json({ ok: true, summary });
}

/* ------------------------------------------------------------- add / remove ------------------------------------------------------------- */

export async function addDeliveryStop({ env, actor, req }: Ctx) {
  requireFeature(env);
  requireRole(actor, 'admin');
  const b = await readJson(req);
  const date = reqDate(b.date);
  assertOpenDate(date);
  const { stops, errors } = await checkImport(env, date, 'append', [{ line: 1, ...b, date }]);
  if (errors.length) throw bad(errors[0].replace(/^แถว 1: /, ''));
  const st = stops[0];
  if (!st) throw bad('กรอกทะเบียนรถ รหัสร้าน และชื่อร้านก่อน');
  if (st.existing_id && !st.bills.length) throw conflict(`${st.name} (${st.code}) อยู่ในรถ ${st.plate} ของวันที่ ${date} แล้ว`);

  const id = st.existing_id ?? crypto.randomUUID();
  const stmts = [
    // a store typed by hand: created if new; an existing store keeps its data
    env.DB.prepare(`INSERT INTO stores (sap_code, name, store_type, address) VALUES (?1, ?2, ?3, '') ON CONFLICT (sap_code) DO NOTHING`)
      .bind(st.code, st.name, st.type),
  ];
  if (!st.existing_id) {
    stmts.push(env.DB.prepare(
      // the store's data as of today is saved on the plan row
      `INSERT INTO delivery_plan (id, plan_date, vehicle_id, store_id, sort_order, created_by, store_name, store_type, store_address)
         SELECT ?1, ?2, ?3, s.id, (SELECT coalesce(max(sort_order), 0) + 1 FROM delivery_plan WHERE plan_date = ?2), ?5,
                s.name, s.store_type, s.address
           FROM stores s WHERE s.sap_code = ?4`,
    ).bind(id, date, st.vehicle_id, st.code, actor.id));
  }
  for (const bl of st.bills) {
    stmts.push(env.DB.prepare(`INSERT INTO delivery_bills (plan_id, bill_no, cases) VALUES (?1, ?2, ?3)`).bind(id, bl.bill_no, bl.cases));
  }
  stmts.push(audit(env, actor, 'create', 'delivery_plan', id, { date, plate: st.plate, store: st.code, bills: st.bills }));
  await env.DB.batch(stmts);
  return json({ id });
}

export async function removeDeliveryStop({ env, actor, params }: Ctx) {
  requireFeature(env);
  requireRole(actor, 'admin');
  const id = decodeURIComponent(params[0]);
  const cur = await env.DB.prepare(
    `SELECT p.plan_date, s.sap_code FROM delivery_plan p JOIN stores s ON s.id = p.store_id WHERE p.id = ?1`,
  ).bind(id).first<{ plan_date: string; sap_code: string }>();
  if (!cur) throw notFound('ไม่พบร้านนี้ในแผน (อาจถูกลบไปแล้ว)');
  assertOpenDate(cur.plan_date);
  const locked = await lockedStores(env, { planId: id });
  if (locked.length) throw conflict(`ลบไม่ได้: ${lockedText(locked)}`);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM delivery_bills WHERE plan_id = ?1`).bind(id),
    env.DB.prepare(`DELETE FROM delivery_plan WHERE id = ?1`).bind(id),
    audit(env, actor, 'delete', 'delivery_plan', id, { date: cur.plan_date, store: cur.sap_code }),
  ]);
  return json({ ok: true });
}

export async function clearDeliveryPlan({ env, actor, url }: Ctx) {
  requireFeature(env);
  requireRole(actor, 'admin');
  const date = reqDate(url.searchParams.get('date'));
  assertOpenDate(date);
  const locked = await lockedStores(env, { dates: [date] });
  if (locked.length) throw conflict(`ล้างทั้งวันไม่ได้: ${lockedText(locked)}`);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM delivery_bills WHERE plan_id IN (SELECT id FROM delivery_plan WHERE plan_date = ?1)`).bind(date),
    env.DB.prepare(`DELETE FROM delivery_plan WHERE plan_date = ?1`).bind(date),
    audit(env, actor, 'delete', 'delivery_plan', date, { clear_day: true }),
  ]);
  return json({ ok: true });
}
