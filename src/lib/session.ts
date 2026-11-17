/**
 * Idle sign-out for both roles.
 *   - While someone is using the page (tap, type, scroll) a light keep-alive request keeps the session open.
 *   - No activity for IDLE_MINUTES (page left open, phone screen off, app in the background) → signed out.
 *   - Closing the browser ends the session too (the cookie has no expiry; see worker/auth.ts).
 * The server applies the same IDLE_MINUTES on its side, so the rule holds even if this code never runs.
 */
import { useEffect, useRef } from 'react';
import { keepAlive } from './api';

/** must match IDLE_MINUTES in worker/auth.ts */
export const IDLE_MINUTES = 30;
const IDLE_MS = IDLE_MINUTES * 60_000;
/** while active, tell the server at most this often */
const PING_MS = 2 * 60_000;
const ACTIVITY = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;

export const IDLE_NOTICE = `ไม่ได้ใช้งานเกิน ${IDLE_MINUTES} นาที ระบบออกจากระบบให้อัตโนมัติ กรุณาเข้าสู่ระบบใหม่`;
/** carries the notice to the login screen when the page changes (admin → /) */
export const NOTICE_KEY = 'pt-logout-notice';

export function useIdleSignOut(enabled: boolean, onIdle: () => void) {
  const cb = useRef(onIdle);
  cb.current = onIdle;

  useEffect(() => {
    if (!enabled) return;
    let last = Date.now();
    let lastPing = last;
    let done = false;
    const fire = () => { if (!done) { done = true; cb.current(); } };
    const idle = () => Date.now() - last > IDLE_MS;

    const onActivity = () => {
      // first touch after the phone slept too long: sign out instead of continuing
      if (idle()) { fire(); return; }
      last = Date.now();
      if (last - lastPing > PING_MS) {
        lastPing = last;
        keepAlive().catch(() => { /* a 401 here already sends the user to the login screen */ });
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') onActivity(); };
    // timers pause while the screen is off; the visibility check above covers waking up
    const timer = window.setInterval(() => { if (idle()) fire(); }, 15_000);

    for (const ev of ACTIVITY) window.addEventListener(ev, onActivity, { passive: true, capture: true });
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      for (const ev of ACTIVITY) window.removeEventListener(ev, onActivity, { capture: true });
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
}
