/**
 * Today's vehicle checks, shared by the PPE and Time activities tabs.
 * Both take the vehicle and the team from the vehicle check instead of asking again:
 *   - only my own team's checks: saved by me, or where my employee ID is the D-Man / a helper
 *     (another team's vehicle never shows up here; the Worker refuses it too). Test mode has no login: all checks.
 *   - the latest one is picked first
 *   - with several checks today, a row of buttons lets you switch vehicle
 */
import { useCallback, useEffect, useState } from 'react';
import { listVehicleInspections, type Me } from '../lib/api';
import type { VehicleInspection } from '../lib/types';
import { errMsg } from '../lib/utils';
import { useMe } from './Auth';
import { useMaster } from './MasterContext';
import { useToast } from './Toast';

/** newest first, so the check this person just saved comes first */
const newest = (a: VehicleInspection, b: VehicleInspection) =>
  (b.updated_at ?? b.inspect_time ?? '').localeCompare(a.updated_at ?? a.inspect_time ?? '');

/** my team's check: saved by me, or my employee ID is the D-Man / a helper (test mode, no login: every check) */
export function isMyCheck(me: Me | null, c: VehicleInspection) {
  return !me || c.created_by === me.id
    || (!!me.employee_id && [c.dman_id, c.helper1_id, c.helper2_id].includes(me.employee_id));
}

export function useTodayChecks(day: string) {
  const me = useMe();
  const toast = useToast();
  const [checks, setChecks] = useState<VehicleInspection[] | null>(null);
  const [selId, setSelId] = useState('');

  const reload = useCallback(async () => {
    try {
      setChecks((await listVehicleInspections({ date: day })).filter((c) => isMyCheck(me, c)).sort(newest));
    } catch (e) { setChecks([]); toast('โหลดข้อมูลการตรวจรถไม่สำเร็จ: ' + errMsg(e)); }
  }, [day, toast, me]);
  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!checks?.length || checks.some((c) => c.id === selId)) return;
    setSelId(checks[0].id);
  }, [checks, selId]);

  const check = checks?.find((c) => c.id === selId) ?? null;
  /** pick the check of this plate (e.g. when opening a saved record) */
  const pickPlate = (plate: string) => {
    const c = checks?.find((x) => x.plate === plate);
    if (c) setSelId(c.id);
  };
  return { checks, check, selId, setSelId, pickPlate, reload };
}

export function CheckPicker({ checks, selId, onPick }: {
  checks: VehicleInspection[]; selId: string; onPick: (id: string) => void;
}) {
  const { nameOf } = useMaster();
  if (checks.length < 2) return null;
  return (
    <div className="veh-pick" role="group" aria-label="เลือกรถที่ตรวจวันนี้">
      <span className="ro-label">รถที่ตรวจวันนี้</span>
      <div className="veh-pick-list">
        {checks.map((c) => (
          <button key={c.id} type="button" aria-pressed={c.id === selId} onClick={() => onPick(c.id)}>
            <b>{c.plate}</b><span>D-Man {nameOf(c.dman_id)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function NoCheckYet({ title, then, goVehicle }: { title: string; then: string; goVehicle?: () => void }) {
  return (
    <section className="panel ppe-wait">
      <h2>{title}</h2>
      <p>วันนี้คุณยังไม่มีรถที่ตรวจแล้ว (รถที่คุณตรวจเอง หรือที่คุณอยู่ในทีม) — ตรวจรถและเลือกทีมงานที่แท็บ <b>ตรวจรถ</b> ก่อน แล้ว{then}</p>
      {goVehicle && <button className="btn" onClick={goVehicle}>ไปตรวจรถ</button>}
    </section>
  );
}
