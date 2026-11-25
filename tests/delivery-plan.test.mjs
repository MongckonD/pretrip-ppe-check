/**
 * Delivery plan (ร้านค้าที่ต้องส่ง) + store timer (store_visits) + vehicle check rules + photo names + vehicle delete rules — end-to-end tests against the LOCAL Worker and LOCAL D1.
 * Never touches the live database.
 *
 *   npm run test:delivery
 *
 * What it does, in one go:
 *   1. checks port 8787 is free, applies local migrations, starts `wrangler dev --port 8787` (feature switch on via .dev.vars)
 *   2. creates its own test data: 2 sessions (admin super1, staff staff1), a vehicle check of another team, test vehicles
 *   3. runs the checks below and prints PASS / FAIL
 *   4. removes everything it created (store codes / bills start with ZT-, sessions marked "zt-test") and stops the Worker
 *
 * Needs the local seed accounts: super1 (admin) and staff1 (user, employee EMP01, consent + licence on file),
 * staff2, employee EMP03, and active vehicles "70 1234" and "80-5678". The store-timer checks use their own vehicle ZT-T1
 * (needs FEATURE_STORE_TIMER=1 in .dev.vars).
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8787;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = 'pretrip-ppe';
const UA = 'zt-test'; // marks the test sessions
const win = process.platform === 'win32';

/* ------------------------------------------------------------ helpers ------------------------------------------------------------ */

const day = (n) => new Date(Date.now() + 7 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10); // Thai date
const TODAY = day(0), TOMORROW = day(1), PAST = day(-3), FAR = day(90);

function wrangler(args) {
  return execFileSync(win ? 'npx.cmd' : 'npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: win });
}
/**
 * Run SQL on the LOCAL database and return the rows of the last statement. The SQL goes through a temp file
 * (--file): on Windows the shell would split a --command argument on its spaces.
 */
function sql(command) {
  const file = join(tmpdir(), `zt-${process.pid}-${randomBytes(4).toString('hex')}.sql`);
  writeFileSync(file, command);
  try {
    const out = wrangler(['d1', 'execute', DB, '--local', '--json', '--file', file]);
    const res = JSON.parse(out.slice(out.indexOf('[')));
    return res[res.length - 1]?.results ?? [];
  } catch (e) {
    // keep wrangler's own message (the SQL error) in the error, not only "Command failed"
    const detail = `${e.stdout ?? ''} ${e.stderr ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 600);
    throw new Error(`${String(e.message).split('\n')[0]} — ${detail}`);
  } finally {
    rmSync(file, { force: true });
  }
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

function portInUse(port) {
  return new Promise((resolve) => {
    const c = createConnection({ port, host: '127.0.0.1' }, () => { c.destroy(); resolve(true); });
    c.on('error', () => resolve(false));
  });
}

let worker = null;
function startWorker() {
  return new Promise((resolve, reject) => {
    worker = spawn(win ? 'npx.cmd' : 'npx', ['wrangler', 'dev', '--port', String(PORT), '--local-upstream', `127.0.0.1:${PORT}`, '--upstream-protocol', 'http'], { shell: win, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => reject(new Error('wrangler dev did not start within 90 s')), 90_000);
    const onData = (d) => { if (String(d).includes('Ready on')) { clearTimeout(timer); resolve(); } };
    worker.stdout.on('data', onData);
    worker.stderr.on('data', onData);
    worker.on('exit', (code) => { clearTimeout(timer); reject(new Error(`wrangler dev exited (${code})`)); });
  });
}
function stopWorker() {
  if (!worker || worker.exitCode !== null) return;
  worker.removeAllListeners('exit');
  if (win) { try { execFileSync('taskkill', ['/pid', String(worker.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ } }
  else worker.kill('SIGTERM');
}

function newSession(userId) {
  const token = randomBytes(24).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  sql(`INSERT INTO sessions (token_hash, user_id, expires_at, user_agent)
       VALUES (${q(hash)}, ${q(userId)}, strftime('%Y-%m-%dT%H:%M:%fZ','now','+2 hours'), ${q(UA)})`);
  return token;
}
function api(token) {
  return async (method, path, body) => {
    const r = await fetch(BASE + path, {
      method,
      headers: { cookie: `__Host-pt_session=${token}`, 'content-type': 'application/json', origin: BASE, 'x-requested-with': 'pretrip' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { st: r.status, j: await r.json().catch(() => null) };
  };
}

let passed = 0, failed = 0;
function check(label, ok, detail) {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${JSON.stringify(detail).slice(0, 400)}`}`);
}
const section = (t) => console.log(`\n— ${t}`);

/* ------------------------------------------------------------ test data ------------------------------------------------------------ */

const created = { checks: [] };

function prerequisites() {
  const need = sql(`SELECT
      (SELECT count(*) FROM users WHERE id = 'super1' AND role = 'admin' AND active = 1) AS admin,
      (SELECT count(*) FROM users WHERE id = 'staff1' AND role = 'user' AND active = 1 AND employee_id = 'EMP01') AS staff,
      (SELECT count(*) FROM users WHERE id = 'staff2') AS staff2,
      (SELECT count(*) FROM employees WHERE id = 'EMP03') AS emp3,
      (SELECT count(*) FROM vehicles WHERE plate IN ('70 1234', '80-5678') AND active = 1) AS veh`)[0];
  const missing = [];
  if (!need.admin) missing.push('admin super1');
  if (!need.staff) missing.push('staff1 (EMP01)');
  if (!need.staff2) missing.push('staff2');
  if (!need.emp3) missing.push('employee EMP03');
  if (need.veh !== 2) missing.push('vehicles 70 1234 / 80-5678');
  if (missing.length) throw new Error(`local database is missing: ${missing.join(', ')}`);
}

function cleanup() {
  const ids = created.checks.map(q).join(',');
  // store timer rows first (they lock their plan rows and work records), then the test vehicles' work records
  sql(`DELETE FROM store_visits WHERE plan_id IN (SELECT p.id FROM delivery_plan p JOIN stores s ON s.id = p.store_id WHERE s.sap_code LIKE 'ZT-%')
         OR trip_activity_id IN (SELECT t.id FROM trip_activities t JOIN vehicles v ON v.id = t.vehicle_id WHERE v.plate LIKE 'ZT-%');
       DELETE FROM trip_activities WHERE vehicle_id IN (SELECT id FROM vehicles WHERE plate LIKE 'ZT-%');
       DELETE FROM delivery_bills WHERE bill_no LIKE 'ZT-%' OR plan_id IN (SELECT p.id FROM delivery_plan p JOIN stores s ON s.id = p.store_id WHERE s.sap_code LIKE 'ZT-%');
       DELETE FROM delivery_plan WHERE store_id IN (SELECT id FROM stores WHERE sap_code LIKE 'ZT-%');
       DELETE FROM stores WHERE sap_code LIKE 'ZT-%';
       ${ids ? `DELETE FROM vehicle_inspections WHERE id IN (${ids});` : ''}
       -- the fixed test ids, from any day (a run left on another day would block today's insert)
       DELETE FROM vehicle_inspections WHERE id IN ('zt-other-team', 'zt-timer-check');
       DELETE FROM vehicle_inspections WHERE vehicle_id IN (SELECT id FROM vehicles WHERE plate LIKE 'ZT-%');
       DELETE FROM vehicles WHERE plate LIKE 'ZT-%';
       DELETE FROM sessions WHERE user_agent = ${q(UA)};`);
}

/* -------------------------------------------------------------- tests -------------------------------------------------------------- */

const row = (line, date, plate, code, name, cases, bill, extra = {}) => ({ line, date, plate, code, name, type: '', address: '', cases, bill, ...extra });

async function deliveryTests(admin, staff) {
  const imp = (mode, rows, commit, date = TODAY) => admin('POST', '/api/delivery-plan/import', { date, mode, rows, commit });

  section('file rules (nothing saved)');
  let r = await imp('replace', [
    row(2, PAST, '70 1234', 'ZT-C1', 'อดีต', '5', 'ZT-X1'),
    row(3, FAR, '70 1234', 'ZT-C1', 'ไกล', '5', 'ZT-X2'),
    row(4, 'abc', '70 1234', 'ZT-C1', 'ผิด', '5', 'ZT-X3'),
    row(5, TODAY, '70 1234', 'ZT-C2', 'สอง', '5', 'ZT-B200'),
    row(6, TOMORROW, '80-5678', 'ZT-C3', 'สาม', '5', 'ZT-B200'),
    row(7, TODAY, '70 1234', 'ZT-C4', 'ลบ', '-5', 'ZT-X4'),
    row(8, TODAY, '70 1234', 'ZT-C5', 'ทศนิยม', '12.5', 'ZT-X5'),
    row(9, TODAY, '70 1234', 'ZT-C6', 'หน่วย', '10 CS', 'ZT-X6'),
    row(10, TODAY, 'ZT-NOPE', 'ZT-C7', 'ไม่มีรถ', '1', 'ZT-X7'),
    row(11, TODAY, '70 1234', '', 'ไม่มีรหัส', '1', 'ZT-X8'),
    row(12, TODAY, '70 1234', 'ZT-C10', 'คันหนึ่ง', '1', 'ZT-X9'),
    row(13, TODAY, '80-5678', 'ZT-C10', 'คันสอง', '1', 'ZT-X10'),
  ], false);
  const errs = r.j?.errors ?? [];
  const has = (t) => errs.some((e) => e.includes(t));
  check('past delivery date refused', has('ผ่านมาแล้ว'), errs);
  check('date more than 60 days ahead refused', has('ไกลเกิน'), errs);
  check('unreadable date refused', has('"abc"'), errs);
  check('one bill on two stores refused', has('บิล ZT-B200'), errs);
  check('negative cases refused', has('ติดลบ'), errs);
  check('decimal cases refused', has('"12.5"'), errs);
  check('cases with units refused', has('"10 CS"'), errs);
  check('unknown plate refused', has('ZT-NOPE'), errs);
  check('row without store code refused', has('ไม่มีรหัสร้าน'), errs);
  check('same store on two vehicles the same day refused', has('ZT-C10') && has('ร้านเดียวกันส่งได้คันเดียว'), errs);
  r = await imp('replace', [row(2, TODAY, '70 1234', 'ZT-C2', 'สอง', '5', 'ZT-B300'), row(3, TODAY, '80-5678', 'ZT-C2', 'สอง', '5', 'ZT-B301')], true);
  check('a file with errors cannot be saved', r.st === 400, r);

  section('import');
  r = await imp('replace', [
    row(2, TODAY, '70 1234', 'ZT-C10021', 'ร้านเจ๊หมวย', '1,200', 'ZT-0001', { address: '45/2 ถ.เพชรเกษม' }),
    row(3, TODAY, '70 1234', 'ZT-C10021', 'ร้านเจ๊หมวย', '40', 'ZT-0002'),
    row(4, '', '70 1234', 'ZT-C10045', 'ครัว', '15', 'ZT-0004'),
    row(5, TOMORROW, '80-5678', 'ZT-C20011', 'โรงแรม', '60', 'ZT-0003'),
  ], true);
  check('file with 2 days imported', r.st === 200 && r.j?.summary?.dates?.length === 2 && r.j.summary.bills === 4, r);
  r = await admin('GET', `/api/delivery-plan?date=${TODAY}`);
  const jm = r.j?.find((x) => x.code === 'ZT-C10021');
  check('2 bills of one store = 1 stop, cases 1,240', jm?.bills.length === 2 && jm.cases === 1240, r.j);
  check('row without date goes to the chosen date', r.j?.some((x) => x.code === 'ZT-C10045'), r.j);

  section('repeat / reuse');
  r = await imp('append', [row(2, TODAY, '70 1234', 'ZT-C10021', 'ร้านเจ๊หมวย', '1,200', 'ZT-0001')], true);
  check('appending the same bill again adds nothing', r.st === 200 && r.j?.summary?.bills === 0, r);
  r = await admin('POST', '/api/delivery-plan', { date: TOMORROW, plate: '80-5678', code: 'ZT-C9', name: 'เก้า', type: '', cases: '1', bill: 'ZT-0001' });
  check('a saved bill number cannot be used again', r.st === 400 && /มีอยู่แล้ว/.test(r.j?.error), r);

  section('history');
  await imp('append', [row(2, TOMORROW, '80-5678', 'ZT-C10021', 'เจ๊หมวย ซุปเปอร์', '5', 'ZT-0005', { address: '99 ถ.ใหม่' })], true, TOMORROW);
  r = await admin('GET', `/api/delivery-plan?date=${TODAY}`);
  const old = r.j?.find((x) => x.code === 'ZT-C10021');
  check("a day keeps its store name + address after the store changes", old?.name === 'ร้านเจ๊หมวย' && old?.address === '45/2 ถ.เพชรเกษม', old);
  await imp('replace', [row(2, TOMORROW, '80-5678', 'ZT-C20011', 'โรงแรม', '60', 'ZT-0003')], true, TOMORROW);
  r = await admin('GET', `/api/delivery-plan?date=${TODAY}`);
  check('replacing tomorrow leaves today alone', r.j?.filter((x) => x.code.startsWith('ZT-')).length === 2, r.j);
  r = await admin('DELETE', `/api/delivery-plan?date=${PAST}`);
  check('a past day cannot be cleared', r.st === 400, r);

  section('staff');
  r = await staff('GET', `/api/delivery-plan?date=${TODAY}&plate=${encodeURIComponent('70 1234')}`);
  check("staff see their own vehicle's stores today", r.st === 200 && r.j?.filter((x) => x.code.startsWith('ZT-')).length === 2, r);
  r = await staff('GET', `/api/delivery-plan?date=${TODAY}&plate=${encodeURIComponent('80-5678')}`);
  check("another team's vehicle = 403", r.st === 403, r);
  r = await staff('GET', `/api/delivery-plan?date=${TOMORROW}&plate=${encodeURIComponent('70 1234')}`);
  check('staff cannot see another day', r.st === 400, r);
  r = await staff('POST', '/api/delivery-plan/import', { date: TODAY, mode: 'replace', rows: [], commit: false });
  check('staff cannot import', r.st === 403, r);
  r = await staff('DELETE', `/api/delivery-plan?date=${TODAY}`);
  check('staff cannot clear a day', r.st === 403, r);

  // leave the shared plates free for the vehicle tests / next run
  await admin('DELETE', `/api/delivery-plan?date=${TOMORROW}`);
}

async function vehicleTests(admin) {
  section('vehicles with delivery plans');
  let r = await admin('PUT', '/api/vehicles', { plate: 'ZT-V1', type: 'ทดสอบ', active: true });
  const vid = r.j?.id;
  check('test vehicle created', r.st === 201 && !!vid, r);
  r = await admin('POST', '/api/delivery-plan', { date: TOMORROW, plate: 'ZT-V1', code: 'ZT-VC1', name: 'ร้านทดสอบรถ', type: '', cases: '3', bill: 'ZT-VB1' });
  check('plan for tomorrow', r.st === 200, r);
  r = await admin('DELETE', `/api/vehicles/${vid}`);
  check('vehicle with stores still to deliver cannot be deleted', r.st === 409 && /มีแผนส่ง 1 ร้าน/.test(r.j?.error), r);
  r = await admin('PUT', '/api/vehicles', { id: vid, plate: 'ZT-V1', type: 'ทดสอบ', active: false });
  check('… nor switched off', r.st === 409 && /มีแผนส่ง/.test(r.j?.error), r);
  r = await admin('PUT', '/api/vehicles', { id: vid, plate: 'ZT-V1', type: 'ทดสอบ 2', active: true });
  check('… but can still be edited', r.st === 200, r);
  await admin('DELETE', `/api/delivery-plan?date=${TOMORROW}`);
  r = await admin('DELETE', `/api/vehicles/${vid}`);
  check('without plans it is really deleted', r.st === 200 && r.j?.deleted !== false, r);

  // a vehicle whose only history is a past plan (written straight to the database: the API refuses past days)
  sql(`INSERT INTO vehicles (id, plate, type, active) VALUES ('zt-veh-past', 'ZT-V2', '', 1);
       INSERT INTO stores (id, sap_code, name) VALUES ('zt-store-past', 'ZT-VC2', 'ร้านอดีต');
       INSERT INTO delivery_plan (id, plan_date, vehicle_id, store_id) VALUES ('zt-plan-past', ${q(PAST)}, 'zt-veh-past', 'zt-store-past');`);
  r = await admin('DELETE', '/api/vehicles/zt-veh-past');
  check('only past plans = switched off, history kept', r.st === 200 && r.j?.deactivated === true, r);
}

async function timerTests(admin, staff, other) {
  section('store timer (store_visits)');
  // own test vehicle + today's check saved by staff1 (so the team rule lets staff1 in, staff2 not)
  const emp = sql(`SELECT id FROM employees WHERE active = 1 AND id NOT IN
                     (SELECT dman_id FROM vehicle_inspections WHERE inspect_date = ${q(TODAY)}) ORDER BY id LIMIT 1`)[0]?.id;
  if (!emp) throw new Error('no free employee for the timer test vehicle check');
  sql(`INSERT INTO vehicles (id, plate, type, active) VALUES ('zt-veh-timer', 'ZT-T1', 'ทดสอบ', 1);
       INSERT INTO vehicle_inspections (id, inspect_date, inspect_time, vehicle_id, mileage, dman_id, helper1_id, created_by, updated_by)
       VALUES ('zt-timer-check', ${q(TODAY)}, '08:00', 'zt-veh-timer', 1000, ${q(emp)}, 'EMP01', 'super1', 'super1');`);
  created.checks.push('zt-timer-check');
  for (const [code, name, bill] of [['ZT-TC1', 'ร้านเอ', 'ZT-TB1'], ['ZT-TC2', 'ร้านบี', 'ZT-TB2'], ['ZT-TC3', 'ร้านซี', 'ZT-TB3']]) {
    const r = await admin('POST', '/api/delivery-plan', { date: TODAY, plate: 'ZT-T1', code, name, type: '', cases: '10', bill });
    if (r.st !== 200) throw new Error(`could not add the timer test store: ${JSON.stringify(r.j)}`);
  }
  const plan = async (who = staff) => (await who('GET', `/api/delivery-plan?date=${TODAY}&plate=ZT-T1`)).j ?? [];
  let stops = await plan();
  const [A, B, C] = ['ZT-TC1', 'ZT-TC2', 'ZT-TC3'].map((c) => stops.find((s) => s.code === c)?.id);
  check('plan has the 3 test stores, no status yet', A && B && C && stops.every((s) => s.visit === null), stops);

  let r = await staff('POST', '/api/store-visits/start', { plan_id: A });
  check('timing refused before "เริ่มการทำงาน"', r.st === 400 && /เริ่มการทำงาน/.test(r.j?.error), r);
  r = await staff('POST', '/api/trip-activities/start', { plate: 'ZT-T1' });
  check('work started', r.st === 200 && !!r.j?.id, r);
  const tripId = r.j?.id;

  r = await other('POST', '/api/store-visits/start', { plan_id: A });
  check("another team cannot time this vehicle's store (403)", r.st === 403, r);
  r = await admin('POST', '/api/store-visits/start', { plan_id: A });
  check('admin accounts cannot time stores (403)', r.st === 403, r);
  r = await staff('POST', '/api/store-visits/fail', { plan_id: B, note: '   ' });
  check('ส่งไม่สำเร็จ needs a note', r.st === 400 && /หมายเหตุ/.test(r.j?.error), r);

  const t0 = Date.now();
  r = await staff('POST', '/api/store-visits/start', { plan_id: A });
  const visitA = r.j?.id;
  check('start store A: time stamped by the server', r.st === 200 && Math.abs(Date.parse(r.j?.started_at) - t0) < 60_000, r);
  r = await staff('POST', '/api/store-visits/start', { plan_id: A });
  check('the same store cannot be started twice', r.st === 409, r);
  r = await staff('POST', '/api/store-visits/start', { plan_id: B });
  check('a second store cannot start while one is open', r.st === 409 && /ร้านเอ/.test(r.j?.error), r);
  r = await staff('POST', `/api/trip-activities/${tripId}/end`, {});
  check('"จบงาน" refused while a store is open (names the store)', r.st === 409 && /ร้านเอ/.test(r.j?.error), r);
  const dbEnd = (() => { try { sql(`UPDATE trip_activities SET work_ended_at = ${q(new Date().toISOString())} WHERE id = ${q(tripId)}`); return 'updated'; } catch (e) { return `${e.message} ${e.stdout ?? ""} ${e.stderr ?? ""}`; } })();
  check('… the database refuses it too (trigger STORE_OPEN)', dbEnd.includes('STORE_OPEN'), dbEnd);

  section('plan locks (stores with a status)');
  r = await admin('POST', '/api/delivery-plan/import', { date: TODAY, mode: 'replace', rows: [row(2, TODAY, 'ZT-T1', 'ZT-TC9', 'แทน', '1', 'ZT-TB9')], commit: false });
  check('แทนที่ the day refused, names the store', (r.j?.errors ?? []).some((e) => e.includes('แทนที่ไม่ได้') && e.includes('ร้านเอ')), r.j?.errors);
  r = await admin('POST', '/api/delivery-plan/import', { date: TODAY, mode: 'replace', rows: [row(2, TODAY, 'ZT-T1', 'ZT-TC9', 'แทน', '1', 'ZT-TB9')], commit: true });
  check('… and cannot be committed', r.st === 400, r);
  r = await admin('DELETE', `/api/delivery-plan/${A}`);
  check('a store with a status cannot be removed', r.st === 409 && /ร้านเอ/.test(r.j?.error), r);
  r = await admin('DELETE', `/api/delivery-plan?date=${TODAY}`);
  check('the day cannot be cleared', r.st === 409, r);
  const dbDel = (() => { try { sql(`DELETE FROM delivery_bills WHERE plan_id = ${q(A)}; DELETE FROM delivery_plan WHERE id = ${q(A)}`); return 'deleted'; } catch (e) { return `${e.message} ${e.stdout ?? ""} ${e.stderr ?? ""}`; } })();
  check('… the database refuses it too (FK RESTRICT)', /FOREIGN KEY/i.test(dbDel), dbDel);
  r = await admin('POST', '/api/delivery-plan/import', { date: TODAY, mode: 'append', rows: [row(2, TODAY, 'ZT-T1', 'ZT-TC4', 'ร้านดี', '3', 'ZT-TB4')], commit: true });
  check('"เพิ่ม" (append) still works', r.st === 200, r);
  r = await admin('DELETE', `/api/delivery-plan/${(await plan()).find((s) => s.code === 'ZT-TC4')?.id}`);
  check('a store without a status can still be removed', r.st === 200, r);

  section('finish a store');
  r = await staff('POST', `/api/store-visits/${visitA}/save`, { cases: 10 });
  check('save refused before "รถออกจากร้าน"', r.st === 400, r);
  r = await staff('POST', `/api/store-visits/${visitA}/end`, {});
  check('truck leaves: end time stamped', r.st === 200 && !!r.j?.ended_at, r);
  r = await staff('POST', `/api/store-visits/${visitA}/resume`, {});
  check('"กดจบผิด" puts the clock back', r.st === 200 && (await plan()).find((s) => s.id === A)?.visit?.ended_at === null, r);
  await staff('POST', `/api/store-visits/${visitA}/end`, {});
  r = await staff('POST', `/api/store-visits/${visitA}/save`, { cases: '' });
  check('cases are required', r.st === 400, r);
  r = await staff('POST', `/api/store-visits/${visitA}/save`, { cases: 12, method: 'bike' });
  check('unknown move method refused', r.st === 400, r);
  r = await staff('POST', `/api/store-visits/${visitA}/save`, { cases: '12.5' });
  check('cases must be a whole number', r.st === 400, r);
  r = await staff('POST', `/api/store-visits/${visitA}/save`, { cases: -3 });
  check('negative cases refused', r.st === 400, r);
  r = await staff('POST', `/api/store-visits/${visitA}/save`, { cases: 12 });
  check('save without move method / SKU / distance (optional)', r.st === 200, r);
  stops = await plan();
  const a = stops.find((s) => s.id === A)?.visit;
  check('store A = ส่งสำเร็จ, 12 cases, who pressed it kept', a?.status === 'done' && a.cases === 12 && !!a.by && !!a.started_at && !!a.ended_at, a);
  r = await staff('POST', `/api/store-visits/${visitA}/save`, { cases: 99 });
  check('a delivered store cannot be saved again', r.st === 409, r);
  r = await staff('DELETE', `/api/store-visits/${visitA}`);
  check('a delivered store cannot be cancelled', r.st === 409, r);
  const dbFinal = (() => { try { sql(`UPDATE store_visits SET cases = 1 WHERE id = ${q(visitA)}`); return 'updated'; } catch (e) { return `${e.message} ${e.stdout ?? ""} ${e.stderr ?? ""}`; } })();
  check('… the database keeps it final (trigger STORE_VISIT_FINAL)', dbFinal.includes('STORE_VISIT_FINAL'), dbFinal);

  section('not delivered');
  r = await staff('POST', '/api/store-visits/fail', { plan_id: B, note: 'ร้านปิด' });
  const visitB = r.j?.id;
  check('ส่งไม่สำเร็จ with a note', r.st === 200 && !!visitB, r);
  r = await staff('POST', '/api/store-visits/start', { plan_id: B });
  check('a not-delivered store cannot be started', r.st === 409, r);
  r = await staff('DELETE', `/api/store-visits/${visitB}`);
  check('"ยกเลิกสถานะ" puts it back', r.st === 200, r);
  r = await staff('POST', '/api/store-visits/fail', { plan_id: B, note: 'ร้านปิด' });
  check('… and it can be marked again', r.st === 200, r);
  const visitB2 = r.j?.id;

  section('cancel + end of work');
  r = await staff('POST', '/api/store-visits/start', { plan_id: C });
  r = await staff('DELETE', `/api/store-visits/${r.j?.id}`);
  check('a store being timed can be cancelled', r.st === 200 && (await plan()).find((s) => s.id === C)?.visit === null, r);
  r = await other('DELETE', `/api/trip-activities/${tripId}`);
  check("another team cannot delete this vehicle's work record (403)", r.st === 403, r);
  r = await staff('DELETE', `/api/trip-activities/${tripId}`);
  check('a work record with store statuses cannot be deleted', r.st === 409, r);
  r = await staff('POST', `/api/trip-activities/${tripId}/end`, {});
  check('"จบงาน" works once no store is open', r.st === 200, r);
  r = await staff('POST', '/api/store-visits/start', { plan_id: C });
  check('after "จบงาน" no store can be started', r.st === 409 && /จบงานแล้ว/.test(r.j?.error), r);
  r = await staff('POST', '/api/store-visits/fail', { plan_id: C, note: 'x' });
  check('… nor marked not delivered', r.st === 409, r);
  r = await staff('DELETE', `/api/store-visits/${visitB2}`);
  check('… nor put back', r.st === 409, r);
  const dbIns = (() => { try { sql(`INSERT INTO store_visits (plan_id, trip_activity_id, status, note) VALUES (${q(C)}, ${q(tripId)}, 'failed', 'x')`); return 'inserted'; } catch (e) { return `${e.message} ${e.stdout ?? ""} ${e.stderr ?? ""}`; } })();
  check('… the database refuses it too (trigger WORK_ENDED)', dbIns.includes('WORK_ENDED'), dbIns);

  r = await staff('GET', `/api/delivery-plan?date=${TODAY}&plate=${encodeURIComponent('80-5678')}`);
  check("statuses of another team's vehicle stay hidden (403)", r.st === 403, r);

  section('report (view v_store_visit_summary)');
  r = await admin('GET', `/api/store-visits?from=${TODAY}&to=${TODAY}`);
  const rep = (r.j ?? []).filter((x) => x.plate === 'ZT-T1');
  const ra = rep.find((x) => x.plan_id === A), rb = rep.find((x) => x.plan_id === B), rc = rep.find((x) => x.plan_id === C);
  check('report: 1 row per store of the plan', r.st === 200 && rep.length === 3, rep);
  check('report: delivered row has server times, seconds, cases, who', ra?.status === 'done' && ra.seconds >= 0 && ra.cases === 12 && !!ra.by_name && !!ra.started_at && !!ra.ended_at, ra);
  check('report: not-delivered row keeps its note', rb?.status === 'failed' && rb.note === 'ร้านปิด' && rb.seconds === null, rb);
  check('report: a store not visited = none', rc?.status === 'none' && rc.started_at === null, rc);
  r = await staff('GET', `/api/store-visits?from=${TODAY}&to=${TODAY}`);
  check('report: staff cannot read it (403)', r.st === 403, r);
  r = await admin('GET', `/api/store-visits?from=2025-01-01&to=${TODAY}`);
  check('report: range over 1 year refused', r.st === 400, r);

  section('report downloads /api/reports (admin only)');
  r = await staff('GET', '/api/reports/employee-monthly.json');
  check('staff cannot download a report (403)', r.st === 403, r);
  r = await admin('GET', '/api/reports/employee-monthly.json');
  check('admin can download a report', r.st === 200 && Array.isArray(r.j), r.st);
}

/** every active check item = ผ่าน (a vehicle check must answer them all) */
let ACTIVE_ITEMS = [];
const allPass = () => Object.fromEntries(ACTIVE_ITEMS.map((n) => [n, 1]));
const dbErr = (command) => { try { sql(command); return 'ok'; } catch (e) { return `${e.message} ${e.stdout ?? ''} ${e.stderr ?? ''}`; } };

async function vehicleCheckTests(staff) {
  section('vehicle check rules (mileage, every item, one vehicle a day)');
  sql(`INSERT INTO vehicles (id, plate, type, active) VALUES ('zt-veh-c1', 'ZT-C1', 'ทดสอบ', 1), ('zt-veh-c2', 'ZT-C2', 'ทดสอบ', 1);`);
  const body = (plate, extra = {}) => ({ date: TODAY, time: '08:00', dman: 'EMP02', h1: '', h2: '', plate, mileage: '5000', note: '', results: allPass(), photos: {}, defects: {}, ...extra });
  let r = await staff('POST', '/api/vehicle-inspections', body('ZT-C1', { mileage: '' }));
  check('no mileage = cannot send', r.st === 400 && /เลขไมล์/.test(r.j?.error), r);
  const some = Object.fromEntries(ACTIVE_ITEMS.slice(0, 3).map((n) => [n, 1]));
  r = await staff('POST', '/api/vehicle-inspections', body('ZT-C1', { results: some }));
  check('not every item checked = cannot send (names the missing items)', r.st === 400 && /ครบทุกข้อ/.test(r.j?.error), r);
  // staff1 has today's check of 70 1234 (made by this test or earlier): a second vehicle is refused
  const mineToday = sql(`SELECT count(*) n FROM vehicle_inspections WHERE inspect_date = ${q(TODAY)} AND created_by = 'staff1'`)[0].n;
  if (!mineToday) {
    r = await staff('POST', '/api/vehicle-inspections', body('ZT-C1'));
    check('first vehicle of the day saved', r.st === 200, r);
  }
  r = await staff('POST', '/api/vehicle-inspections', body('ZT-C2'));
  check('a second vehicle the same day is refused', r.st === 409 && /วันละ 1 คัน/.test(r.j?.error), r);
  // fixing my own check stays possible (every item + mileage again)
  const mine = sql(`SELECT vi.id, v.plate FROM vehicle_inspections vi JOIN vehicles v ON v.id = vi.vehicle_id
                    WHERE vi.inspect_date = ${q(TODAY)} AND vi.created_by = 'staff1' AND vi.approved_at IS NULL LIMIT 1`)[0];
  if (mine) {
    r = await staff('POST', '/api/vehicle-inspections', { ...body(mine.plate, { mileage: '5001' }), id: mine.id, dman: 'EMP01' });
    check('my own check can still be fixed', r.st === 200, r);
    r = await staff('POST', '/api/vehicle-inspections', { ...body(mine.plate, { mileage: '' }), id: mine.id, dman: 'EMP01' });
    check('… but a fix also needs the mileage', r.st === 400, r);
  }
  let e = dbErr(`INSERT INTO vehicle_inspections (id, inspect_date, vehicle_id, dman_id, created_by) VALUES ('zt-vc-nomile', ${q(TODAY)}, 'zt-veh-c2', 'EMP04', NULL)`);
  check('the database refuses a check without mileage (MILEAGE_REQUIRED)', e.includes('MILEAGE_REQUIRED'), e);
  e = dbErr(`INSERT INTO vehicle_inspections (id, inspect_date, vehicle_id, mileage, dman_id, created_by) VALUES ('zt-vc-two', ${q(TODAY)}, 'zt-veh-c2', 1, 'EMP04', 'super1')`);
  check('the database refuses a second vehicle for one account (ONE_VEHICLE_A_DAY)', e.includes('ONE_VEHICLE_A_DAY'), e);
}

/** photo file names: day-time taken + vehicle + slot (uploads go to the LOCAL R2 and are deleted again) */
async function photoTests(token) {
  section('photo file names');
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]);
  const up = async (qs) => {
    const r = await fetch(`${BASE}/api/photos?${qs}`, {
      method: 'POST', body: jpg,
      headers: { cookie: `__Host-pt_session=${token}`, 'content-type': 'image/jpeg', origin: BASE, 'x-requested-with': 'pretrip' },
    });
    return { st: r.status, j: await r.json().catch(() => null) };
  };
  const keys = [];
  const now = new Date(Date.now() + 7 * 3600_000).toISOString();
  const day = now.slice(0, 10);
  let r = await up(`date=${TODAY}&plate=${encodeURIComponent('70 1234')}&slot=front`);
  if (r.j?.key) keys.push(r.j.key);
  const re = new RegExp(`^${day.slice(0, 7)}/${day}/701234/${day.replace(/-/g, '')}-\\d{4}_701234_front_[0-9a-f]{6}\\.jpg$`);
  check('photo named month/day/vehicle/daytime_vehicle_slot_random', r.st === 201 && re.test(r.j?.key ?? ''), r);
  r = await up(`date=${TODAY}&plate=${encodeURIComponent('70 1234')}&slot=item07`);
  if (r.j?.key) keys.push(r.j.key);
  check('a failed-item photo is named itemNN', r.st === 201 && /_701234_item07_[0-9a-f]{6}\.jpg$/.test(r.j?.key ?? ''), r);
  r = await up(`date=${TODAY}&plate=ZT-NOPE&slot=front`);
  check('unknown vehicle refused', r.st === 400, r);
  r = await up(`date=${TODAY}&plate=${encodeURIComponent('70 1234')}&slot=../x`);
  check('bad slot refused', r.st === 400, r);
  r = await up(`date=${TODAY}`);
  if (r.j?.key) keys.push(r.j.key);
  check('an older page without plate still uploads (old name)', r.st === 201 && /^\d{4}-\d{2}\/\d{4}-\d{2}-\d{2}_[0-9a-f-]{36}\.jpg$/.test(r.j?.key ?? ''), r);
  const g = await fetch(`${BASE}/api/photos/${(keys[0] ?? '').split('/').map(encodeURIComponent).join('/')}`, { headers: { cookie: `__Host-pt_session=${token}` } });
  check('a new-name photo can be opened again', g.status === 200, g.status);
  const d = await api(token)('POST', '/api/photos/delete', { keys });
  check('test photos deleted', d.st === 200 && (d.j?.deleted ?? []).length === keys.length, d);
}

/* --------------------------------------------------------------- run --------------------------------------------------------------- */

async function main() {
  if (await portInUse(PORT)) throw new Error(`port ${PORT} is in use — stop the other wrangler dev first`);
  console.log('applying local migrations…');
  wrangler(['d1', 'migrations', 'apply', DB, '--local']);
  prerequisites();
  ACTIVE_ITEMS = sql(`SELECT item_no FROM check_items WHERE active = 1 ORDER BY item_no`).map((x) => x.item_no);
  cleanup(); // leftovers of an interrupted run
  console.log('starting the local Worker…');
  await startWorker();

  const admin = api(newSession('super1'));
  const staffToken = newSession('staff1');
  const staff = api(staffToken);
  // staff1 (EMP01) checks 70 1234 today, unless a check exists already (then it is left as it is)
  const had = sql(`SELECT id FROM vehicle_inspections WHERE inspect_date = ${q(TODAY)} AND vehicle_id = (SELECT id FROM vehicles WHERE plate = '70 1234')`);
  if (!had.length) {
    const r = await staff('POST', '/api/vehicle-inspections', {
      date: TODAY, time: '08:00', dman: 'EMP01', h1: '', h2: '', plate: '70 1234', mileage: '1000', note: '', results: allPass(), photos: {}, defects: {},
    });
    if (r.st !== 200) throw new Error(`could not create the staff vehicle check: ${JSON.stringify(r.j)}`);
    created.checks.push(r.j.id);
  }
  // another team (EMP03, saved by staff2) checks 80-5678 today
  const other = sql(`SELECT id FROM vehicle_inspections WHERE inspect_date = ${q(TODAY)} AND vehicle_id = (SELECT id FROM vehicles WHERE plate = '80-5678')`);
  if (!other.length) {
    sql(`INSERT INTO vehicle_inspections (id, inspect_date, inspect_time, vehicle_id, mileage, dman_id, created_by, updated_by)
         VALUES ('zt-other-team', ${q(TODAY)}, '08:00', (SELECT id FROM vehicles WHERE plate = '80-5678'), 1000, 'EMP03', 'staff2', 'staff2')`);
    created.checks.push('zt-other-team');
  }

  await deliveryTests(admin, staff);
  await timerTests(admin, staff, api(newSession('staff2')));
  await vehicleCheckTests(staff);
  await photoTests(staffToken);
  await vehicleTests(admin);
}

let crashed = null;
try { await main(); } catch (e) { crashed = e; }
try { cleanup(); } catch (e) { console.error('cleanup failed:', e.message); failed++; }
stopWorker();
if (crashed) { console.error(`\nERROR: ${crashed.message}`); process.exit(2); }
console.log(`\n${failed ? `${failed} FAILED, ${passed} passed` : `ALL PASSED (${passed})`} — local test data removed`);
process.exit(failed ? 1 : 0);
