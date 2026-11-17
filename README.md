# Pre-Trip PPE Check · Piyachart 54

ระบบตรวจรถก่อนออกงาน (23 ข้อ) + ตรวจ PPE พนักงาน (4 รายการ) + รูปถ่าย 6 มุม

- **Frontend:** React 18 + Vite + TypeScript
- **Backend:** Cloudflare — D1 (ฐานข้อมูล) + R2 (รูปถ่าย) + Worker API (login ด้วย id_user + รหัสผ่าน)
- **ธีมสี:** Coca-Cola `#F40009` / `#1E1E1E`

## สถานะตอนนี้

| ส่วน | สถานะ |
|---|---|
| หน้าเว็บ | ✅ https://pretrip-ppe-check.pretrip-ppe-check.workers.dev — ใช้ข้อมูลจริง |
| D1 `pretrip-ppe` | ✅ สร้างบน Cloudflare และรัน migration แล้ว |
| R2 `pretrip-inspection-photos` | ✅ สร้างแล้ว (private) |
| Worker API (`worker/`) + `src/lib/api.cloudflare.ts` | ✅ deploy แล้ว |
| Login | ✅ id_user + รหัสผ่าน · สิทธิ์ `admin` (ทุกอย่าง) / `user` (พนักงาน) · admin เพิ่มผู้ใช้ได้ที่แท็บตั้งค่า → ผู้ใช้งานระบบ |
| ข้อมูลพนักงาน / รถ | ✅ import จากไฟล์จริงแล้ว (ประเภทรถยังว่าง) |

## หน้าเว็บ (ฐานข้อมูลและ API ชุดเดียวกัน)

| หน้า | ที่อยู่ | ใครใช้ | แท็บ |
|---|---|---|---|
| พนักงาน | `/` | เฉพาะ `user` (และหน้า login สำหรับคนที่ยังไม่เข้าระบบ) | ตรวจรถ `/vehicle` · PPE `/ppe` · Time activities `/time-activities` |
| ผู้ดูแลระบบ | `/admin/` | เฉพาะ `admin` | หน้าหลัก `/admin/home` · ภาพรวม `/admin/overview` · ข้อมูล `/admin/data` · ตั้งค่า `/admin/settings` |

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
