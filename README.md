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
