/**
 * Admin home: today at a glance — who has / has not done the vehicle check, PPE and pre-departure record,
 * and which vehicles failed.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSignedUrls } from '../components/Fields';
import { useMaster } from '../components/MasterContext';
import { listPpeInspections, listTripActivities, listVehicleInspections } from '../lib/api';
import type { PpeInspection, TripActivity, VehicleInspection } from '../lib/types';
import { errMsg, today } from '../lib/utils';

interface Day { veh: VehicleInspection[]; ppe: PpeInspection[]; trips: TripActivity[] }

export function AdminHomePage({ go }: { go: (tab: string) => void }) {
  const { vehicles, checkItems, nameOf } = useMaster();
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
      items: Object.entries(r.results ?? {}).filter(([, v]) => v === 2).map(([k]) => ({
        no: k, name: itemName.get(Number(k)) ?? `ข้อ ${k}`,
        note: r.defects?.[k]?.note ?? '', photo: r.defects?.[k]?.photo ?? null,
      })),
    }));
    const crew = new Set(day.veh.flatMap((r) => [r.dman_id, r.helper1_id, r.helper2_id].filter((x): x is string => !!x)));
    return {
      vehTotal: active.length,
      vehDone: active.filter((v) => inspected.has(v.plate)).length,
      vehFailed: failed.length,
      // PPE is checked for the crews of today's vehicle checks only (not every employee)
      ppeTotal: crew.size,
      ppeDone: day.ppe.filter((p) => crew.has(p.employee_id)).length,
      ppeOk: day.ppe.filter((p) => crew.has(p.employee_id) && p.status === 'ครบ').length,
      notInspected: active.filter((v) => !inspected.has(v.plate)).map((v) => v.plate),
      noTrip: [...inspected].filter((p) => !tripPlates.has(p)),
      failed,
    };
  }, [day, vehicles, checkItems]);
  // photos of failed items (shown next to their notes)
  const urls = useSignedUrls(s?.failed.flatMap((f) => f.items.flatMap((i) => (i.photo ? [i.photo] : []))) ?? []);

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
            <div className="kpi"><b>{s.ppeDone}/{s.ppeTotal}</b><span>ตรวจ PPE แล้ว · ทีมบนรถวันนี้ (ครบ {s.ppeOk})</span></div>
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
                <ul className="defect-list">
                  {f.items.map((i) => (
                    <li key={i.no}>
                      <div className="defect-text">
                        <b>{i.name}</b>
                        {i.note ? <span>{i.note}</span> : <span className="note">ไม่มีหมายเหตุ</span>}
                      </div>
                      {i.photo && urls[i.photo] && (
                        <a href={urls[i.photo]} target="_blank" rel="noopener noreferrer" title="เปิดรูปเต็ม">
                          <img src={urls[i.photo]} alt={`รูป${i.name}`} />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )) : <div className="empty">ไม่มีรถที่ไม่ผ่าน</div>}
          </section>

          <section className="panel">
            <h2>ยังไม่ได้ทำ</h2>
            <div className="mini-head">ยังไม่ตรวจรถ <span className="note">({s.notInspected.length})</span></div>
            {s.notInspected.length
              ? <div className="tags">{s.notInspected.map((p) => <span key={p} className="tag">{p}</span>)}</div>
              : <div className="note">ตรวจครบทุกคันแล้ว</div>}
            <div className="mini-head mt">ตรวจรถแล้วแต่ยังไม่เริ่มการทำงาน <span className="note">({s.noTrip.length})</span></div>
            {s.noTrip.length
              ? <div className="tags">{s.noTrip.map((p) => <span key={p} className="tag">{p}</span>)}</div>
              : <div className="note">เริ่มการทำงานครบทุกคันแล้ว</div>}
          </section>
        </div>
      )}

      <section className="panel">
        <h2>ไปที่</h2>
        <div className="row">
          <button className="btn ghost" onClick={() => go('sum')}>สรุปผลการทำงาน</button>
          <button className="btn ghost" onClick={() => go('dash')}>ภาพรวมประจำเดือน</button>
          <button className="btn ghost" onClick={() => go('data')}>ข้อมูลการตรวจ / ดาวน์โหลด CSV</button>
          <button className="btn ghost" onClick={() => go('lic')}>ใบขับขี่พนักงาน</button>
          <button className="btn ghost" onClick={() => go('cfg')}>ตั้งค่า พนักงาน · รถ · ผู้ใช้</button>
        </div>
      </section>
    </>
  );
}
