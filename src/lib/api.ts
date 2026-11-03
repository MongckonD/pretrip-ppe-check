/**
 * Data layer switch.
 * - มี .env (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY) → ใช้ Supabase จริง (api.supabase.ts)
 * - ไม่มี .env → โหมดทดสอบ เก็บข้อมูลในเบราว์เซอร์ (api.mock.ts)
 * ทั้งสองไฟล์มีฟังก์ชันชุดเดียวกัน หน้าจอจึงไม่ต้องรู้ว่าใช้แบบไหน
 */
import { isConfigured } from './supabase';
import * as remote from './api.supabase';
import * as mock from './api.mock';

export const isTestMode = !isConfigured;

const api: typeof remote = isConfigured ? remote : mock;

export const {
  loadMaster, upsertEmployee, upsertVehicle, deleteVehicle,
  listVehicleInspections, saveVehicleInspection, deleteVehicleInspection,
  uploadPhoto, removePhotos, signedUrls,
  listPpeInspections, savePpeInspections, deletePpeInspection,
} = api;

export const resetDemo = mock.resetDemo;
