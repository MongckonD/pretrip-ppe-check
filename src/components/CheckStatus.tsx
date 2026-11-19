/**
 * Approval status of my team's vehicle check today, shown next to the "ตรวจรถ" tab:
 *   ไม่อนุมัติ (rejected, fix and re-send) · รออนุมัติ (waiting for an admin) · อนุมัติแล้ว (all approved)
 *   — nothing when there is no check yet.
 * Computed from vehicle_inspections.approved_at; nothing about the badge is stored.
 * "My team" = the same rule as the PPE / Time tabs (saved by me, or my employee ID is on the crew).
 * Refreshes every minute, when the page comes back into view, and right after a check is saved.
 */
import { useCallback, useEffect, useState } from 'react';
import { listVehicleInspections, type Me } from '../lib/api';
import type { VehicleInspection } from '../lib/types';
import { today } from '../lib/utils';
import { isMyCheck } from './TodayChecks';

/** fired by the vehicle tab after a check is saved or deleted */
export const VEHICLE_CHECK_CHANGED = 'vehicle-check-changed';
export const notifyVehicleCheckChanged = () => window.dispatchEvent(new Event(VEHICLE_CHECK_CHANGED));

export type CheckTone = 'wait' | 'ok' | 'bad';
export interface CheckBadge { tone: CheckTone; text: string; title: string }

/** no check today → no badge at all */
export function checkBadge(mine: VehicleInspection[]): CheckBadge | undefined {
  if (!mine.length) return undefined;
  const rejected = mine.filter((c) => c.rejected_at);
  if (rejected.length) {
    return {
      tone: 'bad', text: mine.length > 1 ? `ไม่อนุมัติ ${rejected.length}/${mine.length}` : 'ไม่อนุมัติ',
      title: 'หัวหน้าไม่อนุมัติ — เปิดแท็บตรวจรถเพื่อดูเหตุผลและแก้ไข',
    };
  }
  const ok = mine.filter((c) => c.approved_at).length;
  if (ok === mine.length) {
    return { tone: 'ok', text: 'อนุมัติแล้ว', title: mine.length > 1 ? `อนุมัติแล้วครบ ${ok} คัน` : 'หัวหน้าอนุมัติการตรวจรถแล้ว' };
  }
  return {
    tone: 'wait',
    text: mine.length > 1 ? `รออนุมัติ ${mine.length - ok}/${mine.length}` : 'รออนุมัติ',
    title: 'ส่งการตรวจรถแล้ว รอหัวหน้าตรวจสอบและอนุมัติ',
  };
}

export function useMyCheckBadge(me: Me | null): CheckBadge | undefined {
  const [badge, setBadge] = useState<CheckBadge>();
  const load = useCallback(async () => {
    try {
      const list = await listVehicleInspections({ date: today() });
      setBadge(checkBadge(list.filter((c) => isMyCheck(me, c))));
    } catch { /* keep the last known status */ }
  }, [me]);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener(VEHICLE_CHECK_CHANGED, load);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(t);
      window.removeEventListener(VEHICLE_CHECK_CHANGED, load);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);
  return badge;
}

/** small pill next to a tab label (a dot on the tablet rail / phone bottom bar) */
export function TabBadge({ b }: { b: CheckBadge }) {
  return <span className={`nav-badge ${b.tone}`} title={b.title}><span className="nav-badge-text">{b.text}</span></span>;
}
