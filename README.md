# Pre-Trip PPE Check · Piyachart 54

ระบบตรวจรถก่อนออกงาน (23 ข้อ) + ตรวจ PPE พนักงาน (4 รายการ) + รูปถ่ายรถ 5 มุม

- **Frontend:** React 18 + Vite + TypeScript
- **Backend:** Cloudflare — D1 (ฐานข้อมูล) + R2 (รูปถ่าย) + Worker API (login ด้วย id_user + รหัสผ่าน)
- **ธีมสี:** Coca-Cola `#F40009` / `#1E1E1E`

## สถานะตอนนี้

| ส่วน | สถานะ |
|---|---|
| หน้าเว็บ | ✅ https://dtrip.heyrockydev.com — ใช้ข้อมูลจริง (ลิงก์เดิม workers.dev ปิดแล้ว) |
| D1 `pretrip-ppe` | ✅ สร้างบน Cloudflare และรัน migration แล้ว |
| R2 `pretrip-inspection-photos` | ✅ สร้างแล้ว (private) — รูปตรวจรถ |
| R2 `pretrip-driver-licenses` | ✅ สร้างแล้ว (private) — รูปใบขับขี่โดยเฉพาะ |
| Worker API (`worker/`) + `src/lib/api.cloudflare.ts` | ✅ deploy แล้ว |
| Login | ✅ id_user + รหัสผ่าน · ไม่ได้ใช้งาน 30 นาที หรือปิดเบราว์เซอร์ = ออกจากระบบอัตโนมัติ (ทั้ง 2 role · `IDLE_MINUTES` ใน worker/auth.ts + src/lib/session.ts) · สิทธิ์ `admin` (ทุกอย่าง) / `user` (พนักงาน) · admin เพิ่มผู้ใช้ได้ที่แท็บตั้งค่า → ผู้ใช้งานระบบ |
| ข้อมูลพนักงาน / รถ | ✅ import จากไฟล์จริงแล้ว (ประเภทรถยังว่าง) |

## หน้าเว็บ (ฐานข้อมูลและ API ชุดเดียวกัน)

| หน้า | ที่อยู่ | ใครใช้ | แท็บ |
|---|---|---|---|
| พนักงาน | `/` | เฉพาะ `user` (และหน้า login สำหรับคนที่ยังไม่เข้าระบบ) | ตรวจรถ `/vehicle` · PPE `/ppe` · Time activities `/time-activities` |
| ผู้ดูแลระบบ | `/admin/` | เฉพาะ `admin` | หน้าหลัก `/admin/home` · ภาพรวม `/admin/overview` · ข้อมูล `/admin/data` · ใบขับขี่ `/admin/licenses` · ตั้งค่า `/admin/settings` |

- หน้าพนักงานมีแท็บ **ใบขับขี่** `/license` ด้วย
- ทุกแท็บมี path ของตัวเอง: แชร์ลิงก์ / refresh / ปุ่มย้อนกลับของเบราว์เซอร์ได้ · path ที่ไม่รู้จักจะเปิดแท็บแรกของหน้านั้น

- **แต่ละ role เข้าได้หน้าเดียว** ไม่มีปุ่มสลับหน้า: login ที่ `/` แล้ว admin ไป `/admin/`, user อยู่ `/`
- Worker เลือกหน้าให้ตาม session ทุกครั้ง (`run_worker_first = true`): admin เปิดหน้าอื่นถูกพากลับ `/admin/` ส่วน user / คนที่ยังไม่ login เปิด `/admin` (ทุกรูปแบบ เช่น `/ADMIN`, `/%61dmin`, `/admin/index.html`) ถูกพากลับ `/`
- API แยกสิทธิ์เหมือนกัน: บันทึก/ลบ ตรวจรถ · PPE · Time activities · อัปโหลดรูป = `user` เท่านั้น · จัดการผู้ใช้ / ข้อมูลหลัก / อนุมัติ = `admin` เท่านั้น
- โหมดทดสอบ (`npm run dev`) ไม่มี login จึงเปิดได้ทั้ง `/` และ `/admin/` (ใช้ในเครื่องเท่านั้น)
- โค้ด: `src/App.tsx` (พนักงาน), `src/admin/` (ผู้ดูแล), `src/components/AppShell.tsx` + `AuthGate.tsx` ใช้ร่วมกัน · Vite build 2 หน้า (`index.html`, `admin/index.html`)

ขั้นตอน deploy และรายละเอียด API อยู่ใน [`cloudflare/README.md`](cloudflare/README.md) หัวข้อ 5–6

## รันหน้าเว็บ (โหมดทดสอบ)

```bash
npm install
npm run dev               # http://localhost:5173
```
- มุมขวาบนจะขึ้นป้าย **โหมดทดสอบ** และไม่มีหน้า login
- ข้อมูลเก็บในเบราว์เซอร์ (localStorage + รูปใน IndexedDB) มีข้อมูลตัวอย่างของเดือนนี้ให้ดูกราฟได้ทันที
- แท็บ **ตั้งค่า** มีปุ่ม "สร้างข้อมูลตัวอย่างใหม่" และ "ล้างบันทึกการตรวจทั้งหมด"
- ชั้นข้อมูลอยู่ที่ `src/lib/api.ts`: `VITE_BACKEND=cloudflare` (ตั้งใน `.env.production`) → `api.cloudflare.ts`, อย่างอื่น → `api.mock.ts`
- ทดสอบกับ API จริงในเครื่อง: `npm run dev:api` + `npm run dev:cf` (ดู cloudflare/README.md หัวข้อ 6)

## ความยินยอม + ใบขับขี่ (พนักงาน role `user`)

1. login แล้วต้องกด **ยอมรับความยินยอมในการใช้ข้อมูลส่วนบุคคล** ก่อน (ข้อความอยู่ที่ `src/lib/consent.ts`)
   - Worker บล็อก API ทุกตัวของ user ที่ยังไม่ยอมรับ (ยกเว้น /api/me, เปลี่ยนรหัสผ่าน, /api/consent)
   - แก้ข้อความเมื่อไร ให้เปลี่ยน `version` ใน `src/lib/consent.ts` และ `CONSENT_VERSION` ใน `worker/auth.ts` ให้ตรงกัน → ทุกคนต้องกดยอมรับใหม่
2. **ถ่ายรูปใบขับขี่** (ใช้กล้องเท่านั้น ไม่มีเลือกรูปจากเครื่อง) · ตอนนี้มีปุ่ม **ข้ามไปหน้าหลัก** (แถบเตือนจะขึ้นจนกว่าจะส่ง) — จะบังคับถ่ายก่อนใช้งาน ให้ตั้ง `LICENSE_REQUIRED` (src/lib/license.ts) และ `REQUIRE_LICENSE` (worker/index.ts) เป็น true — อ่าน ชื่อ-นามสกุล / เลขที่ / วันหมดอายุ อัตโนมัติด้วย OCR (Tesseract.js ไทย+อังกฤษ ทำงานในเครื่องผู้ใช้) ให้ผู้ใช้ตรวจ/แก้ แล้วกด "บันทึกและไปหน้าหลัก"
   - เมื่อเปิดบังคับ Worker จะบล็อก API ของ user ที่ยังไม่มีใบขับขี่ด้วย (ยกเว้น /api/me, เปลี่ยนรหัสผ่าน, ความยินยอม, ส่ง/ดูใบขับขี่ของตัวเอง)
3. **แจ้งเตือน** บนทุกหน้าเมื่อยังไม่ส่ง / เหลือ ≤ 60 วัน / หมดอายุแล้ว · admin ดูใบขับขี่ที่พนักงานส่งแล้วได้ที่แท็บ **ใบขับขี่** `/admin/licenses` (เฉพาะที่ส่งแล้ว)

- ตาราง: `user_consents`, `driver_licenses` (migration 0006 · 0007 ลบ view/index ที่ไม่ได้ใช้) · รูปเก็บใน R2 bucket แยก `pretrip-driver-licenses` (binding `LICENSES`) key `licenses/<user>/<uuid>.jpg` — D1 เก็บแค่ key (ส่งใบใหม่ → ลบรูปเก่า)
- ปรับจำนวนวันแจ้งเตือน: `LICENSE_WARN_DAYS` ใน `worker/license-routes.ts` และ `src/lib/license.ts`

## ฐานข้อมูล (Cloudflare D1 + R2)

รายละเอียดทั้งหมดอยู่ใน [`cloudflare/README.md`](cloudflare/README.md): ER diagram, พจนานุกรมข้อมูล, การจับคู่กับไฟล์ Excel,
view สำหรับรายงาน, ตัวอย่างโค้ด Worker และข้อจำกัดของ D1

- migration: `cloudflare/migrations/` (schema → views → seed)
- config: `wrangler.toml` (binding `DB` = D1, `PHOTOS` = R2)

```bash
npx wrangler d1 migrations apply pretrip-ppe --local    # ทดสอบในเครื่อง
```
```bash
npx wrangler d1 migrations apply pretrip-ppe --remote   # ขึ้น Cloudflare จริง
```

## โครงสร้างโค้ด
```
worker/       Cloudflare Worker API (index, auth, routes, validate)
src/
  lib/        api (ตัวสลับ), api.cloudflare (API จริง), api.mock (โหมดทดสอบ), types, utils, seed, image
  components/ Toast, MasterContext, Fields (Seg, selects), Charts (SVG)
  pages/      VehiclePage, PpePage, DashboardPage, DataPage, SettingsPage
cloudflare/
  migrations/ SQL schema + views + seed สำหรับ D1
  README.md   เอกสารออกแบบฐานข้อมูล
wrangler.toml
```
