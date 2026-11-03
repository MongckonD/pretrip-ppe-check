/** 1 = ผ่าน, 2 = ไม่ผ่าน, 3 = ไม่เกี่ยวข้อง */
export type VehResult = 1 | 2 | 3;
/** 1 = มี, 2 = ไม่มี */
export type PpeResult = 1 | 2;

export interface Employee { id: string; name: string; role: string; active: boolean }
export interface Vehicle { id: string; plate: string; type: string; active: boolean }
export interface CheckItem { item_no: number; name: string; hint: string; active: boolean }
export interface PpeItem { code: string; name: string; sort_order: number; active: boolean }
export interface PhotoSlot { code: string; name: string; sort_order: number }

export interface Master {
  employees: Employee[];
  vehicles: Vehicle[];
  checkItems: CheckItem[];
  ppeItems: PpeItem[];
  photoSlots: PhotoSlot[];
}

/** Row of v_vehicle_inspection_summary */
export interface VehicleInspection {
  id: string;
  inspect_date: string;
  inspect_time: string | null;
  dman_id: string;
  helper1_id: string | null;
  helper2_id: string | null;
  plate: string;
  mileage: number | null;
  note: string;
  month: string;
  results: Record<string, VehResult>;
  photos: Record<string, string>;
  pass_count: number;
  fail_count: number;
  na_count: number;
  filled_count: number;
  photo_count: number;
  overall_result: 1 | 2 | null;
  photo_status: 0 | 1 | 2;
}

/** Row of v_ppe_inspection_summary */
export interface PpeInspection {
  id: string;
  inspect_date: string;
  employee_id: string;
  inspector_id: string;
  plate: string;
  month: string;
  results: Record<string, PpeResult>;
  have_count: number;
  missing_count: number;
  filled_count: number;
  status: 'ครบ' | 'ไม่ครบ' | 'อุปกรณ์ไม่ครบ';
}

/** Row of v_daily_vehicle_status — every active vehicle per day, checked or not */
export interface DailyVehicleStatus {
  day: string;
  plate: string;
  registered: boolean;
  inspection_id: string | null;
  inspect_time: string | null;
  dman_id: string | null;
  filled_count: number;
  fail_count: number;
  photo_count: number;
  photo_status: 0 | 1 | 2;
  fail_items: number[];
  /** 0 = ยังไม่ตรวจ, 1 = ผ่าน, 2 = ไม่ผ่าน */
  status: 0 | 1 | 2;
}

/** Row of v_daily_ppe_status — every active employee per day, checked or not */
export interface DailyPpeStatus {
  day: string;
  employee_id: string;
  ppe_inspection_id: string | null;
  inspector_id: string | null;
  plate: string | null;
  missing_count: number;
  missing_items: string[];
  status: 'ยังไม่ตรวจ' | PpeInspection['status'];
}

/** Row of v_daily_summary */
export interface DailySummary {
  day: string;
  vehicles_total: number;
  vehicles_checked: number;
  vehicles_failed: number;
  vehicles_photo_complete: number;
  ppe_total: number;
  ppe_checked: number;
  ppe_complete: number;
}

export interface VehicleForm {
  id: string | null;
  date: string;
  time: string;
  dman: string;
  h1: string;
  h2: string;
  plate: string;
  mileage: string;
  note: string;
  results: Record<number, VehResult>;
  photos: Record<string, string>;
}

export interface PpeForm {
  date: string;
  plate: string;
  inspector: string;
  rows: Record<string, Record<string, PpeResult>>;
}
