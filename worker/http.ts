/** HTTP helpers shared by all routes. */

/** An error that is safe to show to the user (message is Thai, status is the HTTP code). */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const bad = (msg: string) => new HttpError(400, msg);
export const forbidden = (msg: string) => new HttpError(403, msg);
export const notFound = (msg = 'ไม่พบข้อมูล') => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

const NO_STORE = { 'cache-control': 'no-store' };

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE, ...headers },
  });
}

export function errorResponse(status: number, message: string): Response {
  return json({ error: message }, status);
}

const MAX_JSON_BYTES = 256 * 1024;

/** Read a JSON object body with a size cap. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) throw bad('ต้องส่งข้อมูลเป็น JSON');
  const text = await req.text();
  if (text.length > MAX_JSON_BYTES) throw new HttpError(413, 'ข้อมูลใหญ่เกินไป');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw bad('รูปแบบ JSON ไม่ถูกต้อง');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('ข้อมูลต้องเป็น object');
  return body as Record<string, unknown>;
}

/**
 * Turn a D1/SQLite error into a user-facing HttpError.
 * Messages from our triggers start with LOCKED: / PPE_VEHICLE_MISMATCH:.
 */
export function mapDbError(e: unknown): HttpError | null {
  const msg = String((e as { message?: string })?.message ?? e) + ' ' + String((e as { cause?: { message?: string } })?.cause?.message ?? '');
  if (msg.includes('APPROVAL_FINAL:')) return conflict('อนุมัติแล้ว ยกเลิกหรือแก้ไขการอนุมัติไม่ได้');
  if (msg.includes('REJECT_STATE:')) return bad('ไม่อนุมัติต้องมีเหตุผล และอนุมัติพร้อมกันไม่ได้');
  if (msg.includes('LOCKED:')) return conflict('รายการนี้หัวหน้าอนุมัติแล้ว แก้ไขหรือลบไม่ได้ (ต้องยกเลิกอนุมัติก่อน)');
  if (msg.includes('TRIP_VEHICLE_MISMATCH')) return conflict('บันทึกก่อนออกงานที่ผูกกับใบตรวจรถต้องเป็นวันและรถเดียวกัน');
  if (msg.includes('UNIQUE constraint failed: trip_activities')) return conflict('รถคันนี้มีบันทึกก่อนออกงานของวันนี้แล้ว');
  if (msg.includes('PPE_VEHICLE_MISMATCH')) return conflict('ใบ PPE ที่ผูกกับใบตรวจรถต้องเป็นวันและรถเดียวกัน');
  if (msg.includes('UNIQUE constraint failed: vehicle_inspections')) return conflict('รถคันนี้มีบันทึกการตรวจของวันนี้แล้ว');
  if (msg.includes('UNIQUE constraint failed: ppe_inspections')) return conflict('พนักงานคนนี้มีบันทึก PPE ของวันนี้แล้ว');
  if (msg.includes('UNIQUE constraint failed: vehicle_inspection_photos.r2_key')) return conflict('รูปนี้ถูกใช้ในบันทึกอื่นแล้ว');
  if (msg.includes('delivery_bills.bill_no') || msg.includes('delivery_bills_bill_uq')) return conflict('เลขที่บิลนี้มีอยู่ในแผนส่งแล้ว — บิลหนึ่งใบส่งได้ครั้งเดียว');
  if (msg.includes('delivery_plan.plan_date') || msg.includes('delivery_plan_day_store_uq')) return conflict('ร้านนี้อยู่ในแผนส่งของวันนี้แล้ว (ร้านเดียวกันส่งได้คันเดียว) — โหลดรายการใหม่แล้วลองอีกครั้ง');
  if (msg.includes('UNIQUE constraint failed: vehicles')) return conflict('ทะเบียนนี้มีอยู่แล้ว');
  if (msg.includes('UNIQUE constraint failed: employees.emp_code')) return conflict('รหัสพนักงานนี้ใช้กับพนักงานคนอื่นแล้ว');
  if (msg.includes('UNIQUE constraint failed: users.employee_id')) return conflict('พนักงานคนนี้ผูกกับบัญชีอื่นอยู่แล้ว — พนักงาน 1 คนมีได้บัญชีเดียว');
  if (msg.includes('UNIQUE constraint failed: users.id')) return conflict('มีชื่อผู้ใช้นี้อยู่แล้ว');
  if (msg.includes('UNIQUE constraint failed: driver_licenses.license_no')) return conflict('เลขที่ใบขับขี่นี้ถูกใช้กับบัญชีอื่นแล้ว — ติดต่อผู้ดูแลระบบ');
  if (msg.includes('FOREIGN KEY constraint failed')) return conflict('ข้อมูลอ้างอิงไม่ถูกต้อง หรือมีประวัติการใช้งานอยู่');
  if (msg.includes('CHECK constraint failed')) return bad('ข้อมูลไม่ผ่านเงื่อนไขของระบบ');
  if (msg.includes('NOT NULL constraint failed')) return bad('ข้อมูลที่จำเป็นไม่ครบ');
  return null;
}
