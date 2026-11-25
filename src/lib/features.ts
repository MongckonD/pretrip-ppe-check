/**
 * Feature switches: features still in development stay in the code but are hidden until switched on.
 *
 *   VITE_FEATURE_STORE_DELIVERY=1 → store delivery: staff "บันทึกเวลาส่งสินค้า" sub-tab (store-visit timer)
 *                                   and the admin home "ร้านค้าที่ต้องส่ง" block (delivery plan)
 *
 * Off on the live site (version 1, .env.production). On for local development:
 *   npm run dev:store  → test mode with the feature on   (.env.store)
 *   npm run dev:cf     → local Worker + local D1, feature on (.env.cloudflare)
 * To release: set the switch to 1 in .env.production, build and deploy.
 */
const on = (v: string | undefined) => v === '1' || v === 'true';

export const FEATURES = {
  storeDelivery: on(import.meta.env.VITE_FEATURE_STORE_DELIVERY),
  /** store-delivery timer (จับเวลาร้านค้า, table store_visits): on since version 1.2.0 (needs the Worker var FEATURE_STORE_TIMER too) */
  storeTimer: on(import.meta.env.VITE_FEATURE_STORE_TIMER),
} as const;

/**
 * app version shown in the menu and on the login page (from package.json), short form: 1.0.0 → "1.0", 1.0.1 → "1.0.1".
 * 2026-11-25: set back to 1.0 before real use starts (the code is not rolled back, only the number) — count up once in use.
 */
export const APP_VERSION: string = __APP_VERSION__.replace(/\.0$/, '');
