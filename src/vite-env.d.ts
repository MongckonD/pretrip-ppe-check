/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'cloudflare' = ใช้ Worker API จริง, อย่างอื่น = โหมดทดสอบ */
  readonly VITE_BACKEND?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
