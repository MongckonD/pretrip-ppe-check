/**
 * Pre-Trip PPE Check — Cloudflare Worker
 *   /api/*   JSON API over D1 (data) and R2 (photos); login = id_user + password (session cookie)
 *   others   static web app from ./dist (served by the assets binding)
 * See cloudflare/README.md for the data model and API list.
 */
import { authenticate } from './auth';
import * as a from './auth-routes';
import { HttpError, errorResponse, mapDbError } from './http';
import * as r from './routes';
import type { Ctx, Env } from './routes';
import * as trip from './trip-routes';

type Handler = (c: Ctx) => Promise<Response>;
type PublicHandler = (req: Request, env: Env, exec: ExecutionContext) => Promise<Response>;
type Route =
  | { m: string; re: RegExp; pub: PublicHandler }
  | { m: string; re: RegExp; h: Handler; duringPasswordChange?: boolean };

const ROUTES: Route[] = [
  // no session needed
  { m: 'GET', re: /^\/api\/auth\/status$/, pub: a.authStatus },
  { m: 'POST', re: /^\/api\/auth\/setup$/, pub: a.setup },
  { m: 'POST', re: /^\/api\/auth\/login$/, pub: a.login },
  { m: 'POST', re: /^\/api\/auth\/logout$/, pub: a.logout },

  // signed in (allowed even when the user must change a temporary password)
  { m: 'GET', re: /^\/api\/me$/, h: a.getMe, duringPasswordChange: true },
  { m: 'POST', re: /^\/api\/auth\/password$/, h: a.changePassword, duringPasswordChange: true },

  // user administration (admin)
  { m: 'GET', re: /^\/api\/users$/, h: a.listUsers },
  { m: 'POST', re: /^\/api\/users$/, h: a.createUser },
  { m: 'PUT', re: /^\/api\/users\/([^/]+)$/, h: a.updateUser },
  { m: 'POST', re: /^\/api\/users\/([^/]+)\/reset-password$/, h: a.resetPassword },

  { m: 'GET', re: /^\/api\/master$/, h: r.getMaster },
  { m: 'PUT', re: /^\/api\/employees\/([^/]+)$/, h: r.putEmployee },
  { m: 'PUT', re: /^\/api\/vehicles$/, h: r.putVehicle },
  { m: 'DELETE', re: /^\/api\/vehicles\/([^/]+)$/, h: r.deleteVehicle },

  { m: 'GET', re: /^\/api\/vehicle-inspections$/, h: r.listVehicleInspections },
  { m: 'POST', re: /^\/api\/vehicle-inspections$/, h: r.saveVehicleInspection },
  { m: 'DELETE', re: /^\/api\/vehicle-inspections\/([^/]+)$/, h: r.deleteVehicleInspection },
  { m: 'POST', re: /^\/api\/vehicle-inspections\/([^/]+)\/approval$/, h: r.approveVehicle },
  { m: 'DELETE', re: /^\/api\/vehicle-inspections\/([^/]+)\/approval$/, h: r.unapproveVehicle },

  { m: 'GET', re: /^\/api\/ppe-inspections$/, h: r.listPpeInspections },
  { m: 'POST', re: /^\/api\/ppe-inspections$/, h: r.savePpeInspections },
  { m: 'DELETE', re: /^\/api\/ppe-inspections\/([^/]+)$/, h: r.deletePpeInspection },
  { m: 'POST', re: /^\/api\/ppe-inspections\/([^/]+)\/approval$/, h: r.approvePpe },
  { m: 'DELETE', re: /^\/api\/ppe-inspections\/([^/]+)\/approval$/, h: r.unapprovePpe },

  { m: 'GET', re: /^\/api\/trip-activities$/, h: trip.listTripActivities },
  { m: 'POST', re: /^\/api\/trip-activities$/, h: trip.saveTripActivity },
  { m: 'DELETE', re: /^\/api\/trip-activities\/([^/]+)$/, h: trip.deleteTripActivity },

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
  return route.h({ req, env, exec, url, actor, params });
}

export default {
  async fetch(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
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
