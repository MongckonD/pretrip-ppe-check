/**
 * Delivery plan (ร้านค้าที่ต้องส่ง) + vehicle delete rules — end-to-end tests against the LOCAL Worker and LOCAL D1.
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
 * staff2, employee EMP03, and active vehicles "70 1234" and "80-5678".
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
    worker = spawn(win ? 'npx.cmd' : 'npx', ['wrangler', 'dev', '--port', String(PORT)], { shell: win, stdio: ['ignore', 'pipe', 'pipe'] });
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
  sql(`DELETE FROM delivery_bills WHERE bill_no LIKE 'ZT-%' OR plan_id IN (SELECT p.id FROM delivery_plan p JOIN stores s ON s.id = p.store_id WHERE s.sap_code LIKE 'ZT-%');
       DELETE FROM delivery_plan WHERE store_id IN (SELECT id FROM stores WHERE sap_code LIKE 'ZT-%');
       DELETE FROM stores WHERE sap_code LIKE 'ZT-%';
       DELETE FROM vehicles WHERE plate LIKE 'ZT-%';
       ${ids ? `DELETE FROM vehicle_inspections WHERE id IN (${ids});` : ''}
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

/* --------------------------------------------------------------- run --------------------------------------------------------------- */

async function main() {
  if (await portInUse(PORT)) throw new Error(`port ${PORT} is in use — stop the other wrangler dev first`);
  console.log('applying local migrations…');
  wrangler(['d1', 'migrations', 'apply', DB, '--local']);
  prerequisites();
  cleanup(); // leftovers of an interrupted run
  console.log('starting the local Worker…');
  await startWorker();

  const admin = api(newSession('super1'));
  const staff = api(newSession('staff1'));
  // staff1 (EMP01) checks 70 1234 today, unless a check exists already (then it is left as it is)
  const had = sql(`SELECT id FROM vehicle_inspections WHERE inspect_date = ${q(TODAY)} AND vehicle_id = (SELECT id FROM vehicles WHERE plate = '70 1234')`);
  if (!had.length) {
    const r = await staff('POST', '/api/vehicle-inspections', {
      date: TODAY, time: '08:00', dman: 'EMP01', h1: '', h2: '', plate: '70 1234', mileage: '', note: '', results: { 1: 1 }, photos: {}, defects: {},
    });
    if (r.st !== 200) throw new Error(`could not create the staff vehicle check: ${JSON.stringify(r.j)}`);
    created.checks.push(r.j.id);
  }
  // another team (EMP03, saved by staff2) checks 80-5678 today
  const other = sql(`SELECT id FROM vehicle_inspections WHERE inspect_date = ${q(TODAY)} AND vehicle_id = (SELECT id FROM vehicles WHERE plate = '80-5678')`);
  if (!other.length) {
    sql(`INSERT INTO vehicle_inspections (id, inspect_date, inspect_time, vehicle_id, dman_id, created_by, updated_by)
         VALUES ('zt-other-team', ${q(TODAY)}, '08:00', (SELECT id FROM vehicles WHERE plate = '80-5678'), 'EMP03', 'staff2', 'staff2')`);
    created.checks.push('zt-other-team');
  }

  await deliveryTests(admin, staff);
  await vehicleTests(admin);
}

let crashed = null;
try { await main(); } catch (e) { crashed = e; }
try { cleanup(); } catch (e) { console.error('cleanup failed:', e.message); failed++; }
stopWorker();
if (crashed) { console.error(`\nERROR: ${crashed.message}`); process.exit(2); }
console.log(`\n${failed ? `${failed} FAILED, ${passed} passed` : `ALL PASSED (${passed})`} — local test data removed`);
process.exit(failed ? 1 : 0);
