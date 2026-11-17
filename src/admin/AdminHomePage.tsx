/**
 * Admin home: today at a glance — who has / has not done the vehicle check, PPE and pre-departure record,
 * which vehicles failed, and which areas the trucks are going to.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMaster } from '../components/MasterContext';
import { listPpeInspections, listTripActivities, listVehicleInspections } from '../lib/api';
import type { PpeInspection, TripActivity, VehicleInspection } from '../lib/types';
import { errMsg, today } from '../lib/utils';

interface Day { veh: VehicleInspection[]; ppe: PpeInspection[]; trips: TripActivity[] }

export function AdminHomePage({ go }: { go: (tab: string) => void }) {
  const { vehicles, activeEmployees, checkItems, areaTypes, nameOf } = useMaster();
  const [date, setDate] = useState(today());
  const [day, setDay] = useState<Day | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [veh, ppe, trips] = await Promise.all([
        listVehicleInspections({ date }), listPpeInspections({ date }), listTripActivities({ date }),
      ]);
      setDay({ veh, ppe, trips });
    } catch (e) { setError(errMsg(e)); }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const s = useMemo(() => {
    if (!day) return null;
    const active = vehicles.filter((v) => v.active);
    const inspected = new Set(day.veh.map((r) => r.plate));
    const tripPlates = new Set(day.trips.map((t) => t.plate));
    const itemName = new Map(checkItems.map((i) => [i.item_no, i.name]));
    const failed = day.veh.filter((r) => r.fail_count > 0).map((r) => ({
      plate: r.plate, dman: r.dman_id,
      items: Object.entries(r.results ?? {}).filter(([, v]) => v === 2).map(([k]) => itemName.get(Number(k)) ?? `ข้อ ${k}`),
    }));
    const areaCount = new Map<string, number>();
    day.trips.forEach((t) => t.area_codes.forEach((c) => areaCount.set(c, (areaCount.get(c) ?? 0) + 1)));
    return {
      vehTotal: active.length,
      vehDone: active.filter((v) => inspected.has(v.plate)).length,
      vehFailed: failed.length,
      ppeTotal: activeEmployees.length,
      ppeDone: day.ppe.length,
      ppeOk: day.ppe.filter((p) => p.status === 'ครบ').length,
      tripsDone: active.filter((v) => tripPlates.has(v.plate)).length,
      notInspected: active.filter((v) => !inspected.has(v.plate)).map((v) => v.plate),
      noTrip: active.filter((v) => !tripPlates.has(v.plate)).map((v) => v.plate),
      failed,
      areas: areaTypes.filter((a) => areaCount.has(a.code)).map((a) => ({ name: a.name, n: areaCount.get(a.code)! })),
    };
  }, [day, vehicles, activeEmployees, checkItems, areaTypes]);

  return (
    <>
      <section className="panel">
        <div className="row spread head-row">
          <h2 className="flush">สรุปประจำวัน</h2>
          <div className="row">
            <input type="date" aria-label="วันที่" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} />
            <button className="btn ghost sm" onClick={load}>รีเฟรช</button>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        {!s ? <div className="empty">กำลังโหลด…</div> : (
          <div className="kpis">
            <div className={`kpi ${s.vehDone === s.vehTotal && s.vehTotal ? 'good' : ''}`}><b>{s.vehDone}/{s.vehTotal}</b><span>รถตรวจแล้ว</span></div>
            <div className={`kpi ${s.vehFailed ? 'bad' : 'good'}`}><b>{s.vehFailed}</b><span>รถไม่ผ่าน</span></div>
            <div className="kpi"><b>{s.ppeDone}/{s.ppeTotal}</b><span>ตรวจ PPE แล้ว (ครบ {s.ppeOk})</span></div>
            <div className={`kpi ${s.tripsDone === s.vehTotal && s.vehTotal ? 'good' : ''}`}><b>{s.tripsDone}/{s.vehTotal}</b><span>บันทึกก่อนออกงาน</span></div>
          </div>
        )}
      </section>

      {s && (
        <div className="two">
          <section className="panel">
            <h2>รถที่ไม่ผ่านการตรวจ</h2>
            {s.failed.length ? s.failed.map((f) => (
              <div className="emp" key={f.plate}>
                <div className="row spread"><b>{f.plate}</b><span className="pill f">{f.items.length} ข้อไม่ผ่าน</span></div>
                <div className="note">D-Man {nameOf(f.dman)}</div>
                <div className="tags">{f.items.map((i) => <span key={i} className="tag on">{i}</span>)}</div>
              </div>
            )) : <div className="empty">ไม่มีรถที่ไม่ผ่าน</div>}
          </section>

          <section className="panel">
            <h2>ยังไม่ได้ทำ</h2>
            <div className="mini-head">ยังไม่ตรวจรถ <span className="note">({s.notInspected.length})</span></div>
            {s.notInspected.length
              ? <div className="tags">{s.notInspected.map((p) => <span key={p} className="tag">{p}</span>)}</div>
              : <div className="note">ตรวจครบทุกคันแล้ว</div>}
            <div className="mini-head mt">ยังไม่บันทึกก่อนออกงาน <span className="note">({s.noTrip.length})</span></div>
            {s.noTrip.length
              ? <div className="tags">{s.noTrip.map((p) => <span key={p} className="tag">{p}</span>)}</div>
              : <div className="note">บันทึกครบทุกคันแล้ว</div>}
            <div className="mini-head mt">พื้นที่ที่ออกงาน</div>
            {s.areas.length
              ? <div className="tags">{s.areas.map((a) => <span key={a.name} className="tag on">{a.name} <b>{a.n}</b></span>)}</div>
              : <div className="note">ยังไม่มีบันทึก</div>}
          </section>
        </div>
      )}

      <section className="panel">
        <h2>ไปที่</h2>
        <div className="row">
          <button className="btn ghost" onClick={() => go('dash')}>ภาพรวมประจำเดือน</button>
          <button className="btn ghost" onClick={() => go('data')}>ข้อมูลการตรวจ / ดาวน์โหลด CSV</button>
          <button className="btn ghost" onClick={() => go('lic')}>ใบขับขี่พนักงาน</button>
          <button className="btn ghost" onClick={() => go('cfg')}>ตั้งค่า พนักงาน · รถ · ผู้ใช้</button>
        </div>
      </section>
    </>
  );
}
