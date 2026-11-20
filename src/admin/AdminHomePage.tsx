/**
 * Admin home ("หน้าหลัก"): today's operation at a glance — what is done, what is stuck, what needs the admin.
 *   1. progress of the day, step by step: ตรวจรถ → อนุมัติ → ตรวจ PPE → เริ่มงาน → จบงาน
 *   2. "ต้องจัดการ": things waiting for the admin, each one opens the tab where it is handled
 *   3. "สถานะรถวันนี้": one tile per active vehicle, coloured by where it is in the day
 * Today's view refreshes itself every 2 minutes (only while the page is open on today).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMaster } from '../components/MasterContext';
import { DeliveryPlan } from './DeliveryPlan';
import { listLicenses, listPpeInspections, listTripActivities, listVehicleInspections } from '../lib/api';
import type { LicenseRow } from '../lib/license';
import type { PpeInspection, TripActivity, VehicleInspection } from '../lib/types';
import { errMsg, today } from '../lib/utils';

interface Day { veh: VehicleInspection[]; ppe: PpeInspection[]; trips: TripActivity[] }

type Tone = 'idle' | 'wait' | 'bad' | 'ok' | 'run' | 'done';
interface Tile { plate: string; tone: Tone; status: string; dman: string; time: string }

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const thDay = (d: string) => new Date(`${d}T00:00`).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const hhmm = (d: Date) => d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

export function AdminHomePage({ go }: { go: (tab: string) => void }) {
  const { vehicles, nameOf } = useMaster();
  const [date, setDate] = useState(today());
  const [day, setDay] = useState<Day | null>(null);
  const [lic, setLic] = useState<LicenseRow[] | null>(null);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [veh, ppe, trips] = await Promise.all([
        listVehicleInspections({ date }), listPpeInspections({ date }), listTripActivities({ date }),
      ]);
      setDay({ veh, ppe, trips });
      setUpdated(new Date());
    } catch (e) { setError(errMsg(e)); }
  }, [date]);
  useEffect(() => { setDay(null); load(); }, [load]);
  // licences do not depend on the date: once per visit
  useEffect(() => { listLicenses().then((r) => setLic(r.rows)).catch(() => setLic([])); }, []);
  // today: refresh every 2 minutes while the page is visible
  useEffect(() => {
    if (date !== today()) return;
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 120_000);
    return () => window.clearInterval(t);
  }, [date, load]);

  const s = useMemo(() => {
    if (!day) return null;
    const active = vehicles.filter((v) => v.active);
    const checkOf = new Map(day.veh.map((r) => [r.plate, r]));
    const tripOf = new Map(day.trips.map((t) => [t.plate, t]));

    const crew = new Set(day.veh.flatMap((r) => [r.dman_id, r.helper1_id, r.helper2_id].filter((x): x is string => !!x)));
    const ppeOf = new Map(day.ppe.map((p) => [p.employee_id, p]));
    const ppeDone = [...crew].filter((id) => ppeOf.has(id)).length;
    const ppeShort = [...crew].filter((id) => ppeOf.get(id) && ppeOf.get(id)!.status !== 'ครบ').length;

    const tiles: Tile[] = active.map((v) => {
      const c = checkOf.get(v.plate);
      const t = tripOf.get(v.plate);
      const dman = c ? nameOf(c.dman_id) : t ? nameOf(t.dman_id) : '';
      if (!c) return { plate: v.plate, tone: 'idle', status: 'ยังไม่ตรวจรถ', dman, time: '' };
      if (t?.work_ended_at) return { plate: v.plate, tone: 'done', status: 'จบงานแล้ว', dman, time: `${t.start_time}–${t.end_time ?? ''} น.` };
      if (t) return { plate: v.plate, tone: 'run', status: 'กำลังทำงาน', dman, time: `เริ่ม ${t.start_time} น.` };
      if (c.rejected_at) return { plate: v.plate, tone: 'bad', status: 'ไม่อนุมัติ', dman, time: '' };
      if (c.fail_count) return { plate: v.plate, tone: 'bad', status: `ไม่ผ่าน ${c.fail_count} ข้อ`, dman, time: '' };
      if (!c.approved_at) return { plate: v.plate, tone: 'wait', status: 'รออนุมัติ', dman, time: `ตรวจ ${(c.inspect_time ?? '').slice(0, 5)} น.` };
      return { plate: v.plate, tone: 'ok', status: 'อนุมัติแล้ว · ยังไม่เริ่มงาน', dman, time: '' };
    });
    // the ones needing attention first
    const rank: Record<Tone, number> = { bad: 0, wait: 1, idle: 2, ok: 3, run: 4, done: 5 };
    tiles.sort((a, b) => rank[a.tone] - rank[b.tone] || a.plate.localeCompare(b.plate));

    const inspected = day.veh.length;
    return {
      steps: [
        { key: 'veh', label: 'ตรวจรถ', done: inspected, total: active.length, unit: 'คัน' },
        { key: 'appr', label: 'อนุมัติการตรวจ', done: day.veh.filter((r) => r.approved_at).length, total: inspected, unit: 'คัน' },
        { key: 'ppe', label: 'ตรวจ PPE', done: ppeDone, total: crew.size, unit: 'คน' },
        { key: 'start', label: 'เริ่มงาน', done: day.trips.length, total: inspected, unit: 'คัน' },
        { key: 'end', label: 'จบงาน', done: day.trips.filter((t) => t.work_ended_at).length, total: day.trips.length, unit: 'คัน' },
      ],
      todo: {
        waiting: day.veh.filter((r) => !r.approved_at && !r.rejected_at).length,
        failed: day.veh.filter((r) => r.fail_count > 0).length,
        rejected: day.veh.filter((r) => r.rejected_at).length,
        ppeShort,
        ppeNotYet: crew.size - ppeDone,
        notInspected: active.length - inspected,
      },
      tiles,
    };
  }, [day, vehicles, nameOf]);

  const licTodo = useMemo(() => ({
    expired: lic?.filter((r) => r.status === 'expired').length ?? 0,
    expiring: lic?.filter((r) => r.status === 'expiring').length ?? 0,
  }), [lic]);


  const todo = s ? [
    { n: s.todo.waiting, tone: 'wait', label: 'การตรวจรถรออนุมัติ', unit: 'คัน', tab: 'vs' },
    { n: s.todo.failed, tone: 'bad', label: 'รถที่ตรวจไม่ผ่าน', unit: 'คัน', tab: 'vs' },
    { n: s.todo.rejected, tone: 'bad', label: 'ไม่อนุมัติ รอทีมแก้ไขส่งใหม่', unit: 'คัน', tab: 'vs' },
    { n: s.todo.ppeShort, tone: 'bad', label: 'พนักงาน PPE ไม่ครบ', unit: 'คน', tab: 'ppe' },
    { n: s.todo.ppeNotYet, tone: 'wait', label: 'ทีมบนรถที่ยังไม่ตรวจ PPE', unit: 'คน', tab: 'ppe' },
    { n: s.todo.notInspected, tone: 'idle', label: 'รถที่ยังไม่ตรวจ', unit: 'คัน', tab: 'vs' },
    { n: licTodo.expired, tone: 'bad', label: 'ใบขับขี่หมดอายุแล้ว', unit: 'คน', tab: 'lic' },
    { n: licTodo.expiring, tone: 'wait', label: 'ใบขับขี่ใกล้หมดอายุ', unit: 'คน', tab: 'lic' },
  ].filter((t) => t.n > 0) : [];

  return (
    <div className="home">
      <section className="panel home-head">
        <div>
          <h2 className="flush">{date === today() ? 'วันนี้' : 'ย้อนหลัง'} · {thDay(date)}</h2>
          <span className="note">{updated ? `อัปเดตล่าสุด ${hhmm(updated)} น.` : 'กำลังโหลด…'}{date === today() && ' · รีเฟรชเองทุก 2 นาที'}</span>
        </div>
        <div className="row">
          <input type="date" aria-label="วันที่" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} />
          <button className="btn ghost sm" onClick={load}>รีเฟรช</button>
        </div>
      </section>
      {error && <div className="form-error" role="alert">{error}</div>}
      {!s && !error && <div className="empty">กำลังโหลด…</div>}

      {/* stores each vehicle must deliver to (trial: browser only until the database is designed) */}
      <DeliveryPlan date={date} />

      {s && (<>
        {/* 1. progress of the day */}
        <section className="home-steps" aria-label="ความคืบหน้าวันนี้">
          {s.steps.map((st, i) => {
            const p = pct(st.done, st.total);
            const full = st.total > 0 && st.done >= st.total;
            return (
              <div key={st.key} className={`home-step ${full ? 'full' : st.done ? 'part' : ''}`}>
                <div className="home-step-top"><span className="home-step-no">{full ? '✓' : i + 1}</span>{st.label}</div>
                <b className="mono">{st.done}<small>/{st.total} {st.unit}</small></b>
                <div className="home-bar" aria-hidden><i style={{ width: `${p}%` }} /></div>
                <span className="note">{st.total ? `${p}%` : 'ยังไม่มีรายการ'}</span>
              </div>
            );
          })}
        </section>

        <div className="home-two">
          {/* 2. waiting for the admin */}
          <section className="panel home-todo">
            <h2>ต้องจัดการ</h2>
            {todo.length ? (
              <ul>
                {todo.map((t) => (
                  <li key={t.label}>
                    <button type="button" className={`home-todo-row ${t.tone}`} onClick={() => go(t.tab)}>
                      <span className="home-dot" aria-hidden />
                      <span className="home-todo-label">{t.label}</span>
                      <b className="mono">{t.n}</b><span className="note">{t.unit}</span>
                      <span className="home-chev" aria-hidden>›</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <div className="home-clear">ไม่มีเรื่องค้าง — ทุกอย่างเรียบร้อย</div>}
          </section>

          {/* 3. every vehicle today */}
          <section className="panel home-fleet">
            <div className="row spread">
              <h2 className="flush">สถานะรถ{date === today() ? 'วันนี้' : 'วันที่เลือก'}</h2>
              <div className="home-legend">
                <span className="bad">ไม่ผ่าน / ไม่อนุมัติ</span><span className="wait">รออนุมัติ</span><span className="idle">ยังไม่ตรวจ</span>
                <span className="ok">อนุมัติแล้ว</span><span className="run">กำลังทำงาน</span><span className="done">จบงาน</span>
              </div>
            </div>
            <div className="home-tiles">
              {s.tiles.map((t) => (
                <button key={t.plate} type="button" className={`home-tile ${t.tone}`} onClick={() => go('vs')} title="เปิดหน้าสถานะรถ">
                  <b>{t.plate}</b>
                  <span className="home-tile-status">{t.status}</span>
                  <span className="note">{t.dman || '—'}{t.time && ` · ${t.time}`}</span>
                </button>
              ))}
              {!s.tiles.length && <div className="empty">ยังไม่มีทะเบียนรถ — เพิ่มได้ที่แท็บตั้งค่า</div>}
            </div>
          </section>
        </div>

      </>)}
    </div>
  );
}
