/**
 * Admin summary report (`/admin/summary`): vehicle check + PPE + work clock in one place.
 *   - รายวัน : one row per vehicle checked that day (crew, check result, PPE, start / end / hours, approval)
 *   - รายเดือน: totals per D-Man and per vehicle (days worked, hours, checks, failures, incomplete PPE)
 * Read-only; each table can be downloaded as CSV.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Kpi } from '../components/Fields';
import { useMaster } from '../components/MasterContext';
import { listPpeInspections, listTripActivities, listVehicleInspections } from '../lib/api';
import type { PpeInspection, TripActivity, VehicleInspection } from '../lib/types';
import { downloadText, errMsg, toCsv, today } from '../lib/utils';

interface Data { veh: VehicleInspection[]; ppe: PpeInspection[]; trips: TripActivity[] }
type Mode = 'day' | 'month';

/** 495 → "8:15" (hours:minutes) */
const hm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
const crewOf = (r: VehicleInspection) => [r.dman_id, r.helper1_id, r.helper2_id].filter((x): x is string => !!x);
const minutesOf = (t?: TripActivity) => (t?.work_ended_at ? t.work_minutes ?? 0 : 0);

function useReportData(mode: Mode, date: string, month: string) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    const opts = mode === 'day' ? { date } : { month };
    try {
      const [veh, ppe, trips] = await Promise.all([listVehicleInspections(opts), listPpeInspections(opts), listTripActivities(opts)]);
      setData({ veh, ppe, trips });
    } catch (e) { setError(errMsg(e)); }
  }, [mode, date, month]);
  useEffect(() => { setData(null); load(); }, [load]);
  return { data, error, load };
}

export function SummaryPage({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const [mode, setMode] = useState<Mode>('day');
  const [date, setDate] = useState(today());
  const { data, error, load } = useReportData(mode, date, month);

  return (
    <>
      <section className="panel">
        <div className="row spread head-row">
          <h2 className="flush">เลือกช่วงเวลา</h2>
          <div className="row sum-ctrl">
            <div className="seg compact" role="group" aria-label="ช่วงเวลา">
              <button type="button" aria-pressed={mode === 'day'} onClick={() => setMode('day')}>รายวัน</button>
              <button type="button" aria-pressed={mode === 'month'} onClick={() => setMode('month')}>รายเดือน</button>
            </div>
            {mode === 'day'
              ? <input type="date" aria-label="วันที่" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} />
              : <input type="month" aria-label="เดือน" value={month} max={today().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />}
            <button className="btn ghost sm" onClick={load}>รีเฟรช</button>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        {!data && !error && <div className="empty">กำลังโหลด…</div>}
        {data && (mode === 'day' ? <DayKpis d={data} /> : <MonthKpis d={data} />)}
      </section>
      {data && (mode === 'day' ? <DayReport d={data} date={date} /> : <MonthReport d={data} month={month} />)}
    </>
  );
}

/* ---------------- รายวัน ---------------- */

function useDayRows(d: Data) {
  const { nameOf } = useMaster();
  return useMemo(() => d.veh.map((r) => {
    const crew = crewOf(r);
    const ppe = d.ppe.filter((p) => p.plate === r.plate && crew.includes(p.employee_id));
    const trip = d.trips.find((t) => t.plate === r.plate);
    const ppeMissing = crew.filter((id) => !ppe.some((p) => p.employee_id === id && p.status === 'ครบ'));
    return {
      id: r.id, plate: r.plate, dman: nameOf(r.dman_id),
      helpers: crew.slice(1).map(nameOf).join(', '),
      fail: r.fail_count, pass: r.pass_count,
      ppeOk: crew.length - ppeMissing.length, ppeTotal: crew.length,
      ppeMissing: ppeMissing.map(nameOf),
      start: trip?.start_time ?? '', end: trip?.end_time ?? '',
      running: !!trip && !trip.work_ended_at, minutes: minutesOf(trip), started: !!trip,
      approved: !!r.approved_at,
    };
  }), [d, nameOf]);
}

function DayKpis({ d }: { d: Data }) {
  const { vehicles } = useMaster();
  const rows = useDayRows(d);
  const active = vehicles.filter((v) => v.active).length;
  const crew = rows.reduce((s, r) => s + r.ppeTotal, 0), ppeOk = rows.reduce((s, r) => s + r.ppeOk, 0);
  const fail = rows.filter((r) => r.fail).length;
  return (
    <div className="kpis">
      <Kpi value={`${rows.length}/${active}`} label="รถตรวจแล้ว" tone={rows.length === active && active ? 'good' : ''} />
      <Kpi value={fail} label="รถไม่ผ่านการตรวจ" tone={fail ? 'bad' : 'good'} />
      <Kpi value={`${ppeOk}/${crew}`} label="PPE ครบ · ทีมบนรถ" tone={crew && ppeOk === crew ? 'good' : ''} />
      <Kpi value={`${rows.filter((r) => r.started).length}`} label={`รถเริ่มงาน · กำลังทำงาน ${rows.filter((r) => r.running).length}`} />
      <Kpi value={hm(rows.reduce((s, r) => s + r.minutes, 0))} label="ชั่วโมงทำงานรวม (ชม.:นาที) · จบงานแล้ว" />
    </div>
  );
}

function DayReport({ d, date }: { d: Data; date: string }) {
  const { vehicles } = useMaster();
  const rows = useDayRows(d);
  const checked = new Set(rows.map((r) => r.plate));
  const notChecked = vehicles.filter((v) => v.active && !checked.has(v.plate)).map((v) => v.plate);

  function csv() {
    const head = ['ทะเบียนรถ', 'D-Man', 'ผู้ช่วย', 'ข้อผ่าน', 'ข้อไม่ผ่าน', 'PPE ครบ', 'ทีมบนรถ', 'PPE ไม่ครบ', 'เริ่มงาน', 'จบงาน', 'เวลาทำงาน (นาที)', 'อนุมัติ'];
    const body = rows.map((r) => [r.plate, r.dman, r.helpers, r.pass, r.fail, r.ppeOk, r.ppeTotal, r.ppeMissing.join(', '),
      r.start, r.end, r.running ? 'กำลังทำงาน' : r.started ? r.minutes : '', r.approved ? 'อนุมัติแล้ว' : 'รออนุมัติ']);
    downloadText(`summary-${date}.csv`, toCsv([head, ...body]));
  }

  return (
    <section className="panel">
      <div className="row spread head-row">
        <h2 className="flush">รายคัน · {new Date(date + 'T00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}</h2>
        {rows.length > 0 && <button className="btn ghost sm" onClick={csv}>ดาวน์โหลด CSV</button>}
      </div>
      {!rows.length ? <div className="empty">วันนี้ยังไม่มีการตรวจรถ</div> : (
        <div className="tbl">
          <table className="sum-tbl">
            <thead>
              <tr><th>ทะเบียนรถ</th><th>ทีม</th><th>ตรวจรถ</th><th>PPE</th><th className="num">เริ่ม</th><th className="num">จบ</th><th className="num">เวลาทำงาน</th><th>สถานะ</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.plate}</b></td>
                  <td>{r.dman}{r.helpers && <div className="note">{r.helpers}</div>}</td>
                  <td>{r.fail ? <span className="pill f">ไม่ผ่าน {r.fail} ข้อ</span> : <span className="pill p">ผ่าน</span>}</td>
                  <td>
                    <span className={`pill ${r.ppeOk === r.ppeTotal ? 'p' : 'w'}`}>ครบ {r.ppeOk}/{r.ppeTotal}</span>
                    {r.ppeMissing.length > 0 && <div className="note">ยังไม่ครบ: {r.ppeMissing.join(', ')}</div>}
                  </td>
                  <td className="num">{r.start || '–'}</td>
                  <td className="num">{r.end || '–'}</td>
                  <td className="num">{r.running ? <span className="pill w">กำลังทำงาน</span> : r.started ? hm(r.minutes) : '–'}</td>
                  <td>{r.approved ? <span className="pill p">อนุมัติแล้ว</span> : <span className="pill x">รออนุมัติ</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {notChecked.length > 0 && (
        <>
          <div className="mini-head mt">รถที่ไม่ได้ตรวจ <span className="note">({notChecked.length})</span></div>
          <div className="tags">{notChecked.map((p) => <span key={p} className="tag">{p}</span>)}</div>
        </>
      )}
    </section>
  );
}

/* ---------------- รายเดือน ---------------- */

interface Agg { key: string; label: string; days: Set<string>; minutes: number; checks: number; fails: number; ppeBad: number }
const newAgg = (key: string, label: string): Agg => ({ key, label, days: new Set(), minutes: 0, checks: 0, fails: 0, ppeBad: 0 });

function useMonthAgg(d: Data) {
  const { nameOf } = useMaster();
  return useMemo(() => {
    const byDman = new Map<string, Agg>(), byPlate = new Map<string, Agg>();
    const get = (m: Map<string, Agg>, k: string, label: string) => m.get(k) ?? m.set(k, newAgg(k, label)).get(k)!;
    for (const r of d.veh) {
      for (const a of [get(byDman, r.dman_id, nameOf(r.dman_id)), get(byPlate, r.plate, r.plate)]) {
        a.checks++; if (r.fail_count) a.fails++;
      }
    }
    for (const t of d.trips) {
      for (const a of [get(byDman, t.dman_id, nameOf(t.dman_id)), get(byPlate, t.plate, t.plate)]) {
        a.days.add(t.activity_date); a.minutes += minutesOf(t);
      }
    }
    // incomplete PPE counts against the D-Man who checked it and the vehicle it was on
    for (const p of d.ppe) {
      if (p.status === 'ครบ') continue;
      get(byDman, p.inspector_id, nameOf(p.inspector_id)).ppeBad++;
      get(byPlate, p.plate, p.plate).ppeBad++;
    }
    const sort = (m: Map<string, Agg>) => [...m.values()].sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label, 'th'));
    return { dman: sort(byDman), plate: sort(byPlate) };
  }, [d, nameOf]);
}

function MonthKpis({ d }: { d: Data }) {
  const ended = d.trips.filter((t) => t.work_ended_at);
  const minutes = ended.reduce((s, t) => s + minutesOf(t), 0);
  const fails = d.veh.filter((r) => r.fail_count).length;
  const ppeBad = d.ppe.filter((p) => p.status !== 'ครบ').length;
  return (
    <div className="kpis">
      <Kpi value={new Set(d.trips.map((t) => t.activity_date)).size} label="วันที่มีการทำงาน" />
      <Kpi value={d.trips.length} label="เที่ยวรถที่เริ่มงาน" />
      <Kpi value={hm(minutes)} label="ชั่วโมงทำงานรวม (ชม.:นาที)" />
      <Kpi value={ended.length ? hm(Math.round(minutes / ended.length)) : '–'} label="เฉลี่ยต่อเที่ยว" />
      <Kpi value={`${fails}/${d.veh.length}`} label="ตรวจรถไม่ผ่าน / ทั้งหมด" tone={fails ? 'bad' : ''} />
      <Kpi value={`${ppeBad}/${d.ppe.length}`} label="PPE ไม่ครบ / ทั้งหมด" tone={ppeBad ? 'bad' : ''} />
    </div>
  );
}

function AggTable({ title, first, rows, file }: { title: string; first: string; rows: Agg[]; file: string }) {
  function csv() {
    const head = [first, 'วันทำงาน', 'ชั่วโมงทำงาน (นาที)', 'เฉลี่ยต่อวัน (นาที)', 'ตรวจรถ (ครั้ง)', 'ตรวจรถไม่ผ่าน (ครั้ง)', 'PPE ไม่ครบ (ครั้ง)'];
    downloadText(file, toCsv([head, ...rows.map((a) => [a.label, a.days.size, a.minutes,
      a.days.size ? Math.round(a.minutes / a.days.size) : 0, a.checks, a.fails, a.ppeBad])]));
  }
  return (
    <section className="panel">
      <div className="row spread head-row">
        <h2 className="flush">{title}</h2>
        {rows.length > 0 && <button className="btn ghost sm" onClick={csv}>ดาวน์โหลด CSV</button>}
      </div>
      {!rows.length ? <div className="empty">ยังไม่มีข้อมูลในเดือนนี้</div> : (
        <div className="tbl">
          <table className="sum-tbl">
            <thead>
              <tr><th>{first}</th><th className="num">วันทำงาน</th><th className="num">ชั่วโมงรวม</th><th className="num">เฉลี่ย/วัน</th><th className="num">ตรวจรถ</th><th className="num">ไม่ผ่าน</th><th className="num">PPE ไม่ครบ</th></tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.key}>
                  <td><b>{a.label}</b></td>
                  <td className="num">{a.days.size}</td>
                  <td className="num">{hm(a.minutes)}</td>
                  <td className="num">{a.days.size ? hm(Math.round(a.minutes / a.days.size)) : '–'}</td>
                  <td className="num">{a.checks}</td>
                  <td className={`num ${a.fails ? 'bad-num' : ''}`}>{a.fails}</td>
                  <td className={`num ${a.ppeBad ? 'bad-num' : ''}`}>{a.ppeBad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MonthReport({ d, month }: { d: Data; month: string }) {
  const agg = useMonthAgg(d);
  return (
    <>
      <AggTable title="รายคน (D-Man)" first="D-Man" rows={agg.dman} file={`summary-dman-${month}.csv`} />
      <AggTable title="รายคัน" first="ทะเบียนรถ" rows={agg.plate} file={`summary-vehicle-${month}.csv`} />
    </>
  );
}
