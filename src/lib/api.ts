/**
 * Data layer switch (เลือกตอน build ด้วยตัวแปร VITE_BACKEND)
 * - VITE_BACKEND=cloudflare → Worker API + D1 + R2 (api.cloudflare.ts) — ใช้ตอน deploy (ดู .env.production)
 * - อื่น ๆ / ไม่ตั้ง        → โหมดทดสอบ เก็บข้อมูลในเบราว์เซอร์ (api.mock.ts) — ค่าเริ่มต้นของ npm run dev
 * ทั้งสองไฟล์มีฟังก์ชันชุดเดียวกัน หน้าจอจึงไม่ต้องรู้ว่าใช้แบบไหน
 */
import * as cloud from './api.cloudflare';
import * as mock from './api.mock';

export const isTestMode = import.meta.env.VITE_BACKEND !== 'cloudflare';

const api = isTestMode ? mock : cloud;

export const {
  loadMaster, upsertEmployee, deleteEmployee, upsertVehicle, deleteVehicle,
  listVehicleInspections, saveVehicleInspection, deleteVehicleInspection, setVehicleApproval, setVehicleRejection,
  uploadPhoto, removePhotos, signedUrls,
  listPpeInspections, savePpeInspections, deletePpeInspection,
  listTripActivities, deleteTripActivity, startWork, endWork,
  getMyLicense, saveMyLicense, listLicenses, licensePhotoUrl,
} = api;

export const resetDemo = mock.resetDemo;

// login & user administration exist only with the real backend
export const {
  authStatus, login, setupAdmin, logout, changePassword,
  listUsers, createUser, updateUser, deleteUser, resetUserPassword, UNAUTHORIZED_EVENT, acceptConsent, keepAlive, importEmployees, importVehicles,
} = cloud;
export type { AppUser, ImportResult, ImportRowIn, ImportRowOut, Me, Role, VehImportIn, VehImportOut, VehImportResult } from './api.cloudflare';
