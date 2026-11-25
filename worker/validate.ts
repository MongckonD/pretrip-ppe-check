/** Input validation. Every message is shown to the user, so they are in Thai. */
import { bad } from './http';

/** Today's date in Thailand (UTC+7, no DST) as YYYY-MM-DD. */
export function todayTH(now = Date.now()): string {
  return new Date(now + 7 * 3600_000).toISOString().slice(0, 10);
}

/** Current time in Thailand as HH:MM. */
export function nowTimeTH(now = Date.now()): string {
  return new Date(now + 7 * 3600_000).toISOString().slice(11, 16);
}

export function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function reqDate(v: unknown, label = 'วันที่'): string {
  if (!isDate(v)) throw bad(`${label}ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)`);
  if (v < '2000-01-01') throw bad(`${label}เก่าเกินไป`);
  return v;
}

/** Inspection dates may not be in the future (Thai time). */
export function inspectDate(v: unknown): string {
  const d = reqDate(v, 'วันที่ตรวจ');
  if (d > todayTH()) throw bad('วันที่ตรวจต้องไม่เป็นวันในอนาคต');
  return d;
}

export function isMonth(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** HH:MM or HH:MM:SS, or empty → null. Stored as HH:MM:SS. */
export function optTime(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw bad('เวลาตรวจไม่ถูกต้อง');
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(v);
  if (!m) throw bad('เวลาตรวจไม่ถูกต้อง (ต้องเป็น ชม:นาที)');
  return `${m[1]}:${m[2]}:${m[3] ?? '00'}`;
}

export function str(v: unknown, label: string, max: number, opts: { required?: boolean } = {}): string {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw bad(`${label}ไม่ถูกต้อง`);
  const s = v.trim();
  if (opts.required && !s) throw bad(`กรุณากรอก${label}`);
  if (s.length > max) throw bad(`${label}ยาวเกิน ${max} ตัวอักษร`);
  return s;
}

/** Free text such as notes: keep inner newlines, trim ends, cap length. */
export function text(v: unknown, label: string, max: number): string {
  return str(v, label, max);
}

export function bool(v: unknown, label: string): boolean {
  if (typeof v !== 'boolean') throw bad(`${label}ต้องเป็น true/false`);
  return v;
}

export function employeeId(v: unknown, label = 'รหัสพนักงาน'): string {
  if (typeof v !== 'string' || !/^[A-Z0-9_-]{1,20}$/.test(v.trim().toUpperCase())) throw bad(`${label}ไม่ถูกต้อง`);
  return v.trim().toUpperCase();
}

export function optEmployeeId(v: unknown, label: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  return employeeId(v, label);
}

/** Mileage: '' / null → null, otherwise a whole number 0–9,999,999 (string or number). */
export function optMileage(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  if (!/^\d{1,7}$/.test(s)) throw bad('เลขไมล์ต้องเป็นตัวเลขจำนวนเต็ม 0–9,999,999');
  return Number(s);
}

export function plate(v: unknown): string {
  return str(v, 'ทะเบียนรถ', 20, { required: true });
}

export function optPlate(v: unknown): string | null {
  const s = str(v, 'ทะเบียนรถ', 20);
  return s || null;
}

export function obj(v: unknown, label: string): Record<string, unknown> {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw bad(`${label}ไม่ถูกต้อง`);
  return v as Record<string, unknown>;
}

/**
 * R2 keys we issue:
 *   since 2026-11-25  2026-11/2026-11-25/ผข4600/20261125-0812_ผข4600_front_a1b2c3.jpg
 *                     (month / day taken / vehicle / day-time taken (Thai) _ vehicle _ photo slot or itemNN _ random)
 *   earlier           2026-11/2026-11-16_<uuid>.jpg (still valid: photos already saved keep working)
 */
export const PHOTO_KEY_RE =
  /^\d{4}-\d{2}\/(?:\d{4}-\d{2}-\d{2}_[0-9a-f-]{36}|\d{4}-\d{2}-\d{2}\/[0-9A-Za-z฀-๿-]{1,20}\/\d{8}-\d{4}_[0-9A-Za-z฀-๿-]{1,20}_[a-z0-9]{1,20}_[0-9a-f]{6})\.(jpg|png|webp)$/;
/** the vehicle part of a photo name: the plate without spaces / dots (Thai letters, digits and "-" kept) */
export const photoPlate = (p: string) => p.replace(/[^0-9A-Za-z฀-๿-]/g, '').slice(0, 20);

export function photoKey(v: unknown): string {
  if (typeof v !== 'string' || !PHOTO_KEY_RE.test(v)) throw bad('รหัสรูปภาพไม่ถูกต้อง');
  return v;
}
