/**
 * Time activities = the work clock of today's vehicle team, three boxes:
 *   1. vehicle / D-Man (from today's vehicle check) and "เริ่มการทำงาน" — the press is the start time
 *   2. ร้านค้า (shops) — to be designed
 *   3. end of the day: live timer and "จบงาน / หยุดเวลาทำงาน"
 * Start and end are stamped by the server (trip_activities.work_started_at / work_ended_at), one record per vehicle per day.
 */
import { useCallback, useEffect, useState } from 'react';
import { ReadOnlyField, thaiDay, useNow } from '../components/Fields';
import { useMaster } from '../components/MasterContext';
import { CheckPicker, NoCheckYet, useTodayChecks } from '../components/TodayChecks';
import { useToast } from '../components/Toast';
import { endWork, listTripActivities, startWork } from '../lib/api';
import type { TripActivity } from '../lib/types';
import { errMsg, today } from '../lib/utils';

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

export function TimeActivitiesPage({ goVehicle }: { goVehicle?: () => void }) {
  const { nameOf } = useMaster();
  const toast = useToast();

  const now = useNow();
  const [day, setDay] = useState(today());
  useEffect(() => { if (today() !== day) setDay(today()); }, [now, day]);

  const { checks, check, selId, setSelId } = useTodayChecks(day);
  const [records, setRecords] = useState<TripActivity[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try { setRecords(await listTripActivities({ date: day })); }
    catch (e) { toast('โหลดข้อมูลไม่สำเร็จ: ' + errMsg(e)); }
  }, [day, toast]);
  useEffect(() => { reload(); }, [reload]);

  // today's work record of the selected vehicle (exists once "เริ่มการทำงาน" was pressed)
  const trip = check ? records.find((r) => r.plate === check.plate) : undefined;
  const running = !!trip && !trip.work_ended_at;
  useTick(running);

  async function start() {
    if (!check) return;
    setBusy(true);
    try { await startWork(check.plate); toast('เริ่มจับเวลาการทำงานแล้ว'); await reload(); }
    catch (e) { toast('เริ่มการทำงานไม่สำเร็จ: ' + errMsg(e)); }
    finally { setBusy(false); }
  }

  async function finish() {
    if (!trip) return;
    if (!window.confirm('จบงานและหยุดเวลาทำงานของวันนี้? กดแล้วแก้ไขไม่ได้')) return;
    setBusy(true);
    try { await endWork(trip.id); toast('จบงานแล้ว บันทึกเวลาทำงานเรียบร้อย'); await reload(); }
    catch (e) { toast('จบงานไม่สำเร็จ: ' + errMsg(e)); }
    finally { setBusy(false); }
  }

  if (checks === null) return <div className="empty">กำลังโหลด…</div>;
  if (!checks.length) return <NoCheckYet title="บันทึกก่อนออกงาน" then="ทะเบียนรถและ D-Man จะขึ้นที่นี่ให้เริ่มการทำงาน" goVehicle={goVehicle} />;

  return (
    <>
      {/* box 1: vehicle + D-Man, and the start of work */}
      <section className="panel">
        <h2>บันทึกก่อนออกงาน</h2>
        <CheckPicker checks={checks} selId={selId} onPick={setSelId} />
        <div className="form-head">
          <div className="fields c4">
            <ReadOnlyField label="วันที่" value={thaiDay(now)} />
            <ReadOnlyField label="เวลาเริ่มงาน" value={trip ? `${trip.start_time} น.` : '–'} />
            <ReadOnlyField label="ทะเบียนรถ" value={check?.plate ?? '–'} />
            <ReadOnlyField label="D-Man" value={check ? nameOf(check.dman_id) : '–'} />
          </div>
        </div>
        <p className="note flush-note">ทะเบียนรถและ D-Man มาจากการตรวจรถ · เวลาเริ่มงานบันทึกตอนกด "เริ่มการทำงาน"</p>
        {trip ? (
          <div className="work-started">▶ เริ่มการทำงานแล้วเมื่อ <b>{trip.start_time} น.</b></div>
        ) : (
          <button className="btn work-btn start" type="button" disabled={busy || !check} onClick={start}>
            ▶ เริ่มการทำงาน
          </button>
        )}
      </section>

      {/* box 2: shops (ร้านค้า) — to be designed */}
      <section className="panel">
        <h2>ร้านค้า</h2>
        <div className="empty">ส่วนสร้างร้านค้า — กำลังจัดทำ</div>
      </section>

      {/* box 3: end of the day — stop the work clock */}
      <section className="panel">
        <h2>บันทึกตอนจบงาน</h2>
        {!trip ? (
          <>
            <p className="note flush-note">ยังไม่ได้เริ่มการทำงาน — กด "เริ่มการทำงาน" ในกล่องแรกก่อน แล้วเวลาทำงานจะเริ่มนับ</p>
            <button className="btn work-btn end" type="button" disabled>■ จบงาน / หยุดเวลาทำงาน</button>
          </>
        ) : !trip.work_ended_at ? (
          <>
            <div className="work-timer" role="timer" aria-live="off">
              <span>เวลาทำงาน</span>
              <b>{hms(Math.max(0, Math.floor((Date.now() - Date.parse(trip.work_started_at)) / 1000)))}</b>
              <span>เริ่มเมื่อ {trip.start_time} น.</span>
            </div>
            <button className="btn work-btn end" type="button" disabled={busy} onClick={finish}>■ จบงาน / หยุดเวลาทำงาน</button>
          </>
        ) : (
          <div className="work-done">
            <div><span>เริ่มงาน</span><b>{trip.start_time} น.</b></div>
            <div><span>จบงาน</span><b>{trip.end_time} น.</b></div>
            <div className="total"><span>เวลาทำงานรวม</span><b>{hoursText(trip.work_minutes ?? 0)}</b></div>
          </div>
        )}
      </section>
    </>
  );
}
