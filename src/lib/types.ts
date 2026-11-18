/** 1 = ผ่าน, 2 = ไม่ผ่าน, 3 = ไม่เกี่ยวข้อง */
export type VehResult = 1 | 2 | 3;
/** 1 = มี, 2 = ไม่มี */
export type PpeResult = 1 | 2;

export interface Employee { id: string; name: string; role: string; active: boolean }
export interface Vehicle { id: string; plate: string; type: string; active: boolean }
export interface CheckItem { item_no: number; name: string; hint: string; active: boolean }
export interface PpeItem { code: string; name: string; sort_order: number; active: boolean }
export interface PhotoSlot { code: string; name: string; sort_order: number }
/** ประเภทพื้นที่ (ตาราง area_types) */
export interface AreaType { code: string; name: string; description: string; sort_order: number; active: boolean }

export interface Master {
  employees: Employee[];
  vehicles: Vehicle[];
  checkItems: CheckItem[];
  ppeItems: PpeItem[];
  photoSlots: PhotoSlot[];
  /** ตำแหน่งที่เลือกได้ (ตาราง employee_roles) */
  roles: string[];
  /** ประเภทพื้นที่สำหรับ Time activities */
  areaTypes: AreaType[];
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
  /** failed items: note (required) + photo (optional), keyed by item_no */
  defects?: Record<string, Defect>;
  pass_count: number;
  fail_count: number;
  na_count: number;
  filled_count: number;
  photo_count: number;
  overall_result: 1 | 2 | null;
  photo_status: 0 | 1 | 2;
  /** set when an admin approves the check (null = waiting for approval) */
  approved_at?: string | null;
  approved_by?: string | null;
  /** who saved it and when (real backend only) */
  created_by?: string | null;
  updated_at?: string;
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
  /** note + photo for items marked ไม่ผ่าน (2) */
  defects: Record<number, Defect>;
}

/** A failed check item's note and (optional) photo — stored in vehicle_inspection_results.remark / photo_r2_key */
export interface Defect { note: string; photo: string | null }

/** Row of v_trip_activity_summary (1 vehicle / 1 day) */
export interface TripActivity {
  id: string;
  activity_date: string;
  month: string;
  depart_time: string;
  vehicle_id: string;
  plate: string;
  dman_id: string;
  vehicle_inspection_id: string | null;
  /** มีใบตรวจรถของวันเดียวกันแล้ว */
  inspected: boolean;
  area_codes: string[];
  area_names: string;
  area_count: number;
  note: string;
  /** work clock (UTC ISO timestamps set by the server); minutes once ended */
  work_started_at?: string | null;
  work_ended_at?: string | null;
  work_minutes?: number | null;
}

export interface TripForm {
  id: string | null;
  date: string;
  time: string;
  plate: string;
  dman: string;
  areas: string[];
  note: string;
}

export interface PpeForm {
  date: string;
  plate: string;
  inspector: string;
  rows: Record<string, Record<string, PpeResult>>;
}
