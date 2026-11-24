/**
 * Admin home ("หน้าหลัก"):
 *   1. ร้านค้าที่ต้องส่ง — the delivery plan of the day (import / add / remove, components DeliveryPlan)
 *   2. เวลาส่งสินค้าที่ร้าน — the store timer report like the Summary page: date range, cards, table (StoreTimes, view v_store_visit_summary)
 * The vehicle / PPE progress of the day lives on its own tabs (สถานะรถ, PPE, สรุป).
 * Today's view refreshes itself every 2 minutes (only while the page is open on today).
 */
import { Suspense, lazy, useEffect, useState } from 'react';
import { FEATURES } from '../lib/features';
import { today } from '../lib/utils';

// feature-switched parts: loaded only when their switch is on
const DeliveryPlan = lazy(() => import('./DeliveryPlan').then((m) => ({ default: m.DeliveryPlan })));
const StoreTimes = lazy(() => import('./StoreTimes').then((m) => ({ default: m.StoreTimes })));

const thDay = (d: string) => new Date(`${d}T00:00`).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const hhmm = (d: Date) => d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

export function AdminHomePage(_props: { go: (tab: string) => void }) {
  const [date, setDate] = useState(today());
  // bumping it reloads the store times (refresh button / every 2 minutes on today)
  const [refreshKey, setRefreshKey] = useState(0);
  const [updated, setUpdated] = useState(new Date());
  const refresh = () => { setRefreshKey((k) => k + 1); setUpdated(new Date()); };
  useEffect(() => setUpdated(new Date()), [date]);
  useEffect(() => {
    if (date !== today()) return;
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 120_000);
    return () => window.clearInterval(t);
  }, [date]);

  return (
    <div className="home">
      <section className="panel home-head">
        <div>
          <h2 className="flush">{date === today() ? 'วันนี้' : 'ย้อนหลัง'} · {thDay(date)}</h2>
          <span className="note">อัปเดตล่าสุด {hhmm(updated)} น.{date === today() && ' · รีเฟรชเองทุก 2 นาที'}</span>
        </div>
        <div className="row">
          <input type="date" aria-label="วันที่" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} />
          <button className="btn ghost sm" onClick={refresh}>รีเฟรช</button>
        </div>
      </section>

      {/* 1. stores each vehicle must deliver to */}
      {FEATURES.storeDelivery && <Suspense fallback={null}><DeliveryPlan date={date} /></Suspense>}
      {/* 2. time at each store (store timer) */}
      {FEATURES.storeDelivery && FEATURES.storeTimer && (
        <Suspense fallback={<div className="empty">กำลังโหลด…</div>}><StoreTimes refreshKey={refreshKey} /></Suspense>
      )}
    </div>
  );
}
