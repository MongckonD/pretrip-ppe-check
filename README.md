# Pre-Trip PPE Check · Piyachart 54

ระบบตรวจรถก่อนออกงาน (23 ข้อ) + ตรวจ PPE พนักงาน (4 รายการ) + รูปถ่าย 6 มุม

- **Frontend:** React 18 + Vite + TypeScript
- **Backend:** Supabase (PostgreSQL + Auth + Storage)
- **ธีมสี:** Coca-Cola `#F40009` / `#1E1E1E`

## ทดสอบหน้าบ้านอย่างเดียว (โหมดทดสอบ — ค่าเริ่มต้น)

ไม่ต้องมี Supabase / ไม่ต้องสร้าง `.env`
```bash
npm install
npm run dev               # http://localhost:5173
```
- ไม่มีหน้า login มุมขวาบนจะขึ้นป้าย **โหมดทดสอบ**
- ข้อมูลเก็บในเบราว์เซอร์ (localStorage + รูปใน IndexedDB) มีข้อมูลตัวอย่างของเดือนนี้ให้ดูกราฟได้ทันที
- แท็บ **ตั้งค่า** มีปุ่ม "สร้างข้อมูลตัวอย่างใหม่" และ "ล้างบันทึกการตรวจทั้งหมด"
- ตัวสลับอยู่ที่ `src/lib/api.ts`: ไม่มี `.env` → `api.mock.ts`, มี `.env` → `api.supabase.ts`

## เปิดใช้ backend จริง (ภายหลัง)

### 1. สร้างโปรเจกต์ Supabase
> ทางเลือก: รัน Supabase ในเครื่องด้วย Docker Desktop — `npx supabase init` แล้ว `npx supabase start`
> ระบบจะรัน migration ในโฟลเดอร์ `supabase/migrations` ให้เอง และพิมพ์ URL / anon key ออกมา
1. สร้างโปรเจกต์ที่ <https://supabase.com/dashboard>
2. เปิด **SQL Editor** → รันไฟล์ใน `supabase/migrations/` **ตามลำดับชื่อไฟล์**:
   `20261103000000_init.sql` (ตาราง) แล้ว `20261103010000_daily_views.sql` (view รายวัน)
   (หรือใช้ Supabase CLI: `supabase link` แล้ว `supabase db push`)
3. **Authentication → Users → Add user** สร้างบัญชีให้ทีม (อีเมล + รหัสผ่าน)
4. **Project Settings → API** คัดลอก `Project URL` และ `anon public key`

### 2. ตั้งค่าและรัน frontend
```bash
cp .env.example .env      # แล้วใส่ค่า URL / anon key
npm install
npm run dev               # http://localhost:5173
```
Build สำหรับ deploy: `npm run build` → โฟลเดอร์ `dist/` (ใช้กับ Vercel / Netlify / Cloudflare Pages ได้)

## โครงสร้างฐานข้อมูล

```
employees ─┬──< vehicle_inspections >──┬──< vehicle_inspection_results >── check_items
           │   (1 คัน / 1 วัน)          └──< vehicle_inspection_photos  >── photo_slots
           │                                         └─ storage: inspection-photos/
           └──< ppe_inspections ──< ppe_inspection_results >── ppe_items
               (1 คน / 1 วัน)
vehicles  (ทะเบียนรถ master)
```

| ตาราง | หน้าที่ | คีย์สำคัญ |
|---|---|---|
| `employees` | พนักงาน (EMP01…) | `id` text, `active` ใช้แทนการลบ |
| `vehicles` | ทะเบียนรถ + ประเภท | `plate` unique |
| `check_items` | รายการตรวจรถ 23 ข้อ | `item_no` 1–23 |
| `ppe_items` | รายการ PPE 4 อย่าง | `code` shoes/vest/gloves/mask |
| `photo_slots` | ช่องรูป 6 ช่อง | `code` front/side/back/dash/cargo/ppe |
| `vehicle_inspections` | หัวเอกสารตรวจรถ | unique (`inspect_date`, `plate`) |
| `vehicle_inspection_results` | ผลรายข้อ | `result` 1=ผ่าน 2=ไม่ผ่าน 3=N/A |
| `vehicle_inspection_photos` | path รูปใน Storage | pk (`inspection_id`, `slot`) |
| `ppe_inspections` | หัวเอกสาร PPE | unique (`inspect_date`, `employee_id`) |
| `ppe_inspection_results` | ผล PPE รายชิ้น | `result` 1=มี 2=ไม่มี |

**Views สำหรับรายงาน** (แถวเดียวต่อการตรวจ เหมือนชีต Admin BI):
`v_vehicle_inspection_summary`, `v_ppe_inspection_summary` — ใช้ต่อกับ Power BI / Looker Studio ได้ผ่าน Postgres connection

**Views รายวัน** (แท็บ "รายวัน" ใช้ชุดนี้ — รวมรถ/คนที่ **ยังไม่ได้ตรวจ** ด้วย):
| View | 1 แถว = | ใช้ดู |
|---|---|---|
| `v_daily_vehicle_status` | รถ 1 คัน / 1 วัน | สถานะ 0 ยังไม่ตรวจ · 1 ผ่าน · 2 ไม่ผ่าน, ข้อที่ไม่ผ่าน, สถานะรูป |
| `v_daily_ppe_status` | พนักงาน 1 คน / 1 วัน | ยังไม่ตรวจ · ครบ · ไม่ครบ · อุปกรณ์ไม่ครบ, อุปกรณ์ที่ขาด |
| `v_daily_summary` | 1 วัน | จำนวนรถตรวจแล้ว/ทั้งหมด, ไม่ผ่าน, รูปครบ, PPE ตรวจแล้ว/ครบ |

"ที่ต้องตรวจ" = รถ/พนักงานที่ active + รายการที่มีบันทึกจริงในวันนั้น · ช่วงวัน = วันแรกที่มีบันทึก ถึงวันนี้

**Functions:** `save_vehicle_inspection(...)`, `save_ppe_inspections(...)` บันทึกหัว + รายละเอียดใน transaction เดียว

**ความปลอดภัย:** เปิด RLS ทุกตาราง — อ่าน/เขียนได้เฉพาะผู้ใช้ที่ login แล้ว, bucket รูปเป็น private ใช้ signed URL

## โครงสร้างโค้ด
```
src/
  lib/        supabase client, api (query/RPC/storage), types, utils
  components/ Toast, MasterContext, Fields (Seg, selects), Charts (SVG), Login
  pages/      VehiclePage, PpePage, DashboardPage, DataPage, SettingsPage
supabase/migrations/  SQL schema + seed
```
