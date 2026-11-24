/** 1 = ผ่าน, 2 = ไม่ผ่าน, 3 = ไม่เกี่ยวข้อง */
export type VehResult = 1 | 2 | 3;
/** 1 = มี, 2 = ไม่มี */
export type PpeResult = 1 | 2;

/** id = internal key (EMP01; never shown) · code = company employee code (shown everywhere, used to sign in) */
export interface Employee { id: string; name: string; role: string; active: boolean; code?: string }
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
  /** set when an admin rejects the check (ไม่อนุมัติ) with a reason; cleared when staff re-send or an admin approves */
  rejected_at?: string | null;
  rejected_by?: string | null;
  reject_reason?: string;
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
  /** Thai HH:MM of the start / end of work (from work_started_at / work_ended_at) */
  start_time: string;
  end_time?: string | null;
  vehicle_id: string;
  plate: string;
  dman_id: string;
  vehicle_inspection_id: string | null;
  /** มีใบตรวจรถของวันเดียวกันแล้ว */
  inspected: boolean;
  area_codes: string[];
  /** work clock (UTC ISO timestamps set by the server); minutes once ended */
  work_started_at: string;
  work_ended_at?: string | null;
  work_minutes?: number | null;
}


export interface PpeForm {
  date: string;
  plate: string;
  inspector: string;
  rows: Record<string, Record<string, PpeResult>>;
}

/** which records to list: one day, one month, or a date range (from–to, inclusive) */
export interface ListOpts { date?: string; month?: string; from?: string; to?: string }

/* ---------- ร้านค้าที่ต้องส่ง (delivery plan, feature switch storeDelivery) ---------- */
export interface DeliveryBill { bill_no: string; cases: number | null }
/**
 * the delivery status of a store today (store timer, table store_visits): times are stamped by the server.
 * open = being delivered (ended_at empty) or the truck left but the finish form is not saved yet (ended_at set)
 */
export interface StoreVisitStatus {
  id: string; status: 'open' | 'done' | 'failed'; started_at: string | null; ended_at: string | null;
  cases: number | null; skus: number | null; distance_m: number | null; method: 'trolley' | 'carry' | 'both' | null;
  note: string; /** who pressed it */ by: string;
}
/** admin report "เวลาส่งสินค้าที่ร้าน": 1 row per store of the plan per day (database view v_store_visit_summary) */
export interface StoreVisitReportRow {
  plan_id: string; plan_date: string; plate: string; sort_order: number; sap_code: string; store_name: string; store_type: string;
  bills: number; plan_cases: number | null;
  status: 'done' | 'failed' | 'open' | 'none'; started_at: string | null; ended_at: string | null;
  /** time at the store (server times), delivered stores only */
  seconds: number | null;
  cases: number | null; skus: number | null; distance_m: number | null; move_method: 'trolley' | 'carry' | 'both' | null;
  note: string; by_name: string | null; dman_name: string | null;
}
/** what the finish form saves */
export interface StoreVisitSave { cases: number; skus?: number | null; distance_m?: number | null; method?: 'trolley' | 'carry' | 'both' | null }
/** one store on one day (one vehicle only); cases = the sum of its bills; visit = its status (store timer switch only) */
export interface DeliveryStop {
  id: string; plate: string; code: string; name: string; type: string; address: string;
  bills: DeliveryBill[]; cases: number | null;
  visit?: StoreVisitStatus | null;
}
/** a row of the SAP file as the browser read it; date = delivery date YYYY-MM-DD ('' = the date chosen on the page) */
export interface DeliveryRowIn { line: number; date: string; plate: string; code: string; name: string; type: string; address: string; cases: string; bill: string }
export interface DeliveryImportStop {
  date: string; lines: number[]; plate: string; code: string; name: string; type: string; address: string; bills: DeliveryBill[];
  /** append: the store is already on this vehicle that day (only new bills are added) */
  existing: boolean;
  new_store: boolean;
}
export interface DeliveryImportResult {
  stops: DeliveryImportStop[]; errors: string[]; notes: string[];
  summary: {
    stores: number; vehicles: number; bills: number; cases: number; new_stores: number; already: number;
    /** per delivery date in the file */
    dates: { date: string; stores: number; vehicles: number; bills: number; cases: number }[];
  };
}
export interface DeliveryAddIn { date: string; plate: string; code: string; name: string; type: string; cases: string; bill: string }
