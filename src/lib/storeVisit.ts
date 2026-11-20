/**
 * Store-visit timing (Time & Motion study) — separate from the day's work clock.
 * One visit = one store: starts when the truck parks in front of the store (A01),
 * ends when it leaves (D05). In between the team taps through activity codes; each tap
 * closes the previous activity and opens the next, so every second belongs to one code.
 *
 * DESIGN PROTOTYPE: data is kept in this browser only (test mode). The database tables
 * come after the design is agreed (see docs/store-visit-design.md).
 */

export type StoreType = 'wholesale' | 'general' | 'restaurant' | 'hotel';
export const STORE_TYPES: { code: StoreType; name: string; en: string }[] = [
  { code: 'wholesale', name: 'ร้านขายส่ง', en: 'Wholesale' },
  { code: 'general', name: 'ร้านเบ็ดเตล็ด', en: 'General Trade' },
  { code: 'restaurant', name: 'ร้านอาหาร', en: 'Restaurant' },
  { code: 'hotel', name: 'โรงแรม', en: 'Hotel' },
];
export const storeTypeName = (t: StoreType) => STORE_TYPES.find((s) => s.code === t)?.name ?? t;

export type Phase = 'A' | 'B' | 'C' | 'D';
export const PHASES: { code: Phase; name: string; en: string }[] = [
  { code: 'A', name: 'นอกร้าน', en: 'Outside Store' },
  { code: 'B', name: 'เคลื่อนย้าย', en: 'Movement' },
  { code: 'C', name: 'ในร้าน', en: 'Inside Store' },
  { code: 'D', name: 'ปิดงาน', en: 'Close Out' },
];

export interface Activity { code: string; name: string }
/** the standard order of a delivery; "ถัดไป" follows this list */
export const ACTIVITIES: Activity[] = [
  { code: 'A01', name: 'จอดรถในจุดปลอดภัย / ดับเครื่อง' },
  { code: 'A02', name: 'วางกรวย / อุปกรณ์เตือน' },
  { code: 'A03', name: 'เปิดรถ / เตรียมรถเข็น' },
  { code: 'A04', name: 'คัดแยกและจัดสินค้าตามบิล' },
  { code: 'A05', name: 'ยกสินค้าลงจากรถ' },
  { code: 'A06', name: 'จัดสินค้าใส่รถเข็น / เตรียมขนย้าย' },
  { code: 'B01', name: 'เดินตัวเปล่าจากรถไปจุดรับสินค้า' },
  { code: 'B02', name: 'เดินยกสินค้า' },
  { code: 'B03', name: 'เข็นสินค้าด้วยรถเข็น' },
  { code: 'B04', name: 'เดินตัวเปล่ากลับรถ' },
  { code: 'C01', name: 'Check-in พบผู้รับสินค้า / ยืนยันจุดส่ง' },
  { code: 'C02', name: 'ตรวจนับและส่งมอบสินค้าตามบิล' },
  { code: 'C03', name: 'นำสินค้าเข้าจุดเก็บ / จัดเรียง' },
  { code: 'C04', name: 'หมุนเวียนสต็อกสินค้า (FIFO)' },
  { code: 'C05', name: 'จัดแช่สินค้าในตู้เย็น' },
  { code: 'C06', name: 'จัดเรียง / กองโชว์ / ชั้นโชว์' },
  { code: 'C07', name: 'ดูแล POSM และความเรียบร้อย' },
  { code: 'C08', name: 'ตรวจนับและรับคืนภาชนะเปล่า' },
  { code: 'C09', name: 'ตรวจเอกสาร / รับชำระเงิน' },
  { code: 'C10', name: 'ยืนยันส่งมอบ / กล่าวลาร้านค้า' },
  { code: 'D01', name: 'เก็บภาชนะเปล่าและสินค้าคืนขึ้นรถ' },
  { code: 'D02', name: 'เก็บรถเข็นและอุปกรณ์' },
  { code: 'D03', name: 'ปิดประตูรถและตรวจความเรียบร้อย' },
  { code: 'D04', name: 'เก็บกรวย / อุปกรณ์เตือน' },
  { code: 'D05', name: 'รถเคลื่อนออกจากร้าน (Check-out)' },
];
export const END_CODE = 'D05';
export const activityName = (code: string) => ACTIVITIES.find((a) => a.code === code)?.name ?? code;
export const phaseOf = (code: string) => code[0] as Phase;

export interface Store {
  id: string; name: string; type: StoreType;
  /** optional details shown when picking the store */
  address?: string;
  contact?: string;
  phone?: string;
  /** where to unload / receive, things to watch out for */
  note?: string;
}
export type MoveMethod = 'carry' | 'trolley' | 'both';
export const MOVE_METHODS: { code: MoveMethod; name: string }[] = [
  { code: 'trolley', name: 'รถเข็น' },
  { code: 'carry', name: 'ยก / แบก' },
  { code: 'both', name: 'ทั้งสองแบบ' },
];

/** one timed activity; `end` is empty while it is running */
export interface Segment { code: string; start: string; end?: string }

export interface StoreVisit {
  id: string;
  date: string;
  plate: string;
  storeId: string;
  storeName: string;
  storeType: StoreType;
  /** truck parked (A01 start) / truck left (D05 pressed) */
  startedAt: string;
  endedAt?: string;
  segments: Segment[];
  /**
   * travel time from the previous store of the day: its D05 (truck left) → this store's start (truck parked).
   * Empty for the first store of the day.
   */
  travelFrom?: { visitId: string; storeName: string; seconds: number };
  /** filled in when the visit ends */
  cases?: number;
  skus?: number;
  distanceM?: number;
  method?: MoveMethod;
}

const ms = (iso: string) => Date.parse(iso);
export const segSeconds = (s: Segment, now = Date.now()) => Math.max(0, Math.round(((s.end ? ms(s.end) : now) - ms(s.start)) / 1000));

/** seconds spent per phase (A/B/C/D) */
export function phaseSeconds(v: StoreVisit, now = Date.now()): Record<Phase, number> {
  const out: Record<Phase, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const s of v.segments) out[phaseOf(s.code)] += segSeconds(s, now);
  return out;
}
export const visitSeconds = (v: StoreVisit, now = Date.now()) =>
  Math.max(0, Math.round(((v.endedAt ? ms(v.endedAt) : now) - ms(v.startedAt)) / 1000));

/** seconds per activity code (an activity can be done more than once, e.g. B02 several trips) */
export function codeSeconds(v: StoreVisit, now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of v.segments) out[s.code] = (out[s.code] ?? 0) + segSeconds(s, now);
  return out;
}

/** the next code in the standard order after `code` */
export function nextCode(code: string): string | null {
  const i = ACTIVITIES.findIndex((a) => a.code === code);
  return i >= 0 && i < ACTIVITIES.length - 1 ? ACTIVITIES[i + 1].code : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** 125 → "2:05" · 3725 → "1:02:05" */
export function clock(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
/** 1830 → "30.5" (minutes, 1 decimal) */
export const minutes1 = (sec: number) => (sec / 60).toFixed(1);
/** UTC ISO → Thai HH:MM */
export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
