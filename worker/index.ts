/**
 * Pre-Trip PPE Check — Cloudflare Worker
 *   /api/*   JSON API over D1 (data) and R2 (photos); login = id_user + password (session cookie)
 *   pages    staff page (/) or admin page (/admin/), chosen by the signed-in role
 *   files    static build files from ./dist (js, css, icons)
 * See cloudflare/README.md for the data model and API list.
 */
import { authenticate } from './auth';
import * as a from './auth-routes';
import { HttpError, errorResponse, mapDbError } from './http';
import * as lic from './license-routes';
import * as r from './routes';
import type { Ctx, Env } from './routes';
import * as trip from './trip-routes';
import * as imp from './import-routes';
import * as dp from './delivery-routes';
import * as sv from './store-visit-routes';

/**
 * true  = staff must send a driving-licence photo before using anything else (no skipping)
 * false = for now: staff may skip to the main page; a reminder shows until they send one
 * Keep in sync with LICENSE_REQUIRED in src/lib/license.ts.
 */
const REQUIRE_LICENSE = false;

type Handler = (c: Ctx) => Promise<Response>;
type PublicHandler = (req: Request, env: Env, exec: ExecutionContext) => Promise<Response>;
type Route =
  | { m: string; re: RegExp; pub: PublicHandler }
  | { m: string; re: RegExp; h: Handler; duringPasswordChange?: boolean; beforeConsent?: boolean; beforeLicense?: boolean };

const ROUTES: Route[] = [
  // no session needed
  { m: 'GET', re: /^\/api\/auth\/status$/, pub: a.authStatus },
  { m: 'POST', re: /^\/api\/auth\/setup$/, pub: a.setup },
  { m: 'POST', re: /^\/api\/auth\/login$/, pub: a.login },
  { m: 'POST', re: /^\/api\/auth\/logout$/, pub: a.logout },

  // signed in (allowed even when the user must change a temporary password)
  { m: 'GET', re: /^\/api\/me$/, h: a.getMe, duringPasswordChange: true, beforeConsent: true, beforeLicense: true },
  { m: 'POST', re: /^\/api\/auth\/password$/, h: a.changePassword, duringPasswordChange: true, beforeConsent: true, beforeLicense: true },

  // personal-data consent and driver licenses
  { m: 'POST', re: /^\/api\/consent$/, h: lic.acceptConsent, beforeConsent: true, beforeLicense: true },
  { m: 'GET', re: /^\/api\/me\/license$/, h: lic.getMyLicense, beforeLicense: true },
  { m: 'POST', re: /^\/api\/me\/license$/, h: lic.saveMyLicense, beforeLicense: true },
  { m: 'GET', re: /^\/api\/licenses$/, h: lic.listLicenses },
  { m: 'GET', re: /^\/api\/licenses\/([^/]+)\/photo$/, h: lic.getLicensePhoto, beforeLicense: true },

  // user administration (admin)
  { m: 'GET', re: /^\/api\/users$/, h: a.listUsers },
  { m: 'POST', re: /^\/api\/users$/, h: a.createUser },
  { m: 'PUT', re: /^\/api\/users\/([^/]+)$/, h: a.updateUser },
  { m: 'DELETE', re: /^\/api\/users\/([^/]+)$/, h: a.deleteUser },
  { m: 'POST', re: /^\/api\/users\/([^/]+)\/reset-password$/, h: a.resetPassword },
  // admin: import employees + accounts from an Excel / CSV file (check first, then import)
  { m: 'POST', re: /^\/api\/import\/employees$/, h: imp.importEmployees },
  { m: 'POST', re: /^\/api\/import\/vehicles$/, h: imp.importVehicles },

  // store delivery plan (hidden unless FEATURE_STORE_DELIVERY = "1")
  { m: 'GET', re: /^\/api\/delivery-plan$/, h: dp.listDeliveryPlan },
  { m: 'POST', re: /^\/api\/delivery-plan\/import$/, h: dp.importDeliveryPlan },
  { m: 'POST', re: /^\/api\/delivery-plan$/, h: dp.addDeliveryStop },
  { m: 'DELETE', re: /^\/api\/delivery-plan$/, h: dp.clearDeliveryPlan },
  { m: 'DELETE', re: /^\/api\/delivery-plan\/([^/]+)$/, h: dp.removeDeliveryStop },
  // store timer (hidden unless FEATURE_STORE_TIMER = "1"); the statuses come with GET /api/delivery-plan
  { m: 'POST', re: /^\/api\/store-visits\/start$/, h: sv.startStoreVisit },
  { m: 'POST', re: /^\/api\/store-visits\/fail$/, h: sv.failStoreVisit },
  { m: 'POST', re: /^\/api\/store-visits\/([^/]+)\/end$/, h: sv.endStoreVisit },
  { m: 'POST', re: /^\/api\/store-visits\/([^/]+)\/resume$/, h: sv.resumeStoreVisit },
  { m: 'POST', re: /^\/api\/store-visits\/([^/]+)\/save$/, h: sv.saveStoreVisit },
  { m: 'GET', re: /^\/api\/store-visits$/, h: sv.listStoreVisitReport },
  { m: 'DELETE', re: /^\/api\/store-visits$/, h: sv.devResetStoreVisits },
  { m: 'DELETE', re: /^\/api\/store-visits\/([^/]+)$/, h: sv.deleteStoreVisit },

  { m: 'GET', re: /^\/api\/master$/, h: r.getMaster },
  { m: 'PUT', re: /^\/api\/employees\/([^/]+)$/, h: r.putEmployee },
  { m: 'PUT', re: /^\/api\/vehicles$/, h: r.putVehicle },
  { m: 'DELETE', re: /^\/api\/vehicles\/([^/]+)$/, h: r.deleteVehicle },
  { m: 'DELETE', re: /^\/api\/employees\/([^/]+)$/, h: r.deleteEmployee },

  { m: 'GET', re: /^\/api\/vehicle-inspections$/, h: r.listVehicleInspections },
  { m: 'POST', re: /^\/api\/vehicle-inspections$/, h: r.saveVehicleInspection },
  { m: 'DELETE', re: /^\/api\/vehicle-inspections\/([^/]+)$/, h: r.deleteVehicleInspection },
  { m: 'POST', re: /^\/api\/vehicle-inspections\/([^/]+)\/approval$/, h: r.approveVehicle },
  { m: 'DELETE', re: /^\/api\/vehicle-inspections\/([^/]+)\/approval$/, h: r.unapproveVehicle },
  { m: 'POST', re: /^\/api\/vehicle-inspections\/([^/]+)\/rejection$/, h: r.rejectVehicle },
  { m: 'DELETE', re: /^\/api\/vehicle-inspections\/([^/]+)\/rejection$/, h: r.unrejectVehicle },

  { m: 'GET', re: /^\/api\/ppe-inspections$/, h: r.listPpeInspections },
  { m: 'POST', re: /^\/api\/ppe-inspections$/, h: r.savePpeInspections },
  { m: 'DELETE', re: /^\/api\/ppe-inspections\/([^/]+)$/, h: r.deletePpeInspection },
  { m: 'POST', re: /^\/api\/ppe-inspections\/([^/]+)\/approval$/, h: r.approvePpe },
  { m: 'DELETE', re: /^\/api\/ppe-inspections\/([^/]+)\/approval$/, h: r.unapprovePpe },

  { m: 'GET', re: /^\/api\/trip-activities$/, h: trip.listTripActivities },
  { m: 'DELETE', re: /^\/api\/trip-activities\/([^/]+)$/, h: trip.deleteTripActivity },
  { m: 'POST', re: /^\/api\/trip-activities\/start$/, h: trip.startWork },
  { m: 'POST', re: /^\/api\/trip-activities\/([^/]+)\/end$/, h: trip.endWork },

  { m: 'POST', re: /^\/api\/photos$/, h: r.uploadPhoto },
  { m: 'POST', re: /^\/api\/photos\/delete$/, h: r.deletePhotos },
  { m: 'GET', re: /^\/api\/photos\/(.+)$/, h: r.getPhoto },

  { m: 'GET', re: /^\/api\/reports\/([a-z-]+)(?:\.(csv|json))?$/, h: r.getReport },
];

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** Local dev only: the Vite dev server (another port) proxies /api to wrangler dev. Never true in production. */
function isLocalDevPair(origin: string, url: URL): boolean {
  if (!LOCAL_HOSTS.has(url.hostname)) return false;
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/* =====================================================================
 * Web pages: the server decides which page each person gets, by role.
 *   admin              → admin page (/admin/) only
 *   user / signed out  → staff page (/) only — the login screen lives there
 * Every route goes through the Worker first (wrangler.toml run_worker_first = true),
 * so no path trick (encoding, case, /index.html, extra slashes) reaches a page directly.
 * The API checks roles again on every call.
 * ===================================================================== */

const ADMIN_HOME = '/admin/';
const STAFF_HOME = '/';

/** True for any spelling of an /admin path (%61dmin, ADMIN, //admin, /admin.html …). */
function isAdminPath(pathname: string): boolean {
  let p = pathname;
  try { p = decodeURIComponent(p); } catch { /* keep raw */ }
  p = p.toLowerCase().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  return /^\/admin(?:[/.]|$)/.test(p);
}

/** Static build files (js, css, icons). Pages (html) never come from here. */
function isStaticFile(pathname: string): boolean {
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  return /\.[a-z0-9]+$/i.test(last) && !/\.html?$/i.test(last);
}

async function signedInRole(req: Request, env: Env, exec: ExecutionContext): Promise<'admin' | 'user' | null> {
  try {
    const actor = await authenticate(req, env, exec);
    // an admin who still has to change a temporary password stays on the staff page's password screen
    if (actor.must_change_password) return 'user';
    return actor.role === 'admin' ? 'admin' : 'user';
  } catch (e) {
    if (e instanceof HttpError) return null;
    throw e;
  }
}

function redirect(to: string): Response {
  return withSecurityHeaders(new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-store' } }));
}

async function servePage(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return withSecurityHeaders(new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } }));
  }
  const url = new URL(req.url);
  const role = await signedInRole(req, env, exec);
  const wantsAdmin = isAdminPath(url.pathname);

  if (role === 'admin' && !wantsAdmin) return redirect(ADMIN_HOME);
  if (role !== 'admin' && wantsAdmin) return redirect(STAFF_HOME);

  const page = await env.ASSETS.fetch(new Request(new URL(role === 'admin' ? ADMIN_HOME : STAFF_HOME, url.origin), {
    method: req.method, headers: { accept: 'text/html' },
  }));
  const res = withSecurityHeaders(page);
  res.headers.set('cache-control', 'no-store');
  res.headers.set('vary', 'cookie');
  return res;
}

async function serveStatic(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
  const res = await env.ASSETS.fetch(req);
  // safety net: a static path must never hand out a page
  if ((res.headers.get('content-type') ?? '').includes('text/html')) return servePage(req, env, exec);
  return res;
}

async function handleApi(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method === 'HEAD' ? 'GET' : req.method;

  let route: Route | null = null;
  let params: string[] = [];
  let pathKnown = false;
  for (const rt of ROUTES) {
    const hit = rt.re.exec(url.pathname);
    if (!hit) continue;
    pathKnown = true;
    if (rt.m === method) { route = rt; params = hit.slice(1); break; }
  }
  if (!route) return errorResponse(pathKnown ? 405 : 404, pathKnown ? 'ไม่รองรับ method นี้' : 'ไม่พบ API นี้');

  // CSRF: state-changing calls must come from our own page (custom header + same origin)
  if (method !== 'GET') {
    const origin = req.headers.get('origin');
    if (origin && origin !== url.origin && !isLocalDevPair(origin, url)) {
      return errorResponse(403, 'ไม่อนุญาตให้เรียกจากเว็บอื่น');
    }
    if (req.headers.get('x-requested-with') !== 'pretrip') return errorResponse(403, 'คำขอไม่ถูกต้อง');
  }

  if ('pub' in route) return route.pub(req, env, exec);

  const actor = await authenticate(req, env, exec);
  if (actor.must_change_password && !route.duringPasswordChange) {
    return errorResponse(403, 'กรุณาเปลี่ยนรหัสผ่านชั่วคราวก่อนใช้งาน');
  }
  // staff must accept the personal-data consent before using anything else
  if (actor.role === 'user' && !actor.consented && !route.beforeConsent) {
    return errorResponse(403, 'กรุณายอมรับความยินยอมในการใช้ข้อมูลส่วนบุคคลก่อนใช้งาน');
  }
  // ... and send a photo of their driving licence (only while REQUIRE_LICENSE is on)
  if (REQUIRE_LICENSE && actor.role === 'user' && !actor.has_license && !route.beforeLicense) {
    return errorResponse(403, 'กรุณาถ่ายรูปใบขับขี่และกรอกข้อมูลให้ครบก่อนใช้งาน');
  }
  return route.h({ req, env, exec, url, actor, params });
}

export default {
  async fetch(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    // always HTTPS: the custom domain also answers plain http:// (workers.dev never did) — send it to https://
    // (login cookies are Secure-only, and nothing should travel unencrypted); local development stays on http
    if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    if (!url.pathname.startsWith('/api/')) {
      return isStaticFile(url.pathname) ? serveStatic(req, env, exec) : servePage(req, env, exec);
    }
    try {
      return withSecurityHeaders(await handleApi(req, env, exec));
    } catch (e) {
      if (e instanceof HttpError) return withSecurityHeaders(errorResponse(e.status, e.message));
      const mapped = mapDbError(e);
      if (mapped) return withSecurityHeaders(errorResponse(mapped.status, mapped.message));
      console.error('API error', req.method, url.pathname, e);
      return withSecurityHeaders(errorResponse(500, 'เกิดข้อผิดพลาดในระบบ ลองใหม่อีกครั้ง'));
    }
  },

  async scheduled(_event: ScheduledController, env: Env, exec: ExecutionContext) {
    exec.waitUntil(Promise.all([
      r.cleanupOrphanPhotos(env).then((n) => console.log(`cleanup: removed ${n} orphan photos`)),
      a.cleanupAuth(env).then(() => console.log('cleanup: expired sessions removed')),
    ]).catch((e) => console.error('cleanup failed', e)));
  },
} satisfies ExportedHandler<Env>;
