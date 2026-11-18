/**
 * Time activities, three boxes:
 *   1. vehicle / D-Man (from today's vehicle check), departure time, and "เริ่มการทำงาน" (starts the work clock)
 *   2. area types of the route + note
 *   3. end of the day: live timer and "จบงาน / หยุดเวลาทำงาน" (stops the clock)
 * Start and end times are stamped by the server and kept on the trip record (trip_activities.work_*).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReadOnlyField, fromIso, thaiDay, useNow } from '../components/Fields';
import { useMaster } from '../components/MasterContext';
import { CheckPicker, NoCheckYet, useTodayChecks } from '../components/TodayChecks';
import { useToast } from '../components/Toast';
import { endWork, listTripActivities, saveTripActivity, startWork } from '../lib/api';
import type { TripActivity, TripForm } from '../lib/types';
import { errMsg, nowTime, today } from '../lib/utils';

const blankForm = (keep?: Partial<TripForm>): TripForm => ({
  id: null, date: today(), time: nowTime(), plate: '', dman: '', areas: [], note: '', ...keep,
});
const clock = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
const pad = (n: number) => String(n).padStart(2, '0');
/** 3725 s → "01:02:05" */
const hms = (sec: number) => `${pad(Math.floor(sec / 3600))}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
/** 495 min → "8 ชม. 15 นาที" */
const hoursText = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} ชม. ${min % 60} นาที` : `${min} นาที`);

/** re-render every second while `on` (for the running work timer) */
function useTick(on: boolean) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setT((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [on]);
}

const fromRecord = (r: TripActivity): TripForm => ({
  id: r.id, date: r.activity_date, time: r.depart_time.slice(0, 5), plate: r.plate, dman: r.dman_id,
  areas: [...r.area_codes], note: r.note,
});

export function TimeActivitiesPage({ goVehicle }: { goVehicle?: () => void }) {
  const { areaTypes, nameOf } = useMaster();
  const toast = useToast();

  // the date is not editable (today; the server stamps it). The departure time is entered by staff.
  const now = useNow();
  const [day, setDay] = useState(today());
  useEffect(() => { if (today() !== day) setDay(today()); }, [now, day]);

  const { checks, check, selId, setSelId } = useTodayChecks(day);
  const [records, setRecords] = useState<TripActivity[]>([]);
  const [f, setF] = useState<TripForm>(() => blankForm());
  const [saving, setSaving] = useState(false);
  const [clockBusy, setClockBusy] = useState(false);

  const reload = useCallback(async () => {
    try { setRecords(await listTripActivities({ date: day })); }
    catch (e) { toast('โหลดข้อมูลไม่สำเร็จ: ' + errMsg(e)); }
  }, [day, toast]);
  useEffect(() => { reload(); }, [reload]);

  // the selected vehicle's trip of today is opened for editing; otherwise a blank form for it
  useEffect(() => {
    if (!check) return;
    const existing = records.find((r) => r.plate === check.plate);
    setF((p) => {
      if (existing) return p.id === existing.id ? p : fromRecord(existing);
      return p.id === null && p.plate === check.plate ? p : blankForm({ plate: check.plate });
    });
  }, [check, records]);

  // today's trip of the selected vehicle (holds the work clock)
  const trip = check ? records.find((r) => r.plate === check.plate) : undefined;
  const running = !!trip?.work_started_at && !trip.work_ended_at;
  useTick(running);

  async function start() {
    if (!check) return;
    if (!f.time) return toast('กรุณาระบุเวลาออกงาน');
    setClockBusy(true);
    try { await startWork(check.plate, f.time); toast('เริ่มจับเวลาการทำงานแล้ว'); await reload(); }
    catch (e) { toast('เริ่มการทำงานไม่สำเร็จ: ' + errMsg(e)); }
    finally { setClockBusy(false); }
  }

  async function finish() {
    if (!trip) return;
    if (!window.confirm('จบงานและหยุดเวลาทำงานของวันนี้? กดแล้วแก้ไขไม่ได้')) return;
    setClockBusy(true);
    try { await endWork(trip.id); toast('จบงานแล้ว บันทึกเวลาทำงานเรียบร้อย'); await reload(); }
    catch (e) { toast('จบงานไม่สำเร็จ: ' + errMsg(e)); }
    finally { setClockBusy(false); }
  }

  // active area types, plus any switched-off type that the record being edited still uses
  const choices = useMemo(
    () => areaTypes.filter((a) => a.active || f.areas.includes(a.code)),
    [areaTypes, f.areas],
  );

  const set = <K extends keyof TripForm>(k: K, v: TripForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const toggleArea = (code: string) =>
    setF((p) => ({ ...p, areas: p.areas.includes(code) ? p.areas.filter((c) => c !== code) : [...p.areas, code] }));

  async function save() {
    if (!check) return;
    if (!f.time) return toast('กรุณาระบุเวลาออกงาน');
    if (!f.areas.length) return toast('เลือกประเภทพื้นที่อย่างน้อย 1 อย่าง');
    setSaving(true);
    try {
      await saveTripActivity({ ...f, plate: check.plate, dman: check.dman_id, date: f.id ? f.date : today() });
      toast(f.id ? 'แก้ไขบันทึกก่อนออกงานแล้ว' : 'บันทึกก่อนออกงานแล้ว');
      reload();
    } catch (e) {
      toast('บันทึกไม่สำเร็จ: ' + errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  if (checks === null) return <div className="empty">กำลังโหลด…</div>;
  if (!checks.length) return <NoCheckYet title="บันทึกก่อนออกงาน" then="ทะเบียนรถและ D-Man จะขึ้นที่นี่ให้บันทึก" goVehicle={goVehicle} />;

  return (
    <>
      {/* box 1: vehicle, D-Man, date and departure time */}
      <section className="panel">
        <h2>{f.id ? 'แก้ไขบันทึกก่อนออกงาน' : 'บันทึกก่อนออกงาน'}</h2>
        <CheckPicker checks={checks} selId={selId} onPick={setSelId} />
        <div className="form-head">
          <div className="fields c4">
            <ReadOnlyField label="วันที่" value={thaiDay(f.id ? fromIso(f.date) : now)} />
            <label>เวลาออกงาน<input type="time" value={f.time} onChange={(e) => set('time', e.target.value)} /></label>
            <ReadOnlyField label="ทะเบียนรถ" value={check?.plate ?? '–'} />
            <ReadOnlyField label="D-Man" value={check ? nameOf(check.dman_id) : '–'} />
          </div>
        </div>
        <p className="note flush-note">ทะเบียนรถและ D-Man มาจากการตรวจรถ ถ้าต้องการเปลี่ยน ให้แก้ที่แท็บตรวจรถ</p>
        {trip?.work_started_at ? (
          <div className="work-started">▶ เริ่มการทำงานแล้วเมื่อ <b>{clock(trip.work_started_at)} น.</b></div>
        ) : (
          <button className="btn work-btn start" type="button" disabled={clockBusy || !check} onClick={start}>
            ▶ เริ่มการทำงาน
          </button>
        )}
      </section>

      {/* box 2: area types of the route + note, and the save button */}
      <section className="panel">
        <div className="row spread head-row">
          <h2 className="flush">ประเภทพื้นที่ <span className="note">(เลือกได้หลายอย่าง)</span></h2>
          <span className="note mono">{f.areas.length}/{choices.length}</span>
        </div>
        <div className="area-grid" role="group" aria-label="ประเภทพื้นที่">
          {choices.map((a) => {
            const on = f.areas.includes(a.code);
            return (
              <button key={a.code} type="button" className="area-chip" aria-pressed={on} aria-label={a.name} onClick={() => toggleArea(a.code)}>
                <span className="area-check" aria-hidden="true">{on ? '✓' : ''}</span>
                <span>{a.name}</span>
              </button>
            );
          })}
        </div>

        <label className="mt">หมายเหตุ
          <textarea value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="เช่น เส้นทาง จุดส่งพิเศษ" />
        </label>
        <div className="row spread mt">
          <span className="note">{f.areas.length ? `เลือก ${f.areas.length} ประเภท` : 'ยังไม่ได้เลือกประเภทพื้นที่'}</span>
          <button className="btn" type="button" disabled={saving || !check} onClick={save}>{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button>
        </div>
      </section>

      {/* box 3: end of the day — stop the work clock */}
      <section className="panel">
        <h2>บันทึกตอนจบงาน</h2>
        {!trip?.work_started_at ? (
          <>
            <p className="note flush-note">ยังไม่ได้เริ่มการทำงาน — กด "เริ่มการทำงาน" ในกล่องแรกก่อน แล้วเวลาทำงานจะเริ่มนับ</p>
            <button className="btn work-btn end" type="button" disabled>■ จบงาน / หยุดเวลาทำงาน</button>
          </>
        ) : !trip.work_ended_at ? (
          <>
            <div className="work-timer" role="timer" aria-live="off">
              <span>เวลาทำงาน</span>
              <b>{hms(Math.max(0, Math.floor((Date.now() - Date.parse(trip.work_started_at)) / 1000)))}</b>
              <span>เริ่มเมื่อ {clock(trip.work_started_at)} น.</span>
            </div>
            <button className="btn work-btn end" type="button" disabled={clockBusy} onClick={finish}>■ จบงาน / หยุดเวลาทำงาน</button>
          </>
        ) : (
          <div className="work-done">
            <div><span>เริ่มงาน</span><b>{clock(trip.work_started_at)} น.</b></div>
            <div><span>จบงาน</span><b>{clock(trip.work_ended_at)} น.</b></div>
            <div className="total"><span>เวลาทำงานรวม</span><b>{hoursText(trip.work_minutes ?? Math.round((Date.parse(trip.work_ended_at) - Date.parse(trip.work_started_at)) / 60_000))}</b></div>
          </div>
        )}
      </section>
    </>
  );
}
