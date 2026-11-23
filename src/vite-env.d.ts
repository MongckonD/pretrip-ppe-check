/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'cloudflare' = ใช้ Worker API จริง, อย่างอื่น = โหมดทดสอบ */
  readonly VITE_BACKEND?: string;
  /** '1' = แสดงฟีเจอร์ร้านค้า/ส่งสินค้า (ยังพัฒนาอยู่) — ดู src/lib/features.ts */
  readonly VITE_FEATURE_STORE_DELIVERY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
/** package.json version, injected by vite.config.ts */
declare const __APP_VERSION__: string;
